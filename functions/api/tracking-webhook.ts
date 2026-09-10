/**
 * Cloudflare Pages Function — ShipsGo tracking webhook receiver.
 *
 * ShipsGo POSTs here whenever a tracked shipment changes (new status,
 * milestone, ETA). We verify the call, fold the payload into our shape and
 * write job_tracking + tracking_events with the service-role key (no user
 * session on a webhook). Supabase Realtime then pushes the change to the ops
 * board and the customer portal — no polling, no Refresh button.
 *
 * The payload shape isn't fully documented, so parsing here is deliberately
 * tolerant (same approach as normaliseShipsGo in src/lib/tracking.ts) and the
 * raw body is stored on job_tracking.raw for the first hits so it can be tuned.
 *
 * Env (Cloudflare Pages dashboard):
 *   SHIPSGO_WEBHOOK_SECRET   shared secret — matched against the
 *                            X-Shipsgo-Signature HMAC, or an X-Webhook-Token
 *                            header, or a ?token= query param (whichever
 *                            ShipsGo's webhook config supports).
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for mail-webhook)
 *
 * Register in the ShipsGo dashboard:
 *   URL: https://<your-site>/api/tracking-webhook   (or ...?token=<secret>)
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

/* ---------- tolerant pickers ---------- */
const asDict = (v) => (v && typeof v === "object" ? v : {});
const str = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") {
    const o = v;
    const label = o.name ?? o.title ?? o.label ?? o.value ?? o.code ?? o.scac;
    return label != null && label !== "" ? String(label) : null;
  }
  return String(v);
};
const numOrNull = (v) => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : null;
};
const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const dateOnly = (v) => {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const iso = (v) => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Unwrap the shipment object out of whatever envelope ShipsGo sent. */
function unwrapShipment(payload) {
  let s = asDict(payload);
  if (Array.isArray(payload)) s = asDict(payload[0]);
  if (s.data) s = asDict(s.data);
  if (Array.isArray(s.data)) s = asDict(s.data[0]);
  if (s.shipment) s = asDict(s.shipment);
  if (s.result) s = asDict(s.result);
  return s;
}

function normaliseMovements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    const o = asDict(m);
    return {
      code: String(
        pick(o, "code", "event", "eventCode", "event_code", "movementCode",
          "movement_code", "type", "status_code") ?? "",
      ),
      description: str(
        pick(o, "description", "eventDescription", "event_description", "name",
          "event", "status", "event_name", "location_event_description"),
      ),
      date: iso(
        pick(o, "date", "eventDate", "event_date", "timestamp", "actualDate",
          "actual_date", "time", "actual_time", "estimated_time", "datetime"),
      ),
      location: str(
        pick(o, "location", "port", "portName", "port_name", "locationName",
          "location_name", "place", "location_locode"),
      ),
      locode: str(pick(o, "location_locode", "locode", "unlocode")),
      lat: numOrNull(pick(o, "latitude", "lat")),
      lon: numOrNull(pick(o, "longitude", "lng", "lon")),
      vessel: str(pick(o, "vessel", "vesselName", "vessel_name", "ship")),
      voyage: str(pick(o, "voyage", "voyageNumber", "voyage_number", "voyageNo")),
      done: Boolean(
        pick(o, "actual", "is_actual", "isActual", "completed", "done") ??
          pick(o, "actualDate", "actual_date", "eventDate", "event_date"),
      ),
      id: str(pick(o, "id", "event_id", "movement_id", "uuid")),
    };
  });
}

