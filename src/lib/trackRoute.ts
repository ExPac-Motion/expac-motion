import { placeOf } from "./places";

/**
 * A shipment's route for the tracking map + movements list, built from the
 * tracking events (or the legacy movements blob): the stops in order, how
 * many legs are done, and where the cargo is now. Pure display, nothing
 * here touches the ShipsGo sync.
 */

export interface RouteEvent {
  code: string | null;
  /** Port / airport name, e.g. "Singapore Changi Airport". */
  place: string | null;
  /** LOCODE / IATA, used for coordinates when lat/lon weren't stored. */
  placeCode?: string | null;
  lat: number | null | undefined;
  lon: number | null | undefined;
  at: string | null;
  actual: boolean;
  /** Flight number (air) or vessel name (sea). */
  via?: string | null;
  voyage?: string | null;
}

export interface RouteStop {
  name: string;
  code: string | null;
  lat: number | null;
  lon: number | null;
  events: RouteEvent[];
  /** Any confirmed event here. */
  reached: boolean;
}

export interface RouteEnd {
  code?: string | null;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface TrackRoute {
  stops: RouteStop[];
  /** Legs 0..doneLegs-1 are complete (leg i runs stop i -> stop i+1). */
  doneLegs: number;
  /** The leg in the air / at sea right now, with how far along it is. */
  moving: { leg: number; fraction: number } | null;
  /** Where the cargo is: on a stop, or estimated along the moving leg. */
  position: { lat: number; lon: number; label: string; estimated: boolean; bearing: number } | null;
}

const DEPARTURE = /^(DEP|DEPA|VD|VDL|DEPARTED|DEPARTURE)$/i;
export const isDeparture = (code: string | null | undefined) =>
  !!code && (DEPARTURE.test(code) || /depart/i.test(code));

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Point `f` (0..1) of the way along the great circle a -> b. */
export function along(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  f: number,
): { lat: number; lon: number } {
  const [φ1, λ1, φ2, λ2] = [toRad(a.lat), toRad(a.lon), toRad(b.lat), toRad(b.lon)];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) };
}

/** Initial compass bearing a -> b, degrees clockwise from north. */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const [φ1, φ2, Δλ] = [toRad(a.lat), toRad(b.lat), toRad(b.lon - a.lon)];
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Points along the great circle a -> b, longitudes unwrapped so a line
 *  crossing the date line draws the short way round. */
export function arc(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  from = 0,
  to = 1,
  steps = 48,
): [number, number][] {
  const out: [number, number][] = [];
  let prevLon: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const p = along(a, b, from + ((to - from) * i) / steps);
    let lon = p.lon;
    if (prevLon != null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    out.push([p.lat, lon]);
  }
  return out;
}

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const [φ1, φ2] = [toRad(a.lat), toRad(b.lat)];
  const h =
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const hasPos = <T extends { lat: number | null; lon: number | null }>(
  p: T,
): p is T & { lat: number; lon: number } =>
  typeof p.lat === "number" && typeof p.lon === "number";

function endStop(e: RouteEnd | null | undefined): RouteStop | null {
  if (!e) return null;
  const looked = placeOf(e.code);
  const lat = typeof e.lat === "number" ? e.lat : (looked?.lat ?? null);
  const lon = typeof e.lon === "number" ? e.lon : (looked?.lon ?? null);
  if (lat == null || lon == null) return null;
  // The shipment's own origin / destination text, e.g. "CNCAN, Guangzhou,
  // China": the code up front, the rest as the place name.
  const m = String(e.code ?? "").match(/^\s*([A-Za-z]{3,5})\b[\s,\-–]*(.*)$/);
  const code = m ? m[1].toUpperCase() : (e.code ?? null);
  return {
    name: e.name || (m && m[2].trim()) || looked?.name || code || "",
    code,
    lat,
    lon,
    events: [],
    reached: false,
  };
}

