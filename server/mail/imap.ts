/**
 * A small IMAP client for the Inbox (Cloudflare Pages Functions), shared by
 * /api/inbox-sync and /api/mailbox-connect. It doesn't import
 * cloudflare:sockets itself: the caller passes `connect`, so the same code
 * runs under Node for tests.
 *
 * Not part of the Vite / tsc build; Cloudflare bundles it into the
 * functions that import it.
 */

const enc = new TextEncoder();
export const utf8 = new TextDecoder("utf-8");

export class Imap {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buf = new Uint8Array(0);
    this.n = 0;
    this.caps = new Set();
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
    let from = 0;
    for (;;) {
      for (let i = from; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const l = this.buf.subarray(0, i);
          this.buf = this.buf.subarray(i + 2);
          return utf8.decode(l);
        }
      }
      from = Math.max(0, this.buf.length - 1);
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
    this.readCaps(r.text);
  }
  readCaps(text) {
    const m = text.match(/\[CAPABILITY ([^\]]*)\]/i) || text.match(/^\* CAPABILITY (.*)$/i);
    if (m) this.caps = new Set(m[1].toUpperCase().split(/\s+/));
  }
  /** Runs a command; returns the untagged responses, with the tagged line as `.done`. */
  async cmd(command, literal) {
    const tag = "X" + ++this.n;
    if (literal) {
      await this.writer.write(enc.encode(`${tag} ${command} {${literal.length}}\r\n`));
      const go = await this.response();
      if (!go.text.startsWith("+")) throw new Error(go.text.replace(/^\S+\s/, ""));
      await this.writer.write(literal);
      await this.writer.write(enc.encode("\r\n"));
    } else {
      await this.writer.write(enc.encode(`${tag} ${command}\r\n`));
    }
    const out = [];
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(tag + " ")) {
        if (!new RegExp(`^${tag} OK`, "i").test(r.text)) {
          throw new Error(r.text.slice(tag.length + 1).replace(/\u0000\d+\u0000/g, "…"));
        }
        out.done = r.text;
        return out;
      }
      if (/^\* CAPABILITY /i.test(r.text)) this.readCaps(r.text);
      out.push(r);
    }
  }
  has(cap) {
    return this.caps.has(cap);
  }
}

/** Connects and logs in (993 = TLS, anything else = STARTTLS). */
export async function openImap(connect, { host, port, user, password }) {
  port = Number(port || 993);
  const socket = connect({ hostname: host, port }, { secureTransport: port === 993 ? "on" : "starttls", allowHalfOpen: false });
  let imap = new Imap(socket);
  try {
    await imap.greeting();
    if (port !== 993) {
      await imap.cmd("STARTTLS");
      imap.reader.releaseLock();
      imap.writer.releaseLock();
      imap = new Imap(socket.startTls());
    }
    const login = await imap.cmd(`LOGIN ${quote(user)} ${quote(password)}`);
    imap.readCaps(login.done || "");
    if (!imap.caps.size || !imap.has("IMAP4REV1")) await imap.cmd("CAPABILITY");
  } catch (e) {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    throw e;
  }
  imap.close = async () => {
    await imap.cmd("LOGOUT").catch(() => undefined);
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };
  return imap;
}

export const quote = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