function normalise(payload) {
  const s = unwrapShipment(payload);
  const route = asDict(pick(s, "route", "routeData", "route_data"));
  const pol = asDict(
    pick(route, "pol", "port_of_loading", "portOfLoading", "origin", "loading") ??
      pick(s, "pol", "port_of_loading", "origin"),
  );
  const pod = asDict(
    pick(route, "pod", "port_of_discharge", "portOfDischarge", "destination", "discharge") ??
      pick(s, "pod", "port_of_discharge", "destination"),
  );
  const pos = asDict(
    pick(s, "position", "last_position", "vessel_position", "current_position", "coordinates") ??
      pick(asDict(pick(s, "vessel")), "position"),
  );
  const movements = normaliseMovements(
    pick(s, "movements", "events", "milestones", "timeline", "trackingEvents",
      "tracking_events", "container_movements"),
  );
  return {
    id: str(pick(s, "id", "shipmentId", "shipment_id", "referenceId", "reference_id", "uuid")),
    reference: str(
      pick(s, "reference", "reference_number", "container_number", "containerNumber",
        "awb_number", "awbNumber", "bill_of_lading_number", "blNumber", "number"),
    ),
    status: str(
      pick(s, "status", "shipmentStatus", "shipment_status", "currentStatus",
        "current_status", "state", "status_name"),
    ),
    carrier: str(
      pick(s, "carrier", "carrierName", "carrier_name", "shippingLine",
        "shipping_line", "airline", "airline_name", "scac"),
    ),
    pol: str(pick(pol, "locode", "unlocode", "code", "port", "name", "port_name")),
    pod: str(pick(pod, "locode", "unlocode", "code", "port", "name", "port_name")),
    pol_lat: numOrNull(pick(pol, "latitude", "lat")),
    pol_lon: numOrNull(pick(pol, "longitude", "lng", "lon")),
    pod_lat: numOrNull(pick(pod, "latitude", "lat")),
    pod_lon: numOrNull(pick(pod, "longitude", "lng", "lon")),
    vessel_name: str(pick(s, "vessel_name", "vesselName", "vessel", "ship_name")),
    vessel_imo: str(pick(s, "vessel_imo", "vesselImo", "imo")),
    vessel_lat: numOrNull(pick(pos, "latitude", "lat", "lat_dd")),
    vessel_lon: numOrNull(pick(pos, "longitude", "lng", "lon", "lon_dd")),
    position_at: iso(pick(pos, "timestamp", "time", "updated_at", "received_at")),
    etd: dateOnly(pick(s, "etd", "departureDate", "departure_date", "estimatedDeparture", "estimated_departure", "atd")),
    eta: dateOnly(pick(s, "eta", "arrivalDate", "arrival_date", "estimatedArrival", "estimated_arrival", "ata")),
    pod_eta: iso(pick(s, "eta", "estimatedArrival", "estimated_arrival", "pod_eta")),
    pod_ata: iso(pick(s, "ata", "actualArrival", "actual_arrival", "pod_ata", "arrived_at")),
    last_event: movements.length
      ? movements[movements.length - 1].description || movements[movements.length - 1].code
      : str(pick(s, "lastEvent", "last_event", "lastMovement")),
    movements,
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
  const found = await findJob(env, {
    shipsgoId: n.id,
    numbers: [n.reference],
  });
  if (!found) return json({ ok: true, matched: false });

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
  if (n.pod_eta) patch.pod_eta = n.pod_eta;
  if (n.pod_ata) patch.pod_ata = n.pod_ata;
  if (n.vessel_name) patch.vessel_name = n.vessel_name;
  if (n.vessel_imo) patch.vessel_imo = n.vessel_imo;
  if (n.last_event) patch.last_event = n.last_event;
  if (n.pol_lat != null) { patch.pol_lat = n.pol_lat; patch.pol_lon = n.pol_lon; }
  if (n.pod_lat != null) { patch.pod_lat = n.pod_lat; patch.pod_lon = n.pod_lon; }
  if (n.vessel_lat != null) {
    patch.vessel_lat = n.vessel_lat;
    patch.vessel_lon = n.vessel_lon;
    patch.position_at = n.position_at || new Date().toISOString();
  }
  patch.movements = n.movements.map((m) => ({
    code: m.code,
    description: m.description,
    date: m.date ? m.date.slice(0, 10) : null,
    location: m.location,
    vessel: m.vessel,
    voyage: m.voyage,
    done: m.done,
  }));
  patch.raw = payload;

  await sbPatch(env, `job_tracking?job_id=eq.${jobId}`, patch);

  const eventRows = n.movements
    .filter((m) => m.code || m.description)
    .map((m) => ({
      job_id: jobId,
      provider: "shipsgo",
      provider_event_id: m.id || `${m.code}:${m.date || ""}`,
      event_code: m.code || null,
      description: m.description,
      location: m.location,
      locode: m.locode,
      lat: m.lat,
      lon: m.lon,
      vessel_name: m.vessel,
      voyage: m.voyage,
      occurred_at: m.date,
      is_actual: !!m.done,
    }));
  if (eventRows.length) {
    await sbUpsert(env, "tracking_events", eventRows, "job_id,provider,provider_event_id");
  }

  return json({ ok: true, matched: true, job_id: jobId, events: eventRows.length });
}
