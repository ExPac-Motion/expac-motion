/**
 * Partner Portal › Shipments (migration 0243): the shipments a partner login
 * (agent / transporter / clearing agent / destination agent) is assigned to,
 * read and updated only through SECURITY DEFINER functions that return their
 * own leg (no customer, sell rates, margin or other partners).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { PackingItem, PartnerKind } from "./types";

const DOCS_BUCKET = "shipment-documents";

export interface PartnerShipmentRow {
  id: string;
  reference: string;
  shipment_kind: string | null;
  master_reference: string | null;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  shipment_status: string | null;
  ready_date: string | null;
  etd: string | null;
  eta: string | null;
  delivery_date: string | null;
  awb_mbl: string | null;
  container_no: string | null;
  vessel_name?: string | null;
  /** Latest position (0244), for the dashboard map. */
  tracking?: {
    vessel_lat: number | null;
    vessel_lon: number | null;
    position_at: string | null;
    pol_lat: number | null;
    pol_lon: number | null;
    pod_lat: number | null;
    pod_lon: number | null;
    status: string | null;
  } | null;
  completed: boolean;
  unread: number;
  action: string | null;
}

export interface PartnerParty {
  company?: string | null;
  address: string | null;
  contact: string | null;
  phone: string | null;
  email?: string | null;
}

export interface PartnerCharge {
  category: string;
  code: string | null;
  description: string;
  unit: string | null;
  cur: string;
  rate: number;
  qty: number | null;
}

export interface PartnerDocument {
  id: string;
  name: string;
  doc_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
  mine: boolean;
}

export interface PartnerMessage {
  id: string;
  direction: "in" | "out";
  body: string;
  created_at: string;
}

export interface PartnerTracking {
  vessel_name: string | null;
  voyage: string | null;
  status: string | null;
  vessel_lat: number | null;
  vessel_lon: number | null;
  position_at: string | null;
  speed_kn: number | null;
  pol_lat: number | null;
  pol_lon: number | null;
  pod_lat: number | null;
  pod_lon: number | null;
  pol: string | null;
  pod: string | null;
  eta: string | null;
  etd: string | null;
  atd: string | null;
  pod_ata: string | null;
  pod_eta: string | null;
  synced_at: string | null;
}

export interface PartnerShipment {
  id: string;
  partner_kind: PartnerKind;
  reference: string;
  shipment_kind: string | null;
  master_reference: string | null;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  delivery_terms: string | null;
  commodity: string | null;
  container_type: string | null;
  shipment_status: string | null;
  ready_date: string | null;
  etd: string | null;
  eta: string | null;
  delivery_date: string | null;
  carrier_name?: string | null;
  shipping_line?: string | null;
  vessel_name?: string | null;
  voyage_no?: string | null;
  awb_mbl?: string | null;
  container_no: string | null;
  seal_no?: string | null;
  pod_signed_by: string | null;
  pod_delivered_at: string | null;
  completed: boolean;
  notes: string | null;
  customs_stage?: string | null;
  customs_released?: boolean;
  entry_no?: string | null;
  pickup?: PartnerParty;
  delivery?: PartnerParty;
  packing: PackingItem[];
  charges: PartnerCharge[];
  documents: PartnerDocument[];
  timeline: { step: string; done: boolean; planned_date: string | null; actual_date: string | null }[];
  messages: PartnerMessage[];
  tracking: PartnerTracking | null;
  history: { at: string; status: string }[];
}

/** Statuses each partner kind may set (same lists as partner_update_shipment). */
export const PARTNER_STATUSES: Record<PartnerKind, string[]> = {
  agent: ["Booked", "Collected", "Received", "Loaded", "Departed"],
  transporter: ["Collected", "On-Delivery", "Delivered"],
  destination_agent: ["Arrived", "Unloaded", "On-Delivery", "Delivered"],
  clearing_agent: [],
};

/** Document types each partner kind may upload (partner_add_document). */
export const PARTNER_DOC_TYPES: Record<PartnerKind, string[]> = {
  agent: ["Bill of Lading / AWB", "HBL", "HAWB", "Commercial Invoice", "Packing List", "Certificate of Origin", "Supplier Invoice", "Photos", "Other"],
  transporter: ["Proof of Delivery", "Delivery Note", "Supplier Invoice", "Photos", "Other"],
  destination_agent: ["Arrival Notification (ANF)", "Proof of Delivery", "Delivery Note", "Supplier Invoice", "Photos", "Other"],
  clearing_agent: ["Customs Release Note", "Customs Entry", "Duty / VAT Invoice", "Customs", "Supplier Invoice", "Other"],
};

