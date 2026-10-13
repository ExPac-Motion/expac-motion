// Master shipments with houses (migration 0164): one shipment / quote
// number (SEA160984) carrying several houses, SEA160984-1, -2 ..., one per
// supplier, each with its own specs and house bill.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export interface JobHouse {
  id: string;
  job_id: string;
  position: number;
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
}
export type JobHouseInput = Omit<JobHouse, "id" | "job_id" | "position" | "house_no">;

/** Portal shape (client_job_houses): the supplier's name instead of its id. */
export interface ClientJobHouse {
  id: string;
  job_id: string;
  position: number;
  house_no: string;
  supplier_company: string | null;
  pieces: number;
  gross_kg: number;
  volume_cbm: number;
  commodity: string | null;
  commercial_value: number | null;
  value_currency: string | null;
  carrier_house_no: string | null;
}

export function houseTotals(houses: { pieces: number; gross_kg: number; volume_cbm: number }[]) {
  return houses.reduce(
    (t, h) => ({
      pieces: t.pieces + (Number(h.pieces) || 0),
      kg: t.kg + (Number(h.gross_kg) || 0),
      cbm: t.cbm + (Number(h.volume_cbm) || 0),
    }),
    { pieces: 0, kg: 0, cbm: 0 },
  );
}

/* ---------- Motion ---------- */

export function useJobHouses(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job_houses", jobId],
    enabled: !!jobId,
    queryFn: async () =>
      unwrap<JobHouse[]>(
        await supabase.from("job_houses").select("*").eq("job_id", jobId as string).order("position"),
      ),
  });
}

export function useSaveJobHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jobId: string; id?: string; position?: number; input: JobHouseInput }) => {
      if (v.id) {
        unwrap(await supabase.from("job_houses").update(v.input).eq("id", v.id));
      } else {
        unwrap(
          await supabase.from("job_houses").insert({ ...v.input, job_id: v.jobId, position: v.position ?? 0 }),
        );
      }
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["job_houses", v.jobId] }),
  });
}

export function useDeleteJobHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; jobId: string }) =>
      unwrap(await supabase.from("job_houses").delete().eq("id", v.id)),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["job_houses", v.jobId] });
      qc.invalidateQueries({ queryKey: ["shipment_documents", v.jobId] });
    },
  });
}

/** Puts a shipment document on a house (null = the master). */
export function useSetDocumentHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { docId: string; jobId: string; houseId: string | null }) =>
      unwrap(await supabase.from("shipment_documents").update({ house_id: v.houseId }).eq("id", v.docId)),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["shipment_documents", v.jobId] }),
  });
}

/* ---------- Portal ---------- */

export function useMyJobHouses(jobId: string | undefined) {
  return useQuery({
    queryKey: ["my_job_houses", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const r = await supabase.from("client_job_houses").select("*").eq("job_id", jobId as string).order("position");
      if (r.error) return [] as ClientJobHouse[]; // before 0164 is applied
      return (r.data ?? []) as ClientJobHouse[];
    },
  });
}
