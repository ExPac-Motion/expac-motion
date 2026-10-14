import { formatDate, formatDateTime } from "../lib/format";
import type { TrackRoute } from "../lib/trackRoute";

const EVENT_LABEL: Record<string, string> = {
  DEP: "Departed",
  ARR: "Arrived",
  RCS: "Received from shipper",
  MAN: "Manifested",
  RCF: "Received from flight",
  NFD: "Ready for pick-up",
  DLV: "Delivered",
};

/**
 * The route under the tracking map, like ShipsGo's side panel: origin ->
 * destination with progress, then each stop (numbered as on the map) with
 * its events, date / time, flight or vessel, and done vs planned.
 */
export default function TrackMovements({ route }: { route: TrackRoute }) {
  const { stops } = route;
  if (stops.length === 0) return <p className="hint">No movements recorded yet.</p>;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const legs = Math.max(1, stops.length - 1);
  const pct = Math.round(((route.doneLegs + (route.moving?.fraction ?? 0)) / legs) * 100);
  const firstAt = first.events[0]?.at;
  const lastAt = last.events[last.events.length - 1]?.at;

  return (
    <div className="trk-moves">
      <div className="trk-moves-route">
        <div>
          <div className="trk-port">{first.code || first.name}</div>
          <div className="hint">{firstAt ? formatDateTime(firstAt) : ""}</div>
        </div>
        <div className="trk-moves-bar" title={`${pct}% of the route`}>
          <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <div className="trk-moves-end">
          <div className="trk-port">{last.code || last.name}</div>
          <div className="hint">{lastAt ? formatDateTime(lastAt) : ""}</div>
        </div>
      </div>

      <h4 className="trk-moves-title">Movements</h4>
      {stops.map((s, i) => (
        <div key={i} className={`trk-moves-stop${s.reached ? " reached" : ""}`}>
          <div className="trk-moves-place">
            <span className="trk-moves-no">{i + 1}</span>
            {s.code && <b>{s.code}</b>}
            <span>{s.name && s.name !== s.code ? s.name : ""}</span>
          </div>
          {s.events.map((e, j) => (
            <div key={j} className={`trk-moves-row${e.actual ? " done" : ""}`}>
              <span className="trk-moves-code" title={EVENT_LABEL[e.code ?? ""] ?? e.code ?? ""}>
                {e.code || "—"}
              </span>
              <span className="trk-moves-when">
                {e.at ? (e.at.length > 10 ? formatDateTime(e.at) : formatDate(e.at)) : "—"}
              </span>
              <span className="trk-moves-via">
                {e.via || ""}
                {e.voyage ? ` · ${e.voyage}` : ""}
              </span>
              <span className="trk-moves-state">{e.actual ? "Done" : "Planned"}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
