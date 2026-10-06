// Email an Agent / Transporter / Clearing Agent from their list row:
// "About a shipment" uses the Shipment Comms compose (Reply / Full Update,
// remarks, attachments) addressed to the partner, logged on that shipment's
// thread; "General message" is the template + signature Quick Mail.
import { useMemo, useState } from "react";
import Modal from "../../components/Modal";
import QuickMailModal from "../../components/QuickMailModal";
import { useJobs, useQuotes } from "../../lib/hooks";
import { isShipmentComplete, type Contact, type PartnerKind } from "../../lib/types";
import { PARTNER_LABEL, partnerIdKey } from "../../lib/tariff";
import CommsPanel from "../shipments/CommsPanel";

export default function PartnerMailModal({
  kind,
  partner,
  onClose,
}: {
  kind: PartnerKind;
  partner: Contact;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"shipment" | "general">("shipment");
  const [showAll, setShowAll] = useState(false);
  const [jobId, setJobId] = useState("");
  const jobsQ = useJobs();
  const quotesQ = useQuotes();

  // Shipments this partner handles = jobs whose quotation names them.
  const { theirs, active } = useMemo(() => {
    const key = partnerIdKey(kind);
    const quoteIds = new Set(
      (quotesQ.data ?? []).filter((q) => q[key] === partner.id).map((q) => q.id),
    );
    const jobs = jobsQ.data ?? [];
    const open = (j: (typeof jobs)[number]) => !isShipmentComplete(j);
    const mine = jobs
      .filter((j) => j.quote_id && quoteIds.has(j.quote_id))
      .sort((a, b) => Number(open(b)) - Number(open(a)));
    return { theirs: mine, active: jobs.filter(open) };
  }, [jobsQ.data, quotesQ.data, kind, partner.id]);

  if (mode === "general") {
    return (
      <QuickMailModal
        to={partner.email}
        company={partner.company}
        name={partner.contact}
        onClose={onClose}
      />
    );
  }

  const list = showAll ? active : theirs;
  const job = (jobsQ.data ?? []).find((j) => j.id === jobId) ?? null;
  const role = PARTNER_LABEL[kind];

  return (
    <Modal title={`Email ${partner.company}`} onClose={onClose} wide>
      <div className="comms-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="chip on">
          About a shipment
        </button>
        <button type="button" className="chip" onClick={() => setMode("general")}>
          General message
        </button>
      </div>
      <div className="field">
        <label>Shipment</label>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">
            {jobsQ.isLoading || quotesQ.isLoading
              ? "Loading shipments…"
              : list.length
                ? "— pick a shipment —"
                : showAll
                  ? "No active shipments"
                  : `No shipments with this ${role.toLowerCase()} on the quotation`}
          </option>
          {list.map((j) => (
            <option key={j.id} value={j.id}>
              {[
                j.reference,
                j.client?.company,
                [j.origin, j.destination].filter(Boolean).join(" → "),
                j.shipment_status || j.milestone,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </select>
        <label className="check small" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              setJobId("");
            }}
          />
          Show every active shipment (not only ones quoted with {partner.company})
        </label>
      </div>
      {job ? (
        <CommsPanel
          key={job.id}
          job={job}
          to={[{ label: role, email: partner.email ?? "" }]}
        />
      ) : (
        <p className="hint">
          Pick a shipment to send a Reply or Full Update to {partner.company}, it's logged on the
          shipment's message thread. For anything else, use General message.
        </p>
      )}
    </Modal>
  );
}
