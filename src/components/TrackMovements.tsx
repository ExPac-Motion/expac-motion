import { formatDate, formatDateTime } from "../lib/format";
import type { RouteEvent, RouteStop, TrackRoute } from "../lib/trackRoute";

const EVENT_LABEL: Record<string, string> = {
  DEP: "Departed",
  ARR: "Arrived",
  RCS: "Received from shipper",
  MAN: "Manifested",
  RCF: "Received from flight",
  NFD: "Ready for pick-up",
  DLV: "Delivered",
};
const labelOf = (code: string | null) => (code && EVENT_LABEL[code.toUpperCase()]) || code || "Update";
const when = (at: string | null) => (at ? (at.length > 10 ? formatDateTime(at) : formatDate(at)) : "");

/** "Latest update" from confirmed events only: what has actually happened. */
function latestLine(stops: RouteStop[]): { text: string; done: boolean } {
  let last: { e: RouteEvent; s: RouteStop } | null = null;
  for (const s of stops)
    for (const e of s.events)
      if (e.actual && (!last || (e.at ?? "") >= (last.e.at ?? ""))) last = { e, s };
  if (last) {
    const { e, s } = last;
    return {
      text: [`${labelOf(e.code)} ${s.code ?? ""}`.trim() + (s.name && s.name !== s.code ? `, ${s.name}` : ""), when(e.at), e.via]
        .filter(Boolean)
        .join(" · "),
      done: true,
    };
  }
  const anyPlanned = stops.some((s) => s.events.length > 0);
  return {
    text: anyPlanned ? "Booked, awaiting departure" : "Booked, routing details to follow from the carrier",
    done: false,
  };
}

function Place({ stop }: { stop: RouteStop }) {
  return (
    <>
      {stop.code && <b>{stop.code}</b>}
      {stop.name && stop.name !== stop.code && <span>{stop.name}</span>}
    </>
  );
}

/**
 * The route under the tracking map, like ShipsGo's side panel: the latest
 * confirmed update, origin -> destination with progress, then each stop
 * (numbered as on the map) with its events, date / time, flight or vessel,
 * and done vs planned.
 */
export default function TrackMovements({ route }: { route: TrackRoute }) {
  const { stops } = route;
  if (stops.length === 0) return <p className="hint">No movements recorded yet.</p>;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const legs = Math.max(1, stops.length - 1);
  const pct = Math.round(((route.doneLegs + (route.moving?.fraction ?? 0)) / legs) * 100);
  const firstAt = first.events[0]?.at ?? null;
  const lastAt = last.events[last.events.length - 1]?.at ?? null;
  const latest = latestLine(stops);
  const hasEvents = stops.some((s) => s.events.length > 0);

  return (
    <div className="trk-moves">
      <div className={`trk-moves-latest${latest.done ? " done" : ""}`}>
        <span>Latest update</span> {latest.text}
      </div>

      <div className="trk-moves-route">
        <div className="trk-moves-endpoint">
          <div className="trk-moves-place">
            <Place stop={first} />
          </div>
          <div className="hint">{when(firstAt)}</div>
        </div>
        <div className="trk-moves-bar" title={`${pct}% of the route`}>
          <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <div className="trk-moves-endpoint trk-moves-end">
          <div className="trk-moves-place">
            <Place stop={last} />
          </div>
          <div className="hint">{when(lastAt)}</div>
        </div>
      </div>

      <h4 className="trk-moves-title">Movements</h4>
      {!hasEvents ? (
        <p className="hint">
          Flight / sailing details appear here as soon as the carrier confirms the routing.
        </p>
      ) : (
        stops.map((s, i) => (
          <div key={i} className={`trk-moves-stop${s.reached ? " reached" : ""}`}>
            <div className="trk-moves-place">
              <span className="trk-moves-no">{i + 1}</span>
              <Place stop={s} />
            </div>
            {s.events.map((e, j) => (
              <div key={j} className={`trk-moves-row${e.actual ? " done" : ""}`}>
                <span className="trk-moves-code" title={labelOf(e.code)}>
                  {e.code || "—"}
                </span>
                <span className="trk-moves-when">{when(e.at) || "—"}</span>
                <span className="trk-moves-via">
                  {e.via || ""}
                  {e.voyage ? ` · ${e.voyage}` : ""}
                </span>
                <span className="trk-moves-state">{e.actual ? "Done" : "Planned"}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
