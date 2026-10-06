import { useState } from "react";
import Modal from "./Modal";
import DateInput from "./DateInput";
import { useToast } from "./Toast";
import { todayPlusDays } from "../lib/format";
import type { PodInput } from "../lib/pod";

/** Upload a signed proof of delivery (0151): file, who signed, date, and
 *  whether to email it to the customer. Used on shipments and releases. */
export default function PodModal({
  title,
  intro,
  customerEmail,
  onSave,
  onClose,
}: {
  title: string;
  intro?: string;
  customerEmail?: string | null;
  onSave: (pod: PodInput) => Promise<{ emailed: boolean }>;
  onClose: () => void;
}) {
  const { toast, error } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [signedBy, setSignedBy] = useState("");
  const [date, setDate] = useState(todayPlusDays(0));
  const [email, setEmail] = useState(!!customerEmail);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return error("Attach the signed POD (photo or PDF)");
    setBusy(true);
    try {
      const r = await onSave({ file, signedBy: signedBy.trim(), deliveredAt: date, email });
      toast(r.emailed ? "Proof of delivery saved and emailed to the customer" : "Proof of delivery saved");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save the POD");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {intro && (
        <p className="hint" style={{ marginTop: 0 }}>
          {intro}
        </p>
      )}
      <div className="field">
        <label>Signed POD (photo or PDF)</label>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>Signed for by</label>
          <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name of the person who signed" />
        </div>
        <div className="field">
          <label>Delivery date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={email} disabled={!customerEmail} onChange={(e) => setEmail(e.target.checked)} />{" "}
        {customerEmail ? `Email it to the customer (${customerEmail})` : "No customer email on file, it shows on their portal"}
      </label>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Later
        </button>
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? "Saving…" : "Save POD"}
        </button>
      </div>
    </Modal>
  );
}
