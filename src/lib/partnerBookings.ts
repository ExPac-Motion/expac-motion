/**
 * Partner bookings (0253): a partner sends ExPac one of their own shipments
 * to handle (usually at destination). The partner is ExPac's customer and
 * is billed; the request lands in Quotations as a New Lead, ExPac prices it
 * and sends the quotation back here to accept.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { ClientQuoteLine, QuoteMode } from "./types";

export interface PartnerBooking {
  id: string;
  reference: string;
  mode: string;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  customer_reference: string | null;
  status: "open" | "sent" | "accepted" | "lost" | "completed" | string;
  valid_until: string | null;
  sell_currency: string | null;
  portal_decision: string | null;
  portal_decline_reason: string | null;
  services: string[] | null;
  created_at: string;
  job: { id: string; reference: string; shipment_status: string | null; etd: string | null; eta: string | null } | null;
}

export const BOOKING_SERVICES = [
  "Customs clearance",
  "Delivery to consignee",
  "Warehousing",
  "Collection at origin",
  "Export clearance",
  "Insurance",
];

export interface BookingPacking {
  qty_ctns: string;
  qty_pcs: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  actual_kg: string;
}

export interface BookingRequest {
  mode: QuoteMode;
  origin: string;
  destination: string;
  commodity: string;
  incoterms: string;
  customer_reference: string;
  ready_date: string;
  etd: string;
  eta: string;
  master_bill: string;
  house_bill: string;
  consignee: string;
  delivery: string;
  notes: string;
  services: string[];
  packing: BookingPacking[];
}

function fail(error: unknown): never {
  const e = error as { message?: string };
  throw new Error(e?.message || "Something went wrong");
}

/** How the partner sees where their request stands. */
export function bookingStatus(b: PartnerBooking): { label: string; cls: string } {
  if (b.job) return { label: "Shipment running", cls: "accepted" };
  if (b.status === "open") return { label: "ExPac is pricing it", cls: "open" };
  if (b.status === "sent") {
    if (b.valid_until && b.valid_until < new Date().toISOString().slice(0, 10)) return { label: "Quote expired", cls: "lost" };
    return { label: "Quotation ready", cls: "sent" };
  }
  if (b.status === "accepted") return { label: "Accepted", cls: "accepted" };
  if (b.status === "lost") return { label: "Declined", cls: "lost" };
  return { label: b.status, cls: "completed" };
}

export function usePartnerBookings(enabled = true) {
  return useQuery({
    queryKey: ["partner_bookings"],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("partner_bookings");
      if (error) fail(error);
      return (data ?? []) as PartnerBooking[];
    },
  });
}

export function usePartnerBookingLines(quoteId: string | null) {
  return useQuery({
    queryKey: ["partner_booking_lines", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("partner_booking_lines", { p_quote: quoteId });
      if (error) fail(error);
      return (data ?? []) as ClientQuoteLine[];
    },
  });
}

export function useRequestBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: BookingRequest) => {
      const packing = r.packing.filter((p) => Number(p.qty_ctns) > 0 || Number(p.actual_kg) > 0);
      const { data, error } = await supabase.rpc("partner_request_booking", { p: { ...r, packing } });
      if (error) fail(error);
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner_bookings"] }),
  });
}

export function useBookingDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { quoteId: string; accept: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("partner_booking_decision", {
        p_quote: v.quoteId,
        p_accept: v.accept,
        p_reason: v.reason ?? null,
      });
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner_bookings"] }),
  });
}
