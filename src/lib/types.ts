export type QuoteStatus = "open" | "sent" | "accepted" | "completed" | "lost";
export type QuoteMode =
  | "Air Freight (AIR)"
  | "Courier Express (CX)"
  | "Sea Freight (FCL)"
  | "Sea Freight (LCL)"
  | "Road Freight (RDX)";
export type Milestone =
  | "Created"
  | "Booked"
  | "In Transit"
  | "Arrived"
  | "Customs"
  | "On Delivery"
  | "Delivered";

/** One colour per Operational Funnel stage — same hues as the .ms-tag
 *  badge variants, so a shipment's status colour reads consistently
 *  wherever it shows up. */
export const MILESTONE_COLOR: Record<Milestone, string> = {
  Created: "#9aa39a",
  Booked: "#8cbc43",
  "In Transit": "#e9a91b",
  Arrived: "#02a5aa",
  Customs: "#ef4910",
  "On Delivery": "#3b82c4",
  Delivered: "#719d2f",
};

/** One colour per stage for the 5-row pipeline bars (Quotation Pipeline,
 *  Opportunities Pipeline, Quotes by Status) — all three share the same
 *  New Lead / Sent / Accepted / Completed / Lost shape, applied by row
 *  index rather than a lookup since STATUS_ORDER and OPPORTUNITY_STAGES
 *  use different key types for the same five conceptual stages. */
export const PIPE_STAGE_COLORS: string[] = [
  "#9aa39a",
  "#e9a91b",
  "#8cbc43",
  "#02a5aa",
  "#ef4910",
];

/* ---------- Settings ---------- */

export type UserRole = "admin" | "user" | "client" | "restricted" | "partner";

export interface Profile {
  id: string;
  full_name: string | null;
  /** How the Customer Portal greets this login, e.g. "Mr Gilbert" (0141). */
  greeting?: string | null;
  role: UserRole;
  /** Per-login permission overrides (0131); a missing key = the role's setting. */
  permissions?: Partial<Record<import("./permissions").PermKey, boolean>> | null;
  /** Set for role='client', and kept when revoked to role='restricted' so
   *  access can be restored — which customer this portal login belongs to. */
  client_id: string | null;
  /** Self-serve portal signups only. null = not applicable (staff, or an
   *  older invite-claimed client) — the app treats null the same as
   *  'approved'. */
  portal_status: "pending" | "approved" | "rejected" | null;
  /** Which portal nav sections this login can see. Only meaningful for
   *  role='client' (or 'restricted' — kept so it's remembered on restore). */
  portal_permissions: {
    shipments: boolean;
    quotes: boolean;
    invoices: boolean;
    suppliers: boolean;
    rates: boolean;
    messaging: boolean;
    /** WMS stock / releases / storage statements (0138). Missing = on. */
    warehouse?: boolean;
  };
  /** Free-text company name typed on the self-serve signup form, to help
   *  staff match a pending request to an existing client. */
  requested_company: string | null;
  /** role='partner' (0121): the agent / transporter / clearing agent this
   *  partner-portal login belongs to. */
  partner_kind?: PartnerKind | null;
  partner_id?: string | null;
  /** @deprecated flat currency targets superseded by sales_target (incl.
   *  VAT) + the company-wide Cost of Sales Ratio target — kept for existing
   *  data; no longer surfaced in the Sales Person UI. */
  sales_revenue_target: number;
  /** @deprecated see sales_revenue_target above. */
  sales_gp_target: number;
  /** Monthly Sales CRM target, tracked against quotes.sales_person_id:
   *  Total Sales (Grand Total incl. VAT). */
  sales_target: number;
  /** Monthly new-leads target for this rep. */
  leads_target: number;
  created_at: string;
  email?: string | null;
}
export type ProfilePatch = Partial<
  Pick<
    Profile,
    | "full_name"
    | "role"
    | "permissions"
    | "sales_revenue_target"
    | "sales_gp_target"
    | "sales_target"
    | "leads_target"
  >
>;

/** The four freight groups that get their own shipment-notification email. */
export type ShipmentModeKey = "air" | "sea" | "courier" | "road";

export interface ShipmentCommsTemplate {
  /** Email subject line (merge codes allowed). */
  subject: string;
  /** Plain-text email body (merge codes allowed). */
  body: string;
}

/** Per-mode overrides of the built-in shipment-notification templates.
 *  Stored as a jsonb blob on company_settings; missing keys / fields fall
 *  back to the defaults in mailTemplates.ts. */
export type ShipmentCommsConfig = Partial<
  Record<ShipmentModeKey, Partial<ShipmentCommsTemplate>>
>;

