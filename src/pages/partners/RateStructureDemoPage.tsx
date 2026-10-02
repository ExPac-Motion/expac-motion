// DEV-only preview (/dev/rate-structure): the partner coverage + rate
// structure sheet/editor rendered with sample data, no login or DB needed.
import { useState } from "react";
import type { PartnerRateStructure, RateBlock } from "../../lib/types";
import { CoverageEditor, CoverageView, type Coverage } from "./PartnerCoverage";
import {
  emptyStructure,
  RATE_TABS,
  RateStructureEditor,
  RateStructureSheet,
} from "./RateStructures";
import type { PartnerRateStructureDraft } from "../../lib/types";

const charges = [
  ["Export Clearance Fee Per Shipment", 47.5, "Per AWB"],
  ["Documentation Fee Per Shipment", 30, "Per AWB"],
  ["THC Fee", 29, "0.13 USD/KG, or 29.00 USD/AWB (Min)"],
  ["Airline Handling Fee Per Shipment", 16.5, "Per AWB"],
  ["Export Company (if applicable for Supplier to Export)", 33, "Per AWB"],
].map(([description, amount, basis]) => ({
  description: String(description),
  amount: Number(amount),
  basis: String(basis),
}));
const pickup = [
  { label: "1-299KG", amount: 45 },
  { label: "300-499KG", amount: 62 },
  { label: "500-1000KG", amount: 78 },
];
const labels = ["0-45KG (Consol Run)", "0-100KG", "0-300KG", "0-500KG", "0-1000KG"];
const block = (
  id: string,
  commodity: string,
  rates: number[],
  carrier: string,
  depart: string,
  routing: string,
  transit: string,
): RateBlock => ({
  id,
  commodity,
  carrier,
  depart_from: depart,
  routing,
  transit,
  terms: "EXW",
  notes: "",
  breaks: labels.map((label, i) => ({ label, rate: rates[i] })),
  charges,
  pickup,
});

const SAMPLE: PartnerRateStructure = {
  id: "demo",
  partner_kind: "agent",
  partner_id: "demo",
  title: "China & Hong Kong → JNB Air Freight",
  mode: "Air Freight (AIR)",
  origin: "China (SZX, CAN, PEK, PVG) / Hong Kong",
  destination: "JNB / DUR / CPT",
  currency: "USD",
  valid_from: "2026-10-01",
  valid_until: null,
  notes: "Air Freight Rates are subject to the USD/ZAR exchange rate.",
  created_at: "",
  updated_at: "",
  blocks: [
    block("a", "General Cargo Export and Fly Via Shenzhen Direct (SZX)", [7.315, 7.315, 7.249, 6.732, 6.589], "TK", "SZX", "SZX-IST-JNB/DUR/CPT", "3-5 days from pickup"),
    block("b", "General Cargo Export and Fly Via Guangzhou, Beijing (CAN, PEK)", [6.875, 6.875, 6.589, 6.435, 6.391], "SQ", "CAN", "CAN-SIN-JNB", "4-6 days from pickup"),
    block("c", "(DG) Pure Battery Export and Fly Via Hong Kong (HKG)", [14.85, 14.85, 11.66, 10.835, 10.285], "ET (Cargo)", "HKG", "HKG-ADD-JNB", "7-10 days from pickup"),
  ],
};

export default function RateStructureDemoPage() {
  const [editing, setEditing] = useState(false);
  const [fresh, setFresh] = useState<PartnerRateStructureDraft | null>(null);
  const [cov, setCov] = useState<Coverage>({
    modes: ["Air Freight (AIR)"],
    countries: ["China"],
    ports: ["CNCAN"],
    coverage_notes: "",
  });
  return (
    <div style={{ padding: 24, background: "var(--paper)", minHeight: "100vh" }}>
      <div className="panel" style={{ maxWidth: 1100 }}>
        <CoverageEditor value={cov} onChange={setCov} />
      </div>
      <div className="panel">
        <CoverageView
          value={{
            modes: ["Air Freight (AIR)", "Sea Freight (LCL)", "Customs Clearing"],
            countries: ["China", "Hong Kong"],
            ports: ["CNSZX", "CNCAN", "CNPVG", "CNPEK", "HKHKG"],
            coverage_notes: "Consol runs weekly; DG / battery cargo via HKG.",
          }}
        />
        <div className="rs-wrap">
          <RateStructureSheet
            s={SAMPLE}
            onEdit={() => setEditing(true)}
            onDuplicate={() => undefined}
            onDelete={() => undefined}
          />
        </div>
      </div>
      <div className="panel" style={{ display: "flex", gap: 8 }}>
        {RATE_TABS.map((t) => (
          <button
            key={t.mode}
            type="button"
            className="btn outline btn-sm"
            onClick={() => setFresh(emptyStructure("agent", "demo", t.mode))}
          >
            New {t.label}
          </button>
        ))}
      </div>
      {fresh && (
        <RateStructureEditor
          initial={fresh}
          saving={false}
          onClose={() => setFresh(null)}
          onSave={() => setFresh(null)}
        />
      )}
      {editing && (
        <RateStructureEditor
          initial={SAMPLE}
          saving={false}
          onClose={() => setEditing(false)}
          onSave={() => setEditing(false)}
        />
      )}
    </div>
  );
}
