export type QuoteStatus = "open" | "sent" | "accepted" | "lost";
export type QuoteMode =
  | "Air Freight (AIR)"
  | "Courier Express (CX)"
  | "Sea Freight (FCL)"
  | "Sea Freight (LCL)"
  | "Road Freight (RDX)";
export type Milestone = "Booked" | "In Transit" | "Customs" | "Delivered";

/* ---------- Settings ---------- */

export type UserRole = "admin" | "user" | "client";

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  /** Set only for role='client' — which customer this portal login belongs to. */
  client_id: string | null;
  /** Monthly Sales CRM targets, tracked against quotes.sales_person_id. */
  sales_revenue_target: number;
  sales_gp_target: number;
  created_at: string;
  /** Not on the profiles table — filled in from the current session for "me". */
  email?: string | null;
}
export type ProfilePatch = Partial<
  Pick<Profile, "full_name" | "role" | "sales_revenue_target" | "sales_gp_target">
>;

export interface CompanySettings {
  id: number;
  legal_name: string;
  reg_no: string;
  vat_no: string;
  tel: string;
  email: string;
  postal_address: string;
  strapline: string;
  blurb: string;
  bank_details: string;
  default_fx_usd_zar: number;
  default_fx_cny_zar: number;
  default_vat_pct: number;
  default_incoterm: string;
  sales_revenue_target: number;
  sales_gp_target: number;
  sales_new_leads_target: number;
  updated_at: string;
}
export type CompanySettingsPatch = Partial<
  Omit<CompanySettings, "id" | "updated_at">
>;

/* ---------- Rates & Tariff Sheet ---------- */

