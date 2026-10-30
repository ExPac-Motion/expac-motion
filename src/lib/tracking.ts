import { supabase } from "./supabase";
import type { Job, JobTracking, TrackingEvent, TrackingMovement } from "./types";
import { placeOf } from "./places";
import { slimRoutePath, type RoutePath } from "./trackRoute";

/* ------------------------------------------------------------------ *
 *  ShipsGo v2 wiring
 *
 *  The browser hits our own /api/track Cloudflare Pages Function, which
 *  attaches the secret X-Shipsgo-User-Token and forwards to
 *  https://api.shipsgo.com/v2<path>. Everything ShipsGo-specific lives
 *  here so it can be tuned without touching the function.
 *
 *  ⚠️  Verify these two paths and the field mapping in normaliseShipsGo()
 *  against your account's OpenAPI spec (api.shipsgo.com/docs/v2) before the
 *  first real pull, the UI already renders fine from a job_tracking row,
 *  so a wrong path only breaks the Refresh button, not the page.
 * ------------------------------------------------------------------ */
const SHIPSGO_PATH = {
  ocean: "/ocean/shipments",
  air: "/air/shipments",
};

/**
 * Public ShipsGo *embed* token (the widget on expac.co.za/live-tracking), not
 * the secret API user token. Safe in the client; override per deploy with
 * VITE_SHIPSGO_EMBED_TOKEN.
 */
export const SHIPSGO_EMBED_TOKEN =
  (import.meta.env.VITE_SHIPSGO_EMBED_TOKEN as string | undefined) ??
  "e92958ae-5092-41b7-88c1-9da6c04eb585";

export function shipsgoEmbedUrl(): string {
  return `https://embed.shipsgo.com/?token=${SHIPSGO_EMBED_TOKEN}`;
}

export interface TrackableRef {
  type: "ocean" | "air";
  value: string;
  /** UI badge: CONTAINER / MBL / AWB. */
  label: string;
}

/**
 * What (if anything) we can track this job on:
 *  - a container number  -> ocean
 *  - AWB/MBL on an Air or Courier job -> air (AWB)
 *  - AWB/MBL on a Sea job -> ocean (Bill of Lading)
 */
export function trackableRef(job: Job): TrackableRef | null {
  const container = (job.container_no ?? "").trim();
  if (container) return { type: "ocean", value: container, label: "CONTAINER" };

  const doc = (job.awb_mbl ?? "").trim();
  if (!doc) return null;

  const mode = job.mode ?? "";
  if (mode.startsWith("Air") || mode.startsWith("Courier")) {
    return { type: "air", value: doc, label: "AWB" };
  }
  if (mode.startsWith("Sea")) {
    return { type: "ocean", value: doc, label: "MBL" };
  }
  return { type: "ocean", value: doc, label: "REF" };
}

/**
 * Vessel tracking on AIS (0204): a Sea job with no container / BL for
 * ShipsGo, but a vessel MMSI. The server (/api/vessel-sync) follows the
 * ship; this is only what the screens show and which button refreshes it.
 */
export function vesselRef(job: Job): { mmsi: string; label: string } | null {
  if (trackableRef(job) || !(job.mode ?? "").startsWith("Sea")) return null;
  const mmsi = (job.vessel_mmsi ?? "").trim();
  if (!/^\d{9}$/.test(mmsi)) return null;
  const label = [job.vessel_name, job.voyage_no].filter((v) => (v ?? "").trim()).join(" / ") || `MMSI ${mmsi}`;
  return { mmsi, label };
}

/** Tracked one way or the other: ShipsGo number or AIS vessel. */
export function isTracked(job: Job): boolean {
  return !!trackableRef(job) || !!vesselRef(job);
}

/** VesselFinder search by name, where the MMSI is found (free). */
export function vesselSearchUrl(name: string | null | undefined): string {
  const q = (name ?? "").trim();
  return q ? `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(q)}` : "https://www.vesselfinder.com/vessels";
}

