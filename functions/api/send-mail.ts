/**
 * Cloudflare Pages Function — send a customer email via Resend.
 *
 * Holds RESEND_API_KEY (Cloudflare Pages env). Verifies the caller is a
 * signed-in Supabase user, then POSTs to https://api.resend.com/emails and
 * returns the Resend message id. The browser writes the `messages` row itself
 * (RLS allows it) so this stays secret-only, matching functions/api/track.ts.
 *
 * Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Request (POST /api/send-mail):
 *   { jobId, to: string[], cc?: string[], subject, html, text }
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

async function verifyUser(env, authHeader) {
  if (!authHeader || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY is not configured on this deployment." }, 500);
  }

  const ok = await verifyUser(env, context.request.headers.get("authorization"));
  if (!ok) return json({ error: "Not authenticated." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];
  const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : [];
  if (to.length === 0) return json({ error: "No recipients." }, 400);
  if (!body.subject || (!body.html && !body.text)) {
    return json({ error: "subject and html/text are required." }, 400);
  }

  const payload = {
    from: env.MAIL_FROM || "EXPAC Forwarding <support@expac.co.za>",
    to,
    subject: String(body.subject),
    html: body.html || undefined,
    text: body.text || undefined,
    reply_to: env.MAIL_REPLY_TO || "support@expac.co.za",
    headers: body.jobId ? { "X-Shipment-Id": String(body.jobId) } : undefined,
  };
  if (cc.length) payload.cc = cc;

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
      res.status >= 500 ? 502 : 400,
    );
  }
  return json({ id: data.id });
}