/* ---------- Response parsing ---------- */
export function tokenize(text) {
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
    // atom (incl. BODY[HEADER.FIELDS (A B)], keep bracketed parts together)
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
export function parseList(tokens, pos) {
  const list = [];
  while (pos.i < tokens.length) {
    const t = tokens[pos.i++];
    if (t === "(") list.push(parseList(tokens, pos));
    else if (t === ")") return list;
    else list.push(t);
  }
  return list;
}
export function val(t, lits) {
  if (t == null) return null;
  if (typeof t === "string") return t.toUpperCase() === "NIL" ? null : t;
  if ("s" in t) return t.s;
  if ("lit" in t) return utf8.decode(lits[t.lit]);
  return null;
}

/** RFC 2047 encoded words: =?UTF-8?B?...?= / =?ISO-8859-1?Q?...?= */
export function decodeWords(s) {
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
export function addresses(list, lits) {
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
export function headerValue(headers, name) {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}
export function imapDate(d) {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${mon[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** "* n FETCH (...)" -> { UID, FLAGS, ENVELOPE, ... } */
export function fetchItems(r) {
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

/** "2,4:6" -> [2, 4, 5, 6] (in the order given). */
export function expandSet(set) {
  const out = [];
  for (const part of String(set || "").split(",")) {
    const [a, b] = part.split(":").map(Number);
    if (!a) continue;
    if (!b) out.push(a);
    else if (a <= b) for (let i = a; i <= b; i++) out.push(i);
    else for (let i = a; i >= b; i--) out.push(i);
  }
  return out;
}

/** [COPYUID uidvalidity src dst] from a MOVE / COPY reply -> { uidvalidity, map: {src: dst} } */
export function copyUid(responses) {
  const texts = [...responses.map((r) => r.text), responses.done || ""];
  for (const t of texts) {
    const m = t.match(/\[COPYUID (\d+) ([\d,:]+) ([\d,:]+)\]/i);
    if (!m) continue;
    const src = expandSet(m[2]);
    const dst = expandSet(m[3]);
    const map = {};
    src.forEach((u, i) => (map[u] = dst[i]));
    return { uidvalidity: Number(m[1]), map };
  }
  return null;
}

/** UIDs from "* SEARCH 1 2 3" replies, ascending. */
export function searchUids(responses) {
  return responses
    .flatMap((r) => (r.text.match(/^\* SEARCH(.*)$/i)?.[1] || "").trim().split(/\s+/))
    .filter(Boolean)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

/* ---------- Folders ---------- */

/** IMAP's modified UTF-7 folder names ("Entw&APw-rfe") -> readable text. */
export function decodeFolderName(s) {
  return String(s).replace(/&([^-]*)-/g, (_m, b64) => {
    if (!b64) return "&";
    const bin = atob(b64.replace(/,/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
    let out = "";
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return out;
  });
}

const ROLE_NAMES = {
  sent: /^(inbox[./])?sent( items| messages| mail)?$/i,
  trash: /^(inbox[./])?(trash|deleted( items| messages)?|bin)$/i,
  junk: /^(inbox[./])?(junk( ?e-?mail)?|spam|bulk ?mail)$/i,
  archive: /^(inbox[./])?archives?$/i,
  drafts: /^(inbox[./])?drafts?$/i,
};
const ROLE_FLAGS = { sent: "\\sent", trash: "\\trash", junk: "\\junk", archive: "\\archive", drafts: "\\drafts" };
/** Outlook's own system folders: never synced. */
const SYSTEM = /^(inbox[./])?(outbox|sync issues|conflicts|local failures|server failures|conversation history|rss feeds|rss subscriptions|calendar|contacts|tasks|notes|journal|suggested contacts|quick step settings|yammer root)([./].*)?$/i;

/**
 * Every folder on the server: { path, name, delim, role, flags, selectable }.
 * Roles come from the server's special-use flags (RFC 6154), else the usual
 * names; one folder per role.
 */
export async function listFolders(imap) {
  const list = await imap.cmd('LIST "" "*"');
  const folders = [];
  for (const r of list) {
    const m = r.text.match(/^\* LIST \(([^)]*)\) ("(?:[^"\\]|\\.)*"|NIL) (.+)$/i);
    if (!m) continue;
    const path = val(tokenize(m[3])[0], r.lits);
    if (!path) continue;
    const delim = m[2].toUpperCase() === "NIL" ? null : m[2].slice(1, -1).replace(/\\(.)/g, "$1");
    const flags = m[1].toLowerCase();
    const segs = delim ? path.split(delim) : [path];
    folders.push({
      path,
      delim,
      flags,
      name: decodeFolderName(segs[segs.length - 1]),
      role: upper(path) === "INBOX" ? "inbox" : null,
      selectable: !/\\noselect|\\nonexistent/.test(flags),
      system: SYSTEM.test(decodeFolderName(path)),
    });
  }
  for (const role of Object.keys(ROLE_NAMES)) {
    const f =
      folders.find((x) => !x.role && x.flags.includes(ROLE_FLAGS[role])) ||
      folders.find((x) => !x.role && ROLE_NAMES[role].test(decodeFolderName(x.path).trim()));
    if (f) f.role = role;
  }
  return folders;
}
const upper = (s) => String(s).toUpperCase();

/** STATUS of a folder: { messages, uidnext, uidvalidity, modseq }. */
export async function folderStatus(imap, path) {
  const items = imap.has("CONDSTORE") ? "MESSAGES UIDNEXT UIDVALIDITY HIGHESTMODSEQ" : "MESSAGES UIDNEXT UIDVALIDITY";
  const res = await imap.cmd(`STATUS ${quote(path)} (${items})`);
  const t = res.map((r) => r.text).find((x) => /^\* STATUS /i.test(x)) || "";
  const num = (k) => {
    const m = t.match(new RegExp(`${k} (\\d+)`, "i"));
    return m ? Number(m[1]) : null;
  };
  const ms = t.match(/HIGHESTMODSEQ (\d+)/i);
  return { messages: num("MESSAGES"), uidnext: num("UIDNEXT"), uidvalidity: num("UIDVALIDITY"), modseq: ms ? ms[1] : null };
}

/** Selects a folder; returns its UIDVALIDITY. */
export async function selectFolder(imap, path) {
  const sel = await imap.cmd(`SELECT ${quote(path)}`);
  return Number(sel.map((r) => r.text.match(/UIDVALIDITY (\d+)/i)).find(Boolean)?.[1] || 0);
}

/** Creates a folder (role folders the mailbox doesn't have yet). */
export async function createFolder(imap, path) {
  try {
    await imap.cmd(`CREATE ${quote(path)}`);
  } catch (e) {
    // Already there is fine.
    if (!/exist/i.test(e && e.message ? e.message : String(e))) throw e;
  }
  await imap.cmd(`SUBSCRIBE ${quote(path)}`).catch(() => undefined);
}
