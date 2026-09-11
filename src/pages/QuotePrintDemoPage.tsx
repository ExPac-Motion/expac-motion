import { useSearchParams } from "react-router-dom";
import { packingTotals, volumetricFactor } from "../lib/calc";
import type { CategoryGroup, PackingTotals } from "../lib/calc";
import type { LineCurrency, PackingItem, QuoteLine } from "../lib/types";
import { COMPANY } from "../lib/company";
import { QuoteSheet, type QuoteSheetData } from "./QuotePrintPage";

/**
 * DEV-ONLY preview of the paginated quotation with fabricated data, so the
 * multi-page layout can be checked without a login / real quote.
 *   /quotes/demo/print            ~ 2 pages
 *   /quotes/demo/print?lines=40   ~ 3+ pages
 *   /quotes/demo/print?lines=3    single page
 *   /quotes/demo/print?sell=EUR   Sell Currency conversion preview
 * Route is only registered when import.meta.env.DEV — it can't reach prod.
 */

function makeLine(i: number, category: QuoteLine["category"]): QuoteLine {
  const sell = 250 + ((i * 137) % 900);
  return {
    position: i,
    category,
    code: `XX-${String((i % 40) + 1).padStart(2, "0")}`,
    description:
      i % 5 === 0
        ? `Line ${i} — a deliberately long service description to exercise wrapping and row height on the page`
        : `Service line ${i}`,
    cur: "ZAR",
    unit: i % 2 ? "B/L" : "CBM",
    qty: (1 + (i % 3)).toString(),
    buy: "0",
    margin: "0",
    vat_pct: i % 7 === 0 ? "15" : "0",
    sell: sell.toString(),
  };
}

export default function QuotePrintDemoPage() {
  const [params] = useSearchParams();
  const n = Math.max(1, Math.min(120, Number(params.get("lines")) || 16));

  const cats: QuoteLine["category"][] = [
    "International Freight Charges",
    "Ex-Works Charges",
    "Destination Handling and Delivery Charges",
    "Customs Clearance, VAT and Duty Charges",
  ];
  const groups: CategoryGroup[] = cats.map((category, ci) => {
    const per = Math.ceil(n / cats.length);
    const lines = Array.from({ length: per }, (_, k) => ({
      line: makeLine(ci * per + k + 1, category),
      index: ci * per + k,
    }));
    return { category, lines, subtotal: 0, vat: 0, subtotalIncl: 0 };
  });

  const packingRows: PackingItem[] = Array.from(
    { length: Number(params.get("pack")) || 6 },
    (_, i) => ({
      position: i,
      length_cm: 120,
      width_cm: 80 + i,
      height_cm: 90,
      actual_kg: 300 + i * 25,
      qty_ctns: 1 + (i % 3),
    }),
  );
  const vFactor = volumetricFactor("Sea Freight (LCL)");
  const pack: PackingTotals = packingTotals(packingRows, vFactor);
  const sellCurrency = (params.get("sell") as LineCurrency | null) || null;

  const data: QuoteSheetData = {
    company: COMPANY,
    customerName: "DEMO CUSTOMER (PTY) LTD",
    clientRows: [
      ["Contact Person", "Jane Demo"],
      ["Customer VAT No", "4123456789"],
      ["Tel Number", "+27 11 555 0000"],
      ["Email Address", "jane@democustomer.co.za"],
      ["Address", "1 Sample Road, Testville, South Africa"],
    ],
    shipment: [
      ["Shipper / Exporter", "Overseas Supplier Co."],
      ["Consignee / Delivery Point", "Demo Customer (Pty) Ltd"],
      ["Reference", "SEA999001"],
      ["Mode", "Sea Freight (LCL)"],
      ["Commodity", "General Cargo"],
      ["Incoterms", "FCA"],
      ["Delivery Terms", "Warehouse to Door"],
      ["Valid Until", "2026-09-30"],
      ["Origin / Port of Load", "CNSHA — Shanghai, China"],
      ["Destination / Port of Discharge", "ZADUR — Durban, South Africa"],
      ["Commercial Value", "25 000.00"],
      ["Insurance Amount", "27 500.00"],
    ],
    reference: "SEA999001",
    mode: "Sea Freight (LCL)",
    createdAt: "2026-09-09",
    validUntil: "2026-09-30",
    origin: "CNSHA — Shanghai, China",
    destination: "ZADUR — Durban, South Africa",
    packingRows,
    vFactor,
    pack,
    groups,
    sellCurrency,
    fx: { usd: 18.5, cny: 2.55, eur: 20.1 },
  };

  return (
    <div className="qs-wrap">
      <div className="qs-toolbar">
        <button
          className="btn outline"
          onClick={() => window.history.back()}
        >
          ← Back
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className="qs-note">
        DEV demo — fabricated quote for checking multi-page layout. Add
        <code> ?lines=40 </code> or <code> ?pack=12 </code> to the URL.
      </div>
      <QuoteSheet data={data} />
    </div>
  );
}
