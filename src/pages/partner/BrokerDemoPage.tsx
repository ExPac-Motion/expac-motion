import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import BrokerDesk from "./BrokerDesk";

/** DEV-ONLY preview of the clearing agent's Broker Desk: /dev/broker */
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const EXT = {
  invoice_no: "INV-2201", invoice_date: "2026-10-20", supplier: "Ningbo Pumps Co.", buyer: "Carbon Hub (Pty) Ltd", currency: "USD",
  incoterm: "FOB Ningbo", invoice_total: 12500, freight: null, insurance: null, packages: 4, package_type: "pallets", gross_kg: 640,
  net_kg: 600, cbm: 2.1, country_of_origin: "China", transport_doc_no: "MEDU1234567", vessel_or_flight: "MSC Aurora",
  container_nos: ["MSCU7654321"],
  lines: [
    { description: "Centrifugal pumps 2HP", hs_code: "8413.70.10", qty: 12, unit: "pcs", unit_price: 625, value: 7500, origin: "China", net_kg: 360 },
    { description: "Pump spare impellers", hs_code: "8413.91.00", qty: 100, unit: "pcs", unit_price: 50, value: 5000, origin: "China", net_kg: 240 },
  ],
  warnings: ["Packing list gross 640 kg vs B/L 655 kg"],
  sources: ["CI-2201.pdf", "PL-2201.pdf", "HBL EXP614220.pdf"],
};
const FILES = [
  {
    id: "b1", stage: "handed_over", entry_no: null, query_note: null, handed_over_at: ago(20), lodged_at: null, query_at: null, cleared_at: null,
    closed_at: null, anf_at: ago(26), extraction: EXT, reference: "SEA332911", mode: "Sea Freight (FCL)", shipment_status: "Arrived",
    awb_mbl: "MEDU1234567", container_no: "MSCU7654321", vessel_name: "MSC Aurora", carrier_name: null, eta: "2026-11-08", etd: "2026-10-22",
    origin: "CNNGB Ningbo", destination: "ZADUR Durban", po_no: "PO-4471",
    importer: { company: "Carbon Hub (Pty) Ltd", vat_no: "4123456789", import_code: "21234567", address: "12 Industry Rd, Germiston", contact: "Hasan", email: "info@carbonhub.co.za", phone: "+27 11 555 0303" },
    documents: [
      { id: "d1", name: "CI-2201.pdf", doc_type: "Commercial Invoice", storage_path: "x", size_bytes: 1, created_at: ago(30), from_broker: false },
      { id: "d2", name: "PL-2201.pdf", doc_type: "Packing List", storage_path: "x", size_bytes: 1, created_at: ago(30), from_broker: false },
      { id: "d3", name: "HBL EXP614220.pdf", doc_type: "HBL", storage_path: "x", size_bytes: 1, created_at: ago(30), from_broker: false },
    ],
    events: [{ at: ago(20), kind: "handover", stage: null, note: "Clearing instruction sent to docs@swiftclearing.co.za", mine: false }],
  },
  {
    id: "b2", stage: "query", entry_no: "MRN 26ZA0001234", query_note: "Need the certificate of origin", handed_over_at: ago(70), lodged_at: ago(50), query_at: ago(5), cleared_at: null,
    closed_at: null, anf_at: null, extraction: null, reference: "AIR260098", mode: "Air Freight (Consol)", shipment_status: "Customs",
    awb_mbl: "618-59678135", container_no: null, vessel_name: null, carrier_name: "Emirates SkyCargo", eta: "2026-11-07", etd: "2026-11-04",
    origin: "PVG Shanghai", destination: "JNB Johannesburg", po_no: null,
    importer: { company: "VF Exclamation", vat_no: null, import_code: "20998877", address: null, contact: null, email: null, phone: null },
    documents: [], events: [],
  },
];
export default function BrokerDemoPage() {
  const qc = useQueryClient();
  useState(() => {
    qc.setQueryDefaults(["broker_files"], { staleTime: Infinity, retry: false });
    qc.setQueryData(["broker_files"], FILES);
    return true;
  });
  return (
    <div className="main">
      <h1 style={{ marginTop: 0 }}>Swift Clearing (demo)</h1>
      <BrokerDesk />
    </div>
  );
}
