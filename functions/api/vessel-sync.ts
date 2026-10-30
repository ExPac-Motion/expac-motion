/**
 * Cloudflare Pages Function, vessel tracking on the free aisstream.io AIS
 * feed (migration 0204), for sea shipments with no container / BL to give
 * ShipsGo (e.g. DDP agents who may not share them).
 *
 * Each run: loads the active sea shipments that have a vessel MMSI (and no
 * ShipsGo tracking), opens one WebSocket to aisstream filtered to those
 * ships, listens for up to LISTEN_MS, then writes what it heard to
 * job_tracking (provider 'ais'):
 *   - position, speed, navigation status, when it was seen
 *   - ATD: the last fix at the port of loading, once the ship is seen
 *     underway away from it (a ship first seen already at sea gets no ATD)
 *   - ETA: the ship's own AIS ETA when its AIS destination is our port of
 *     discharge; otherwise that destination + ETA as "next port"
 *   - ATA: first fix stopped (anchored / moored / under 1 kn) near the port
 *     of discharge, after departure or after the ETD
 * and marks Departed / Arrived on the timeline (ais_mark_step). Supabase
 * Realtime then refreshes the open screens.
 *
 * Terrestrial AIS: ships near the coast and in port are seen within
 * seconds; mid-ocean they drop out until the next coast, which is fine for
 * ATD / ETA / ATA. The ship's destination + ETA (AIS static data) is only
 * broadcast every ~6 minutes, so it arrives on some runs, not all.
 *
 * Auth: x-cron-key (pg_cron every 10 minutes, CRON_SECRET) or a signed-in
 * staff login ("Check now"; body { jobId } checks just that shipment).
 *
 * Env: AISSTREAM_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */
import { PORT_COORDS } from "../../src/lib/places";

