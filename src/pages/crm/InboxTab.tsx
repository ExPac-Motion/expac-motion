// Sales CRM › Inbox (migration 0134): the support@expac.co.za mailbox,
// sorted by RELATIONSHIP from the CRM (not guessed), Customers, Leads,
// Suppliers & Agents, Other / Unknown, with Unread, Needs reply and Linked
// to a shipment views across them. /api/inbox-sync copies new mail in every
// 5 minutes (and on Sync now); a message's raw .eml is parsed here when it's
// opened. Replies go out through /api/send-mail, threaded under the original.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  useUploadMailAsset,
  useUpdateInboxMessages,
  useInboxDrafts,
  useInboxSearch,
  useMailTemplates,
  useSaveMailTemplate,
} from "../../lib/hooks";
import {
  deleteInboxDraft,
  downloadInboxRaw,
  insertInboxMessage,
  removeInboxDraftFiles,
  saveInboxDraft,
  uploadInboxDraftFile,
} from "../../lib/db";
import TaskEditModal from "../ops/TaskEditModal";
import RecipientInput, { type BookEntry } from "./RecipientInput";
import RichTextEditor from "../../components/RichTextEditor";
import { sendMail } from "../../lib/mail";
import { htmlToText, resolveMergeFields, type MergeContext } from "../../lib/mailMerge";
import { linkifyHtml } from "../../lib/mailStyle";
import { alertsOn, alertsSupported, setAlerts } from "../../lib/inboxAlerts";
import { formatDateTime } from "../../lib/format";
import type {
  InboxCategory,
  InboxDraft,
  InboxDraftFile,
  InboxMessage,
  InboxMessagePatch,
  Job,
  SentMail,
} from "../../lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Folder = "all" | InboxCategory | "spam" | "sent" | "drafts" | "snoozed" | "archive" | "trash";
type View = "all" | "unread" | "needs" | "flagged" | "job";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "all", label: "All mail" },
  { key: "customer", label: "Customers" },
  { key: "lead", label: "Leads" },
  { key: "partner", label: "Suppliers & Agents" },
  { key: "unknown", label: "Other / Unknown" },
  { key: "internal", label: "Internal" },
  { key: "snoozed", label: "Snoozed" },
  { key: "archive", label: "Archive" },
  { key: "spam", label: "Spam" },
  { key: "drafts", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "trash", label: "Trash" },
];
/** Folders that need migration 0182 (archive / trash / flag / snooze). */
const ORGANISE_FOLDERS: Folder[] = ["snoozed", "archive", "trash"];
const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "unread", label: "Unread" },
  { key: "needs", label: "Needs reply" },
  { key: "flagged", label: "Flagged" },
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

/** Snoozed and not due back yet (0182). */
const isSnoozed = (m: InboxMessage) => !!m.snoozed_until && new Date(m.snoozed_until).getTime() > Date.now();
/** Back from a snooze: it counts from its snooze date, and is unread again. */
const backFromSnooze = (m: InboxMessage) =>
  !!m.snoozed_until && !isSnoozed(m) && (!m.read_at || m.read_at < m.snoozed_until);
// Mark unread in the app wins over "read in Outlook" (0136).
const isUnread = (m: InboxMessage) =>
  m.direction === "in" && (!!m.marked_unread || (!m.seen && !m.read_at) || backFromSnooze(m));
/** Where a message sorts in the list: its arrival, or when it came back from a snooze. */
const listDate = (m: InboxMessage) => (m.snoozed_until && !isSnoozed(m) ? m.snoozed_until : m.sent_at);

