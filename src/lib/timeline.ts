// Shipment timeline (migration 0196): the steps for a shipment's mode, each
// with a planned and an actual date. The last done step is the shipment's
// Shipment Status, the database keeps the two in sync.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { stepLabel } from "./steps";

export { stepLabel, timelineSteps } from "./steps";

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

/** The message Notify customer pre-fills in Comms (editable before sending). */
export function notifyText(
  mode: string | null | undefined,
  moved: { step: string; date: string } | null,
  revised: string[] = [],
): string {
  const lines: string[] = [];
  if (moved) {
    const [y, m, d] = moved.date.split("-");
    lines.push(`Your shipment has moved to: ${stepLabel(moved.step, mode)}${d ? ` on ${d}/${m}/${y}` : ""}.`);
  }
  lines.push(...revised);
  return lines.join("\n");
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
  /** A line in the shipment's history (job_events), e.g. a revised ETA. */
  async logNote(input: { jobId: string; milestone: string; note: string }): Promise<void> {
    unwrap(
      await supabase
        .from("job_events")
        .insert({ job_id: input.jobId, milestone: input.milestone, note: input.note })
        .select("id"),
    );
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
    qc.invalidateQueries({ queryKey: ["quotes"] });
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