export interface CompanySettings {
  id: number;
  /** Editable tier margins (0130), e.g. { platinum: 10, gold: 15, silver: 18 }. */
  tier_margins?: Partial<Record<RateTierId, number>> | null;
  /** Per-role permission switches (0131) — see lib/permissions.ts. */
  role_permissions?: Partial<import("./permissions").RolePermissions> | null;
  /** Document Vault title overrides (0140): { slug: title }. */
  doc_titles?: Record<string, string> | null;
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
  default_fx_eur_zar: number;
  /** Migration 0113. */
  default_fx_gbp_zar?: number;
  default_vat_pct: number;
  default_incoterm: string;
  /** Company-wide Total Sales target (Grand Total incl. VAT). */
  sales_target: number;
  /** @deprecated superseded by cost_of_sales_target — kept for existing
   *  data; no longer surfaced in the Edit Targets UI. */
  sales_revenue_target: number;
  /** @deprecated see sales_revenue_target above. */
  sales_gp_target: number;
  sales_new_leads_target: number;
  /** Cost of Sales Ratio target (%) — at or below this, margin is healthy. */
  cost_of_sales_target: number;
  /** Quote Win Rate target (%), higher is better — migration 0118. */
  win_rate_target?: number;
  /** Median quote turnaround target (hours), lower is better — 0118. */
  quote_turnaround_target_hrs?: number;
  /** Overall target for the Opportunities Pipeline chart's total value —
   *  each stage's bar is scaled against this instead of the pipeline's own
   *  current total. 0 = no target set, falls back to the current total. */
  opportunities_pipeline_target: number;
  /** Same idea as opportunities_pipeline_target, for the Quotes by Status
   *  chart. */
  quotes_pipeline_target: number;
  mail_sender_name: string;
  mail_reply_to: string;
  mail_signature_html: string;
  /** Per-mode shipment-notification template overrides. */
  shipment_comms: ShipmentCommsConfig;
  /** Per-mode quick-reply template overrides — a chat-style message within
   *  an existing thread, no shipment-data block. */
  shipment_replies: ShipmentCommsConfig;
  /** Per-mode quotation-notification template overrides — same idea as
   *  shipment_comms, for a quote's Comms panel. */
  quotation_comms: ShipmentCommsConfig;
  /** Per-mode quick-reply template overrides for a quote's Comms panel. */
  quotation_replies: ShipmentCommsConfig;
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

/** Row shape from the list_portal_users() RPC — every profile linked to a
 *  customer (approved, restricted, or a pending self-serve request),
 *  admin-only (see 0091_role_model_v2.sql). */
export interface PortalUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  client_id: string | null;
  company: string | null;
  portal_status: "pending" | "approved" | "rejected" | null;
  portal_permissions: Profile["portal_permissions"];
  requested_company: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface PortalAnnouncement {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  published: boolean;
  created_by: string | null;
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

/** "Customer Party" — a shipper used on one of this client's own shipments. */
export interface ClientSupplier {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
}

/** Tariff Sheet — the internal rate_sheet with buy/margin collapsed into a
 *  single sell rate (see client_rate_sheet in 0071). */
export interface ClientRateSheetItem {
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
  sell: number;
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
  /** Shown in the customer's portal Documents/Invoices panel once true. */
  visible_to_client: boolean;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

/** Options for the "Type" picker on a shipment document upload. */
export const DOCUMENT_TYPES = [
  "Invoice",
  "Packing List",
  "Bill of Lading / AWB",
  "Customs",
  "Other",
] as const;

/* ---------- Sales CRM: Leads ---------- */

export interface LeadStatus {
  id: string;
  name: string;
  promotes_to_customer: boolean;
  sort_order: number;
  color: string;
  created_at: string;
}
export type LeadStatusPatch = Partial<Omit<LeadStatus, "id" | "created_at">>;

/** Managed picklist for the free-text Lead/Customer "source" field — this
 *  only supplies the dropdown's options, `source` itself stays plain text. */
export interface LeadSource {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}
export type LeadSourcePatch = Partial<Omit<LeadSource, "id" | "created_at">>;

export interface Lead {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  /** The primary contact's mobile. */
  phone: string | null;
  /** Company switchboard / landline. */
  company_phone: string | null;
  website: string | null;
  address: string | null;
  vat_no: string | null;
  import_code: string | null;
  source: string | null;
  description: string | null;
  notes: string | null;
  lead_status_id: string | null;
  sales_person_id: string | null;
  promoted_client_id: string | null;
  promoted_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  lead_status?: Pick<LeadStatus, "id" | "name" | "promotes_to_customer"> | null;
  sales_person?: Pick<Profile, "id" | "full_name"> | null;
}
export type LeadPatch = Partial<
  Omit<Lead, "id" | "created_at" | "updated_at" | "promoted_client_id" | "promoted_at">
>;

/** Extra people at the same prospect company (leads.contact stays primary). */
export interface LeadContact {
  id: string;
  lead_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}
export interface LeadContactDraft {
  name: string;
  role: string;
  email: string;
  phone: string;
}

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
  { key: "quote_accepted", label: "Quote Accepted - Active Shipment" },
  { key: "job_completed", label: "Completed - Shipment Delivered" },
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
  /** TEMP (0052): for synthetic quotation cards, the raw manual override
   *  (NULL when the card is showing the computed quotation total). */
  opportunity_value?: number | null;
  close_date: string | null;
  notes: string | null;
  sales_person_id: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  lead?: Pick<
    Lead,
    "id" | "company" | "contact" | "email" | "phone" | "lead_status_id"
  > | null;
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

/* ---------- Sales CRM: Media library ---------- */

/** A reusable image in the Media gallery. Files live in the shared public
 *  `mail-assets` storage bucket; `url` is already routed through the CDN
 *  domain when one is configured (VITE_MAIL_CDN_BASE). */
export interface MediaAsset {
  id: string;
  folder: string;
  name: string;
  url: string;
  storage_path: string;
  size_bytes: number | null;
  mime: string | null;
  created_by: string | null;
  created_at: string;
}

/** A named folder in the Media gallery. Rows only exist so an *empty*
 *  folder can be created and survive a reload -- once it holds an asset,
 *  the folder also shows up from that asset's `folder` label alone. */
export interface MediaFolder {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

/* ---------- Sales CRM: Mail Campaigns ---------- */

export type MailCampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";
export type MailRecipientStatus =
  | "pending"
  | "sent"
  | "failed"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced";

export interface MailCampaign {
  id: string;
  template_id: string | null;
  name: string;
  subject: string;
  body: string;
  status: MailCampaignStatus;
  recipient_filter: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  /** Set for a scheduled (server-sent) campaign -- migration 0116. */
  scheduled_at: string | null;
  from_name: string | null;
  reply_to: string | null;
}
export type MailCampaignPatch = Partial<
  Omit<MailCampaign, "id" | "created_by" | "created_at">
>;

export interface MailCampaignRecipient {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  email: string;
  status: MailRecipientStatus;
  provider_id: string | null;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
  /** Joined for display. */
  lead?: Pick<Lead, "id" | "company" | "contact"> | null;
}

/* ---------- Sales CRM: Follow-up workflows ---------- */

export type FollowUpTrigger =
  | "quote_quiet"
  | "lead_no_quote"
  | "campaign_no_open"
  | "shipment_delivered";

export const FOLLOW_UP_TRIGGERS: {
  key: FollowUpTrigger;
  label: string;
  hint: string;
}[] = [
  {
    key: "quote_quiet",
    label: "Quote gone quiet",
    hint: "Quote still 'Sent' N days after it was last updated",
  },
  {
    key: "lead_no_quote",
    label: "New lead, no quote",
    hint: "Lead added N days ago with no quote raised against it",
  },
  {
    key: "campaign_no_open",
    label: "Campaign not opened",
    hint: "Campaign email still unopened N days after it was sent",
  },
  {
    key: "shipment_delivered",
    label: "Shipment delivered",
    hint: "Shipment marked Delivered N days ago",
  },
];

export interface FollowUpRule {
  id: string;
  name: string;
  trigger: FollowUpTrigger;
  delay_days: number;
  template_id: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export type FollowUpRulePatch = Partial<
  Omit<FollowUpRule, "id" | "created_by" | "created_at" | "updated_at">
>;

export interface FollowUpLogEntry {
  id: string;
  rule_id: string | null;
  trigger: FollowUpTrigger;
  subject_key: string;
  lead_id: string | null;
  email: string;
  subject: string | null;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  created_at: string;
  /** Joined for display. */
  rule?: Pick<FollowUpRule, "id" | "name"> | null;
}

/* ---------- Sales CRM: Web contact forms ---------- */

export type WebFormFieldType =
  | "text"
  | "email"
  | "phone"
  | "textarea"
  | "dropdown"
  | "image";
export type WebFormFieldMap =
  | "company"
  | "contact"
  | "email"
  | "phone"
  | "notes"
  | "none";

export const WEB_FORM_FIELD_TYPES: { type: WebFormFieldType; label: string }[] = [
  { type: "text", label: "Short text" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "textarea", label: "Long text" },
  { type: "dropdown", label: "Dropdown" },
  { type: "image", label: "Image upload" },
];

export const WEB_FORM_FIELD_MAPS: { value: WebFormFieldMap; label: string }[] = [
  { value: "none", label: "Don't map" },
  { value: "company", label: "Lead · Company" },
  { value: "contact", label: "Lead · Contact name" },
  { value: "email", label: "Lead · Email" },
  { value: "phone", label: "Lead · Phone" },
  { value: "notes", label: "Lead · Notes (appended)" },
];

export interface WebFormField {
  id: string;
  type: WebFormFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  choices?: string[];
  mapTo: WebFormFieldMap;
}

export interface WebForm {
  id: string;
  name: string;
  heading: string;
  subtitle: string;
  fields: WebFormField[];
  submit_label: string;
  thankyou_title: string;
  thankyou_body: string;
  notify_email: string | null;
  track_url_params: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export type WebFormPatch = Partial<
  Omit<WebForm, "id" | "created_at" | "updated_at">
>;

/** The render-safe subset returned by the public get_web_form RPC. */
export interface PublicWebForm {
  id: string;
  heading: string;
  subtitle: string;
  fields: WebFormField[];
  submit_label: string;
  thankyou_title: string;
  thankyou_body: string;
  track_url_params: boolean;
}

export interface WebFormSubmission {
  id: string;
  form_id: string;
  lead_id: string | null;
  data: Record<string, string>;
  utm: Record<string, string>;
  created_at: string;
}

export const QUOTE_MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Courier Express (CX)",
  "Sea Freight (FCL)",
  "Sea Freight (LCL)",
  "Road Freight (RDX)",
];
export const MILESTONES: Milestone[] = [
  "Created",
  "Booked",
  "In Transit",
  "Arrived",
  "Customs",
  "On Delivery",
  "Delivered",
];

/**
 * Shipment status shown on the Active Jobs board. Free text in the DB
 * (`jobs.shipment_status`) — edit this list as the workflow changes.
 */
export const SHIPMENT_STATUSES: string[] = [
  "Created",
  "Booked",
  "Collected",
  "Received",
  "Loaded",
  "Departed",
  "In Transit",
  "Arrived",
  "Unloaded",
  "Customs",
  "Detained",
  "Released",
  "On-Delivery",
  "Delivered",
];

/** CSS-class-safe slug for a status pill — each status gets its own colour. */
export function shipmentStatusSlug(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  if (!v) return "unset";
  return v.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Maps the free-text Shipment Status (board dropdown) to the 7-stage
 * Milestone funnel (Dashboard's Operational Funnel + future CRM timeline).
 * Statuses not listed here leave the milestone unchanged.
 */
export const MILESTONE_BY_STATUS: Record<string, Milestone> = {
  Created: "Created",
  Booked: "Booked",
  Collected: "Booked",
  Received: "Booked",
  Loaded: "In Transit",
  Departed: "In Transit",
  "In Transit": "In Transit",
  Arrived: "Arrived",
  Unloaded: "Arrived",
  Customs: "Customs",
  Detained: "Customs",
  Released: "Customs",
  "On-Delivery": "On Delivery",
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
  | "FOB Charges"
  | "Destination Handling and Delivery Charges"
  | "Cartage and Road Freight Charges"
  | "Customs Clearance, VAT and Duty Charges";
export const CHARGE_CATEGORIES: ChargeCategory[] = [
  "International Freight Charges",
  "Ex-Works Charges",
  "FOB Charges",
  "Destination Handling and Delivery Charges",
  "Cartage and Road Freight Charges",
  "Customs Clearance, VAT and Duty Charges",
];

export type LineCurrency = "USD" | "CNY" | "ZAR" | "EUR" | "GBP";
export const LINE_CURRENCIES: LineCurrency[] = ["USD", "CNY", "ZAR", "EUR", "GBP"];

export interface Incoterm {
  code: string;
  name: string;
}
/** Incoterms usable with any transport mode (incl. air) — FOB is used on
 *  air freight too, not only sea (ExPac practice). */
export const INCOTERMS_ANY_MODE: Incoterm[] = [
  { code: "EXW", name: "Ex Works" },
  { code: "FCA", name: "Free Carrier" },
  { code: "FOB", name: "Free on Board" },
  { code: "CPT", name: "Carriage Paid To" },
  { code: "CIP", name: "Carriage and Insurance Paid To" },
  { code: "DAP", name: "Delivered at Place" },
  { code: "DPU", name: "Delivered at Place Unloaded" },
  { code: "DDP", name: "Delivered Duty Paid" },
];
/** Incoterms 2020 for sea and inland waterway transport only. */
export const INCOTERMS_SEA: Incoterm[] = [
  { code: "FAS", name: "Free Alongside Ship" },
  { code: "CFR", name: "Cost and Freight" },
  { code: "CIF", name: "Cost, Insurance and Freight" },
];
export const INCOTERM_CODES: string[] = [
  ...INCOTERMS_ANY_MODE,
  ...INCOTERMS_SEA,
].map((i) => i.code);

export const CHARGE_UNITS: string[] = [
  "KGS",
  "PKGS",
  "AWB",
  "INV",
  "DOC",
  "DIS",
  "CBM",
  "W/M",
  "R/T",
  "HBL",
  "HAWB",
  "MAWB",
  "B/L",
  "P/CTNR",
  "20GP",
  "40GP",
  "40HC",
  "THC",
];

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  open: "New Lead",
  sent: "Quote Sent",
  accepted: "Quote Accepted",
  completed: "Completed",
  lost: "Not Proceeding",
};
export const STATUS_ORDER: QuoteStatus[] = [
  "open",
  "sent",
  "accepted",
  "completed",
  "lost",
];
/** Quote statuses that count as a won deal (accepted, or since delivered). */
export const WON_QUOTE_STATUSES: QuoteStatus[] = ["accepted", "completed"];

export interface Contact {
  id: string;
  company: string;
  /** Shippers only (0142): the customer this shipper belongs to. */
  client_id?: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  /** Customer-only trade details (stored on the clients table). */
  vat_no?: string | null;
  import_code?: string | null;
  address?: string | null;
  /** Customer-only profile fields — parity with a Lead (clients table). */
  company_phone?: string | null;
  website?: string | null;
  source?: string | null;
  description?: string | null;
  notes?: string | null;
  sales_person_id?: string | null;
  /** Agent <-> Clearing Agent cross-listing (agents / clearing_agents only). */
  also_clearing_agent?: boolean | null;
  also_agent?: boolean | null;
  /** Non-null on a row that mirrors a record in the other table (read-only here). */
  source_agent_id?: string | null;
  source_clearing_agent_id?: string | null;
  /** Customer <-> Shipper cross-listing (clients / suppliers only) — the
   *  shipper/exporter is sometimes also the customer, and vice versa. */
  also_shipper?: boolean | null;
  also_customer?: boolean | null;
  /** Non-null on a row that mirrors a record in the other table (read-only here). */
  source_supplier_id?: string | null;
  source_client_id?: string | null;
  /** Coverage (agents / transporters / clearing agents only, migration 0114):
   *  modes handled (QuoteMode labels), countries and UN/LOCODE ports /
   *  airports serviced, plus free-text notes. */
  modes?: string[] | null;
  countries?: string[] | null;
  ports?: string[] | null;
  coverage_notes?: string | null;
  /** Customer price tier (clients only, migration 0119) — Silver by default. */
  rate_tier?: RateTierId | null;
  created_at: string;
  /** Joined for display (clients only). */
  sales_person?: Pick<Profile, "id" | "full_name"> | null;
}

/** Extra people at a customer company (clients.contact stays primary). */
export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}
/** Partner books that carry coverage + rate structures (migration 0114). */
export type PartnerKind = "agent" | "transporter" | "clearing_agent" | "destination_agent";

export interface RateBreak {
  /** e.g. "0-45KG", "Min 100 KGS (Consol Run)". */
  label: string;
  rate: number | null;
}
export interface RateCharge {
  description: string;
  amount: number | null;
  /** Free text, e.g. "Per AWB", "0.13 USD/KG, min 29.00 USD/AWB". */
  basis: string;
}
export interface RateTier {
  /** e.g. "1-299kg". */
  label: string;
  amount: number | null;
}
/** One block of a rate structure: a commodity/service on one routing, with
 *  its weight breaks, origin charges and pick-up tiers — one table of the
 *  agent's rate sheet. */
export interface RateBlock {
  id: string;
  commodity: string;
  carrier: string;
  depart_from: string;
  routing: string;
  transit: string;
  terms: string;
  notes: string;
  breaks: RateBreak[];
  charges: RateCharge[];
  pickup: RateTier[];
}
export interface PartnerRateStructure {
  id: string;
  partner_kind: PartnerKind;
  partner_id: string;
  title: string;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  currency: string;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  blocks: RateBlock[];
  created_at: string;
  updated_at: string;
}
export type PartnerRateStructureDraft = Omit<
  PartnerRateStructure,
  "id" | "created_at" | "updated_at"
>;

/* ---------- Tier + partner rate sheets (migration 0119) ---------- */

export type RateTierId = "platinum" | "gold" | "silver";
export const RATE_TIERS: {
  id: RateTierId;
  label: string;
  /** Default margin % on every buy price. */
  margin: number;
  note: string;
}[] = [
  { id: "platinum", label: "Platinum", margin: 10, note: "Highest-volume customers" },
  { id: "gold", label: "Gold", margin: 15, note: "Regular, consistent volume" },
  { id: "silver", label: "Silver", margin: 18, note: "Standard rates, default for every customer" },
];
export const DEFAULT_RATE_TIER: RateTierId = "silver";
export function rateTier(id: string | null | undefined) {
  return RATE_TIERS.find((t) => t.id === id) ?? RATE_TIERS[2];
}
/** The admin-editable tier margins (company_settings.tier_margins, 0130),
 *  applied over the defaults above once settings load (useTierMargins). */
export function applyTierMargins(m: Partial<Record<RateTierId, number>> | null | undefined) {
  for (const t of RATE_TIERS) {
    const v = Number(m?.[t.id]);
    if (m?.[t.id] != null && Number.isFinite(v)) t.margin = v;
  }
}

/** A rate picked by the quote's chargeable weight, e.g. "0-45KG". */
export interface WeightBreak {
  label: string;
  rate: number | null;
}
/** One code on a partner rate sheet. */
export interface PartnerSheetLine {
  buy: number | null;
  cur: LineCurrency;
  /** When set, the rate comes from the break matching the chargeable weight. */
  breaks?: WeightBreak[];
  /** The partner's unit for this rate, when not the code's default. */
  unit?: string;
}
export interface PartnerRateSheet {
  id: string;
  partner_kind: PartnerKind;
  partner_id: string;
  mode: string;
  route: string;
  origin: string | null;
  destination: string | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  /** The basis the partner quotes on (EXW, FOB …) — decides which of their
   *  sections the sheet prices (0125). */
  incoterm: string | null;
  lines: Record<string, PartnerSheetLine>;
  created_at: string;
  updated_at: string;
}
export type PartnerRateSheetDraft = Omit<PartnerRateSheet, "id" | "created_at" | "updated_at">;

export type TariffBuySource = PartnerKind | "manual";
/** One code on a tier rate sheet. */
export interface TariffSheetLine {
  source: TariffBuySource;
  /** Manual buy (source "manual"); otherwise the partner's rate is used live. */
  buy: number | null;
  /** Currency of a manual buy — defaults to the code's currency. */
  cur?: LineCurrency;
  /** Overrides of the code's default description / unit (as on a quote). */
  description?: string;
  unit?: string;
  /** Section, when not the code's own (warehousing codes on Cartage). */
  category?: ChargeCategory;
  /** null = the sheet's tier margin. */
  margin: number | null;
  /** Sell (R) for sell-only codes (FW-01 / IN-01 / DIS-01 / CU-05 ...). */
  sell: number | null;
}
export interface TariffSheet {
  id: string;
  tier: RateTierId;
  mode: string;
  route: string;
  origin: string | null;
  destination: string | null;
  valid_from: string | null;
  valid_until: string | null;
  margin: number;
  agent_id: string | null;
  agent_sheet_id: string | null;
  transporter_id: string | null;
  transporter_sheet_id: string | null;
  clearing_agent_id: string | null;
  clearing_agent_sheet_id: string | null;
  destination_agent_id: string | null;
  destination_agent_sheet_id: string | null;
  notes: string | null;
  lines: Record<string, TariffSheetLine>;
  created_at: string;
  updated_at: string;
}
export type TariffSheetDraft = Omit<TariffSheet, "id" | "created_at" | "updated_at">;

/* ---------- Partner portal (migration 0121) ---------- */

export interface PartnerInvite {
  token: string;
  partner_kind: PartnerKind;
  partner_id: string;
  email: string;
  created_at: string;
  claimed_at: string | null;
}
export interface PartnerUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  created_at: string;
  last_sign_in_at: string | null;
}
export interface MyPartner {
  partner_kind: PartnerKind;
  partner_id: string;
  company: string | null;
  /** Coverage modes handled (0126) — the portal's rate sheets offer only these. */
  modes?: string[] | null;
  /** Coverage countries (0127) — each offers a "<country> → South Africa" route. */
  countries?: string[] | null;
  /** Coverage ports + notes (0131), for the portal's own coverage editor. */
  ports?: string[] | null;
  coverage_notes?: string | null;
}
export interface PartnerRateSheetChange {
  id: string;
  sheet_id: string;
  action: "insert" | "update" | "delete";
  changed_by_email: string | null;
  changed_at: string;
  old_row: PartnerRateSheet | null;
  new_row: PartnerRateSheet | null;
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
  /** Manual CBM override. Blank/null → derived from L×W×H. */
  cbm?: number | string | null;
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
  /** true once an operator hand-edits qty on a line whose qty would
   *  otherwise be derived (weight/volume unit, or a code-driven rule). */
  qty_override?: boolean;
  /** Percentage for a %-of-something fee line (FW-01, DIS-01). null = use the
   *  code's default rate. */
  fee_rate?: number | string | null;
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
  /** System shipment number (AIR/SEA/CX/RDX + 6 digits) — never changes. */
  reference: string;
  /** Operator-typed customer reference / customer PO for this enquiry. */
  customer_reference: string | null;
  client_id: string | null;
  /** Set instead of client_id when the customer is a not-yet-promoted lead. */
  lead_id: string | null;
  /** Attributed sales rep — a Sales CRM concept, independent of lead_id. */
  sales_person_id: string | null;
  supplier_id: string | null;
  /** Who the goods are delivered to, when different from the paying
   *  Customer/Importer (client_id) — e.g. the customer's own customer.
   *  Unset falls back to the Customer everywhere it's shown. */
  consignee_id: string | null;
  /** Set instead of consignee_id when the delivery point is a not-yet-promoted lead. */
  consignee_lead_id: string | null;
  /** Agent / transporter / clearing agent — internal only, never shown to the customer. */
  agent_id: string | null;
  transporter_id: string | null;
  clearing_agent_id: string | null;
  /** Destination handling agent (0124) — internal only. */
  destination_agent_id?: string | null;
  mode: QuoteMode;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  delivery_terms: string | null;
  valid_until: string | null;
  status: QuoteStatus;
  accepted_at: string | null;
  /** Customer Portal request / decision (0141). */
  portal_requested_at?: string | null;
  request_ready_date?: string | null;
  request_pickup?: string | null;
  request_delivery?: string | null;
  request_notes?: string | null;
  portal_decision?: "accepted" | "declined" | null;
  portal_decided_at?: string | null;
  portal_decline_reason?: string | null;
  /** First time the quote reached Sent / Not Proceeding — stamped by
   *  trigger (migration 0111); null on quotes from before it. */
  sent_at?: string | null;
  lost_at?: string | null;
  /** TEMP (0052): manual Opportunities-board value while the old CRM is
   *  migrated. NULL → the board uses the computed quotation total. */
  opportunity_value: number | null;
  commercial_value: number | null;
  insurance_amount: number | null;
  vessel_name: string | null;
  /** Sea Freight voyage number (migration 0107) — printed on shipment docs. */
  voyage_no?: string | null;
  /** Rate tier + tier sheet the quote was priced from (migration 0119). */
  rate_tier?: RateTierId | null;
  tariff_sheet_id?: string | null;
  /** Air Freight routing / transit time (migration 0108) — printed on shipment docs. */
  routing?: string | null;
  transit_time?: string | null;
  mbl_no: string | null;
  hbl_no: string | null;
  container_no: string | null;
  /** e.g. "1x 20GP", "2x 40HC" — Sea Freight only. */
  container_type: string | null;
  etd: string | null;
  eta: string | null;
  provisional_delivery_date: string | null;
  incoterms: string | null;
  mawb_no: string | null;
  hawb_no: string | null;
  flight_no: string | null;
  flight_date: string | null;
  carrier_name: string | null;
  /** Carrier / shipping line — seeds the shipment's Carrier column. */
  shipping_line: string | null;
  fx_usd_zar: number;
  fx_cny_zar: number;
  fx_eur_zar: number;
  /** GBP -> ZAR (migration 0113); 0 = GBP not used on this quote. */
  fx_gbp_zar?: number;
  /** When set, the customer-facing Sell/Total figures display converted
   *  into this currency instead of ZAR (same fx rate as above). Null = ZAR. */
  sell_currency: LineCurrency | null;
  /** Currency Commercial Value / Insurance Amount were captured in — they're
   *  customer-supplied and not always ZAR. Defaults to 'ZAR'. */
  value_currency: LineCurrency;
  /** Internal follow-up notes on this quote (not shown to the customer). */
  notes: string | null;
  created_at: string;
  updated_at: string;
  quote_lines: QuoteLine[];
  packing_list_items: PackingItem[];
  client?: Pick<Client, "id" | "company" | "email"> | null;
  /** Set instead of `client` when the quote is against a not-yet-promoted lead. */
  lead?: Pick<
    Lead,
    "id" | "company" | "contact" | "email" | "phone" | "address" | "vat_no"
  > | null;
  supplier?: (Pick<Supplier, "id" | "company"> & { email?: string | null }) | null;
  consignee?: Pick<Client, "id" | "company"> | null;
  /** Set instead of `consignee` when the delivery point is a not-yet-promoted lead. */
  consignee_lead?: Pick<Lead, "id" | "company"> | null;
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
  hs_code: string;
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
  /** Ops-only remarks — never shown in the app UI other than pre-filling
   *  the Remarks line on Document Vault print documents. */
  ops_remarks: string | null;
  awb_mbl: string | null;
  /** Ocean container number (air jobs track on awb_mbl). */
  container_no: string | null;
  /** e.g. "1x 20GP", "2x 40HC" — Sea Freight only. */
  container_type: string | null;
  /** Sea Freight details for the customer update email; persist on the board. */
  shipping_line: string | null;
  vessel_name: string | null;
  provisional_delivery_date: string | null;
  /** Date invoiced (migration 0110) — null = not yet invoiced. Entered by
   *  hand for now; a future Sage Accounting sync fills it. */
  invoiced_at?: string | null;
  invoice_no?: string | null;
  /** Carrier / airline name, seeded from the quote; shown on the board. */
  carrier_name: string | null;
  /** Carrier SCAC — set for a bill-of-lading tracking registration. */
  scac: string | null;
  etd: string | null;
  eta: string | null;
  created_at: string;
  client?:
    | (Pick<Client, "id" | "company"> & {
        email?: string | null;
        contact?: string | null;
        address?: string | null;
        phone?: string | null;
        company_phone?: string | null;
      })
    | null;
  supplier?:
    | (Pick<Supplier, "id" | "company"> & {
        email?: string | null;
        contact?: string | null;
        address?: string | null;
        phone?: string | null;
      })
    | null;
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
    | "invoiced_at"
    | "invoice_no"
    | "ops_remarks"
    | "awb_mbl"
    | "container_no"
    | "container_type"
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
  /** Only meaningful for direction='in' (a customer reply) — null = unread. */
  read_at: string | null;
}

export type MessagePatch = Partial<
  Pick<Message, "status" | "provider_id" | "error" | "sent_at">
>;

/** Quotation Comms — mirrors Message, but linked to a quote instead of a
 *  job (its own quote_messages table, kept parallel rather than a nullable
 *  dual-purpose FK on the job-only messages table). */
export interface QuoteMessage {
  id: string;
  quote_id: string;
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
  /** Only meaningful for direction='in' (a customer reply) — null = unread. */
  read_at: string | null;
}

export type QuoteMessagePatch = Partial<
  Pick<QuoteMessage, "status" | "provider_id" | "error" | "sent_at">
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
  /** Optional time of day, "HH:MM:SS" from Postgres (migration 0109). */
  due_time?: string | null;
  job_id: string | null;
  quote_id: string | null;
  client_id: string | null;
  lead_id: string | null;
  supplier_id: string | null;
  /** Partner links (migration 0117). */
  agent_id?: string | null;
  transporter_id?: string | null;
  clearing_agent_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  assigned_to: string | null;
  /** Set when this task was created from the Notifications tab — traces it
   *  back to the notification that prompted it. */
  source_notification_key: string | null;
  /** Joined for display. */
  job?: Pick<Job, "id" | "reference"> | null;
  quote?: Pick<Quote, "id" | "reference"> | null;
  client?: Pick<Client, "id" | "company"> | null;
  lead?: Pick<Lead, "id" | "company"> | null;
  supplier?: Pick<Supplier, "id" | "company"> | null;
  agent?: Pick<Agent, "id" | "company"> | null;
  transporter?: Pick<Agent, "id" | "company"> | null;
  clearing_agent?: Pick<Agent, "id" | "company"> | null;
  assignee?: Pick<Profile, "id" | "full_name"> | null;
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
    | "due_time"
    | "job_id"
    | "quote_id"
    | "client_id"
    | "lead_id"
    | "supplier_id"
    | "agent_id"
    | "transporter_id"
    | "clearing_agent_id"
    | "done_at"
    | "assigned_to"
    | "source_notification_key"
  >
>;

/** Shared/team-wide read+archive state for one computed Notifications feed
 *  item, keyed by that item's stable synthetic id (e.g. "lead-<uuid>"). The
 *  notification itself isn't a stored row -- only this interaction state is. */
export interface NotificationState {
  notification_key: string;
  read_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

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
  /** Legacy ShipsGo id — kept for old rows, no longer written. */
  shipsgo_id: string | null;
  /** Tracking provider (e.g. "terminal49"). */
  provider: string | null;
  /** The provider's shipment id, reused on every push. */
  provider_ref: string | null;
  /** Registration lifecycle: pending | registered | failed. */
  tracking_status: string | null;
  registered_at: string | null;
  status: string | null;
  pol: string | null;
  pod: string | null;
  etd: string | null;
  eta: string | null;
  /** Precise carrier ETA / actual arrival at the port of discharge. */
  pod_eta: string | null;
  pod_ata: string | null;
  vessel_name: string | null;
  vessel_imo: string | null;
  voyage: string | null;
  pol_lat: number | null;
  pol_lon: number | null;
  pod_lat: number | null;
  pod_lon: number | null;
  vessel_lat: number | null;
  vessel_lon: number | null;
  position_at: string | null;
  last_event: string | null;
  /** Legacy blob — new events land in the tracking_events table. */
  movements: TrackingMovement[];
  raw: unknown;
  synced_at: string | null;
  created_at: string;
}

export interface TrackingEvent {
  id: string;
  job_id: string;
  provider: string;
  provider_event_id: string | null;
  event_code: string | null;
  description: string | null;
  location: string | null;
  locode: string | null;
  lat: number | null;
  lon: number | null;
  vessel_name: string | null;
  voyage: string | null;
  occurred_at: string | null;
  is_actual: boolean;
  created_at: string;
}

/** Portal-safe tracking view (client_job_tracking) — no internal fields. */
export interface ClientJobTracking {
  job_id: string;
  status: string | null;
  carrier: string | null;
  pol: string | null;
  pod: string | null;
  etd: string | null;
  eta: string | null;
  pod_eta: string | null;
  pod_ata: string | null;
  last_event: string | null;
  vessel_name: string | null;
  voyage: string | null;
  pol_lat: number | null;
  pol_lon: number | null;
  pod_lat: number | null;
  pod_lon: number | null;
  vessel_lat: number | null;
  vessel_lon: number | null;
  position_at: string | null;
  synced_at: string | null;
}

export interface ClientTrackingEvent {
  id: string;
  job_id: string;
  event_code: string | null;
  description: string | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
  vessel_name: string | null;
  voyage: string | null;
  occurred_at: string | null;
  is_actual: boolean;
}

/** Public, unauthenticated shipment lookup (track_shipment RPC) —
 *  expac.co.za/live-tracking, search by our shipment number, no login. */
export interface TrackedShipmentEvent {
  event_code: string | null;
  description: string | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
  vessel_name: string | null;
  voyage: string | null;
  occurred_at: string | null;
  is_actual: boolean;
}
export interface TrackedShipment {
  reference: string;
  mode: string;
  customer: string | null;
  status: string | null;
  carrier: string | null;
  vessel_name: string | null;
  voyage: string | null;
  pol: string | null;
  pod: string | null;
  pol_lat: number | null;
  pol_lon: number | null;
  pod_lat: number | null;
  pod_lon: number | null;
  vessel_lat: number | null;
  vessel_lon: number | null;
  position_at: string | null;
  etd: string | null;
  eta: string | null;
  last_event: string | null;
  shipper: string | null;
  customer_ref: string | null;
  pdd: string | null;
  qty: number | null;
  cw_kg: number | null;
  ttl_vol: number | null;
  events: TrackedShipmentEvent[];
}

/** Draft shape used by the quote builder before a row exists in the DB. */
export interface QuoteDraft {
  id: string | null;
  reference: string;
  customer_reference: string;
  client_id: string;
  /** Set instead of client_id when the customer is a not-yet-promoted lead. */
  lead_id: string;
  sales_person_id: string;
  supplier_id: string;
  consignee_id: string;
  /** Set instead of consignee_id when the delivery point is a not-yet-promoted lead. */
  consignee_lead_id: string;
  agent_id: string;
  transporter_id: string;
  clearing_agent_id: string;
  destination_agent_id: string;
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
  voyage_no: string;
  rate_tier: RateTierId;
  tariff_sheet_id: string;
  routing: string;
  transit_time: string;
  mbl_no: string;
  hbl_no: string;
  container_no: string;
  container_type: string;
  etd: string;
  eta: string;
  provisional_delivery_date: string;
  incoterms: string;
  mawb_no: string;
  hawb_no: string;
  flight_no: string;
  flight_date: string;
  carrier_name: string;
  shipping_line: string;
  fx_usd_zar: string;
  fx_cny_zar: string;
  fx_eur_zar: string;
  fx_gbp_zar: string;
  sell_currency: string;
  value_currency: string;
  packing: PackingItem[];
  lines: QuoteLine[];
}

/* ---------- Personal Vault (Control Tower) ---------- */

export type VaultBudgetScope = "personal" | "business";

export interface VaultBudgetEntry {
  id: string;
  user_id: string;
  kind: "income" | "expense";
  /** Which ledger this row belongs to — the Budget section's Personal /
   *  Business toggle filters on this. */
  scope: VaultBudgetScope;
  category: string | null;
  amount: number;
  /** Paid so far against `amount`, entered incrementally as instalments
   *  land through the month. `amount - amount_paid` is the balance due. */
  amount_paid: number;
  occurred_on: string;
  note: string | null;
  created_at: string;
}
export type VaultBudgetDraft = {
  kind: "income" | "expense";
  category: string;
  amount: string;
  amount_paid: string;
  occurred_on: string;
  note: string;
};

export interface VaultTodo {
  id: string;
  user_id: string;
  /** The expense name. */
  title: string;
  /** Forecasted amount, in rand. */
  forecasted: number;
  /** Account / place the money was transferred to (filled in later). */
  transferred_to: string | null;
  /** Which Budget ledger this expense belongs to. */
  scope: VaultBudgetScope;
  /** The vault_budget_entries row auto-created (and kept in sync) while
   *  this is transferred — null while it isn't. */
  linked_budget_entry_id: string | null;
  done: boolean;
  sort_order: number;
  created_at: string;
}
export type VaultExpenseDraft = {
  title: string;
  forecasted: string;
  transferred_to: string;
};

/** A private Notes & Calendar entry — same shape as the shared Control
 *  Tower ops_tasks, but never linked to a shipment/quote/customer and
 *  never visible outside Personal Vault. */
export interface VaultNote {
  id: string;
  user_id: string;
  /** Which Personal/Business side this belongs to — same toggle as Budget
   *  and Expense Control. */
  scope: VaultBudgetScope;
  kind: OpsTaskKind;
  title: string;
  body: string | null;
  status: OpsTaskStatus;
  priority: OpsTaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}
export type VaultNoteDraft = {
  kind: OpsTaskKind;
  title: string;
  body: string;
  status: OpsTaskStatus;
  priority: OpsTaskPriority;
  due_date: string;
};

/* ---------- Per-user table column layout ---------- */

export interface UiTableLayout {
  /** Ordered list of movable column keys. */
  order?: string[];
  /** Column key -> pixel width. */
  widths?: Record<string, number>;
  /** Active sort, if any. */
  sort?: { key: string; dir: "asc" | "desc" } | null;
  /** Movable column keys the user has hidden. */
  hidden?: string[];
}

/* ---------- Admin Inbox (migration 0134) ---------- */

/** Who the sender is, from the CRM: customer, supplier / agent, lead, ExPac
 *  itself (internal, 0135) or unknown. */
export type InboxCategory = "customer" | "partner" | "lead" | "unknown" | "internal";

/** inbox_messages_v — a support@ message (in) or a reply sent from the app (out). */
export interface InboxMessage {
  id: string;
  mailbox: string;
  uid: number | null;
  direction: "in" | "out";
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  thread_key: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_path: string | null;
  size_bytes: number | null;
  has_attachments: boolean;
  is_bulk: boolean;
  /** Synced from the mailbox's Junk / Spam folder, or marked Spam in the app (0136). */
  spam: boolean;
  /** "Mark unread" in the app — wins over the server's Seen flag until opened (0136). */
  marked_unread: boolean;
  /** Sent from the app: Resend's id + its latest delivery event (0136). */
  provider_id?: string | null;
  delivery_status?: string | null;
  sent_at: string;
  seen: boolean;
  answered: boolean;
  read_at: string | null;
  replied_at: string | null;
  done_at: string | null;
  job_id: string | null;
  job_linked_by: "auto" | "manual" | null;
  created_at: string;
  /** From the CRM match (view). */
  category: InboxCategory | null;
  record_kind: "client" | "supplier" | "agent" | "transporter" | "clearing_agent" | "destination_agent" | "lead" | null;
  record_id: string | null;
  record_name: string | null;
  job_reference: string | null;
}
export type InboxMessagePatch = Partial<
  Pick<
    InboxMessage,
    | "read_at"
    | "replied_at"
    | "done_at"
    | "job_id"
    | "job_linked_by"
    | "snippet"
    | "body_text"
    | "spam"
    | "marked_unread"
  >
>;
export interface InboxState {
  mailbox: string;
  last_sync_at: string | null;
  last_error: string | null;
  pending: number | null;
}

/** inbox_sent_v (0136) — everything sent from the app, with delivery status. */
export interface SentMail {
  id: string;
  source: "inbox" | "shipment" | "quote";
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  preview: string;
  body: string | null;
  sent_at: string;
  /** saved | queued | sent | delivered | opened | clicked | bounced | failed */
  status: string;
  error: string | null;
  job_id: string | null;
  job_reference: string | null;
  quote_id: string | null;
  quote_reference: string | null;
}
