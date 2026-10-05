import type { ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCompanySettings } from "../../lib/hooks";
import { COMPANY } from "../../lib/company";
import { formatDate, formatDateTime, money } from "../../lib/format";
import {
  CONDITION_LABEL,
  packageTotals,
  qty,
  useWmsBillingRuns,
  useWmsConsols,
  useWmsCounts,
  useWmsReceipts,
  useWmsReleases,
  type WmsConsol,
  type WmsConsolHouse,
} from "../../lib/wms";
import { BillingLinesTable } from "./WmsBilling";
import { consolTotals, houseNo } from "./WmsConsols";
import { HblSheet, LoadPlanSheet, SeaManifestSheet } from "./WmsSeaDocs";
import { useWmsLookups } from "./shared";

const TITLES: Record<string, string> = {
  receipt: "Warehouse Receipt",
  release: "Warehouse Release Note",
  billing: "Storage Statement",
  count: "Cycle Count Sheet",
  mawb: "Master Air Waybill",
  hawb: "House Air Waybill",
  manifest: "Air Cargo Manifest",
  hbl: "House Bill of Lading",
  "sea-manifest": "Cargo Manifest",
  loadplan: "Load Plan",
};

/** Printable WMS documents: /wms/print/:doc/:id (Print / Save as PDF). */
export default function WmsPrintPage() {
  const { doc = "", id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const receiptsQ = useWmsReceipts();
  const releasesQ = useWmsReleases();
  const runsQ = useWmsBillingRuns();
  const countsQ = useWmsCounts();
  const consolsQ = useWmsConsols();

  const loading =
    lk.loading || receiptsQ.isLoading || releasesQ.isLoading || runsQ.isLoading || countsQ.isLoading || consolsQ.isLoading;
  if (!TITLES[doc]) return <div className="center-note">Unknown document</div>;
  if (loading) return <div className="center-note">Loading…</div>;

  const toolbar = (
    <div className="qs-toolbar">
      <button className="btn outline" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <button className="btn" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  );

  let body: ReactNode = null;
  if (doc === "receipt") {
    const r = receiptsQ.data?.find((x) => x.id === id);
    if (!r) return <div className="center-note">Receipt not found</div>;
    const pk = packageTotals(r.packages);
    body = (
      <LetterSheet title={TITLES.receipt}>
        <div className="qs-bar">Receipt Information</div>
        <Grid
          cols={4}
          rows={[
            ["Receipt No", r.receipt_no],
            ["Date Received", formatDateTime(r.received_at)],
            ["Warehouse", lk.warehouse(r.warehouse_id)?.name ?? "—"],
            ["Zone / Bay", lk.locName(r.location_id)],
            ["Customer", lk.clientName(r.client_id)],
            ["Shipment Reference", lk.jobRef(r.job_id)],
            ["Customer Reference", r.customer_reference || "—"],
            ["Inbound Ref (Waybill / DN)", r.inbound_ref || "—"],
            ["Shipper / Supplier", lk.supplier(r.supplier_id)?.company ?? "—"],
            ["Delivered By", r.delivered_by || "—"],
            ["Vehicle Reg", r.vehicle_reg || "—"],
            ["Driver", r.driver_name || "—"],
            ["Condition", CONDITION_LABEL[r.condition]],
            ["Hazardous", r.hazardous ? "Yes" : "No"],
            ["Received By", lk.person(r.received_by)],
            ["Package Type", r.package_type || "—"],
          ]}
        />
        <div className="qs-bar">Cargo</div>
        <Grid
          cols={4}
          rows={[
            ["Description of Goods", r.description || "—"],
            ["Marks & Numbers", r.marks || "—"],
            ["Pieces", String(r.pieces)],
            ["Pallets", String(r.pallets)],
            ["Gross Weight (KG)", qty(r.gross_kg)],
            ["Volume (CBM)", qty(r.volume_cbm, 3)],
          ]}
        />
        {r.packages.length > 0 && (
          <>
            <div className="qs-bar">Package Items</div>
            <table className="qs-pk wms-doc-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>L (cm)</th>
                  <th>W (cm)</th>
                  <th>H (cm)</th>
                  <th>Kg / Unit</th>
                  <th>Tot KG</th>
                  <th>Tot CBM</th>
                </tr>
              </thead>
              <tbody>
                {r.packages.map((p, i) => {
                  const q = Number(p.qty) || 0;
                  const cbm = ((Number(p.length_cm) || 0) * (Number(p.width_cm) || 0) * (Number(p.height_cm) || 0)) / 1_000_000;
                  return (
                    <tr key={i}>
                      <td>{p.sku || "—"}</td>
                      <td>{p.description || "—"}</td>
                      <td>{p.type || "—"}</td>
                      <td>{q}</td>
                      <td>{qty(Number(p.length_cm))}</td>
                      <td>{qty(Number(p.width_cm))}</td>
                      <td>{qty(Number(p.height_cm))}</td>
                      <td>{qty(Number(p.actual_kg))}</td>
                      <td>{qty((Number(p.actual_kg) || 0) * q)}</td>
                      <td>{qty(cbm * q, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Totals</td>
                  <td>{pk.pieces}</td>
                  <td colSpan={4} />
                  <td>{qty(pk.kg)}</td>
                  <td>{qty(pk.cbm, 3)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
        <div className="qs-bar">Remarks</div>
        <p className="wms-doc-p">
          {[r.condition_notes, r.notes].filter(Boolean).join("\n") || "Received in apparent good order and condition unless noted above."}
        </p>
        <SignOff left="Delivered By (Driver)" right="Received By (Warehouse)" />
      </LetterSheet>
    );
  } else if (doc === "release") {
    const rel = releasesQ.data?.find((x) => x.id === id);
    if (!rel) return <div className="center-note">Release not found</div>;
    const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
    const t = rel.lines.reduce((s, l) => ({ p: s.p + l.pieces, kg: s.kg + l.gross_kg, cbm: s.cbm + l.volume_cbm }), { p: 0, kg: 0, cbm: 0 });
    body = (
      <LetterSheet title={TITLES.release}>
        <div className="qs-bar">Release Information</div>
        <Grid
          cols={4}
          rows={[
            ["Release No", rel.release_no],
            ["Date Released", formatDateTime(rel.released_at)],
            ["Warehouse", lk.warehouse(rel.warehouse_id)?.name ?? "—"],
            ["Customer", lk.clientName(rel.client_id)],
            ["Shipment Reference", lk.jobRef(rel.job_id)],
            ["Outbound Ref", rel.outbound_ref || "—"],
            ["Collected By", rel.collected_by || "—"],
            ["Vehicle Reg", rel.vehicle_reg || "—"],
            ["Driver ID No", rel.driver_id_no || "—"],
            ["Released By", lk.person(rel.released_by)],
            ["Deliver To", rel.deliver_to || "—"],
          ]}
        />
        <div className="qs-bar">Goods Released</div>
        <table className="qs-pk wms-doc-table">
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Received</th>
              <th>Description</th>
              <th>Marks</th>
              <th>From Bay</th>
              <th>Pieces</th>
              <th>KG</th>
              <th>CBM</th>
            </tr>
          </thead>
          <tbody>
            {rel.lines.map((l) => {
              const r = recById.get(l.receipt_id);
              return (
                <tr key={l.id}>
                  <td>{r?.receipt_no}</td>
                  <td>{formatDate(r?.received_at)}</td>
                  <td>{r?.description || "—"}</td>
                  <td>{r?.marks || "—"}</td>
                  <td>{lk.locName(l.location_id)}</td>
                  <td>{l.pieces}</td>
                  <td>{qty(l.gross_kg)}</td>
                  <td>{qty(l.volume_cbm, 3)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Totals</td>
              <td>{t.p}</td>
              <td>{qty(t.kg)}</td>
              <td>{qty(t.cbm, 3)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="qs-bar">Remarks</div>
        <p className="wms-doc-p">{rel.notes || "Goods received in good order and condition."}</p>
        <SignOff left="Released By (Warehouse)" right="Collected By" />
      </LetterSheet>
    );
  } else if (doc === "billing") {
    const run = runsQ.data?.find((x) => x.id === id);
    if (!run) return <div className="center-note">Billing run not found</div>;
    const c = lk.client(run.client_id);
    body = (
      <LetterSheet title={TITLES.billing}>
        <div className="qs-bar">Statement Information</div>
        <Grid
          cols={4}
          rows={[
            ["Statement No", run.run_no],
            ["Period", `${formatDate(run.period_from)} – ${formatDate(run.period_to)}`],
            ["Warehouse", lk.warehouse(run.warehouse_id)?.name ?? "—"],
            ["Invoice No", run.invoice_no || "—"],
            ["Customer", c?.company ?? "—"],
            ["VAT No", c?.vat_no || "—"],
            ["Address", c?.address || "—"],
            ["Date", formatDate(run.created_at)],
          ]}
        />
        <div className="qs-bar">Charges (ZAR)</div>
        <div className="wms-doc-billing">
          <BillingLinesTable lines={run.lines} totals={run} />
        </div>
        <p className="wms-doc-p" style={{ marginTop: 8 }}>
          Storage is charged per day on hand after the free storage days; handling per chargeable CBM (1 CBM = 1 000 kg). Amount due: {money(run.total)} incl. VAT.
        </p>
      </LetterSheet>
    );
  } else if (doc === "count") {
    const cnt = countsQ.data?.find((x) => x.id === id);
    if (!cnt) return <div className="center-note">Count not found</div>;
    const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
    const lines = [...cnt.lines].sort((a, b) => lk.locName(a.location_id).localeCompare(lk.locName(b.location_id)));
    body = (
      <LetterSheet title={TITLES.count}>
        <div className="qs-bar">Count Information</div>
        <Grid
          cols={4}
          rows={[
            ["Count No", cnt.count_no],
            ["Started", formatDateTime(cnt.created_at)],
            ["Warehouse", lk.warehouse(cnt.warehouse_id)?.name ?? "—"],
            ["Zone / Bay", cnt.location_id ? lk.locName(cnt.location_id) : "Whole warehouse"],
          ]}
        />
        <div className="qs-bar">Count Lines</div>
        <table className="qs-pk wms-doc-table">
          <thead>
            <tr>
              <th>Zone / Bay</th>
              <th>Receipt</th>
              <th>Customer</th>
              <th>Description</th>
              <th>Counted</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const r = recById.get(l.receipt_id);
              return (
                <tr key={l.id}>
                  <td>{lk.locName(l.location_id)}</td>
                  <td>{r?.receipt_no}</td>
                  <td>{lk.clientName(r?.client_id)}</td>
                  <td>{r?.description || "—"}</td>
                  <td style={{ minWidth: 60 }}>{l.counted ?? ""}</td>
                  <td style={{ minWidth: 120 }}>{l.note ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <SignOff left="Counted By" right="Checked By" />
      </LetterSheet>
    );
  } else {
    const c = consolsQ.data?.find((x) => x.id === id);
    if (!c) return <div className="center-note">Consolidation not found</div>;
    if (doc === "mawb") body = <AwbSheet consol={c} />;
    else if (doc === "manifest") body = <ManifestSheet consol={c} />;
    else if (doc === "sea-manifest") body = <SeaManifestSheet consol={c} />;
    else if (doc === "loadplan") body = <LoadPlanSheet consol={c} />;
    else {
      const only = params.get("house");
      // "All" prints only the houses ExPac issues — an origin agent's HAWB / HBL is their document.
      const list = c.houses
        .map((h, i) => ({ h, i }))
        .filter(({ h, i }) => (only == null ? h.issued_by !== "agent" : String(i) === only));
      if (list.length === 0)
        return <div className="center-note">No houses to print — none yet, or every house document was issued by the origin agent</div>;
      body = (
        <>
          {list.map(({ h, i }) => (
            doc === "hbl" ? <HblSheet key={i} consol={c} house={h} index={i} /> : <AwbSheet key={i} consol={c} house={h} index={i} />
          ))}
        </>
      );
    }
  }

  return (
    <div className="qs-wrap">
      {(doc === "manifest" || doc === "sea-manifest") && <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>}
      {(doc === "mawb" || doc === "hawb" || doc === "hbl") && <style>{"@media print { @page { size: A4; margin: 8mm; } }"}</style>}
      {toolbar}
      {body}
    </div>
  );
}

/* ---------- Letterhead documents (Document Vault style) ---------- */

export function LetterSheet({ title, children }: { title: string; children: ReactNode }) {
  const { data: settings } = useCompanySettings();
  const company = settings
    ? {
        logoPrint: COMPANY.logoPrint,
        headerName: settings.legal_name,
        headerLine1: `Reg No: ${settings.reg_no}  ·  Vat No: ${settings.vat_no}  ·  Tel: ${settings.tel}`,
        headerEmail: `Email: ${settings.email}`,
        headerLine2: settings.postal_address,
      }
    : COMPANY;
  return (
    <div className="qs-sheet" data-ready={settings ? "1" : undefined}>
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
            {title.toUpperCase()} - {company.headerName}
          </div>
          <div className="lines">{company.headerLine1}</div>
          <div className="lines">
            {company.headerEmail}&nbsp; &middot; &nbsp;{company.headerLine2}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function Grid({ rows, cols }: { rows: [string, string][]; cols: number }) {
  return (
    <div className="qs-info" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v" style={{ whiteSpace: "pre-line" }}>
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

function SignOff({ left, right }: { left: string; right: string }) {
  return (
    <>
      <div className="qs-bar">Sign-off</div>
      <div className="qs-sig">
        <div className="qs-sig-field">
          <label>{left}</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Signature</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>{right}</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Signature &amp; Date</label>
          <div className="line" />
        </div>
      </div>
    </>
  );
}

/* ---------- Air waybill (MAWB / HAWB) — ExPac's template layout ---------- */

export const TERMS =
  "All business transactions are subject to Company’s Standard Trading Terms and Conditions and copy of which can be provided upon request";

export function AwbSheet({ consol: c, house, index = 0 }: { consol: WmsConsol; house?: WmsConsolHouse; index?: number }) {
  const isHouse = !!house;
  const t = consolTotals(c.houses);
  const pieces = isHouse ? house.pieces : t.pieces;
  const gross = isHouse ? house.gross_kg : t.gross;
  const chargeable = isHouse ? house.chargeable_kg : t.chargeable;
  const shipper = isHouse ? house.shipper : c.shipper;
  const consignee = isHouse ? house.consignee : c.consignee;
  const accounting = isHouse ? house.accounting_info : c.accounting_info;
  const handling = (isHouse ? house.handling_info : null) || c.handling_info;
  const nature = isHouse ? house.nature_of_goods : "CONSOLIDATION AS\nPER ATTACHED MANIFEST";
  const legs = [0, 1, 2].map((i) => c.routing[i] ?? { to: "", by: "" });
  const pp = c.charges_code === "PP";
  const flightDate = c.flight_date ? formatDate(c.flight_date) : "-";

  return (
    <div className="awb-sheet" data-ready="1">
      <div className="awb">
        {isHouse ? (
          <div className="awb-row awb-top4">
            <Box label="Airport of Departure" value={c.origin || "-"} big />
            <Box label="Airport of Destination" value={c.destination || "-"} big />
            <Box label="Master Air Waybill Number" value={c.master_no || "-"} big hl />
            <Box label="Air Waybill Number" value={houseNo(c, house, index)} big hl />
          </div>
        ) : (
          <div className="awb-row awb-mtop">
            <div className="awb-cell big">{c.origin || "-"}</div>
            <div className="awb-cell big">{c.destination || "-"}</div>
            <div className="awb-cell big">{c.flight_no || "-"}</div>
            <div className="awb-cell big center grow">***MASTER AIR WAYBILL***</div>
            <div className="awb-cell big hl right">{c.master_no || "-"}</div>
          </div>
        )}

        <div className="awb-row">
          <div className="awb-half">
            <div className="awb-cell awb-party">
              <div className="awb-partyhead">
                <span className="lbl">Shipper's Name and Address</span>
                <span className="awb-acct">Shipper's Account Number</span>
              </div>
              <div className="val pre">{shipper || ""}</div>
            </div>
            <div className="awb-cell awb-party">
              <div className="awb-partyhead">
                <span className="lbl">Consignee's Name and Address</span>
                <span className="awb-acct">Consignee's Account Number</span>
              </div>
              <div className="val pre">{consignee || ""}</div>
            </div>
          </div>
          <div className="awb-half">
            <div className="awb-cell" style={{ height: "27mm" }}>
              <div className="lbl">Not Negotiable</div>
              <div className="awb-strong">Air Waybill</div>
              <div className="lbl">Issued By</div>
              <div className="awb-carrier">{c.carrier || "CARRIER"}</div>
            </div>
            <div className="awb-cell lbl">Copies 1, 2 and 3 of this Air Waybill are originals and have the same validity.</div>
            <div className="awb-cell lbl awb-conditions">
              It is agreed that the goods described herein are accepted in apparent good order and condition (except as noted) for
              carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. THE SHIPPER'S ATTENTION IS DRAWN TO THE NOTICE
              CONCERNING CARRIERS' LIMITATION OF LIABILITY. Shipper may increase such limitation of liability by declaring a higher
              value for carriage and paying a supplemental charge if required.
            </div>
          </div>
        </div>

        <div className="awb-row">
          <div className="awb-half">
            <div className="awb-cell">
              <div className="lbl">Issuing Carrier's Agent Name and City</div>
              <div className="val">{c.agent_name || ""}</div>
            </div>
            <div className="awb-row">
              <div className="awb-cell grow">
                <div className="lbl">Agents IATA Code</div>
                <div className="val">{c.agent_iata || ""}</div>
              </div>
              <div className="awb-cell grow">
                <div className="lbl">Account No</div>
                <div className="val">{c.agent_account || ""}</div>
              </div>
            </div>
            <div className="awb-cell">
              <div className="lbl">Airport of Departure (Addr. of First Carrier) and Requested Routing</div>
              <div className="val big">{c.origin_name || c.origin || ""}</div>
            </div>
          </div>
          <div className="awb-half">
            <div className="awb-cell" style={{ height: "100%" }}>
              <div className="lbl">Accounting Information</div>
              <div className="val pre strong">{accounting || ""}</div>
            </div>
          </div>
        </div>

        <div className="awb-row">
          <div className="awb-half awb-route">
            <Box label="To" value={legs[0].to || c.destination || ""} big />
            <Box label="By First Carrier" value={legs[0].by || c.carrier || "-"} wide />
            <Box label="To" value={legs[1].to} />
            <Box label="By" value={legs[1].by} />
            <Box label="To" value={legs[2].to} />
            <Box label="By" value={legs[2].by} />
          </div>
          <div className="awb-half awb-route">
            <Box label="Currency" value={c.currency} big />
            <Box label="CHGS Code" value={c.charges_code} />
            <div className="awb-cell awb-ppcc">
              <div className="lbl center">WT/VAL</div>
              <div className="awb-pp">
                <span>PPD<b>{pp ? "PP" : ""}</b></span>
                <span>COLL<b>{pp ? "" : "CC"}</b></span>
              </div>
            </div>
            <div className="awb-cell awb-ppcc">
              <div className="lbl center">Other</div>
              <div className="awb-pp">
                <span>PPD<b>{pp ? "PP" : ""}</b></span>
                <span>COLL<b>{pp ? "" : "CC"}</b></span>
              </div>
            </div>
            <Box label="Declared Value for Carriage" value={c.declared_carriage} big wide />
            <Box label="Declared Value for Customs" value={c.declared_customs} big wide />
          </div>
        </div>

        <div className="awb-row">
          <div className="awb-half awb-route">
            <Box label="Airport of Destination" value={c.destination || ""} big wide />
            <Box label="Flight / ID" value={c.flight_no || "-"} hl wide />
            <Box label="Flight Date" value={flightDate} hl wide />
          </div>
          <div className="awb-half awb-route">
            <Box label="Amount of Insurance" value={c.insurance} big />
            <div className="awb-cell lbl grow2">
              INSURANCE — if carrier offers insurance, and such insurance is requested in accordance with the conditions thereof,
              indicate amount to be insured in figures in box marked "Amount of Insurance".
            </div>
          </div>
        </div>

        <div className="awb-row">
          <div className="awb-cell grow">
            <div className="lbl">Handling Information</div>
            <div className="val">{handling || ""}</div>
            <div className="lbl" style={{ marginTop: 2 }}>
              (For USA only) These commodities licensed by U.S. for ultimate destination ........ Diversion contrary to U.S. law is prohibited
            </div>
          </div>
          <div className="awb-cell awb-sci">
            <div className="lbl">SCI</div>
          </div>
        </div>

        <table className="awb-goods">
          <thead>
            <tr>
              <th>No. of Pieces RCP</th>
              <th>Gross Weight</th>
              <th>kg lb</th>
              <th>Rate Class / Commodity Item No.</th>
              <th>Chargeable Weight</th>
              <th>Rate / Charge</th>
              <th>Total</th>
              <th>Nature and Quantity of Goods (incl. Dimensions or Volume)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{pieces || ""}</td>
              <td>{gross ? Number(gross).toFixed(1) : ""}</td>
              <td>K</td>
              <td>{c.rate_class || ""}</td>
              <td>{chargeable ? Number(chargeable).toFixed(1) : ""}</td>
              <td>{c.rate_charge || ""}</td>
              <td>{c.total_charge}</td>
              <td className="pre">{nature || ""}</td>
            </tr>
          </tbody>
        </table>

        <div className="awb-row">
          <div className="awb-half awb-charges">
            {[
              ["Prepaid", "Weight Charge", "Collect"],
              ["", "Valuation Charge", ""],
              ["", "Tax", ""],
              ["", "Total Other Charges Due Agent", ""],
              ["", "Total Other Charges Due Carrier", ""],
              ["", "", ""],
              ["Total Prepaid", "", "Total Collect"],
              ["Currency Conversion Rates", "", "CC Charges in Dest. Currency"],
              ["For Carrier's Use only at Destination", "Charges at Destination", "Total Collect Charges"],
            ].map((r, i) => (
              <div key={i} className="awb-chg">
                {r.map((x, j) => (
                  <span key={j} className="lbl">
                    {x}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="awb-half">
            <div className="awb-cell" style={{ height: "14mm" }}>
              <div className="lbl">Other Charges</div>
            </div>
            <div className="awb-cell">
              <div className="lbl">
                Shipper certifies that the particulars on the face hereof are correct and that insofar as any part of the consignment
                contains dangerous goods, such part is properly described by name and is in proper condition for carriage by air
                according to the applicable Dangerous Goods Regulations.
              </div>
              <div className="awb-signed">{c.signed_by || ""}</div>
              <div className="lbl center">Signature of Shipper or his Agent</div>
            </div>
            <div className="awb-cell">
              <div className="awb-exec">
                <span>{c.executed_on ? formatDate(c.executed_on) : ""}</span>
                <span>{c.executed_place || ""}</span>
                <span />
              </div>
              <div className="awb-exec lbl">
                <span>Executed on (date)</span>
                <span>at (place)</span>
                <span>Signature of issuing Carrier or its Agent</span>
              </div>
            </div>
            <div className="awb-cell hl right" style={{ minHeight: "8mm" }}>
              <b>{isHouse ? houseNo(c, house, index) : c.master_no || "-"}</b>
            </div>
          </div>
        </div>
        <div className="awb-terms">{TERMS}</div>
      </div>
    </div>
  );
}

function Box({ label, value, big, hl, wide }: { label: string; value: string | null | undefined; big?: boolean; hl?: boolean; wide?: boolean }) {
  return (
    <div className={`awb-cell${hl ? " hl" : ""}${wide ? " grow" : ""}`}>
      <div className="lbl">{label}</div>
      <div className={`val${big ? " big" : ""}`}>{value || ""}</div>
    </div>
  );
}

/* ---------- Air cargo manifest (landscape) ---------- */

export function ManifestSheet({ consol: c }: { consol: WmsConsol }) {
  const t = consolTotals(c.houses);
  return (
    <div className="awb-sheet awb-landscape" data-ready="1">
      <div className="mf-title">EXPAC FORWARDING</div>
      <div className="mf-sub">
        <span>Department of the Treasury</span>
        <b>Air Cargo Manifest</b>
        <span />
      </div>
      <table className="mf">
        {/* fixed layout takes widths from the first row, which is colSpanned */}
        <colgroup>
          {["5%", "14%", "7%", "8%", "24%", "24%", "18%"].map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={3}>
              <div className="lbl">Owner / Operator</div>
              <div className="val">{c.carrier || ""}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Marks of Nationality and Registration</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Flight No.:</div>
              <div className="val hl">{c.flight_no || "-"}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={3}>
              <div className="lbl">Port of Lading</div>
              <div className="val">{c.origin || ""}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Port of Unlading:</div>
              <div className="val">{c.destination || ""}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Flight Date:</div>
              <div className="val hl">{c.flight_date ? formatDate(c.flight_date) : "-"}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={3}>
              <div className="lbl">Item 8 &amp; 9 For Consolidations Only</div>
            </td>
            <td colSpan={4}>
              <div className="lbl">Consolidator:</div>
              <div className="val">{c.signed_by || c.agent_name || ""}</div>
            </td>
          </tr>
          <tr className="mf-head">
            <th>Type<br />(M / H)</th>
            <th>Air Waybill No.</th>
            <th>No. of Pkgs</th>
            <th>Weight (KG)</th>
            <th>Shipper's Name and Address</th>
            <th>Consignee's Name and Address</th>
            <th>Nature of Goods / Export Licence</th>
          </tr>
          <tr className="mf-line">
            <td>
              <b>M</b>
            </td>
            <td className="hl">{c.master_no || "-"}</td>
            <td>{t.pieces}</td>
            <td>{t.gross.toFixed(1)}</td>
            <td className="pre">{c.shipper || ""}</td>
            <td className="pre">{c.consignee || ""}</td>
            <td>CONSOLIDATION</td>
          </tr>
          {c.houses.map((h, i) => (
            <tr key={i} className="mf-line">
              <td>
                <b>H</b>
              </td>
              <td className="hl">{houseNo(c, h, i)}</td>
              <td>{h.pieces}</td>
              <td>{Number(h.gross_kg).toFixed(1)}</td>
              <td className="pre">{h.shipper || ""}</td>
              <td className="pre">{h.consignee || ""}</td>
              <td className="pre">{h.nature_of_goods || ""}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={7} className="awb-terms">
              {TERMS}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