export interface PartnerUpdate {
  status?: string;
  carrier_name?: string;
  shipping_line?: string;
  vessel_name?: string;
  voyage_no?: string;
  awb_mbl?: string;
  container_no?: string;
  seal_no?: string;
  etd?: string;
  eta?: string;
  pod_signed_by?: string;
  pod_delivered_at?: string;
  delay_reason?: string;
  delay_date?: string;
  note?: string;
}

function fail(error: unknown): never {
  const msg = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "Request failed";
  throw new Error(msg);
}

/** True when the 0243 functions aren't on the database yet. */
export function isMissingPartnerShipments(e: unknown): boolean {
  return e instanceof Error && /partner_shipments|could not find the function|schema cache/i.test(e.message);
}

export async function listPartnerShipments(): Promise<PartnerShipmentRow[]> {
  const { data, error } = await supabase.rpc("partner_shipments");
  if (error) fail(error);
  return (data ?? []) as PartnerShipmentRow[];
}

export async function getPartnerShipment(id: string): Promise<PartnerShipment> {
  const { data, error } = await supabase.rpc("partner_shipment", { p_job: id });
  if (error) fail(error);
  // Opening it marks ExPac's messages read; not worth failing over.
  void supabase.rpc("partner_mark_read", { p_job: id });
  return data as PartnerShipment;
}

export async function updatePartnerShipment(id: string, patch: PartnerUpdate): Promise<void> {
  const { error } = await supabase.rpc("partner_update_shipment", { p_job: id, p: patch });
  if (error) fail(error);
}

export async function sendPartnerMessage(id: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("partner_send_message", { p_job: id, p_body: body });
  if (error) fail(error);
}

