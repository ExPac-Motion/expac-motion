/**
 * Cloudflare Pages Function, keeps each login's mailbox and the Inbox in
 * step, both ways (migration 0227; first built in 0134).
 *
 * For each mailbox (mailboxes table, one per login):
 *   1. PUSH: changes made in Motion (pending_* on inbox_messages: read /
 *      unread, flag, archive, delete, spam, move to folder, and copies of
 *      mail sent from Motion for the Sent folder) are made on the server,
 *      only when the mailbox has write_back on.
 *   2. FOLDERS: every folder on the server is listed (mailbox_folders);
 *      Outlook's system folders and Drafts are left out.
 *   3. SYNC: each folder that changed since last time (STATUS: message
 *      count, next uid, CONDSTORE mod-sequence) is compared with what's
 *      stored: new mail is stored (envelope in inbox_messages, raw .eml in
 *      the private "inbox" bucket, parsed by the app when opened), mail
 *      that left the folder is marked gone and picked up where it turns up
 *      (inbox_relocate / inbox_reconcile), and the server's flags (read,
 *      answered, flagged) come across for the last 30 days.
 *
 * Calls:
 *   x-cron-key (pg_cron every minute, CRON_SECRET): every mailbox, longest
 *     waiting first, as far as one run's request budget goes.
 *   A signed-in login with Inbox access: their own mailbox. Body
 *     { mode: "push" } only pushes (the app calls it right after a change).
 *     { mode: "create_folder", name, parent? } creates a folder on the
 *     server (Inbox › New folder). Nothing else ever creates folders: a
 *     change that needs a folder the server lacks is left undone and reported.
 *
 * Cloudflare allows 50 requests per call (each Supabase call counts, the
 * mail server connection counts once), so every run keeps to BUDGET and
 * picks up where it stopped on the next.
 *
 * Env: IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD (support@ and the
 *      default server for other mailboxes), SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */
import { connect } from "cloudflare:sockets";
import {
  addresses,
  copyUid,
  decodeWords,
  fetchItems,
  createFolder,
  folderStatus,
  headerValue,
  imapDate,
  listFolders,
  openImap,
  quote,
  searchUids,
  selectFolder,
  utf8,
  val,
} from "../../server/mail/imap";

// Mail history kept per folder: a year back, newest first.
const HISTORY_DAYS = 365;
// The server's flags are read for the recent window only.
const FLAGS_DAYS = 30;
const MAX_RAW_BYTES = 20 * 1024 * 1024;
// Requests per run (Cloudflare's limit is 50; each mail server connection
// counts as one, and a signed-in call spends two checking the caller).
const BUDGET = 46;
// Kept back for the end of a mailbox: folder state, reconcile, mailbox state.
const RESERVE = 3;
// New uids checked against mail we already hold (moved in Outlook) per folder per run.
const RELOCATE_MAX = 150;
// Without CONDSTORE a folder's flags can change unseen: look again this often.
const RECHECK_MS = 10 * 60 * 1000;
// Pending Motion changes pushed per run.
const PUSH_MAX = 60;
// Motion never creates folders on the mailbox: a change that needs a folder
// the server doesn't have (e.g. no Archive) is left undone and reported.
const ROLE_NAME = { archive: "Archive", trash: "Trash / Deleted Items", junk: "Junk", sent: "Sent" };

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

class OutOfBudget extends Error {}

