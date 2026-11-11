import { useMemo, useState } from "react";
import DateInput from "./DateInput";
import { useToast } from "./Toast";
import { formatDate, formatDateTime } from "../lib/format";
import { useJobTracking, useTrackingEvents, useUpdateJob } from "../lib/hooks";
import {
  currentLegIndex,
  legsFromEvents,
  LONG_TRANSSHIP_DAYS,
  transshipWaits,
  type LegEvent,
  type SailingLeg,
} from "../lib/legs";
import type { Job } from "../lib/types";

const when = (at: string | null) => (!at ? "—" : at.length > 10 ? formatDateTime(at) : formatDate(at));

/** The legs to show: the tracking webhook's (0239), else worked out from
 *  the stored tracking events (shipments not updated since 0239), else the
 *  ones typed in on the shipment. */
export function resolveLegs(
  trackingLegs: SailingLeg[] | null | undefined,
  events: LegEvent[] | null | undefined,
  manual: SailingLeg[] | null | undefined,
): { legs: SailingLeg[]; source: "tracking" | "manual" | null } {
  if (trackingLegs?.length) return { legs: trackingLegs, source: "tracking" };
  const fromEvents = events?.length ? legsFromEvents(events) : [];
  if (fromEvents.length) return { legs: fromEvents, source: "tracking" };
  if (manual?.length) return { legs: manual, source: "manual" };
  return { legs: [], source: null };
}

/** Actual / Estimated mark on a date (teal A, grey E). */
function AE({ actual, at }: { actual: boolean; at: string | null }) {
  if (!at) return null;
  return (
    <span className={`sail-ae${actual ? " is-act" : ""}`} title={actual ? "Actual" : "Estimated"}>
      {actual ? "A" : "E"}
    </span>
  );
}

/** Read-only sailing schedule: one row per vessel, the current leg marked. */
export function SailingTable({ legs }: { legs: SailingLeg[] }) {
  const cur = currentLegIndex(legs);
  const waits = transshipWaits(legs);
  return (
    <>
      <table className="sail-table">
        <thead>
          <tr>
            <th>Vessel / voyage</th>
            <th>From</th>
            <th>Departs</th>
            <th>To</th>
            <th>Arrives</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l, i) => (
            <tr key={i} className={i === cur ? "is-current" : undefined} title={i === cur ? "The vessel carrying the cargo now (or next)" : undefined}>
              <td>
                <b>{l.vessel || "—"}</b>
                {l.voyage && <span className="sail-voy"> {l.voyage}</span>}
              </td>
              <td>{l.polName || l.pol || "—"}</td>
              <td>
                {when(l.etd)} <AE actual={l.etdActual} at={l.etd} />
              </td>
              <td>{l.podName || l.pod || "—"}</td>
              <td>
                {when(l.eta)} <AE actual={l.etaActual} at={l.eta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {waits.map(
        (w, i) =>
          w.days !== null &&
          w.days > LONG_TRANSSHIP_DAYS && (
            <p key={i} className="sail-warn">
              Cargo waits {w.days} days at {w.port} for the connecting vessel. Check it hasn't been rolled.
            </p>
          ),
      )}
    </>
  );
}

const BLANK: SailingLeg = {
  vessel: "",
  voyage: null,
  imo: null,
  pol: null,
  polName: null,
  etd: null,
  etdActual: false,
  pod: null,
  podName: null,
  eta: null,
  etaActual: false,
};

/** Staff: the shipment's sailing schedule. Tracked legs are read-only;
 *  untracked shipments can have their legs typed in (jobs.manual_legs). */
export default function SailingLegsPanel({ job }: { job: Job }) {
  const trackingQ = useJobTracking();
  const tracking = trackingQ.data?.find((t) => t.job_id === job.id);
  const eventsQ = useTrackingEvents(tracking?.legs?.length ? undefined : job.id);
  const { legs, source } = useMemo(
    () => resolveLegs(tracking?.legs, eventsQ.data, job.manual_legs),
    [tracking?.legs, eventsQ.data, job.manual_legs],
  );
  const [editing, setEditing] = useState<SailingLeg[] | null>(null);
  const updateJob = useUpdateJob();
  const { toast, error: toastError } = useToast();

  function startEdit() {
    const base = job.manual_legs?.length ? job.manual_legs : [BLANK, BLANK];
    setEditing(base.map((l) => ({ ...l })));
  }
  function setLeg(i: number, patch: Partial<SailingLeg>) {
    setEditing((rows) => rows && rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function save() {
    const rows = (editing ?? [])
      .map((l) => ({ ...l, vessel: l.vessel.trim(), pol: l.pol?.trim().toUpperCase() || null, pod: l.pod?.trim().toUpperCase() || null }))
      .filter((l) => l.vessel || l.pol || l.pod);
    updateJob.mutate(
      { id: job.id, patch: { manual_legs: rows } },
      {
        onSuccess: () => {
          toast("Sailing schedule saved");
          setEditing(null);
        },
        onError: (e) => toastError(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }

  return (
    <div className="panel ws-panel sail-panel">
      <div className="ws-sec-head">
        <h3>
          Sailing schedule
          {legs.length > 1 && <span className="sail-ts">Transshipment</span>}
        </h3>
        {source !== "tracking" && !editing && (
          <button type="button" className="link-btn" onClick={startEdit}>
            {legs.length ? "Edit legs" : "+ Add legs"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="sail-edit">
          {editing.map((l, i) => (
            <div key={i} className="sail-edit-row">
              <span className="sail-leg-no">{i + 1}</span>
              <input placeholder="Vessel" value={l.vessel} onChange={(e) => setLeg(i, { vessel: e.target.value })} />
              <input placeholder="Voyage" value={l.voyage ?? ""} onChange={(e) => setLeg(i, { voyage: e.target.value || null })} />
              <input placeholder="From (CNNGB)" value={l.pol ?? ""} onChange={(e) => setLeg(i, { pol: e.target.value || null })} />
              <DateInput value={l.etd ?? ""} onChange={(v) => setLeg(i, { etd: v || null })} />
              <input placeholder="To (SGSIN)" value={l.pod ?? ""} onChange={(e) => setLeg(i, { pod: e.target.value || null })} />
              <DateInput value={l.eta ?? ""} onChange={(v) => setLeg(i, { eta: v || null })} />
              <button type="button" className="link-btn" title="Remove this leg" onClick={() => setEditing((rows) => rows && rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div className="sail-edit-actions">
            <button type="button" className="link-btn" onClick={() => setEditing((rows) => [...(rows ?? []), { ...BLANK }])}>
              + Add leg
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm" disabled={updateJob.isPending} onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : legs.length ? (
        <>
          <SailingTable legs={legs} />
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {source === "tracking"
              ? "From live tracking. The highlighted vessel is the one the map follows; the shipment's Vessel is the one arriving in SA."
              : "Typed in. Live tracking replaces these once it follows the shipment."}
          </p>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          No legs yet. Live tracking fills them in; add them by hand for a transshipment that isn't tracked.
        </p>
      )}
    </div>
  );
}
