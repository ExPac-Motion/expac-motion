// System health (migration 0207): the background jobs (inbox, vessel
// positions, tracking registration, Sage) and the notification emails,
// checked every 5 minutes by system_health_check(). Admins only (RLS).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface HealthCheck {
  check_key: string;
  label: string;
  sort: number;
  ok: boolean;
  detail: string | null;
  failing_since: string | null;
  last_ok_at: string | null;
  checked_at: string;
}

export interface HealthEvent {
  id: number;
  check_key: string;
  label: string;
  ok: boolean;
  detail: string | null;
  at: string;
}

export interface HealthProblem {
  key: string;
  label: string;
  detail: string;
  since: string | null;
}

/** The check runs every 5 minutes; older than this means it has stopped. */
const STALE_MS = 15 * 60_000;

export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: ["system_health"],
    enabled,
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<HealthCheck[]> => {
      const { data, error } = await supabase.from("system_health").select("*").order("sort");
      if (error) throw new Error(error.message);
      return (data ?? []) as HealthCheck[];
    },
  });
}

export function useSystemHealthLog(enabled = true) {
  return useQuery({
    queryKey: ["system_health_log"],
    enabled,
    retry: false,
    queryFn: async (): Promise<HealthEvent[]> => {
      const { data, error } = await supabase
        .from("system_health_log")
        .select("*")
        .order("at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as HealthEvent[];
    },
  });
}

/** What's wrong right now: failing checks, plus the check itself stopping
 *  (then nothing else updates, so the rest can't be trusted). */
export function healthProblems(rows: HealthCheck[] | undefined, now = Date.now()): HealthProblem[] {
  if (!rows?.length) return [];
  const out: HealthProblem[] = rows
    .filter((r) => !r.ok)
    .map((r) => ({ key: r.check_key, label: r.label, detail: r.detail ?? "Failing", since: r.failing_since }));
  const last = Math.max(...rows.map((r) => Date.parse(r.checked_at)));
  if (Number.isFinite(last) && now - last > STALE_MS) {
    out.unshift({
      key: "health-check",
      label: "Health check",
      detail: `Has not run for ${Math.round((now - last) / 60_000)} minutes, so scheduled jobs may have stopped (pg_cron)`,
      since: new Date(last).toISOString(),
    });
  }
  return out;
}
