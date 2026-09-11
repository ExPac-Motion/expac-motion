/**
 * Cloudflare Pages Function — ShipsGo tracking webhook receiver.
 *
 * ShipsGo POSTs here whenever a tracked shipment changes. We verify the
 * call, fold the payload into our shape and write job_tracking +
 * tracking_events with the service-role key (no user session on a webhook).
 * Supabase Realtime then pushes the change to the ops board and the customer
 * portal — no polling, no Refresh button.
 *
 * Confirmed payload shape (captured 2026-09-11, OCEAN.SHIPMENTS.SHIPMENT_UPDATED):
 *   {
 *     event: { id, name: "OCEAN.SHIPMENTS.SHIPMENT_UPDATED", triggered_by },
 *     shipment: {
 *       id, reference, booking_number, container_number, container_count,
 *       status, carrier: { name, scac },
 *       route: {
 *         port_of_loading:  { location: {code,name,country,timezone}, date_of_loading, date_of_loading_initial },
 *         port_of_discharge:{ location: {...}, date_of_discharge, date_of_discharge_initial, date_of_discharge_predicted },
 *         transit_time, transit_percentage
 *       },
 *       containers: [{ number, status, size, type,
 *         movements: [{ event, status: "ACT"|"EST", vessel: {imo,name}|null, voyage, location: {code,name,...}, timestamp }]
 *       }],
 *       created_at, updated_at, checked_at
 *     }
 *   }
 * No GPS coordinates anywhere in this payload — not for the vessel, not even
 * for the ports. PORT_COORDS below is our own lookup so the map has
 * something to plot; "vessel position" is the last movement whose
 * status is "ACT" (a real confirmed event), pinned at that event's port —
 * never a fabricated live GPS fix.
 *
 * Air webhooks (AIR.SHIPMENTS.*) are presumed analogous (airline/flight
 * instead of carrier/vessel) but unconfirmed — normalised best-effort below;
 * tune once a real one lands (payloads are kept on job_tracking.raw).
 *
 * Env (Cloudflare Pages dashboard):
 *   SHIPSGO_WEBHOOK_SECRET   shared secret — matched against the
 *                            X-Shipsgo-Signature HMAC, or an X-Webhook-Token
 *                            header, or a ?token= query param.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for mail-webhook)
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(mac));
}

/** Accept the call if the HMAC matches, or a static token matches. */
async function authorised(env, req, rawBody) {
  const secret = env.SHIPSGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const token =
    req.headers.get("x-webhook-token") ||
    req.headers.get("x-shipsgo-token") ||
    url.searchParams.get("token");
  if (token && token === secret) return true;
  const sig = (req.headers.get("x-shipsgo-signature") || req.headers.get("x-signature") || "")
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (sig && sig === (await hmacHex(secret, rawBody))) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 *  Port coordinates (UN/LOCODE -> [lat, lon])
 *
 *  ShipsGo's webhook carries no GPS data at all, so this curated table is
 *  what puts POL / POD / event pins on the map. City-level accuracy — fine
 *  for a small marker, not survey-grade. Covers the ports ExPac's own
 *  LOCODES list (src/lib/locodes.ts) actually quotes; extend as new lanes
 *  come up (a port missing here just renders without a map pin).
 * ------------------------------------------------------------------ */
const PORT_COORDS = {
  // South Africa
  ZADUR: [-29.8587, 31.0218], ZACPT: [-33.9249, 18.4241], ZAPLZ: [-33.9608, 25.6022],
  ZAZBA: [-33.7961, 25.6929], ZAELS: [-33.0292, 27.8546], ZARCB: [-28.783, 32.0377],
  ZASDB: [-33.0117, 17.9442],
  // Southern & East Africa
  NAWVB: [-22.9576, 14.5053], MZMPM: [-25.9692, 32.5732], MZBEW: [-19.8436, 34.8389],
  TZDAR: [-6.7924, 39.2083], KEMBA: [-4.0435, 39.6682], MUPLU: [-20.1609, 57.5012],
  AOLAD: [-8.8147, 13.2302], NGLOS: [6.4531, 3.3958], GHTEM: [5.6698, -0.0166],
  CIABJ: [5.3097, -4.0126], SNDKR: [14.6928, -17.4467],
  // North Africa
  EGPSD: [31.2653, 32.3019], EGSOK: [29.6033, 32.3567], EGALY: [31.2001, 29.9187],
  MAPTM: [35.8883, -5.5], DZALG: [36.7538, 3.0588], TNRDS: [36.7667, 10.2833],
  // China / HK / Taiwan
  CNSHA: [31.2304, 121.4737], CNNGB: [29.8683, 121.544], CNYTN: [22.5764, 114.2686],
  CNSHK: [22.4833, 113.9], CNSZX: [22.5431, 114.0579], CNCAN: [23.1291, 113.2644],
  CNNSA: [22.7597, 113.6047], CNTAO: [36.0671, 120.3826], CNXMN: [24.4798, 118.0894],
  CNDLC: [38.914, 121.6147], CNTSN: [39.0842, 117.2009], CNLYG: [34.6, 119.2167],
  CNFOC: [26.0745, 119.2965], CNZUH: [22.2707, 113.5767], CNZJG: [31.8757, 120.5553],
  CNSWA: [23.354, 116.6819], HKHKG: [22.3193, 114.1694], TWKHH: [22.6273, 120.3014],
  TWKEL: [25.1276, 121.7392],
  // South-East / East Asia
  SGSIN: [1.2644, 103.822], MYPKG: [3.0, 101.4], MYTPP: [1.3626, 103.5501],
  IDJKT: [-6.1045, 106.8829], IDSUB: [-7.2, 112.7], THLCH: [13.0827, 100.883],
  VNSGN: [10.7626, 106.771], VNHPH: [20.8449, 106.6881], PHMNL: [14.5906, 120.9799],
  KHKOS: [10.6167, 103.5167], KRPUS: [35.1796, 129.0756], KRINC: [37.4563, 126.7052],
  JPYOK: [35.4437, 139.638], JPTYO: [35.6528, 139.8394], JPUKB: [34.6901, 135.1955],
  JPNGO: [35.0824, 136.8814], JPOSA: [34.6413, 135.429],
  // India / South Asia
  INBOM: [18.9388, 72.8354], INNSA: [18.9633, 72.9494], INMUN: [22.8388, 69.722],
  INMAA: [13.0989, 80.2919], INCCU: [22.5504, 88.2939], LKCMB: [6.9497, 79.8442],
  BDCGP: [22.305, 91.7995], PKKHI: [24.8425, 66.9905],
  // Middle East
  AEJEA: [25.0118, 55.0618], SAJED: [21.4858, 39.1925], QADOH: [25.2711, 51.5983],
  OMSLL: [17.0075, 54.0925], IRBND: [27.1461, 56.2358], ILHFA: [32.8156, 34.9892],
  ILASH: [31.8044, 34.6553], TRIST: [40.9679, 28.68], TRMER: [36.8, 34.6333],
  // Europe
  NLRTM: [51.9496, 4.1453], BEANR: [51.2603, 4.4029], BEZEE: [51.3305, 3.205],
  DEHAM: [53.5459, 9.9662], DEBRV: [53.5396, 8.5809], GBFXT: [51.954, 1.351],
  GBSOU: [50.8974, -1.4044], GBLGP: [51.5074, 0.475], FRLEH: [49.4849, 0.1079],
  FRFOS: [43.4333, 4.8667], FRMRS: [43.2965, 5.3698], ESVLC: [39.4699, -0.3763],
  ESBCN: [41.3511, 2.1683], ESALG: [36.1408, -5.4526], ITGOA: [44.4056, 8.9463],
  ITGIT: [38.4241, 15.8994], PTLIS: [38.7223, -9.1393], PTSIE: [37.9558, -8.8647],
  GRPIR: [37.9475, 23.6367], PLGDN: [54.352, 18.6466], SEGOT: [57.7089, 11.9746],
  DKAAR: [56.1496, 10.2134], NOOSL: [59.9139, 10.7522], IEDUB: [53.3498, -6.2603],
  RULED: [59.9311, 30.3609],
  // North America
  USNYC: [40.6892, -74.0445], USLAX: [33.7395, -118.261], USLGB: [33.7701, -118.1937],
  USOAK: [37.7955, -122.2778], USSEA: [47.6062, -122.3421], USTIW: [47.2529, -122.4443],
  USSAV: [32.0809, -81.0912], USCHS: [32.7765, -79.9311], USORF: [36.8508, -76.2859],
  USBAL: [39.2904, -76.6122], USHOU: [29.7604, -95.3698], USMIA: [25.7617, -80.1918],
  CAVAN: [49.2827, -123.1207], CAPRR: [54.315, -130.3208], CAMTR: [45.5017, -73.5673],
  CAHAL: [44.6488, -63.5752], MXZLO: [19.0522, -104.3183], MXVER: [19.1738, -96.1342],
  MXATM: [22.3833, -97.9167], PABLB: [8.95, -79.5667], PACRI: [9.3547, -79.9008],
  // South America
  BRSSZ: [-23.9608, -46.3339], BRPNG: [-25.5163, -48.5225], BRRIO: [-22.9068, -43.1729],
  ARBUE: [-34.6037, -58.3816], UYMVD: [-34.9011, -56.1645], CLVAP: [-33.0472, -71.6127],
  CLSAI: [-33.5928, -71.6122], PECLL: [-12.0464, -77.1428], COCTG: [10.391, -75.4794],
  // Oceania
  AUSYD: [-33.8688, 151.2093], AUMEL: [-37.8136, 144.9631], AUBNE: [-27.4698, 153.0251],
  AUFRE: [-32.0569, 115.7439], NZAKL: [-36.8485, 174.7633], NZTRG: [-37.6878, 176.1651],
};
function portLatLon(locode) {
  const c = locode && PORT_COORDS[String(locode).toUpperCase()];
  return c ? { lat: c[0], lon: c[1] } : { lat: null, lon: null };
}

/* ---------- tolerant scalar helpers ---------- */
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOnly = (v) => {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const iso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Fold the confirmed ShipsGo shape (with light fallbacks for air) into ours. */
function normalise(payload) {
  const shipment = (payload && payload.shipment) || {};
  const eventName = (payload && payload.event && payload.event.name) || "";
  const route = shipment.route || {};
  const pol = route.port_of_loading || route.origin || {};
  const pod = route.port_of_discharge || route.destination || {};
  const polLoc = pol.location || pol || {};
  const podLoc = pod.location || pod || {};
  const carrier = shipment.carrier || shipment.airline || {};

  const containers = Array.isArray(shipment.containers) ? shipment.containers : [];
  const movements = [];
  for (const c of containers) {
    for (const m of Array.isArray(c.movements) ? c.movements : []) {
      const loc = m.location || {};
      const pos = portLatLon(loc.code);
      movements.push({
        containerNumber: c.number || null,
        code: m.event || null,
        isActual: m.status === "ACT",
        vesselName: (m.vessel && m.vessel.name) || null,
        vesselImo: m.vessel && m.vessel.imo != null ? String(m.vessel.imo) : null,
        voyage: m.voyage || null,
        locode: loc.code || null,
        locationName: loc.name || null,
        lat: pos.lat,
        lon: pos.lon,
        occurredAt: iso(m.timestamp),
      });
    }
  }
  movements.sort((a, b) => (a.occurredAt || "").localeCompare(b.occurredAt || ""));
  const actuals = movements.filter((m) => m.isActual);
  // "Last event" reflects what has really happened (confirmed only); the
  // vessel/voyage is the booking's assigned vessel, which is known as soon as
  // it's planned even before it sails — so pull it from the earliest
  // movement that names one, actual or not.
  const latest = actuals.length ? actuals[actuals.length - 1] : movements[movements.length - 1];
  const lastActual = actuals[actuals.length - 1] || null;
  const vesselMovement = movements.find((m) => m.vesselName) || null;

  const polPos = portLatLon(polLoc.code);
  const podPos = portLatLon(podLoc.code);

  const numbers = [
    shipment.container_number,
    shipment.booking_number,
    shipment.reference,
    shipment.awb_number,
    ...containers.map((c) => c.number),
  ].filter(Boolean);

  return {
    id: shipment.id != null ? String(shipment.id) : null,
    numbers,
    status: shipment.status || null,
    carrier: carrier.name || carrier.scac || null,
    pol: polLoc.code || null,
    pod: podLoc.code || null,
    polLat: polPos.lat,
    polLon: polPos.lon,
    podLat: podPos.lat,
    podLon: podPos.lon,
    etd: dateOnly(pol.date_of_loading || pol.date),
    eta: dateOnly(pod.date_of_discharge_predicted || pod.date_of_discharge || pod.date),
    podEta: iso(pod.date_of_discharge_predicted || pod.date_of_discharge || pod.date),
    vesselName: (vesselMovement && vesselMovement.vesselName) || null,
    vesselImo: (vesselMovement && vesselMovement.vesselImo) || null,
    voyage: (vesselMovement && vesselMovement.voyage) || null,
    lastEvent: latest ? [latest.code, latest.locationName].filter(Boolean).join(" @ ") : null,
    // The last CONFIRMED (status "ACT") event's port — never a fabricated
    // live GPS fix, since ShipsGo's webhook doesn't carry one.
    vesselLat: lastActual ? lastActual.lat : null,
    vesselLon: lastActual ? lastActual.lon : null,
    positionAt: lastActual ? lastActual.occurredAt : null,
    movements,
    eventName,
  };
}

/* ---------- Supabase REST (service role) ---------- */
function sbHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(extra || {}),
  };
}
async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  return r.ok ? r.json() : [];
}
async function sbPatch(env, path, patch) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: sbHeaders(env, { "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
}
async function sbUpsert(env, table, rows, onConflict) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: sbHeaders(env, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
}

async function findJob(env, { shipsgoId, numbers }) {
  if (shipsgoId) {
    const byRef = await sbGet(
      env,
      `job_tracking?or=(provider_ref.eq.${encodeURIComponent(shipsgoId)},shipsgo_id.eq.${encodeURIComponent(shipsgoId)})&select=job_id,provider_ref&limit=1`,
    );
    if (byRef[0]) return byRef[0];
  }
  for (const n of numbers) {
    if (!n) continue;
    const rows = await sbGet(
      env,
      `job_tracking?ref_value=ilike.${encodeURIComponent(n)}&select=job_id,provider_ref&limit=1`,
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.SHIPSGO_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Tracking webhook is not configured." }, 500);
  }

  const raw = await context.request.text();
  if (!(await authorised(env, context.request, raw))) {
    return json({ error: "Unauthorised." }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Bad JSON." }, 400);
  }

  const n = normalise(payload);
  if (!n.id && n.numbers.length === 0) {
    return json({ ok: true, matched: false, note: "no shipment in payload" });
  }
  const found = await findJob(env, { shipsgoId: n.id, numbers: n.numbers });
  if (!found) return json({ ok: true, matched: false, event: n.eventName });

  const jobId = found.job_id;
  const patch = {
    synced_at: new Date().toISOString(),
    tracking_status: "registered",
  };
  if (n.id && !found.provider_ref) patch.provider_ref = n.id;
  if (n.carrier) patch.carrier = n.carrier;
  if (n.status) patch.status = n.status;
  if (n.pol) patch.pol = n.pol;
  if (n.pod) patch.pod = n.pod;
  if (n.etd) patch.etd = n.etd;
  if (n.eta) patch.eta = n.eta;
  if (n.podEta) patch.pod_eta = n.podEta;
  if (n.vesselName) patch.vessel_name = n.vesselName;
  if (n.vesselImo) patch.vessel_imo = n.vesselImo;
  if (n.voyage) patch.voyage = n.voyage;
  if (n.lastEvent) patch.last_event = n.lastEvent;
  if (n.polLat != null) {
    patch.pol_lat = n.polLat;
    patch.pol_lon = n.polLon;
  }
  if (n.podLat != null) {
    patch.pod_lat = n.podLat;
    patch.pod_lon = n.podLon;
  }
  // Always set definitively (not just when present) so a bad prior value
  // (e.g. the (0,0) bug from an earlier build) gets corrected either way.
  patch.vessel_lat = n.vesselLat;
  patch.vessel_lon = n.vesselLon;
  patch.position_at = n.positionAt;
  patch.raw = payload;

  await sbPatch(env, `job_tracking?job_id=eq.${jobId}`, patch);

  const eventRows = n.movements
    .filter((m) => m.code)
    .map((m) => ({
      job_id: jobId,
      provider: "shipsgo",
      provider_event_id: `${m.containerNumber || ""}:${m.code}:${m.occurredAt || ""}`,
      event_code: m.code,
      description: [m.code, m.locationName].filter(Boolean).join(" @ ") || m.code,
      location: m.locationName,
      locode: m.locode,
      lat: m.lat,
      lon: m.lon,
      vessel_name: m.vesselName,
      voyage: m.voyage,
      occurred_at: m.occurredAt,
      is_actual: m.isActual,
    }));
  if (eventRows.length) {
    await sbUpsert(env, "tracking_events", eventRows, "job_id,provider,provider_event_id");
  }

  return json({ ok: true, matched: true, job_id: jobId, event: n.eventName, events: eventRows.length });
}
