import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "./Modal";
import DateInput from "./DateInput";
import { useToast } from "./Toast";
import { formatDate } from "../lib/format";
import { useUpdateJob } from "../lib/hooks";
import type { Job, JobPatch } from "../lib/types";
import { notifyText, OPTIONAL_STEP, stepLabel, timelineDb, todayIso, useJobTimeline } from "../lib/timeline";

type FieldKey = "awb_mbl" | "container_no" | "container_type" | "vessel_name" | "shipping_line" | "carrier_name";

/** Transport details for this mode, in the order ops fill them in. */
function transportFields(mode: string): { key: FieldKey; label: string; placeholder?: string }[] {
  const air = mode.startsWith("Air") || mode.startsWith("Courier");
  if (air) {
    return [
      { key: "awb_mbl", label: "AWB No" },
      { key: "carrier_name", label: "Airline" },
    ];
  }
  if (mode.startsWith("Sea")) {
    return [
      { key: "awb_mbl", label: "MBL No" },
      { key: "container_no", label: "Container No" },
      { key: "container_type", label: "Container Type", placeholder: "e.g. 1x 20GP, 2x 40HC" },
      { key: "shipping_line", label: "Shipping Line" },
      { key: "vessel_name", label: "Vessel" },
    ];
  }
  return [
    { key: "awb_mbl", label: "Ref No" },
    { key: "shipping_line", label: "Shipping Line" },
  ];
}

const DATE_FIELDS = [
  { key: "etd", label: "ETD" },
  { key: "eta", label: "ETA" },
  { key: "provisional_delivery_date", label: "PDD" },
] as const;
type DateKey = (typeof DATE_FIELDS)[number]["key"];

/**
 * The pencil on Active Shipments: the daily update in one small window.
 * Move the shipment on (timeline, 0196), revise ETD / ETA / PDD with a
 * reason (logged), fill in transport details still missing, and optionally
 * open the Comms rail to email the customer. Never sends anything itself.
 */
