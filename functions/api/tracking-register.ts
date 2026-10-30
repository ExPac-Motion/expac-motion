/**
 * Cloudflare Pages Function, registers sea shipments with ShipsGo on its
 * own (migration 0205), so tracking starts as soon as a container or BL
 * number is saved, without anyone pressing Refresh in Live Tracking.
 *
 * Each run (pg_cron every 10 minutes): active Sea shipments with a
 * container / BL number that ShipsGo isn't tracking yet (no job_tracking
 * row, a vessel-only AIS row, or a row for a number that has since
 * changed) are created on ShipsGo (1 credit each, as a manual Refresh),
 * and their job_tracking row is marked registered with ShipsGo's id. The
 * first data then arrives on the ShipsGo webhook (tracking-webhook.ts,
 * which matches on the number) and Refresh still works as before.
 *
 * A number ShipsGo already tracks (409) is linked to its existing
 * shipment, no credit. A number ShipsGo rejects is marked failed and not
 * retried until the number changes.
 *
 * Auth: x-cron-key (CRON_SECRET) or a signed-in staff login.
 * Env: SHIPSGO_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

const SHIPSGO_BASE = "https://api.shipsgo.com/v2";
// New registrations per run: each is ~3 requests, inside Cloudflare's
// 50-requests-per-call limit.
const BATCH = 10;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

async function isStaff(env, authHeader) {
  if (!authHeader || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const u = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
    });
    if (!u.ok) return false;
    const user = await u.json();
    if (!user || !user.id) return false;
    const r = await fetch(
      env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + encodeURIComponent(user.id),
      { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader } },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 && (rows[0].role === "admin" || rows[0].role === "user");
  } catch {
    return false;
  }
}

async function sbJson(env, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...(init || {}),
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      ...((init || {}).headers || {}),
    },
  });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** What ShipsGo tracks the job on, as the app's trackableRef (Sea only). */
/** A real number, not a placeholder ("-", "TBA", "N/A"): at least 8
 *  letters / digits, 5 of them digits (as realNumber in src/lib/tracking.ts). */
function realNumber(v) {
  const s = String(v || "").trim();
  const core = s.replace(/[^A-Za-z0-9]/g, "");
  return core.length >= 8 && (core.match(/\d/g) || []).length >= 5 ? s : "";
}

function refOf(job) {
  const container = realNumber(job.container_no);
  if (container) return { value: container, field: "container_number" };
  const bl = realNumber(job.awb_mbl);
  return bl ? { value: bl, field: "bill_of_lading_number" } : null;
}

function idFrom(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const id =
    (p.shipment && (p.shipment.id ?? p.shipment.shipment_id)) ??
    (p.data && (p.data.id ?? p.data.shipment_id)) ??
    p.id ??
    p.shipment_id;
  return id != null ? String(id) : null;
}

async function register(env, ref) {
  const r = await fetch(`${SHIPSGO_BASE}/ocean/shipments`, {
    method: "POST",
    headers: {
      "X-Shipsgo-User-Token": env.SHIPSGO_TOKEN,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ [ref.field]: ref.value }),
  });
  const text = await r.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  // 409 = already tracked on ShipsGo: link to that shipment, no credit.
  if (r.ok || r.status === 409) return { id: idFrom(payload), existing: r.status === 409 };
  return { error: `ShipsGo ${r.status}${payload && payload.message ? `: ${payload.message}` : ""}` };
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;
  const cronKey = request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  if (!viaCron && !(await isStaff(env, request.headers.get("authorization")))) {
    return json({ error: "Not allowed." }, 403);
  }
  if (!env.SHIPSGO_TOKEN) return json({ error: "SHIPSGO_TOKEN is not configured on this deployment." }, 500);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured." }, 500);
  }

  // Active sea shipments with a container or BL number.
  const jobs = (
    await sbJson(
      env,
      "/rest/v1/jobs?select=id,reference,mode,container_no,awb_mbl,shipment_status,ops_completed_at" +
        "&mode=ilike.Sea*&ops_completed_at=is.null&or=(container_no.not.is.null,awb_mbl.not.is.null)",
    )
  ).filter((j) => refOf(j) && j.shipment_status !== "Delivered");
  if (jobs.length === 0) return json({ ok: true, registered: 0 });

  const rows = await sbJson(
    env,
    `/rest/v1/job_tracking?select=job_id,provider,ref_value,tracking_status,provider_ref,shipsgo_id&job_id=in.(${jobs
      .map((j) => j.id)
      .join(",")})`,
  );
  const byJob = new Map(rows.map((r) => [r.job_id, r]));

  // Not on ShipsGo yet: no row, an AIS-only row, or a number that changed.
  // A failed number is left until it's corrected.
  // Registered (or failed) once for this number: never again, so a 409
  // without an id or a rejected number doesn't loop every 10 minutes.
  const all = jobs.filter((j) => {
    const t = byJob.get(j.id);
    const ref = refOf(j);
    if (!t) return true;
    const sameNumber = String(t.ref_value || "").toUpperCase() === ref.value.toUpperCase();
    if (t.provider === "ais") return true;
    if (!sameNumber) return true;
    return !t.provider_ref && !t.shipsgo_id && !t.tracking_status;
  });
  const todo = all.slice(0, BATCH);

  const done = [];
  const failed = [];
  for (const job of todo) {
    const ref = refOf(job);
    const res = await register(env, ref);
    const row = {
      job_id: job.id,
      provider: "shipsgo",
      ref_type: "ocean",
      ref_value: ref.value,
      registered_at: new Date().toISOString(),
    };
    if (res.error) {
      Object.assign(row, { tracking_status: "failed", last_event: res.error });
      failed.push(`${job.reference}: ${res.error}`);
    } else {
      Object.assign(row, { tracking_status: "registered", provider_ref: res.id, shipsgo_id: res.id });
      done.push(`${job.reference}${res.existing ? " (already on ShipsGo)" : ""}`);
    }
    await sbJson(env, "/rest/v1/job_tracking?on_conflict=job_id", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([row]),
    });
  }

  return json({ ok: true, registered: done, failed, next_run: all.length - todo.length });
}
