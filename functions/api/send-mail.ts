/**
 * Cloudflare Pages Function, send a customer email via Resend.
 *
 * Holds RESEND_API_KEY (Cloudflare Pages env). Verifies the caller is a
 * signed-in Supabase user, then POSTs to https://api.resend.com/emails and
 * returns the Resend message id. The browser writes the `messages` row itself
 * (RLS allows it) so this stays secret-only, matching functions/api/track.ts.
 *
 * Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      CRON_SECRET (optional, lets the follow-up pg_cron job call this with an
 *      `x-cron-key` header instead of a user JWT)
 *
 * Request (POST /api/send-mail):
 *   { jobId, to: string[], cc?: string[], bcc?: string[], subject, html, text,
 *     attachments?: [{ filename, content: base64 }], fromName?, replyTo?,
 *     unsubscribeUrl? }
 *
 * `unsubscribeUrl` (list mail only, campaigns / follow-ups) sets the
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers so Gmail/Outlook/Yahoo
 * show their native one-click unsubscribe and count it favourably toward
 * sender reputation. It should point at /api/unsubscribe (this Pages
 * Function project's own one-click endpoint, not the browser-rendered
 * /unsubscribe page, mail clients POST to it directly with no JS).
 *
 * Inbox mail (0227): `fromMailbox: true` sends from the caller's own
 * mailbox address (mailboxes, when it's an @expac.co.za address), with
 * replies to it. `copyToSent: "<uuid>"` (needs SUPABASE_SERVICE_ROLE_KEY)
 * also stores a copy of the message as <mailbox>/motion-sent/<uuid>.eml for
 * /api/inbox-sync to put in the mailbox's Sent folder, when the mailbox has
 * two-way on. The reply then carries { mailbox, copy }.
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */
import { buildMime } from "../../server/mail/mime";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

// Default email typography, Aptos 11pt (matches Word / Outlook), with a
// fallback stack for clients that don't ship Aptos. Kept in sync with
// src/lib/mailStyle.ts (that module is in the Vite build and can't be imported
// here).
const EMAIL_FONT_STACK =
  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const EMAIL_BODY_STYLE =
  "font-family:" + EMAIL_FONT_STACK + ";font-size:11pt;line-height:1.55;color:#2e2e2e";

/** Wrap composed body HTML so every outgoing email defaults to Aptos 11pt.
 *  Idempotent, a body already wrapped by us is left alone. */
function withDefaultFont(html) {
  if (!html) return html;
  if (String(html).includes("data-expac-mail-body")) return html;
  // Full document so the head can ask mail apps (iOS Mail, Outlook/Gmail
  // mobile) not to auto-link phone numbers, emails, addresses and dates --
  // they were turning the signature blue and underlined.
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    "<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}</style>" +
    '</head><body><div data-expac-mail-body style="' +
    EMAIL_BODY_STYLE +
    '">' +
    html +
    "</div></body></html>"
  );
}

async function verifyUser(env, authHeader) {
  if (!authHeader || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id } : null;
  } catch {
    return null;
  }
}

/** Staff = profiles.role admin / user, mirrors public.is_staff(), including
 *  where a login with no profile row is NOT staff (0185). Read with the caller's own
 *  token, so RLS lets them see only their own profile. */
async function isStaffUser(env, authHeader, userId) {
  try {
    const r = await fetch(
      env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + encodeURIComponent(userId),
      { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader } },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows[0].role === "admin" || rows[0].role === "user";
  } catch {
    return false;
  }
}

