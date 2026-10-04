/**
 * Cloudflare Pages Function — sync the support@ mailbox into the Admin Inbox
 * (Sales CRM › Inbox, migration 0134).
 *
 * Connects over IMAP (Workers TCP sockets), lists the last 30 days of INBOX,
 * and for each message not yet stored: saves its envelope (from / to / cc /
 * subject / date / Message-ID / threading headers / flags) to
 * inbox_messages and the raw .eml to the private "inbox" storage bucket. The
 * app parses the .eml when a message is opened, so this function stays light
 * (no MIME decoding here). Up to BATCH new messages per run — the 5-minute
 * cron drains any backlog. Also refreshes Seen / Answered flags (read or
 * answered in Outlook / webmail) for the 30-day window.
 *
 * Auth: x-cron-key (pg_cron, CRON_SECRET) or a signed-in Admin / Standard
 * User with the "inbox" permission ("Sync now" in the app).
 *
 * Env: IMAP_HOST, IMAP_PORT (993 = TLS, 143 = STARTTLS), IMAP_USER,
 *      IMAP_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */
import { connect } from "cloudflare:sockets";

const MAILBOX = "support";
const WINDOW_DAYS = 30;
const BATCH = 15;
const MAX_RAW_BYTES = 20 * 1024 * 1024;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

