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
  return {
    name: e.name || looked?.name || e.code || "",
    code: e.code ?? null,
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
  for (const e of sorted) {
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