export interface RateSheetItem {
  id: string;
  mode: QuoteMode;
  origin: string | null;
  destination: string | null;
  carrier: string | null;
  category: ChargeCategory;
  code: string | null;
  description: string;
  unit: string | null;
  cur: LineCurrency;
  buy: number;
  margin: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type RateSheetPatch = Partial<
  Omit<RateSheetItem, "id" | "created_at" | "updated_at">
>;

/* ---------- Customer Portal (safe subsets — see client_* views) ---------- */

export interface ClientInvite {
  token: string;
  client_id: string;
  email: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface ClientQuote {
  id: string;
  reference: string;
  client_id: string;
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
  created_at: string;
  supplier_company: string | null;
}

export interface ClientQuoteLine {
  id: string;
  quote_id: string;
  position: number;
  category: ChargeCategory;
  code: string | null;
  description: string;
  unit: string | null;
  qty: number;
  cur: LineCurrency;
  vat_pct: number;
  sell: number;
}

export interface ClientJob {
  id: string;
  reference: string;
  client_id: string;
  mode: QuoteMode;
  milestone: Milestone;
  shipment_status: string | null;
  awb_mbl: string | null;
  container_no: string | null;
  shipping_line: string | null;
  vessel_name: string | null;
  carrier_name: string | null;
  provisional_delivery_date: string | null;
  etd: string | null;
  eta: string | null;
  origin: string | null;
  destination: string | null;
  created_at: string;
  supplier_company: string | null;
}

export interface ClientMessage {
  id: string;
  job_id: string;
  direction: "out" | "in";
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body: string;
  status: MessageStatus;
  created_at: string;
}

export interface ClientDocument {
  id: string;
  job_id: string;
  name: string;
  storage_path: string;
  kind: DocumentKind;
  doc_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

/* ---------- Document Vault ---------- */

export type DocumentKind = "upload" | "generated";

export interface ShipmentDocument {
  id: string;
  job_id: string;
  name: string;
  storage_path: string;
  kind: DocumentKind;
  doc_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

/* ---------- Sales CRM: Leads ---------- */

export interface LeadStatus {
  id: string;
  name: string;
  promotes_to_customer: boolean;
  sort_order: number;
  created_at: string;
}
export type LeadStatusPatch = Partial<Omit<LeadStatus, "id" | "created_at">>;

export interface Lead {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  notes: string | null;
  lead_status_id: string | null;
  sales_person_id: string | null;
  promoted_client_id: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  lead_status?: Pick<LeadStatus, "id" | "name" | "promotes_to_customer"> | null;
  sales_person?: Pick<Profile, "id" | "full_name"> | null;
}
export type LeadPatch = Partial<
  Omit<Lead, "id" | "created_at" | "updated_at" | "promoted_client_id" | "promoted_at">
>;

/* ---------- Sales CRM: Opportunities pipeline ---------- */

export type OpportunityStatus =
  | "new_lead"
  | "quote_sent"
  | "quote_accepted"
  | "job_completed"
  | "not_proceeding";

export const OPPORTUNITY_STAGES: { key: OpportunityStatus; label: string }[] = [
  { key: "new_lead", label: "New Lead - Enquiries" },
  { key: "quote_sent", label: "Quote Sent - Follow Up" },
  { key: "quote_accepted", label: "Quote Accepted - Job Active" },
  { key: "job_completed", label: "Job Completed - Shipment Delivered" },
  { key: "not_proceeding", label: "Not Proceeding - Keep In Contact" },
];

export interface Opportunity {
  id: string;
  title: string | null;
  lead_id: string | null;
  client_id: string | null;
  quote_id: string | null;
  job_id: string | null;
  status: OpportunityStatus;
  value: number;
  close_date: string | null;
  notes: string | null;
  sales_person_id: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  lead?: Pick<Lead, "id" | "company" | "contact" | "email" | "phone"> | null;
  client?: Pick<Client, "id" | "company" | "contact" | "email" | "phone"> | null;
  quote?: Pick<Quote, "id" | "reference" | "status"> | null;
  job?: Pick<Job, "id" | "reference" | "shipment_status" | "milestone"> | null;
  sales_person?: Pick<Profile, "id" | "full_name"> | null;
}
export type OpportunityPatch = Partial<
  Omit<Opportunity, "id" | "created_at" | "updated_at" | "lead" | "client" | "quote" | "job" | "sales_person">
>;

/* ---------- Sales CRM: Mail Templates ---------- */

export interface MailTemplateAttachment {
  name: string;
  url: string;
  size: number;
}
export interface MailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  attachments: MailTemplateAttachment[];
  created_at: string;
  updated_at: string;
}
export type MailTemplatePatch = Partial<
  Omit<MailTemplate, "id" | "created_at" | "updated_at">
>;

export const QUOTE_MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Courier Express (CX)",
  "Sea Freight (FCL)",
  "Sea Freight (LCL)",
  "Road Freight (RDX)",
];
export const MILESTONES: Milestone[] = ["Booked", "In Transit", "Customs", "Delivered"];

/**
 * Shipment status shown on the Active Jobs board. Free text in the DB
 * (`jobs.shipment_status`) — edit this list as the workflow changes.
 */
export const SHIPMENT_STATUSES: string[] = [
  "Booked",
  "Loaded for Flight",
  "Customs Cleared",
  "Customs Detained",
  "Arrived at Destination",
  "Collected",
  "Vessel Booked",
  "Departed",
  "In Transit",
  "Vessel Arrived",
  "Vessel Working",
  "Container Unlanded",
  "Collected from Port",
  "Out on Delivery",
  "Delivered",
];

/** Colour band for a status pill: 'start' | 'mid' | 'done' | 'alert'. */
export function shipmentStatusTone(s: string | null | undefined): string {
  switch (s) {
    case "Customs Detained":
      return "alert";
    case "Customs Cleared":
    case "Arrived at Destination":
    case "Collected":
    case "Vessel Arrived":
    case "Collected from Port":
    case "Delivered":
      return "done";
    case "Loaded for Flight":
    case "Departed":
    case "In Transit":
    case "Vessel Working":
    case "Container Unlanded":
    case "Out on Delivery":
      return "mid";
    default: // Booked, Vessel Booked
      return "start";
  }
}

/**
 * Maps the free-text Shipment Status (board dropdown) to the 4-stage
 * Milestone funnel (Dashboard's Operational Funnel + future CRM timeline).
 * Statuses not listed here leave the milestone unchanged.
 */
export const MILESTONE_BY_STATUS: Record<string, Milestone> = {
  Booked: "Booked",
  "Vessel Booked": "Booked",
  "Loaded for Flight": "In Transit",
  Departed: "In Transit",
  "In Transit": "In Transit",
  "Vessel Arrived": "In Transit",
  "Vessel Working": "In Transit",
  "Container Unlanded": "In Transit",
  "Customs Cleared": "Customs",
  "Customs Detained": "Customs",
  "Arrived at Destination": "Customs",
  "Collected from Port": "Customs",
  Collected: "Delivered",
  "Out on Delivery": "Delivered",
  Delivered: "Delivered",
};

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
  open: "Open",
  sent: "Sent",
  accepted: "Accepted",
  lost: "Lost",
};
export const STATUS_ORDER: QuoteStatus[] = ["open", "sent", "accepted", "lost"];

export interface Contact {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  /** Customer-only trade details (stored on the clients table). */
  vat_no?: string | null;
  import_code?: string | null;
  address?: string | null;
  /** Agent <-> Clearing Agent cross-listing (agents / clearing_agents only). */
  also_clearing_agent?: boolean | null;
  also_agent?: boolean | null;
  /** Non-null on a row that mirrors a record in the other table (read-only here). */
  source_agent_id?: string | null;
  source_clearing_agent_id?: string | null;
  created_at: string;
}
export type Client = Contact;
export type Supplier = Contact;
export type Agent = Contact;
export type Transporter = Contact;
export type ClearingAgent = Contact;

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
  /** VAT % charged on this line's ZAR total. 0 = no / zero-rated VAT. */
  vat_pct: number | string;
  /** Computed: buy x (1 + margin/100) x fx(cur). Stored for list/report math. */
  sell: number | string;
}

