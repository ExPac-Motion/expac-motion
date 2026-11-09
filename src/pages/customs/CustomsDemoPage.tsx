import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import CustomsPage from "./CustomsPage";

/**
 * DEV-ONLY preview of Customs › Clearance Board with made-up files:
 *   /dev/customs
 * Registered only when import.meta.env.DEV. Saving fails here (signed out).
 */
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const AGENTS = [
  { id: "ca1", company: "Swift Clearing (Pty) Ltd", email: "docs@swiftclearing.co.za", contact: "Thabo Mokoena", phone: "+27 11 555 0101" },
  { id: "ca2", company: "Port Side Customs", email: "entries@portside.co.za", contact: "Anita Pillay", phone: "+27 31 555 0202" },
];
const job = (id: string, reference: string, mode: string, status: string, client: string, extra: Record<string, unknown> = {}) => ({
  id,
  reference,
  mode,
  shipment_status: status,
  shipment_kind: "direct",
  master_job_id: null,
  awb_mbl: mode.startsWith("Air") ? "618-59678135" : "MEDU1234567",
  container_no: mode.startsWith("Sea") ? "MSCU7654321" : null,
  vessel_name: mode.startsWith("Sea") ? "MSC Aurora" : null,
  carrier_name: mode.startsWith("Air") ? "Emirates SkyCargo" : null,
  eta: inDays(2),
  etd: inDays(-12),
  origin: mode.startsWith("Air") ? "PVG Shanghai" : "CNNGB Ningbo",
  destination: mode.startsWith("Air") ? "JNB Johannesburg" : "ZADUR Durban",
  po_no: "PO-4471",
  client: { id: `c-${id}`, company: client },
  ...extra,
});
const file = (id: string, j: ReturnType<typeof job>, stage: string, agent: (typeof AGENTS)[number] | null, extra: Record<string, unknown> = {}) => ({
  id,
  job_id: j.id,
  clearing_agent_id: agent?.id ?? null,
  stage,
  required_docs: ["ci", "pl", "tdoc"],
  entry_no: null,
  query_note: null,
  notes: null,
  handover_to: null,
  handed_over_at: null,
  handed_over_by: null,
  lodged_at: null,
  query_at: null,
  cleared_at: null,
  closed_at: null,
  created_at: ago(30),
  updated_at: ago(2),
  job: j,
  agent,
  ...extra,
});
const J1 = job("j1", "AIR260114", "Air Freight (AIR)", "In Transit", "Demo Imports (Pty) Ltd");
const J2 = job("j2", "SEA332911", "Sea Freight (FCL)", "Arrived", "Carbon Hub", { eta: inDays(-1) });
const J3 = job("j3", "SEA330870", "Sea Freight (LCL)", "Customs", "Delta Express SA", { eta: inDays(-3) });
const J4 = job("j4", "AIR260098", "Air Freight (Consol)", "Customs", "VF Exclamation", { eta: inDays(-2) });
const J5 = job("j5", "SEA329004", "Sea Freight (FCL)", "Released", "Jetda Imports", { eta: inDays(-9) });
const FILES = [
  file("f1", J1, "docs_pending", AGENTS[0]),
  file("f2", J2, "ready", AGENTS[1]),
  file("f3", J3, "lodged", AGENTS[1], { handed_over_at: ago(80), lodged_at: ago(40), entry_no: "MRN 26ZA0001234", handover_to: "entries@portside.co.za" }),
  file("f4", J4, "query", AGENTS[0], { handed_over_at: ago(30), query_at: ago(6), query_note: "Commercial invoice value doesn't match the packing list", handover_to: "docs@swiftclearing.co.za" }),
  file("f5", J5, "cleared", AGENTS[0], { handed_over_at: ago(200), lodged_at: ago(170), cleared_at: ago(150), closed_at: ago(140), entry_no: "MRN 26ZA0000988" }),
];
const doc = (id: string, job_id: string, name: string, doc_type: string) => ({
  id, job_id, name, doc_type, storage_path: "x", kind: "upload", visible_to_client: false, size_bytes: 120_000, created_by: null, created_at: ago(20),
});
const DOCS = [
  doc("d1", "j1", "CI-88213.pdf", "Commercial Invoice"),
  doc("d2", "j2", "Invoice INV-2201.pdf", "Commercial Invoice"),
  doc("d3", "j2", "Packing list PL-2201.pdf", "Packing List"),
  doc("d4", "j2", "HBL EXP614220.pdf", "HBL"),
  doc("d5", "j2", "Booking confirmation.pdf", "Other"),
  doc("d6", "j3", "CI.pdf", "Commercial Invoice"),
  doc("d7", "j3", "PL.pdf", "Packing List"),
  doc("d8", "j3", "BL.pdf", "Bill of Lading / AWB"),
];

export default function CustomsDemoPage() {
  const qc = useQueryClient();
  useState(() => {
    const seed = (key: unknown[], data: unknown) => {
      qc.setQueryDefaults(key, { staleTime: Infinity, retry: false, refetchInterval: false });
      qc.setQueryData(key, data);
    };
    seed(["customs", "files"], FILES);
    seed(["clearing_agents"], AGENTS);
    seed(["company_settings"], { id: 1, customs_default_agent_id: "ca1" });
    seed(["profiles"], [{ id: "u1", full_name: "Oliver" }]);
    seed(["shipment_documents", "byJobs", ["j1", "j2", "j3", "j4"]], DOCS);
    for (const f of FILES) {
      seed(["shipment_documents", f.job_id], DOCS.filter((d) => d.job_id === f.job_id));
      seed(["customs", "events", f.id], [
        { id: `e-${f.id}-1`, file_id: f.id, at: f.created_at, by: null, kind: "opened", stage: "docs_pending", note: `Shipment In Transit` },
        ...(f.handed_over_at ? [{ id: `e-${f.id}-2`, file_id: f.id, at: f.handed_over_at, by: "u1", kind: "handover", stage: null, note: `Clearing instruction sent to ${f.agent?.email}` }] : []),
      ]);
    }
    return true;
  });
  return (
    <div className="main">
      <CustomsPage />
    </div>
  );
}
