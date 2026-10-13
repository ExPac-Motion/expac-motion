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

/* ---------- Masters & Houses board (0165) ---------- */

export interface BoardHouse extends JobHouse {
  cargo_ready_date: string | null;
  hbl_issued_at: string | null;
  loaded_at: string | null;
  supplier: { id: string; company: string; email: string | null; contact: string | null } | null;
  job: {
    id: string;
    reference: string;
    mode: string;
    milestone: string;
    shipment_status: string | null;
    etd: string | null;
    eta: string | null;
    awb_mbl: string | null;
    container_no: string | null;
    quote_id: string | null;
    client_id: string | null;
    client: { id: string; company: string; email: string | null } | null;
  } | null;
}
export interface BoardReceipt {
  id: string;
  receipt_no: string;
  house_id: string;
  pieces: number;
  gross_kg: number;
  volume_cbm: number;
  received_at: string;
}
export interface BoardDoc {
  id: string;
  house_id: string;
  doc_type: string | null;
}
export interface QuotedCargo {
  quote_id: string;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  actual_kg: number | string;
  qty_ctns: number | string;
  cbm: number | string | null;
  position: number;
}

export function useMastersBoard() {
  return useQuery({
    queryKey: ["job_houses", "board"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const houses = unwrap<BoardHouse[]>(
        (await supabase
          .from("job_houses")
          .select(
            "*, supplier:suppliers(id, company, email, contact), job:jobs(id, reference, mode, milestone, shipment_status, etd, eta, awb_mbl, container_no, quote_id, client_id, client:clients(id, company, email))",
          )
          .order("position")) as never,
      );
      const ids = houses.map((h) => h.id);
      const quoteIds = [...new Set(houses.map((h) => h.job?.quote_id).filter(Boolean))] as string[];
      const [receipts, docs, quoted] = await Promise.all([
        ids.length
          ? unwrap<BoardReceipt[]>(
              await supabase
                .from("wms_receipts")
                .select("id, receipt_no, house_id, pieces, gross_kg, volume_cbm, received_at")
                .in("house_id", ids),
            )
          : [],
        ids.length
          ? unwrap<BoardDoc[]>(await supabase.from("shipment_documents").select("id, house_id, doc_type").in("house_id", ids))
          : [],
        quoteIds.length
          ? unwrap<QuotedCargo[]>(
              await supabase
                .from("packing_list_items")
                .select("quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns, cbm")
                .in("quote_id", quoteIds),
            )
          : [],
      ]);
      return { houses, receipts, docs, quoted };
    },
  });
}

export function useUpdateHouseSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      patch: Partial<Pick<BoardHouse, "cargo_ready_date" | "hbl_issued_at" | "loaded_at">>;
    }) => unwrap(await supabase.from("job_houses").update(v.patch).eq("id", v.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job_houses"] }),
  });
}

export type HouseStatus = "Awaiting cargo" | "Received" | "Documents complete" | "HBL issued" | "Loaded";
export const HOUSE_STATUS_CLASS: Record<HouseStatus, string> = {
  "Awaiting cargo": "hs-wait",
  Received: "hs-recv",
  "Documents complete": "hs-docs",
  "HBL issued": "hs-bill",
  Loaded: "hs-loaded",
};
export function houseStatus(h: BoardHouse, received: boolean, docsComplete: boolean): HouseStatus {
  if (h.loaded_at) return "Loaded";
  if (h.hbl_issued_at) return "HBL issued";
  if (received && docsComplete) return "Documents complete";
  if (received) return "Received";
  return "Awaiting cargo";
}
