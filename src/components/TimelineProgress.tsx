import { formatDate } from "../lib/format";
import { stepLabel } from "../lib/timeline";

/**
 * The customer-facing progress bar for a shipment's timeline (0196 / 0197):
 * the visible steps in order, a tick and the date on each done one,
 * "Expected ..." under the ETD / ETA / PDD steps still to come. Same look
 * as the portal's progress bar (.sp-steps).
 */
export default function TimelineProgress({
  steps,
  mode,
  delivered,
}: {
  steps: { step: string; done: boolean; actual_date: string | null; planned_date: string | null }[];
  mode: string;
  delivered?: boolean;
}) {
  if (steps.length === 0) return null;
  const last = steps.reduce((n, s, i) => (s.done ? i : n), -1);
  const current = delivered ? steps.length - 1 : Math.max(0, last);
  return (
    <ol
      className="sp-steps"
      style={{ ["--sp-frac" as string]: current / Math.max(1, steps.length - 1), ["--sp-n" as string]: steps.length }}
    >
      {steps.map((s, i) => {
        const state = i < current || (i === current && delivered) ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s.step} className={`sp-step ${state}${s.step === "Detained" ? " alert" : ""}`}>
            <span className="sp-dot" aria-hidden>
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="sp-label">{stepLabel(s.step, mode)}</span>
            <span className="sp-when">
              {s.done && s.actual_date
                ? formatDate(s.actual_date)
                : !s.done && s.planned_date
                  ? `Expected ${formatDate(s.planned_date)}`
                  : state === "current"
                    ? "Now"
                    : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
