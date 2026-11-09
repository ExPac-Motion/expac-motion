/**
 * Customs clearance files (0230): stage names, the required-document
 * checklist (same matching as customs_docs_missing in the database) and
 * the times used on the board.
 */
import type { CustomsFile, CustomsStage, ShipmentDocument } from "./types";
import { saveBlob, toCsv } from "./zip";

export const CUSTOMS_STAGES: { key: CustomsStage; label: string; short: string }[] = [
  { key: "docs_pending", label: "Documents pending", short: "Docs pending" },
  { key: "ready", label: "Ready to hand over", short: "Ready" },
  { key: "handed_over", label: "Handed over to agent", short: "With agent" },
  { key: "lodged", label: "Entry lodged", short: "Lodged" },
  { key: "query", label: "Query raised", short: "Query" },
  { key: "cleared", label: "Customs cleared", short: "Cleared" },
];
export const stageLabel = (s: CustomsStage) => CUSTOMS_STAGES.find((x) => x.key === s)?.label ?? s;
export const stageShort = (s: CustomsStage) => CUSTOMS_STAGES.find((x) => x.key === s)?.short ?? s;

/** With the agent: handed over and not cleared yet. */
export const WITH_AGENT: CustomsStage[] = ["handed_over", "lodged", "query"];

const TDOC = ["bill of lading / awb", "hawb", "hbl", "mawb", "mbl", "bill of lading", "awb"];

export function requiredLabel(key: string, mode?: string | null): string {
  if (key === "ci") return "Commercial invoice";
  if (key === "pl") return "Packing list";
  if (key === "tdoc") return mode?.startsWith("Air") ? "Air waybill (AWB)" : mode?.startsWith("Sea") ? "Bill of lading (B/L)" : "B/L or AWB";
  return key;
}
/** The Document Vault type a missing item is uploaded as. */
export function requiredDocType(key: string, mode?: string | null): string {
  if (key === "ci") return "Commercial Invoice";
  if (key === "pl") return "Packing List";
  if (key === "tdoc") return mode?.startsWith("Air") ? "HAWB" : mode?.startsWith("Sea") ? "HBL" : "Bill of Lading / AWB";
  return key;
}
export function docMatches(key: string, doc: Pick<ShipmentDocument, "doc_type">): boolean {
  const t = (doc.doc_type ?? "").trim().toLowerCase();
  if (!t) return false;
  if (key === "ci") return t === "commercial invoice";
  if (key === "pl") return t === "packing list";
  if (key === "tdoc") return TDOC.includes(t);
  return t === key.trim().toLowerCase();
}

export interface ChecklistItem {
  key: string;
  label: string;
  docs: ShipmentDocument[];
}
export function checklist(file: CustomsFile, docs: ShipmentDocument[]): ChecklistItem[] {
  return file.required_docs.map((key) => ({
    key,
    label: requiredLabel(key, file.job?.mode),
    docs: docs.filter((d) => docMatches(key, d)),
  }));
}

const DAY = 86_400_000;
/** Whole days (one decimal under 10) between two times, or to now. */
export function daysBetween(from: string | null, to?: string | null): number | null {
  if (!from) return null;
  const end = to ? new Date(to).getTime() : Date.now();
  const d = (end - new Date(from).getTime()) / DAY;
  return d < 0 ? 0 : d;
}
export function fmtDays(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  return d < 10 ? `${d.toFixed(1)} d` : `${Math.round(d)} d`;
}

/** The carrier's ANF is in but the file hasn't gone to the agent yet (0231). */
export function anfWaiting(f: CustomsFile): boolean {
  return !!f.anf_at && (f.stage === "docs_pending" || f.stage === "ready");
}

/* ---------- Motion AI: data read from the documents (0232) ---------- */

