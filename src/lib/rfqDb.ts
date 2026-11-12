/**
 * Data access + hooks for agent Req for Quote (migration 0241): the requests
 * on a quote, each agent's reply status and rates, and the public reply link.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { RfqChargeRow } from "./rfq";
import type { ChargeCategory, PartnerKind } from "./types";

export type RfqStatus = "awaiting" | "received" | "used" | "not_used" | "declined";

export const RFQ_STATUS_LABEL: Record<RfqStatus | "overdue", string> = {
  awaiting: "Awaiting",
  overdue: "Overdue",
  received: "Received",
  used: "Used",
  not_used: "Not used",
  declined: "Declined",
};

export interface RfqCharge extends RfqChargeRow {
  category: ChargeCategory;
}

export interface RfqRate {
  id?: string;
  recipient_id?: string;
  position: number;
  category: string;
  code: string;
  description: string;
  unit: string;
  cur: string;
  rate: number | null;
  min_charge: number | null;
  remarks: string | null;
}

export interface RfqRecipient {
  id: string;
  rfq_id: string;
  quote_id: string;
  partner_id: string | null;
  email: string;
  company: string | null;
  contact: string | null;
  token: string;
  status: RfqStatus;
  sent_at: string;
  responded_at: string | null;
  responded_via: "link" | "staff" | null;
  validity: string | null;
  transit_time: string | null;
  remarks: string | null;
  quote_rfq_rates: RfqRate[];
}

export interface Rfq {
  id: string;
  quote_id: string;
  partner_kind: PartnerKind;
  reply_by: string | null;
  notes: string | null;
  charges: RfqCharge[];
  created_at: string;
  quote_rfq_recipients: RfqRecipient[];
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error instanceof Error ? error : new Error((error as { message?: string })?.message || "Request failed");
  return data as T;
}

/** Awaiting past its reply-by date shows as Overdue. */
export function rfqDisplayStatus(r: Pick<RfqRecipient, "status">, replyBy: string | null): RfqStatus | "overdue" {
  if (r.status !== "awaiting" || !replyBy) return r.status;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return replyBy < iso ? "overdue" : "awaiting";
}

export async function listQuoteRfqs(quoteId: string): Promise<Rfq[]> {
  const rows = unwrap<Rfq[]>(
    await supabase
      .from("quote_rfqs")
      .select("*, quote_rfq_recipients(*, quote_rfq_rates(*))")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false }),
  );
  for (const f of rows) {
    f.quote_rfq_recipients.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    for (const r of f.quote_rfq_recipients) r.quote_rfq_rates.sort((a, b) => a.position - b.position);
  }
  return rows;
}

export async function getRfqRecipient(id: string): Promise<RfqRecipient & { rfq: Pick<Rfq, "partner_kind" | "charges"> }> {
  const r = unwrap<RfqRecipient & { rfq: Pick<Rfq, "partner_kind" | "charges"> }>(
    await supabase
      .from("quote_rfq_recipients")
      .select("*, quote_rfq_rates(*), rfq:quote_rfqs(partner_kind, charges)")
      .eq("id", id)
      .single(),
  );
  r.quote_rfq_rates.sort((a, b) => a.position - b.position);
  return r;
}

export async function createRfq(input: {
  quoteId: string;
  kind: PartnerKind;
  replyBy: string;
  notes: string;
  charges: RfqCharge[];
  recipients: { partnerId: string | null; email: string; company: string; contact: string }[];
}): Promise<{ rfqId: string; recipients: RfqRecipient[] }> {
  const rfq = unwrap<{ id: string }>(
    await supabase
      .from("quote_rfqs")
      .insert({
        quote_id: input.quoteId,
        partner_kind: input.kind,
        reply_by: input.replyBy || null,
        notes: input.notes.trim() || null,
        charges: input.charges,
      })
      .select("id")
      .single(),
  );
  const recipients = unwrap<RfqRecipient[]>(
    await supabase
      .from("quote_rfq_recipients")
      .insert(
        input.recipients.map((r) => ({
          rfq_id: rfq.id,
          quote_id: input.quoteId,
          partner_id: r.partnerId,
          email: r.email,
          company: r.company || null,
          contact: r.contact || null,
        })),
      )
      .select("*"),
  );
  return { rfqId: rfq.id, recipients };
}

/** Remove recipients whose email failed to send (and the request when none went). */
export async function dropUnsent(rfqId: string, recipientIds: string[], all: boolean) {
  if (all) {
    unwrap(await supabase.from("quote_rfqs").delete().eq("id", rfqId));
  } else if (recipientIds.length) {
    unwrap(await supabase.from("quote_rfq_recipients").delete().in("id", recipientIds));
  }
}