/* ---------- Supabase (service role) ---------- */
function sb(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(extra || {}),
  };
}
async function sbJson(env, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, init);
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function callerMayUseInbox(env, authHeader) {
  if (!authHeader || !env.SUPABASE_ANON_KEY) return false;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_use_inbox`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader, "content-type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

/* ---------- Minimal IMAP client ---------- */
const enc = new TextEncoder();
const utf8 = new TextDecoder("utf-8");

class Imap {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buf = new Uint8Array(0);
    this.n = 0;
  }
  async fill() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error("The mail server closed the connection");
    const b = new Uint8Array(this.buf.length + value.length);
    b.set(this.buf);
    b.set(value, this.buf.length);
    this.buf = b;
  }
  async line() {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const l = this.buf.subarray(0, i);
          this.buf = this.buf.subarray(i + 2);
          return utf8.decode(l);
        }
      }
      await this.fill();
    }
  }
  async bytes(n) {
    const out = new Uint8Array(n);
    let got = Math.min(n, this.buf.length);
    out.set(this.buf.subarray(0, got));
    this.buf = this.buf.subarray(got);
    while (got < n) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("The mail server closed the connection");
      const take = Math.min(n - got, value.length);
      out.set(value.subarray(0, take), got);
      got += take;
      if (take < value.length) this.buf = value.slice(take);
    }
    return out;
  }
  /** One response: its text (literals replaced by \u0000i\u0000) + literal bytes. */
  async response() {
    let text = "";
    const lits = [];
    for (;;) {
      const l = await this.line();
      const m = l.match(/\{(\d+)\}$/);
      if (m) {
        text += l.slice(0, -m[0].length) + `\u0000${lits.length}\u0000`;
        lits.push(await this.bytes(Number(m[1])));
        continue;
      }
      return { text: text + l, lits };
    }
  }
  async greeting() {
    const r = await this.response();
    if (!/^\* (OK|PREAUTH)/i.test(r.text)) throw new Error("Unexpected greeting: " + r.text);
  }
  async cmd(command) {
    const tag = "X" + ++this.n;
    await this.writer.write(enc.encode(`${tag} ${command}\r\n`));
    const out = [];
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(tag + " ")) {
        if (!new RegExp(`^${tag} OK`, "i").test(r.text)) {
          throw new Error(r.text.slice(tag.length + 1).replace(/\u0000\d+\u0000/g, "…"));
        }
        return out;
      }
      out.push(r);
    }
  }
}

const quote = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

/* ---------- IMAP response parsing ---------- */
function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " ") { i++; continue; }
    if (c === "(" || c === ")") { out.push(c); i++; continue; }
    if (c === '"') {
      let s = "";
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        s += text[i++];
      }
      i++;
      out.push({ s });
      continue;
    }
    if (c === "\u0000") {
      const j = text.indexOf("\u0000", i + 1);
      out.push({ lit: Number(text.slice(i + 1, j)) });
      i = j + 1;
      continue;
    }
    // atom (incl. BODY[HEADER.FIELDS (A B)] — keep bracketed parts together)
    let s = "";
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (depth === 0 && (ch === " " || ch === "(" || ch === ")")) break;
      s += ch;
      i++;
    }
    out.push(s);
  }
  return out;
}
function parseList(tokens, pos) {
  const list = [];
  while (pos.i < tokens.length) {
    const t = tokens[pos.i++];
    if (t === "(") list.push(parseList(tokens, pos));
    else if (t === ")") return list;
    else list.push(t);
  }
  return list;
}
function val(t, lits) {
  if (t == null) return null;
  if (typeof t === "string") return t.toUpperCase() === "NIL" ? null : t;
  if ("s" in t) return t.s;
  if ("lit" in t) return utf8.decode(lits[t.lit]);
  return null;
}

/** RFC 2047 encoded words: =?UTF-8?B?...?= / =?ISO-8859-1?Q?...?= */
function decodeWords(s) {
  if (!s || !s.includes("=?")) return s;
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, how, data) => {
      let bytes;
      if (how.toUpperCase() === "B") {
        const bin = atob(data);
        bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      } else {
        const t = data.replace(/_/g, " ");
        const arr = [];
        for (let i = 0; i < t.length; i++) {
          if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
            arr.push(parseInt(t.slice(i + 1, i + 3), 16));
            i += 2;
          } else arr.push(t.charCodeAt(i));
        }
        bytes = new Uint8Array(arr);
      }
      try {
        return new TextDecoder(cs.toLowerCase()).decode(bytes);
      } catch {
        return String.fromCharCode(...bytes);
      }
    });
}
function addresses(list, lits) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(Array.isArray)
    .map((a) => {
      const name = decodeWords(val(a[0], lits));
      const box = val(a[2], lits);
      const host = val(a[3], lits);
      return { name, email: box && host ? `${box}@${host}`.toLowerCase() : null };
    })
    .filter((a) => a.email);
}
function headerValue(headers, name) {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}
function imapDate(d) {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${mon[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** "* n FETCH (...)" -> { UID, FLAGS, ENVELOPE, ... } */
function fetchItems(r) {
  const m = r.text.match(/^\* \d+ FETCH (.*)$/is);
  if (!m) return null;
  const list = parseList(tokenize(m[1]), { i: 0 })[0];
  if (!Array.isArray(list)) return null;
  const o = {};
  for (let i = 0; i + 1 < list.length; i += 2) {
    const k = typeof list[i] === "string" ? list[i].toUpperCase() : "";
    o[k.startsWith("BODY[") ? "BODY" : k] = list[i + 1];
  }
  return o;
}

/** The mailbox's Junk / Spam folder: the one flagged \Junk (RFC 6154), else
 *  a common name (Junk, Junk Email, Junk E-mail, Spam, INBOX.Junk, …). */
async function findJunkFolder(imap) {
  const list = await imap.cmd('LIST "" "*"');
  const folders = [];
  for (const r of list) {
    const m = r.text.match(/^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i);
    if (!m) continue;
    const name = val(tokenize(m[2])[0], r.lits);
    if (name) folders.push({ name, flags: m[1].toLowerCase() });
  }
  const flagged = folders.find((f) => f.flags.includes("\\junk"));
  if (flagged) return flagged.name;
  const named = folders.find((f) =>
    /^(inbox[./])?(junk( ?e-?mail)?|spam|bulk ?mail)$/i.test(f.name.trim()),
  );
  return named ? named.name : null;
}
/** One folder: store its new messages (up to `budget`) and refresh flags. */
async function syncFolder(imap, env, folder, key, spam, budget) {
  const sel = await imap.cmd(`SELECT ${quote(folder)}`);
  const uv = Number(sel.map((r) => r.text.match(/UIDVALIDITY (\d+)/i)).find(Boolean)?.[1] || 0);

  // Last 30 days on the server vs what's stored.
  const since = imapDate(new Date(Date.now() - WINDOW_DAYS * 86400000));
  const found = await imap.cmd(`UID SEARCH SINCE ${since}`);
  const serverUids = found
    .flatMap((r) => (r.text.match(/^\* SEARCH(.*)$/i)?.[1] || "").trim().split(/\s+/))
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  const minUid = serverUids[0] || 0;
  const stored = minUid
    ? await sbJson(
        env,
        `/rest/v1/inbox_messages?select=uid&mailbox=eq.${encodeURIComponent(key)}&uidvalidity=eq.${uv}&uid=gte.${minUid}&direction=eq.in`,
        { headers: sb(env) },
      )
    : [];
  const have = new Set((stored || []).map((r) => Number(r.uid)));
  const pending = serverUids.filter((u) => !have.has(u));
  const batch = budget > 0 ? pending.slice(-budget) : []; // newest first

  let added = 0;
  if (batch.length) {
    const meta = await imap.cmd(
      `UID FETCH ${batch.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE ` +
        `BODY.PEEK[HEADER.FIELDS (REFERENCES AUTO-SUBMITTED PRECEDENCE LIST-UNSUBSCRIBE LIST-ID)])`,
    );
    const rows = [];
    for (const r of meta) {
      const o = fetchItems(r);
      if (!o || !o.UID) continue;
      const uid = Number(val(o.UID, r.lits));
      const env_ = o.ENVELOPE || [];
      const flags = (Array.isArray(o.FLAGS) ? o.FLAGS : []).map((f) => String(f).toLowerCase());
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
      rows.push({
        mailbox: key,
        // only Junk rows carry the column (0136), so Inbox sync never depends on it
        ...(spam ? { spam: true } : {}),
        uidvalidity: uv,
        uid,
        direction: "in",
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
        is_bulk: !!bulk,
        sent_at: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
        seen: flags.includes("\\seen"),
        answered: flags.includes("\\answered"),
        raw_path: null,
        has_attachments: false,
      });
    }

    // Raw source -> storage, one message at a time.
    for (const row of rows) {
      if (row.size_bytes && row.size_bytes > MAX_RAW_BYTES) continue;
      const res = await imap.cmd(`UID FETCH ${row.uid} (UID BODY.PEEK[])`);
      const lit = res.find((r) => r.lits.length)?.lits?.[0];
      if (!lit) continue;
      const path = `${key.replace(/[^a-z0-9-]/gi, "_")}/${uv}/${row.uid}.eml`;
      const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/inbox/${path}`, {
        method: "POST",
        headers: sb(env, { "content-type": "message/rfc822", "x-upsert": "true" }),
        body: lit,
      });
      if (up.ok) {
        row.raw_path = path;
        row.has_attachments = /content-disposition:\s*attachment/i.test(
          utf8.decode(lit.subarray(0, Math.min(lit.length, 400000))),
        );
      }
    }

    if (rows.length) {
      await sbJson(env, `/rest/v1/inbox_messages?on_conflict=mailbox,uidvalidity,uid`, {
        method: "POST",
        headers: sb(env, {
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=minimal",
        }),
        body: JSON.stringify(rows),
      });
      added = rows.length;
    }
  }

  // Seen / Answered changed elsewhere (Outlook, webmail).
  if (minUid) {
    const fl = await imap.cmd(`UID FETCH ${minUid}:* (UID FLAGS)`);
    const flags = {};
    for (const r of fl) {
      const o = fetchItems(r);
      if (!o || !o.UID) continue;
      const f = (Array.isArray(o.FLAGS) ? o.FLAGS : []).map((x) => String(x).toLowerCase());
      flags[Number(val(o.UID, r.lits))] = [f.includes("\\seen"), f.includes("\\answered")];
    }
    if (Object.keys(flags).length) {
      await sbJson(env, `/rest/v1/rpc/inbox_apply_flags`, {
        method: "POST",
        headers: sb(env, { "content-type": "application/json" }),
        body: JSON.stringify({ p_mailbox: key, p_uidvalidity: uv, p_flags: flags }),
      });
    }
  }

  return { added, pending: Math.max(0, pending.length - added), uidvalidity: uv };
}

