// Shipments <-> Motion WMS sync (migration 0213). A shipment gets its hubs
// (Motion WMS warehouses) from its origin / destination; the database books
// it in and releases it as its status moves on, a receipt or release made in
// WMS moves the shipment's status on, and wms_hub_sync says per hub whether
// shipment, quote and warehouse agree.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type HubRole = "origin" | "destination" | "transit";
export type HubSyncState =
  | "waiting"
  | "in_sync"
  | "missing_receipt"
  | "still_in_hub"
  | "no_pieces"
  | "pieces_differ"
  | "kg_differ"
  | "ahead_of_status";

export interface HubSyncRow {
  hub_id: string;
  job_id: string;
  job_ref: string;
  client_id: string | null;
  shipment_status: string | null;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  position: number;
  role: HubRole;
  /** Added automatically from the shipment's origin / destination. */
  auto: boolean;
  want_in: boolean;
  want_out: boolean;
  receipt_id: string | null;
  receipt_no: string | null;
  received_at: string | null;
  receipt_pieces: number;
  receipt_kg: number;
  on_hand: number;
  released_at: string | null;
  quote_pieces: number | null;
  quote_kg: number | null;
  state: HubSyncState;
}

/** When each hub role books goods in / out (mirrors job_hub_expect in 0213). */
export const HUB_RULES: Record<HubRole, { label: string; inAt: string; outAt: string } | null> = {
  origin: { label: "Origin hub", inAt: "Collected / Received", outAt: "Departed" },
  destination: { label: "Destination hub", inAt: "Arrived / Unloaded", outAt: "On-Delivery / Delivered" },
  transit: null,
};

export const HUB_STATE: Record<HubSyncState, { label: string; tone: string }> = {
  waiting: { label: "Waiting", tone: "open" },
  in_sync: { label: "In sync", tone: "completed" },
  missing_receipt: { label: "Missing receipt", tone: "inv-overdue" },
  still_in_hub: { label: "Still in hub", tone: "inv-overdue" },
  no_pieces: { label: "No pieces counted", tone: "inv-due" },
  pieces_differ: { label: "Pieces differ from quote", tone: "inv-due" },
  kg_differ: { label: "Weight differs from quote", tone: "inv-due" },
  ahead_of_status: { label: "Booked in before the status", tone: "inv-due" },
};

/** States that need someone to look. */
export const isHubProblem = (s: HubSyncState) => s !== "waiting" && s !== "in_sync";

function unwrap<T>({ data, error }: { data: T | null; error: { message?: string } | null }): T {
  if (error) throw new Error(error.message || "Request failed");
  return data as T;
}

async function hubSync(jobId?: string): Promise<HubSyncRow[]> {
  let q = supabase.from("wms_hub_sync").select("*").order("job_ref").order("position");
  if (jobId) q = q.eq("job_id", jobId);
  const { data, error } = await q;
  if (error) {
    // Before 0213 is applied the view doesn't exist: show no hubs, not an error.
    if (/wms_hub_sync|does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as HubSyncRow[];
}

export const useJobHubs = (jobId: string) =>
  useQuery({ queryKey: ["wms", "hub-sync", jobId], queryFn: () => hubSync(jobId) });

export const useHubSync = () =>
  useQuery({ queryKey: ["wms", "hub-sync", "all"], queryFn: () => hubSync() });

export interface JobWithoutHub {
  job_id: string;
  job_ref: string;
  client_id: string | null;
  shipment_status: string | null;
  origin: string | null;
  destination: string | null;
  mode: string;
}

/** Active shipments past Collected with no hub (no match, or never in a warehouse). */
export const useJobsWithoutHub = () =>
  useQuery({
    queryKey: ["wms", "hub-sync", "no-hub"],
    queryFn: async (): Promise<JobWithoutHub[]> => {
      const { data, error } = await supabase.from("wms_jobs_without_hub").select("*").order("job_ref");
      if (error) {
        if (/wms_jobs_without_hub|does not exist|schema cache/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return (data ?? []) as JobWithoutHub[];
    },
  });

export const hubDb = {
  async add(v: { jobId: string; warehouseId: string; role: HubRole }) {
    const position = v.role === "origin" ? 0 : v.role === "transit" ? 50 : 100;
    unwrap(await supabase.from("job_hubs").insert({ job_id: v.jobId, warehouse_id: v.warehouseId, role: v.role, position }));
  },
  async setRole(v: { hubId: string; role: HubRole }) {
    const position = v.role === "origin" ? 0 : v.role === "transit" ? 50 : 100;
    unwrap(await supabase.from("job_hubs").update({ role: v.role, position, auto: false }).eq("id", v.hubId));
  },
  async remove(hubId: string) {
    unwrap(await supabase.from("job_hubs").delete().eq("id", hubId));
  },
  async receive(hubId: string) {
    return unwrap(await supabase.rpc("wms_hub_receive", { p_hub: hubId })) as string;
  },
  async release(hubId: string) {
    return unwrap(await supabase.rpc("wms_hub_release", { p_hub: hubId })) as string | null;
  },
};

/** Any hub write refreshes every WMS query (receipts, stock, hub sync). */
export function useHubMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: ["wms"] }),
  });
}
