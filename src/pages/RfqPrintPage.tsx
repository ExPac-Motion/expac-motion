import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCompanySettings, useMyProfile, useQuote } from "../lib/hooks";
import { COMPANY } from "../lib/company";
import { formatDate, portCode } from "../lib/format";
import { packingRow, packingTotals, volumetricFactor } from "../lib/calc";
import { usesSeaLayout } from "../lib/docTemplates";
import { RFQ_TITLE, defaultReplyBy, isRfqKind, rfqChargeGroups, rfqKindLabel, rfqReplyUrl, rfqSections } from "../lib/rfq";
import BackButton from "../components/BackButton";
import type { PartnerKind, Quote } from "../lib/types";

function n2(v: number | string | null | undefined): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Short section names for the Service Scope line. */
const SCOPE_LABEL: Record<string, string> = {
  "International Freight Charges": "International freight",
  "Ex-Works Charges": "Ex-works / pick up",
  "FOB Charges": "FOB charges",
  "Destination Handling and Delivery Charges": "Destination handling and delivery",
  "Customs Clearance, VAT and Duty Charges": "Customs clearance",
};

/**
 * Req for Quote (/quotes/:id/rfq): the shipment details an agent needs to
 * price it, in the Document Vault layout, and a blank charges table for the
 * agent's rates. Deliberately carries NO customer, consignee or shipper
 * names, so the agent can't go around ExPac. Query: kind (partner type),
 * reply (ISO reply-by date), agent (their company), notes (to the agent).
 */
export default function RfqPrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const quoteQ = useQuote(id);
  const { data: settings } = useCompanySettings();
  const meQ = useMyProfile();

  const kindParam = params.get("kind");
  const kind = isRfqKind(kindParam) ? kindParam : "agent";
  const replyBy = params.get("reply") || defaultReplyBy();
  const agent = params.get("agent")?.trim() || "";
  const notes = params.get("notes")?.trim() || "";
  const token = params.get("t") || undefined;

  const company: RfqCompany = settings
    ? {
        logoPrint: COMPANY.logoPrint,
        headerName: settings.legal_name,
        headerLine1: `Reg No: ${settings.reg_no}  ·  Vat No: ${settings.vat_no}  ·  Tel: ${settings.tel}`,
        headerEmail: `Email: ${settings.email}`,
        headerLine2: settings.postal_address,
        tel: settings.tel,
        email: settings.email,
      }
    : { ...COMPANY, tel: "", email: "" };

  if (quoteQ.isLoading) return <div className="center-note">Loading quotation…</div>;
  const q = quoteQ.data;
  if (!q) return <div className="center-note">Quotation not found</div>;

  return (
    <div className="qs-wrap">
      <div className="qs-toolbar">
        <BackButton onClick={() => navigate(-1)} />
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <RfqSheet
        q={q}
        company={company}
        me={meQ.data?.full_name}
        ready={Boolean(settings) && !meQ.isLoading}
        kind={kind}
        replyBy={replyBy}
        agent={agent}
        notes={notes}
        token={token}
      />
    </div>
  );
}

export interface RfqCompany {
  logoPrint: string;
  headerName: string;
  headerLine1: string;
  headerEmail: string;
  headerLine2: string;
  tel: string;
  email: string;
}