export function buildRoute(
  events: RouteEvent[],
  origin?: RouteEnd | null,
  destination?: RouteEnd | null,
  now: number = Date.now(),
): TrackRoute {
  const sorted = events
    .slice()
    .sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));

  // Consecutive events at the same place make one stop (ARR + DEP at a hub).
  const stops: RouteStop[] = [];
  // Sea events come once per container: "LOAD at Shanghai" x3 for three
  // boxes is one movement on the route.
  const seen = new Set<string>();
  for (const e of sorted) {
    const dupKey = [e.code, e.placeCode || e.place, e.at, e.actual].join("|");
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const looked = placeOf(e.placeCode);
    const lat = typeof e.lat === "number" ? e.lat : (looked?.lat ?? null);
    const lon = typeof e.lon === "number" ? e.lon : (looked?.lon ?? null);
    const name = e.place || looked?.name || e.placeCode || "";
    const key = (e.placeCode || name).toLowerCase();
    const last = stops[stops.length - 1];
    const lastKey = last ? (last.code || last.name).toLowerCase() : null;
    if (last && key && key === lastKey) {
      last.events.push(e);
      last.reached ||= e.actual;
      if (last.lat == null && lat != null) [last.lat, last.lon] = [lat, lon];
    } else {
      stops.push({
        name,
        code: e.placeCode ?? null,
        lat,
        lon,
        events: [e],
        reached: e.actual,
      });
    }
  }

  // Route ends the events don't cover (e.g. nothing reported yet): add them
  // so a booked shipment still shows origin -> destination.
  const o = endStop(origin);
  const d = endStop(destination);
  const first = stops.find(hasPos);
  const lastWithPos = [...stops].reverse().find(hasPos);
  if (o && (!first || kmBetween(o as { lat: number; lon: number }, first) > 60)) stops.unshift(o);
  if (d && (!lastWithPos || kmBetween(d as { lat: number; lon: number }, lastWithPos) > 60)) stops.push(d);

  let lastReached = -1;
  stops.forEach((s, i) => {
    if (s.reached) lastReached = i;
  });
  // A confirmed event further along means every earlier stop was passed.
  for (let i = 0; i < lastReached; i++) stops[i].reached = true;

  const doneLegs = Math.max(0, lastReached);
  let moving: TrackRoute["moving"] = null;
  let position: TrackRoute["position"] = null;

  if (lastReached >= 0) {
    const here = stops[lastReached];
    const lastActual = [...here.events].reverse().find((e) => e.actual);
    const next = stops[lastReached + 1];
    if (next && lastActual && isDeparture(lastActual.code) && hasPos(here) && hasPos(next)) {
      const dep = lastActual.at ? Date.parse(lastActual.at) : NaN;
      const arrAt = next.events.find((e) => !isDeparture(e.code))?.at ?? next.events[0]?.at;
      const arr = arrAt ? Date.parse(arrAt) : NaN;
      const raw = Number.isFinite(dep) && Number.isFinite(arr) && arr > dep ? (now - dep) / (arr - dep) : 0.5;
      const fraction = Math.min(0.97, Math.max(0.03, raw));
      moving = { leg: lastReached, fraction };
      const p = along(here, next, fraction);
      const ahead = along(here, next, Math.min(1, fraction + 0.01));
      position = {
        ...p,
        label: `Estimated, between ${here.name} and ${next.name}`,
        estimated: true,
        bearing: bearing(p, ahead),
      };
    } else if (hasPos(here)) {
      const prev = stops[lastReached - 1];
      position = {
        lat: here.lat,
        lon: here.lon,
        label: here.name,
        estimated: false,
        bearing: next && hasPos(next) ? bearing(here, next) : prev && hasPos(prev) ? bearing(prev, here) : 90,
      };
    }
  }

  return { stops, doneLegs, moving, position };
}

/**
 * Vessel tracking on AIS (0204): port of loading -> port of discharge, with
 * the ship's real last AIS fix as the marker (not an estimate along the
 * leg) until it has arrived.
 */