// Customer-portal and partner-portal logins may only email ExPac itself
// (e.g. the "new portal signup" notice), never send as ExPac to anyone else.
const INTERNAL_DOMAIN = "@expac.co.za";

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY is not configured on this deployment." }, 500);
  }

  const cronKey = context.request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  let internalOnly = false;
  let userId = null;
  if (!viaCron) {
    const authHeader = context.request.headers.get("authorization");
    const user = await verifyUser(env, authHeader);
    if (!user) return json({ error: "Not authenticated." }, 401);
    internalOnly = !(await isStaffUser(env, authHeader, user.id));
    userId = user.id;
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];
  const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : [];
  const bccIn = Array.isArray(body.bcc) ? body.bcc.filter(Boolean) : [];
  // Drop any bcc address that's already a visible recipient.
  const visible = new Set([...to, ...cc].map((a) => String(a).toLowerCase()));
  const bcc = bccIn.filter((a) => !visible.has(String(a).toLowerCase()));
  if (to.length === 0) return json({ error: "No recipients." }, 400);
  if (
    internalOnly &&
    ![...to, ...cc, ...bcc].every((a) => String(a).trim().toLowerCase().endsWith(INTERNAL_DOMAIN))
  ) {
    return json({ error: "Not allowed to send email." }, 403);
  }
  // A portal / partner login only sends the portal's own notices to
  // support@: one recipient, no cc / bcc / attachments, plain text only (the
  // HTML is built here from the escaped text, so nothing can be injected).
  if (internalOnly) {
    if (
      to.length !== 1 ||
      String(to[0]).trim().toLowerCase() !== "support@expac.co.za" ||
      cc.length ||
      bcc.length ||
      (Array.isArray(body.attachments) && body.attachments.length)
    ) {
      return json({ error: "Not allowed to send email." }, 403);
    }
    const text = String(body.text || "").slice(0, 5000);
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    body.text = text;
    body.html = "<p>" + esc(text).replace(/\n/g, "<br>") + "</p>";
    body.subject = "[Portal] " + String(body.subject || "Message").slice(0, 150).replace(/^\[Portal\]\s*/, "");
    body.fromName = "ExPac Motion Portal";
    delete body.replyTo;
    delete body.unsubscribeUrl;
    delete body.inReplyTo;
    delete body.references;
    delete body.jobId;
  }
  if (!body.subject || (!body.html && !body.text)) {
    return json({ error: "subject and html/text are required." }, 400);
  }

  // Optional base64 attachments ({ filename, content }). Cap total size so a
  // runaway payload can't be forwarded to Resend.
  const MAX_ATTACH_BYTES = 15 * 1024 * 1024;
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter(
      (a) =>
        a &&
        typeof a.filename === "string" &&
        a.filename &&
        typeof a.content === "string" &&
        a.content,
    )
    .map((a) => ({ filename: String(a.filename), content: String(a.content) }));
  const attachBytes = attachments.reduce(
    (n, a) => n + Math.floor((a.content.length * 3) / 4),
    0,
  );
  if (attachBytes > MAX_ATTACH_BYTES) {
    return json({ error: "Attachments are too large." }, 413);
  }

  // Sender display name / reply-to can be overridden per request (from the
  // configurable email identity in Settings); the address itself stays the
  // verified domain from MAIL_FROM.
  // The brand is written "ExPac": fix an older MAIL_FROM secret that still
  // says "EXPAC Forwarding".
  const baseFrom = String(env.MAIL_FROM || "ExPac Forwarding <support@expac.co.za>").replace(
    /^\s*"?EXPAC Forwarding"?/,
    "ExPac Forwarding",
  );
  const fromName = typeof body.fromName === "string" ? body.fromName.trim() : "";
  let from = baseFrom;
  if (fromName) {
    const m = String(baseFrom).match(/<([^>]+)>/);
    from = fromName + " <" + (m ? m[1] : baseFrom) + ">";
  }
  // Replies must land in a real mailbox. The Resend sending subdomain
  // (send.expac.co.za) has no MX record, so a reply-to there bounces; skip
  // any such address and fall through to the next one.
  const usableReplyTo = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) && !/@send\./i.test(s) ? s : "";
  };
  let replyTo =
    usableReplyTo(body.replyTo) ||
    usableReplyTo(env.MAIL_REPLY_TO) ||
    "support@expac.co.za";

  // Inbox mail goes out from the sender's own mailbox (0227). Resend only
  // sends from a verified domain: if the mailbox's domain isn't verified
  // there, the mail goes from the verified address (MAIL_FROM) under the
  // mailbox's name, with replies to the mailbox (verifiedFrom below).
  let mailbox = null;
  let verifiedFrom = from;
  if (body.fromMailbox && userId && !internalOnly && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(
        env.SUPABASE_URL +
          "/rest/v1/mailboxes?select=id,email,display_name,write_back&owner_id=eq." +
          encodeURIComponent(userId),
        { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } },
      );
      const rows = r.ok ? await r.json() : [];
      mailbox = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch {
      mailbox = null;
    }
    if (mailbox && String(mailbox.email).toLowerCase().endsWith(INTERNAL_DOMAIN)) {
      const name = fromName || mailbox.display_name || "";
      from = name ? name + " <" + mailbox.email + ">" : mailbox.email;
      replyTo = mailbox.email;
      if (name) {
        const m = String(baseFrom).match(/<([^>]+)>/);
        verifiedFrom = name + " <" + (m ? m[1] : baseFrom) + ">";
      }
    }
  }

  const headers = {};
  if (body.jobId) headers["X-Shipment-Id"] = String(body.jobId);
  // Inbox replies (0134) thread under the customer's original message.
  const msgId = (v) => (typeof v === "string" && /^<[^<>\s]+>$/.test(v.trim()) ? v.trim() : "");
  if (msgId(body.inReplyTo)) headers["In-Reply-To"] = msgId(body.inReplyTo);
  if (typeof body.references === "string") {
    const refs = body.references.split(/\s+/).map(msgId).filter(Boolean).slice(-20).join(" ");
    if (refs) headers["References"] = refs;
  }
  if (typeof body.unsubscribeUrl === "string" && body.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${body.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const payload = {
    from,
    to,
    subject: String(body.subject),
    html: withDefaultFont(body.html) || undefined,
    text: body.text || undefined,
    reply_to: replyTo,
    headers: Object.keys(headers).length ? headers : undefined,
  };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (attachments.length) payload.attachments = attachments;

  const sendNow = () =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  let res;
  let data;
  try {
    res = await sendNow();
    data = await res.json().catch(() => ({}));
    // The mailbox's own domain isn't verified on Resend: send again from the
    // verified address (same name, replies still to the mailbox).
    if (!res.ok && payload.from !== verifiedFrom && /not verified|verify your domain/i.test(String((data && (data.message || data.error)) || ""))) {
      payload.from = verifiedFrom;
      from = verifiedFrom;
      res = await sendNow();
      data = await res.json().catch(() => ({}));
    }
  } catch (e) {
    return json({ error: "Could not reach Resend: " + (e && e.message ? e.message : e) }, 502);
  }

  if (!res.ok || !data.id) {
    return json(
      { error: (data && (data.message || data.error)) || "Resend returned " + res.status },
      // 429 passes through so the scheduled-campaign sender (0116) knows to
      // retry rather than mark the recipient failed.
      res.status === 429 ? 429 : res.status >= 500 ? 502 : 400,
    );
  }
  // A copy for the mailbox's Sent folder (put there by /api/inbox-sync).
  let copy = null;
  const copyId =
    typeof body.copyToSent === "string" && /^[0-9a-f-]{36}$/i.test(body.copyToSent) ? body.copyToSent : "";
  if (copyId && mailbox && mailbox.write_back) {
    try {
      const messageId = "<" + copyId + "@motion.expac.co.za>";
      const addr = String(from).match(/^(.*?)\s*<([^>]+)>$/);
      const raw = buildMime({
        fromName: addr ? addr[1].replace(/"/g, "").trim() : "",
        fromEmail: addr ? addr[2] : String(from),
        to,
        cc,
        bcc,
        subject: String(body.subject),
        html: withDefaultFont(body.html) || "",
        text: body.text || "",
        attachments,
        messageId,
        inReplyTo: headers["In-Reply-To"],
        references: headers["References"],
        motionId: copyId,
      });
      const rawPath = mailbox.id + "/motion-sent/" + copyId + ".eml";
      const up = await fetch(env.SUPABASE_URL + "/storage/v1/object/inbox/" + rawPath, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
          "content-type": "message/rfc822",
          "x-upsert": "true",
        },
        body: raw,
      });
      if (up.ok) copy = { rawPath, messageId };
    } catch {
      copy = null;
    }
  }
  return json({
    id: data.id,
    ...(mailbox ? { mailbox: { id: mailbox.id, email: mailbox.email, writeBack: !!mailbox.write_back } } : {}),
    ...(copy ? { copy } : {}),
  });
}