/** Colour band for a tracking status pill: start | mid | done | alert. */
export function trackingTone(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (!s) return "start";
  if (/(detain|hold|delay|roll|exception|problem|cancel)/.test(s)) return "alert";
  if (/(deliver|discharg|arrived|arrival|completed|gate out|empty return)/.test(s))
    return "done";
  if (/(transit|sail|depart|load|on board|vessel|transship|rail|road)/.test(s))
    return "mid";
  return "start";
}

/** True when the tracked ETA has slipped past the planned ETA. */
export function etaSlipped(
  plannedEta: string | null | undefined,
  trackedEta: string | null | undefined,
): boolean {
  if (!plannedEta || !trackedEta) return false;
  return new Date(trackedEta).getTime() > new Date(plannedEta).getTime();
}

/* ---------- response normalisation ---------- */

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") {
    // ShipsGo sometimes nests { name, code, scac, ... }, dig out a label.
    const o = v as Record<string, unknown>;
    const label = o.name ?? o.title ?? o.label ?? o.value ?? o.code ?? o.scac;
    return label != null && label !== "" ? String(label) : null;
  }
  return String(v);
};
const pick = (o: Dict, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
/** ShipsGo dates come through in a few shapes; keep the yyyy-mm-dd head. */
const dateOnly = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

export interface NormalisedTracking {
  shipsgo_id: string | null;
  status: string | null;
  carrier: string | null;
  pol: string | null;
  pod: string | null;
  etd: string | null;
  eta: string | null;
  last_event: string | null;
  movements: TrackingMovement[];
}

const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function normaliseMovements(raw: unknown, container: string | null = null): TrackingMovement[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    const o = asDict(m);
    // ShipsGo v2: location is { code (ocean LOCODE) | iata (air), name, ... }.
    const loc = asDict(o.location);
    const flight = o.flight;
    return {
      locode: str(pick(loc, "code", "iata", "locode")) ?? null,
      at: isoOrNull(pick(o, "timestamp", "date", "event_date", "datetime")),
      flight:
        typeof flight === "string" ? flight : str(pick(asDict(flight), "number", "flight_number")),
      container,
      code: String(
        pick(o, "code", "event", "eventCode", "event_code", "movementCode",
          "movement_code", "type", "status_code") ?? "",
      ),
      description: str(
        pick(o, "description", "eventDescription", "event_description", "name",
          "event", "status", "event_name", "location_event_description"),
      ),
      date: dateOnly(
        pick(o, "date", "eventDate", "event_date", "timestamp", "actualDate",
          "actual_date", "time", "actual_time", "estimated_time", "datetime"),
      ),
      location: str(
        pick(o, "location", "port", "portName", "port_name", "locationName",
          "location_name", "place", "location_locode"),
      ),
      vessel: str(pick(o, "vessel", "vesselName", "vessel_name", "ship")),
      voyage: str(pick(o, "voyage", "voyageNumber", "voyage_number", "voyageNo")),
      // ShipsGo v2: status "ACT" (happened) / "EST" (planned).
      done:
        o.status === "ACT" ||
        (o.status !== "EST" &&
          Boolean(
            pick(o, "actual", "is_actual", "isActual", "completed", "done") ??
              pick(o, "actualDate", "actual_date", "eventDate", "event_date"),
          )),
    };
  });
}

/**
 * Fold whatever ShipsGo returned into the job_tracking shape. Tolerant of
 * the payload being the shipment object directly, or wrapped in data/result,
 * or an array with one shipment.
 */
