// Sales CRM › Inbox (migration 0134): the support@expac.co.za mailbox,
// sorted by RELATIONSHIP from the CRM (not guessed), Customers, Leads,
// Suppliers & Agents, Other / Unknown, with Unread, Needs reply and Linked
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
  useAgents,
  useClearingAgents,
  useClients,
  useCompanySettings,
  useCreateOpportunity,
  useDestinationAgents,
  useSaveAgent,
  useSaveClearingAgent,
  useSaveDestinationAgent,
  useSaveSupplier,
  useSaveTransporter,
  useInbox,
  useLeads,
  useSentMail,
  useSuppliers,
  useTransporters,
  useInboxState,
  useJobs,
  useSaveLead,
  useSyncInbox,
  useUpdateInboxMessage,
} from "../../lib/hooks";
import { downloadInboxRaw, insertInboxMessage } from "../../lib/db";
import TaskEditModal from "../ops/TaskEditModal";
import RecipientInput, { type BookEntry } from "./RecipientInput";
import { sendMail } from "../../lib/mail";
import { formatDateTime } from "../../lib/format";
import type { InboxCategory, InboxMessage, Job, SentMail } from "../../lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Folder = "all" | InboxCategory | "spam" | "sent";
type View = "all" | "unread" | "needs" | "job";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "all", label: "All mail" },
  { key: "customer", label: "Customers" },
  { key: "lead", label: "Leads" },
  { key: "partner", label: "Suppliers & Agents" },
  { key: "unknown", label: "Other / Unknown" },
  { key: "internal", label: "Internal" },
  { key: "spam", label: "Spam" },
  { key: "sent", label: "Sent" },
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
  internal: "Internal (ExPac)",
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

// Mark unread in the app wins over "read in Outlook" (0136).
const isUnread = (m: InboxMessage) =>
  m.direction === "in" && (!!m.marked_unread || (!m.seen && !m.read_at));
const needsReply = (m: InboxMessage) =>
  m.direction === "in" &&
  !m.spam &&
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
/** Remote <img> src / srcset -> data-held-* (repeat: an img can carry both). */
function holdRemoteImages(html: string): string {
  let out = html;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/(<img\b[^>]*?\s)(src|srcset)=("|')(https?:[^"']*)\3/gi, "$1data-held-$2=$3$4$3");
    if (next === out) break;
    out = next;
  }
  return out;
}
const jobLabel = (j: Job) => `${j.reference}${j.client?.company ? ` · ${j.client.company}` : ""}`;

