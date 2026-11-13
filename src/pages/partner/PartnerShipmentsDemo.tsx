import { useSearchParams } from "react-router-dom";
import type { PartnerKind, PackingItem } from "../../lib/types";
import { isRfqKind } from "../../lib/rfq";
import type { PartnerShipment, PartnerShipmentRow } from "../../lib/partnerShipments";
import PartnerShipments from "./PartnerShipments";
import { PartnerDashboard, PartnerQuotes, PartnerTracking } from "./PartnerHome";
import type { PartnerRfq } from "../../lib/partnerShipments";
import PartnersTab from "../shipments/PartnersTab";
import type { Job } from "../../lib/types";

/**
 * DEV-ONLY preview of Partner Portal › Shipments with made-up data:
 *   /dev/partner-shipments?kind=agent|transporter|destination_agent|clearing_agent
 *   /dev/partner-shipments?view=staff   the shipment workspace Partners tab
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
    tracking: { vessel_lat: null, vessel_lon: null, position_at: null, pol_lat: 31.23, pol_lon: 121.47, pod_lat: -29.87, pod_lon: 31.03, status: "booked" },
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
    vessel_name: "EK 772",
    tracking: { vessel_lat: 5.2, vessel_lon: 58.4, position_at: "2026-11-13T06:10:00Z", pol_lat: 22.31, pol_lon: 113.92, pod_lat: -26.13, pod_lon: 28.24, status: "in_transit" },
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
  if (params.get("view") === "staff") return <StaffDemo />;
  const v = params.get("view") ?? "shipments";
  const tabs = [
    ["dashboard", "Dashboard"],
    ["shipments", "Shipments"],
    ["tracking", "Tracking"],
    ["quotes", "Quotes"],
    ...(kind === "clearing_agent" ? [["customs", "Customs Files"]] : []),
    ["rates", "Rate Sheets"],
  ];
  // The real portal's top bar, so the page header sits where it does live.
  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <span className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </span>
        <nav className="topbar-primary">
          {tabs.map(([k, label]) => (
            <span key={k} className={`topbar-tab${v === k ? " active" : ""}`}>
              {label}
            </span>
          ))}
        </nav>
        <div className="topbar-utils">
          <div className="topbar-account">
            <span className="who">ops@demo-logistics.example</span>
          </div>
        </div>
      </header>
      <main className="main">
        <p className="hint ph-who">
          ExPac Partner Portal · Agent · <b>Demo Logistics Co. Ltd</b>
        </p>
        {v === "dashboard" ? (
          <PartnerDashboard kind={kind} onOpen={() => undefined} onTab={() => undefined} demoRows={ROWS} demoRfqs={RFQS} />
        ) : v === "tracking" ? (
          <PartnerTracking kind={kind} onOpen={() => undefined} demoRows={ROWS} />
        ) : v === "quotes" ? (
          <PartnerQuotes demoRfqs={RFQS} />
        ) : (
          <PartnerShipments kind={kind} demoRows={ROWS} demoShipment={SHIPMENT(kind)} openId={params.get("open")} onOpen={() => undefined} />
        )}
      </main>
    </div>
  );
}

function StaffDemo() {
  const job = {
    id: "demo",
    reference: "SEA126049",
    master_job_id: null,
    job_events: [
      { id: "e1", job_id: "demo", milestone: "Booked", note: "Demo Logistics Co. Ltd: Vessel Name: COSCO Shipping Aries; ETD: 27/11/2026; Status: Booked", created_at: "2026-11-12T10:40:00Z" },
      { id: "e2", job_id: "demo", milestone: "Booked", note: "Demo Logistics Co. Ltd uploaded Commercial Invoice: CI-8841.pdf", created_at: "2026-11-12T11:05:00Z" },
    ],
  } as unknown as Job;
  return (
    <div className="main">
      <PartnersTab
        job={job}
        quote={null}
        demo={{
          partners: [
            { kind: "agent", id: "a", company: "Demo Logistics Co. Ltd", email: "rates@demo-logistics.example", contact: "Li Wei", phone: null, hasLogin: true },
            { kind: "transporter", id: "t", company: "Sample Haulage", email: "ops@sample-haulage.example", contact: null, phone: "+27 31 000 0000", hasLogin: false },
          ],
          messages: [
            { id: "m1", job_id: "demo", partner_kind: "agent", partner_id: "a", direction: "out", body: "Please confirm the vessel and send the MBL draft once booked.", created_at: "2026-11-12T08:10:00Z", read_at: null },
            { id: "m2", job_id: "demo", partner_kind: "agent", partner_id: "a", direction: "in", body: "Booked on COSCO Aries, draft MBL to follow Friday.", created_at: "2026-11-12T10:42:00Z", read_at: null },
          ],
        }}
      />
    </div>
  );
}

const RFQS: PartnerRfq[] = [
  {
    id: "q1",
    token: "demo",
    rfq_number: "RFQ-SEA126101",
    reference: "SEA126101",
    mode: "Sea Freight (LCL)",
    origin: "CNNGB Ningbo, China",
    destination: "ZADUR Durban, South Africa",
    incoterms: "EXW",
    reply_by: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    sent_at: "2026-11-12T08:00:00Z",
    status: "awaiting",
    responded_at: null,
    validity: null,
    transit_time: null,
    remarks: null,
    rates: [],
  },
  {
    id: "q2",
    token: "demo",
    rfq_number: "RFQ-AIR126090",
    reference: "AIR126090",
    mode: "Air Freight (AIR)",
    origin: "HKHKG Hong Kong",
    destination: "ZAJNB Johannesburg",
    incoterms: "FOB",
    reply_by: "2026-11-10",
    sent_at: "2026-11-08T08:00:00Z",
    status: "used",
    responded_at: "2026-11-09T10:00:00Z",
    validity: "30/11/2026",
    transit_time: "3 days via DXB",
    remarks: null,
    rates: [{ code: "AF-01", description: "Air Freight Fee", unit: "KG", cur: "USD", rate: 4.2, min_charge: 85, remarks: null }],
  },
];
