// Sailing legs (transshipment) from tracking events (0239). Plain functions,
// no Supabase or React, so the tracking webhook (functions/api) uses the
// same logic as the staff screens and the Customer Portal.

/** One tracking event, in the shape of tracking_events / client_tracking_events. */
export interface LegEvent {
  event_code: string | null;
  location: string | null;
  locode?: string | null;
  vessel_name: string | null;
  voyage: string | null;
  occurred_at: string | null;
  is_actual: boolean;
  /** Only known inside the webhook (not stored on tracking_events). */
  vessel_imo?: string | null;
}

/** One vessel's part of the voyage. Dates are ISO (date or timestamp). */
export interface SailingLeg {
  vessel: string;
  voyage: string | null;
  imo: string | null;
  pol: string | null;
  polName: string | null;
  etd: string | null;
  etdActual: boolean;
  pod: string | null;
  podName: string | null;
  eta: string | null;
  etaActual: boolean;
}

const DEPART = new Set(["DEPA", "LOAD"]);
const ARRIVE = new Set(["ARRV", "DISC"]);

/**
 * The legs, in sailing order: one per vessel + voyage named on the events.
 * Departure from the vessel's DEPA (else LOAD), arrival from its ARRV (else
 * DISC). Events from several containers on the same vessel fold together.
 * Air events (no vessel, flight numbers) are ignored by the caller.
 */
export function legsFromEvents(events: LegEvent[]): SailingLeg[] {
  const byKey = new Map<string, { first: string; evs: LegEvent[] }>();
  for (const e of events) {
    const code = (e.event_code ?? "").toUpperCase();
    const vessel = (e.vessel_name ?? "").trim();
    if (!vessel || (!DEPART.has(code) && !ARRIVE.has(code))) continue;
    const key = `${vessel.toUpperCase()}|${(e.voyage ?? "").trim().toUpperCase()}`;
    const g = byKey.get(key) ?? { first: e.occurred_at ?? "", evs: [] };
    g.evs.push(e);
    if ((e.occurred_at ?? "") && (!g.first || (e.occurred_at ?? "") < g.first)) g.first = e.occurred_at ?? "";
    byKey.set(key, g);
  }
  const pick = (evs: LegEvent[], codes: string[]) => {
    for (const c of codes) {
      const hit = evs
        .filter((e) => (e.event_code ?? "").toUpperCase() === c)
        .sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""));
      if (hit.length) return c === "DEPA" || c === "LOAD" ? hit[0] : hit[hit.length - 1];
    }
    return null;
  };
  return [...byKey.values()]
    .sort((a, b) => a.first.localeCompare(b.first))
    .map(({ evs }) => {
      const dep = pick(evs, ["DEPA", "LOAD"]);
      const arr = pick(evs, ["ARRV", "DISC"]);
      const any = evs[0];
      return {
        vessel: (any.vessel_name ?? "").trim(),
        voyage: (any.voyage ?? "").trim() || null,
        imo: evs.find((e) => e.vessel_imo)?.vessel_imo ?? null,
        pol: dep?.locode ?? null,
        polName: dep?.location ?? null,
        etd: dep?.occurred_at ?? null,
        etdActual: !!dep?.is_actual,
        pod: arr?.locode ?? null,
        podName: arr?.location ?? null,
        eta: arr?.occurred_at ?? null,
        etaActual: !!arr?.is_actual,
      };
    });
}

/** The leg whose vessel has the cargo now (or will next): the first leg not
 *  yet arrived; once everything has arrived, the last. */
export function currentLegIndex(legs: SailingLeg[]): number {
  if (!legs.length) return -1;
  const i = legs.findIndex((l) => !l.etaActual);
  return i === -1 ? legs.length - 1 : i;
}

/** Transshipment ports: where one leg ends and the next begins. */
export function transshipPorts(legs: SailingLeg[]): string[] {
  return legs.slice(0, -1).map((l) => l.podName || l.pod || "?");
}

/** Days the cargo waits at each transshipment port (next ETD minus this
 *  ETA), for the "long wait / rolled" warning. */
export function transshipWaits(legs: SailingLeg[]): { port: string; days: number | null }[] {
  return legs.slice(0, -1).map((l, i) => {
    const next = legs[i + 1];
    const a = l.eta ? Date.parse(l.eta) : NaN;
    const d = next.etd ? Date.parse(next.etd) : NaN;
    return {
      port: l.podName || l.pod || "?",
      days: Number.isFinite(a) && Number.isFinite(d) ? Math.round((d - a) / 86_400_000) : null,
    };
  });
}

/** A stop longer than this many days at a transshipment port is flagged. */
export const LONG_TRANSSHIP_DAYS = 10;