export function aisRoute(t: {
  pol: string | null;
  pod: string | null;
  pol_lat: number | null;
  pol_lon: number | null;
  pod_lat: number | null;
  pod_lon: number | null;
  atd?: string | null;
  pod_ata: string | null;
  pod_eta: string | null;
  eta: string | null;
  vessel_name: string | null;
  voyage: string | null;
  vessel_lat: number | null;
  vessel_lon: number | null;
  position_at: string | null;
}): TrackRoute {
  const via = { via: t.vessel_name, voyage: t.voyage };
  const events: RouteEvent[] = [
    { code: "DEP", place: t.pol, placeCode: t.pol, lat: t.pol_lat, lon: t.pol_lon, at: t.atd ?? null, actual: !!t.atd, ...via },
    {
      code: "ARR",
      place: t.pod,
      placeCode: t.pod,
      lat: t.pod_lat,
      lon: t.pod_lon,
      at: t.pod_ata ?? t.pod_eta ?? t.eta,
      actual: !!t.pod_ata,
      ...via,
    },
  ];
  const route = buildRoute(events);
  if (!t.pod_ata && typeof t.vessel_lat === "number" && typeof t.vessel_lon === "number") {
    const here = { lat: t.vessel_lat, lon: t.vessel_lon };
    const pod = typeof t.pod_lat === "number" && typeof t.pod_lon === "number" ? { lat: t.pod_lat, lon: t.pod_lon } : null;
    const seen = t.position_at ? new Date(t.position_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "";
    route.position = {
      ...here,
      label: `${t.vessel_name ?? "Vessel"}, last AIS position${seen ? ` ${seen}` : ""}`,
      estimated: false,
      bearing: pod ? bearing(here, pod) : 90,
    };
  }
  return route;
}

/** tracking_events rows (Motion, portal view, public RPC) -> route events. */
export function routeEventsFromRows(
  rows: {
    event_code: string | null;
    location: string | null;
    locode?: string | null;
    lat: number | null;
    lon: number | null;
    occurred_at: string | null;
    is_actual: boolean;
    vessel_name?: string | null;
    voyage?: string | null;
  }[],
): RouteEvent[] {
  return rows.map((r) => ({
    code: r.event_code,
    place: r.location,
    placeCode: r.locode ?? null,
    lat: r.lat,
    lon: r.lon,
    at: r.occurred_at,
    actual: r.is_actual,
    via: r.vessel_name ?? null,
    voyage: r.voyage ?? null,
  }));
}

/** Legacy job_tracking.movements blob (before any event rows) -> route events. */
export function routeEventsFromMovements(
  ms: {
    code: string;
    location: string | null;
    locode?: string | null;
    at?: string | null;
    date: string | null;
    done: boolean;
    flight?: string | null;
    vessel: string | null;
    voyage: string | null;
  }[],
): RouteEvent[] {
  return ms.map((m) => ({
    code: m.code || null,
    place: m.location,
    placeCode: m.locode ?? null,
    lat: null,
    lon: null,
    at: m.at ?? m.date,
    actual: m.done,
    via: m.flight ?? m.vessel,
    voyage: m.voyage,
  }));
}

/* ---------- the real path (0202) ---------- */

/** One stretch of ShipsGo's route: the line the vessel / flight takes, as
 *  [lat, lon] points, and on the CURRENT stretch where it is now. */
export interface RouteSegment {
  s: "PAST" | "CURRENT" | "FUTURE";
  c: [number, number][];
  /** Current position [lat, lon] (CURRENT only). */
  at: [number, number] | null;
  /** Index into `c` the current position sits at (CURRENT only). */
  i: number | null;
}
export type RoutePath = RouteSegment[];

/**
 * ShipsGo's /geojson response (or its FeatureCollection) -> the slim
 * job_tracking.route_path we store: the LineStrings only, coordinates only.
 * Same shape the webhook writes (functions/api/tracking-webhook.ts).
 */
export function slimRoutePath(payload: unknown): RoutePath | null {
  const p = (payload ?? {}) as { geojson?: { features?: unknown[] }; features?: unknown[] };
  const features = p.geojson?.features ?? p.features;
  if (!Array.isArray(features)) return null;
  const ll = (c: unknown): [number, number] | null =>
    Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [c[1], c[0]] : null;
  const out: RoutePath = [];
  for (const f of features as { geometry?: { type?: string; coordinates?: unknown[] }; properties?: Record<string, unknown> }[]) {
    if (f?.geometry?.type !== "LineString" || !Array.isArray(f.geometry.coordinates)) continue;
    const c = f.geometry.coordinates.map(ll).filter((x): x is [number, number] => !!x);
    if (c.length < 2) continue;
    const props = f.properties ?? {};
    const s = props.status === "PAST" || props.status === "CURRENT" ? props.status : "FUTURE";
    const cur = (props.current ?? null) as { index?: number; coordinates?: unknown } | null;
    out.push({
      s,
      c,
      at: s === "CURRENT" && cur ? ll(cur.coordinates) : null,
      i: s === "CURRENT" && cur && typeof cur.index === "number" ? cur.index : null,
    });
  }
  return out.length ? out : null;
}

/** Longitudes unwrapped point to point, so a line over the date line draws
 *  the short way round instead of across the whole map. */
export function unwrapLine(points: [number, number][], startLon: number | null = null): [number, number][] {
  let prev = startLon;
  return points.map(([lat, lon]) => {
    let l = lon;
    if (prev != null) {
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    prev = l;
    return [lat, l];
  });
}

/** Split a line `f` (0..1) of the way along it, by distance: the part
 *  travelled, the part to go, and the point between with its bearing. */
export function splitLine(
  points: [number, number][],
  f: number,
): { done: [number, number][]; todo: [number, number][]; at: { lat: number; lon: number }; bearing: number } {
  const pt = ([lat, lon]: [number, number]) => ({ lat, lon });
  const legs = points.slice(1).map((p, k) => kmBetween(pt(points[k]), pt(p)));
  const total = legs.reduce((a, b) => a + b, 0);
  let want = total * Math.min(1, Math.max(0, f));
  for (let k = 0; k < legs.length; k++) {
    if (want <= legs[k] || k === legs.length - 1) {
      const t = legs[k] > 0 ? Math.min(1, want / legs[k]) : 0;
      const [a, b] = [points[k], points[k + 1]];
      const at = { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t };
      return {
        done: [...points.slice(0, k + 1), [at.lat, at.lon]],
        todo: [[at.lat, at.lon], ...points.slice(k + 1)],
        at,
        bearing: bearing(pt(a), pt(b)),
      };
    }
    want -= legs[k];
  }
  const last = points[points.length - 1];
  return { done: points, todo: [last], at: pt(last), bearing: 90 };
}
