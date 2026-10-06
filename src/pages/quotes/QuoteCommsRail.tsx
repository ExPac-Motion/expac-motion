import type { Quote } from "../../lib/types";
import QuoteCommsPanel from "./QuoteCommsPanel";

/**
 * Docked, collapsible "Activity Panel" on the right of the Quotations list,
 * same method as CommsRail on Active Shipments, against a Quote instead of
 * a Job. Collapsed = a thin edge tab; expanded = a fixed 420px panel showing
 * the comms thread for the selected quotation.
 */
export default function QuoteCommsRail({
  quote,
  open,
  onToggle,
}: {
  quote: Quote | null;
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
          <strong>{quote ? quote.reference : "No quotation selected"}</strong>
          {(quote?.client?.company || quote?.lead?.company) && (
            <div className="hint">{quote.client?.company ?? quote.lead?.company}</div>
          )}
        </div>
        <button className="x" onClick={onToggle} aria-label="Collapse panel">
          ›
        </button>
      </div>
      <div className="comms-rail-body">
        {quote ? (
          <QuoteCommsPanel key={quote.id} quote={quote} />
        ) : (
          <p className="hint" style={{ padding: "12px 2px" }}>
            Pick a quotation from the list, click its <strong>✉ Messages</strong> button.
          </p>
        )}
      </div>
    </aside>
  );
}
