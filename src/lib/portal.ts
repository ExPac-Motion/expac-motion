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

/** client_quotes (0141), the request / decision fields on top of ClientQuote. */
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
  /* quotation document (0152) */
  value_currency?: string | null;
  consignee_company?: string | null;
  /** FX rate of the sell currency only (null for ZAR). */
  sell_fx?: number | null;
  /* revisions (0153) */
  revision_no?: number;
  revision_pending?: boolean;
}

/** A customer's request to revise a quotation (0153). */
export interface QuoteRevisionRequest {
  id: string;
  quote_id: string;
  revision_no: number;
  reasons: string[];
  target_price: number | null;
  note: string | null;
  requested_at: string;
  answered_at: string | null;
}
export const REVISION_REASONS = ["Better price", "Different route or mode", "Different dates or transit time", "Cargo details changed", "Other"];

export const useQuoteRevisions = (quoteId: string | undefined) =>
  useQuery({
    queryKey: ["quote-revisions", quoteId],
    enabled: !!quoteId,
    queryFn: async (): Promise<QuoteRevisionRequest[]> => {
      const { data, error } = await supabase
        .from("quote_revision_requests")
        .select("*")
        .eq("quote_id", quoteId as string)
        .order("requested_at", { ascending: false });
      if (error) return []; // before 0153 is applied
      return (data ?? []) as QuoteRevisionRequest[];
    },
  });

export function useRequestRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { quoteId: string; reasons: string[]; target: number | null; note: string }) =>
      unwrap(await supabase.rpc("portal_request_revision", { p_quote: v.quoteId, p_reasons: v.reasons, p_target: v.target, p_note: v.note })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal"] });
      qc.invalidateQueries({ queryKey: ["quote-revisions"] });
    },
  });
}

/** ExPac's quotation letterhead for the portal (0152). */
export interface PortalLetterhead {
  legal_name: string;
  reg_no: string;
  vat_no: string;
  tel: string;
  email: string;
  postal_address: string;
  strapline: string;
  blurb: string;
  bank_details: string;
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
  /** Ship from stock (0149): the warehouse receipts this request is for. */
  receipt_ids?: string[];
}

/** How the customer sees a quotation's status. */
export function portalQuoteStatus(q: Pick<PortalQuote, "status" | "portal_requested_at" | "portal_decision" | "valid_until" | "revision_pending">): {
  label: string;
  cls: string;
} {
  if (q.status === "open" && q.revision_pending) return { label: "Revision requested", cls: "open" };
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
  /* editable from the portal (0145) */
  registration_no?: string | null;
  vat_no?: string | null;
  import_code?: string | null;
  company_phone?: string | null;
  contact_mobile?: string | null;
  physical_address?: string | null;
  portal_updated_at?: string | null;
}

export type CompanyDetails = Pick<PortalMe, "company" | "registration_no" | "vat_no" | "import_code" | "email" | "company_phone" | "contact_mobile" | "address" | "physical_address">;