export function normaliseShipsGo(payload: unknown): NormalisedTracking {
  let s = asDict(payload);
  if (Array.isArray(payload)) s = asDict(payload[0]);
  if (s.data) s = asDict(s.data);
  if (Array.isArray(s.data)) s = asDict((s.data as unknown[])[0]);
  if (s.shipment) s = asDict(s.shipment);
  if (s.result) s = asDict(s.result);

  const route = asDict(pick(s, "route", "routeData", "route_data"));
  const pol = asDict(
    pick(route, "pol", "port_of_loading", "portOfLoading", "origin", "loading") ??
      pick(s, "pol", "port_of_loading", "origin"),
  );
  const pod = asDict(
    pick(route, "pod", "port_of_discharge", "portOfDischarge", "destination", "discharge") ??
      pick(s, "pod", "port_of_discharge", "destination"),
  );

  // Ocean v2 keeps movements per container; air has them on the shipment.
  const containers = Array.isArray(s.containers) ? (s.containers as unknown[]) : [];
  const movements = containers.length
    ? containers
        .flatMap((c) => normaliseMovements(asDict(c).movements, str(asDict(c).number)))
        .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    : normaliseMovements(
        pick(s, "movements", "events", "milestones", "timeline", "trackingEvents",
          "tracking_events", "container_movements", "vessels"),
      );
  const polLoc = asDict(pol.location);
  const podLoc = asDict(pod.location);

  return {
    shipsgo_id: str(
      pick(s, "id", "shipmentId", "shipment_id", "referenceId", "reference_id", "uuid"),
    ),
    status: str(
      pick(s, "status", "shipmentStatus", "shipment_status", "currentStatus",
        "current_status", "state", "status_name"),
    ),
    carrier: str(
      pick(s, "carrier", "carrierName", "carrier_name", "shippingLine",
        "shipping_line", "airline", "airline_name", "scac"),
    ),
    pol:
      str(pick(polLoc, "code", "iata", "locode")) ??
      str(pick(pol, "locode", "unlocode", "code", "port", "name", "port_name")) ??
      str(pick(s, "polLocode", "pol_locode", "originPort", "origin_port")),
    pod:
      str(pick(podLoc, "code", "iata", "locode")) ??
      str(pick(pod, "locode", "unlocode", "code", "port", "name", "port_name")) ??
      str(pick(s, "podLocode", "pod_locode", "destinationPort", "destination_port")),
    etd: dateOnly(
      pick(s, "etd", "departureDate", "departure_date", "estimatedDeparture",
        "estimated_departure", "atd") ??
        pick(pol, "date_of_loading", "date_of_dep", "date", "etd"),
    ),
    eta: dateOnly(
      pick(s, "eta", "arrivalDate", "arrival_date", "estimatedArrival",
        "estimated_arrival", "ata") ??
        pick(pod, "date_of_discharge_predicted", "date_of_discharge", "date_of_rcf", "date", "eta"),
    ),
    last_event:
      movements.length > 0
        ? movements[movements.length - 1].description ??
          movements[movements.length - 1].code
        : str(pick(s, "lastEvent", "last_event", "lastMovement")),
    movements,
  };
}

/* ---------- the /api/track call ---------- */

interface ProxyRequest {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
}
interface ProxyResult {
  ok?: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  payload?: unknown;
}

/** Dig an existing ShipsGo shipment id out of a 409 ALREADY_EXISTS body. */
function existingIdFrom(payload: unknown): string | null {
  const p = asDict(payload);
  const id =
    pick(asDict(p.shipment), "id", "shipment_id") ??
    pick(asDict(p.data), "id", "shipment_id") ??
    pick(p, "id", "shipment_id");
  return id != null ? String(id) : null;
}

/**
 * Ask ShipsGo (through /api/track) for the current state of `ref`.
 * On the first pull for a reference ShipsGo may need to register it (a POST
 * that can consume a credit); once we have a shipsgo_id we GET by id so a
 * Refresh costs nothing.
 */
export async function fetchTracking(
  ref: TrackableRef,
  shipsgoId: string | null,
): Promise<NormalisedTracking> {
  const basePath = SHIPSGO_PATH[ref.type];
  // ShipsGo v2 create body, snake_case, confirmed from a 422:
  //   ocean: container_number | booking_number | bill_of_lading_number
  //   air:   awb_number
  const numberField =
    ref.type === "air"
      ? "awb_number"
      : ref.label === "MBL"
        ? "bill_of_lading_number"
        : "container_number";

  const body: ProxyRequest = shipsgoId
    ? { path: `${basePath}/${encodeURIComponent(shipsgoId)}`, method: "GET" }
    : {
        path: basePath,
        method: "POST",
        body: { [numberField]: ref.value },
      };

  const { res, raw } = await callProxy(body);
  if (!res.ok || raw.error) {
    // 409 = ShipsGo already tracks this reference; fetch the existing shipment.
    if (!shipsgoId && res.status === 409) {
      const existing = existingIdFrom(raw.payload);
      if (existing) return fetchTracking(ref, existing);
    }
    if (res.status === 404) {
      throw new Error("Live refresh runs on the deployed site (no API here in dev).");
    }
    throw new Error(raw.error || `Tracking service returned ${res.status}`);
  }
  return normaliseShipsGo(raw.data);
}