/** Supabase with the service role, counting requests against the budget. */
class Api {
  constructor(env) {
    this.env = env;
    this.left = BUDGET;
  }
  /** A mail server connection counts as one request too. */
  socket() {
    if (this.left < 1) throw new OutOfBudget("out of budget");
    this.left--;
  }
  can(n) {
    return this.left - n >= RESERVE;
  }
  async req(path, init = {}, force = false) {
    if (!force && !this.can(1)) throw new OutOfBudget("out of budget");
    if (this.left < 1) throw new OutOfBudget("out of budget");
    this.left--;
    const r = await fetch(`${this.env.SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + this.env.SUPABASE_SERVICE_ROLE_KEY,
        ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
    return r;
  }
  async json(path, init = {}, force = false) {
    const t = await (await this.req(path, init, force)).text();
    return t ? JSON.parse(t) : null;
  }
  rpc(name, args, force = false) {
    return this.json(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) }, force);
  }
}

/** A signed-in caller with Inbox access: their mailbox ids, else null. */
async function callerMailboxes(env, authHeader) {
  if (!authHeader || !env.SUPABASE_ANON_KEY) return null;
  const call = (fn) =>
    fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader, "content-type": "application/json" },
      body: "{}",
    });
  const ok = await call("can_use_inbox");
  if (!ok.ok || (await ok.json()) !== true) return null;
  const ids = await call("my_mailbox_ids");
  if (!ids.ok) return null;
  const list = await ids.json();
  return Array.isArray(list) ? list : [];
}

/** The mailbox's login: its own (Vault) or, without one, the Cloudflare IMAP_* settings. */
async function credentials(api, env, mb) {
  if (mb.secret_id) {
    const password = await api.rpc("mailbox_password", { p_mailbox: mb.id });
    if (!password) throw new Error("The mailbox password is missing, connect the mailbox again.");
    return {
      host: mb.imap_host || env.IMAP_HOST,
      port: mb.imap_port || env.IMAP_PORT || 993,
      user: mb.imap_user || mb.email,
      password,
    };
  }
  if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASSWORD) {
    throw new Error(
      "The inbox isn't connected yet, add IMAP_HOST, IMAP_PORT, IMAP_USER and IMAP_PASSWORD " +
        "to the Cloudflare Pages project (Settings › Variables and Secrets), then redeploy.",
    );
  }
  return { host: env.IMAP_HOST, port: env.IMAP_PORT || 993, user: env.IMAP_USER, password: env.IMAP_PASSWORD };
}

const mailboxKey = (mb) => String(mb.email || "mailbox").split("@")[0].toLowerCase();
const safe = (s) => String(s).replace(/[^a-z0-9-]/gi, "_");

/* ---------- 1. Push: Motion's changes onto the server ---------- */

/** The folder for a role ('\archive' style), or null when the mailbox has
 *  none: Motion never creates folders. Other folders are used as they are. */
function resolveFolder(folders, target) {
  if (!target || target[0] !== "\\") return target;
  const role = target.slice(1);
  if (role === "inbox") return "INBOX";
  return folders.find((f) => f.role === role)?.path ?? null;
}

async function push(api, imap, mb, folders) {
  if (!mb.write_back) return { pushed: 0 };
  const rows = await api.json(
    `/rest/v1/inbox_messages?mailbox_id=eq.${mb.id}&pending_at=not.is.null` +
      `&select=id,folder,uid,uidvalidity,pending_at,pending_from_folder,pending_from_uid,pending_from_uidvalidity,` +
      `pending_seen,pending_flagged,pending_append,raw_path&order=pending_at&limit=${PUSH_MAX}`,
  );
  if (!rows || !rows.length) return { pushed: 0 };
  const results = [];
  const errors = [];

  // Sent from Motion: a copy into the server's Sent folder.
  const appends = rows.filter((r) => r.pending_append && r.uid == null && r.raw_path && !r.pending_from_folder);
  const moves = rows.filter((r) => !appends.includes(r));

  // Group by where each message really is on the server now.
  const groups = new Map();
  for (const r of moves) {
    const src = r.pending_from_folder ?? r.folder;
    const srcUid = r.pending_from_uid ?? r.uid;
    const srcUv = r.pending_from_uidvalidity ?? r.uidvalidity;
    if (!src || !srcUid) {
      // Not on the server (yet): nothing to do there.
      results.push({ id: r.id, token: r.pending_at, folder: r.folder, uid: r.uid, uidvalidity: r.uidvalidity });
      continue;
    }
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src).push({ r, srcUid, srcUv });
  }

  for (const [src, list] of groups) {
    try {
      let uv;
      try {
        uv = await selectFolder(imap, src);
      } catch {
        uv = null;
      }
      const live = [];
      for (const x of list) {
        if (uv && x.srcUv === uv) live.push(x);
        // The folder was rebuilt or removed: where it is now is found by the next sync.
        else results.push({ id: x.r.id, token: x.r.pending_at, folder: x.r.folder, uid: null, uidvalidity: null });
      }
      if (!live.length) continue;

      // Flags first, in the folder it's in (they travel with a move).
      const store = async (uids, how, flag) => {
        if (uids.length) await imap.cmd(`UID STORE ${uids.join(",")} ${how}FLAGS.SILENT (${flag})`);
      };
      await store(live.filter((x) => x.r.pending_seen === true).map((x) => x.srcUid), "+", "\\Seen");
      await store(live.filter((x) => x.r.pending_seen === false).map((x) => x.srcUid), "-", "\\Seen");
      await store(live.filter((x) => x.r.pending_flagged === true).map((x) => x.srcUid), "+", "\\Flagged");
      await store(live.filter((x) => x.r.pending_flagged === false).map((x) => x.srcUid), "-", "\\Flagged");

      // Moves, per destination.
      const byTarget = new Map();
      for (const x of live) {
        if (x.r.folder && x.r.folder !== src) {
          if (!byTarget.has(x.r.folder)) byTarget.set(x.r.folder, []);
          byTarget.get(x.r.folder).push(x);
        } else {
          results.push({ id: x.r.id, token: x.r.pending_at, folder: src, uid: x.srcUid, uidvalidity: uv });
        }
      }
      for (const [target, xs] of byTarget) {
        const path = resolveFolder(folders, target);
        if (!path || (path !== "INBOX" && !folders.some((f) => f.path === path))) {
          // No such folder on the server (none for that role, or deleted
          // since): the message stays where it is, and Motion says so.
          for (const x of xs) results.push({ id: x.r.id, token: x.r.pending_at, folder: src, uid: x.srcUid, uidvalidity: uv });
          const role = target[0] === "\\" ? target.slice(1) : null;
          const n = `${xs.length} email${xs.length === 1 ? " was" : "s were"}`;
          errors.push(
            role
              ? `The mailbox has no ${ROLE_NAME[role] || role} folder, so ${n} left in ${src} (Motion doesn't create folders)`
              : `The folder "${target}" isn't on the mail server any more, so ${n} left in ${src}`,
          );
          continue;
        }
        const uids = xs.map((x) => x.srcUid).join(",");
        let res;
        if (imap.has("MOVE")) {
          res = await imap.cmd(`UID MOVE ${uids} ${quote(path)}`);
        } else {
          res = await imap.cmd(`UID COPY ${uids} ${quote(path)}`);
          await imap.cmd(`UID STORE ${uids} +FLAGS.SILENT (\\Deleted)`);
          // Only expunge the moved ones; without UIDPLUS they stay marked deleted.
          if (imap.has("UIDPLUS")) await imap.cmd(`UID EXPUNGE ${uids}`);
        }
        const cu = copyUid(res);
        for (const x of xs) {
          const uid = cu?.map[x.srcUid] ?? null;
          results.push({ id: x.r.id, token: x.r.pending_at, folder: path, uid, uidvalidity: uid ? cu.uidvalidity : null });
        }
      }
    } catch (e) {
      errors.push(`${src}: ${e && e.message ? e.message : e}`);
    }
  }

  if (appends.length) {
    try {
      const sentPath = resolveFolder(folders, "\\sent");
      if (!sentPath) {
        // No Sent folder on the server: no copy (the email itself was sent).
        for (const r of appends) results.push({ id: r.id, token: r.pending_at, folder: null, uid: null, uidvalidity: null });
        errors.push("The mailbox has no Sent folder, so no copy of mail sent from Motion was kept there (Motion doesn't create folders)");
      }
      for (const r of sentPath ? appends : []) {
        if (!api.can(2)) break;
        const raw = new Uint8Array(
          await (await api.req(`/storage/v1/object/inbox/${r.raw_path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer(),
        );
        const res = await imap.cmd(`APPEND ${quote(sentPath)} (\\Seen)`, raw);
        const m = (res.done || "").match(/\[APPENDUID (\d+) (\d+)\]/i);
        results.push({
          id: r.id,
          token: r.pending_at,
          folder: sentPath,
          uid: m ? Number(m[2]) : null,
          uidvalidity: m ? Number(m[1]) : null,
        });
      }
    } catch (e) {
      errors.push(`Sent: ${e && e.message ? e.message : e}`);
    }
  }

  if (results.length) await api.rpc("inbox_push_done", { p_results: results }, true);
  return { pushed: results.length, error: errors.length ? errors.join("; ") : null };
}

/* ---------- 3. One folder ---------- */

function buildRow(r, mb, f, uv) {
  const o = fetchItems(r);
  if (!o || !o.UID) return null;
  const uid = Number(val(o.UID, r.lits));
  const env_ = o.ENVELOPE || [];
  const flags = (Array.isArray(o.FLAGS) ? o.FLAGS : []).map((x) => String(x).toLowerCase());
  const headers = val(o.BODY, r.lits) || "";
  const from = addresses(env_[2], r.lits)[0] || { name: null, email: null };
  const messageId = val(env_[9], r.lits);
  const inReplyTo = val(env_[8], r.lits);
  const references = headerValue(headers, "References");
  const root = (references.match(/<[^>]+>/) || [])[0] || inReplyTo || messageId || null;
  const autoSub = headerValue(headers, "Auto-Submitted").toLowerCase();
  const prec = headerValue(headers, "Precedence").toLowerCase();
  const bulk =
    (autoSub && autoSub !== "no") ||
    ["bulk", "list", "junk"].includes(prec) ||
    !!headerValue(headers, "List-Unsubscribe") ||
    !!headerValue(headers, "List-Id") ||
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i.test(from.email || "");
  const internal = val(o.INTERNALDATE, r.lits);
  const size = Number(val(o["RFC822.SIZE"], r.lits) || 0);
  const date = internal
    ? new Date(internal.replace(/^(\d+)-(\w+)-(\d+)/, "$1 $2 $3"))
    : new Date(val(env_[0], r.lits) || Date.now());
  const out = f.role === "sent";
  const now = new Date().toISOString();
  const flagged = flags.includes("\\flagged");
  return {
    motion_id: headerValue(headers, "X-Motion-Id"),
    row: {
      mailbox: mailboxKey(mb) + (out ? ":sent" : f.role === "junk" ? ":junk" : ""),
      mailbox_id: mb.id,
      folder: f.path,
      uidvalidity: uv,
      uid,
      direction: out ? "out" : "in",
      message_id: messageId,
      in_reply_to: inReplyTo,
      refs: references || null,
      thread_key: root,
      from_email: from.email,
      from_name: from.name,
      to_emails: addresses(env_[5], r.lits).map((a) => a.email),
      cc_emails: addresses(env_[6], r.lits).map((a) => a.email),
      subject: decodeWords(val(env_[1], r.lits)) || "(no subject)",
      size_bytes: size || null,
      is_bulk: !out && !!bulk,
      sent_at: isNaN(date.getTime()) ? now : date.toISOString(),
      seen: out || flags.includes("\\seen"),
      answered: !out && flags.includes("\\answered"),
      flagged,
      server_flagged: flagged,
      spam: f.role === "junk",
      deleted_at: f.role === "trash" ? now : null,
      archived_at: f.role === "archive" ? now : null,
      raw_path: null,
      has_attachments: false,
    },
  };
}

async function syncFolder(api, imap, mb, f) {
  const uv = await selectFolder(imap, f.path);
  const all = searchUids(await imap.cmd("UID SEARCH ALL"));
  const since = (days) => imapDate(new Date(Date.now() - days * 86400000));
  const recent = all.length ? searchUids(await imap.cmd(`UID SEARCH SINCE ${since(HISTORY_DAYS)}`)) : [];
  const recentFlags = recent.length ? searchUids(await imap.cmd(`UID SEARCH SINCE ${since(FLAGS_DAYS)}`)) : [];

  const flags = {};
  if (recentFlags.length) {
    const fl = await imap.cmd(`UID FETCH ${recentFlags[0]}:* (UID FLAGS)`);
    for (const r of fl) {
      const o = fetchItems(r);
      if (!o || !o.UID) continue;
      const x = (Array.isArray(o.FLAGS) ? o.FLAGS : []).map((v) => String(v).toLowerCase());
      flags[Number(val(o.UID, r.lits))] = [x.includes("\\seen"), x.includes("\\answered"), x.includes("\\flagged")];
    }
  }

  const missing =
    (await api.rpc("inbox_folder_seen", {
      p_mailbox: mb.id,
      p_folder: f.path,
      p_uidvalidity: uv,
      p_all: all,
      p_recent: recent,
      p_flags: flags,
    })) || [];
  let added = 0;
  let relocated = 0;

  if (missing.length && api.can(2)) {
    const head = missing.slice(0, RELOCATE_MAX);
    const meta = await imap.cmd(
      `UID FETCH ${head.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE ` +
        `BODY.PEEK[HEADER.FIELDS (REFERENCES AUTO-SUBMITTED PRECEDENCE LIST-UNSUBSCRIBE LIST-ID X-MOTION-ID)])`,
    );
    const built = meta.map((r) => buildRow(r, mb, f, uv)).filter(Boolean);
    // Mail we already hold (moved here in Outlook, or our own copy in Sent) just moves.
    const matched = new Set(
      (await api.rpc("inbox_relocate", {
        p_mailbox: mb.id,
        p_folder: f.path,
        p_uidvalidity: uv,
        p_items: built.map((b) => ({ uid: b.row.uid, message_id: b.row.message_id, motion_id: b.motion_id })),
      })) || [],
    );
    relocated = matched.size;

    // The rest is new: raw source first, then the rows in one go. A run
    // cut short keeps nothing half-stored (the raw is simply uploaded again).
    const rows = built.filter((b) => !matched.has(b.row.uid)).map((b) => b.row).sort((a, b) => b.uid - a.uid);
    const store = [];
    for (const row of rows) {
      if (!api.can(2)) break;
      if (!row.size_bytes || row.size_bytes <= MAX_RAW_BYTES) {
        const res = await imap.cmd(`UID FETCH ${row.uid} (UID BODY.PEEK[])`);
        const lit = res.find((r) => r.lits.length)?.lits?.[0];
        if (lit) {
          const path = `${mb.id}/${safe(f.path)}/${uv}/${row.uid}.eml`;
          const up = await api
            .req(`/storage/v1/object/inbox/${path}`, {
              method: "POST",
              headers: { "content-type": "message/rfc822", "x-upsert": "true" },
              body: lit,
            })
            .then(() => true)
            .catch((e) => {
              if (e instanceof OutOfBudget) throw e;
              return false;
            });
          if (up) {
            row.raw_path = path;
            row.has_attachments = /content-disposition:\s*attachment/i.test(
              utf8.decode(lit.subarray(0, Math.min(lit.length, 400000))),
            );
          }
        }
      }
      store.push(row);
    }
    if (store.length) {
      await api.req(
        `/rest/v1/inbox_messages?on_conflict=mailbox_id,folder,uidvalidity,uid`,
        {
          method: "POST",
          headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(store),
        },
        true,
      );
      added = store.length;
    }
  }
  return { uidvalidity: uv, added, relocated, backlog: Math.max(0, missing.length - added - relocated) };
}

/* ---------- One mailbox ---------- */

const folderRow = (f, extra = {}) => ({
  path: f.path,
  name: f.name,
  delim: f.delim,
  role: f.role,
  hidden: !f.selectable || f.system || f.role === "drafts",
  ...extra,
});

async function syncMailbox(api, env, mb, { pushOnly = false } = {}) {
  const creds = await credentials(api, env, mb);
  api.socket();
  const imap = await openImap(connect, creds);
  const out = { mailbox: mb.email, added: 0, relocated: 0, pushed: 0, pending: 0 };
  let pushError = null;
  try {
    const folders = await listFolders(imap);
    const stored = pushOnly
      ? []
      : (await api.json(`/rest/v1/mailbox_folders?mailbox_id=eq.${mb.id}&select=*`)) || [];

    // The folder list (and any '\sent' style names resolved) before anything else.
    if (!pushOnly) {
      await api.rpc("inbox_folders_save", {
        p_mailbox: mb.id,
        p_folders: folders.map((f) => folderRow(f)),
        p_complete: true,
      });
    }

    const p = await push(api, imap, mb, folders);
    out.pushed = p.pushed;
    pushError = p.error || null;
    if (pushOnly) {
      await api.req(
        `/rest/v1/mailboxes?id=eq.${mb.id}`,
        { method: "PATCH", body: JSON.stringify({ last_push_at: new Date().toISOString(), push_error: pushError }) },
        true,
      );
      return out;
    }

    const prev = new Map(stored.map((s) => [s.path, s]));
    const rank = (f) => (f.role === "inbox" ? 0 : f.role === "sent" ? 1 : 2);
    const order = folders
      .filter((f) => f.selectable && !f.system && f.role !== "drafts")
      .sort((a, b) => rank(a) - rank(b) || String(prev.get(a.path)?.synced_at || "").localeCompare(String(prev.get(b.path)?.synced_at || "")));

    const visited = [];
    for (const f of order) {
      if (!api.can(2)) break;
      let st;
      try {
        st = await folderStatus(imap, f.path);
      } catch {
        continue;
      }
      const was = prev.get(f.path);
      const stale = !was?.synced_at || Date.now() - new Date(was.synced_at).getTime() > RECHECK_MS;
      const changed =
        !was ||
        !was.synced_at ||
        was.backlog > 0 ||
        Number(was.uidvalidity) !== st.uidvalidity ||
        Number(was.uidnext) !== st.uidnext ||
        Number(was.messages) !== st.messages ||
        (st.modseq ? String(was.modseq) !== st.modseq : stale || f.role === "inbox");
      if (!changed) continue;
      try {
        const r = await syncFolder(api, imap, mb, f);
        out.added += r.added;
        out.relocated += r.relocated;
        visited.push(
          folderRow(f, {
            uidvalidity: st.uidvalidity,
            uidnext: st.uidnext,
            messages: st.messages,
            modseq: st.modseq,
            backlog: r.backlog,
            synced_at: new Date().toISOString(),
          }),
        );
        prev.set(f.path, { ...was, backlog: r.backlog });
      } catch (e) {
        if (e instanceof OutOfBudget) break;
        throw e;
      }
    }

    // Mail that left one folder and was stored again in another takes over its links.
    await api.rpc("inbox_reconcile", { p_mailbox: mb.id }, true);
    if (visited.length) {
      await api.rpc("inbox_folders_save", { p_mailbox: mb.id, p_folders: visited, p_complete: false }, true);
    }

    out.pending = [...prev.values()].reduce((n, s) => n + (Number(s?.backlog) || 0), 0);
    const now = new Date().toISOString();
    await api.req(
      `/rest/v1/mailboxes?id=eq.${mb.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          last_sync_at: now,
          last_error: null,
          pending: out.pending,
          ...(mb.write_back ? { last_push_at: now, push_error: pushError } : {}),
        }),
      },
      true,
    );
    return out;
  } finally {
    await imap.close();
  }
}

/** Creates a folder on the mail server because the mailbox's owner asked for
 *  it (Inbox › New folder), optionally inside another folder. */
async function createUserFolder(api, env, mb, rawName, parent) {
  const name = String(rawName || "").trim();
  if (!name) throw new Error("Give the folder a name.");
  if (name.length > 120 || /[\r\n*%"\\]/.test(name)) throw new Error("Folder names can't contain * % \" \\ or line breaks.");
  const creds = await credentials(api, env, mb);
  api.socket();
  const imap = await openImap(connect, creds);
  try {
    const folders = await listFolders(imap);
    const delim = folders.find((f) => f.delim)?.delim || "/";
    if (name.includes(delim)) throw new Error(`Folder names can't contain "${delim}".`);
    let base = "";
    if (parent) {
      const p = folders.find((f) => f.path === parent);
      if (!p) throw new Error("The folder to put it in isn't on the mail server.");
      base = p.path + delim;
    } else {
      // Servers that keep every folder under INBOX (INBOX.Clients) get the same.
      const other = folders.filter((f) => f.path.toUpperCase() !== "INBOX");
      if (other.length && other.every((f) => f.path.toUpperCase().startsWith("INBOX" + delim))) base = "INBOX" + delim;
    }
    const path = base + name;
    if (folders.some((f) => f.path.toLowerCase() === path.toLowerCase())) throw new Error(`There's already a folder "${name}" there.`);
    await createFolder(imap, path);
    const f = { path, name, delim, role: null, flags: "", selectable: true, system: false };
    await api.rpc("inbox_folders_save", { p_mailbox: mb.id, p_folders: [folderRow(f)], p_complete: false }, true);
    return { ok: true, path };
  } finally {
    await imap.close();
  }
}

async function saveError(api, mb, msg) {
  await api
    .req(
      `/rest/v1/mailboxes?id=eq.${mb.id}`,
      { method: "PATCH", body: JSON.stringify({ last_sync_at: new Date().toISOString(), last_error: msg }) },
      true,
    )
    .catch(() => undefined);
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase isn't configured on this deployment." }, 500);
  }
  const body = await request.json().catch(() => ({}));
  const pushOnly = body && body.mode === "push";
  const cronKey = request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  let mine = null;
  if (!viaCron) {
    mine = await callerMailboxes(env, request.headers.get("authorization"));
    if (!mine) return json({ error: "Not allowed." }, 403);
    if (!mine.length) return json({ error: "No mailbox is connected to your login yet.", notConnected: true }, 409);
  }

  const api = new Api(env);

  // New folder, asked for by the mailbox's owner (never done on its own).
  if (body && body.mode === "create_folder") {
    if (viaCron) return json({ error: "Not allowed." }, 403);
    const id = mine.includes(body.mailboxId) ? body.mailboxId : mine[0];
    const mbs = (await api.json(`/rest/v1/mailboxes?id=eq.${id}&select=*`)) || [];
    if (!mbs[0]) return json({ error: "Mailbox not found." }, 404);
    try {
      return json(await createUserFolder(api, env, mbs[0], body.name, body.parent));
    } catch (e) {
      return json({ error: e && e.message ? e.message : String(e) }, 400);
    }
  }

  const filter = mine ? `&id=in.(${mine.join(",")})` : "";
  const mailboxes =
    (await api.json(`/rest/v1/mailboxes?enabled=is.true${filter}&select=*&order=last_sync_at.asc.nullsfirst`)) || [];

  const results = [];
  for (const mb of mailboxes) {
    // Enough left for a useful run (connect, folders, a folder or two).
    if (results.length && api.left < (pushOnly ? 6 : 14)) break;
    try {
      results.push(await syncMailbox(api, env, mb, { pushOnly }));
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!pushOnly) await saveError(api, mb, msg);
      results.push({ mailbox: mb.email, error: msg });
    }
  }

  const failed = results.filter((r) => r.error);
  const sum = (k) => results.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const res = { added: sum("added"), relocated: sum("relocated"), pushed: sum("pushed"), pending: sum("pending"), mailboxes: results };
  if (!viaCron && failed.length && failed.length === results.length) {
    const notConnected = /isn't connected/i.test(failed[0].error);
    return json({ ...res, error: "Inbox sync failed: " + failed[0].error, notConnected }, notConnected ? 503 : 502);
  }
  return json(res);
}