/** Staff keying in an agent's emailed reply. */
export async function saveRfqReplyByStaff(input: {
  recipientId: string;
  rates: RfqRate[];
  validity: string;
  transit: string;
  remarks: string;
  declined: boolean;
}) {
  unwrap(await supabase.from("quote_rfq_rates").delete().eq("recipient_id", input.recipientId));
  const rows = input.declined
    ? []
    : input.rates
        .filter((r) => r.rate != null || r.min_charge != null || (r.remarks ?? "").trim())
        .map((r, i) => ({
          recipient_id: input.recipientId,
          position: i,
          category: r.category,
          code: r.code,
          description: r.description,
          unit: r.unit,
          cur: r.cur,
          rate: r.rate,
          min_charge: r.min_charge,
          remarks: (r.remarks ?? "").trim() || null,
        }));
  if (rows.length) unwrap(await supabase.from("quote_rfq_rates").insert(rows));
  unwrap(
    await supabase
      .from("quote_rfq_recipients")
      .update({
        status: input.declined ? "declined" : "received",
        responded_at: new Date().toISOString(),
        responded_via: "staff",
        validity: input.validity.trim() || null,
        transit_time: input.transit.trim() || null,
        remarks: input.remarks.trim() || null,
      })
      .eq("id", input.recipientId),
  );
}

export async function setRfqRecipientStatus(id: string, status: RfqStatus) {
  unwrap(await supabase.from("quote_rfq_recipients").update({ status }).eq("id", id));
}

/** The chosen reply was loaded into the quote and saved: it becomes Used,
 *  the other replies on the same request Not used. */
export async function markRfqReplyUsed(recipientId: string) {
  const r = unwrap<{ rfq_id: string }>(
    await supabase.from("quote_rfq_recipients").select("rfq_id").eq("id", recipientId).single(),
  );
  unwrap(await supabase.from("quote_rfq_recipients").update({ status: "used" }).eq("id", recipientId));
  unwrap(
    await supabase
      .from("quote_rfq_recipients")
      .update({ status: "not_used" })
      .eq("rfq_id", r.rfq_id)
      .neq("id", recipientId)
      .in("status", ["awaiting", "received", "used"]),
  );
}

export async function deleteRfq(id: string) {
  unwrap(await supabase.from("quote_rfqs").delete().eq("id", id));
}

/* ---------- public reply link ---------- */

export interface RfqPublic {
  rfq_number: string;
  mode: string;
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  commodity: string | null;
  ready_date: string | null;
  etd: string | null;
  container_type: string | null;
  pickup: string | null;
  reply_by: string | null;
  notes: string | null;
  charges: RfqCharge[];
  company: string | null;
  status: RfqStatus;
  responded_at: string | null;
  validity: string | null;
  transit_time: string | null;
  remarks: string | null;
  packing: {
    length_cm: number;
    width_cm: number;
    height_cm: number;
    actual_kg: number;
    qty_ctns: number;
    qty_pcs: number;
    cbm: number | null;
  }[];
  rates: Omit<RfqRate, "position">[];
}

export async function getRfqPublic(token: string): Promise<RfqPublic | null> {
  return unwrap<RfqPublic | null>(await supabase.rpc("rfq_reply_get", { p_token: token }));
}

export async function submitRfqPublic(input: {
  token: string;
  rates: Record<string, string>[];
  validity: string;
  transit: string;
  remarks: string;
  decline: boolean;
}): Promise<string> {
  return unwrap<string>(
    await supabase.rpc("rfq_reply_submit", {
      p_token: input.token,
      p_rates: input.rates,
      p_validity: input.validity,
      p_transit: input.transit,
      p_remarks: input.remarks,
      p_decline: input.decline,
    }),
  );
}

/* ---------- hooks ---------- */

export function useQuoteRfqs(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["quote_rfqs", quoteId],
    queryFn: () => listQuoteRfqs(quoteId as string),
    // "demo" = the DEV preview (/quotes/demo/rfq?view=panel), seeded in the cache.
    enabled: Boolean(quoteId) && quoteId !== "demo",
    retry: false,
  });
}

export function useRfqMutation<A, R>(fn: (a: A) => Promise<R>, quoteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote_rfqs", quoteId] });
      qc.invalidateQueries({ queryKey: ["quote_messages", quoteId] });
    },
  });
}

/** Clean a typed number: "1 250,50" / "1,250.50" / "$120" -> "1250.50"; "" when not a number. */
export function cleanAmount(v: string): string {
  let s = v.replace(/[^\d.,]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(s) ? s : "";
}
