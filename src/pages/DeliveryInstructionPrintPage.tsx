import { useNavigate, useParams } from "react-router-dom";
import { useCompanySettings, useJobs } from "../lib/hooks";
import { formatDate, portCode } from "../lib/format";
import { COMPANY } from "../lib/company";

/**
 * Auto-filled from the shipment record — same print-to-PDF pattern as the
 * quotation letterhead. Save the result into the Document Vault by
 * printing/saving as PDF, then uploading it from the shipment's Documents
 * section (no server-side PDF rendering yet, matching QuotePrintPage).
 */
export default function DeliveryInstructionPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: jobs, isLoading } = useJobs();
  const { data: settings } = useCompanySettings();
  const job = jobs?.find((j) => j.id === id);

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

  const rows: [string, string][] = [
    ["Shipment Reference", job.reference],
    ["Mode", job.mode],
    ["Customer / Consignee", job.client?.company ?? "—"],
    ["Shipper / Exporter", job.supplier?.company ?? "—"],
    ["Port of Load", portCode(job.origin)],
    ["Port of Discharge", portCode(job.destination)],
    ["Carrier / Airline", job.carrier_name || "—"],
    ["Shipping Line", job.shipping_line || "—"],
    ["Container No", job.container_no || "—"],
    ["AWB / MBL No", job.awb_mbl || "—"],
    ["ETD", formatDate(job.etd)],
    ["ETA", formatDate(job.eta)],
    ["Provisional Delivery Date", formatDate(job.provisional_delivery_date)],
  ];

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
            <div className="name">DELIVERY INSTRUCTIONS - {company.headerName}</div>
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

        <div className="qs-bar">Delivery Instructions</div>
        <p style={{ fontSize: 11, minHeight: 120, whiteSpace: "pre-line" }}>
          {job.notes || "—"}
        </p>

        <div className="qs-foot">
          <div>
            <h4>Authorised Signature</h4>
            <p style={{ margin: "24px 0 0", borderTop: "1px solid #ccc", width: 220 }} />
          </div>
          <div>
            <h4>Date</h4>
            <p style={{ margin: "24px 0 0", borderTop: "1px solid #ccc", width: 160 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
