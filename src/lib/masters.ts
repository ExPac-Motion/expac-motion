// Shipments as Direct, Master or House (migration 0223). A house is a full
// shipment under a master of the same customer; its house number comes from
// the master (HBL161005-1 / HAWB161005-1, set by the database). The master
// is billed on its houses' cargo.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshShipmentData } from "./hooks";
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
