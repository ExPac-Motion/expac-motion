import { useState, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * DEV-ONLY sample data for the Motion presentation screenshots. Start the
 * dev server with VITE_DECK_DEMO=1 and /portal/* renders the real Customer
 * Portal for a fictional customer (Karoo Trading), no login and no Supabase
 * reads. Never active in a production build (guarded by import.meta.env.DEV).
 *
 * Data is answered per query key as each query is created, so screens that
 * ask for parameterised keys (["portal", "lines", ids], per-shipment
 * documents …) are filled without predicting every key up front.
 */
export const DECK_DEMO = import.meta.env.DEV && import.meta.env.VITE_DECK_DEMO === "1";

const CLIENT = "00000000-0000-4000-8000-0000000000d1";
const DAY = 86_400_000;
const at = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (days: number) => at(days).slice(0, 10);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const PROFILE = {
  id: "u-deck",
  full_name: "Sarah Botha",
  greeting: "Sarah",
  role: "client",
  client_id: CLIENT,
  portal_status: "approved",
  portal_permissions: { shipments: true, quotes: true, invoices: true, suppliers: true, rates: true, messaging: true, warehouse: true },
};

const ME = {
  id: CLIENT,
  company: "Karoo Trading (Pty) Ltd",
  contact: "Sarah Botha",
  email: "sarah@karootrading.co.za",
  phone: "+27 11 555 0182",
  address: "14 Kruger Street, Kempton Park, 1619",
  account_manager: "Oliver",
  registration_no: "2015/123456/07",
  vat_no: "4710291834",
  import_code: "21456789",
};

type J = Record<string, unknown>;
function job(
  id: string,
  reference: string,
  mode: string,
  status: string,
  milestone: string,
  origin: string,
  destination: string,
  supplier: string,
  etd: number,
  eta: number,
  extra: J = {},
): J {
  return {
    id,
    reference,
    client_id: CLIENT,
    quote_id: `q-${id}`,
    po_no: `PO-${4400 + Number(reference.slice(-3))}`,
    mode,
    milestone,
    shipment_status: status,
    awb_mbl: null,
    container_no: null,
    shipping_line: null,
    vessel_name: null,
    carrier_name: null,
    provisional_delivery_date: day(eta + 3),
    etd: day(etd),
    eta: day(eta),
    origin,
    destination,
    supplier_company: supplier,
    created_at: at(etd - 9),
    ...extra,
  };
}

const JOBS: J[] = [
  job("j1", "SEA614220", "Sea Freight (LCL)", "In Transit", "In Transit", "CNNGB, Ningbo, China", "ZADUR, Durban, South Africa", "Ningbo Ocean Tools Co. Ltd", -18, 3, { awb_mbl: "MEDUNB4471203", container_no: "MSCU7741203", shipping_line: "MSC", vessel_name: "MSC AMELIA", carrier_name: null }),
  job("j2", "AIR612408", "Air Freight (AIR)", "In Transit", "In Transit", "CNSZX, Shenzhen, China", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Shenzhen Bright Lighting Co.", -2, 1, { awb_mbl: "176-48820193", carrier_name: "Emirates SkyCargo" }),
  job("j3", "SEA613871", "Sea Freight (FCL)", "Customs", "Customs", "CNSHA, Shanghai, China", "ZADUR, Durban, South Africa", "Shanghai Pacific Furniture Ltd", -31, -2, { awb_mbl: "COSU6182044710", container_no: "CSNU6620118", shipping_line: "COSCO", vessel_name: "COSCO DURBAN" }),
  job("j4", "AIR614955", "Air Freight (AIR)", "Booked", "Booked", "CNCAN, Guangzhou, China", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Guangzhou Sunrise Textiles", 2, 4, { awb_mbl: "157-30091822", carrier_name: "Qatar Airways Cargo" }),
  job("j5", "CX615102", "Courier Express (CX)", "On-Delivery", "On Delivery", "DEFRA, Frankfurt, Germany", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Bosch Industrial Parts GmbH", -3, 0, { awb_mbl: "DHL 4410298373" }),
  job("j6", "SEA615340", "Sea Freight (LCL)", "Booked", "Booked", "CNTAO, Qingdao, China", "ZACPT, Cape Town, South Africa", "Qingdao Harvest Machinery", 4, 32, { shipping_line: "Maersk" }),
  job("j7", "RDX615511", "Road Freight (RDX)", "In Transit", "In Transit", "ZADUR, Durban, South Africa", "ZAJNB, Johannesburg, South Africa", "Karoo Trading DC Durban", -1, 2),
  job("j8", "AIR615880", "Air Freight (AIR)", "Created", "Created", "INBOM, Mumbai, India", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Mumbai Spice Exports", 5, 6),
  job("j9", "SEA610233", "Sea Freight (LCL)", "Delivered", "Delivered", "CNNGB, Ningbo, China", "ZADUR, Durban, South Africa", "Ningbo Ocean Tools Co. Ltd", -60, -26, { pod_signed_by: "T. Nkosi", pod_delivered_at: at(-22, 11) }),
  job("j10", "AIR609875", "Air Freight (AIR)", "Delivered", "Delivered", "CNSZX, Shenzhen, China", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Shenzhen Bright Lighting Co.", -40, -37, { pod_signed_by: "S. Botha", pod_delivered_at: at(-35, 14) }),
  // A year of delivered history, for Reports.
  ...Array.from({ length: 24 }, (_, i) => {
    const modes = [
      ["Sea Freight (LCL)", "SEA", "CNNGB, Ningbo, China", "ZADUR, Durban, South Africa", "Ningbo Ocean Tools Co. Ltd", 26],
      ["Air Freight (AIR)", "AIR", "CNSZX, Shenzhen, China", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Shenzhen Bright Lighting Co.", 3],
      ["Sea Freight (FCL)", "SEA", "CNSHA, Shanghai, China", "ZADUR, Durban, South Africa", "Shanghai Pacific Furniture Ltd", 30],
      ["Road Freight (RDX)", "RDX", "ZADUR, Durban, South Africa", "ZAJNB, Johannesburg, South Africa", "Karoo Trading DC Durban", 2],
      ["Courier Express (CX)", "CX", "DEFRA, Frankfurt, Germany", "ZAJNB, Johannesburg (OR Tambo), South Africa", "Bosch Industrial Parts GmbH", 4],
    ] as const;
    const [mode, pre, o, d, s, transit] = modes[(i * 3) % modes.length];
    const etd = -335 + i * 13;
    return job(`h${i}`, `${pre}${String(596100 + i * 517).slice(0, 6)}`, mode, "Delivered", "Delivered", o, d, s, etd, etd + transit, { pod_signed_by: "T. Nkosi", pod_delivered_at: at(etd + transit + 2, 11) });
  }),
];

const TRACKING = [
  {
    job_id: "j1", status: "In Transit", carrier: "MSC", pol: "CNNGB", pod: "ZADUR", etd: day(-18), eta: day(3), pod_eta: at(3, 6), pod_ata: null,
    last_event: "Vessel departed Port Louis (transhipment)", vessel_name: "MSC AMELIA", voyage: "FA541A",
    pol_lat: 29.87, pol_lon: 121.55, pod_lat: -29.87, pod_lon: 31.03, vessel_lat: -25.6, vessel_lon: 44.1,
    position_at: ago(95), synced_at: ago(20),
  },
  {
    job_id: "j3", status: "Discharged", carrier: "COSCO", pol: "CNSHA", pod: "ZADUR", etd: day(-31), eta: day(-2), pod_eta: at(-2, 7), pod_ata: at(-2, 9),
    last_event: "Container discharged at Durban Container Terminal", vessel_name: "COSCO DURBAN", voyage: "072W",
    pol_lat: 31.23, pol_lon: 121.47, pod_lat: -29.87, pod_lon: 31.03, vessel_lat: -29.87, vessel_lon: 31.03,
    position_at: ago(60 * 30), synced_at: ago(25),
  },
];

const TRACK_EVENTS = [
  ["GTIN", "Gate in, full container at origin terminal", "Ningbo Meishan Terminal, China", "CNNGB", -20],
  ["LOAD", "Loaded on vessel MSC AMELIA", "Ningbo, China", "CNNGB", -18],
  ["DEPA", "Vessel departed Ningbo", "Ningbo, China", "CNNGB", -18],
  ["ARRV", "Vessel arrived at transhipment port", "Port Louis, Mauritius", "MUPLU", -4],
  ["DEPA", "Vessel departed transhipment port", "Port Louis, Mauritius", "MUPLU", -2],
].map(([event_code, description, location, locode, d], i) => ({
  id: `te${i}`, job_id: "j1", event_code, description, location, locode,
  lat: null, lon: null, vessel_name: "MSC AMELIA", voyage: "FA541A", occurred_at: at(d as number, 8 + i), is_actual: true,
}));

const STATUS_HISTORY = [
  ["Booked", -24], ["Collected", -22], ["Received", -21], ["Loaded", -18], ["Departed", -18], ["In Transit", -17],
].map(([status, d]) => ({ status, changed_at: at(d as number, 10) }));

const JOB_EVENTS = [
  { id: "e1", job_id: "j1", milestone: "Booked", created_at: at(-24, 10) },
  { id: "e2", job_id: "j1", milestone: "In Transit", created_at: at(-17, 10) },
];

const DOCS = [
  { id: "d1", job_id: "j1", name: "Commercial Invoice CI-88213.pdf", storage_path: "x", kind: "commercial_invoice", doc_type: "Commercial Invoice", size_bytes: 182_000, created_at: at(-23), from_client: true },
  { id: "d2", job_id: "j1", name: "Packing List PL-88213.pdf", storage_path: "x", kind: "packing_list", doc_type: "Packing List", size_bytes: 96_000, created_at: at(-23), from_client: true },
  { id: "d3", job_id: "j1", name: "House Bill of Lading EXP614220.pdf", storage_path: "x", kind: "bill_of_lading", doc_type: "Bill of Lading", size_bytes: 140_000, created_at: at(-17) },
  { id: "d4", job_id: "j1", name: "Booking Confirmation.pdf", storage_path: "x", kind: "other", doc_type: "Booking Confirmation", size_bytes: 88_000, created_at: at(-24) },
];

const MESSAGES = [
  { id: "m1", job_id: "j1", direction: "out", to_emails: ["sarah@karootrading.co.za"], cc_emails: [], subject: "Update for Shipment: SEA614220", body: "Good day, Sarah\n\nYour cargo has been loaded on MSC AMELIA and departed Ningbo. ETA Durban in 3 days, we'll book customs clearance ahead of arrival.\n\nKind Regards\nOliver | Support | ExPac Forwarding", status: "sent", created_at: at(-17, 11) },
  { id: "m2", job_id: "j1", direction: "in", to_emails: [], cc_emails: [], subject: "Re: Update for Shipment: SEA614220", body: "Thanks Oliver, please deliver to our Kempton Park DC, not the Durban branch.", status: "received", created_at: at(-16, 8) },
  { id: "m3", job_id: "j1", direction: "out", to_emails: ["sarah@karootrading.co.za"], cc_emails: [], subject: "Re: Shipment SEA614220", body: "Noted Sarah, delivery address updated to Kempton Park DC.\n\nKind Regards\nOliver | Support | ExPac Forwarding", status: "sent", created_at: at(-16, 9) },
];

const HOUSES = [
  { id: "h1", job_id: "j1", position: 1, house_no: "SEA614220-1", supplier_company: "Ningbo Ocean Tools Co. Ltd", pieces: 6, gross_kg: 820, volume_cbm: 2.4, commodity: "Hand tools", commercial_value: 14_800, value_currency: "USD", carrier_house_no: "NGB2410981" },
  { id: "h2", job_id: "j1", position: 2, house_no: "SEA614220-2", supplier_company: "Yiwu Homeware Trading", pieces: 3, gross_kg: 310, volume_cbm: 1.1, commodity: "Kitchenware", commercial_value: 6_200, value_currency: "USD", carrier_house_no: null },
];

type Q = Record<string, unknown>;
function quote(id: string, reference: string, mode: string, status: string, origin: string, destination: string, createdDays: number, extra: Q = {}): Q {
  return {
    id, reference, client_id: CLIENT, mode, commodity: "General Cargo", origin, destination,
    delivery_terms: "Door to Door", valid_until: day(createdDays + 30), status,
    commercial_value: 18_000, insurance_amount: 0, vessel_name: null, mbl_no: null, hbl_no: null, container_no: null,
    etd: null, eta: null, incoterms: "FOB", mawb_no: null, hawb_no: null, flight_no: null, flight_date: null, carrier_name: null,
    created_at: at(createdDays, 10), supplier_company: null, value_currency: "USD", consignee_company: "Karoo Trading (Pty) Ltd",
    sell_currency: "ZAR", revision_no: 1, accepted_at: status === "accepted" || status === "completed" ? at(createdDays + 2, 12) : null,
    ...extra,
  };
}

const QUOTES: Q[] = [
  quote("q-new1", "SEA616004", "Sea Freight (LCL)", "sent", "CNNGB, Ningbo, China", "ZAJNB, Johannesburg, South Africa", -1, { customer_reference: "PO-5530", supplier_company: "Ningbo Ocean Tools Co. Ltd" }),
  quote("q-new2", "AIR616118", "Air Freight (AIR)", "sent", "CNSZX, Shenzhen, China", "ZAJNB, Johannesburg (OR Tambo), South Africa", 0, { customer_reference: "PO-5534", supplier_company: "Shenzhen Bright Lighting Co." }),
  quote("q-req", "SEA616230", "Sea Freight (FCL)", "open", "CNSHA, Shanghai, China", "ZADUR, Durban, South Africa", 0, { portal_requested_at: ago(90), request_ready_date: day(9), request_notes: "1x40HC furniture, ready next week" }),
  ...JOBS.map((j) =>
    quote(`q-${j.id}`, j.reference as string, j.mode as string, j.shipment_status === "Delivered" ? "completed" : "accepted", j.origin as string, j.destination as string, Math.round((Date.parse(j.created_at as string) - Date.now()) / DAY) - 3, { customer_reference: j.po_no, supplier_company: j.supplier_company }),
  ),
  quote("q-lost", "AIR608870", "Air Freight (AIR)", "lost", "CNPVG, Shanghai, China", "ZACPT, Cape Town, South Africa", -70),
];

function linesFor(q: Q) {
  const air = String(q.mode).startsWith("Air") || String(q.mode).startsWith("Courier");
  const base = 9_000 + (Number(String(q.reference).slice(-3)) % 7) * 2_350;
  const l = (n: number, category: string, code: string, description: string, unit: string, sell: number, vat = 15) => ({
    id: `${q.id}-l${n}`, quote_id: q.id, position: n, category, code, description, unit, qty: 1, cur: "ZAR", vat_pct: vat, sell,
  });
  return [
    l(0, "International Freight Charges", air ? "AF-01" : "OF-06", air ? "Air Freight (General Cargo)" : "Ocean Freight (LCL)", air ? "KG" : "W/M", base, 0),
    l(1, "Origin Charges", "OC-02", "Origin Handling & Documentation", "Shipment", 2_150, 0),
    l(2, "Customs Clearance", "CC-01", "Customs Clearance & Declaration", "Entry", 1_450),
    l(3, "Destination Handling and Delivery Charges", "TR-01", "Delivery to Kempton Park DC", "Trip", 2_800),
  ];
}
const LINES = QUOTES.flatMap(linesFor);

const PACKING = [{ position: 0, length_cm: 120, width_cm: 100, height_cm: 110, actual_kg: 420, qty_ctns: 3, cbm: null }];

function inv(n: number, job: string | null, dateOffset: number, total: number, due: number, ref?: string) {
  return {
    sage_id: 9100 + n, sage_customer_id: 701, client_id: CLIENT, job_id: job,
    document_number: `INV${String(5200 + n).padStart(6, "0")}`,
    reference: ref ?? (JOBS.find((j) => j.id === job)?.reference as string) ?? null,
    invoice_date: day(dateOffset), due_date: day(dateOffset + 30),
    exclusive: Math.round((total / 1.15) * 100) / 100, tax: Math.round((total - total / 1.15) * 100) / 100,
    total, amount_due: due, paid: due <= 0, status: due <= 0 ? "Paid" : "Unpaid", synced_at: ago(12),
  };
}
const INVOICES = [
  inv(14, "j2", -2, 21_480.5, 21_480.5),
  inv(13, "j5", -4, 6_315.0, 6_315.0),
  inv(12, "j3", -9, 98_420.0, 98_420.0),
  inv(11, "j1", -47, 31_880.0, 15_000.0),
  inv(10, "j9", -42, 28_765.25, 0),
  inv(9, "j10", -48, 17_210.0, 0),
  inv(8, null, -55, 4_150.0, 4_150.0, "Storage Aug"),
  inv(7, null, -88, 26_330.0, 0, "SEA608120"),
  inv(6, null, -120, 15_102.4, 0, "AIR607750"),
];

const RATES = [
  ["Air Freight (AIR)", "CNSZX", "ZAJNB", "International Freight Charges", "AF-01", "Air Freight, General Cargo (+100kg)", "KG", 68],
  ["Air Freight (AIR)", "CNSZX", "ZAJNB", "International Freight Charges", "AF-02", "Air Freight, General Cargo (+300kg)", "KG", 61],
  ["Air Freight (AIR)", "CNSZX", "ZAJNB", "Destination Handling and Delivery Charges", "TR-01", "Delivery Gauteng (up to 500kg)", "Trip", 1_650],
  ["Sea Freight (LCL)", "CNNGB", "ZADUR", "International Freight Charges", "OF-06", "Ocean Freight LCL", "W/M", 1_480],
  ["Sea Freight (LCL)", "CNNGB", "ZADUR", "Origin Charges", "OC-02", "Origin Handling & Documentation", "Shipment", 2_150],
  ["Sea Freight (FCL)", "CNSHA", "ZADUR", "International Freight Charges", "OF-01", "Ocean Freight 40HC", "Container", 41_500],
  ["Sea Freight (FCL)", "CNSHA", "ZADUR", "Destination Handling and Delivery Charges", "TR-04", "Cartage Durban to Gauteng 40'", "Container", 24_800],
  ["Courier Express (CX)", "DEFRA", "ZAJNB", "International Freight Charges", "CX-01", "Courier Express (per kg)", "KG", 145],
  ["Road Freight (RDX)", "ZADUR", "ZAJNB", "International Freight Charges", "RD-01", "Road Freight Durban to Johannesburg", "Pallet", 1_150],
].map(([mode, origin, destination, category, code, description, unit, sell], i) => ({
  id: `r${i}`, mode, origin, destination, carrier: null, category, code, description, unit, cur: "ZAR", sell,
}));

const SUPPLIERS = [
  { id: "s1", company: "Ningbo Ocean Tools Co. Ltd", contact: "Kevin Zhang", email: "export@oceantools.cn", phone: "+86 574 8765 1200", address: "No. 88 Beilun Road\nNingbo, Zhejiang", editable: true },
  { id: "s2", company: "Shenzhen Bright Lighting Co.", contact: "Lily Chen", email: "lily@brightlighting.cn", phone: "+86 755 8888 1234", address: "Bao'an District\nShenzhen, Guangdong" },
  { id: "s3", company: "Shanghai Pacific Furniture Ltd", contact: "Wei Liu", email: "sales@pacificfurniture.cn", phone: "+86 21 6655 0901", address: "Pudong New Area\nShanghai" },
  { id: "s4", company: "Bosch Industrial Parts GmbH", contact: "Anna Keller", email: "a.keller@bosch-parts.de", phone: "+49 69 2400 118", address: "Hanauer Landstrasse 120\nFrankfurt am Main" },
  { id: "s5", company: "Mumbai Spice Exports", contact: "Ravi Patel", email: "ravi@mumbaispice.in", phone: "+91 22 4012 7788", address: "Andheri East\nMumbai, Maharashtra" },
];

const TASKS = [
  { id: "t1", job_id: "j4", title: "Upload commercial invoice", body: "Needed before the airline cut-off.", status: "open", due_date: day(1), created_at: at(-1), done_at: null, from_portal: false, kind: "task", job_reference: "AIR614955" },
  { id: "t2", job_id: "j6", title: "Confirm cargo-ready date with supplier", body: null, status: "open", due_date: day(2), created_at: at(-2), done_at: null, from_portal: false, kind: "task", job_reference: "SEA615340" },
  { id: "t3", job_id: "j3", title: "Pay customs duties (EDI released)", body: "Duty statement attached on the shipment.", status: "doing", due_date: day(0), created_at: at(-1), done_at: null, from_portal: false, kind: "task", job_reference: "SEA613871" },
  { id: "t4", job_id: "j1", title: "Delivery to Kempton Park DC, not Durban", body: null, status: "open", due_date: null, created_at: at(-16), done_at: null, from_portal: true, kind: "note", job_reference: "SEA614220" },
];
const ITEMS = TASKS.map((t) => ({
  id: t.id, kind: t.kind, title: t.title, body: t.body, status: t.status, due_date: t.due_date, created_at: t.created_at,
  done_at: t.done_at, job_id: t.job_id, quote_id: null, job_reference: t.job_reference, quote_reference: null, shared: true, mine: t.from_portal,
}));

const WAREHOUSES = [
  { id: "w1", code: "JNB", name: "Johannesburg Warehouse", address: "Isando, Kempton Park", active: true, storage_basis: "cbm", storage_period: "week", storage_rate: 85, free_days: 7, min_charge: 250, handling_in_rate: 45, handling_out_rate: 45, notes: null, created_at: at(-400) },
  { id: "w2", code: "SZX", name: "Shenzhen Warehouse", address: "Bao'an, Shenzhen", active: true, storage_basis: "cbm", storage_period: "week", storage_rate: 60, free_days: 7, min_charge: 150, handling_in_rate: 30, handling_out_rate: 30, notes: null, created_at: at(-400) },
];
const LOCATIONS = [
  { id: "loc1", warehouse_id: "w1", zone: "A", code: "A-B03", name: null, kind: "rack", capacity_cbm: 12, active: true, notes: null, created_at: at(-400) },
  { id: "loc2", warehouse_id: "w1", zone: "B", code: "B-F11", name: null, kind: "floor", capacity_cbm: 30, active: true, notes: null, created_at: at(-400) },
  { id: "loc3", warehouse_id: "w2", zone: "C", code: "C-R07", name: null, kind: "rack", capacity_cbm: 10, active: true, notes: null, created_at: at(-400) },
];
function receipt(n: number, wh: string, loc: string, days: number, supplier: string, description: string, sku: string, pieces: number, kg: number, cbm: number, status = "in_store", extra: Q = {}): Q {
  return {
    id: `rc${n}`, receipt_no: `WR${String(300 + n).padStart(6, "0")}`, warehouse_id: wh, location_id: loc, client_id: CLIENT,
    job_id: null, supplier_id: null, received_at: at(days, 10), received_by: "Warehouse", delivered_by: supplier, vehicle_reg: null, driver_name: null,
    inbound_ref: `DN-${7700 + n}`, customer_reference: `PO-${5500 + n}`, description, marks: "KAROO / JNB", package_type: "Carton",
    pieces, pallets: Math.ceil(pieces / 20), gross_kg: kg, volume_cbm: cbm,
    packages: [{ sku, description, qty: pieces, type: "Carton", length_cm: 60, width_cm: 40, height_cm: 40, actual_kg: Math.round(kg / pieces) }],
    condition: "good", condition_notes: null, hazardous: false, notes: null, checked_at: at(days, 14), created_at: at(days, 10),
    on_hand: status === "released" ? 0 : pieces, on_hand_kg: status === "released" ? 0 : kg, on_hand_cbm: status === "released" ? 0 : cbm,
    last_out_at: status === "released" ? at(days + 5) : null, status, ...extra,
  };
}
const RECEIPTS = [
  receipt(1, "w1", "loc1", -3, "Ningbo Ocean Tools Co. Ltd", "Hand tool sets", "KT-HT-220", 48, 610, 3.6),
  receipt(2, "w1", "loc2", -6, "Shanghai Pacific Furniture Ltd", "Bar stools (flat pack)", "KT-BS-104", 120, 1_440, 9.8),
  receipt(3, "w2", "loc3", -2, "Shenzhen Bright Lighting Co.", "LED panel lights 600x600", "KT-LED-66", 80, 520, 4.2),
  receipt(4, "w1", "loc1", -14, "Yiwu Homeware Trading", "Stainless steel cookware", "KT-CW-310", 60, 480, 3.1, "part_released", { on_hand: 24, on_hand_kg: 192, on_hand_cbm: 1.2 }),
  receipt(5, "w1", "loc2", -30, "Bosch Industrial Parts GmbH", "Power tool spares", "KT-PT-015", 15, 210, 0.9, "released"),
  // Older, already released receipts (Reports' receipts chart).
  ...Array.from({ length: 14 }, (_, i) =>
    receipt(10 + i, "w1", "loc2", -250 + i * 16, ["Ningbo Ocean Tools Co. Ltd", "Shenzhen Bright Lighting Co.", "Yiwu Homeware Trading"][i % 3], ["Hand tool sets", "LED panel lights", "Cookware"][i % 3], ["KT-HT-220", "KT-LED-66", "KT-CW-310"][i % 3], 20 + i * 3, 240 + i * 30, 1.2 + i * 0.2, "released"),
  ),
];
const MOVES = RECEIPTS.filter((r) => r.status !== "released").map((r, i) => ({ id: `mv${i}`, receipt_id: r.id, location_id: r.location_id, qty: r.on_hand, kind: "receipt", ref_id: null, at: r.received_at }));
const WMS_TRACKER = [
  { receipt_id: "rc3", checked_at: at(-2, 14), consol_no: "CN000412", consol_mode: "air", consol_status: "open", master_no: null, house_no: "AIR612408-1", transport: "Air", etd: day(1), eta: day(3), shipment_ref: "AIR612408", shipment_id: "j2", release_no: null, released_at: null, outbound_ref: null },
  { receipt_id: "rc5", checked_at: at(-30, 14), consol_no: null, consol_mode: null, consol_status: null, master_no: null, house_no: null, transport: null, etd: null, eta: null, shipment_ref: null, shipment_id: null, release_no: "RL000088", released_at: at(-25), outbound_ref: "Collected by customer" },
];
const RELEASES = [
  { id: "rl1", release_no: "RL000088", warehouse_id: "w1", client_id: CLIENT, job_id: null, consol_id: null, released_at: at(-25, 11), released_by: "Warehouse", collected_by: "Karoo Trading", vehicle_reg: "HZ 44 PL GP", driver_id_no: null, deliver_to: "Kempton Park DC", outbound_ref: "RR-0031", notes: null, created_at: at(-25), pod_signed_by: "T. Nkosi", pod_delivered_at: at(-25, 15), lines: [{ id: "rll1", release_id: "rl1", receipt_id: "rc5", location_id: "loc2", pieces: 15, gross_kg: 210, volume_cbm: 0.9 }] },
  { id: "rl2", release_no: "RL000093", warehouse_id: "w1", client_id: CLIENT, job_id: null, consol_id: null, released_at: at(-8, 9), released_by: "Warehouse", collected_by: null, vehicle_reg: null, driver_id_no: null, deliver_to: "Karoo Trading, Kempton Park DC", outbound_ref: "RR-0034", notes: null, created_at: at(-8), lines: [{ id: "rll2", release_id: "rl2", receipt_id: "rc4", location_id: "loc1", pieces: 36, gross_kg: 288, volume_cbm: 1.9 }] },
];
const RELEASE_REQUESTS = [
  { id: "rr1", request_no: "RR000036", client_id: CLIENT, status: "requested", method: "deliver", required_date: day(1), deliver_to: "Karoo Trading, Kempton Park DC", collector_name: null, collector_vehicle: null, collector_id_no: null, contact: "Sarah 011 555 0182", notes: "Tail-lift needed", lines: [{ receipt_id: "rc2", pieces: 40 }], release_id: null, decline_reason: null, task_id: null, processed_at: null, created_at: ago(140) },
  { id: "rr2", request_no: "RR000034", client_id: CLIENT, status: "released", method: "deliver", required_date: day(-8), deliver_to: "Karoo Trading, Kempton Park DC", collector_name: null, collector_vehicle: null, collector_id_no: null, contact: null, notes: null, lines: [{ receipt_id: "rc4", pieces: 36 }], release_id: "rl2", decline_reason: null, task_id: null, processed_at: at(-8), created_at: at(-9) },
];
const PREADVICES = [
  { id: "pa1", preadvice_no: "PA000052", client_id: CLIENT, status: "expected", supplier: "Guangzhou Sunrise Textiles", eta: day(2), inbound_ref: "DN-7790", carrier: "Supplier truck", description: "Cotton bedding sets", packages: [{ sku: "KT-BD-440", description: "Bedding sets", qty: 90, type: "Carton", length_cm: 50, width_cm: 40, height_cm: 35, actual_kg: 6 }], notes: null, receipt_id: null, task_id: null, created_at: ago(300) },
];
const SERVICES = [
  { id: "sv1", service_no: "SV000021", client_id: CLIENT, receipt_ids: ["rc2"], service: "Labelling", qty: 120, notes: "Retail barcode labels supplied", required_date: day(1), status: "in_progress", charge_code: "WH-LBL", charge_amount: 1_080, staff_note: null, completed_at: null, billed_run_id: null, task_id: null, created_at: ago(400) },
];
// Monthly storage statements for the last 9 months (Reports' storage chart).
const BILLING = Array.from({ length: 9 }, (_, i) => {
  const to = -30 * (8 - i);
  const storage = 2_200 + ((i * 37) % 9) * 260;
  const handling = 640 + (i % 3) * 180;
  const service = i % 2 ? 1_080 : i % 3 ? 420 : 0;
  const lines = [
    { receipt_id: "rc2", receipt_no: "WR000302", description: "Storage", kind: "storage", code: "WH-STO", qty: 1, unit: "CBM/wk", rate: storage, amount: storage },
    { receipt_id: "rc1", receipt_no: "WR000301", description: "Handling in / out", kind: "handling_in", code: "WH-HIN", qty: 1, unit: "CBM", rate: handling, amount: handling },
    ...(service ? [{ receipt_id: "rc2", receipt_no: "WR000302", description: "Labelling", kind: "service", code: "WH-LBL", qty: 1, unit: "Job", rate: service, amount: service }] : []),
  ];
  const subtotal = storage + handling + service;
  return {
    id: `b${i}`, run_no: `SS${String(36 + i).padStart(6, "0")}`, client_id: CLIENT, warehouse_id: "w1", period_from: day(to - 30), period_to: day(to),
    lines, subtotal, vat: Math.round(subtotal * 15) / 100, total: Math.round(subtotal * 115) / 100,
    status: i === 8 ? "draft" : "invoiced", invoice_no: i === 8 ? null : `INV00${5100 + i}`, invoiced_at: i === 8 ? null : at(to + 1), notes: null, created_by: null, created_at: at(to + 1),
  };
});

const CHAT = [
  { id: "g1", client_id: CLIENT, direction: "in", body: "Morning, can you quote 1x40HC Shanghai to Durban, furniture, ready next week?", sender_name: "Sarah Botha", sender_email: "sarah@karootrading.co.za", created_at: ago(180), read_at: ago(170) },
  { id: "g2", client_id: CLIENT, direction: "out", body: "Morning Sarah, quote SEA616230 is being prepared, you'll see it under Quotations shortly.", sender_name: "Oliver", sender_email: null, created_at: ago(160), read_at: null },
  { id: "g3", client_id: CLIENT, direction: "in", body: "Perfect, thank you!", sender_name: "Sarah Botha", sender_email: "sarah@karootrading.co.za", created_at: ago(150), read_at: null },
];

const k = (key: QueryKey) => JSON.stringify(key);
const perJob = <T extends { job_id: string }>(rows: T[]) => (key: QueryKey) => rows.filter((r) => r.job_id === key[1]);

/** Query key → sample data. Matched on the key's leading parts. */
const DATA: [QueryKey, unknown | ((key: QueryKey) => unknown)][] = [
  [["my_profile"], PROFILE],
  [["portal", "me"], ME],
  [["portal", "quotes"], QUOTES],
  [["portal", "lines"], (key: QueryKey) => LINES.filter((l) => (key[2] as string[]).includes(l.quote_id as string))],
  [["portal", "packing"], PACKING],
  [["portal", "letterhead"], null],
  [["portal", "announcements"], []],
  [["portal", "tasks"], TASKS],
  [["portal", "items-notes"], ITEMS],
  [["portal", "msgstamps"], MESSAGES.map((m) => ({ id: m.id, job_id: m.job_id, direction: m.direction, created_at: m.created_at }))],
  [["portal", "wms-tracker"], WMS_TRACKER],
  [["quote-revisions"], []],
  [["my_jobs"], JOBS],
  [["my_job_tracking"], TRACKING],
  [["my_tracking_events"], perJob(TRACK_EVENTS)],
  [["my_job_events"], perJob(JOB_EVENTS)],
  [["my_status_history"], (key: QueryKey) => (key[1] === "j1" ? STATUS_HISTORY : [])],
  [["my_documents_all"], DOCS],
  [["my_documents"], perJob(DOCS)],
  [["my_messages"], perJob(MESSAGES)],
  [["my_job_houses"], perJob(HOUSES)],
  [["my_general_chat"], CHAT],
  [["my_rate_sheet"], RATES],
  [["my_suppliers"], SUPPLIERS],
  [["my_sage_account"], { balance: 141_215.5, synced_at: ago(12) }],
  [["customer_invoices"], INVOICES],
  [["wms", "warehouses"], WAREHOUSES],
  [["wms", "locations"], LOCATIONS],
  [["wms", "receipts"], RECEIPTS],
  [["wms", "moves"], MOVES],
  [["wms", "movements"], []],
  [["wms", "releases"], RELEASES],
  [["wms", "release-requests"], RELEASE_REQUESTS],
  [["wms", "preadvices"], PREADVICES],
  [["wms", "services"], SERVICES],
  [["wms", "billing"], BILLING],
];

function resolve(key: QueryKey): { hit: boolean; data?: unknown } {
  for (const [prefix, value] of DATA) {
    if (prefix.every((p, i) => k([p]) === k([key[i]]))) {
      return { hit: true, data: typeof value === "function" ? (value as (k: QueryKey) => unknown)(key) : value };
    }
  }
  return { hit: false };
}

/** Answers every query from the sample data as it's created, and keeps it
 *  from ever refetching against Supabase. */
export function DeckDemoSeed({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useState(() => {
    qc.setDefaultOptions({ queries: { staleTime: Infinity, retry: false, refetchInterval: false, refetchOnWindowFocus: false } });
    const fill = (key: QueryKey) => {
      const r = resolve(key);
      if (r.hit && qc.getQueryData(key) === undefined) qc.setQueryData(key, r.data);
    };
    qc.getQueryCache().getAll().forEach((q) => fill(q.queryKey));
    qc.getQueryCache().subscribe((e) => {
      if (e.type === "added") fill(e.query.queryKey);
    });
    return true;
  });
  return <>{children}</>;
}
