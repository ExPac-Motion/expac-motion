/**
 * Cloudflare Pages Function — Resend webhook.
 *
 *  - Delivery events (email.delivered / email.opened / email.bounced /
 *    email.complained) → update messages.status where provider_id = the id.
 *  - Inbound replies (email.received, once inbound routing is configured)
 *    → best-effort: match to a shipment via the In-Reply-To / References
 *    header carrying one of our sent Resend ids, then insert an inbound row.
 *
 * Env: RESEND_WEBHOOK_SECRET (svix signing secret, `whsec_...`),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service role — used only here,
 *      because the DB writes run without a user session).
 *
 * Inactive until the user adds the webhook (and, for replies, the inbound MX
 * record) in the Resend dashboard.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Svix signature check: HMAC-SHA256 of `id.timestamp.body`, base64. */
async function verifySvix(secret, headers, rawBody) {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    b64ToBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${id}.${ts}.${rawBody}`),
  );
  const expected = bytesToB64(new Uint8Array(mac));
  return sigHeader
    .split(" ")
    .map((p) => p.split(",")[1])
    .some((s) => s === expected);
}

const STATUS_FROM_TYPE = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "bounced",
};

async function sbPatch(env, path, patch) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
}
async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  return r.ok ? r.json() : [];
}
async function sbInsert(env, table, row) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.RESEND_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Mail webhook is not configured." }, 500);
  }

  const raw = await context.request.text();
  const ok = await verifySvix(env.RESEND_WEBHOOK_SECRET, context.request.headers, raw);
  if (!ok) return json({ error: "Bad signature." }, 401);

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ error: "Bad JSON." }, 400);
  }

  // ---- delivery status ----
  const status = STATUS_FROM_TYPE[evt.type];
  if (status && evt.data && evt.data.email_id) {
    await sbPatch(
      env,
      `messages?provider_id=eq.${encodeURIComponent(evt.data.email_id)}`,
      { status },
    );
    return json({ ok: true });
  }

  // ---- inbound reply (best effort) ----
  if (evt.type === "email.received" || evt.type === "email.inbound") {
    const d = evt.data || {};
    const hdrs = d.headers || {};
    const refs = String(
      hdrs["in-reply-to"] || hdrs["In-Reply-To"] || hdrs.references || "",
    );
    const ids = refs.match(/[0-9a-f-]{20,}/gi) || [];
    let jobId = null;
    for (const pid of ids) {
      const rows = await sbGet(
        env,
        `messages?provider_id=eq.${encodeURIComponent(pid)}&select=job_id&limit=1`,
      );
      if (rows[0]) {
        jobId = rows[0].job_id;
        break;
      }
    }
    if (!jobId) return json({ ok: true, note: "reply not matched to a shipment" });

    await sbInsert(env, "messages", {
      job_id: jobId,
      kind: "email",
      direction: "in",
      from_email: d.from || null,
      subject: d.subject || null,
      body: d.text || d.html || "",
      status: "delivered",
      sent_at: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  return json({ ok: true, ignored: evt.type });
}