export interface CustomsLine {
  description: string;
  hs_code: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  value: number | null;
  origin: string | null;
  net_kg: number | null;
}
export interface CustomsExtraction {
  invoice_no: string | null;
  invoice_date: string | null;
  supplier: string | null;
  buyer: string | null;
  currency: string | null;
  incoterm: string | null;
  invoice_total: number | null;
  freight: number | null;
  insurance: number | null;
  packages: number | null;
  package_type: string | null;
  gross_kg: number | null;
  net_kg: number | null;
  cbm: number | null;
  country_of_origin: string | null;
  transport_doc_no: string | null;
  vessel_or_flight: string | null;
  container_nos: string[];
  lines: CustomsLine[];
  warnings: string[];
  /** The documents it was read from. */
  sources?: string[];
}

export const EXTRACTION_FIELDS: { key: keyof CustomsExtraction; label: string; num?: boolean }[] = [
  { key: "invoice_no", label: "Invoice no." },
  { key: "invoice_date", label: "Invoice date" },
  { key: "supplier", label: "Supplier / exporter" },
  { key: "buyer", label: "Buyer / importer" },
  { key: "currency", label: "Currency" },
  { key: "incoterm", label: "Incoterm" },
  { key: "invoice_total", label: "Invoice total", num: true },
  { key: "freight", label: "Freight", num: true },
  { key: "insurance", label: "Insurance", num: true },
  { key: "packages", label: "Packages", num: true },
  { key: "package_type", label: "Package type" },
  { key: "gross_kg", label: "Gross kg", num: true },
  { key: "net_kg", label: "Net kg", num: true },
  { key: "cbm", label: "CBM", num: true },
  { key: "country_of_origin", label: "Country of origin" },
  { key: "transport_doc_no", label: "B/L or AWB no." },
  { key: "vessel_or_flight", label: "Vessel / flight" },
];

/** CSV of a customs file's data: the header facts, then one row per line. */
export function extractionCsvRows(ref: string, ext: CustomsExtraction): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [["Shipment", ref]];
  for (const f of EXTRACTION_FIELDS) rows.push([f.label, (ext[f.key] as string | number | null) ?? null]);
  rows.push(["Containers", (ext.container_nos ?? []).join(" ")]);
  rows.push([]);
  rows.push(["Line", "Description", "HS code (suggested)", "Qty", "Unit", "Unit price", "Value", "Origin", "Net kg"]);
  (ext.lines ?? []).forEach((l, i) =>
    rows.push([i + 1, l.description, l.hs_code, l.qty, l.unit, l.unit_price, l.value, l.origin, l.net_kg]),
  );
  return rows;
}

/* ---------- Broker Desk (0232) ---------- */

export interface BrokerDocument {
  id: string;
  name: string;
  doc_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
  from_broker: boolean;
}
export interface BrokerFile {
  id: string;
  stage: CustomsStage;
  entry_no: string | null;
  query_note: string | null;
  handed_over_at: string | null;
  lodged_at: string | null;
  query_at: string | null;
  cleared_at: string | null;
  closed_at: string | null;
  anf_at: string | null;
  extraction: CustomsExtraction | null;
  reference: string;
  mode: string | null;
  shipment_status: string | null;
  awb_mbl: string | null;
  container_no: string | null;
  vessel_name: string | null;
  carrier_name: string | null;
  eta: string | null;
  etd: string | null;
  origin: string | null;
  destination: string | null;
  po_no: string | null;
  importer: {
    company: string | null;
    vat_no: string | null;
    import_code: string | null;
    address: string | null;
    contact: string | null;
    email: string | null;
    phone: string | null;
  };
  documents: BrokerDocument[];
  events: { at: string; kind: string; stage: CustomsStage | null; note: string | null; mine: boolean }[];
}

export interface CustomsAgentStat {
  file_id: string;
  clearing_agent_id: string | null;
  stage: CustomsStage;
  handed_over_at: string;
  lodged_at: string | null;
  cleared_at: string | null;
  closed_at: string | null;
  queries: number;
}

export function downloadExtractionCsv(ref: string, ext: CustomsExtraction) {
  saveBlob(new Blob([toCsv(extractionCsvRows(ref, ext))], { type: "text/csv" }), `${ref} customs data.csv`);
}