/* ---------- Sync ---------- */
async function sync(env) {
  const port = Number(env.IMAP_PORT || 993);
  const socket = connect(
    { hostname: env.IMAP_HOST, port },
    { secureTransport: port === 993 ? "on" : "starttls", allowHalfOpen: false },
  );
  let imap = new Imap(socket);
  try {
    await imap.greeting();
    if (port !== 993) {
      await imap.cmd("STARTTLS");
      imap.reader.releaseLock();
      imap.writer.releaseLock();
      imap = new Imap(socket.startTls());
    }
    await imap.cmd(`LOGIN ${quote(env.IMAP_USER)} ${quote(env.IMAP_PASSWORD)}`);
    // The Inbox first, then the Junk / Spam folder (if the mailbox has one),
    // sharing one batch budget per run.
    const main = await syncFolder(imap, env, "INBOX", MAILBOX, false, BATCH);
    let junkPending = 0;
    // A Junk-folder problem never stops the Inbox sync.
    try {
      const junk = await findJunkFolder(imap);
      if (junk) {
        const j = await syncFolder(imap, env, junk, `${MAILBOX}:junk`, true, BATCH - main.added);
        junkPending = j.pending;
        main.added += j.added;
      }
    } catch {
      /* Junk folder unreadable or 0136 not applied yet — Inbox still synced */
    }
    await imap.cmd("LOGOUT").catch(() => undefined);
    return { added: main.added, pending: main.pending + junkPending, uidvalidity: main.uidvalidity };
  } finally {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
}

async function saveState(env, patch) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/inbox_state?on_conflict=mailbox`, {
    method: "POST",
    headers: sb(env, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({ mailbox: MAILBOX, ...patch }),
  }).catch(() => undefined);
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase isn't configured on this deployment." }, 500);
  }
  const cronKey = request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  if (!viaCron && !(await callerMayUseInbox(env, request.headers.get("authorization")))) {
    return json({ error: "Not allowed." }, 403);
  }
  if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASSWORD) {
    return json(
      {
        error:
          "The inbox isn't connected yet — add IMAP_HOST, IMAP_PORT, IMAP_USER and IMAP_PASSWORD " +
          "to the Cloudflare Pages project (Settings › Variables and Secrets), then redeploy.",
        notConnected: true,
      },
      503,
    );
  }
  try {
    const r = await sync(env);
    await saveState(env, {
      uidvalidity: r.uidvalidity,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      pending: r.pending,
    });
    return json(r);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await saveState(env, { last_sync_at: new Date().toISOString(), last_error: msg });
    return json({ error: "Inbox sync failed: " + msg }, 502);
  }
}