/** Customer updates its own company details -> its clients row (0145). */
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CompanyDetails) => unwrap(await supabase.rpc("portal_update_company", { p: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal", "me"] }),
  });
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

export const usePortalLetterhead = () =>
  useQuery({
    queryKey: ["portal", "letterhead"],
    queryFn: async (): Promise<PortalLetterhead | null> =>
      unwrap(await supabase.from("client_letterhead").select("*").maybeSingle()) as PortalLetterhead | null,
  });

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

/** Time-of-day greeting in the customer's own time zone (their device's
 *  clock, so it follows their country / region): Good morning before 12:00,
 *  Good afternoon 12:00–17:59, Good evening from 18:00. */
export function timeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "Good morning, Mr Gilbert", profiles.greeting, else the login's name. */
export function greetingFor(profile: { greeting?: string | null; full_name?: string | null } | null | undefined, email?: string | null): string {
  const who = profile?.greeting?.trim() || profile?.full_name?.trim() || email?.split("@")[0] || "";
  const hello = timeGreeting();
  return who ? `${hello}, ${who}` : hello;
}

/* ---------- Shipments board (0143): tasks + comms ---------- */

export interface PortalTask {
  id: string;
  job_id: string;
  title: string;
  body: string | null;
  status: "open" | "doing" | "done";
  due_date: string | null;
  created_at: string;
  done_at: string | null;
  from_portal: boolean;
  /* 0154: notes, quotations and account-level items */
  kind?: "task" | "note";
  quote_id?: string | null;
  client_id?: string | null;
  job_reference?: string | null;
  quote_reference?: string | null;
  updated_at?: string | null;
}

/** Portal Tasks & Notes (0154): shared items (synced with Motion's Tasks &
 *  Notes) and the customer's private ones, in one list. */
export interface PortalItem {
  id: string;
  kind: "task" | "note";
  title: string;
  body: string | null;
  status: "open" | "doing" | "done";
  due_date: string | null;
  created_at: string;
  done_at: string | null;
  job_id: string | null;
  quote_id: string | null;
  job_reference: string | null;
  quote_reference: string | null;
  /** Lives in Motion (ExPac sees it). */
  shared: boolean;
  /** The customer's own (editable); false = from ExPac. */
  mine: boolean;
}
interface PrivateRow {
  id: string;
  kind: "task" | "note";
  title: string;
  body: string | null;
  status: "open" | "done";
  due_date: string | null;
  created_at: string;
  done_at: string | null;
  job_id: string | null;
  quote_id: string | null;
}

export const usePortalItems = () =>
  useQuery({
    queryKey: ["portal", "items-notes"],
    queryFn: async (): Promise<PortalItem[]> => {
      const [shared, priv] = await Promise.all([
        supabase.from("client_tasks").select("*"),
        supabase.from("client_private_items").select("*"),
      ]);
      const out: PortalItem[] = [];
      for (const t of (shared.data ?? []) as PortalTask[])
        out.push({
          id: t.id,
          kind: t.kind ?? "task",
          title: t.title,
          body: t.body,
          status: t.status,
          due_date: t.due_date,
          created_at: t.created_at,
          done_at: t.done_at,
          job_id: t.job_id,
          quote_id: t.quote_id ?? null,
          job_reference: t.job_reference ?? null,
          quote_reference: t.quote_reference ?? null,
          shared: true,
          mine: t.from_portal,
        });
      for (const p of (priv.data ?? []) as PrivateRow[])
        out.push({ ...p, job_reference: null, quote_reference: null, shared: false, mine: true });
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });

export interface PortalItemInput {
  kind: "task" | "note";
  title: string;
  body: string;
  due_date: string;
  job_id: string;
  quote_id: string;
  share: boolean;
}

/** Add / edit / delete / share / make private, for the customer's own items. */
export function usePortalItemActions() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["portal", "items-notes"] });
    qc.invalidateQueries({ queryKey: ["portal", "tasks"] });
  };
  const wrap = <V,>(fn: (v: V) => Promise<unknown>) => useMutation({ mutationFn: fn, onSuccess: done });
  return {
    add: wrap(async (v: PortalItemInput) => {
      if (v.share) {
        unwrap(await supabase.rpc("portal_save_item", { p: { kind: v.kind, title: v.title, body: v.body, due_date: v.due_date || null, job_id: v.job_id || null, quote_id: v.quote_id || null } }));
      } else {
        if (!v.title.trim() && !v.body.trim()) throw new Error("Write something first");
        unwrap(
          await supabase.from("client_private_items").insert({
            kind: v.kind,
            title: v.title.trim() || v.body.trim().slice(0, 80),
            body: v.body.trim() || null,
            due_date: v.due_date || null,
            job_id: v.job_id || null,
            quote_id: v.quote_id || null,
          }),
        );
      }
    }),
    update: wrap(async (v: { item: PortalItem; patch: Partial<Pick<PortalItem, "title" | "body" | "due_date" | "status">> }) => {
      const patch = { ...v.patch, ...(v.patch.status ? { done_at: v.patch.status === "done" ? new Date().toISOString() : null } : {}) };
      if (v.item.shared) unwrap(await supabase.rpc("portal_update_item", { p_id: v.item.id, p: v.patch }));
      else unwrap(await supabase.from("client_private_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", v.item.id));
    }),
    remove: wrap(async (item: PortalItem) => {
      if (item.shared) unwrap(await supabase.rpc("portal_delete_item", { p_id: item.id }));
      else unwrap(await supabase.from("client_private_items").delete().eq("id", item.id));
    }),
    share: wrap(async (item: PortalItem) => unwrap(await supabase.rpc("portal_share_item", { p_id: item.id }))),
    unshare: wrap(async (item: PortalItem) => unwrap(await supabase.rpc("portal_unshare_item", { p_id: item.id }))),
  };
}
export interface PortalMsgStamp {
  id: string;
  job_id: string;
  direction: "in" | "out";
  created_at: string;
}

