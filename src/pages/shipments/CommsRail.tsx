import type { Job } from "../../lib/types";
import CommsPanel from "./CommsPanel";

/**
 * Docked, collapsible "Activity Panel" on the right of the Shipments board.
 * Collapsed = a thin edge tab; expanded = a fixed 420px panel showing the
 * comms thread for the selected shipment.
 */
export default function CommsRail({
  job,
  open,
  onToggle,
}: {
  job: Job | null;
  open: boolean;
  onToggle: () => void;
}) {
  if (!open) {
    return (
      <button
        className="comms-rail-tab"
        onClick={onToggle}
        title="Open the activity panel"
      >
        ‹ <span>ACTIVITY</span>
      </button>
    );
  }

  return (
    <aside className="comms-rail">
      <div className="comms-rail-head">
        <div>
          <div className="comms-rail-eyebrow">Activity Panel</div>
          <strong>{job ? job.reference : "No shipment selected"}</strong>
          {job?.client?.company && (
            <div className="hint">{job.client.company}</div>
          )}
        </div>
        <button className="x" onClick={onToggle} aria-label="Collapse panel">
          ›
        </button>
      </div>
      <div className="comms-rail-body">
        {job ? (
          <CommsPanel key={job.id} job={job} />
        ) : (
          <p className="hint" style={{ padding: "12px 2px" }}>
            Pick a shipment from the list — click its <strong>✉ Messages</strong>{" "}
            button.
          </p>
        )}
      </div>
    </aside>
  );
}