export default function ShipmentQuickUpdate({
  job,
  onClose,
  onDelivered,
  onEmail,
}: {
  job: Job;
  onClose: () => void;
  onDelivered: () => void;
  /** Opens Comms, with the update pre-filled. */
  onEmail: (message?: string) => void;
}) {
  const qc = useQueryClient();
  const { toast, error: toastError } = useToast();
  const stepsQ = useJobTimeline(job.id);
  const updateJob = useUpdateJob();

  const steps = stepsQ.data ?? [];
  const live = steps.filter((s) => !s.skipped && s.step !== OPTIONAL_STEP);
  const lastDone = [...steps.filter((s) => !s.skipped)].reverse().find((s) => s.done) ?? null;
  const upcoming = live.filter((s) => !s.done && s.sort_order > (lastDone?.sort_order ?? 0));

  const [moveTo, setMoveTo] = useState<string>("");
  const [moveDate, setMoveDate] = useState(todayIso());
  const [moveNote, setMoveNote] = useState("");
  const [dates, setDates] = useState<Record<DateKey, string>>({
    etd: job.etd ?? "",
    eta: job.eta ?? "",
    provisional_delivery_date: job.provisional_delivery_date ?? "",
  });
  const [reason, setReason] = useState("");
  // Missing at open time, so a field doesn't vanish while it's being typed.
  const [missing] = useState(() => transportFields(job.mode).filter((f) => !(job[f.key] ?? "").trim()));
  const [fields, setFields] = useState<Partial<Record<FieldKey, string>>>({});
  const [email, setEmail] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default the step picker to the next step once the timeline loads.
  const target = moveTo || upcoming[0]?.id || "";
  const changedDates = DATE_FIELDS.filter((d) => (dates[d.key] || "") !== (job[d.key] ?? ""));

  async function onSave(moveOn: boolean) {
    setSaving(true);
    try {
      const patch: JobPatch = {};
      for (const d of changedDates) patch[d.key] = dates[d.key];
      for (const [k, v] of Object.entries(fields)) if (v.trim()) patch[k as FieldKey] = v.trim();
      if (Object.keys(patch).length) await updateJob.mutateAsync({ id: job.id, patch });

      if (changedDates.length) {
        const what = changedDates
          .map((d) => `${d.label} ${formatDate(job[d.key])} → ${formatDate(dates[d.key] || null)}`)
          .join(", ");
        await timelineDb.logNote({
          jobId: job.id,
          milestone: job.milestone,
          note: `Revised ${what}${reason.trim() ? ": " + reason.trim() : ""}`,
        });
      }

      let status = "";
      const step = steps.find((s) => s.id === target);
      if (moveOn && step) {
        status = await timelineDb.set({
          stepId: step.id,
          patch: { actual_date: moveDate, done: true, ...(moveNote.trim() ? { note: moveNote.trim() } : {}) },
        });
      }

      qc.invalidateQueries({ queryKey: ["job_timeline", job.id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["nav_counts"] });
      toast(status ? `${job.reference} moved to ${stepLabel(status, job.mode)}` : `${job.reference} updated`);
      onClose();
      if (status === "Delivered") onDelivered();
      if (email) {
        const revised = changedDates.map(
          (d) =>
            `Revised ${d.label}: ${formatDate(dates[d.key] || null)}${reason.trim() ? ` (${reason.trim()})` : ""}.`,
        );
        onEmail(notifyText(job.mode, status ? { step: status, date: moveDate } : null, revised));
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const moving = !!target && target !== "__none";
  const nothing = !moving && changedDates.length === 0 && !Object.values(fields).some((v) => v?.trim());

  return (
    <Modal title={`Update ${job.reference}`} onClose={onClose}>
      <div className="qu">
        <p className="qu-now">
          {job.client?.company ?? "—"} · {job.mode} · now{" "}
          <b>{lastDone ? stepLabel(lastDone.step, job.mode) : job.shipment_status || "—"}</b>
        </p>

        <section>
          <h4>1. Move the shipment on</h4>
          {stepsQ.isLoading ? (
            <p className="muted">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="muted">✓ All steps done.</p>
          ) : (
            <div className="qu-row">
              <select value={target} onChange={(e) => setMoveTo(e.target.value)}>
                {upcoming.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i === 0 ? "Next: " : ""}
                    {stepLabel(s.step, job.mode)}
                  </option>
                ))}
                <option value="__none">Don't move it</option>
              </select>
              {target !== "__none" && (
                <>
                  <DateInput value={moveDate} onChange={setMoveDate} />
                  <input
                    className="qu-grow"
                    placeholder="Note (optional)"
                    value={moveNote}
                    onChange={(e) => setMoveNote(e.target.value)}
                  />
                </>
              )}
            </div>
          )}
        </section>

        <section>
          <h4>2. Dates</h4>
          <div className="qu-dates">
            {DATE_FIELDS.map((d) => (
              <label key={d.key} className={(dates[d.key] || "") !== (job[d.key] ?? "") ? "changed" : ""}>
                <span>{d.label}</span>
                <DateInput value={dates[d.key]} onChange={(v) => setDates((x) => ({ ...x, [d.key]: v }))} />
              </label>
            ))}
          </div>
          {changedDates.length > 0 && (
            <input
              className="qu-reason"
              placeholder="Reason (optional), e.g. vessel delayed, goes in the shipment's history"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </section>

        <section>
          <h4>3. Still missing</h4>
          {missing.length === 0 ? (
            <p className="muted">✓ All transport details are filled in.</p>
          ) : (
            <div className="qu-missing">
              {missing.map((f) => (
                <label key={f.key}>
                  <span>{f.label}</span>
                  <input
                    value={fields[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setFields((x) => ({ ...x, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <label className="qu-email">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
          Notify customer (opens Comms with the update filled in, nothing is sent automatically)
        </label>

        <div className="qu-foot">
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => onSave(moving)}
            disabled={saving || nothing || (moving && !moveDate)}
          >
            {saving ? "Saving…" : "Save update"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
