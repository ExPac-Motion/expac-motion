// Shared plumbing for every Motion AI Edge Function: CORS, Supabase
// clients, JSON helpers, dates in South African time.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

export type Db = SupabaseClient;

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set on this Edge Function.`);
  return v;
}

/** Acts as the signed-in person: every query goes through their RLS. */
export function userClient(authHeader: string): Db {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service key: only for writing the AI's own log tables and for
 *  trigger / schedule runs of internal bots. Never handed to a tool that a
 *  portal bot can call. */
export function serviceClient(): Db {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const TZ = "Africa/Johannesburg";

/** yyyy-mm-dd in South African time, `offsetDays` from today. */
export function sastDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Drops null / empty values and internal-only keys, so tool results stay
 *  small and never leak things the bot shouldn't repeat. */
const HIDDEN_KEYS = new Set([
  "track_key",
  "shipsgo_id",
  "provider",
  "provider_ref",
  "pol_lat",
  "pol_lon",
  "pod_lat",
  "pod_lon",
  "vessel_lat",
  "vessel_lon",
  "ais_lat",
  "ais_lon",
  "raw",
  "payload",
]);
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => compact(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (HIDDEN_KEYS.has(k)) continue;
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = compact(v);
    }
    return out as T;
  }
  return value;
}
