export type QuoteStatus = "draft" | "sent" | "followup" | "accepted";
export type QuoteMode =
  | "Air Freight (AIR)"
  | "Courier Express (CX)"
  | "Sea Freight (FCL)"
  | "Sea Freight (LCL)"
  | "Road Freight (RDX)";
export type Milestone = "Booked" | "In Transit" | "Customs" | "Delivered";

export const QUOTE_MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Courier Express (CX)",
  "Sea Freight (FCL)",
  "Sea Freight (LCL)",
  "Road Freight (RDX)",
];
export const MILESTONES: Milestone[] = ["Booked", "In Transit", "Customs", "Delivered"];

export type Commodity = "General Cargo" | "Hazardous Cargo" | "Sensitive Cargo";
export const COMMODITIES: Commodity[] = [
  "General Cargo",
  "Hazardous Cargo",
  "Sensitive Cargo",
];

export type ChargeCategory =
  | "International Freight Charges"
  | "Ex-Works Charges"
  | "Destination Handling and Delivery Charges"
  | "Customs Clearance, VAT and Duty Charges";
export const CHARGE_CATEGORIES: ChargeCategory[] = [
  "International Freight Charges",
  "Ex-Works Charges",
  "Destination Handling and Delivery Charges",
  "Customs Clearance, VAT and Duty Charges",
];

export type LineCurrency = "USD" | "CNY" | "ZAR";
export const LINE_CURRENCIES: LineCurrency[] = ["USD", "CNY", "ZAR"];

export interface Incoterm {
  code: string;
  name: string;
}
/** Incoterms 2020 usable with any transport mode (incl. air). */
export const INCOTERMS_ANY_MODE: Incoterm[] = [
  { code: "EXW", name: "Ex Works" },
  { code: "FCA", name: "Free Carrier" },
  { code: "CPT", name: "Carriage Paid To" },
  { code: "CIP", name: "Carriage and Insurance Paid To" },
  { code: "DAP", name: "Delivered at Place" },
  { code: "DPU", name: "Delivered at Place Unloaded" },
  { code: "DDP", name: "Delivered Duty Paid" },
];
/** Incoterms 2020 for sea and inland waterway transport only. */
export const INCOTERMS_SEA: Incoterm[] = [
  { code: "FAS", name: "Free Alongside Ship" },
  { code: "FOB", name: "Free on Board" },
  { code: "CFR", name: "Cost and Freight" },
  { code: "CIF", name: "Cost, Insurance and Freight" },
];
export const INCOTERM_CODES: string[] = [
  ...INCOTERMS_ANY_MODE,
  ...INCOTERMS_SEA,
].map((i) => i.code);

export const CHARGE_UNITS: string[] = [
  "KGS",
  "AWB",
  "INV",
  "CBM",
  "W/M",
  "R/T",
  "HBL",
  "HAWB",
  "MAWB",
  "B/L",
  "P/CTNR",
  "THC",
];

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Quote Sent",
  followup: "Follow-up",
  accepted: "Accepted",
};
export const STATUS_ORDER: QuoteStatus[] = ["draft", "sent", "followup", "accepted"];

export interface Contact {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}
export type Client = Contact;
export type Supplier = Contact;

export interface PackingItem {
  id?: string;
  quote_id?: string;
  position: number;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  actual_kg: number | string;
  qty_ctns: number | string;
}

export interface QuoteLine {
  id?: string;
  quote_id?: string;
  position: number;
  category: ChargeCategory;
  code: string;
  description: string;
  cur: LineCurrency;
  unit: string;
  qty: number | string;
  buy: number | string;
  /** Markup % added to buy before converting to the ZAR sell rate. */
  margin: number | string;
  /** Computed: buy x (1 + margin/100) x fx(cur). Stored for list/report math. */
  sell: number | string;
}

export interface Quote {
  id: string;
  reference: string;
  client_id: string | null;
  supplier_id: string | null;
  mode: QuoteMode;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  delivery_terms: string | null;
  valid_until: string | null;
  status: QuoteStatus;
  commercial_value: number | null;
  insurance_amount: number | null;
  vessel_name: string | null;
  mbl_no: string | null;
  hbl_no: string | null;
  container_no: string | null;
  etd: string | null;
  eta: string | null;
  incoterms: string | null;
  mawb_no: string | null;
  hawb_no: string | null;
  flight_no: string | null;
  flight_date: string | null;
  carrier_name: string | null;
  fx_usd_zar: number;
  fx_cny_zar: number;
  created_at: string;
  updated_at: string;
  quote_lines: QuoteLine[];
  packing_list_items: PackingItem[];
  client?: Pick<Client, "id" | "company"> | null;
  supplier?: Pick<Supplier, "id" | "company"> | null;
}

export interface Job {
  id: string;
  quote_id: string | null;
  reference: string;
  client_id: string | null;
  origin: string | null;
  destination: string | null;
  mode: QuoteMode;
  milestone: Milestone;
  created_at: string;
  client?: Pick<Client, "id" | "company"> | null;
  job_events?: JobEvent[];
}

export interface JobEvent {
  id: string;
  job_id: string;
  milestone: Milestone;
  note: string | null;
  created_at: string;
}

/** Draft shape used by the quote builder before a row exists in the DB. */
export interface QuoteDraft {
  id: string | null;
  reference: string;
  client_id: string;
  supplier_id: string;
  mode: QuoteMode;
  commodity: string;
  origin: string;
  destination: string;
  delivery_terms: string;
  valid_until: string;
  status: QuoteStatus;
  commercial_value: string;
  insurance_amount: string;
  vessel_name: string;
  mbl_no: string;
  hbl_no: string;
  container_no: string;
  etd: string;
  eta: string;
  incoterms: string;
  mawb_no: string;
  hawb_no: string;
  flight_no: string;
  flight_date: string;
  carrier_name: string;
  fx_usd_zar: string;
  fx_cny_zar: string;
  packing: PackingItem[];
  lines: QuoteLine[];
}
