/**
 * Cloudflare Pages Function — send a customer email via Resend.
 *
 * Holds RESEND_API_KEY (Cloudflare Pages env). Verifies the caller is a
 * signed-in Supabase user, then POSTs to https://api.resend.com/emails and
 * returns the Resend message id. The browser writes the `messages` row itself
 * (RLS allows it) so this stays secret-only, matching functions/api/track.ts.
 *
 * Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      CRON_SECRET (optional — lets the follow-up pg_cron job call this with an
 *      `x-cron-key` header instead of a user JWT)
 *
 * Request (POST /api/send-mail):
 *   { jobId, to: string[], cc?: string[], bcc?: string[], subject, html, text,
 *     attachments?: [{ filename, content: base64 }], fromName?, replyTo?,
 *     unsubscribeUrl? }
 *
 * `unsubscribeUrl` (list mail only — campaigns / follow-ups) sets the
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers so Gmail/Outlook/Yahoo
 * show their native one-click unsubscribe and count it favourably toward
 * sender reputation. It should point at /api/unsubscribe (this Pages
 * Function project's own one-click endpoint, not the browser-rendered
 * /unsubscribe page — mail clients POST to it directly with no JS).
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

// Default email typography — Aptos 11pt (matches Word / Outlook), with a
// fallback stack for clients that don't ship Aptos. Kept in sync with
// src/lib/mailStyle.ts (that module is in the Vite build and can't be imported
// here).
const EMAIL_FONT_STACK =
  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const EMAIL_BODY_STYLE =
  "font-family:" + EMAIL_FONT_STACK + ";font-size:11pt;line-height:1.55;color:#2e2e2e";

/** Wrap composed body HTML so every outgoing email defaults to Aptos 11pt.
 *  Idempotent — a body already wrapped by us is left alone. */
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

/** Staff = profiles.role admin / user — mirrors public.is_staff(), including
 *  treating a not-yet-created profile row as staff. Read with the caller's own
 *  token, so RLS lets them see only their own profile. */
async function isStaffUser(env, authHeader, userId) {
  try {
    const r = await fetch(
      env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + encodeURIComponent(userId),
      { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader } },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return true;
    return rows[0].role === "admin" || rows[0].role === "user";
  } catch {
    return false;
  }
}

// Customer-portal and partner-portal logins may only email ExPac itself
// (e.g. the "new portal signup" notice) — never send as ExPac to anyone else.
const INTERNAL_DOMAIN = "@expac.co.za";

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY is not configured on this deployment." }, 500);
  }

  const cronKey = context.request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  let internalOnly = false;
  if (!viaCron) {
    const authHeader = context.request.headers.get("authorization");
    const user = await verifyUser(env, authHeader);
    if (!user) return json({ error: "Not authenticated." }, 401);
    internalOnly = !(await isStaffUser(env, authHeader, user.id));
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
  const baseFrom = env.MAIL_FROM || "EXPAC Forwarding <support@expac.co.za>";
  const fromName = typeof body.fromName === "string" ? body.fromName.trim() : "";
  let from = baseFrom;
  if (fromName) {
    const m = String(baseFrom).match(/<([^>]+)>/);
    from = fromName + " <" + (m ? m[1] : baseFrom) + ">";
  }
  const replyTo =
    (typeof body.replyTo === "string" && body.replyTo.trim()) ||
    env.MAIL_REPLY_TO ||
    "support@expac.co.za";

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

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Could not reach Resend: " + (e && e.message ? e.message : e) }, 502);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    return json(
      { error: (data && (data.message || data.error)) || "Resend returned " + res.status },
      // 429 passes through so the scheduled-campaign sender (0116) knows to
      // retry rather than mark the recipient failed.
      res.status === 429 ? 429 : res.status >= 500 ? 502 : 400,
    );
  }
  return json({ id: data.id });
}
