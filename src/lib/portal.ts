// Customer Portal v2 (migration 0141): quote requests from the portal,
// accept / decline of sent quotations, the customer's own packing lines and
// the portal greeting.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { ClientQuote, ClientQuoteLine, QuoteLine, QuoteMode } from "./types";
import { lineNet, lineVat } from "./calc";

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

/** client_quotes (0141) — the request / decision fields on top of ClientQuote. */
export interface PortalQuote extends ClientQuote {
  customer_reference?: string | null;
  portal_requested_at?: string | null;
  request_ready_date?: string | null;
  request_pickup?: string | null;
  request_delivery?: string | null;
  request_notes?: string | null;
  portal_decision?: "accepted" | "declined" | null;
  portal_decided_at?: string | null;
  portal_decline_reason?: string | null;
  sell_currency?: string | null;
  accepted_at?: string | null;
}

export interface PortalPackingItem {
  id: string;
  quote_id: string;
  position: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  actual_kg: number;
  qty_ctns: number;
  cbm: number | null;
}

export interface QuoteRequestPacking {
  length_cm: string;
  width_cm: string;
  height_cm: string;
  actual_kg: string;
  qty_ctns: string;
}

export interface QuoteRequest {
  mode: QuoteMode;
  origin: string;
  destination: string;
  commodity: string;
  incoterms: string;
  customer_reference: string;
  commercial_value: string;
  value_currency: string;
  ready_date: string;
  pickup: string;
  delivery: string;
  notes: string;
  packing: QuoteRequestPacking[];
}

/** How the customer sees a quotation's status. */
export function portalQuoteStatus(q: Pick<PortalQuote, "status" | "portal_requested_at" | "portal_decision" | "valid_until">): {
  label: string;
  cls: string;
} {
  if (q.status === "open") return q.portal_requested_at ? { label: "Requested", cls: "open" } : { label: "Being prepared", cls: "open" };
  if (q.status === "sent") {
    if (q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10)) return { label: "Expired", cls: "lost" };
    return { label: "Response available", cls: "sent" };
  }
  if (q.status === "accepted") return { label: "Accepted", cls: "accepted" };
  if (q.status === "completed") return { label: "Completed", cls: "completed" };
  return { label: q.portal_decision === "declined" ? "Declined" : "Not proceeding", cls: "lost" };
}

export interface PortalMe {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  account_manager: string | null;
}

export const portalDb = {
  async me(): Promise<PortalMe | null> {
    const { data, error } = await supabase.from("client_me").select("*").maybeSingle();
    if (error) return null; // before 0141 is applied
    return data as PortalMe | null;
  },
  async quotes(): Promise<PortalQuote[]> {
    return unwrap(await supabase.from("client_quotes").select("*").order("created_at", { ascending: false }));
  },
  async lines(quoteIds: string[]): Promise<ClientQuoteLine[]> {
    if (quoteIds.length === 0) return [];
    return unwrap(await supabase.from("client_quote_lines").select("*").in("quote_id", quoteIds).order("position"));
  },
  async packing(quoteId: string): Promise<PortalPackingItem[]> {
    return unwrap(await supabase.from("client_packing_items").select("*").eq("quote_id", quoteId).order("position"));
  },
  async requestQuote(r: QuoteRequest): Promise<string> {
    const packing = r.packing
      .filter((p) => Number(p.qty_ctns) > 0 || Number(p.actual_kg) > 0)
      .map((p) => ({ ...p }));
    return unwrap(await supabase.rpc("portal_request_quote", { p: { ...r, packing } })) as string;
  },
  async decide(quoteId: string, accept: boolean, reason: string) {
    unwrap(await supabase.rpc("portal_quote_decision", { p_quote: quoteId, p_accept: accept, p_reason: reason }));
  },
  async setGreeting(profileId: string, greeting: string) {
    unwrap(await supabase.from("profiles").update({ greeting: greeting.trim() || null }).eq("id", profileId));
  },
};

export const usePortalMe = () => useQuery({ queryKey: ["portal", "me"], queryFn: portalDb.me });
export const usePortalQuotes = () => useQuery({ queryKey: ["portal", "quotes"], queryFn: portalDb.quotes });
export const usePortalLines = (quoteIds: string[]) =>
  useQuery({
    queryKey: ["portal", "lines", quoteIds],
    queryFn: () => portalDb.lines(quoteIds),
    enabled: quoteIds.length > 0,
  });

/** Quote totals from its client-visible lines (same maths as the quotation). */
export function portalTotals(lines: ClientQuoteLine[]) {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const ql = l as unknown as QuoteLine;
    net += lineNet(ql);
    vat += lineVat(ql);
  }
  return { net, vat, total: net + vat };
}

export const usePortalPacking = (quoteId: string | undefined) =>
  useQuery({
    queryKey: ["portal", "packing", quoteId],
    queryFn: () => portalDb.packing(quoteId as string),
    enabled: !!quoteId,
  });

export function useRequestQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: portalDb.requestQuote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal"] });
      qc.invalidateQueries({ queryKey: ["my_quotes"] });
    },
  });
}
export function useQuoteDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { quoteId: string; accept: boolean; reason: string }) => portalDb.decide(v.quoteId, v.accept, v.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal"] });
      qc.invalidateQueries({ queryKey: ["my_quotes"] });
      qc.invalidateQueries({ queryKey: ["my_jobs"] });
    },
  });
}
export function useSetGreeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; greeting: string }) => portalDb.setGreeting(v.profileId, v.greeting),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my_profile"] }),
  });
}

/** "Good morning / Good afternoon / Good evening" — the user asked for "Good day". */
export function greetingFor(profile: { greeting?: string | null; full_name?: string | null } | null | undefined, email?: string | null): string {
  const who = profile?.greeting?.trim() || profile?.full_name?.trim() || email?.split("@")[0] || "";
  return who ? `Good day, ${who}` : "Good day";
}