/** The RFQ sheet itself, also used by the DEV demo (/quotes/demo/rfq). */
export function RfqSheet({
  q,
  company,
  me: meName,
  ready,
  kind,
  replyBy,
  agent,
  notes,
  token,
}: {
  q: Pick<Quote, "reference" | "mode" | "origin" | "destination" | "incoterms" | "commodity" | "request_ready_date" | "etd" | "container_type" | "request_pickup" | "quote_lines" | "packing_list_items">;
  company: RfqCompany;
  me?: string | null;
  ready: boolean;
  kind: PartnerKind;
  replyBy: string;
  agent: string;
  notes: string;
  /** The agent's reply-link token; prints their online reply link. */
  token?: string;
}) {
  const vFactor = volumetricFactor(q.mode);
  const packingRows = q.packing_list_items ?? [];
  const pack = packingTotals(packingRows, vFactor);
  const groups = rfqChargeGroups(q, kind);
  const sea = usesSeaLayout(q.mode);
  const me = meName?.trim();

  const parties: [string, string][] = [
    [
      "Requested By",
      [company.headerName, me && `Attn: ${me}`, company.tel && `Tel: ${company.tel}`, company.email && `Email: ${company.email}`]
        .filter(Boolean)
        .join("\n"),
    ],
    [rfqKindLabel(kind), agent || "—"],
  ];
  const rows: [string, string][] = [
    ["RFQ Number", `RFQ-${q.reference}`],
    ["RFQ Date", formatDate(new Date().toISOString())],
    ["Reply By", formatDate(replyBy)],
    ["Mode", q.mode],
    ["Port of Load", portCode(q.origin)],
    ["Port of Discharge", portCode(q.destination)],
    ["Origin", q.origin || "—"],
    ["Destination", q.destination || "—"],
    ["Incoterms", q.incoterms || "—"],
    ["Commodity", q.commodity || "—"],
    ["Cargo Ready", formatDate(q.request_ready_date)],
    ["ETD", formatDate(q.etd)],
    ...(sea ? ([["Container Type", q.container_type || "—"]] as [string, string][]) : []),
    ["Collect From", q.request_pickup?.trim() || "—"],
    ["Service Scope", rfqSections(kind, q.incoterms).map((c) => SCOPE_LABEL[c] ?? c).join(", ")],
    ["Rates In", "Currency per line, excl. VAT"],
  ];

  return (
      <div className="qs-sheet" data-ready={ready ? "1" : undefined}>
        <div className="qs-companyhead">
          <img
            className="logo"
            src={company.logoPrint}
            alt="ExPac"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
          <div className="qs-companyhead-text">
            <div className="name">
              {RFQ_TITLE.toUpperCase()}
              <br />
              {company.headerName}
            </div>
            <div className="lines">{company.headerLine1}</div>
            <div className="lines">
              {company.headerEmail}&nbsp; &middot; &nbsp;{company.headerLine2}
            </div>
          </div>
        </div>

        <div className="qs-bar">Shipment Information</div>
        <div className="qs-info" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 4 }}>
          {parties.map(([k, v]) => (
            <div key={k}>
              <div className="k">{k}</div>
              <div className="v" style={{ whiteSpace: "pre-line" }}>
                {v}
              </div>
            </div>
          ))}
        </div>
        <div className="qs-info" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>

        <div className="qs-bar">Packing List Information</div>
        {packingRows.length > 0 ? (
          <>
            <table className="qs-pk">
              <colgroup>
                {Array.from({ length: 10 }).map((_, i) => (
                  <col key={i} style={{ width: "9.3%" }} />
                ))}
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>L<br />(cm)</th>
                  <th>W<br />(cm)</th>
                  <th>H<br />(cm)</th>
                  <th>Act<br />(Kg)</th>
                  <th>Qty<br />(Pcs)</th>
                  <th>Qty<br />(Ctns)</th>
                  <th>CBM<br />(Ctn)</th>
                  <th>Volume<br />(Kg)</th>
                  <th>Ttl<br />(Cbm)</th>
                  <th>Ttl Act<br />(Kg)</th>
                  <th>Ttl Vol<br />(Kg)</th>
                </tr>
              </thead>
              <tbody>
                {packingRows.map((p, i) => {
                  const r = packingRow(p, vFactor);
                  return (
                    <tr key={String(p.id ?? i)}>
                      <td>{n2(p.length_cm)}</td>
                      <td>{n2(p.width_cm)}</td>
                      <td>{n2(p.height_cm)}</td>
                      <td>{n2(p.actual_kg)}</td>
                      <td>{n2(p.qty_pcs)}</td>
                      <td>{n2(p.qty_ctns)}</td>
                      <td>{n2(r.cbm)}</td>
                      <td>{n2(r.volumeKg)}</td>
                      <td>{n2(r.totalCbm)}</td>
                      <td>{n2(r.totalActual)}</td>
                      <td>{n2(r.totalVolume)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Totals</td>
                  <td>{n2(pack.pcs)}</td>
                  <td>{n2(pack.qty)}</td>
                  <td />
                  <td />
                  <td>{n2(pack.totalCbm)}</td>
                  <td>{n2(pack.totalActual)}</td>
                  <td>{n2(pack.totalVolume)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="qs-pksum">
              <div>
                <span className="k">Total Act (KGS)</span> <b>{n2(pack.totalActual)}</b>
              </div>
              <div>
                <span className="k">Volume (KGS)</span> <b>{n2(pack.totalVolume)}</b>
              </div>
              <div>
                <span className="k">Chg Vol (CBM)</span> <b className="hl">{n2(pack.totalCbm)}</b>
              </div>
              <div>
                <span className="k">Chg Weight (KGS)</span> <b className="hl">{n2(pack.chargeable)}</b>
              </div>
            </div>
          </>
        ) : (
          <p className="hint">Packing list to follow.</p>
        )}

        <div className="qs-bar">Charges Requested</div>
        <table className="qs-pk rfq-charges">
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "31%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Unit</th>
              <th>Cur</th>
              <th>Rate</th>
              <th>Min Charge</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RfqGroup key={g.category} title={g.category} rows={g.rows} />
            ))}
            {/* Spare lines for charges the agent adds themselves. */}
            {[0, 1, 2].map((i) => (
              <tr key={`spare-${i}`}>
                <td />
                <td />
                <td />
                <td />
                <td className="rfq-fill" />
                <td className="rfq-fill" />
                <td className="rfq-fill" />
              </tr>
            ))}
          </tbody>
        </table>

        {notes && (
          <>
            <div className="qs-bar">Notes to Agent</div>
            <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-line" }}>{notes}</p>
          </>
        )}

        <div className="qs-bar">Quoted By</div>
        <div className="qs-sig">
          <div className="qs-sig-field">
            <label>Company</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Name &amp; Last Name</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Rate Validity</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Transit Time / Routing</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field wide">
            <label>Agent Remarks</label>
            <div className="line tall" />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {token ? (
            <>
              Submit your rates online by {formatDate(replyBy)} at <b>{rfqReplyUrl(token)}</b>, or reply to{" "}
              {company.email || "ExPac"} quoting RFQ-{q.reference}.
            </>
          ) : (
            <>
              Please reply to {company.email || "ExPac"} by {formatDate(replyBy)} quoting RFQ-{q.reference}.
            </>
          )}{" "}
          Rates are treated as confidential between ExPac and the quoting agent.
        </p>
      </div>
  );
}

function RfqGroup({ title, rows }: { title: string; rows: { code: string; description: string; unit: string; cur: string }[] }) {
  return (
    <>
      <tr className="rfq-group">
        <td colSpan={7}>{title}</td>
      </tr>
      {rows.map((r) => (
        <tr key={`${title}-${r.code}`}>
          <td>{r.code}</td>
          <td style={{ whiteSpace: "normal" }}>{r.description}</td>
          <td>{r.unit || "—"}</td>
          <td>{r.cur}</td>
          <td className="rfq-fill" />
          <td className="rfq-fill" />
          <td className="rfq-fill" />
        </tr>
      ))}
    </>
  );
}
