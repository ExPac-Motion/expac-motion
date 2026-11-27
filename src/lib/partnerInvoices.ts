/**
 * Partner invoices & statements (migration 0251): a partner submits their
 * invoice per shipment on the portal; ExPac approves, queries or marks it
 * paid. The statement is built from these rows (no Sage sync).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { PartnerKind } from "./types";

export type PartnerInvoiceStatus = "submitted" | "approved" | "queried" | "paid";

export interface PartnerInvoice {
  id: string;
  partner_kind: PartnerKind;
  partner_id: string;
  job_id: string;
  reference: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  amount_excl: number;
  vat: number;
  total: number;
  status: PartnerInvoiceStatus;
  query_note: string | null;
  reply_note: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  payment_ref: string | null;
  created_at: string;
  updated_at: string;
  document_path: string | null;
  document_name: string | null;
  /** What ExPac expects from the partner's buy lines on the job, per currency. */
  expected: Record<string, number>;
}

export const INVOICE_STATUS_LABEL: Record<PartnerInvoiceStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  queried: "Queried",
  paid: "Paid",
};

export const INVOICE_CURRENCIES = ["USD", "EUR", "GBP", "CNY", "ZAR", "HKD", "AED", "INR"];

function fail(error: unknown): never {
  const e = error as { message?: string };
  throw new Error(e?.message || "Something went wrong");
}

/** Outstanding on an invoice: nothing once paid, else the total. */
export const outstandingOf = (i: PartnerInvoice) => (i.status === "paid" ? 0 : Number(i.total) || 0);

/** Days past the due date (or 30 days after the invoice date when no due date). */
export function daysPastDue(i: PartnerInvoice, today = new Date().toISOString().slice(0, 10)): number {
  const due = i.due_date ?? new Date(Date.parse(i.invoice_date) + 30 * 86_400_000).toISOString().slice(0, 10);
  if (due >= today) return 0;
  return Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000);
}

export const STATEMENT_BUCKETS = [
  { label: "Not yet due", min: 0, max: 0 },
  { label: "1–30 days", min: 1, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "90+ days", min: 91, max: Infinity },
];

export interface CurrencyStatement {
  currency: string;
  invoiced: number;
  paid: number;
  outstanding: number;
  ageing: number[];
}

/** Statement per currency: totals invoiced / paid / outstanding and ageing. */
export function statementByCurrency(invoices: PartnerInvoice[]): CurrencyStatement[] {
  const by = new Map<string, CurrencyStatement>();
  for (const i of invoices) {
    const s =
      by.get(i.currency) ??
      ({ currency: i.currency, invoiced: 0, paid: 0, outstanding: 0, ageing: STATEMENT_BUCKETS.map(() => 0) } as CurrencyStatement);
    s.invoiced += Number(i.total) || 0;
    if (i.status === "paid") s.paid += Number(i.paid_amount ?? i.total) || 0;
    const out = outstandingOf(i);
    if (out > 0) {
      s.outstanding += out;
      const d = daysPastDue(i);
      s.ageing[STATEMENT_BUCKETS.findIndex((b) => d >= b.min && d <= b.max)] += out;
    }
    by.set(i.currency, s);
  }
  return [...by.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export const money = (cur: string, v: number) =>
  `${cur} ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------- Partner ---------- */

export function usePartnerInvoices(enabled = true) {
  return useQuery({
    queryKey: ["partner_invoices"],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("partner_invoices");
      if (error) fail(error);
      return (data ?? []) as PartnerInvoice[];
    },
  });
}

export interface InvoiceDraft {
  jobId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  amountExcl: number;
  vat: number;
  total: number;
  documentId: string | null;
}

export async function submitPartnerInvoice(d: InvoiceDraft): Promise<void> {
  const { error } = await supabase.rpc("partner_submit_invoice", {
    p_job: d.jobId,
    p_invoice_no: d.invoiceNo,
    p_invoice_date: d.invoiceDate,
    p_due_date: d.dueDate,
    p_currency: d.currency,
    p_amount_excl: d.amountExcl,
    p_vat: d.vat,
    p_total: d.total,
    p_document_id: d.documentId,
  });
  if (error) fail(error);
}

export async function replyInvoiceQuery(id: string, note: string, documentId: string | null): Promise<void> {
  const { error } = await supabase.rpc("partner_reply_invoice_query", { p_id: id, p_note: note, p_document_id: documentId });
  if (error) fail(error);
}

export function usePartnerInvoiceMutation<A>(fn: (a: A) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner_invoices"] });
      qc.invalidateQueries({ queryKey: ["partner_shipment"] });
    },
  });
}

/* ---------- Staff ---------- */

export function useStaffPartnerInvoices(kind: PartnerKind, partnerId: string) {
  return useQuery({
    queryKey: ["staff_partner_invoices", kind, partnerId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_partner_invoices", { p_kind: kind, p_partner: partnerId });
      if (error) fail(error);
      return (data ?? []) as PartnerInvoice[];
    },
  });
}

export type StaffInvoiceAction =
  | { id: string; action: "approve" }
  | { id: string; action: "query"; note: string }
  | { id: string; action: "paid"; amount: number; paidAt: string; ref: string };

export function useStaffInvoiceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: StaffInvoiceAction) => {
      const { error } = await supabase.rpc("staff_partner_invoice_action", {
        p_id: a.id,
        p_action: a.action,
        p_note: a.action === "query" ? a.note : null,
        p_paid_amount: a.action === "paid" ? a.amount : null,
        p_paid_at: a.action === "paid" ? a.paidAt : null,
        p_payment_ref: a.action === "paid" ? a.ref : null,
      });
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff_partner_invoices"] }),
  });
}
