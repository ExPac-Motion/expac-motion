// Shipment timeline (migration 0196): the steps for a shipment's mode, each
// with a planned and an actual date. The last done step is the shipment's
// Shipment Status, the database keeps the two in sync.
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

export interface TimelineStep {
  id: string;
  job_id: string;
  /** A Shipment Status value (Created, Booked, Collected, ...). */
  step: string;
  sort_order: number;
  done: boolean;
  planned_date: string | null;
  actual_date: string | null;
  note: string | null;
  skipped: boolean;
  customer_visible: boolean;
  updated_at: string;
}

/** client_job_timeline: what the customer sees on the portal. */
export interface ClientTimelineStep {
  id: string;
  job_id: string;
  step: string;
  sort_order: number;
  done: boolean;
  actual_date: string | null;
  planned_date: string | null;
}

export type TimelinePatch = Partial<
  Pick<TimelineStep, "planned_date" | "actual_date" | "note" | "customer_visible" | "skipped" | "done">
>;

/** Optional step: only shown once it happens (or as "Mark detained"). */
export const OPTIONAL_STEP = "Detained";

/** The planned date of these steps is the shipment's ETD / ETA / PDD. */
export const PLANNED_FIELD: Record<string, string> = {
  Departed: "ETD",
  Arrived: "ETA",
  Delivered: "PDD",
};

/** A step's name for this mode (the stored value stays the status). */
export function stepLabel(step: string, mode: string | null | undefined): string {
  const m = mode ?? "";
  const sea = m.startsWith("Sea");
  const road = m.startsWith("Road");
  switch (step) {
    case "Received":
      return sea ? "Received at CFS" : m.startsWith("Courier") ? "Received at hub" : "Received at airline";
    case "Loaded":
      return sea ? "Loaded on vessel" : "Loaded";
    case "Departed":
      return sea ? "Vessel departed" : road ? "Truck departed" : "Flight departed";
    case "Arrived":
      return road ? "Arrived at border" : sea ? "Arrived at port" : "Arrived at airport";
    case "Unloaded":
      return "Discharged";
    case "Customs":
      return "Customs clearance";
    case "Released":
      return "Released by customs";
    case "On-Delivery":
      return "Out for delivery";
    default:
      return step;
  }
}

/** Today in South Africa, yyyy-mm-dd (what the database uses). */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export const timelineDb = {
  async steps(jobId: string): Promise<TimelineStep[]> {
    return unwrap(
      await supabase.from("job_timeline_steps").select("*").eq("job_id", jobId).order("sort_order"),
    );
  },
  async advance(input: { jobId: string; date: string; note: string }): Promise<string> {
    return unwrap(
      await supabase.rpc("job_timeline_advance", {
        p_job: input.jobId,
        p_date: input.date || null,
        p_note: input.note || null,
      }),
    ) as string;
  },
  async set(input: { stepId: string; patch: TimelinePatch }): Promise<string> {
    return unwrap(await supabase.rpc("job_timeline_set", { p_step: input.stepId, p: input.patch })) as string;
  },
  async clientSteps(jobId: string): Promise<ClientTimelineStep[]> {
    const r = await supabase.from("client_job_timeline").select("*").eq("job_id", jobId).order("sort_order");
    if (r.error) return []; // before 0196: the portal falls back to the status history
    return (r.data ?? []) as ClientTimelineStep[];
  },
};

export const useJobTimeline = (jobId: string | undefined) =>
  useQuery({
    queryKey: ["job_timeline", jobId],
    queryFn: () => timelineDb.steps(jobId as string),
    enabled: !!jobId,
  });

export const useClientTimeline = (jobId: string | undefined) =>
  useQuery({
    queryKey: ["my_timeline", jobId],
    queryFn: () => timelineDb.clientSteps(jobId as string),
    enabled: !!jobId,
  });

function useInvalidateTimeline() {
  const qc = useQueryClient();
  return (jobId: string) => {
    qc.invalidateQueries({ queryKey: ["job_timeline", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["nav_counts"] });
  };
}

export function useAdvanceTimeline() {
  const invalidate = useInvalidateTimeline();
  return useMutation({
    mutationFn: timelineDb.advance,
    onSuccess: (_r, v) => invalidate(v.jobId),
  });
}

export function useSetTimelineStep(jobId: string) {
  const invalidate = useInvalidateTimeline();
  return useMutation({
    mutationFn: timelineDb.set,
    onSuccess: () => invalidate(jobId),
  });
}
