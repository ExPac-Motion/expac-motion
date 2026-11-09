/**
 * Customs clearance files (0230): stage names, the required-document
 * checklist (same matching as customs_docs_missing in the database) and
 * the times used on the board.
 */
import type { CustomsFile, CustomsStage, ShipmentDocument } from "./types";

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