/** Snooze choices: later today, tomorrow and next Monday morning. */
function snoozeChoices(): { label: string; at: Date }[] {
  const now = new Date();
  const at = (days: number, h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const out: { label: string; at: Date }[] = [];
  if (now.getHours() < 16) out.push({ label: "Later today (17:00)", at: at(0, 17) });
  out.push({ label: "Tomorrow morning (08:00)", at: at(1, 8) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  out.push({ label: "Next week (Monday 08:00)", at: at(toMonday, 8) });
  return out;
}
/** Newest mail we sent per conversation (Motion or Outlook's Sent folder). */
type LastOut = Map<string, string>;
function lastOutByThread(all: InboxMessage[]): LastOut {
  const map: LastOut = new Map();
  for (const m of all)
    if (m.direction === "out" && m.thread_key && (map.get(m.thread_key) ?? "") < m.sent_at) map.set(m.thread_key, m.sent_at);
  return map;
}
/** An incoming email still waiting on us: not answered here or in Outlook,
 *  and nothing sent in its conversation since it arrived. */
const needsReply = (m: InboxMessage, lastOut?: LastOut) =>
  m.direction === "in" &&
  !m.spam &&
  // Archived or deleted: dealt with.
  !m.archived_at &&
  !m.deleted_at &&
  !m.answered &&
  !m.replied_at &&
  !m.done_at &&
  !(m.thread_key && (lastOut?.get(m.thread_key) ?? "") > m.sent_at) &&
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
  const qc = useQueryClient();
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
  const [compose, setCompose] = useState<ComposeState | null>(null);
  // Double-click a message: the reading pane takes the whole width.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded || compose || tasking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, compose, tasking]);
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

  // The list holds the newest mail; a search (3+ letters) also looks through
  // the whole history on the server and adds what it finds.
  const recent = useMemo(() => q.data ?? [], [q.data]);
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearchTerm(search.trim()), 400);
    return () => window.clearTimeout(t);
  }, [search]);
  const foundQ = useInboxSearch(searchTerm);
  const found = useMemo(() => new Set((foundQ.data ?? []).map((m) => m.id)), [foundQ.data]);
  const all = useMemo(() => {
    const extra = (foundQ.data ?? []).filter((m) => !recent.some((r) => r.id === m.id));
    return extra.length ? [...recent, ...extra] : recent;
  }, [recent, foundQ.data]);
  const lastOut = useMemo(() => lastOutByThread(all), [all]);
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
  const needle = search.trim().toLowerCase();
  // Organise (0182) is on once the list carries its columns.
  const organiseOn = recent.length === 0 || "flagged" in recent[0];
  // Trash, Spam, Snoozed and Archive each keep their mail out of the other
  // folders; a search still finds archived mail.
  const inFolder = (m: InboxMessage) => {
    if (folder === "trash") return !!m.deleted_at;
    if (m.deleted_at) return false;
    if (folder === "spam") return !!m.spam;
    if (m.spam) return false;
    if (folder === "snoozed") return isSnoozed(m);
    if (isSnoozed(m)) return false;
    if (folder === "archive") return !!m.archived_at;
    if (m.archived_at && !needle) return false;
    return folder === "all" || cat(m) === folder;
  };
  const inView = (m: InboxMessage) =>
    view === "unread"
      ? isUnread(m)
      : view === "needs"
        ? needsReply(m, lastOut)
        : view === "flagged"
          ? !!m.flagged
          : view === "job"
            ? !!m.job_id && (!jobFilter || m.job_id === jobFilter)
            : true;
  const rows = (view === "job" ? all : incoming)
    .filter(
      (m) =>
        inFolder(m) &&
        inView(m) &&
        (!needle ||
          found.has(m.id) ||
          [m.subject, m.from_name, m.from_email, m.snippet, m.record_name, m.job_reference, ...(m.to_emails ?? [])]
            .some((v) => (v ?? "").toLowerCase().includes(needle))),
    )
    // Back from a snooze: sorts as if it arrived then.
    .sort((a, b) => listDate(b).localeCompare(listDate(a)));
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

  // Drafts (0180): until the migration is run the query fails, and the
  // folder and autosave stay off.
  const draftsQ = useInboxDrafts();
  const draftsOn = draftsQ.isSuccess;
  const drafts = useMemo(() => draftsQ.data ?? [], [draftsQ.data]);
  const draftRows = drafts.filter(
    (d) => !needle || [d.subject, d.to_emails, d.cc_emails, htmlToText(d.body_html)].some((v) => v.toLowerCase().includes(needle)),
  );
  /** A draft reopens in compose, with the email it answers or forwards. */
  function openDraft(d: InboxDraft) {
    const replyTo = d.reply_to_id ? all.find((m) => m.id === d.reply_to_id) : undefined;
    const forward = d.forward_id ? all.find((m) => m.id === d.forward_id) : undefined;
    setCompose({ draft: d, replyTo, replyAll: d.reply_all, forward });
  }
  const folders = FOLDERS.filter(
    (f) => (f.key !== "drafts" || draftsOn) && (organiseOn || !ORGANISE_FOLDERS.includes(f.key)),
  );

  // In the main folders: not deleted, spam, snoozed or archived.
  const live = (m: InboxMessage) => !m.deleted_at && !m.spam && !isSnoozed(m) && !m.archived_at;
  const folderCount = (f: Folder) =>
    f === "drafts"
      ? drafts.length
      : f === "snoozed"
        ? incoming.filter((m) => !m.deleted_at && isSnoozed(m)).length
        : f === "archive" || f === "trash"
          ? 0
          : f === "spam"
            ? incoming.filter((m) => m.spam && !m.deleted_at && isUnread(m)).length
            : incoming.filter((m) => live(m) && (f === "all" || cat(m) === f) && isUnread(m)).length;
  const viewCount = (v: View) =>
    v === "unread"
      ? incoming.filter((m) => inFolder(m) && isUnread(m)).length
      : v === "needs"
        ? incoming.filter((m) => inFolder(m) && needsReply(m, lastOut)).length
        : v === "flagged"
          ? incoming.filter((m) => inFolder(m) && m.flagged).length
          : v === "job"
            ? all.filter((m) => inFolder(m) && m.job_id).length
            : 0;

  /* ---------- Organise (0182): archive, delete, flag, snooze, in bulk too ---------- */
  const updateMany = useUpdateInboxMessages();
  // Ticked emails (cleared when the folder or view changes).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleChecked = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /** Apply a change; when it moves the open email out of view, open the next one. */
  function organise(ids: string[], patch: InboxMessagePatch, done: string, leaves = true) {
    if (!ids.length) return;
    if (leaves && open && ids.includes(open.id)) {
      const at = rows.findIndex((m) => m.id === open.id);
      const next = rows.slice(at + 1).find((m) => !ids.includes(m.id)) ?? rows.slice(0, at).reverse().find((m) => !ids.includes(m.id));
      setOpenId(next?.id ?? null);
    }
    updateMany.mutate(
      { ids, patch },
      {
        onSuccess: () => toast(done),
        onError: (e) => error(e instanceof Error ? e.message : "Could not update the email"),
      },
    );
    setChecked(new Set());
  }
  const now = () => new Date().toISOString();
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const actions = {
    archive: (ids: string[]) => organise(ids, { archived_at: now(), snoozed_until: null }, `${plural(ids.length, "email")} archived`),
    unarchive: (ids: string[]) => organise(ids, { archived_at: null }, `${plural(ids.length, "email")} moved back to the inbox`),
    remove: (ids: string[]) => organise(ids, { deleted_at: now() }, `${plural(ids.length, "email")} moved to Trash`),
    restore: (ids: string[]) => organise(ids, { deleted_at: null }, `${plural(ids.length, "email")} restored`),
    flag: (ids: string[], on: boolean) =>
      organise(ids, { flagged: on }, on ? `${plural(ids.length, "email")} flagged` : "Flag removed", view === "flagged" && !on),
    read: (ids: string[], on: boolean) =>
      organise(
        ids,
        on ? { read_at: now(), marked_unread: false } : { read_at: null, marked_unread: true },
        on ? "Marked read" : "Marked unread",
        false,
      ),
    snooze: (ids: string[], until: Date | null) =>
      organise(
        ids,
        until ? { snoozed_until: until.toISOString(), archived_at: null } : { snoozed_until: null },
        until ? `Snoozed until ${formatDateTime(until.toISOString())}` : "Back in the inbox",
      ),
  };
  const linkedJobs = jobs.filter((j) => all.some((m) => m.job_id === j.id));

  function select(m: InboxMessage) {
    setOpenId(m.id);
    if (isUnread(m))
      update.mutate({ id: m.id, patch: { read_at: new Date().toISOString(), marked_unread: false } });
  }
  /** Reply (or reply all); a reply already started carries on from its draft. */
  function startReply(m: InboxMessage, parsed: Parsed | undefined, replyAll: boolean) {
    const d = drafts.find((x) => x.reply_to_id === m.id);
    if (d) openDraft(d);
    else setCompose({ replyTo: m, replyAll, parsed });
  }

  /* ---------- Desktop alerts (switched on per browser) ---------- */
  const [alerts, setAlertsState] = useState(alertsOn);
  async function toggleAlerts() {
    const r = await setAlerts(!alerts);
    if (r === "blocked") {
      error("Your browser is blocking notifications for this site. Allow them in the site settings (the icon left of the address), then try again.");
      setAlertsState(false);
      return;
    }
    setAlertsState(r);
    toast(r ? "Desktop alerts on: you'll get a pop-up when new mail arrives" : "Desktop alerts off");
  }

  /* ---------- Keyboard shortcuts ---------- */
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || compose || tasking || showKeys) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".modal")) return;
      const k = e.key;
      if (k === "?") return void (e.preventDefault(), setShowKeys(true));
      if (k === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        return;
      }
      if (k === "c" || k === "n") return void (e.preventDefault(), setCompose({}));
      if (folder === "sent" || folder === "drafts") return;
      const at = open ? rows.findIndex((m) => m.id === open.id) : -1;
      const go = (i: number) => {
        const m = rows[Math.max(0, Math.min(rows.length - 1, i))];
        if (m) select(m);
      };
      if (k === "j" || k === "ArrowDown") return void (e.preventDefault(), go(at + 1));
      if (k === "k" || k === "ArrowUp") return void (e.preventDefault(), go(at - 1));
      if (!open) return;
      const parsed = open.raw_path ? qc.getQueryData<Parsed>(["inbox_raw", open.raw_path]) : undefined;
      const ids = checked.size ? [...checked] : [open.id];
      switch (k) {
        case "Enter":
          e.preventDefault();
          setExpanded(true);
          return;
        case "r":
          if (open.direction === "in") startReply(open, parsed, false);
          return;
        case "a":
          if (open.direction === "in") startReply(open, parsed, true);
          return;
        case "f":
          setCompose({ forward: open, parsed });
          return;
      }
      if (!organiseOn) return;
      switch (k) {
        case "e":
          if (folder === "archive") actions.unarchive(ids);
          else actions.archive(ids);
          return;
        case "#":
        case "Delete":
          if (folder === "trash") actions.restore(ids);
          else actions.remove(ids);
          return;
        case "s":
          actions.flag(ids, !open.flagged);
          return;
        case "u":
          actions.read(ids, false);
          return;
        case "x":
          toggleChecked(open.id);
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Keep the open email in sight when moving with the keys.
  useEffect(() => {
    document.querySelector(".inbox-list .inbox-row.on")?.scrollIntoView({ block: "nearest" });
  }, [open?.id]);

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
            : folder === "drafts"
              ? `${draftRows.length} draft${draftRows.length === 1 ? "" : "s"}`
              : q.isLoading
              ? undefined
              : `${rows.length} message${rows.length === 1 ? "" : "s"}`
        }
        hint={
          searchTerm.length >= 3
            ? foundQ.isFetching
              ? "Searching the whole mail history…"
              : `Searched the whole mail history (sender, subject and the text of opened emails). ${syncNote}`
            : `support@expac.co.za, sorted by who the sender is in the CRM. ${syncNote}${
                st?.pending ? ` · Older mail still coming in (${st.pending} to go)` : ""
              }`
        }
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

      <div
        className={`panel inbox${expanded ? " expanded" : ""}`}
        style={{ "--inbox-list": `${listWidth}px` } as React.CSSProperties}
      >
        <nav className="inbox-nav">
          <div className="inbox-nav-head">Folders</div>
          {folders.map((f) => {
            const n = folderCount(f.key);
            return (
              <button
                key={f.key}
                type="button"
                className={`inbox-nav-item${folder === f.key ? " on" : ""}`}
                onClick={() => {
                  setFolder(f.key);
                  setChecked(new Set());
                }}
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
                onClick={() => {
                  setView(v.key);
                  setChecked(new Set());
                }}
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
          <div className="inbox-nav-foot">
            {alertsSupported() && (
              <button
                type="button"
                className={`inbox-nav-item${alerts ? " on" : ""}`}
                onClick={() => void toggleAlerts()}
                title="A pop-up from your browser when new mail arrives, on any Motion page"
              >
                {alerts ? "🔔 Desktop alerts on" : "🔕 Desktop alerts off"}
              </button>
            )}
            <button type="button" className="inbox-nav-item" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)">
              ⌨ Keyboard shortcuts
            </button>
          </div>
        </nav>

        <div className="inbox-list">
          {folder === "drafts" ? (
            draftRows.length === 0 ? (
              <EmptyState>No drafts. Emails you start and close without sending are kept here.</EmptyState>
            ) : (
              draftRows.map((d) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  className="inbox-row"
                  title="Carry on writing this email"
                  onClick={() => openDraft(d)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openDraft(d);
                  }}
                >
                  <div className="inbox-row-gutter">
                    <span className="inbox-dot cat-draft" />
                  </div>
                  <div className="inbox-row-main">
                    <div className="inbox-row-top">
                      <span className="inbox-from">To: {d.to_emails || "(no recipient yet)"}</span>
                      <span className="inbox-date">{shortDate(d.updated_at)}</span>
                    </div>
                    <div className="inbox-subject">
                      {d.attachments.length > 0 && <span title="Attachments">📎 </span>}
                      {d.subject || "(no subject)"}
                    </div>
                    <div className="inbox-meta">
                      <span className="inbox-chip needs">Draft</span>
                      {d.reply_to_id && <span className="inbox-chip">{d.reply_all ? "Reply all" : "Reply"}</span>}
                      {d.forward_id && <span className="inbox-chip">Forward</span>}
                      <span className="inbox-snippet">{htmlToText(d.body_html).replace(/\s+/g, " ").slice(0, 160)}</span>
                    </div>
                  </div>
                </div>
              ))
            )
          ) : folder === "sent" ? (
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
                  onDoubleClick={() => {
                    setOpenSent(s);
                    setExpanded(true);
                  }}
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
            <>
            {organiseOn && checked.size > 0 && (
              <BulkBar
                ids={rows.filter((m) => checked.has(m.id)).map((m) => m.id)}
                rows={rows}
                folder={folder}
                actions={actions}
                onAll={() => setChecked(new Set(rows.map((m) => m.id)))}
                onClear={() => setChecked(new Set())}
              />
            )}
            {rows.map((m) => (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                className={`inbox-row${m.id === open?.id ? " on" : ""}${isUnread(m) ? " unread" : ""}${
                  checked.has(m.id) ? " checked" : ""
                }`}
                onClick={() => select(m)}
                onDoubleClick={() => {
                  select(m);
                  setExpanded(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(m);
                  }
                }}
              >
                <div className="inbox-row-gutter">
                  {organiseOn && (
                    <input
                      type="checkbox"
                      className="inbox-check"
                      checked={checked.has(m.id)}
                      title="Select (to archive, delete, flag… several at once)"
                      aria-label="Select this email"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(m.id)}
                    />
                  )}
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
                  {organiseOn && (
                    <button
                      type="button"
                      className={`inbox-flag${m.flagged ? " on" : ""}`}
                      title={m.flagged ? "Remove the flag" : "Flag (find it under Views › Flagged)"}
                      aria-label={m.flagged ? "Remove the flag" : "Flag this email"}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.flag([m.id], !m.flagged);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {m.flagged ? "⚑" : "⚐"}
                    </button>
                  )}
                  <span className="inbox-date">{shortDate(m.sent_at)}</span>
                </div>
                <div className="inbox-subject">
                  {m.has_attachments && <span title="Attachments">📎 </span>}
                  {m.subject || "(no subject)"}
                </div>
                <div className="inbox-meta">
                  {m.record_name && <span className="inbox-chip">{m.record_name}</span>}
                  {m.job_reference && <span className="inbox-chip job">{m.job_reference}</span>}
                  {needsReply(m, lastOut) && <span className="inbox-chip needs">Needs reply</span>}
                  {m.direction === "out" && <span className="inbox-chip">Sent</span>}
                  {isSnoozed(m) && <span className="inbox-chip">Snoozed until {shortDate(m.snoozed_until as string)}</span>}
                  {backFromSnooze(m) && <span className="inbox-chip job">Back from snooze</span>}
                  {m.archived_at && folder !== "archive" && <span className="inbox-chip">Archived</span>}
                  {m.snippet && <span className="inbox-snippet">{m.snippet}</span>}
                </div>
                </div>
              </div>
            ))}
            </>
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
          {folder !== "drafts" && (folder === "sent" ? openSent : open) && (
            <div className="inbox-reader-bar">
              {expanded ? (
                <button type="button" className="btn ghost small" onClick={() => setExpanded(false)} title="Back to the list (Esc)">
                  ‹ Back to {folder === "sent" ? "Sent" : "the list"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setExpanded(true)}
                  title="Open the email full width (or double-click it in the list)"
                >
                  ⤢ Full view
                </button>
              )}
            </div>
          )}
          {folder === "drafts" ? (
            <EmptyState>Click a draft to carry on writing it.</EmptyState>
          ) : folder === "sent" ? (
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
              replyDraft={drafts.find((d) => d.reply_to_id === open.id)}
              lastOut={lastOut}
              organise={organiseOn ? actions : undefined}
              onOpen={(id) => {
                const m = all.find((x) => x.id === id);
                if (m) select(m);
              }}
              onReply={(parsed, replyAll) => startReply(open, parsed, replyAll)}
              onForward={(parsed) => setCompose({ forward: open, parsed })}
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
      {showKeys && (
        <Modal title="Keyboard shortcuts" onClose={() => setShowKeys(false)}>
          <table className="inbox-keys">
            <tbody>
              {KEYS.map(([keys, what]) => (
                <tr key={what}>
                  <td>
                    {keys.split(" ").map((x) => (
                      <kbd key={x}>{x}</kbd>
                    ))}
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Shortcuts work in the Inbox while you're not typing in a box. Archive, delete, flag and mark unread act on the ticked emails when some are ticked.</p>
        </Modal>
      )}
      {compose && (
        <ComposeModal
          {...compose}
          draftsOn={draftsOn}
          jobs={jobs}
          book={book}
          onClose={() => setCompose(null)}
        />
      )}
    </>
  );
}

/** The Inbox's keyboard shortcuts, as listed in the help (?). */
const KEYS: [string, string][] = [
  ["j ↓", "Next email"],
  ["k ↑", "Previous email"],
  ["Enter", "Open full view"],
  ["Esc", "Back to the list"],
  ["r", "Reply"],
  ["a", "Reply all"],
  ["f", "Forward"],
  ["c", "New email"],
  ["e", "Archive (in Archive: move back to the inbox)"],
  ["# Delete", "Delete (in Trash: restore)"],
  ["s", "Flag / remove the flag"],
  ["u", "Mark unread"],
  ["x", "Tick / untick the open email"],
  ["/", "Search"],
  ["?", "These shortcuts"],
];

/** Archive / Trash / Flag / Snooze / Read (0182), on one email or several. */
interface OrganiseActions {
  archive: (ids: string[]) => void;
  unarchive: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  restore: (ids: string[]) => void;
  flag: (ids: string[], on: boolean) => void;
  read: (ids: string[], on: boolean) => void;
  snooze: (ids: string[], until: Date | null) => void;
}

/** Snooze: later today / tomorrow / next week, or a date and time. */
function SnoozeMenu({ onPick }: { onPick: (until: Date) => void }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState("");
  if (custom) {
    const at = value ? new Date(value) : null;
    const ok = !!at && !isNaN(at.getTime()) && at.getTime() > Date.now();
    return (
      <span className="inbox-snooze-custom">
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button
          type="button"
          className="btn small outline"
          disabled={!ok}
          onClick={() => {
            if (at && ok) onPick(at);
            setCustom(false);
            setValue("");
          }}
        >
          Snooze
        </button>
        <button type="button" className="btn ghost small" onClick={() => setCustom(false)} aria-label="Cancel">
          ✕
        </button>
      </span>
    );
  }
  return (
    <select
      className="inbox-snooze"
      value=""
      title="Hide it until later; it comes back to the top as unread"
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") setCustom(true);
        else if (v) onPick(new Date(v));
      }}
    >
      <option value="">⏰ Snooze…</option>
      {snoozeChoices().map((c) => (
        <option key={c.label} value={c.at.toISOString()}>
          {c.label}
        </option>
      ))}
      <option value="custom">Pick a date and time…</option>
    </select>
  );
}

/** Shown above the list while emails are ticked. */
function BulkBar({
  ids,
  rows,
  folder,
  actions,
  onAll,
  onClear,
}: {
  ids: string[];
  rows: InboxMessage[];
  folder: Folder;
  actions: OrganiseActions;
  onAll: () => void;
  onClear: () => void;
}) {
  const picked = rows.filter((m) => ids.includes(m.id));
  const anyUnread = picked.some(isUnread);
  const allFlagged = picked.length > 0 && picked.every((m) => m.flagged);
  return (
    <div className="inbox-bulk">
      <div className="inbox-bulk-head">
        <strong>{ids.length} selected</strong>
        {ids.length < rows.length && (
          <button type="button" className="link-btn" onClick={onAll}>
            Select all {rows.length}
          </button>
        )}
        <button type="button" className="btn ghost small" onClick={onClear} title="Clear the selection" style={{ marginLeft: "auto" }}>
          ✕
        </button>
      </div>
      <div className="inbox-bulk-actions">
        {folder === "trash" ? (
          <button type="button" className="btn small" onClick={() => actions.restore(ids)}>
            Restore
          </button>
        ) : (
          <>
            {folder === "archive" ? (
              <button type="button" className="btn small outline" onClick={() => actions.unarchive(ids)}>
                Move to inbox
              </button>
            ) : (
              <button type="button" className="btn small" onClick={() => actions.archive(ids)}>
                Archive
              </button>
            )}
            <button type="button" className="btn small outline warn" onClick={() => actions.remove(ids)}>
              Delete
            </button>
            <button type="button" className="btn small outline" onClick={() => actions.read(ids, anyUnread)}>
              {anyUnread ? "Mark read" : "Mark unread"}
            </button>
            <button type="button" className="btn small outline" onClick={() => actions.flag(ids, !allFlagged)}>
              {allFlagged ? "Remove flag" : "Flag"}
            </button>
            {folder === "snoozed" ? (
              <button type="button" className="btn small outline" onClick={() => actions.snooze(ids, null)}>
                Unsnooze
              </button>
            ) : (
              <SnoozeMenu onPick={(d) => actions.snooze(ids, d)} />
            )}
          </>
        )}
      </div>
    </div>
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
  outlook: "Outlook",
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
  replyDraft,
  lastOut,
  organise,
  onOpen,
  onReply,
  onForward,
}: {
  msg: InboxMessage;
  lastOut: LastOut;
  /** A reply to this email already started (Drafts). */
  replyDraft?: InboxDraft;
  thread: InboxMessage[];
  jobs: Job[];
  /** Archive / Delete / Flag / Snooze (0182); absent until it's run. */
  organise?: OrganiseActions;
  /** Open another email of the conversation. */
  onOpen: (id: string) => void;
  onReply: (parsed: Parsed | undefined, replyAll: boolean) => void;
  onForward: (parsed: Parsed | undefined) => void;
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

  return (
    <div className="inbox-read">
      <div className="inbox-read-head">
        <h3>{msg.subject || "(no subject)"}</h3>
        <div className="inbox-read-from">
          <strong>
            {msg.direction === "out"
              ? `ExPac (sent from ${msg.mailbox?.endsWith(":sent") ? "Outlook" : "Motion"})`
              : msg.from_name || msg.from_email}
          </strong>
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

      {organise && msg.direction === "in" && (
        <div className="inbox-organise">
          {msg.deleted_at ? (
            <>
              <span className="muted">In Trash.</span>
              <button type="button" className="btn small" onClick={() => organise.restore([msg.id])}>
                Restore
              </button>
            </>
          ) : (
            <>
              {msg.archived_at ? (
                <button type="button" className="btn small outline" onClick={() => organise.unarchive([msg.id])}>
                  Move to inbox
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small outline"
                  onClick={() => organise.archive([msg.id])}
                  title="Out of the inbox; still found by search, and under Archive"
                >
                  Archive
                </button>
              )}
              <button
                type="button"
                className="btn small outline warn"
                onClick={() => organise.remove([msg.id])}
                title="Move to Trash (you can restore it from there)"
              >
                Delete
              </button>
              <button
                type="button"
                className={`btn small outline${msg.flagged ? " inbox-flagged" : ""}`}
                onClick={() => organise.flag([msg.id], !msg.flagged)}
              >
                {msg.flagged ? "⚑ Flagged" : "⚐ Flag"}
              </button>
              {isSnoozed(msg) ? (
                <>
                  <span className="muted">Snoozed until {formatDateTime(msg.snoozed_until as string)}</span>
                  <button type="button" className="btn small outline" onClick={() => organise.snooze([msg.id], null)}>
                    Unsnooze
                  </button>
                </>
              ) : (
                <SnoozeMenu onPick={(d) => organise.snooze([msg.id], d)} />
              )}
            </>
          )}
        </div>
      )}

      <div className="inbox-actions">
        {msg.direction === "in" && (
          <button
            type="button"
            className="btn small"
            onClick={() => onReply(parsed, false)}
            disabled={!!msg.raw_path && parsedQ.isLoading}
            title={replyDraft ? `Carry on with the reply you started (saved ${formatDateTime(replyDraft.updated_at)})` : undefined}
          >
            {replyDraft ? "Continue draft" : "Reply"}
          </button>
        )}
        {msg.direction === "in" && !replyDraft && msg.to_emails.length + msg.cc_emails.length > 1 && (
          <button
            type="button"
            className="btn small outline"
            onClick={() => onReply(parsed, true)}
            disabled={!!msg.raw_path && parsedQ.isLoading}
            title="Reply to the sender and everyone else on this email"
          >
            Reply all
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
          (needsReply(msg, lastOut) ? (
            <button
              type="button"
              className="btn small outline"
              onClick={() => patch({ done_at: new Date().toISOString() }, "Marked as no reply needed")}
            >
              No reply needed
            </button>
          ) : !msg.replied_at && !msg.answered && !(msg.thread_key && (lastOut.get(msg.thread_key) ?? "") > msg.sent_at) ? (
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
        // The whole conversation, oldest first; click one to read it.
        <div className="inbox-convo">
          <div className="inbox-convo-head">Conversation · {thread.length + 1} emails</div>
          {[...thread, msg]
            .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
            .map((t) =>
              t.id === msg.id ? (
                <div key={t.id} className="inbox-convo-item on">
                  <strong>{t.direction === "out" ? "ExPac" : t.from_name || t.from_email}</strong>
                  <span className="muted"> · {formatDateTime(t.sent_at)} · reading now</span>
                </div>
              ) : (
                <button key={t.id} type="button" className="inbox-convo-item" onClick={() => onOpen(t.id)}>
                  <span>
                    <strong>
                      {t.direction === "out"
                        ? `ExPac${t.mailbox?.endsWith(":sent") ? " (Outlook)" : ""}`
                        : t.from_name || t.from_email}
                    </strong>
                    <span className="muted"> · {formatDateTime(t.sent_at)}</span>
                    {t.deleted_at && <span className="inbox-chip">In Trash</span>}
                  </span>
                  <span className="muted inbox-convo-snippet">{t.snippet || t.subject}</span>
                </button>
              ),
            )}
        </div>
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
/** A picked file -> base64 (no data: prefix). */
function fileBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}
// /api/send-mail caps attachments at 15 MB together.
const ATTACH_LIMIT = 14 * 1024 * 1024;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An email's html, ready to sit under a reply / forward: only its <body>,
 *  no scripts or <head> styles (they'd restyle the whole email). A reply
 *  also drops cid: images, their parts only go along with a forward. */
function quotableHtml(raw: string, keepCid: boolean): string {
  const body = raw.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? raw;
  const out = body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<head\b[\s\S]*?<\/head>/gi, "");
  return keepCid ? out : out.replace(/<img\b[^>]*\bsrc=("|')cid:[^"']*\1[^>]*>/gi, "");
}

/** The original message under a reply or forward, Outlook style: a rule,
 *  its From / Sent / To / Cc / Subject, then the message itself. */
function originalBlock(msg: InboxMessage, parsed: Parsed | undefined, forward: boolean): string {
  const raw = parsed?.rawHtml ?? msg.body_html;
  const content = raw
    ? quotableHtml(raw, forward)
    : escHtml(parsed?.text ?? msg.body_text ?? msg.snippet ?? "").replace(/\n/g, "<br>");
  const from = msg.from_name ? `${escHtml(msg.from_name)} &lt;${escHtml(msg.from_email ?? "")}&gt;` : escHtml(msg.from_email ?? "");
  return (
    `<br><div style="border-top:1px solid #e1e1e1;padding-top:8px;margin-top:8px">` +
    (forward ? `---------- Forwarded message ----------<br>` : "") +
    `<b>From:</b> ${from}<br><b>Sent:</b> ${formatDateTime(msg.sent_at)}<br>` +
    `<b>To:</b> ${escHtml(msg.to_emails.join(", "))}<br>` +
    (msg.cc_emails.length ? `<b>Cc:</b> ${escHtml(msg.cc_emails.join(", "))}<br>` : "") +
    `<b>Subject:</b> ${escHtml(msg.subject ?? "")}</div><br>${content}`
  );
}

interface ComposeState {
  replyTo?: InboxMessage;
  /** Reply all: everyone on the original stays on the reply (Cc). */
  replyAll?: boolean;
  /** The parsed original (reply / forward), for quoting it in full. */
  parsed?: Parsed;
  forward?: InboxMessage;
  /** Reopening a saved draft (0180). */
  draft?: InboxDraft;
}

/** Saves a draft this long after the last change. */
const DRAFT_DELAY = 1500;

function ComposeModal({
  replyTo,
  replyAll,
  parsed: parsedProp,
  forward: fwd,
  draft,
  draftsOn,
  book,
  jobs,
  onClose,
}: ComposeState & {
  /** Drafts table present (0180 run); otherwise nothing is autosaved. */
  draftsOn: boolean;
  book: BookEntry[];
  jobs: Job[];
  onClose: () => void;
}) {
  const original = replyTo ?? fwd;
  // A reopened draft loads its original's .eml here (the reading pane does it otherwise).
  const parsedQ = useQuery({
    queryKey: ["inbox_raw", original?.raw_path],
    queryFn: () => parseRaw(original?.raw_path as string),
    enabled: !parsedProp && !!original?.raw_path,
    staleTime: Infinity,
  });
  const parsed = parsedProp ?? parsedQ.data;
  const fwdFiles = fwd ? parsed?.attachments ?? [] : [];
  // Forwarded attachments still ticked, by name (null = all of them).
  const [keepNames, setKeepNames] = useState<string[] | null>(draft?.forward_files ?? null);
  const kept = (name: string) => keepNames === null || keepNames.includes(name);
  const [dragging, setDragging] = useState(false);
  const settingsQ = useCompanySettings();
  const settings = settingsQ.data;
  const templatesQ = useMailTemplates();
  const saveTemplate = useSaveMailTemplate();
  const uploadAsset = useUploadMailAsset();
  const update = useUpdateInboxMessage();
  const qc = useQueryClient();
  const { toast, error } = useToast();

  // Reply all: the sender in To, everyone else on the original in Cc
  // (never our own support@ / reply-to address).
  const [to, setTo] = useState(draft?.to_emails ?? replyTo?.from_email ?? "");
  const [cc, setCc] = useState(() => {
    if (draft) return draft.cc_emails;
    if (!replyTo || !replyAll) return "";
    const skip = new Set(
      ["support@expac.co.za", settings?.mail_reply_to ?? "", replyTo.from_email ?? ""].map((e) => e.toLowerCase()),
    );
    const seen = new Set<string>();
    return [...replyTo.to_emails, ...replyTo.cc_emails]
      .filter((e) => {
        const k = e.trim().toLowerCase();
        if (!k || skip.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .join(", ");
  });
  const [bcc, setBcc] = useState(draft?.bcc_emails ?? "");
  const [showBcc, setShowBcc] = useState(!!draft?.bcc_emails);
  const [subject, setSubject] = useState(
    draft
      ? draft.subject
      : replyTo
        ? /^re:/i.test(replyTo.subject ?? "")
          ? replyTo.subject ?? ""
          : `Re: ${replyTo.subject ?? ""}`
        : fwd
          ? /^(fw|fwd):/i.test(fwd.subject ?? "")
            ? fwd.subject ?? ""
            : `Fwd: ${fwd.subject ?? ""}`
          : "",
  );
  const [includeOriginal, setIncludeOriginal] = useState(draft?.include_original ?? true);

  // The signature sits in the body (edit or delete it before sending), with
  // two blank lines above it to type in, like Outlook. A draft keeps its own.
  const sig = settings?.mail_signature_html?.trim() || "";
  const blank = "<div><br></div><div><br></div>";
  const [body, setBody] = useState(draft?.body_html ?? "");
  const [seed, setSeed] = useState<string | null>(draft ? draft.body_html : null);
  useEffect(() => {
    // Settings failing to load just means no signature, never a stuck editor.
    if (seed !== null || settingsQ.isLoading) return;
    const s = sig ? `${blank}${sig}` : blank;
    setSeed(s);
    setBody((b) => (b.trim() ? b : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.isLoading]);
  const [sending, setSending] = useState(false);

  // Attachments: files saved with the draft (storage) and ones picked since
  // (uploaded on the next save). Refs are the truth so overlapping saves
  // never upload a file twice; `bump` re-renders.
  const savedFiles = useRef<InboxDraftFile[]>(draft?.attachments ?? []);
  const newFiles = useRef<File[]>([]);
  const [, setBump] = useState(0);
  const bump = () => setBump((n) => n + 1);

  const typed = htmlToText(body).replace(htmlToText(sig), "").trim() !== "";
  const hasFiles = savedFiles.current.length + newFiles.current.length > 0;
  // Worth keeping as a draft: something written, attached or addressed.
  const worthSaving = typed || hasFiles || (!original && (!!to.trim() || !!subject.trim()));

  /* ---------- Drafts (0180) ---------- */
  const draftId = useRef<string | null>(draft?.id ?? null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ to, cc, bcc, subject, body, includeOriginal, keepNames });
  latest.current = { to, cc, bcc, subject, body, includeOriginal, keepNames };
  const [savedAt, setSavedAt] = useState<string | null>(draft ? draft.updated_at : null);
  const [saveError, setSaveError] = useState(false);
  // Set once sent or discarded: no more saves.
  const stopped = useRef(false);
  const lastSaveOk = useRef(true);

  /** Queue a save (one at a time, so a new draft is only inserted once). */
  function saveDraft(): Promise<void> {
    chain.current = chain.current.then(async () => {
      if (stopped.current) return;
      const v = latest.current;
      const row = {
        to_emails: v.to,
        cc_emails: v.cc,
        bcc_emails: v.bcc,
        subject: v.subject,
        body_html: v.body,
        reply_to_id: replyTo?.id ?? null,
        reply_all: !!replyAll,
        forward_id: fwd?.id ?? null,
        include_original: v.includeOriginal,
        forward_files: v.keepNames,
      };
      try {
        let saved = await saveInboxDraft(draftId.current, { ...row, attachments: savedFiles.current });
        draftId.current = saved.id;
        const pending = [...newFiles.current];
        if (pending.length) {
          const up: InboxDraftFile[] = [];
          for (const f of pending) up.push(await uploadInboxDraftFile(saved.id, f));
          newFiles.current = newFiles.current.filter((f) => !pending.includes(f));
          savedFiles.current = [...savedFiles.current, ...up];
          saved = await saveInboxDraft(saved.id, { attachments: savedFiles.current });
          bump();
        }
        setSavedAt(saved.updated_at);
        setSaveError(false);
        lastSaveOk.current = true;
        qc.invalidateQueries({ queryKey: ["inbox_drafts"] });
      } catch {
        setSaveError(true);
        lastSaveOk.current = false;
      }
    });
    return chain.current;
  }

  // Autosave a moment after each change (not on open: nothing changed yet).
  const timer = useRef<number | undefined>(undefined);
  const snap = JSON.stringify([to, cc, bcc, subject, body, includeOriginal, keepNames, savedFiles.current.length, newFiles.current.length]);
  const lastSnap = useRef<string | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!draftsOn || sending || seed === null) return;
    if (lastSnap.current === null) {
      lastSnap.current = snap;
      return;
    }
    if (snap === lastSnap.current) return;
    if (!worthSaving && !draftId.current) return;
    lastSnap.current = snap;
    window.clearTimeout(timer.current);
    pending.current = true;
    timer.current = window.setTimeout(() => {
      pending.current = false;
      void saveDraft();
    }, DRAFT_DELAY);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, seed, draftsOn]);

  async function close() {
    window.clearTimeout(timer.current);
    // Unsaved changes (a save waiting, or not yet scheduled) are saved first.
    const needsSave = pending.current || snap !== lastSnap.current || (!draftId.current && worthSaving);
    pending.current = false;
    if (draftsOn && (needsSave || draftId.current)) {
      if (needsSave) await saveDraft();
      else await chain.current;
      if (lastSaveOk.current) {
        stopped.current = true;
        toast("Saved to Drafts");
        onClose();
        return;
      }
      // The save failed: say so before anything is lost.
      if (!window.confirm("The draft couldn't be saved. Close anyway and lose what you've written?")) return;
      onClose();
      return;
    }
    if ((typed || hasFiles) && !sending && !window.confirm("Discard this email? What you've written will be lost."))
      return;
    onClose();
  }
  async function discard() {
    if ((typed || hasFiles) && !window.confirm("Discard this email? The draft will be deleted.")) return;
    window.clearTimeout(timer.current);
    stopped.current = true;
    await chain.current;
    if (draftId.current) {
      try {
        await deleteInboxDraft({ id: draftId.current, attachments: savedFiles.current });
      } catch {
        /* best effort, it stays in Drafts */
      }
      qc.invalidateQueries({ queryKey: ["inbox_drafts"] });
    }
    onClose();
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    // Copy now: the picker is reset right after, which empties its FileList.
    newFiles.current = [...newFiles.current, ...list];
    bump();
  }
  function removeNewFile(f: File) {
    newFiles.current = newFiles.current.filter((x) => x !== f);
    bump();
  }
  function removeSavedFile(a: InboxDraftFile) {
    savedFiles.current = savedFiles.current.filter((x) => x.path !== a.path);
    bump();
    void removeInboxDraftFiles([a.path]).catch(() => undefined);
  }

  /* ---------- Templates ---------- */
  const firstTo = to.split(/[,;\s]+/).find((x) => x.includes("@"))?.toLowerCase() ?? "";
  const person = book.find((b) => b.email === firstTo);
  const job = original?.job_id ? jobs.find((j) => j.id === original.job_id) : undefined;
  const mergeCtx: MergeContext = {
    name:
      person?.name ||
      (replyTo && firstTo === (replyTo.from_email ?? "").toLowerCase() ? replyTo.from_name ?? "" : ""),
    company: person?.org || original?.record_name || job?.client?.company || "",
    customerName: job?.client?.company || (original?.category === "customer" ? original.record_name ?? "" : ""),
    shipmentNumber: job?.reference ?? original?.job_reference ?? "",
    customerReference: job?.po_no ?? "",
    origin: job?.origin ?? "",
    destination: job?.destination ?? "",
    mode: job?.mode ?? "",
    awb: job?.awb_mbl ?? "",
    containerNo: job?.container_no ?? "",
    vesselName: job?.vessel_name ?? "",
    carrierName: job?.carrier_name ?? "",
    etd: job?.etd ?? "",
    eta: job?.eta ?? "",
  };
  const [loadingTpl, setLoadingTpl] = useState(false);
  async function applyTemplate(id: string) {
    const t = templatesQ.data?.find((x) => x.id === id);
    if (!t) return;
    const html = resolveMergeFields(t.body, mergeCtx);
    // Untouched: the template goes above the signature; otherwise on top.
    setBody((b) => (typed ? `${html}<div><br></div>${b}` : `${html}<div><br></div>${sig}`));
    if (!subject.trim() || (!original && !typed)) setSubject(resolveMergeFields(t.subject, mergeCtx));
    if (t.attachments?.length) {
      setLoadingTpl(true);
      try {
        const got = await Promise.all(
          t.attachments.map(async (a) => {
            const blob = await (await fetch(a.url)).blob();
            return new File([blob], a.name, { type: blob.type });
          }),
        );
        addFiles(got);
      } catch {
        error("The template's attachments couldn't be added, attach them by hand");
      } finally {
        setLoadingTpl(false);
      }
    }
  }
  async function saveAsTemplate() {
    const name = window.prompt("Template name (e.g. Rate request to agent)", subject.replace(/^(re|fwd?):\s*/i, ""));
    if (!name?.trim()) return;
    // Without the signature: it's added to every email anyway.
    const withoutSig = sig ? body.replace(sig, "") : body;
    try {
      await saveTemplate.mutateAsync({
        patch: { name: name.trim(), subject: subject.replace(/^(re|fwd?):\s*/i, ""), body: withoutSig, attachments: [] },
      });
      toast(`Saved as template "${name.trim()}"`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save the template");
    }
  }

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
    if (!typed && !fwd && !hasFiles) {
      error("Write a message");
      return;
    }
    const picked = fwdFiles.filter((a) => kept(a.name));
    const total =
      picked.reduce((n, a) => n + a.size, 0) +
      savedFiles.current.reduce((n, a) => n + a.size, 0) +
      newFiles.current.reduce((n, f) => n + f.size, 0);
    if (total > ATTACH_LIMIT) {
      error("The attachments are too large together (max about 14 MB), remove some");
      return;
    }
    window.clearTimeout(timer.current);
    setSending(true);
    const html = `${linkifyHtml(body)}${original && (includeOriginal || fwd) ? originalBlock(original, parsed, !!fwd) : ""}`;
    const text = htmlToText(body);
    const references = replyTo
      ? [replyTo.refs ?? "", replyTo.message_id ?? ""].join(" ").trim()
      : undefined;
    const ccList = list(cc);
    try {
      await chain.current;
      const attachments = [
        ...(await Promise.all(picked.map(async (a) => ({ filename: a.name, content: await blobUrlBase64(a.url) })))),
        ...(await Promise.all(
          savedFiles.current.map(async (a) => ({
            filename: a.name,
            content: await fileBase64(new File([await downloadInboxRaw(a.path)], a.name)),
          })),
        )),
        ...(await Promise.all(newFiles.current.map(async (f) => ({ filename: f.name, content: await fileBase64(f) })))),
      ];
      const sentRes = await sendMail({
        to: toList,
        cc: ccList,
        bcc: list(bcc),
        subject: subject || "(no subject)",
        html,
        text,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
        inReplyTo: replyTo?.message_id ?? undefined,
        references,
        attachments: attachments.length ? attachments : undefined,
      });
      stopped.current = true;
      // Keep the sent message in the conversation (and on its shipment).
      await insertInboxMessage({
        direction: "out",
        mailbox: "support",
        provider_id: sentRes.id,
        delivery_status: "sent",
        from_email: "support@expac.co.za",
        from_name: settings?.mail_sender_name || "ExPac",
        to_emails: toList,
        cc_emails: ccList,
        subject: subject || "(no subject)",
        snippet: text.replace(/\s+/g, " ").trim().slice(0, 180),
        body_text: text,
        body_html: html,
        in_reply_to: replyTo?.message_id ?? null,
        refs: references ?? null,
        // A forward stays with the original's conversation and shipment.
        thread_key: original?.thread_key ?? null,
        job_id: original?.job_id ?? null,
        job_linked_by: original?.job_id ? original?.job_linked_by ?? null : null,
        has_attachments: attachments.length > 0,
        sent_at: new Date().toISOString(),
        seen: true,
        answered: false,
      });
      if (replyTo) await update.mutateAsync({ id: replyTo.id, patch: { replied_at: new Date().toISOString() } });
      // Sent: the draft (and its files) go.
      await chain.current;
      if (draftId.current) {
        await deleteInboxDraft({ id: draftId.current, attachments: savedFiles.current }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ["inbox_drafts"] });
      }
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox_sent"] });
      toast(replyTo ? "Reply sent" : fwd ? "Email forwarded" : "Email sent");
      onClose();
    } catch (err) {
      stopped.current = false;
      error(err instanceof Error ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  const templates = templatesQ.data ?? [];
  return (
    <Modal
      title={replyTo ? (replyAll ? "Reply all" : "Reply") : fwd ? "Forward" : "New email"}
      onClose={() => void close()}
      wide
    >
      <form
        onSubmit={submit}
        className={`inbox-compose${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="field">
          <label>
            To
            {!showBcc && (
              <button type="button" className="link-btn inbox-bcc-toggle" onClick={() => setShowBcc(true)}>
                Bcc
              </button>
            )}
          </label>
          <RecipientInput
            value={to}
            onChange={setTo}
            book={book}
            placeholder="Start typing a name or email"
            autoFocus={!replyTo && !draft}
          />
        </div>
        <div className={showBcc ? "grid2" : undefined}>
          <div className="field">
            <label>Cc</label>
            <RecipientInput value={cc} onChange={setCc} book={book} />
          </div>
          {showBcc && (
            <div className="field">
              <label>Bcc</label>
              <RecipientInput value={bcc} onChange={setBcc} book={book} />
            </div>
          )}
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="inbox-compose-tools">
          <select
            value=""
            onChange={(e) => void applyTemplate(e.target.value)}
            disabled={!templates.length || loadingTpl}
            title={templates.length ? "Insert a saved template, filled in for this email" : "No templates yet"}
          >
            <option value="">{loadingTpl ? "Adding the template's files…" : templates.length ? "Insert template…" : "No templates yet"}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => void saveAsTemplate()}
            disabled={!typed || saveTemplate.isPending}
            title="Save this message as a template for next time"
          >
            Save as template
          </button>
          <span className="inbox-draft-state">
            {!draftsOn
              ? ""
              : saveError
                ? "Draft not saved, check your connection"
                : savedAt
                  ? `Draft saved ${shortDate(savedAt)}`
                  : ""}
          </span>
        </div>
        <div className="field">
          {seed === null ? (
            <Loading />
          ) : (
            <RichTextEditor
              mail
              autoFocus={!!replyTo && !draft}
              value={body}
              onChange={setBody}
              onUploadImage={(f) => uploadAsset.mutateAsync(f)}
              trailing={
                <label className="inbox-attach-btn" title="Attach files (or drop them on this window)">
                  📎 Attach
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              }
            />
          )}
          <span className="hint">
            Sent from support@expac.co.za
            {replyTo ? ", threaded under the original message" : ""}. Paste a screenshot straight into the message, or drop
            files anywhere on this window to attach them.{draftsOn ? " Saved to Drafts as you write." : ""}
          </span>
        </div>
        {(hasFiles || fwdFiles.length > 0) && (
          <div className="field">
            <label>Attachments</label>
            <div className="inbox-attachments" style={{ marginTop: 0 }}>
              {fwdFiles.map((a) => (
                <label key={a.url} className="inbox-attachment" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={kept(a.name)}
                    onChange={() =>
                      setKeepNames((k) => {
                        const now = k ?? fwdFiles.map((x) => x.name);
                        return now.includes(a.name) ? now.filter((n) => n !== a.name) : [...now, a.name];
                      })
                    }
                  />{" "}
                  {a.name}
                  <span className="muted"> {kb(a.size)}</span>
                </label>
              ))}
              {savedFiles.current.map((a) => (
                <span key={a.path} className="inbox-attachment">
                  📎 {a.name}
                  <span className="muted"> {kb(a.size)}</span>
                  <button
                    type="button"
                    className="inbox-attachment-x"
                    title="Remove"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removeSavedFile(a)}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {newFiles.current.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inbox-attachment">
                  📎 {f.name}
                  <span className="muted"> {kb(f.size)}</span>
                  <button
                    type="button"
                    className="inbox-attachment-x"
                    title="Remove"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removeNewFile(f)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {original && (
          <div className="field">
            {replyTo && (
              <label className="inbox-include-original">
                <input type="checkbox" checked={includeOriginal} onChange={(e) => setIncludeOriginal(e.target.checked)} />{" "}
                Include the original message below my reply
              </label>
            )}
            {(includeOriginal || fwd) && (
              <details className="inbox-original">
                <summary>
                  {fwd ? "Forwarded message" : "Original message"} from {original.from_name || original.from_email},{" "}
                  {formatDateTime(original.sent_at)}
                </summary>
                <iframe
                  title="Original message"
                  className="inbox-frame inbox-original-frame"
                  sandbox=""
                  srcDoc={`<style>body{font-family:Aptos,Calibri,"Segoe UI",sans-serif;font-size:13px;color:#2e2e2e;margin:10px;word-wrap:break-word}img{max-width:100%;height:auto}</style>${originalBlock(original, parsed, false)}`}
                />
              </details>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          {draftsOn && (
            <button type="button" className="btn outline warn" onClick={() => void discard()} style={{ marginRight: "auto" }}>
              Discard
            </button>
          )}
          <button type="button" className="btn outline" onClick={() => void close()}>
            {draftsOn ? "Save draft & close" : "Cancel"}
          </button>
          <button type="submit" className="btn" disabled={sending || seed === null || loadingTpl}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
