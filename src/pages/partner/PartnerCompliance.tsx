// Partner portal › Compliance (0255): the Document Vault. Each current
// document shows as To sign or Signed; the partner reads it and accepts it
// with name, title and typed signature. The credit application also takes
// the application details, and shows ExPac's decision once reviewed.
import { useState, type FormEvent } from "react";
import { ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  COMPLIANCE_LABEL,
  CREDIT_FIELDS,
  legalHtml,
  needsSigning,
  printSignedCopy,
  useAcceptCompliance,
  usePartnerCompliance,
  type PartnerComplianceDoc,
} from "../../lib/compliance";

function CreditDecision({ d }: { d: PartnerComplianceDoc }) {
  const a = d.acceptance;
  if (!a || a.review_status === "n/a") return null;
  if (a.review_status === "pending")
    return <div className="pc-decision is-pending">ExPac is reviewing your application.</div>;
  if (a.review_status === "approved")
    return (
      <div className="pc-decision is-approved">
        Approved: credit limit <b>{a.credit_currency} {Number(a.credit_limit).toLocaleString()}</b>, terms{" "}
        <b>{a.payment_terms}</b>.{a.review_note ? ` ${a.review_note}` : ""}
      </div>
    );
  return (
    <div className="pc-decision is-declined">
      Not approved{a.review_note ? `: ${a.review_note}` : "."}
    </div>
  );
}

function AcceptPanel({ d, company }: { d: PartnerComplianceDoc; company: string }) {
  const accept = useAcceptCompliance();
  const { toast, error } = useToast();
  const [agree, setAgree] = useState(false);
  const isCredit = d.kind === "credit_application";
  const prior = d.acceptance?.form_data ?? {};

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const form: Record<string, string> = {};
    if (isCredit) for (const c of CREDIT_FIELDS) if (get(c.key)) form[c.key] = get(c.key);
    try {
      await accept.mutateAsync({
        documentId: d.id,
        name: get("name"),
        title: get("title"),
        signature: get("signature"),
        form,
      });
      toast(isCredit ? "Credit application sent to ExPac" : `${d.title} accepted`);
    } catch (err) {
      error(err instanceof Error ? err.message : "Could not accept");
    }
  }

  const groups = [...new Set(CREDIT_FIELDS.map((c) => c.group))];
  return (
    <form className="pc-accept" onSubmit={submit}>
      {isCredit &&
        groups.map((g) => (
          <fieldset key={g} className="pc-group">
            <legend>{g}</legend>
            <div className="pb-grid">
              {CREDIT_FIELDS.filter((c) => c.group === g).map((c) => (
                <div key={c.key} className={`field${c.wide ? " wide" : ""}`}>
                  <label>
                    {c.label}
                    {c.required ? " *" : ""}
                  </label>
                  <input
                    name={c.key}
                    required={c.required}
                    defaultValue={prior[c.key] ?? (c.key === "registered_name" ? company : c.key === "credit_currency" ? "ZAR" : "")}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      <fieldset className="pc-group">
        <legend>{isCredit ? "Sign and submit" : "Accept"}</legend>
        <div className="pb-grid">
          <div className="field">
            <label>Your full name *</label>
            <input name="name" required autoComplete="name" />
          </div>
          <div className="field">
            <label>Your title / position</label>
            <input name="title" autoComplete="organization-title" />
          </div>
          <div className="field wide">
            <label>Signature: type your full name *</label>
            <input name="signature" required className="pc-sig-input" />
          </div>
        </div>
        <label className="pc-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I have read the {d.title} and I am authorised to {isCredit ? "submit this application" : "accept it"} on
            behalf of <b>{company}</b>.
          </span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="btn" disabled={!agree || accept.isPending}>
            {accept.isPending ? "Saving…" : isCredit ? "Submit application" : "I accept"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export default function PartnerCompliance({ company }: { company: string }) {
  const q = usePartnerCompliance();
  const [openId, setOpenId] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <>
        <PageHeader eyebrow="Document Vault" title="Compliance" />
        <ErrorNote error={q.error} />
      </>
    );

  const docs = q.data?.documents ?? [];
  const toSign = docs.filter(needsSigning);
  // Opens on the document that blocks the portal, until the partner picks one.
  const open =
    openId === null
      ? (q.data?.ok ? null : toSign.find((d) => d.blocks_portal)) ?? null
      : docs.find((d) => d.id === openId) ?? null;

  return (
    <>
      <PageHeader eyebrow="Document Vault" title="Compliance" />
      {!q.data?.ok && (
        <div className="pc-gate">
          <b>Please accept the Non-Disclosure Agreement to open your portal.</b>
          <span>
            ExPac shares its customers' details and shipment documents with you. Your shipments, customs files and
            documents open as soon as it is accepted.
          </span>
        </div>
      )}
      {docs.length === 0 ? (
        <p className="hint">There are no documents for you to sign at the moment.</p>
      ) : (
        <div className="pc-list">
          {docs.map((d) => {
            const a = d.acceptance;
            const due = needsSigning(d);
            return (
              <div key={d.id} className={`pc-card${open?.id === d.id ? " open" : ""}`}>
                <button type="button" className="pc-card-head" onClick={() => setOpenId(open?.id === d.id ? "" : d.id)}>
                  <div>
                    <div className="pc-title">
                      {d.title}
                      {d.blocks_portal && <span className="pc-req">Required</span>}
                    </div>
                    <div className="hint">{d.summary || COMPLIANCE_LABEL[d.kind]}</div>
                  </div>
                  <div className="pc-state">
                    {due ? (
                      <span className="pc-pill is-due">{a ? `New version ${d.version} to sign` : "To sign"}</span>
                    ) : (
                      <span className="pc-pill is-ok">Signed v{a?.version}</span>
                    )}
                    {a && !due && <span className="hint">{formatDate(a.accepted_at)}</span>}
                  </div>
                </button>
                {open?.id === d.id && (
                  <div className="pc-body">
                    <CreditDecision d={d} />
                    <div className="pc-doc" dangerouslySetInnerHTML={{ __html: legalHtml(d.body) }} />
                    {due ? (
                      <AcceptPanel d={d} company={company} />
                    ) : (
                      a && (
                        <div className="pc-signed">
                          <span>
                            Accepted by <b>{a.signer_name}</b>
                            {a.signer_title ? `, ${a.signer_title}` : ""} on {formatDate(a.accepted_at)}
                          </span>
                          <button type="button" className="btn outline small" onClick={() => printSignedCopy(d, a, company)}>
                            Download signed copy
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
