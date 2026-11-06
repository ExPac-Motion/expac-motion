// Shipments as Direct, Master or House (migration 0223). A house is a full
// shipment under a master of the same customer; its house number comes from
// the master (HBL161005-1 / HAWB161005-1, set by the database). The master
// is billed on its houses' cargo.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptQuote, getQuote, saveQuote } from "./db";
import { refreshShipmentData } from "./hooks";
import { duplicateQuoteDraft } from "./quoteDraft";
import { supabase } from "./supabase";
import type { Job, ShipmentKind } from "./types";

export const KIND_LABEL: Record<ShipmentKind, string> = {
  direct: "Direct",
  master: "Master",
  house: "House",
};

/** Before 0223 the column is missing: everything reads as Direct. */
export const kindOf = (j: Pick<Job, "shipment_kind" | "master_job_id">): ShipmentKind =>
  j.master_job_id ? "house" : (j.shipment_kind ?? "direct");

/** Sea or air: only those carry house bills (courier / road stay Direct). */
export const canConsol = (mode: string | null | undefined) =>
  !!mode && (mode.startsWith("Sea") || mode.startsWith("Air"));

/** Same family of transport: air houses on air masters, sea on sea. */
export const sameFamily = (a: string | null | undefined, b: string | null | undefined) =>
  canConsol(a) && canConsol(b) && (a ?? "").startsWith("Air") === (b ?? "").startsWith("Air");

function fail(error: unknown): never {
  const msg = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "Request failed";
  throw new Error(msg);
}

/** Puts shipments on a master (null = take them off, back to Direct). One at
 *  a time so each gets the next house number. */
export async function setMaster(jobIds: string[], masterId: string | null) {
  for (const id of jobIds) {
    const { error } = await supabase.from("jobs").update({ master_job_id: masterId }).eq("id", id);
    if (error) fail(error);
  }
}

/** Marks a shipment Master (no houses yet) or back to Direct. */
export async function setKind(jobId: string, kind: "direct" | "master") {
  const { error } = await supabase.from("jobs").update({ shipment_kind: kind }).eq("id", jobId);
  if (error) fail(error);
}

export function useSetMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jobIds: string[]; masterId: string | null; makeMaster?: string }) => {
      if (v.makeMaster) await setKind(v.makeMaster, "master");
      await setMaster(v.jobIds, v.masterId);
    },
    onSuccess: () => {
      refreshShipmentData(qc);
      qc.invalidateQueries({ queryKey: ["job_houses"] });
    },
  });
}

export function useSetKind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { jobId: string; kind: "direct" | "master" }) => setKind(v.jobId, v.kind),
    onSuccess: () => refreshShipmentData(qc),
  });
}

/* ---------- Step 2: supplier houses (0164) -> house shipments ---------- */

export interface SupplierHouseLike {
  id: string;
  house_no: string;
  supplier_id: string | null;
  pieces: number;
  gross_kg: number;
  volume_cbm: number;
  commodity: string | null;
  commercial_value: number | null;
  value_currency: string | null;
  carrier_house_no: string | null;
  notes: string | null;
  cargo_ready_date?: string | null;
  hbl_issued_at?: string | null;
  loaded_at?: string | null;
  received_note?: string | null;
}

/** Turns one supplier house of a master into a house shipment: a copy of the
 *  master's quote (the house's supplier, cargo and value; no charges, the
 *  master is billed), accepted into a shipment, put on the master (house
 *  number HBL/HAWB from the master), and the house's receipts and documents
 *  moved over. The supplier house row is removed. Returns the new shipment id. */
export async function convertSupplierHouse(h: SupplierHouseLike, master: { id: string; quote_id: string | null }): Promise<string> {
  if (!master.quote_id) throw new Error("The master has no quotation to copy, create one first");
  const src = await getQuote(master.quote_id);
  const draft = duplicateQuoteDraft(src);
  const qty = Math.max(1, Math.round(Number(h.pieces) || 0));
  draft.supplier_id = h.supplier_id ?? "";
  draft.commodity = h.commodity || draft.commodity;
  draft.commercial_value = h.commercial_value != null ? String(h.commercial_value) : "";
  draft.value_currency = h.value_currency || draft.value_currency;
  draft.insurance_amount = "";
  draft.packing = [
    {
      position: 0,
      length_cm: 0,
      width_cm: 0,
      height_cm: 0,
      actual_kg: Math.round(((Number(h.gross_kg) || 0) / qty) * 100) / 100,
      qty_ctns: qty,
      cbm: Math.round(((Number(h.volume_cbm) || 0) / qty) * 1000) / 1000,
    },
  ];
  draft.lines = [];
  const quoteId = await saveQuote(draft);
  const jobId = await acceptQuote(quoteId);

  const kept = [
    h.carrier_house_no ? `Agent house bill: ${h.carrier_house_no}` : null,
    h.cargo_ready_date ? `Cargo ready ${h.cargo_ready_date}` : null,
    h.hbl_issued_at ? `House bill issued ${h.hbl_issued_at}` : null,
    h.loaded_at ? `Loaded ${h.loaded_at}` : null,
    h.received_note ? `Received at ${h.received_note}` : null,
    h.notes,
  ].filter(Boolean);
  const upd = await supabase
    .from("jobs")
    .update({ master_job_id: master.id, ...(kept.length ? { notes: `Was supplier house ${h.house_no}. ${kept.join(". ")}` } : {}) })
    .eq("id", jobId);
  if (upd.error) fail(upd.error);
  const rc = await supabase.from("wms_receipts").update({ job_id: jobId, house_id: null, job_hub_id: null }).eq("house_id", h.id);
  if (rc.error) fail(rc.error);
  const dc = await supabase.from("shipment_documents").update({ job_id: jobId, house_id: null, job_hub_id: null }).eq("house_id", h.id);
  if (dc.error) fail(dc.error);
  const del = await supabase.from("job_houses").delete().eq("id", h.id);
  if (del.error) fail(del.error);
  return jobId;
}

export function useConvertSupplierHouses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { houses: SupplierHouseLike[]; master: { id: string; quote_id: string | null } }) => {
      for (const h of v.houses) await convertSupplierHouse(h, v.master);
    },
    onSettled: () => {
      refreshShipmentData(qc);
      qc.invalidateQueries({ queryKey: ["job_houses"] });
      qc.invalidateQueries({ queryKey: ["wms"] });
      qc.invalidateQueries({ queryKey: ["shipment_documents"] });
    },
  });
}

export function useSetClearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jobId: string; basis: "master" | "house" | null }) => {
      const { error } = await supabase.from("jobs").update({ clearance_basis: v.basis }).eq("id", v.jobId);
      if (error) fail(error);
    },
    onSuccess: () => {
      refreshShipmentData(qc);
      qc.invalidateQueries({ queryKey: ["job_houses"] });
    },
  });
}