async function callProxy(body: ProxyRequest): Promise<{ res: Response; raw: ProxyResult }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch("/api/track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session?.access_token
        ? { authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as ProxyResult;
  return { res, raw };
}

/**
 * ShipsGo's route for a shipment (GET .../{id}/geojson, free, no credits):
 * the path actually sailed / flown and still to go, and the current
 * position. Null when ShipsGo has none yet or the call fails, the map then
 * works out a sea lane itself.
 */
export async function fetchRoutePath(ref: TrackableRef, shipsgoId: string | null): Promise<RoutePath | null> {
  if (!shipsgoId) return null;
  try {
    const { res, raw } = await callProxy({
      path: `${SHIPSGO_PATH[ref.type]}/${encodeURIComponent(shipsgoId)}/geojson`,
      method: "GET",
    });
    return res.ok && !raw.error ? slimRoutePath(raw.data) : null;
  } catch {
    return null;
  }
}

/** The subset of a JobTracking row we compute + store after a pull. */
export function trackingRowFrom(
  jobId: string,
  ref: TrackableRef,
  n: NormalisedTracking,
): Partial<JobTracking> & { job_id: string } {
  return {
    job_id: jobId,
    // Takes over from vessel tracking (provider "ais", 0204) once a number is tracked.
    provider: "shipsgo",
    ref_type: ref.type,
    ref_value: ref.value,
    carrier: n.carrier,
    shipsgo_id: n.shipsgo_id,
    status: n.status,
    pol: n.pol,
    pod: n.pod,
    etd: n.etd,
    eta: n.eta,
    last_event: n.last_event,
    movements: n.movements,
    // Map pins for the route ends (the webhook sets these too).
    ...coordsOf("pol", n.pol),
    ...coordsOf("pod", n.pod),
    synced_at: new Date().toISOString(),
  };
}

/* ================================================================== *
 *  Push-first tracking
 *
 *  Ocean + air now run push-first: register the shipment once with
 *  ShipsGo (the existing fetchTracking() POST via /api/track), then
 *  functions/api/tracking-webhook.ts folds every ShipsGo update into
 *  job_tracking + tracking_events. Nothing polls; the manual Refresh
 *  stays only as a re-sync fallback.
 * ================================================================== */

function coordsOf(
  end: "pol" | "pod",
  code: string | null,
): Partial<Pick<JobTracking, "pol_lat" | "pol_lon" | "pod_lat" | "pod_lon">> {
  const p = placeOf(code);
  return p ? { [`${end}_lat`]: p.lat, [`${end}_lon`]: p.lon } : {};
}

/**
 * tracking_events rows for a Refresh, the same shape and provider_event_id
 * the webhook (functions/api/tracking-webhook.ts) writes, so a Refresh and a
 * later push update the same rows instead of duplicating them.
 */
export function trackingEventRowsFrom(
  jobId: string,
  n: NormalisedTracking,
): Omit<TrackingEvent, "id" | "created_at">[] {
  return n.movements
    .filter((m) => m.code && m.at)
    .map((m) => {
      const p = placeOf(m.locode);
      return {
        job_id: jobId,
        provider: "shipsgo",
        provider_event_id: `${m.container ?? ""}:${m.code}:${m.at}`,
        event_code: m.code,
        description: [m.code, m.location].filter(Boolean).join(" @ ") || m.code,
        location: m.location,
        locode: m.locode ?? null,
        lat: p?.lat ?? null,
        lon: p?.lon ?? null,
        vessel_name: m.vessel ?? m.flight ?? null,
        voyage: m.voyage,
        occurred_at: m.at ?? null,
        is_actual: m.done,
      };
    });
}