export interface Quote {
  id: string;
  reference: string;
  client_id: string | null;
  /** Set instead of client_id when the customer is a not-yet-promoted lead. */
  lead_id: string | null;
  /** Attributed sales rep — a Sales CRM concept, independent of lead_id. */
  sales_person_id: string | null;
  supplier_id: string | null;
  /** Agent / transporter / clearing agent — internal only, never shown to the customer. */
  agent_id: string | null;
  transporter_id: string | null;
  clearing_agent_id: string | null;
  mode: QuoteMode;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  delivery_terms: string | null;
  valid_until: string | null;
  status: QuoteStatus;
  accepted_at: string | null;
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
  agent?: Pick<Agent, "id" | "company"> | null;
  transporter?: Pick<Transporter, "id" | "company"> | null;
  clearing_agent?: Pick<ClearingAgent, "id" | "company"> | null;
}

/* ---------- Import VAT / Duty Output ---------- */

export interface ImportDutyLine {
  id?: string;
  ivd_id?: string;
  position: number;
  description: string;
  qty_pcs: number | string;
  unit_price: number | string;
  cur: string;
  /** Rate of exchange to ZAR. */
  roe: number | string;
  /** Customs duty rate for this line, as a percentage (e.g. 15 = 15%). */
  duty_rate_pct: number | string;
}

export interface ImportVatDuty {
  id: string;
  quote_id: string;
  po_no: string | null;
  /** Statutory VAT uplift on customs value (SARS: 10%). */
  vat_uplift_pct: number;
  /** Import VAT rate (SARS: 15%). */
  vat_rate_pct: number;
  created_at: string;
  updated_at: string;
  import_vat_duty_lines: ImportDutyLine[];
}

/** Editable shape used by the Import VAT/Duty page before/after a row exists. */
export interface ImportDutyDraft {
  id: string | null;
  quote_id: string;
  po_no: string;
  vat_uplift_pct: number | string;
  vat_rate_pct: number | string;
  lines: ImportDutyLine[];
}

export interface Job {
  id: string;
  quote_id: string | null;
  reference: string;
  client_id: string | null;
  supplier_id: string | null;
  origin: string | null;
  destination: string | null;
  mode: QuoteMode;
  milestone: Milestone;
  /** Operational fields, editable on the Active Jobs board. */
  po_no: string | null;
  shipment_status: string | null;
  notes: string | null;
  awb_mbl: string | null;
  /** Ocean container number (air jobs track on awb_mbl). */
  container_no: string | null;
  /** Sea Freight details for the customer update email; persist on the board. */
  shipping_line: string | null;
  vessel_name: string | null;
  provisional_delivery_date: string | null;
  /** Carrier / airline name, seeded from the quote; shown on the board. */
  carrier_name: string | null;
  etd: string | null;
  eta: string | null;
  created_at: string;
  client?: (Pick<Client, "id" | "company"> & { email?: string | null }) | null;
  supplier?: (Pick<Supplier, "id" | "company"> & { email?: string | null }) | null;
  job_events?: JobEvent[];
}