/** A parsed .eml (postal-mime), loaded when a message is opened. */
interface Parsed {
  html: string | null;
  /** The html as sent (cid: images untouched), what a forward carries. */
  rawHtml: string | null;
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
  const rawHtml = email.html ?? null;
  let html = rawHtml;
  if (html && cids.size) html = html.replace(/cid:([^"'\s)>]+)/gi, (m, id) => cids.get(id) ?? m);
  return { html, rawHtml, text: email.text ?? null, attachments };
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
  const [tasking, setTasking] = useState<InboxMessage | null>(null);
  const [compose, setCompose] = useState<{
    replyTo?: InboxMessage;
    forward?: { msg: InboxMessage; parsed?: Parsed };
  } | null>(null);
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
  const sentQ = useSentMail();
  const sent = useMemo(() => sentQ.data ?? [], [sentQ.data]);
  const [pickedSent, setOpenSent] = useState<SentMail | null>(null);

  // Address book: everyone mailed / heard from, plus CRM contacts.
  const clientsQ = useClients();
  const leadsQ = useLeads();
  const partnerLists = [useSuppliers(), useAgents(), useTransporters(), useClearingAgents(), useDestinationAgents()];
  const partnerData = partnerLists.map((p) => p.data);
  const book = useMemo<BookEntry[]>(() => {
    const map = new Map<string, BookEntry>();
    const add = (email: string | null | undefined, name?: string | null, org?: string | null) => {
      const e = (email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)/.test(e)) return;
      const had = map.get(e);
      map.set(e, { email: e, name: had?.name || name || null, org: had?.org || org || null });
    };
    for (const c of clientsQ.data ?? []) add(c.email, c.contact, c.company);
    for (const l of leadsQ.data ?? []) add(l.email, l.contact, l.company);
    for (const list of partnerData) for (const p of list ?? []) add(p.email, p.contact, p.company);
    for (const m of all) {
      if (m.direction === "in") add(m.from_email, m.from_name, m.record_name);
      for (const t of [...(m.to_emails ?? []), ...(m.cc_emails ?? [])]) add(t);
    }
    for (const s of sent) for (const t of [...s.to_emails, ...s.cc_emails]) add(t);
    return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsQ.data, leadsQ.data, all, sent, ...partnerData]);

  // Sync once when the inbox opens (the cron keeps it fresh after that).
  useEffect(() => {
    sync.mutate(undefined, { onError: () => undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const incoming = all.filter((m) => m.direction === "in");
  // Spam only shows in the Spam folder.
  const inFolder = (m: InboxMessage) =>
    folder === "spam" ? !!m.spam : !m.spam && (folder === "all" || cat(m) === folder);
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
  // Nothing picked yet: the reading pane shows the top message of the list
  // (not marked read until it's actually clicked).
  const open = openId === null ? rows[0] ?? null : all.find((m) => m.id === openId) ?? null;
  const sentRows = sent.filter(
    (s) =>
      !needle ||
      [s.subject, s.preview, s.job_reference, s.quote_reference, ...s.to_emails, ...s.cc_emails].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      ),
  );

  // Same for Sent: the newest sent email shows until one is picked.
  const openSent = pickedSent ?? sentRows[0] ?? null;

  const folderCount = (f: Folder) =>
    f === "spam"
      ? incoming.filter((m) => m.spam && isUnread(m)).length
      : incoming.filter((m) => !m.spam && (f === "all" || cat(m) === f) && isUnread(m)).length;
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
    if (isUnread(m))
      update.mutate({ id: m.id, patch: { read_at: new Date().toISOString(), marked_unread: false } });
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
        count={
          folder === "sent"
            ? `${sentRows.length} sent`
            : q.isLoading
              ? undefined
              : `${rows.length} message${rows.length === 1 ? "" : "s"}`
        }
        hint={`support@expac.co.za, sorted by who the sender is in the CRM. ${syncNote}`}
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
        <p className="hint">The inbox isn't connected yet, add the IMAP settings in Cloudflare.</p>
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
          {folder === "sent" ? (
            sentQ.isLoading ? (
              <Loading />
            ) : sentQ.isError ? (
              <ErrorNote error={sentQ.error} />
            ) : sentRows.length === 0 ? (
              <EmptyState>Nothing sent yet.</EmptyState>
            ) : (
              sentRows.map((s) => (
                <div
                  key={`${s.source}-${s.id}`}
                  role="button"
                  tabIndex={0}
                  className={`inbox-row${openSent?.id === s.id ? " on" : ""}`}
                  onClick={() => setOpenSent(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setOpenSent(s);
                  }}
                >
                  <div className="inbox-row-gutter">
                    <span className={`inbox-dot ${DELIVERY[deliveryKey(s.status)].dot}`} title={DELIVERY[deliveryKey(s.status)].label} />
                  </div>
                  <div className="inbox-row-main">
                    <div className="inbox-row-top">
                      <span className="inbox-from">To: {s.to_emails.join(", ") || "—"}</span>
                      <span className="inbox-date">{shortDate(s.sent_at)}</span>
                    </div>
                    <div className="inbox-subject">{s.subject || "(no subject)"}</div>
                    <div className="inbox-meta">
                      <DeliveryChip status={s.status} />
                      <span className="inbox-chip">{SOURCE_LABEL[s.source]}</span>
                      {s.job_reference && <span className="inbox-chip job">{s.job_reference}</span>}
                      {s.quote_reference && <span className="inbox-chip job">{s.quote_reference}</span>}
                      {s.preview && <span className="inbox-snippet">{s.preview}</span>}
                    </div>
                  </div>
                </div>
              ))
            )
          ) : q.isLoading ? (
            <Loading />
          ) : q.isError ? (
            <ErrorNote error={q.error} />
          ) : rows.length === 0 ? (
            <EmptyState>
              {all.length === 0 ? "No mail yet, it arrives with the next sync." : "Nothing here."}
            </EmptyState>
          ) : (
            rows.map((m) => (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                className={`inbox-row${m.id === open?.id ? " on" : ""}${isUnread(m) ? " unread" : ""}`}
                onClick={() => select(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(m);
                  }
                }}
              >
                <div className="inbox-row-gutter">
                  <span className={`inbox-dot cat-${cat(m)}`} title={CATEGORY_LABEL[cat(m)]} />
                  <button
                    type="button"
                    className="inbox-task-btn"
                    title="Create a task from this email"
                    aria-label="Create a task from this email"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTasking(m);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 9h18" />
                      <path d="M8 14l2.5 2.5L16 11" />
                    </svg>
                  </button>
                </div>
                <div className="inbox-row-main">
                <div className="inbox-row-top">
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
                </div>
              </div>
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
          {folder === "sent" ? (
            openSent ? (
              <SentReader key={`${openSent.source}-${openSent.id}`} mail={openSent} />
            ) : (
              <EmptyState>Pick a sent email to see it and whether it was delivered.</EmptyState>
            )
          ) : open ? (
            <Reader
              key={open.id}
              msg={open}
              thread={all.filter((m) => open.thread_key && m.thread_key === open.thread_key && m.id !== open.id)}
              jobs={jobs}
              onReply={() => setCompose({ replyTo: open })}
              onForward={(parsed) => setCompose({ forward: { msg: open, parsed } })}
            />
          ) : (
            <EmptyState>Pick a message.</EmptyState>
          )}
        </div>
      </div>

      {tasking && (
        <TaskEditModal
          key={tasking.id}
          task={null}
          defaults={{
            title: `Email: ${tasking.subject || "(no subject)"}`,
            body: [
              `From ${tasking.from_name ? `${tasking.from_name} <${tasking.from_email ?? ""}>` : tasking.from_email ?? ""}, ${formatDateTime(tasking.sent_at)}`,
              tasking.snippet ?? "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            job_id: tasking.job_id,
            client_id: tasking.record_kind === "client" ? tasking.record_id : null,
            lead_id: tasking.record_kind === "lead" ? tasking.record_id : null,
            supplier_id: tasking.record_kind === "supplier" ? tasking.record_id : null,
          }}
          onClose={() => setTasking(null)}
        />
      )}
      {compose && (
        <ComposeModal
          replyTo={compose.replyTo}
          forward={compose.forward}
          book={book}
          onClose={() => setCompose(null)}
        />
      )}
    </>
  );
}

/** Delivery status (Resend events via /api/mail-webhook) as shown on Sent. */
const DELIVERY = {
  delivered: { label: "Delivered", dot: "cat-customer", chip: "cat-customer" },
  opened: { label: "Opened", dot: "cat-customer", chip: "cat-customer" },
  bounced: { label: "Bounced, not delivered", dot: "cat-bounced", chip: "needs" },
  sending: { label: "Sent, awaiting delivery", dot: "cat-unknown", chip: "" },
  saved: { label: "Sent (no delivery tracking)", dot: "cat-unknown", chip: "" },
} as const;
type DeliveryKey = keyof typeof DELIVERY;
function deliveryKey(status: string): DeliveryKey {
  const st = (status || "").toLowerCase();
  if (st === "delivered") return "delivered";
  if (st === "opened" || st === "clicked") return "opened";
  if (st === "bounced" || st === "failed" || st === "complained") return "bounced";
  if (st === "saved") return "saved";
  return "sending";
}
function DeliveryChip({ status }: { status: string }) {
  const d = DELIVERY[deliveryKey(status)];
  return <span className={`inbox-chip ${d.chip}`}>{d.label}</span>;
}
const SOURCE_LABEL: Record<SentMail["source"], string> = {
  inbox: "Inbox",
  shipment: "Shipment Comms",
  quote: "Quotation",
};

function SentReader({ mail }: { mail: SentMail }) {
  const navigate = useNavigate();
  return (
    <div className="inbox-read">
      <div className="inbox-read-head">
        <h3>{mail.subject || "(no subject)"}</h3>
        <div className="inbox-read-from">
          <strong>To: {mail.to_emails.join(", ") || "—"}</strong>
          <span className="muted"> · {formatDateTime(mail.sent_at)}</span>
        </div>
        {mail.cc_emails.length > 0 && (
          <div className="muted" style={{ fontSize: "0.78rem" }}>
            Cc: {mail.cc_emails.join(", ")}
          </div>
        )}
        <div className="inbox-read-tags">
          <DeliveryChip status={mail.status} />
          <span className="inbox-chip">{SOURCE_LABEL[mail.source]}</span>
          {mail.job_id && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => navigate("/jobs", { state: { openJobId: mail.job_id } })}
            >
              Open shipment {mail.job_reference} ›
            </button>
          )}
          {mail.quote_id && (
            <button type="button" className="btn ghost small" onClick={() => navigate(`/quotes/${mail.quote_id}`)}>
              Open quotation {mail.quote_reference} ›
            </button>
          )}
        </div>
        {mail.error && <p className="hint" style={{ color: "var(--orange-ink)" }}>{mail.error}</p>}
      </div>
      <div className="inbox-body" style={{ marginTop: 12 }}>
        {mail.body ? (
          <iframe
            title="Sent message"
            className="inbox-frame"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={`<base target="_blank"><style>body{font-family:Aptos,Calibri,"Segoe UI",sans-serif;font-size:14px;color:#2e2e2e;margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style>${
              /<[a-z][\s\S]*>/i.test(mail.body) ? mail.body : mail.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")
            }`}
          />
        ) : (
          <p className="muted">{mail.preview || "No body stored."}</p>
        )}
      </div>
    </div>
  );
}

function Reader({
  msg,
  thread,
  jobs,
  onReply,
  onForward,
}: {
  msg: InboxMessage;
  thread: InboxMessage[];
  jobs: Job[];
  onReply: () => void;
  onForward: (parsed: Parsed | undefined) => void;
}) {
  const update = useUpdateInboxMessage();
  const saveLead = useSaveLead();
  const createOpportunity = useCreateOpportunity();
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
  // Remote images: shown for known senders; held back on Unknown / Spam mail
  // (tracking pixels, spam) until "Show images".
  const [showImages, setShowImages] = useState(false);
  const [addingAs, setAddingAs] = useState(false);

  // First open: keep a snippet + text so search and shipment linking can use it.
  useEffect(() => {
    if (!parsed || msg.snippet) return;
    const text = (parsed.text ?? (parsed.html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) return;
    update.mutate({ id: msg.id, patch: { snippet: text.slice(0, 180), body_text: text.slice(0, 20000) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, msg.id]);

  const holdImages = (cat(msg) === "unknown" || msg.spam) && !showImages;
  const rawBody = parsed?.html ?? msg.body_html;
  const html = rawBody && holdImages ? holdRemoteImages(rawBody) : rawBody;
  const imagesHeld = !!rawBody && holdImages && /<img\b[^>]*\ssrc=("|')https?:/i.test(rawBody);
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
  /** The sender as a new lead (Other / Unknown). Returns the lead's id. */
  async function createLeadFromSender(): Promise<{ id: string; company: string }> {
    const email = msg.from_email ?? "";
    const domain = email.split("@")[1] ?? "";
    const company = msg.from_name && !msg.from_name.includes("@") ? msg.from_name : domain || email;
    const lead = await saveLead.mutateAsync({
      patch: { company, contact: msg.from_name || null, email, source: "Email" },
    });
    return { id: lead.id, company };
  }
  async function makeLead() {
    try {
      const { company } = await createLeadFromSender();
      qc.invalidateQueries({ queryKey: ["inbox"] });
      toast(`${company} added as a lead`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not create the lead");
    }
  }
  /** The Quote Builder, started on the customer / lead this email is from
   *  (an unknown sender becomes a lead first). */
  async function createQuotation() {
    try {
      let leadId = msg.record_kind === "lead" ? msg.record_id : null;
      const clientId = msg.record_kind === "client" ? msg.record_id : null;
      if (!leadId && !clientId) leadId = (await createLeadFromSender()).id;
      navigate("/quotes/new", { state: { prefill: clientId ? { clientId } : { leadId } } });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not start the quotation");
    }
  }
  /** A pipeline opportunity from this email, on the customer or lead it
   *  came from (an unknown sender becomes a lead first). */
  async function addOpportunity() {
    try {
      let leadId = msg.record_kind === "lead" ? msg.record_id : null;
      const clientId = msg.record_kind === "client" ? msg.record_id : null;
      let who = msg.record_name ?? "";
      if (!leadId && !clientId) {
        const lead = await createLeadFromSender();
        leadId = lead.id;
        who = lead.company;
      }
      const note = (msg.snippet ?? "").trim();
      await createOpportunity.mutateAsync({
        title: msg.subject || "Email enquiry",
        lead_id: leadId,
        client_id: clientId,
        status: "new_lead",
        value: 0,
        notes: `From the inbox (${formatDateTime(msg.sent_at)}, ${msg.from_email ?? ""})${note ? `: ${note}` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      toast(`Opportunity added for ${who || "the sender"}, see Sales CRM › Opportunities`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add the opportunity");
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
        <button
          type="button"
          className="btn small outline"
          onClick={() => onForward(parsed)}
          disabled={!!msg.raw_path && parsedQ.isLoading}
          title="Forward this email, with its attachments"
        >
          Forward
        </button>
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
          <button
            type="button"
            className="btn small outline"
            onClick={() => patch({ read_at: null, marked_unread: true }, "Marked unread")}
          >
            Mark unread
          </button>
        )}
        {msg.direction === "in" &&
          (msg.spam ? (
            <button type="button" className="btn small outline" onClick={() => patch({ spam: false }, "Moved to the inbox")}>
              Not spam
            </button>
          ) : (
            <button
              type="button"
              className="btn small outline warn"
              onClick={() => patch({ spam: true }, "Moved to Spam")}
            >
              Spam
            </button>
          ))}
        {c === "unknown" && msg.direction === "in" && msg.from_email && (
          <button
            type="button"
            className="btn small outline"
            onClick={() => setAddingAs(true)}
            title="Add the sender as a shipper, agent, transporter, clearing or destination agent"
          >
            + Add as…
          </button>
        )}
        {c === "unknown" && msg.direction === "in" && msg.from_email && (
          <button type="button" className="btn small outline" onClick={makeLead} disabled={saveLead.isPending}>
            + Make a lead
          </button>
        )}
        {msg.direction === "in" && msg.from_email && (c === "unknown" || c === "lead" || c === "customer") && (
          <button
            type="button"
            className="btn small outline"
            onClick={createQuotation}
            disabled={saveLead.isPending}
            title={
              c === "unknown"
                ? "Makes the sender a lead, then opens the Quote Builder for them"
                : "Opens the Quote Builder for this customer / lead"
            }
          >
            Create quotation
          </button>
        )}
        {msg.direction === "in" && msg.from_email && (c === "unknown" || c === "lead" || c === "customer") && (
          <button
            type="button"
            className="btn small outline"
            onClick={addOpportunity}
            disabled={createOpportunity.isPending || saveLead.isPending}
            title={c === "unknown" ? "Makes the sender a lead, then adds the opportunity" : undefined}
          >
            + Add opportunity
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

      {imagesHeld && (
        <div className="inbox-images-bar">
          Images from this unknown sender are hidden.
          <button type="button" className="btn small outline" onClick={() => setShowImages(true)}>
            Show images
          </button>
        </div>
      )}
      {addingAs && (
        <AddPartnerModal msg={msg} text={parsed?.text ?? msg.body_text ?? ""} onClose={() => setAddingAs(false)} />
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

type PartnerType = "supplier" | "agent" | "transporter" | "clearing_agent" | "destination_agent";
const PARTNER_TYPES: { key: PartnerType; label: string }[] = [
  { key: "supplier", label: "Shipper" },
  { key: "agent", label: "Agent" },
  { key: "transporter", label: "Transporter" },
  { key: "clearing_agent", label: "Clearing Agent" },
  { key: "destination_agent", label: "Destination Agent" },
];
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|aol|proton|protonmail|mweb|telkomsa|webmail|vodamail|iafrica|qq|163|126|gmx|zoho|yandex)\./i;

/** "Add as…": the sender as one or more supplier / partner records, filled
 *  from the email (company from the domain, contact, email, a phone number
 *  found in the message), all editable before saving. */
function AddPartnerModal({ msg, text, onClose }: { msg: InboxMessage; text: string; onClose: () => void }) {
  const saves: Record<PartnerType, ReturnType<typeof useSaveAgent>> = {
    supplier: useSaveSupplier() as unknown as ReturnType<typeof useSaveAgent>,
    agent: useSaveAgent(),
    transporter: useSaveTransporter() as unknown as ReturnType<typeof useSaveAgent>,
    clearing_agent: useSaveClearingAgent() as unknown as ReturnType<typeof useSaveAgent>,
    destination_agent: useSaveDestinationAgent() as unknown as ReturnType<typeof useSaveAgent>,
  };
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const email = (msg.from_email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const fromDomain = domain && !FREE_MAIL.test(domain)
    ? domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
    : "";
  // A phone number from the signature (prefer lines that say tel / cell / contact).
  const phone = (() => {
    const lines = text.split(/\n/);
    const rx = /(\+?\d[\d ()-]{7,}\d)/;
    const labelled = lines.find((l) => /(tel|phone|cell|mobile|mob|contact|whatsapp)/i.test(l) && rx.test(l));
    return ((labelled ?? lines.find((l) => rx.test(l)) ?? "").match(rx)?.[1] ?? "").trim();
  })();
  const [company, setCompany] = useState(fromDomain || msg.from_name || "");
  const [contact, setContact] = useState(msg.from_name && msg.from_name !== company ? msg.from_name : "");
  const [mail, setMail] = useState(email);
  const [tel, setTel] = useState(phone);
  const [address, setAddress] = useState("");
  const [types, setTypes] = useState<PartnerType[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!company.trim()) {
      error("Enter the company name");
      return;
    }
    if (types.length === 0) {
      error("Tick at least one: shipper, agent, transporter, clearing or destination agent");
      return;
    }
    setSaving(true);
    try {
      for (const t of types) {
        await saves[t].mutateAsync({
          values: {
            company: company.trim(),
            contact: contact.trim() || null,
            email: mail.trim() || null,
            phone: tel.trim() || null,
            address: address.trim() || null,
          },
        });
      }
      qc.invalidateQueries({ queryKey: ["inbox"] });
      toast(
        `${company.trim()} added as ${types
          .map((t) => PARTNER_TYPES.find((p) => p.key === t)?.label)
          .join(" and ")}, this email now sits under Suppliers & Agents`,
      );
      onClose();
    } catch (err) {
      error(err instanceof Error ? err.message : "Could not add the record");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add the sender as…" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Type (tick all that apply)</label>
          <div className="chips">
            {PARTNER_TYPES.map((p) => {
              const on = types.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  onClick={() => setTypes(on ? types.filter((x) => x !== p.key) : [...types, p.key])}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Company name</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="field">
            <label>Contact person</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={mail} onChange={(e) => setMail(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={tel} onChange={(e) => setTel(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Address</label>
          <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <span className="hint">Filled from the email, check and correct before saving. Coverage can be added on the record.</span>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Blob URL -> base64 (no data: prefix), for re-attaching on a forward. */
async function blobUrlBase64(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const FORWARD_ATTACH_LIMIT = 14 * 1024 * 1024;

function ComposeModal({
  replyTo,
  forward,
  book,
  onClose,
}: {
  replyTo?: InboxMessage;
  forward?: { msg: InboxMessage; parsed?: Parsed };
  book: BookEntry[];
  onClose: () => void;
}) {
  const fwd = forward?.msg;
  const fwdFiles = forward?.parsed?.attachments ?? [];
  const [keepFiles, setKeepFiles] = useState<string[]>(() => fwdFiles.map((a) => a.url));
  const { data: settings } = useCompanySettings();
  const update = useUpdateInboxMessage();
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const [to, setTo] = useState(replyTo?.from_email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo
      ? /^re:/i.test(replyTo.subject ?? "")
        ? replyTo.subject ?? ""
        : `Re: ${replyTo.subject ?? ""}`
      : fwd
        ? /^(fw|fwd):/i.test(fwd.subject ?? "")
          ? fwd.subject ?? ""
          : `Fwd: ${fwd.subject ?? ""}`
        : "",
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
    if (!body.trim() && !fwd) {
      error("Write a message");
      return;
    }
    const picked = fwdFiles.filter((a) => keepFiles.includes(a.url));
    if (picked.reduce((n, a) => n + a.size, 0) > FORWARD_ATTACH_LIMIT) {
      error("The attachments are too large to forward together (max about 14 MB), untick some");
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
    const forwarded = fwd
      ? `<br><br>---------- Forwarded message ----------<br>From: ${esc(fwd.from_name || "")} &lt;${esc(
          fwd.from_email || "",
        )}&gt;<br>Date: ${formatDateTime(fwd.sent_at)}<br>Subject: ${esc(fwd.subject || "")}<br>To: ${esc(
          fwd.to_emails.join(", "),
        )}${fwd.cc_emails.length ? `<br>Cc: ${esc(fwd.cc_emails.join(", "))}` : ""}<br><br>${
          (forward?.parsed?.rawHtml ?? fwd.body_html ?? "").replace(/<script[\s\S]*?<\/script>/gi, "") ||
          esc(forward?.parsed?.text ?? fwd.body_text ?? fwd.snippet ?? "").replace(/\n/g, "<br>")
        }`
      : "";
    const html = `${bodyHtml}${sig}${quoted}${forwarded}`;
    const references = replyTo
      ? [replyTo.refs ?? "", replyTo.message_id ?? ""].join(" ").trim()
      : undefined;
    try {
      const sentRes = await sendMail({
        to: toList,
        cc: list(cc),
        subject: subject || "(no subject)",
        html,
        text: body,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
        inReplyTo: replyTo?.message_id ?? undefined,
        references,
        attachments: picked.length
          ? await Promise.all(picked.map(async (a) => ({ filename: a.name, content: await blobUrlBase64(a.url) })))
          : undefined,
      });
      // Keep the sent message in the conversation (and on its shipment).
      await insertInboxMessage({
        direction: "out",
        mailbox: "support",
        provider_id: sentRes.id,
        delivery_status: "sent",
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
        // A forward stays with the original's conversation and shipment.
        thread_key: (replyTo ?? fwd)?.thread_key ?? null,
        job_id: (replyTo ?? fwd)?.job_id ?? null,
        job_linked_by: (replyTo ?? fwd)?.job_id ? (replyTo ?? fwd)?.job_linked_by ?? null : null,
        has_attachments: picked.length > 0,
        sent_at: new Date().toISOString(),
        seen: true,
        answered: false,
      });
      if (replyTo) await update.mutateAsync({ id: replyTo.id, patch: { replied_at: new Date().toISOString() } });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox_sent"] });
      toast(replyTo ? "Reply sent" : fwd ? "Email forwarded" : "Email sent");
      onClose();
    } catch (err) {
      error(err instanceof Error ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={replyTo ? "Reply" : fwd ? "Forward" : "New email"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="grid2">
          <div className="field">
            <label>To</label>
            <RecipientInput
              value={to}
              onChange={setTo}
              book={book}
              placeholder="Start typing a name or email"
              autoFocus={!replyTo}
            />
          </div>
          <div className="field">
            <label>Cc</label>
            <RecipientInput value={cc} onChange={setCc} book={book} />
          </div>
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label>Message</label>
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!replyTo} />
          <span className="hint">
            Sent from support@expac.co.za with your email signature
            {replyTo ? ", threaded under the original message" : ""}
            {fwd ? ", followed by the original message" : ""}.
          </span>
        </div>
        {fwd && fwdFiles.length > 0 && (
          <div className="field">
            <label>Attachments to forward</label>
            <div className="inbox-attachments" style={{ marginTop: 0 }}>
              {fwdFiles.map((a) => (
                <label key={a.url} className="inbox-attachment" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={keepFiles.includes(a.url)}
                    onChange={() =>
                      setKeepFiles((k) => (k.includes(a.url) ? k.filter((u) => u !== a.url) : [...k, a.url]))
                    }
                  />{" "}
                  {a.name}
                  <span className="muted"> {Math.max(1, Math.round(a.size / 1024))} KB</span>
                </label>
              ))}
            </div>
          </div>
        )}
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
