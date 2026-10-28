import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { formatDate } from "../lib/format";
import {
  notifyText,
  OPTIONAL_STEP,
  PLANNED_FIELD,
  stepLabel,
  todayIso,
  useAdvanceTimeline,
  useJobTimeline,
  useSetTimelineStep,
  type TimelinePatch,
  type TimelineStep,
} from "../lib/timeline";

/** A yyyy-mm-dd input that saves on blur / Enter, not on every keystroke
 *  (typing a year fires a change per digit). */
function DateCell({
  value,
  onSave,
  title,
  disabled,
}: {
  value: string | null;
  onSave: (v: string) => void;
  title: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  function commit() {
    if (draft === (value ?? "")) return;
    if (draft && !/^(19|20)\d{2}-\d{2}-\d{2}$/.test(draft)) {
      setDraft(value ?? "");
      return;
    }
    onSave(draft);
  }
  return (
    <input
      type="date"
      value={draft}
      title={title}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NoteCell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      className="tl-note"
      value={draft}
      placeholder="Add a note"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? "") && onSave(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/**
 * Shipment timeline (0196): the steps for the shipment's mode with planned
 * and actual dates, Move to next step, Undo, Skip, Mark detained and the
 * customer-visible toggle. The database turns the last done step into the
 * Shipment Status, so the board follows.
 */
export default function ShipmentTimeline({
  job,
  onDelivered,
  onNotify,
}: {
  job: { id: string; mode: string | null; reference: string };
  /** Called when the shipment reaches Delivered (POD prompt, Completed). */
  onDelivered?: () => void;
  /** Opens Comms with this message pre-filled (Notify customer). */
  onNotify?: (message: string) => void;
}) {
  const { toast, error: toastError } = useToast();
  const stepsQ = useJobTimeline(job.id);
  const advance = useAdvanceTimeline();
  const setStep = useSetTimelineStep(job.id);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(todayIso());
  const [moveNote, setMoveNote] = useState("");
  const [notify, setNotify] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const steps = stepsQ.data ?? [];
  const live = steps.filter((s) => !s.skipped);
  const lastDone = [...live].reverse().find((s) => s.done) ?? null;
  const next =
    live.find((s) => !s.done && s.step !== OPTIONAL_STEP && s.sort_order > (lastDone?.sort_order ?? 0)) ?? null;
  const shown = steps.filter((s) => s.step !== OPTIONAL_STEP || s.done);
  // Done steps before the current one fold into one line, so the current
  // and upcoming steps sit at the top.
  const folded = lastDone ? shown.filter((s) => s.sort_order < lastDone.sort_order && (s.done || s.skipped)) : [];
  const fold = folded.length > 1;
  const listed = fold && !showDone ? shown.filter((s) => !folded.includes(s)) : shown;
  const counted = live.filter((s) => s.step !== OPTIONAL_STEP);
  const doneCount = counted.filter((s) => s.done).length;
  const pct = counted.length ? Math.round((doneCount / counted.length) * 100) : 0;

  function after(status: string, msg: string) {
    toast(msg);
    if (status === "Delivered") onDelivered?.();
  }

  async function save(s: TimelineStep, patch: TimelinePatch, msg = "Timeline updated") {
    try {
      const status = await setStep.mutateAsync({ stepId: s.id, patch });
      after(status, msg);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function onMove() {
    if (!next) return;
    try {
      const status = await advance.mutateAsync({ jobId: job.id, date: moveDate, note: moveNote });
      setMoving(false);
      setMoveNote("");
      after(status, `${job.reference} moved to ${stepLabel(status, job.mode)}`);
      if (notify && onNotify) onNotify(notifyText(job.mode, { step: status, date: moveDate }));
      setNotify(false);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not move the shipment");
    }
  }

  function onMarkDone(s: TimelineStep) {
    const label = stepLabel(s.step, job.mode);
    if (!window.confirm(`Mark "${label}" done${s.sort_order > (next?.sort_order ?? 0) ? " (and the steps before it)" : ""}?`))
      return;
    save(s, { done: true }, `${label} done`);
  }

  function onUndo() {
    if (!lastDone) return;
    const label = stepLabel(lastDone.step, job.mode);
    if (!window.confirm(`Undo "${label}"? Its date is cleared and the shipment goes back one step.`)) return;
    save(lastDone, { done: false }, `${label} undone`);
  }

  if (stepsQ.isLoading) return <div className="tl-panel muted">Loading timeline…</div>;
  if (stepsQ.error || steps.length === 0)
    return (
      <div className="tl-panel muted">
        No timeline yet{stepsQ.error ? " (run migration 0196)" : ""}.
      </div>
    );

  const detained = steps.find((s) => s.step === OPTIONAL_STEP);
  const canDetain = detained && !detained.done && lastDone?.step === "Customs";
  const busy = advance.isPending || setStep.isPending;

  return (
    <div className="tl-panel">
      <div className="tl-head">
        <div>
          <h3>Shipment timeline</h3>
          <span className="muted">
            {doneCount} of {counted.length} steps · now <b>{lastDone ? stepLabel(lastDone.step, job.mode) : "—"}</b>
          </span>
        </div>
        <div className="tl-actions">
          {lastDone && lastDone.step !== "Created" && (
            <button className="btn ghost small" onClick={onUndo} disabled={busy} title="Go back one step">
              ↶ Undo {stepLabel(lastDone.step, job.mode)}
            </button>
          )}
          {canDetain && (
            <button className="btn outline small" onClick={() => save(detained, { done: true }, "Marked detained")} disabled={busy}>
              Mark detained
            </button>
          )}
          {next && !moving && (
            <button
              className="btn small"
              onClick={() => {
                setMoveDate(todayIso());
                setMoving(true);
              }}
              disabled={busy}
            >
              Move to next step: {stepLabel(next.step, job.mode)} ▸
            </button>
          )}
          {!next && <span className="tl-finished">✓ All steps done</span>}
        </div>
      </div>

      <div className="tl-bar">
        <span style={{ width: `${pct}%` }} />
      </div>

      {moving && next && (
        <div className="tl-move">
          <b>{stepLabel(next.step, job.mode)}</b>
          <label>
            Date
            <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
          </label>
          <input
            className="tl-note"
            placeholder="Note (optional)"
            value={moveNote}
            onChange={(e) => setMoveNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onMove()}
            autoFocus
          />
          {onNotify && (
            <label className="tl-notify" title="Opens Comms with the update ready to check and send, nothing is sent automatically">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notify customer
            </label>
          )}
          <button className="btn small" onClick={onMove} disabled={busy || !moveDate}>
            Save
          </button>
          <button className="btn ghost small" onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      )}

      <ol className="tl-list">
        <li className="tl-row tl-cols muted">
          <span />
          <span>Step</span>
          <span>Planned</span>
          <span>Actual</span>
          <span />
        </li>
        {fold && (
          <li className="tl-row tl-fold">
            <span className="tl-dot tl-dot-sum">✓</span>
            <button type="button" className="link-btn" onClick={() => setShowDone((v) => !v)}>
              {showDone
                ? "Hide the done steps ▴"
                : `${folded.length} steps done: ${stepLabel(folded[0].step, job.mode)} → ${stepLabel(folded[folded.length - 1].step, job.mode)} ▾`}
            </button>
          </li>
        )}
        {listed.map((s) => {
          const state = s.skipped
            ? "skipped"
            : s.id === lastDone?.id
              ? "current"
              : s.done
                ? "done"
                : s.id === next?.id
                  ? "next"
                  : "todo";
          const label = stepLabel(s.step, job.mode);
          const field = PLANNED_FIELD[s.step];
          return (
            <li key={s.id} className={`tl-row is-${state}`}>
              <button
                className="tl-dot"
                disabled={s.done || s.skipped || busy}
                onClick={() => onMarkDone(s)}
                title={s.done ? "Done" : s.skipped ? "Skipped" : `Mark ${label} done`}
                aria-label={s.done ? `${label} done` : `Mark ${label} done`}
              >
                {s.done ? "✓" : ""}
              </button>
              <div className="tl-main">
                <span className="tl-label">
                  {label}
                  {s.skipped && <span className="tag">Skipped</span>}
                  {s.done && !s.actual_date && <span className="muted"> · date not recorded</span>}
                </span>
                <NoteCell value={s.note} onSave={(v) => save(s, { note: v }, "Note saved")} />
              </div>
              <div className="tl-date">
                <DateCell
                  value={s.planned_date}
                  title={field ? `Planned (${field}, same as the shipment's ${field})` : "Planned date"}
                  onSave={(v) => save(s, { planned_date: v })}
                />
                {field && <span className="tl-tag">{field}</span>}
              </div>
              <div className="tl-date">
                <DateCell
                  value={s.actual_date}
                  title={s.done ? "Actual date" : "Actual date (mark the step done to set it)"}
                  disabled={!s.done}
                  onSave={(v) => save(s, { actual_date: v })}
                />
              </div>
              <div className="tl-tools">
                <button
                  className={`tl-icon${s.customer_visible ? "" : " off"}`}
                  onClick={() => save(s, { customer_visible: !s.customer_visible }, s.customer_visible ? "Hidden from the customer" : "Shown to the customer")}
                  title={s.customer_visible ? "Customer can see this step (click to hide)" : "Hidden from the customer (click to show)"}
                  disabled={busy}
                >
                  {s.customer_visible ? "👁" : "🚫"}
                </button>
                {!s.done && s.step !== "Created" && (
                  <button
                    className="tl-icon"
                    onClick={() => save(s, { skipped: !s.skipped }, s.skipped ? `${label} back on` : `${label} skipped`)}
                    title={s.skipped ? "Put this step back" : "Skip, doesn't apply to this shipment"}
                    disabled={busy}
                  >
                    {s.skipped ? "↺" : "⤼"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="tl-foot muted">
        Departed, Arrived and Delivered planned dates are the shipment's ETD, ETA and PDD. Every date change is
        logged{lastDone?.actual_date ? ` · last update ${formatDate(lastDone.actual_date)}` : ""}.
      </p>
    </div>
  );
}
