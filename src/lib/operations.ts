// Operations reference lists (Settings › Operations, migration 0205):
// container vessels with their MMSI (the AIS vessel tracking key, 0204) and
// airlines. A workspace that grows with the operation.
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

export interface Vessel {
  id: string;
  name: string;
  /** 9 digits; the AIS tracking key. Null until found. */
  mmsi: string | null;
  imo: string | null;
  shipping_line: string | null;
  notes: string | null;
  updated_at: string;
}
export type VesselInput = Pick<Vessel, "name" | "mmsi" | "imo" | "shipping_line" | "notes">;

export interface Airline {
  id: string;
  name: string;
  /** 2-letter airline code, e.g. EK. */
  iata: string | null;
  /** 3-digit AWB prefix, e.g. 176. */
  awb_prefix: string | null;
  notes: string | null;
  updated_at: string;
}
export type AirlineInput = Pick<Airline, "name" | "iata" | "awb_prefix" | "notes">;

const blankToNull = <T extends Record<string, string | null>>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, (v ?? "").trim() || null])) as T;

/* ---------- Vessels ---------- */
export function useVessels() {
  return useQuery({
    queryKey: ["vessels"],
    queryFn: async () => unwrap<Vessel[]>(await supabase.from("vessels").select("*").order("name")),
    retry: false,
  });
}

/** Save a vessel; with an MMSI, every active shipment on it (same IMO, or
 *  name) gets it straight away (fill_vessel_mmsi, 0205). */
export function useSaveVessel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; values: VesselInput }) => {
      const row = { ...blankToNull(input.values), updated_at: new Date().toISOString() };
      if (!row.name) throw new Error("Vessel name is required.");
      if (row.mmsi && !/^\d{9}$/.test(row.mmsi)) throw new Error("An MMSI is 9 digits.");
      unwrap(
        input.id
          ? await supabase.from("vessels").update(row).eq("id", input.id).select("id")
          : await supabase.from("vessels").insert(row).select("id"),
      );
      if (row.mmsi) await supabase.rpc("fill_vessel_mmsi");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vessels"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useDeleteVessel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("vessels").delete().eq("id", id).select("id")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vessels"] }),
  });
}

/* ---------- Airlines ---------- */
export function useAirlines() {
  return useQuery({
    queryKey: ["airlines"],
    queryFn: async () => unwrap<Airline[]>(await supabase.from("airlines").select("*").order("name")),
    retry: false,
  });
}

export function useSaveAirline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; values: AirlineInput }) => {
      const row = { ...blankToNull(input.values), updated_at: new Date().toISOString() };
      if (!row.name) throw new Error("Airline name is required.");
      if (row.iata) row.iata = row.iata.toUpperCase();
      unwrap(
        input.id
          ? await supabase.from("airlines").update(row).eq("id", input.id).select("id")
          : await supabase.from("airlines").insert(row).select("id"),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["airlines"] }),
  });
}

export function useDeleteAirline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("airlines").delete().eq("id", id).select("id")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["airlines"] }),
  });
}
