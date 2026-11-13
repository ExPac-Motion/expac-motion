import { useSearchParams } from "react-router-dom";
import type { PartnerKind, PackingItem } from "../../lib/types";
import { isRfqKind } from "../../lib/rfq";
import type { PartnerShipment, PartnerShipmentRow } from "../../lib/partnerShipments";
import PartnerShipments from "./PartnerShipments";

/**
 * DEV-ONLY preview of Partner Portal › Shipments with made-up data:
 *   /dev/partner-shipments?kind=agent|transporter|destination_agent|clearing_agent
 */
const ROWS: PartnerShipmentRow[] = [
  {
    id: "demo",
    reference: "SEA126049",
    shipment_kind: "direct",
    master_reference: null,
    mode: "Sea Freight (LCL)",
    origin: "CNSHA Shanghai, China",
    destination: "ZADUR Durban, South Africa",
    incoterms: "EXW",
    shipment_status: "Booked",
    ready_date: "2026-11-20",
    etd: "2026-11-27",
    eta: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    delivery_date: null,
    awb_mbl: null,
    container_no: null,
    completed: false,
    unread: 1,
    action: "Booking details missing",
  },
  {
    id: "demo2",
    reference: "AIR126101",
    shipment_kind: "direct",
    master_reference: null,
    mode: "Air Freight (AIR)",
    origin: "HKHKG Hong Kong",
    destination: "ZAJNB Johannesburg",
    incoterms: "FOB",
    shipment_status: "Departed",
    ready_date: "2026-11-10",
    etd: "2026-11-12",
    eta: "2026-11-30",
    delivery_date: null,
    awb_mbl: "176-12345675",
    container_no: null,
    completed: false,
    unread: 0,
    action: null,
  },
];

const SHIPMENT = (kind: PartnerKind): PartnerShipment => ({
  ...ROWS[0],
  partner_kind: kind,
  delivery_terms: "Door to Door",
  commodity: "General Cargo",
  container_type: null,
  carrier_name: kind === "transporter" ? undefined : "COSCO",
  vessel_name: kind === "transporter" ? undefined : "COSCO Shipping Aries",
  voyage_no: kind === "transporter" ? undefined : "045W",
  awb_mbl: kind === "transporter" ? undefined : null,
  seal_no: kind === "transporter" ? undefined : null,
  pod_signed_by: null,
  pod_delivered_at: null,
  notes: "Stackable cargo, tail-lift needed on delivery.",
  ...(kind === "agent"
    ? { pickup: { company: "Demo Shipper Co. Ltd", address: "88 Pudong Ave, Shanghai", contact: "Li Wei", phone: "+86 21 0000 0000", email: null } }
    : { delivery: { address: "12 Demo Road, Pinetown, Durban", contact: "Receiving desk", phone: "+27 31 000 0000" } }),
  ...(kind !== "agent" ? { customs_stage: "lodged", customs_released: false, entry_no: kind === "transporter" ? null : "DBN-2026-5501" } : {}),
  packing: [
    { position: 0, length_cm: 120, width_cm: 100, height_cm: 110, actual_kg: 380, qty_pcs: 4, qty_ctns: 4, cbm: null },
    { position: 1, length_cm: 60, width_cm: 40, height_cm: 45, actual_kg: 22, qty_pcs: 30, qty_ctns: 30, cbm: null },
  ] as unknown as PackingItem[],
  charges:
    kind === "agent"
      ? [
          { category: "International Freight Charges", code: "OF-01", description: "Ocean Freight", unit: "W/M", cur: "USD", rate: 38, qty: 8.5 },
          { category: "Ex-Works Charges", code: "OR-01", description: "Pick Up Fee", unit: "Shipment", cur: "USD", rate: 120, qty: 1 },
        ]
      : [{ category: "Destination Handling and Delivery Charges", code: "TR-01", description: "Delivery", unit: "Shipment", cur: "ZAR", rate: 2850, qty: 1 }],
  documents: [
    { id: "d1", name: "Commercial Invoice.pdf", doc_type: "Commercial Invoice", storage_path: "x", size_bytes: 1, created_at: "2026-11-10T09:00:00Z", mine: false },
    { id: "d2", name: "Packing List.pdf", doc_type: "Packing List", storage_path: "y", size_bytes: 1, created_at: "2026-11-10T09:00:00Z", mine: false },
  ],
  timeline: [
    { step: "Created", done: true, planned_date: null, actual_date: "2026-11-08" },
    { step: "Booked", done: true, planned_date: null, actual_date: "2026-11-09" },
    { step: "Collected", done: false, planned_date: null, actual_date: null },
    { step: "Departed", done: false, planned_date: "2026-11-27", actual_date: null },
    { step: "Arrived", done: false, planned_date: "2026-12-20", actual_date: null },
    { step: "Delivered", done: false, planned_date: null, actual_date: null },
  ],
  messages: [
    { id: "m1", direction: "out", body: "Please confirm the vessel and send the MBL draft once booked.", created_at: "2026-11-12T08:10:00Z" },
    { id: "m2", direction: "in", body: "Booked on COSCO Aries, draft MBL to follow Friday.", created_at: "2026-11-12T10:42:00Z" },
  ],
  tracking: null,
  history: [{ at: "2026-11-09T10:00:00Z", status: "Booked" }],
});

export default function PartnerShipmentsDemo() {
  const [params] = useSearchParams();
  const k = params.get("kind");
  const kind: PartnerKind = isRfqKind(k) ? k : "agent";
  return (
    <div className="main">
      <PartnerShipments kind={kind} demoRows={ROWS} demoShipment={SHIPMENT(kind)} />
    </div>
  );
}
