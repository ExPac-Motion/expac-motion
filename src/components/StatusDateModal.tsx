import { useState } from "react";
import Modal from "./Modal";
import DateInput from "./DateInput";
import { stepLabel, todayIso } from "../lib/timeline";
import type { Job } from "../lib/types";

export type StatusDateInput = { date: string; note: string; email: boolean };

/**
 * The Status dropdown on Active Shipments: before the new status is saved,
 * ask the date it happened (today by default) and an optional note. The
 * date lands on that timeline step, so the shipment page, quotation,
 * portal and the next email all show it. "Save & email" then opens Comms
 * with the update filled in; nothing is sent automatically.
 */
export default function StatusDateModal({
  job,
  status,
  onClose,
  onSave,
}: {
  job: Job;
  status: string;
  onClose: () => void;
  onSave: (input: StatusDateInput) => Promise<void>;
}) {
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(email: boolean) {
    setSaving(true);
    try {
      await onSave({ date, note: note.trim(), email });
      onClose();
    } catch {
      // onSave reports the error; keep the window open to try again.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${job.reference}: ${stepLabel(status, job.mode)}`} onClose={onClose}>
      <div className="qu">
        <p className="qu-now">
          {job.client?.company ?? "—"} · {job.mode} · now{" "}
          <b>{job.shipment_status ? stepLabel(job.shipment_status, job.mode) : "—"}</b> → new{" "}
          <b>{stepLabel(status, job.mode)}</b>
        </p>
        <section>
          <h4>Date of this status</h4>
          <div className="qu-row">
            <DateInput value={date} onChange={setDate} />
            <input
              className="qu-grow"
              placeholder="Note (optional), goes on the timeline"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </section>
        <div className="qu-foot">
          <button className="btn outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn outline" onClick={() => void save(false)} disabled={saving || !date}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn" onClick={() => void save(true)} disabled={saving || !date}>
            Save &amp; email customer
          </button>
        </div>
      </div>
    </Modal>
  );
}
