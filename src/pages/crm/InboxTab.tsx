// Sales CRM › Inbox (migration 0134): the support@expac.co.za mailbox,
// sorted by RELATIONSHIP from the CRM (not guessed) — Customers, Leads,
// Suppliers & Agents, Other / Unknown — with Unread, Needs reply and Linked
// to a shipment views across them. /api/inbox-sync copies new mail in every
// 5 minutes (and on Sync now); a message's raw .eml is parsed here when it's
// opened. Replies go out through /api/send-mail, threaded under the original.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCompanySettings,
  useInbox,
  useInboxState,
  useJobs,
  useSaveLead,
  useSyncInbox,
  useUpdateInboxMessage,
} from "../../lib/hooks";
import { downloadInboxRaw, insertInboxMessage } from "../../lib/db";
import { sendMail } from "../../lib/mail";
import { formatDateTime } from "../../lib/format";
import type { InboxCategory, InboxMessage, Job } from "../../lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Folder = "all" | InboxCategory;
type View = "all" | "unread" | "needs" | "job";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "all", label: "All mail" },
  { key: "customer", label: "Customers" },
  { key: "lead", label: "Leads" },
  { key: "partner", label: "Suppliers & Agents" },
  { key: "unknown", label: "Other / Unknown" },
];
const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "unread", label: "Unread" },
  { key: "needs", label: "Needs reply" },
  { key: "job", label: "Linked to a shipment" },
];
const CATEGORY_LABEL: Record<InboxCategory, string> = {
  customer: "Customer",
  lead: "Lead",
  partner: "Supplier / Agent",
  unknown: "Unknown",
};
const RECORD_ROUTE: Record<string, string> = {
  client: "/clients",
  supplier: "/suppliers",
  agent: "/agents",
  transporter: "/transporters",
  clearing_agent: "/clearing-agents",
  destination_agent: "/destination-agents",
  lead: "/crm?tab=leads",
};
/** Our own mail (any expac.co.za address, incl. a sending subdomain like
 *  send.expac.co.za) never needs a reply. */
const isOurs = (email: string | null) => /(@|\.)expac\.co\.za$/i.test((email ?? "").trim());

const isUnread = (m: InboxMessage) => m.direction === "in" && !m.seen && !m.read_at;
const needsReply = (m: InboxMessage) =>
  m.direction === "in" &&
  !m.answered &&
  !m.replied_at &&
  !m.done_at &&
  !m.is_bulk &&
  !isOurs(m.from_email);
const cat = (m: InboxMessage): InboxCategory => m.category ?? "unknown";

function shortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return d.getFullYear() === now.getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${d.getFullYear()}`;
}
const jobLabel = (j: Job) => `${j.reference}${j.client?.company ? ` · ${j.client.company}` : ""}`;

/** A parsed .eml (postal-mime), loaded when a message is opened. */
interface Parsed {
  html: string | null;
  text: string | null;
  attachments: { name: string; type: string; url: string; size: number; inline: boolean }[];
}
async function parseRaw(path: string): Promise<Parsed> {
  const [{ default: PostalMime }, buf] = await Promise.all([import("postal-mime"), downloadInboxRaw(path)]);
  const email = await PostalMime.parse(buf);
  const cids = new Map<string, string>();
  const attachments = (email.attachments ?? []).map((a) => {
    const content = typeof a.content === "string" ? new TextEncoder().encode(a.content) : a.content;
    const url = URL.createObjectURL(
      new Blob([content as BlobPart], { type: a.mimeType || "application/octet-stream" }),
    );
    const cid = (a.contentId ?? "").replace(/^<|>$/g, "");
    if (cid) cids.set(cid, url);
    return {
      name: a.filename || "attachment",
      type: a.mimeType || "",
      url,
      size: (content as ArrayBuffer | Uint8Array).byteLength ?? 0,
      inline: a.disposition === "inline" && !!cid,
    };
  });
  let html = email.html ?? null;
  if (html && cids.size) html = html.replace(/cid:([^"'\s)>]+)/gi, (m, id) => cids.get(id) ?? m);
  return { html, text: email.text ?? null, attachments };
}

export default function InboxTab() {
  const q = useInbox();
  const stateQ = useInboxState();
  const sync = useSyncInbox();
  const update = useUpdateInboxMessage();
  const jobsQ = useJobs();
  const { toast, error } = useToast();
  const [folder, setFolder] = useState<Folder>("all");
  const [view, setView] = useState<View>("all");
  const [jobFilter, setJobFilter] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ replyTo?: InboxMessage } | null>(null);
  // Draggable divider between the list and the reading pane (width kept per browser).
  const [listWidth, setListWidth] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("inbox-list-width")) || 380;
    } catch {
      return 380;
    }
  });
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.min(1100, Math.max(260, startW + ev.clientX - startX));
      setListWidth(w);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("inbox-resizing");
      try {
        localStorage.setItem("inbox-list-width", String(w));
      } catch {
        /* storage unavailable */
      }
    };
    document.body.classList.add("inbox-resizing");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  const all = useMemo(() => q.data ?? [], [q.data]);
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);

  // Sync once when the inbox opens (the cron keeps it fresh after that).
  useEffect(() => {
    sync.mutate(undefined, { onError: () => undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const incoming = all.filter((m) => m.direction === "in");
  const inFolder = (m: InboxMessage) => folder === "all" || cat(m) === folder;
  const inView = (m: InboxMessage) =>
    view === "unread"
      ? isUnread(m)
      : view === "needs"
        ? needsReply(m)
        : view === "job"
          ? !!m.job_id && (!jobFilter || m.job_id === jobFilter)
          : true;
  const needle = search.trim().toLowerCase();
  const rows = (view === "job" ? all : incoming).filter(
    (m) =>
      inFolder(m) &&
      inView(m) &&
      (!needle ||
        [m.subject, m.from_name, m.from_email, m.snippet, m.record_name, m.job_reference, ...(m.to_emails ?? [])]
          .some((v) => (v ?? "").toLowerCase().includes(needle))),
  );
  const open = all.find((m) => m.id === openId) ?? null;

  const folderCount = (f: Folder) => incoming.filter((m) => (f === "all" || cat(m) === f) && isUnread(m)).length;
  const viewCount = (v: View) =>
    v === "unread"
      ? incoming.filter((m) => inFolder(m) && isUnread(m)).length
      : v === "needs"
        ? incoming.filter((m) => inFolder(m) && needsReply(m)).length
        : v === "job"
          ? all.filter((m) => inFolder(m) && m.job_id).length
          : 0;
  const linkedJobs = jobs.filter((j) => all.some((m) => m.job_id === j.id));

  function select(m: InboxMessage) {
    setOpenId(m.id);
    if (isUnread(m)) update.mutate({ id: m.id, patch: { read_at: new Date().toISOString() } });
  }

  async function onSync() {
    try {
      const r = await sync.mutateAsync();
      toast(
        r.added
          ? `${r.added} new message${r.added === 1 ? "" : "s"}${r.pending ? ` · ${r.pending} more on the way` : ""}`
          : "Inbox is up to date",
      );
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not sync the inbox");
    }
  }

  const st = stateQ.data;
  const syncNote = sync.isPending
    ? "Syncing…"
    : st?.last_error
      ? `Last sync failed: ${st.last_error}`
      : st?.last_sync_at
        ? `Synced ${formatDateTime(st.last_sync_at)}`
        : "Not synced yet";

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search sender, subject, shipment…" />}
        count={q.isLoading ? undefined : `${rows.length} message${rows.length === 1 ? "" : "s"}`}
        hint={`support@expac.co.za — sorted by who the sender is in the CRM. ${syncNote}`}
        primary={
          <button className="btn" onClick={() => setCompose({})}>
            + New email
          </button>
        }
      >
        <button className="btn outline" onClick={onSync} disabled={sync.isPending}>
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
      </PageTools>

      {st?.last_error && /isn't connected/i.test(st.last_error) && (
        <p className="hint">The inbox isn't connected yet — add the IMAP settings in Cloudflare.</p>
      )}

      <div className="panel inbox" style={{ "--inbox-list": `${listWidth}px` } as React.CSSProperties}>
        <nav className="inbox-nav">
          <div className="inbox-nav-head">Folders</div>
          {FOLDERS.map((f) => {
            const n = folderCount(f.key);
            return (
              <button
                key={f.key}
                type="button"
                className={`inbox-nav-item${folder === f.key ? " on" : ""}`}
                onClick={() => setFolder(f.key)}
              >
                <span className={`inbox-dot cat-${f.key}`} />
                {f.label}
                {n > 0 && <span className="inbox-count">{n}</span>}
              </button>
            );
          })}
          <div className="inbox-nav-head">Views</div>
          {VIEWS.map((v) => {
            const n = viewCount(v.key);
            return (
              <button
                key={v.key}
                type="button"
                className={`inbox-nav-item${view === v.key ? " on" : ""}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
                {n > 0 && <span className="inbox-count">{n}</span>}
              </button>
            );
          })}
          {view === "job" && (
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} style={{ marginTop: 6 }}>
              <option value="">Every shipment</option>
              {linkedJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          )}
        </nav>

        <div className="inbox-list">
          {q.isLoading ? (
            <Loading />
          ) : q.isError ? (
            <ErrorNote error={q.error} />
          ) : rows.length === 0 ? (
            <EmptyState>
              {all.length === 0 ? "No mail yet — it arrives with the next sync." : "Nothing here."}
            </EmptyState>
          ) : (
            rows.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`inbox-row${m.id === openId ? " on" : ""}${isUnread(m) ? " unread" : ""}`}
                onClick={() => select(m)}
              >
                <div className="inbox-row-top">
                  <span className={`inbox-dot cat-${cat(m)}`} title={CATEGORY_LABEL[cat(m)]} />
                  <span className="inbox-from">
                    {m.direction === "out"
                      ? `To: ${m.to_emails[0] ?? ""}`
                      : m.from_name || m.from_email || "(unknown sender)"}
                  </span>
                  <span className="inbox-date">{shortDate(m.sent_at)}</span>
                </div>
                <div className="inbox-subject">
                  {m.has_attachments && <span title="Attachments">📎 </span>}
                  {m.subject || "(no subject)"}
                </div>
                <div className="inbox-meta">
                  {m.record_name && <span className="inbox-chip">{m.record_name}</span>}
                  {m.job_reference && <span className="inbox-chip job">{m.job_reference}</span>}
                  {needsReply(m) && <span className="inbox-chip needs">Needs reply</span>}
                  {m.direction === "out" && <span className="inbox-chip">Sent</span>}
                  {m.snippet && <span className="inbox-snippet">{m.snippet}</span>}
                </div>
              </button>
            ))
          )}
        </div>

        <div
          className="inbox-splitter"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          onMouseDown={startResize}
          onDoubleClick={() => {
            setListWidth(380);
            try {
              localStorage.removeItem("inbox-list-width");
            } catch {
              /* storage unavailable */
            }
          }}
        />

        <div className="inbox-reader">
          {open ? (
            <Reader
              key={open.id}
              msg={open}
              thread={all.filter((m) => open.thread_key && m.thread_key === open.thread_key && m.id !== open.id)}
              jobs={jobs}
              onReply={() => setCompose({ replyTo: open })}
            />
          ) : (
            <EmptyState>Pick a message.</EmptyState>
          )}
        </div>
      </div>

      {compose && <ComposeModal replyTo={compose.replyTo} onClose={() => setCompose(null)} />}
    </>
  );
}