const AIS_URL = "https://stream.aisstream.io/v0/stream";
// Listening window per run, inside pg_net's 55 s timeout (0204).
const LISTEN_MS = 40_000;
// aisstream allows up to 50 MMSIs per subscription.
const MAX_VESSELS = 50;
// "At the port" radius. Our port points are city level, and some
// terminals sit well off the city (Shanghai's Yangshan is ~85 km out), so
// the loading side is generous; South African discharge ports are close.
const POL_KM = 100;
const POD_KM = 60;
// Underway speed (knots) that counts as having left the port of loading.
const UNDERWAY_KN = 3;
// AIS navigational status: 1 at anchor, 5 moored.
const STOPPED_NAV = new Set([1, 5]);
const NAV_TEXT = {
  0: "Under way using engine", 1: "At anchor", 2: "Not under command", 3: "Restricted manoeuvrability",
  4: "Constrained by draught", 5: "Moored", 6: "Aground", 7: "Engaged in fishing", 8: "Under way sailing",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

/* ---------- Auth ---------- */
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

/* ---------- Supabase (service role) ---------- */
function sb(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(extra || {}),
  };
}
async function sbJson(env, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, { ...(init || {}), headers: sb(env, (init || {}).headers) });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* ---------- Ports ---------- */
function locodeOf(place) {
  const s = String(place || "").trim().toUpperCase();
  const m = s.match(/^([A-Z]{2})\s?([A-Z0-9]{3})\b/);
  return m ? m[1] + m[2] : "";
}
/** "ZADUR, Durban, South Africa" -> "DURBAN" (for matching AIS destinations). */
function cityOf(place) {
  const parts = String(place || "").split(",").map((p) => p.trim()).filter(Boolean);
  const city = locodeOf(place) ? parts[1] : parts[0];
  return (city || "").toUpperCase().replace(/[^A-Z]/g, "");
}
/** "ZADUR, Durban, South Africa" -> "Durban" (for the status line). */
function cityName(place) {
  const parts = String(place || "").split(",").map((p) => p.trim()).filter(Boolean);
  return (locodeOf(place) ? parts[1] : parts[0]) || "";
}
function coordsOf(place) {
  const c = PORT_COORDS[locodeOf(place)];
  return c ? { lat: c[0], lon: c[1] } : null;
}
function km(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** AIS destination ("ZADUR", "ZA DUR", "DURBAN", "CNSHA>ZADUR") is our POD? */
function isPod(destination, job) {
  const d = String(destination || "").toUpperCase().split(">").pop().replace(/[^A-Z]/g, "");
  if (!d) return false;
  const code = locodeOf(job.destination);
  const city = cityOf(job.destination);
  return (!!code && d.includes(code)) || (!!city && city.length >= 4 && d.includes(city));
}

/* ---------- AIS ---------- */
function aisTime(meta) {
  // "2026-10-30 08:12:01.123456789 +0000 UTC"
  const m = String((meta && meta.time_utc) || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}Z`) : new Date();
}
/** AIS ETA has no year: the next such date (allowing a month in the past). */
function aisEta(eta, now) {
  if (!eta || !eta.Month || !eta.Day || eta.Month > 12 || eta.Day > 31) return null;
  const hour = eta.Hour < 24 ? eta.Hour : 0;
  const minute = eta.Minute < 60 ? eta.Minute : 0;
  let d = new Date(Date.UTC(now.getUTCFullYear(), eta.Month - 1, eta.Day, hour, minute));
  if (d.getTime() < now.getTime() - 30 * 86_400_000) {
    d = new Date(Date.UTC(now.getUTCFullYear() + 1, eta.Month - 1, eta.Day, hour, minute));
  }
  return d;
}

/** Listen to aisstream for these MMSIs; latest position + static data each. */
async function listen(apiKey, mmsis) {
  const heard = new Map(); // mmsi -> { pos?, stat? }
  const want = new Set(mmsis);
  const resp = await fetch(AIS_URL, { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (!ws) throw new Error(`aisstream refused the connection (${resp.status})`);
  ws.accept();
  return await new Promise((resolve) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close(1000, "done");
      } catch {
        /* already closed */
      }
      resolve({ heard, error });
    };
    const timer = setTimeout(() => finish(null), LISTEN_MS);
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.error) return finish(String(msg.error));
      const meta = msg.MetaData || {};
      const mmsi = String(meta.MMSI || "");
      if (!want.has(mmsi)) return;
      const entry = heard.get(mmsi) || {};
      const body = msg.Message || {};
      if (msg.MessageType === "PositionReport" && body.PositionReport) {
        const p = body.PositionReport;
        const lat = p.Latitude ?? meta.latitude ?? meta.Latitude;
        const lon = p.Longitude ?? meta.longitude ?? meta.Longitude;
        if (typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          entry.pos = { lat, lon, sog: p.Sog ?? null, nav: p.NavigationalStatus ?? null, at: aisTime(meta) };
        }
      } else if (msg.MessageType === "ShipStaticData" && body.ShipStaticData) {
        const s = body.ShipStaticData;
        entry.stat = {
          destination: String(s.Destination || "").trim(),
          eta: s.Eta || null,
          imo: s.ImoNumber ? String(s.ImoNumber) : null,
          name: String(s.Name || meta.ShipName || "").trim(),
          at: aisTime(meta),
        };
      }
      heard.set(mmsi, entry);
      // Everything heard (position + static for every ship): stop early.
      if (heard.size === want.size && [...heard.values()].every((e) => e.pos && e.stat)) finish(null);
    });
    ws.addEventListener("close", () => finish(null));
    ws.addEventListener("error", () => finish("WebSocket error"));
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: mmsis,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      }),
    );
  });
}

/* ---------- Fold one ship's news into its shipment ---------- */
function update(job, prev, news, now) {
  const pol = coordsOf(job.origin);
  const pod = coordsOf(job.destination);
  const podName = cityName(job.destination) || locodeOf(job.destination) || "destination";
  const row = {
    job_id: job.id,
    provider: "ais",
    tracking_status: "registered",
    ref_type: "ocean",
    ref_value: job.vessel_mmsi,
    vessel_mmsi: job.vessel_mmsi,
    vessel_name: job.vessel_name || (prev && prev.vessel_name) || null,
    voyage: job.voyage_no || null,
    carrier: job.shipping_line || (prev && prev.carrier) || null,
    pol: locodeOf(job.origin) || job.origin || null,
    pod: locodeOf(job.destination) || job.destination || null,
    pol_lat: pol ? pol.lat : null,
    pol_lon: pol ? pol.lon : null,
    pod_lat: pod ? pod.lat : null,
    pod_lon: pod ? pod.lon : null,
    etd: job.etd || null,
    atd: (prev && prev.atd) || null,
    pol_seen_at: (prev && prev.pol_seen_at) || null,
    pod_ata: (prev && prev.pod_ata) || null,
    synced_at: now.toISOString(),
  };
  const marks = [];
  if (!prev) row.status = "Waiting for AIS signal";

  const pos = news && news.pos;
  if (pos) {
    const at = pos.at.toISOString();
    const here = { lat: pos.lat, lon: pos.lon };
    const dPol = pol ? km(here, pol) : Infinity;
    const dPod = pod ? km(here, pod) : Infinity;
    const stopped = (pos.sog !== null && pos.sog < 1) || STOPPED_NAV.has(pos.nav);
    Object.assign(row, {
      vessel_lat: pos.lat,
      vessel_lon: pos.lon,
      position_at: at,
      speed_kn: pos.sog,
      nav_status: NAV_TEXT[pos.nav] || null,
    });

    if (!row.atd) {
      if (dPol <= POL_KM) row.pol_seen_at = at;
      else if (row.pol_seen_at && pos.sog !== null && pos.sog >= UNDERWAY_KN) {
        row.atd = row.pol_seen_at;
        marks.push({ step: "Departed", at: row.atd });
      }
    }
    const afterEtd = job.etd && at.slice(0, 10) >= job.etd;
    if (!row.pod_ata && dPod <= POD_KM && stopped && (row.atd || afterEtd)) {
      row.pod_ata = at;
      marks.push({ step: "Arrived", at });
    }

    const dist = Number.isFinite(dPod) ? `, ${Math.round(dPod).toLocaleString("en-ZA")} km from ${podName}` : "";
    row.status = row.pod_ata
      ? `Arrived ${podName}`
      : dPod <= POD_KM
        ? `${stopped ? "At anchor / berth" : "Arriving"} ${podName}`
        : row.atd
          ? stopped ? "In transit, stopped" : "In transit"
          : dPol <= POL_KM
            ? "At port of loading"
            : "In transit";
    row.last_event = `AIS ${pos.sog !== null ? pos.sog.toFixed(1) + " kn" : "position"}${dist}`;
  }

  const stat = news && news.stat;
  if (stat) {
    row.next_port = stat.destination || null;
    const eta = aisEta(stat.eta, now);
    row.next_port_eta = eta ? eta.toISOString() : null;
    row.static_at = stat.at.toISOString();
    if (stat.imo && stat.imo !== "0") row.vessel_imo = stat.imo;
    if (!row.vessel_name && stat.name) row.vessel_name = stat.name;
    if (eta && isPod(stat.destination, job) && !row.pod_ata) {
      row.pod_eta = eta.toISOString();
      row.eta = eta.toISOString().slice(0, 10);
    }
  }
  return { row, marks };
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;
  const cronKey = request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  if (!viaCron && !(await isStaff(env, request.headers.get("authorization")))) {
    return json({ error: "Not allowed." }, 403);
  }
  if (!env.AISSTREAM_KEY) return json({ error: "AISSTREAM_KEY is not configured on this deployment." }, 500);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured." }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* cron sends {} */
  }
  const onlyJob = typeof body.jobId === "string" ? body.jobId : null;

  // Active sea shipments with a vessel MMSI, not yet arrived.
  const filter = onlyJob ? `&id=eq.${encodeURIComponent(onlyJob)}` : "";
  const jobs = (
    await sbJson(
      env,
      `/rest/v1/jobs?select=id,reference,mode,origin,destination,vessel_name,vessel_mmsi,voyage_no,shipping_line,etd,shipment_status,ops_completed_at` +
        `&vessel_mmsi=not.is.null&mode=ilike.Sea*${filter}`,
    )
  ).filter((j) => /^\d{9}$/.test(String(j.vessel_mmsi || "").trim()) && !j.ops_completed_at);
  if (jobs.length === 0) return json({ ok: true, checked: 0 });

  const ids = jobs.map((j) => j.id);
  const prevRows = await sbJson(
    env,
    `/rest/v1/job_tracking?select=job_id,provider,atd,pol_seen_at,pod_ata,vessel_name,carrier&job_id=in.(${ids.join(",")})`,
  );
  const prevByJob = new Map(prevRows.map((r) => [r.job_id, r]));
  // ShipsGo stays in charge where it tracks the shipment; arrived ones are done.
  const tracked = jobs
    .filter((j) => {
      const p = prevByJob.get(j.id);
      return !p || (p.provider === "ais" && (!p.pod_ata || onlyJob));
    })
    .slice(0, MAX_VESSELS);
  if (tracked.length === 0) return json({ ok: true, checked: 0 });

  for (const j of tracked) j.vessel_mmsi = String(j.vessel_mmsi).trim();
  const mmsis = [...new Set(tracked.map((j) => j.vessel_mmsi))];
  const { heard, error } = await listen(env.AISSTREAM_KEY, mmsis);

  const now = new Date();
  const rows = [];
  const marks = [];
  for (const job of tracked) {
    const prev = prevByJob.get(job.id) || null;
    const news = heard.get(job.vessel_mmsi) || null;
    if (!news && prev) continue; // nothing new, nothing to write
    const r = update(job, prev, news, now);
    rows.push(r.row);
    for (const m of r.marks) marks.push({ job: job.id, ...m });
  }

  // One upsert per set of columns: in a bulk upsert PostgREST writes every
  // column of the batch on every row (a missing key becomes null), so a
  // ship heard without a position must not share a batch with one heard
  // with a position, or its stored position would be wiped.
  const batches = new Map();
  for (const r of rows) {
    const key = Object.keys(r).sort().join(",");
    batches.set(key, [...(batches.get(key) || []), r]);
  }
  for (const batch of batches.values()) {
    await sbJson(env, "/rest/v1/job_tracking?on_conflict=job_id", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
  }
  for (const m of marks) {
    await sbJson(env, "/rest/v1/rpc/ais_mark_step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ p_job: m.job, p_step: m.step, p_at: m.at }),
    });
  }

  return json({
    ok: true,
    checked: tracked.length,
    heard: [...heard.keys()].length,
    updated: rows.length,
    marked: marks.map((m) => `${m.step} ${m.job}`),
    ...(error ? { warning: error } : {}),
  });
}
