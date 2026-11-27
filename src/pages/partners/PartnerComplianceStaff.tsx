// Vendor record › Compliance (0255): which current documents this partner
// has accepted (and what is outstanding), every acceptance with who / when /
// IP, and the credit application with approve / decline.
import { useState } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import type { PartnerKind } from "../../lib/types";
import {
  CREDIT_FIELDS,
  useCreditDecision,
  useStaffPartnerCompliance,
  type StaffAcceptance,
} from "../../lib/compliance";

function CreditModal({ a, onClose }: { a: StaffAcceptance; onClose: () => void }) {
  const decide = useCreditDecision();
  const { toast, error } = useToast();
  const f = a.form_data ?? {};
  const [limit, setLimit] = useState(f.credit_amount?.replace(/[^\d.]/g, "") ?? "");
  const [currency, setCurrency] = useState(f.credit_currency || "ZAR");
  const [terms, setTerms] = useState("30 days from statement");
  const [note, setNote] = useState("");

  async function go(approve: boolean) {
    try {
      await decide.mutateAsync({ id: a.id, approve, limit: Number(limit) || undefined, currency, terms, note });
      toast(approve ? "Credit approved" : "Credit application declined");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save the decision");
    }
  }

  return (
    <Modal
      wide
      title="Credit application"
      onClose={onClose}
      footer={
        a.review_status === "pending" ? (
          <>
            <button type="button" className="btn outline" disabled={decide.isPending} onClick={() => go(false)}>
              Decline
            </button>
            <button type="button" className="btn" disabled={decide.isPending} onClick={() => go(true)}>
              Approve
            </button>
          </>
        ) : undefined
      }
    >
      <table className="customs-table">
        <tbody>
          {CREDIT_FIELDS.filter((c) => f[c.key]).map((c) => (
            <tr key={c.key}>
              <th style={{ width: "40%" }}>{c.label}</th>
              <td>{f[c.key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Signed by {a.signer_name}
        {a.signer_title ? `, ${a.signer_title}` : ""} on {formatDate(a.accepted_at)}.
      </p>
      {a.review_status === "pending" ? (
        <div className="pb-grid">
          <div className="field">
            <label>Credit limit</label>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label>Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <div className="field">
            <label>Payment terms</label>
            <input value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="field wide">
            <label>Note to the partner (required to decline)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      ) : (
        <p>
          <b>{a.review_status === "approved" ? "Approved" : "Declined"}</b>
          {a.review_status === "approved" && ` · ${a.credit_currency} ${Number(a.credit_limit).toLocaleString()} · ${a.payment_terms}`}
          {a.review_note ? ` · ${a.review_note}` : ""}
          {a.reviewed_at ? ` (${formatDate(a.reviewed_at)})` : ""}
        </p>
      )}
    </Modal>
  );
}

export default function PartnerComplianceStaff({ kind, partnerId }: { kind: PartnerKind; partnerId: string }) {
  const q = useStaffPartnerCompliance(kind, partnerId);
  const [credit, setCredit] = useState<StaffAcceptance | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <div className="panel">
        <ErrorNote error={q.error} />
        <p className="hint">Partner compliance needs migration 0255 in Supabase.</p>
      </div>
    );

  const current = q.data?.current ?? [];
  const acceptances = q.data?.acceptances ?? [];

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Compliance</h3>
      {current.length === 0 ? (
        <EmptyState>No compliance documents are published yet (Settings › Partner Compliance).</EmptyState>
      ) : (
        <div className="pc-status-row">
          {current.map((d) => (
            <div key={d.id} className={`pc-status-card${d.accepted ? " ok" : ""}`}>
              <b>{d.title}</b>
              <span className={`pc-pill ${d.accepted ? "is-ok" : "is-due"}`}>
                {d.accepted ? `Accepted v${d.version}` : `Outstanding v${d.version}`}
              </span>
              {!d.accepted && d.blocks_portal && <span className="hint">Shipments hidden until accepted</span>}
            </div>
          ))}
        </div>
      )}

      <h4>History</h4>
      {acceptances.length === 0 ? (
        <EmptyState>Nothing accepted yet.</EmptyState>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="customs-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Accepted by</th>
                <th>When</th>
                <th>IP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {acceptances.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.title} <span className="hint">v{a.version}</span>
                  </td>
                  <td>
                    {a.signer_name}
                    {a.signer_title ? `, ${a.signer_title}` : ""}
                    {a.accepted_by_email && <div className="hint">{a.accepted_by_email}</div>}
                  </td>
                  <td>{new Date(a.accepted_at).toLocaleString()}</td>
                  <td className="hint">{a.ip || "-"}</td>
                  <td style={{ textAlign: "right" }}>
                    {a.kind === "credit_application" && (
                      <button
                        type="button"
                        className={`btn small${a.review_status === "pending" ? "" : " outline"}`}
                        onClick={() => setCredit(a)}
                      >
                        {a.review_status === "pending"
                          ? "Review credit"
                          : a.review_status === "approved"
                            ? `Approved ${a.credit_currency} ${Number(a.credit_limit).toLocaleString()}`
                            : "Declined"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {credit && <CreditModal a={credit} onClose={() => setCredit(null)} />}
    </div>
  );
}