function Reader({
  msg,
  thread,
  jobs,
  onReply,
}: {
  msg: InboxMessage;
  thread: InboxMessage[];
  jobs: Job[];
  onReply: () => void;
}) {
  const update = useUpdateInboxMessage();
  const saveLead = useSaveLead();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const parsedQ = useQuery({
    queryKey: ["inbox_raw", msg.raw_path],
    queryFn: () => parseRaw(msg.raw_path as string),
    enabled: !!msg.raw_path,
    staleTime: Infinity,
  });
  const parsed = parsedQ.data;

  // First open: keep a snippet + text so search and shipment linking can use it.
  useEffect(() => {
    if (!parsed || msg.snippet) return;
    const text = (parsed.text ?? (parsed.html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) return;
    update.mutate({ id: msg.id, patch: { snippet: text.slice(0, 180), body_text: text.slice(0, 20000) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, msg.id]);

  const html = parsed?.html ?? msg.body_html;
  const text = parsed?.text ?? msg.body_text;
  const c = cat(msg);

  async function patch(p: Parameters<typeof update.mutateAsync>[0]["patch"], done: string) {
    try {
      await update.mutateAsync({ id: msg.id, patch: p });
      toast(done);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }
  async function makeLead() {
    const email = msg.from_email ?? "";
    const domain = email.split("@")[1] ?? "";
    const company = msg.from_name && !msg.from_name.includes("@") ? msg.from_name : domain || email;
    try {
      await saveLead.mutateAsync({
        patch: { company, contact: msg.from_name || null, email, source: "Email" },
      });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      toast(`${company} added as a lead`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not create the lead");
    }
  }

  return (
    <div className="inbox-read">
      <div className="inbox-read-head">
        <h3>{msg.subject || "(no subject)"}</h3>
        <div className="inbox-read-from">
          <strong>{msg.direction === "out" ? "ExPac (sent from Motion)" : msg.from_name || msg.from_email}</strong>
          {msg.direction === "in" && msg.from_name && <span className="muted"> &lt;{msg.from_email}&gt;</span>}
          <span className="muted"> · {formatDateTime(msg.sent_at)}</span>
        </div>
        <div className="muted" style={{ fontSize: "0.78rem" }}>
          To: {msg.to_emails.join(", ") || "—"}
          {msg.cc_emails.length > 0 && ` · Cc: ${msg.cc_emails.join(", ")}`}
        </div>
        <div className="inbox-read-tags">
          <span className={`inbox-chip cat-${c}`}>
            {CATEGORY_LABEL[c]}
            {msg.record_name ? `: ${msg.record_name}` : ""}
          </span>
          {msg.record_kind && msg.record_id && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() =>
                navigate(RECORD_ROUTE[msg.record_kind as string], {
                  state: { openContactId: msg.record_id },
                })
              }
            >
              Open record ›
            </button>
          )}
          {msg.is_bulk && <span className="inbox-chip">Bulk / automated</span>}
        </div>
      </div>

      <div className="inbox-actions">
        {msg.direction === "in" && (
          <button type="button" className="btn small" onClick={onReply}>
            Reply
          </button>
        )}
        {msg.direction === "in" &&
          (needsReply(msg) ? (
            <button
              type="button"
              className="btn small outline"
              onClick={() => patch({ done_at: new Date().toISOString() }, "Marked as no reply needed")}
            >
              No reply needed
            </button>
          ) : !msg.replied_at && !msg.answered ? (
            <button type="button" className="btn small outline" onClick={() => patch({ done_at: null }, "Back on Needs reply")}>
              Needs reply
            </button>
          ) : null)}
        {msg.direction === "in" && !isUnread(msg) && (
          <button type="button" className="btn small outline" onClick={() => patch({ read_at: null }, "Marked unread")}>
            Mark unread
          </button>
        )}
        {c === "unknown" && msg.direction === "in" && msg.from_email && (
          <button type="button" className="btn small outline" onClick={makeLead} disabled={saveLead.isPending}>
            + Make a lead
          </button>
        )}
        <select
          className="inbox-job"
          value={msg.job_id ?? ""}
          onChange={(e) =>
            patch(
              // A hand-picked (or cleared) link is never overwritten by auto-linking.
              { job_id: e.target.value || null, job_linked_by: "manual" },
              e.target.value ? "Linked to the shipment" : "Unlinked from the shipment",
            )
          }
          title="Shipment this email belongs to"
        >
          <option value="">Not linked to a shipment</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {jobLabel(j)}
            </option>
          ))}
        </select>
        {msg.job_id && (
          <button type="button" className="btn ghost small" onClick={() => navigate("/jobs", { state: { openJobId: msg.job_id } })}>
            Open shipment ›
          </button>
        )}
      </div>

      {thread.length > 0 && (
        <details className="inbox-thread">
          <summary>
            {thread.length} other message{thread.length === 1 ? "" : "s"} in this conversation
          </summary>
          {[...thread]
            .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
            .map((t) => (
              <div key={t.id} className="inbox-thread-item">
                <strong>{t.direction === "out" ? "ExPac" : t.from_name || t.from_email}</strong>
                <span className="muted"> · {formatDateTime(t.sent_at)}</span>
                <div className="muted">{t.snippet || t.subject}</div>
              </div>
            ))}
        </details>
      )}

      <div className="inbox-body">
        {parsedQ.isLoading ? (
          <Loading />
        ) : parsedQ.isError ? (
          <ErrorNote error={parsedQ.error} />
        ) : html ? (
          <iframe
            title="Message"
            className="inbox-frame"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={`<base target="_blank"><style>body{font-family:Aptos,Calibri,"Segoe UI",sans-serif;font-size:14px;color:#2e2e2e;margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style>${html}`}
          />
        ) : text ? (
          <pre className="inbox-text">{text}</pre>
        ) : (
          <p className="muted">{msg.raw_path ? "This message has no text." : "The message body wasn't stored (too large)."}</p>
        )}
      </div>

      {parsed && parsed.attachments.filter((a) => !a.inline).length > 0 && (
        <div className="inbox-attachments">
          {parsed.attachments
            .filter((a) => !a.inline)
            .map((a) => (
              <a key={a.url} href={a.url} download={a.name} className="inbox-attachment">
                📎 {a.name}
                <span className="muted"> {Math.max(1, Math.round(a.size / 1024))} KB</span>
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

function ComposeModal({ replyTo, onClose }: { replyTo?: InboxMessage; onClose: () => void }) {
  const { data: settings } = useCompanySettings();
  const update = useUpdateInboxMessage();
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const [to, setTo] = useState(replyTo?.from_email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo ? (/^re:/i.test(replyTo.subject ?? "") ? replyTo.subject ?? "" : `Re: ${replyTo.subject ?? ""}`) : "",
  );
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const list = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const toList = list(to);
    if (!toList.length) {
      error("Enter at least one recipient");
      return;
    }
    if (!body.trim()) {
      error("Write a message");
      return;
    }
    setSending(true);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bodyHtml = esc(body).replace(/\n/g, "<br>");
    const sig = settings?.mail_signature_html?.trim() ? `<br><br>${settings.mail_signature_html}` : "";
    const quoted = replyTo
      ? `<br><br><div style="border-left:3px solid #ccc;padding-left:10px;color:#555">On ${formatDateTime(
          replyTo.sent_at,
        )}, ${esc(replyTo.from_name || replyTo.from_email || "")} wrote:<br>${esc(replyTo.snippet ?? "").replace(/\n/g, "<br>")}…</div>`
      : "";
    const html = `${bodyHtml}${sig}${quoted}`;
    const references = replyTo
      ? [replyTo.refs ?? "", replyTo.message_id ?? ""].join(" ").trim()
      : undefined;
    try {
      await sendMail({
        to: toList,
        cc: list(cc),
        subject: subject || "(no subject)",
        html,
        text: body,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
        inReplyTo: replyTo?.message_id ?? undefined,
        references,
      });
      // Keep the sent message in the conversation (and on its shipment).
      await insertInboxMessage({
        direction: "out",
        mailbox: "support",
        from_email: "support@expac.co.za",
        from_name: settings?.mail_sender_name || "ExPac",
        to_emails: toList,
        cc_emails: list(cc),
        subject: subject || "(no subject)",
        snippet: body.replace(/\s+/g, " ").trim().slice(0, 180),
        body_text: body,
        body_html: html,
        in_reply_to: replyTo?.message_id ?? null,
        refs: references ?? null,
        thread_key: replyTo?.thread_key ?? null,
        job_id: replyTo?.job_id ?? null,
        job_linked_by: replyTo?.job_id ? replyTo.job_linked_by : null,
        sent_at: new Date().toISOString(),
        seen: true,
        answered: false,
      });
      if (replyTo) await update.mutateAsync({ id: replyTo.id, patch: { replied_at: new Date().toISOString() } });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      toast(replyTo ? "Reply sent" : "Email sent");
      onClose();
    } catch (err) {
      error(err instanceof Error ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={replyTo ? "Reply" : "New email"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="grid2">
          <div className="field">
            <label>To</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="field">
            <label>Cc</label>
            <input value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label>Message</label>
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <span className="hint">
            Sent from support@expac.co.za with your email signature
            {replyTo ? ", threaded under the original message" : ""}.
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
