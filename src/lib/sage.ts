// Sage Business Cloud Accounting (South Africa), read-only sync (migration
// 0156): Sage customers, tax invoices and receipts copied in by
// /api/sage-sync, the customer link, statuses / ageing, and the invoice /
// statement PDFs from /api/sage-document.
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

export interface SageCustomer {
  sage_id: number;
  name: string;
  email: string | null;
  tax_reference: string | null;
  balance: number | null;
  credit_limit: number | null;
  active: boolean | null;
  synced_at: string;
}

export interface CustomerInvoice {
  sage_id: number;
  sage_customer_id: number;
  client_id: string | null;
  job_id: string | null;
  document_number: string | null;
  reference: string | null;
  invoice_date: string | null;
  due_date: string | null;
  exclusive: number | null;
  tax: number | null;
  total: number | null;
  amount_due: number | null;
  paid: boolean;
  status: string | null;
  synced_at: string;
}

export interface CustomerReceipt {
  sage_id: number;
  sage_customer_id: number;
  client_id: string | null;
  document_number: string | null;
  reference: string | null;
  description: string | null;
  receipt_date: string | null;
  total: number | null;
  unallocated: number | null;
}

export interface SageState {
  company_id: number | null;
  company_name: string | null;
  last_sync_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  customers: number | null;
  invoices: number | null;
  receipts: number | null;
  linked_customers: number | null;
}

/* ---------- status & ageing ---------- */

export type InvoiceStatus = "Paid" | "Partially paid" | "Overdue" | "Due";

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function invoiceStatus(i: CustomerInvoice, today = todayIso()): InvoiceStatus {
  const due = Number(i.amount_due) || 0;
  if (i.paid || due <= 0) return "Paid";
  if (i.due_date && i.due_date < today) return "Overdue";
  if (due < (Number(i.total) || 0)) return "Partially paid";
  return "Due";
}

export const STATUS_TONE: Record<InvoiceStatus, string> = {
  Paid: "var(--green)",
  "Partially paid": "var(--teal)",
  Due: "var(--amber)",
  Overdue: "var(--orange)",
};

/** Days past the due date (0 when not yet due). */
export function daysOverdue(i: CustomerInvoice, today = todayIso()): number {
  if (!i.due_date || i.due_date >= today) return 0;
  return Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86_400_000);
}

/** The ageing buckets from the portal brief, by days overdue. */
export const AGEING_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "Not yet due", min: 0, max: 0 },
  { label: "1–9 days", min: 1, max: 9 },
  { label: "10–19 days", min: 10, max: 19 },
  { label: "20–29 days", min: 20, max: 29 },
  { label: "30–39 days", min: 30, max: 39 },
  { label: "40+ days", min: 40, max: Infinity },
];

/** Amount owing per ageing bucket. */
export function ageing(invoices: CustomerInvoice[], today = todayIso()): { label: string; amount: number; count: number }[] {
  const out = AGEING_BUCKETS.map((b) => ({ label: b.label, amount: 0, count: 0 }));
  for (const i of invoices) {
    const due = Number(i.amount_due) || 0;
    if (i.paid || due <= 0) continue;
    const d = daysOverdue(i, today);
    const k = AGEING_BUCKETS.findIndex((b) => d >= b.min && d <= b.max);
    out[k].amount += due;
    out[k].count += 1;
  }
  return out;
}

/* ---------- data ---------- */

export const sageDb = {
  async state(): Promise<SageState | null> {
    const rows = unwrap<SageState[]>(await supabase.from("sage_state").select("*").eq("id", 1).limit(1));
    return rows[0] ?? null;
  },
  async customers(): Promise<SageCustomer[]> {
    return unwrap<SageCustomer[]>(await supabase.from("sage_customers").select("*").order("name"));
  },
  /** RLS limits a portal login to its own customer; staff pass clientId. */
  async invoices(clientId?: string): Promise<CustomerInvoice[]> {
    let q = supabase.from("customer_invoices").select("*").order("invoice_date", { ascending: false });
    if (clientId) q = q.eq("client_id", clientId);
    return unwrap<CustomerInvoice[]>(await q);
  },
  async receipts(clientId?: string): Promise<CustomerReceipt[]> {
    let q = supabase.from("customer_receipts").select("*").order("receipt_date", { ascending: false });
    if (clientId) q = q.eq("client_id", clientId);
    return unwrap<CustomerReceipt[]>(await q);
  },
  async myAccount(): Promise<{ balance: number | null; synced_at: string } | null> {
    const rows = unwrap<{ balance: number | null; synced_at: string }[]>(await supabase.rpc("my_sage_account"));
    return rows[0] ?? null;
  },
  async linkClient(clientId: string, sageId: number | null): Promise<void> {
    unwrap(await supabase.rpc("set_client_sage_customer", { p_client: clientId, p_sage_id: sageId }));
  },
  async autoMatch(): Promise<number> {
    return unwrap<number>(await supabase.rpc("sage_auto_match"));
  },
};

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};
}

/** Runs /api/sage-sync now (the cron runs it every 30 minutes). */
export async function syncSage(): Promise<{ customers: number; invoices: number; matched: number; more: boolean }> {
  const res = await fetch("/api/sage-sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: "{}",
  });
  const raw = (await res.json().catch(() => ({}))) as {
    customers?: number;
    invoices?: number;
    matched?: number;
    more?: boolean;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 404) throw new Error("Sage sync runs on the deployed site (no API here in dev).");
    throw new Error(raw.error || `Sage sync returned ${res.status}`);
  }
  return { customers: raw.customers ?? 0, invoices: raw.invoices ?? 0, matched: raw.matched ?? 0, more: !!raw.more };
}

/** Opens a Sage PDF (tax invoice or Statement of Account) in a new tab. */
export async function openSagePdf(
  req: { invoice: number } | { statement: true; client?: string; from?: string; to?: string },
): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch("/api/sage-document", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 404) throw new Error("Sage documents open on the deployed site (no API here in dev).");
      throw new Error(raw.error || `Sage returned ${res.status}`);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/* ---------- hooks ---------- */

export function useSageState() {
  return useQuery({ queryKey: ["sage_state"], queryFn: sageDb.state });
}
export function useSageCustomers(enabled = true) {
  return useQuery({ queryKey: ["sage_customers"], queryFn: sageDb.customers, enabled });
}
export function useCustomerInvoices(clientId?: string) {
  return useQuery({ queryKey: ["customer_invoices", clientId ?? "mine"], queryFn: () => sageDb.invoices(clientId) });
}
export function useCustomerReceipts(clientId?: string) {
  return useQuery({ queryKey: ["customer_receipts", clientId ?? "mine"], queryFn: () => sageDb.receipts(clientId) });
}
export function useMySageAccount() {
  return useQuery({ queryKey: ["my_sage_account"], queryFn: sageDb.myAccount });
}

function invalidateSage(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["sage_state", "sage_customers", "customer_invoices", "customer_receipts", "customer", "clients"])
    qc.invalidateQueries({ queryKey: [k] });
}
export function useLinkSageCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, sageId }: { clientId: string; sageId: number | null }) => sageDb.linkClient(clientId, sageId),
    onSuccess: () => invalidateSage(qc),
  });
}
export function useSyncSage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: syncSage, onSettled: () => invalidateSage(qc) });
}
export function useSageAutoMatch() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: sageDb.autoMatch, onSuccess: () => invalidateSage(qc) });
}
