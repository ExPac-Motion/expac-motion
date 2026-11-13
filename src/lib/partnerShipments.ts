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
