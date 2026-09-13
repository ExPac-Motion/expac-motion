/**
 * Cloudflare Pages Function — RFC 8058 one-click unsubscribe endpoint.
 *
 * This is the target of the `List-Unsubscribe` / `List-Unsubscribe-Post`
 * email headers (see send-mail.ts). Mail clients (Gmail, Outlook, Yahoo) hit
 * this with a bare server-to-server POST — no browser, no JS — so it has to
 * do the real work itself rather than just loading the React app's
 * `/unsubscribe` page (which stays as the human-facing link inside the email
 * body; this endpoint is only ever reached automatically).
 *
 * GET is also handled so the same URL still works if a mail client (or a
 * person) opens it directly.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY (already used by send-mail.ts).
 *
 * Request: /api/unsubscribe?r=<recipient_id | follow_up_log id>
 */

function text(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handle(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const r = url.searchParams.get("r");

  if (!r) return text("Missing unsubscribe reference.", 400);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return text("Unsubscribe is not configured on this deployment.", 500);
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/unsubscribe_lead`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_recipient_id: r }),
    });
    if (!res.ok) return text("Could not process the unsubscribe request.", 502);
  } catch {
    return text("Could not process the unsubscribe request.", 502);
  }

  return text("You have been unsubscribed.", 200);
}

export const onRequestGet = handle;
export const onRequestPost = handle;
