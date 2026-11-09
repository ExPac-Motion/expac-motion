/**
 * Builds a plain RFC 5322 message (text + HTML, attachments) for the copy of
 * an email sent from Motion that goes into the mailbox's Sent folder
 * (/api/send-mail, migration 0227). The email itself is sent by Resend; this
 * is only the copy Outlook shows under Sent Items.
 *
 * Not part of the Vite / tsc build; Cloudflare bundles it into the
 * functions that import it.
 */

const enc = new TextEncoder();

function b64Bytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const wrap = (s) => s.replace(/(.{76})/g, "$1\r\n");
const ascii = (s) => /^[\x20-\x7e]*$/.test(s);

/** A header value, RFC 2047 encoded when it isn't plain ASCII. */
export function encodeHeader(s) {
  const v = String(s ?? "").replace(/[\r\n]+/g, " ");
  return ascii(v) ? v : `=?UTF-8?B?${b64Bytes(enc.encode(v))}?=`;
}
function mailbox(name, email) {
  if (!name) return email;
  const n = String(name).replace(/[\r\n"]+/g, " ").trim();
  return `${ascii(n) ? `"${n}"` : encodeHeader(n)} <${email}>`;
}

const TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  eml: "message/rfc822",
};
const typeOf = (name) => TYPES[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";

/**
 * { fromName, fromEmail, to[], cc[], bcc[], subject, html, text,
 *   attachments: [{ filename, content (base64) }], messageId, inReplyTo,
 *   references, motionId, date } -> the message's bytes.
 */
export function buildMime(m) {
  const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const mixed = "=_mix_" + id();
  const alt = "=_alt_" + id();
  const h = [
    `From: ${mailbox(m.fromName, m.fromEmail)}`,
    `To: ${(m.to || []).join(", ")}`,
    ...(m.cc && m.cc.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.bcc && m.bcc.length ? [`Bcc: ${m.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(m.subject || "")}`,
    `Date: ${(m.date || new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    ...(m.motionId ? [`X-Motion-Id: ${m.motionId}`] : []),
    "MIME-Version: 1.0",
  ];
  const textPart = (type, body) =>
    `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64Bytes(enc.encode(body || "")))}\r\n`;
  const altBody =
    `--${alt}\r\n${textPart("text/plain", m.text)}` + `--${alt}\r\n${textPart("text/html", m.html)}` + `--${alt}--\r\n`;

  const files = (m.attachments || []).filter((a) => a && a.filename && a.content);
  let body;
  if (!files.length) {
    h.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
    body = altBody;
  } else {
    h.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    body = `--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${altBody}`;
    for (const a of files) {
      const name = encodeHeader(a.filename).replace(/"/g, "");
      body +=
        `--${mixed}\r\nContent-Type: ${typeOf(a.filename)}; name="${name}"\r\n` +
        `Content-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
        `${wrap(String(a.content).replace(/\s+/g, ""))}\r\n`;
    }
    body += `--${mixed}--\r\n`;
  }
  return enc.encode(h.join("\r\n") + "\r\n\r\n" + body);
}
