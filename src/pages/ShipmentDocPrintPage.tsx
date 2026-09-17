import { useNavigate, useParams } from "react-router-dom";
import { useCompanySettings, useJobs, useQuote } from "../lib/hooks";
import { COMPANY } from "../lib/company";
import { docTypeBySlug, shipmentInfoRows } from "../lib/docTemplates";
import { packingRow, packingTotals, volumetricFactor } from "../lib/calc";

function n2(v: number | string | null | undefined): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Generic operational-document letterhead shared by every Document Vault
 * document type: shipment info + packing list + a Received By / Name & Last
 * Name / Signature / Date / Remarks sign-off block. Print-to-PDF only, same
 * pattern as QuotePrintPage — save the PDF, then attach it to an email or
 * upload it via the shipment's Documents section.
 */
export default function ShipmentDocPrintPage() {
  const { id, doc } = useParams();
  const navigate = useNavigate();
  const { data: jobs, isLoading } = useJobs();
  const { data: settings } = useCompanySettings();
  const job = jobs?.find((j) => j.id === id);
  const quoteQ = useQuote(job?.quote_id ?? undefined);
  const packingRows = quoteQ.data?.packing_list_items ?? [];
  const vFactor = volumetricFactor(job?.mode);
  const pack = packingTotals(packingRows, vFactor);
  const def = docTypeBySlug(doc);

  const company = settings
    ? {
        logoPrint: COMPANY.logoPrint,
        headerName: settings.legal_name,
        headerLine1: `Reg No: ${settings.reg_no}  ·  Vat No: ${settings.vat_no}  ·  Tel: ${settings.tel}`,
        headerEmail: `Email: ${settings.email}`,
        headerLine2: settings.postal_address,
      }
    : COMPANY;

  if (isLoading) return <div className="center-note">Loading shipment…</div>;
  if (!job) return <div className="center-note">Shipment not found</div>;
  if (!def) return <div className="center-note">Unknown document type</div>;

  const rows = shipmentInfoRows(job, quoteQ.data);

  return (
    <div className="qs-wrap">
      <div className="qs-toolbar">
        <button className="btn outline" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="qs-sheet">
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
              {def.title.toUpperCase()} - {company.headerName}
            </div>
            <div className="lines">{company.headerLine1}</div>
            <div className="lines">
              {company.headerEmail}&nbsp; &middot; &nbsp;{company.headerLine2}
            </div>
          </div>
        </div>

        <div className="qs-bar">Shipment Information</div>
        <div className="qs-info">
          {rows.map(([k, v]) => (
            <div key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>

        {def.showNotes && (
          <>
            <div className="qs-bar">{def.notesLabel ?? def.title}</div>
            <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-line" }}>
              {job.notes || "—"}
            </p>
          </>
        )}

        <div className="qs-bar">Packing List Information</div>
        {packingRows.length > 0 ? (
          <>
            <table className="qs-pk">
              <colgroup>
                {Array.from({ length: 9 }).map((_, i) => (
                  <col key={i} style={{ width: "10.33%" }} />
                ))}
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>L (cm)</th>
                  <th>W (cm)</th>
                  <th>H (cm)</th>
                  <th>Actual</th>
                  <th>Qty</th>
                  <th>CBM</th>
                  <th>Volume</th>
                  <th>Tot CBM</th>
                  <th>Tot Act</th>
                  <th>Tot Vol</th>
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
                <span className="k">Chg Vol (CBM)</span>{" "}
                <b className="hl">{n2(pack.totalCbm)}</b>
              </div>
              <div>
                <span className="k">Chg Weight (KGS)</span>{" "}
                <b className="hl">{n2(pack.chargeable)}</b>
              </div>
            </div>
          </>
        ) : (
          <p className="hint">No packing list on record for this shipment.</p>
        )}

        <div className="qs-bar">Expac Remarks</div>
        <p style={{ fontSize: 11, minHeight: 40, whiteSpace: "pre-line" }}>
          {job.ops_remarks || "—"}
        </p>

        <div className="qs-bar">Received By</div>
        <div className="qs-sig">
          <div className="qs-sig-field">
            <label>Received By</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Name &amp; Last Name</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Signature</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field">
            <label>Date</label>
            <div className="line" />
          </div>
          <div className="qs-sig-field wide">
            <label>Customer Remarks</label>
            <div className="line tall" />
          </div>
        </div>
      </div>
    </div>
  );
}
