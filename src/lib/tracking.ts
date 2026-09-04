import type { Job, JobTracking, TrackingMovement } from "./types";

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
 *  first real pull — the UI already renders fine from a job_tracking row,
 *  so a wrong path only breaks the Refresh button, not the page.
 * ------------------------------------------------------------------ */
const SHIPSGO_PATH = {
  ocean: "/ocean/shipments",
  air: "/air/shipments",
};

/**
 * Public ShipsGo *embed* token (the widget on expac.co.za/live-tracking) — not
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
const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);
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

function normaliseMovements(raw: unknown): TrackingMovement[] {
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
      done: Boolean(
        pick(o, "actual", "is_actual", "isActual", "completed", "done") ??
          pick(o, "actualDate", "actual_date", "eventDate", "event_date"),
      ),
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

  const movements = normaliseMovements(
    pick(s, "movements", "events", "milestones", "timeline", "trackingEvents",
      "tracking_events", "container_movements", "vessels"),
  );

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
      str(pick(pol, "locode", "unlocode", "code", "port", "name", "port_name")) ??
      str(pick(s, "polLocode", "pol_locode", "originPort", "origin_port")),
    pod:
      str(pick(pod, "locode", "unlocode", "code", "port", "name", "port_name")) ??
      str(pick(s, "podLocode", "pod_locode", "destinationPort", "destination_port")),
    etd: dateOnly(
      pick(s, "etd", "departureDate", "departure_date", "estimatedDeparture",
        "estimated_departure", "atd") ?? pick(pol, "date", "etd"),
    ),
    eta: dateOnly(
      pick(s, "eta", "arrivalDate", "arrival_date", "estimatedArrival",
        "estimated_arrival", "ata") ?? pick(pod, "date", "eta"),
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
  // ShipsGo v2 create body — snake_case, confirmed from a 422:
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

  const res = await fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => ({}))) as ProxyResult;
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

/** The subset of a JobTracking row we compute + store after a pull. */
export function trackingRowFrom(
  jobId: string,
  ref: TrackableRef,
  n: NormalisedTracking,
): Partial<JobTracking> & { job_id: string } {
  return {
    job_id: jobId,
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
    synced_at: new Date().toISOString(),
  };
}
