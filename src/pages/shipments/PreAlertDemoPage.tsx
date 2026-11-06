// DEV only (/dev/pre-alert): the Import Pre-Alert document with sample data,
// so its layout can be checked without signing in. Same letterhead + Shipment
// Information markup as ShipmentDocPrintPage, real PreAlert sections.
import { COMPANY } from "../../lib/company";
import { shipmentInfoRows, shipmentPartyRows } from "../../lib/docTemplates";
import type { Job } from "../../lib/types";
import { PreAlertDetails, PreAlertInstructions, type PreAlertData } from "./PreAlertSections";

const job = {
  id: "demo",
  reference: "SEA126049",
  mode: "Sea Freight (LCL)",
  origin: "CNSZX, Shenzhen, China",
  destination: "ZADUR, Durban, South Africa",
  shipping_line: "MSC",
  vessel_name: "DOLPHIN II",
  voyage_no: "FA542A",
  container_no: "MSCU1234567",
  container_type: "LCL",
  awb_mbl: "MEDUSZ123456",
  po_no: "Kiddies Trampoline",
  shipment_status: "Loaded on vessel",
  etd: "2026-11-06",
  eta: "2026-12-05",
  provisional_delivery_date: "2026-12-11",
  ops_remarks: "Goods to be released to Buffalo Warehouse on payment.",
  client: { id: "c", company: "Nicole Block", address: "12 Long Street, Cape Town", contact: "Nicole Block", phone: "082 000 0000", email: "nicole@example.co.za", company_phone: null },
  supplier: { id: "s", company: "Buffalo Warehouse", address: "Bao'an, Shenzhen", contact: "Lily", phone: "+86 755 0000", email: null },
} as unknown as Job;

export default function PreAlertDemoPage() {
  const pa: PreAlertData = {
    job,
    importer: { import_code: "21234567", vat_no: "4123456789" },
    clearingAgent: "Acme Clearing (Pty) Ltd",
    packages: 12,
    massKg: 482.5,
    signatory: { full_name: "Oliver Collins", department: "support" },
    specialInstructions: job.ops_remarks,
  };
  const rows = shipmentInfoRows(job, { mbl_no: "MEDUSZ123456", hbl_no: "EXP-HBL-0049", voyage_no: "FA542A", incoterms: "FOB", commodity: "Trampolines" } as never, "Oliver Collins");
  return (
    <div className="qs-wrap">
      <div className="qs-sheet">
        <div className="qs-companyhead">
          <img className="logo" src={COMPANY.logoPrint} alt="ExPac" />
          <div className="qs-companyhead-text">
            <div className="name">IMPORT PRE-ALERT - {COMPANY.headerName}</div>
            <div className="lines">{COMPANY.headerLine1}</div>
            <div className="lines">
              {COMPANY.headerEmail}&nbsp; &middot; &nbsp;{COMPANY.headerLine2}
            </div>
          </div>
        </div>
        <div className="qs-bar">Shipment Information</div>
        <div className="qs-info" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 4 }}>
          {shipmentPartyRows(job).map(([k, v]) => (
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
        <PreAlertDetails {...pa} />
        <div className="qs-bar">Packing List Information</div>
        <p className="hint">(packing list prints here, as on every document)</p>
        <PreAlertInstructions {...pa} />
      </div>
    </div>
  );
}