/** The shipment_status value that files a shipment under Completed Shipments. */
export const DELIVERED_STATUS = "Delivered";

/**
 * A shipment is finished — belongs on Completed Shipments and drops off the
 * dashboard, Control Tower and Live Tracking — once its shipment status or its
 * milestone reads Delivered.
 */
export function isShipmentComplete(
  job: Pick<Job, "shipment_status" | "milestone">,
): boolean {
  return job.shipment_status === DELIVERED_STATUS || job.milestone === "Delivered";
}

/** Fields on a Job that the Active Jobs board can edit inline. */
export type JobPatch = Partial<
  Pick<
    Job,
    | "po_no"
    | "shipment_status"
    | "notes"
    | "awb_mbl"
    | "container_no"
    | "shipping_line"
    | "vessel_name"
    | "carrier_name"
    | "provisional_delivery_date"
    | "etd"
    | "eta"
    | "origin"
    | "destination"
  >
>;

/** Shape for inserting a new job row directly (e.g. Duplicate on the board). */
export type JobInsert = Pick<Job, "reference" | "mode"> & JobPatch & Partial<
  Pick<Job, "quote_id" | "client_id" | "supplier_id">
>;

/* ---------- Shipment Comms (messages) ---------- */

export type MessageKind = "email" | "note";
export type MessageStatus =
  | "draft"
  | "sent"
  | "failed"
  | "delivered"
  | "opened"
  | "bounced";

export interface Message {
  id: string;
  job_id: string;
  kind: MessageKind;
  direction: "out" | "in";
  to_emails: string[];
  cc_emails: string[];
  from_email: string | null;
  subject: string | null;
  body: string;
  remarks: string | null;
  status: MessageStatus;
  provider_id: string | null;
  error: string | null;
  meta: unknown;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

export type MessagePatch = Partial<
  Pick<Message, "status" | "provider_id" | "error" | "sent_at">
>;

export interface JobEvent {
  id: string;
  job_id: string;
  milestone: Milestone;
  note: string | null;
  created_at: string;
}

/* ---------- Operations Control Tower ---------- */

export type OpsTaskKind = "task" | "note";
export type OpsTaskStatus = "open" | "doing" | "done";
export type OpsTaskPriority = "low" | "normal" | "high";

export const OPS_TASK_STATUSES: OpsTaskStatus[] = ["open", "doing", "done"];
export const OPS_TASK_PRIORITIES: OpsTaskPriority[] = ["low", "normal", "high"];

export interface OpsTask {
  id: string;
  kind: OpsTaskKind;
  title: string;
  body: string | null;
  status: OpsTaskStatus;
  priority: OpsTaskPriority;
  due_date: string | null;
  job_id: string | null;
  quote_id: string | null;
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  /** Joined for display. */
  job?: Pick<Job, "id" | "reference"> | null;
  quote?: Pick<Quote, "id" | "reference"> | null;
  client?: Pick<Client, "id" | "company"> | null;
}

export type OpsTaskPatch = Partial<
  Pick<
    OpsTask,
    | "kind"
    | "title"
    | "body"
    | "status"
    | "priority"
    | "due_date"
    | "job_id"
    | "quote_id"
    | "client_id"
    | "done_at"
  >
>;

/** One normalised movement/event on a shipment's timeline. */
export interface TrackingMovement {
  code: string;
  description: string | null;
  date: string | null;
  location: string | null;
  vessel: string | null;
  voyage: string | null;
  done: boolean;
}

/** Cached ShipsGo pull for a job (row in job_tracking). */
export interface JobTracking {
  id: string;
  job_id: string;
  ref_type: "ocean" | "air" | null;
  ref_value: string | null;
  carrier: string | null;
  shipsgo_id: string | null;
  status: string | null;
  pol: string | null;
  pod: string | null;
  etd: string | null;
  eta: string | null;
  last_event: string | null;
  movements: TrackingMovement[];
  raw: unknown;
  synced_at: string | null;
  created_at: string;
}

/** Draft shape used by the quote builder before a row exists in the DB. */
export interface QuoteDraft {
  id: string | null;
  reference: string;
  client_id: string;
  /** Set instead of client_id when the customer is a not-yet-promoted lead. */
  lead_id: string;
  sales_person_id: string;
  supplier_id: string;
  agent_id: string;
  transporter_id: string;
  clearing_agent_id: string;
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