export const usePortalTasks = () =>
  useQuery({
    queryKey: ["portal", "tasks"],
    queryFn: async (): Promise<PortalTask[]> => {
      const { data, error } = await supabase.from("client_tasks").select("*").order("created_at", { ascending: false });
      if (error) return []; // before 0143 is applied
      return (data ?? []) as PortalTask[];
    },
  });

/** Every message stamp across the customer's shipments, for the unread dot. */
export const usePortalMsgStamps = () =>
  useQuery({
    queryKey: ["portal", "msgstamps"],
    queryFn: async (): Promise<PortalMsgStamp[]> =>
      unwrap(await supabase.from("client_messages").select("id, job_id, direction, created_at").order("created_at", { ascending: false })),
    refetchInterval: 60_000,
  });

export function useCreatePortalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jobId: string; title: string; body: string; due: string }) =>
      unwrap(await supabase.rpc("portal_create_task", { p_job: v.jobId, p_title: v.title, p_body: v.body, p_due: v.due || null })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal", "tasks"] }),
  });
}

/** Comms "seen" marker per shipment, kept in this browser. */
export function commsSeen(jobId: string): string {
  try {
    return localStorage.getItem(`pt-comms-seen-${jobId}`) ?? "";
  } catch {
    return "";
  }
}
export function markCommsSeen(jobId: string) {
  try {
    localStorage.setItem(`pt-comms-seen-${jobId}`, new Date().toISOString());
  } catch {
    /* private mode */
  }
}

/** What's new (0144): images in Media › Announcements, newest first. */
export const usePortalAnnouncements = () =>
  useQuery({
    queryKey: ["portal", "announcements"],
    queryFn: async (): Promise<{ id: string; title: string; url: string; created_at: string }[]> => {
      const { data, error } = await supabase.from("client_announcements").select("*").order("created_at", { ascending: false });
      if (error) return []; // before 0144 is applied
      return ((data ?? []) as { id: string; name: string; url: string; created_at: string }[]).map((a) => ({
        id: a.id,
        url: a.url,
        created_at: a.created_at,
        // "new-lcl-service.png" -> "new lcl service"
        title: a.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "),
      }));
    },
  });

/* ---------- Warehouse journey (0147) ---------- */

export interface WmsTrackerRow {
  receipt_id: string;
  checked_at: string | null;
  consol_no: string | null;
  consol_mode: "air" | "lcl" | "fcl" | null;
  consol_status: "open" | "closed" | "departed" | null;
  master_no: string | null;
  house_no: string | null;
  transport: string | null;
  etd: string | null;
  eta: string | null;
  shipment_ref: string | null;
  shipment_id: string | null;
  release_no: string | null;
  released_at: string | null;
  outbound_ref: string | null;
}
export type WmsStage = "received" | "checked" | "preparing" | "shipped" | "part_shipped";

export const usePortalWmsTracker = () =>
  useQuery({
    queryKey: ["portal", "wms-tracker"],
    queryFn: async (): Promise<WmsTrackerRow[]> => {
      const { data, error } = await supabase.from("client_wms_tracker").select("*");
      if (error) return []; // before 0147 is applied
      return (data ?? []) as WmsTrackerRow[];
    },
  });

/** Where a receipt is in its journey. Shipped = nothing left in store. */
export function wmsStage(r: { on_hand: number; pieces: number }, t: WmsTrackerRow | undefined): WmsStage {
  if (r.pieces > 0 && r.on_hand <= 0) return "shipped";
  if (r.on_hand < r.pieces) return "part_shipped";
  if (t?.consol_no && t.consol_status !== "departed") return "preparing";
  if (t?.checked_at) return "checked";
  return "received";
}
export const WMS_STAGE_LABEL: Record<WmsStage, string> = {
  received: "Received",
  checked: "Checked",
  preparing: "Being prepared for shipping",
  part_shipped: "Part shipped",
  shipped: "Shipped",
};
