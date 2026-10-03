/**
 * Cloudflare Pages Function — scoped authenticated proxy to the ShipsGo v2 API.
 *
 * The browser cannot call ShipsGo directly (CORS) and must never see the API
 * token. This function attaches `X-Shipsgo-User-Token` (kept as the
 * `SHIPSGO_TOKEN` environment variable in the Cloudflare Pages dashboard) and
 * forwards the request to https://api.shipsgo.com/v2<path>.
 *
 * The client (src/lib/tracking.ts) owns the ShipsGo-specific knowledge — which
 * path to hit and how to read the response — so this file never needs changing
 * when ShipsGo's schema shifts.
 *
 * Request (POST /api/track):
 *   { "path": "/ocean/shipments", "method": "POST", "query": {...}, "body": {...} }
 * Only GET/POST and paths under /ocean/ or /air/ are allowed. The caller must
 * be a signed-in staff login (Supabase bearer token, profiles.role admin /
 * user — same checks as functions/api/send-mail.ts).
 *
 * Env: SHIPSGO_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Local `npm run dev` (Vite) does not run this — the UI falls back to the cached
 * job_tracking row and tells the user live refresh runs on the deployed site.
 *
 * Not part of the Vite build or `tsc` project (tsconfig includes only `src`);
 * Cloudflare Pages builds `functions/` on its own.
 */

const SHIPSGO_BASE = "https://api.shipsgo.com/v2";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
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

export async function onRequestPost(context) {
  const env = context.env || {};
  const token = env.SHIPSGO_TOKEN;
  if (!token) {
    return json({ error: "SHIPSGO_TOKEN is not configured on this deployment." }, 500);
  }

  const authHeader = context.request.headers.get("authorization");
  const user = await verifyUser(env, authHeader);
  if (!user) return json({ error: "Not authenticated." }, 401);
  if (!(await isStaffUser(env, authHeader, user.id))) {
    return json({ error: "Not permitted." }, 403);
  }

  let req;
  try {
    req = await context.request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const path = String(req.path || "").trim();
  const method = req.method === "POST" ? "POST" : "GET";
  if (!path.startsWith("/ocean/") && !path.startsWith("/air/")) {
    return json({ error: "path must start with /ocean/ or /air/." }, 400);
  }

  const url = new URL(SHIPSGO_BASE + path);
  const query = req.query || {};
  for (const key of Object.keys(query)) {
    const v = query[key];
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(key, String(v));
  }

  const init = {
    method,
    headers: {
      "X-Shipsgo-User-Token": token,
      accept: "application/json",
    },
  };
  if (method === "POST" && req.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }

  let upstream;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (e) {
    return json({ error: "Could not reach ShipsGo: " + (e && e.message ? e.message : e) }, 502);
  }

  const text = await upstream.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    /* leave as text */
  }

  if (!upstream.ok) {
    const code = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
    return json({ error: "ShipsGo returned " + upstream.status, status: upstream.status, payload }, code);
  }

  return json({ ok: true, data: payload });
}