export async function uploadPartnerDocument(id: string, file: File, docType: string): Promise<void> {
  const safe = file.name.replace(/[^\w.() -]+/g, "_");
  const path = `partner/${id}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
  if (up.error) fail(up.error);
  const { error } = await supabase.rpc("partner_add_document", {
    p_job: id,
    p_name: file.name,
    p_path: path,
    p_doc_type: docType,
    p_size: file.size,
  });
  if (error) {
    await supabase.storage.from(DOCS_BUCKET).remove([path]);
    fail(error);
  }
}

export function usePartnerShipments(enabled = true) {
  return useQuery({ queryKey: ["partner_shipments"], queryFn: listPartnerShipments, enabled, retry: false });
}

export function usePartnerShipment(id: string | null) {
  return useQuery({
    queryKey: ["partner_shipment", id],
    queryFn: () => getPartnerShipment(id!),
    enabled: !!id && id !== "demo",
    retry: false,
  });
}

/** A partner-side mutation that refreshes the list and the open shipment. */
export function usePartnerMutation<A>(fn: (a: A) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner_shipments"] });
      qc.invalidateQueries({ queryKey: ["partner_shipment"] });
    },
  });
}

/* ---------------- ExPac side (staff) ---------------- */

const PARTNER_TABLE: Record<PartnerKind, string> = {
  agent: "agents",
  transporter: "transporters",
  clearing_agent: "clearing_agents",
  destination_agent: "destination_agents",
};

/** One partner on a shipment's leg, as staff see it. */
export interface JobPartner {
  kind: PartnerKind;
  id: string;
  company: string;
  email: string | null;
  contact: string | null;
  phone: string | null;
  /** A confirmed Partner Portal login exists for this partner. */
  hasLogin: boolean;
}

export interface JobPartnerMessage {
  id: string;
  job_id: string;
  partner_kind: PartnerKind;
  partner_id: string;
  direction: "in" | "out";
  body: string;
  created_at: string;
  read_at: string | null;
}

/** The partners on a shipment, from its quote (the customs file's clearing
 *  agent wins over the quote's). Same rule as partner_job_ids() in 0243. */
export async function loadJobPartners(input: {
  jobId: string;
  masterJobId?: string | null;
  quote: { agent_id: string | null; transporter_id: string | null; clearing_agent_id: string | null; destination_agent_id?: string | null } | null;
}): Promise<JobPartner[]> {
  const q = input.quote;
  const ids: Partial<Record<PartnerKind, string | null>> = {
    agent: q?.agent_id ?? null,
    destination_agent: q?.destination_agent_id ?? null,
    transporter: q?.transporter_id ?? null,
    clearing_agent: q?.clearing_agent_id ?? null,
  };
  const cf = await supabase
    .from("customs_files")
    .select("clearing_agent_id")
    .in("job_id", [input.jobId, input.masterJobId].filter(Boolean) as string[])
    .not("clearing_agent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!cf.error && cf.data?.[0]?.clearing_agent_id) ids.clearing_agent = cf.data[0].clearing_agent_id as string;

  const kinds = (Object.keys(ids) as PartnerKind[]).filter((k) => ids[k]);
  if (kinds.length === 0) return [];
  const rows = await Promise.all(
    kinds.map(async (k) => {
      const { data } = await supabase.from(PARTNER_TABLE[k]).select("id,company,email,contact,phone").eq("id", ids[k]!).maybeSingle();
      return data ? ({ kind: k, ...(data as Omit<JobPartner, "kind" | "hasLogin">), hasLogin: false } as JobPartner) : null;
    }),
  );
  const found = rows.filter((r): r is JobPartner => !!r);
  const logins = await supabase
    .from("profiles")
    .select("partner_id")
    .eq("role", "partner")
    .in("partner_id", found.map((p) => p.id));
  const withLogin = new Set((logins.data ?? []).map((r) => r.partner_id as string));
  return found.map((p) => ({ ...p, hasLogin: withLogin.has(p.id) }));
}

export async function listJobPartnerMessages(jobId: string): Promise<JobPartnerMessage[]> {
  const { data, error } = await supabase
    .from("job_partner_messages")
    .select("id,job_id,partner_kind,partner_id,direction,body,created_at,read_at")
    .eq("job_id", jobId)
    .order("created_at");
  if (error) fail(error);
  return (data ?? []) as JobPartnerMessage[];
}

export async function sendStaffPartnerMessage(input: { jobId: string; kind: PartnerKind; partnerId: string; body: string }): Promise<void> {
  const { error } = await supabase.from("job_partner_messages").insert({
    job_id: input.jobId,
    partner_kind: input.kind,
    partner_id: input.partnerId,
    direction: "out",
    body: input.body,
  });
  if (error) fail(error);
}

/** Staff opened the thread: the partner's messages are read. */
export async function markPartnerMessagesRead(jobId: string, partnerId: string): Promise<void> {
  await supabase
    .from("job_partner_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("partner_id", partnerId)
    .eq("direction", "in")
    .is("read_at", null);
}

export function useJobPartners(input: Parameters<typeof loadJobPartners>[0] | null) {
  return useQuery({
    queryKey: ["job_partners", input?.jobId, input?.quote],
    queryFn: () => loadJobPartners(input!),
    enabled: !!input && input.jobId !== "demo",
  });
}

export function useJobPartnerMessages(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job_partner_messages", jobId],
    queryFn: () => listJobPartnerMessages(jobId!),
    enabled: !!jobId && jobId !== "demo",
    retry: false,
  });
}

export function useStaffPartnerMutation<A>(fn: (a: A) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job_partner_messages"] }),
  });
}

/* ---------------- Requests for Quote sent to this partner (0244) ---------------- */

export interface PartnerRfq {
  id: string;
  token: string;
  rfq_number: string;
  reference: string;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  reply_by: string | null;
  sent_at: string;
  status: "awaiting" | "received" | "used" | "not_used" | "declined";
  responded_at: string | null;
  validity: string | null;
  transit_time: string | null;
  remarks: string | null;
  rates: { code: string | null; description: string; unit: string | null; cur: string; rate: number | null; min_charge: number | null; remarks: string | null }[];
}

/** How a request reads to the partner. */
export function partnerRfqStatus(r: Pick<PartnerRfq, "status" | "reply_by">): { label: string; tone: string } {
  const overdue = r.status === "awaiting" && !!r.reply_by && r.reply_by < new Date().toISOString().slice(0, 10);
  if (overdue) return { label: "Reply overdue", tone: "warn" };
  switch (r.status) {
    case "awaiting":
      return { label: "Waiting for your rates", tone: "amber" };
    case "received":
      return { label: "Rates sent, with ExPac", tone: "teal" };
    case "used":
      return { label: "Your rates were used", tone: "green" };
    case "not_used":
      return { label: "Not selected this time", tone: "muted" };
    default:
      return { label: "You declined", tone: "muted" };
  }
}

export async function listPartnerRfqs(): Promise<PartnerRfq[]> {
  const { data, error } = await supabase.rpc("partner_rfqs");
  if (error) fail(error);
  return (data ?? []) as PartnerRfq[];
}

export function usePartnerRfqs(enabled = true) {
  return useQuery({ queryKey: ["partner_rfqs"], queryFn: listPartnerRfqs, enabled, retry: false });
}
