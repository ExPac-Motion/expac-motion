import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QuoteSheet, type CompanyBlock, type QuoteSheetData } from "../QuotePrintPage";
import { groupByCategory, packingTotals, volumetricFactor, type FxRates } from "../../lib/calc";
import { currencyAmount, docName, formatDate } from "../../lib/format";
import { COMPANY } from "../../lib/company";
import type { LineCurrency, PackingItem, QuoteLine } from "../../lib/types";
import { usePortalLetterhead, usePortalLines, usePortalMe, usePortalPacking, usePortalQuotes } from "../../lib/portal";

/**
 * Customer Portal › Quotation document: the very same quotation sheet Motion
 * prints (QuoteSheet, locked layout), built from the customer-safe views
 * (0152). Lines carry ExPac's stored sell only, never buy cost or margin.
 */
export default function PortalQuotePrintPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const quotesQ = usePortalQuotes();
  const linesQ = usePortalLines(id ? [id] : []);
  const packQ = usePortalPacking(id);
  const meQ = usePortalMe();
  const headQ = usePortalLetterhead();
  const q = quotesQ.data?.find((x) => x.id === id);

  useEffect(() => {
    const previous = document.title;
    if (q?.reference) document.title = docName("Quotation", q.reference);
    return () => {
      document.title = previous;
    };
  }, [q?.reference]);

  const vFactor = volumetricFactor(q?.mode);
  const packingRows: PackingItem[] = useMemo(() => (packQ.data ?? []).map((p) => ({ ...p, cbm: p.cbm ?? "" })), [packQ.data]);
  const pack = useMemo(() => packingTotals(packingRows, vFactor), [packingRows, vFactor]);
  const groups = useMemo(() => {
    const lines = (linesQ.data ?? []).map((l) => ({ ...l, code: l.code ?? "", unit: l.unit ?? "", buy: 0, margin: 0 }) as QuoteLine);
    return groupByCategory(lines).filter((g) => g.lines.length > 0);
  }, [linesQ.data]);

  if (quotesQ.isLoading || linesQ.isLoading || packQ.isLoading || meQ.isLoading || headQ.isLoading)
    return <div className="center-note">Loading quotation…</div>;
  if (!q) return <div className="center-note">Quotation not found</div>;

  const sellCur = (q.sell_currency as LineCurrency | null) ?? null;
  const rate = Number(q.sell_fx) || 0;
  const fx: FxRates = {
    usd: sellCur === "USD" ? rate : 0,
    cny: sellCur === "CNY" ? rate : 0,
    eur: sellCur === "EUR" ? rate : 0,
    gbp: sellCur === "GBP" ? rate : 0,
  };
  const s = headQ.data;
  const company: CompanyBlock = s
    ? {
        logoPrint: COMPANY.logoPrint,
        headerName: s.legal_name,
        headerLine1: `Reg No: ${s.reg_no}  ·  Vat No: ${s.vat_no}  ·  Tel: ${s.tel}`,
        headerEmail: `Email: ${s.email}`,
        headerLine2: s.postal_address,
        strapline: s.strapline,
        blurb: s.blurb,
        bank: s.bank_details.split("\n").filter(Boolean),
      }
    : COMPANY;
  const me = meQ.data;

  const data: QuoteSheetData = {
    company,
    customerName: me?.company ?? "CUSTOMER",
    clientRows: [
      ["Contact Person", me?.contact || "—"],
      ["Customer VAT No", me?.vat_no || "TBC"],
      ["Tel Number", me?.phone || "—"],
      ["Email Address", me?.email || "—"],
      ["Address", me?.address || "To Be Confirmed"],
    ],
    shipment: [
      ["Shipper / Exporter", q.supplier_company ?? "—"],
      ["Consignee / Delivery Point", q.consignee_company ?? me?.company ?? "—"],
      ["Reference", q.customer_reference || "—"],
      ["Mode", q.mode],
      ["Commodity", q.commodity || "—"],
      ["Incoterms", q.incoterms || "—"],
      ["Delivery Terms", q.delivery_terms || "—"],
      ["Valid Until", formatDate(q.valid_until)],
      ["Origin / Port of Load", q.origin || "—"],
      ["Destination / Port of Discharge", q.destination || "—"],
      ["Commercial Value", currencyAmount(q.commercial_value, q.value_currency as never)],
      ["Insurance Amount", currencyAmount(q.insurance_amount, q.value_currency as never)],
    ],
    sellCurrency: sellCur,
    fx,
    reference: q.reference,
    mode: q.mode,
    createdAt: q.created_at,
    validUntil: q.valid_until,
    origin: q.origin,
    destination: q.destination,
    packingRows,
    vFactor,
    pack,
    groups,
  };

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
      <QuoteSheet data={data} />
    </div>
  );
}
