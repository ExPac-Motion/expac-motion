import { supabase } from "./supabase";
import {
  insuranceAmount,
  packingTotals,
  resolveLines,
  volumetricFactor,
} from "./calc";
import type {
  Client,
  CompanySettings,
  CompanySettingsPatch,
  Contact,
  ImportDutyDraft,
  ImportVatDuty,
  Job,
  JobInsert,
  JobPatch,
  JobTracking,
  Message,
  MessagePatch,
  Milestone,
  OpsTask,
  OpsTaskPatch,
  ClientDocument,
  ClientInvite,
  ClientJob,
  ClientMessage,
  ClientQuote,
  ClientQuoteLine,
  Profile,
  ProfilePatch,
  Quote,
  QuoteDraft,
  RateSheetItem,
  RateSheetPatch,
  ShipmentDocument,
  Supplier,
  Lead,
  LeadPatch,
  LeadContact,
  LeadContactDraft,
  LeadStatus,
  LeadStatusPatch,
  Opportunity,
  OpportunityPatch,
  MailTemplate,
  MailTemplatePatch,
  MediaAsset,
  MailCampaign,
  MailCampaignPatch,
  MailCampaignRecipient,
  FollowUpRule,
  FollowUpRulePatch,
  FollowUpLogEntry,
  WebForm,
  WebFormPatch,
  WebFormSubmission,
  PublicWebForm,
} from "./types";

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

/* ---------- Clients ---------- */
export async function listClients(): Promise<Client[]> {
  return unwrap(
    await supabase.from("clients").select("*").order("company", { ascending: true }),
  );
}
export async function createClient(
  input: Omit<Client, "id" | "created_at">,
): Promise<Client> {
  return unwrap(
    await supabase.from("clients").insert(input).select("*").single(),
  );
}
export async function updateClient(
  id: string,
  input: Partial<Omit<Client, "id" | "created_at">>,
): Promise<Client> {
  return unwrap(
    await supabase.from("clients").update(input).eq("id", id).select("*").single(),
  );
}
export async function deleteClient(id: string): Promise<void> {
  unwrap(await supabase.from("clients").delete().eq("id", id));
}

export type ContactTable =
  | "clients"
  | "suppliers"
  | "agents"
  | "transporters"
  | "clearing_agents";

/** Apply one patch to every listed contact (Bulk Edit on a contact book). */
export async function updateContactsBulk(
  table: ContactTable,
  ids: string[],
  patch: Partial<Omit<Contact, "id" | "created_at">>,
): Promise<void> {
  if (ids.length === 0) return;
  unwrap(await supabase.from(table).update(patch).in("id", ids).select("id"));
}

/* ---------- Suppliers ---------- */
export async function listSuppliers(): Promise<Supplier[]> {
  return unwrap(
    await supabase.from("suppliers").select("*").order("company", { ascending: true }),
  );
}
export async function createSupplier(
  input: Omit<Supplier, "id" | "created_at">,
): Promise<Supplier> {
  return unwrap(
    await supabase.from("suppliers").insert(input).select("*").single(),
  );
}
export async function updateSupplier(
  id: string,
  input: Partial<Omit<Supplier, "id" | "created_at">>,
): Promise<Supplier> {
  return unwrap(
    await supabase.from("suppliers").update(input).eq("id", id).select("*").single(),
  );
}
export async function deleteSupplier(id: string): Promise<void> {
  unwrap(await supabase.from("suppliers").delete().eq("id", id));
}

/* ---------- Agents ---------- */
export async function listAgents(): Promise<Contact[]> {
  return unwrap(
    await supabase.from("agents").select("*").order("company", { ascending: true }),
  );
}
export async function createAgent(
  input: Omit<Contact, "id" | "created_at">,
): Promise<Contact> {
  return unwrap(
    await supabase.from("agents").insert(input).select("*").single(),
  );
}
export async function updateAgent(
  id: string,
  input: Partial<Omit<Contact, "id" | "created_at">>,
): Promise<Contact> {
  return unwrap(
    await supabase.from("agents").update(input).eq("id", id).select("*").single(),
  );
}
export async function deleteAgent(id: string): Promise<void> {
  unwrap(await supabase.from("agents").delete().eq("id", id));
}

/* ---------- Transporters ---------- */
export async function listTransporters(): Promise<Contact[]> {
  return unwrap(
    await supabase
      .from("transporters")
      .select("*")
      .order("company", { ascending: true }),
  );
}
export async function createTransporter(
  input: Omit<Contact, "id" | "created_at">,
): Promise<Contact> {
  return unwrap(
    await supabase.from("transporters").insert(input).select("*").single(),
  );
}
export async function updateTransporter(
  id: string,
  input: Partial<Omit<Contact, "id" | "created_at">>,
): Promise<Contact> {
  return unwrap(
    await supabase
      .from("transporters")
      .update(input)
      .eq("id", id)
      .select("*")
      .single(),
  );
}
export async function deleteTransporter(id: string): Promise<void> {
  unwrap(await supabase.from("transporters").delete().eq("id", id));
}

/* ---------- Clearing agents ---------- */
export async function listClearingAgents(): Promise<Contact[]> {
  return unwrap(
    await supabase
      .from("clearing_agents")
      .select("*")
      .order("company", { ascending: true }),
  );
}
export async function createClearingAgent(
  input: Omit<Contact, "id" | "created_at">,
): Promise<Contact> {
  return unwrap(
    await supabase.from("clearing_agents").insert(input).select("*").single(),
  );
}
export async function updateClearingAgent(
  id: string,
  input: Partial<Omit<Contact, "id" | "created_at">>,
): Promise<Contact> {
  return unwrap(
    await supabase
      .from("clearing_agents")
      .update(input)
      .eq("id", id)
      .select("*")
      .single(),
  );
}
export async function deleteClearingAgent(id: string): Promise<void> {
  unwrap(await supabase.from("clearing_agents").delete().eq("id", id));
}

/* ---------- Quotes ---------- */
const QUOTE_SELECT =
  "*, quote_lines(*), packing_list_items(*), client:clients(id,company), lead:leads(id,company,contact,email,phone,address,vat_no), supplier:suppliers(id,company), agent:agents(id,company), transporter:transporters(id,company), clearing_agent:clearing_agents(id,company)";

function sortLines(q: Quote): Quote {
  q.quote_lines = [...(q.quote_lines || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  q.packing_list_items = [...(q.packing_list_items || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  return q;
}

export async function listQuotes(): Promise<Quote[]> {
  const rows = unwrap<Quote[]>(
    await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .order("created_at", { ascending: false }),
  );
  return rows.map(sortLines);
}

export async function getQuote(id: string): Promise<Quote> {
  const row = unwrap<Quote>(
    await supabase.from("quotes").select(QUOTE_SELECT).eq("id", id).single(),
  );
  return sortLines(row);
}

/**
 * Persists a quote and all of its charge lines atomically via the save_quote RPC.
 * Returns the quote id (new or existing).
 */
export async function saveQuote(draft: QuoteDraft): Promise<string> {
  const pack = packingTotals(draft.packing, volumetricFactor(draft.mode));
  const ctx = {
    mode: draft.mode,
    fx: {
      usd: Number(draft.fx_usd_zar) || 0,
      cny: Number(draft.fx_cny_zar) || 0,
    },
    pack,
    commercialValue: draft.commercial_value,
  };
  const resolved = resolveLines(draft.lines, ctx);
  const lines = draft.lines.map((l, i) => {
    const r = resolved[i];
    return {
      position: i,
      category: l.category,
      code: (l.code ?? "").toString(),
      description: (l.description ?? "").toString(),
      cur: l.cur,
      unit: (l.unit ?? "").toString(),
      qty: Number(r.qty) || 0,
      qty_override: !!l.qty_override,
      fee_rate:
        l.fee_rate === "" || l.fee_rate == null ? null : Number(l.fee_rate),
      buy: Number(r.buy) || 0,
      margin: Number(r.margin) || 0,
      vat_pct: Number(r.vat_pct) || 0,
      sell: Number(r.sell) || 0,
    };
  });
  const packing = draft.packing.map((p, i) => ({
    position: i,
    length_cm: Number(p.length_cm) || 0,
    width_cm: Number(p.width_cm) || 0,
    height_cm: Number(p.height_cm) || 0,
    actual_kg: Number(p.actual_kg) || 0,
    qty_ctns: Number(p.qty_ctns) || 0,
    cbm:
      p.cbm === "" || p.cbm == null || Number.isNaN(Number(p.cbm))
        ? null
        : Number(p.cbm),
  }));
  const id = unwrap<string>(
    await supabase.rpc("save_quote", {
      p_id: draft.id,
      p_reference: draft.reference.trim(),
      p_customer_reference: draft.customer_reference.trim() || null,
      p_client_id: draft.client_id || null,
      p_lead_id: draft.lead_id || null,
      p_sales_person_id: draft.sales_person_id || null,
      p_supplier_id: draft.supplier_id || null,
      p_agent_id: draft.agent_id || null,
      p_transporter_id: draft.transporter_id || null,
      p_clearing_agent_id: draft.clearing_agent_id || null,
      p_mode: draft.mode,
      p_commodity: draft.commodity.trim() || null,
      p_origin: draft.origin.trim() || null,
      p_destination: draft.destination.trim() || null,
      p_delivery_terms: draft.delivery_terms.trim() || null,
      p_valid_until: draft.valid_until || null,
      p_status: draft.status,
      p_commercial_value:
        draft.commercial_value === "" ? null : Number(draft.commercial_value),
      p_insurance_amount:
        draft.commercial_value === ""
          ? null
          : insuranceAmount(draft.commercial_value),
      p_vessel_name: draft.vessel_name.trim() || null,
      p_mbl_no: draft.mbl_no.trim() || null,
      p_hbl_no: draft.hbl_no.trim() || null,
      p_container_no: draft.container_no.trim() || null,
      p_etd: draft.etd || null,
      p_eta: draft.eta || null,
      p_incoterms: draft.incoterms.trim() || null,
      p_mawb_no: draft.mawb_no.trim() || null,
      p_hawb_no: draft.hawb_no.trim() || null,
      p_flight_no: draft.flight_no.trim() || null,
      p_flight_date: draft.flight_date || null,
      p_carrier_name: draft.carrier_name.trim() || null,
      p_fx_usd_zar: Number(draft.fx_usd_zar) || 0,
      p_fx_cny_zar: Number(draft.fx_cny_zar) || 0,
      p_lines: lines,
      p_packing: packing,
    }),
  );
  return id;
}

export async function deleteQuote(id: string): Promise<void> {
  unwrap(await supabase.from("quotes").delete().eq("id", id));
}

/** Apply one patch to every listed quote (Bulk Edit on the Quotations table). */
export async function updateQuotesBulk(
  ids: string[],
  patch: { status?: string; sales_person_id?: string | null },
): Promise<void> {
  if (ids.length === 0) return;
  unwrap(await supabase.from("quotes").update(patch).in("id", ids).select("id"));
}

/* ---------- Import VAT / Duty Output ---------- */

/** The worksheet for a quote, or null if none has been saved yet. */
export async function getImportVatDuty(
  quoteId: string,
): Promise<ImportVatDuty | null> {
  const { data, error } = await supabase
    .from("import_vat_duty")
    .select("*, import_vat_duty_lines(*)")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ImportVatDuty;
  row.import_vat_duty_lines = [...(row.import_vat_duty_lines || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  return row;
}

export async function saveImportVatDuty(
  draft: ImportDutyDraft,
): Promise<string> {
  const lines = draft.lines.map((l, i) => ({
    position: i,
    description: (l.description ?? "").toString(),
    qty_pcs: Number(l.qty_pcs) || 0,
    unit_price: Number(l.unit_price) || 0,
    cur: l.cur || "USD",
    roe: Number(l.roe) || 0,
    duty_rate_pct: Number(l.duty_rate_pct) || 0,
  }));
  return unwrap<string>(
    await supabase.rpc("save_import_vat_duty", {
      p_quote_id: draft.quote_id,
      p_po_no: draft.po_no.trim() || null,
      p_vat_uplift_pct: Number(draft.vat_uplift_pct) || 0,
      p_vat_rate_pct: Number(draft.vat_rate_pct) || 0,
      p_lines: lines,
    }),
  );
}

/** Push a computed customs total onto the quote as its CU-02 / CU-03 / DIS-01
 *  line. `feeRate` (a percentage) is stored on the line for DIS-01 so the
 *  Quote Builder keeps re-rating it against the VAT + Duty on the quote. */
export async function addCustomsLineToQuote(
  quoteId: string,
  code: "CU-02" | "CU-03" | "DIS-01",
  amount: number,
  feeRate?: number | null,
): Promise<void> {
  unwrap(
    await supabase.rpc("add_customs_line_to_quote", {
      p_quote_id: quoteId,
      p_code: code,
      p_amount: amount,
      p_fee_rate: feeRate ?? null,
    }),
  );
}

/** Marks the quote accepted and creates the linked job (idempotent). Returns the job id. */
export async function acceptQuote(quoteId: string): Promise<string> {
  return unwrap<string>(
    await supabase.rpc("accept_quote", { p_quote_id: quoteId }),
  );
}

/* ---------- Jobs ---------- */
const JOB_SELECT =
  "*, client:clients(id,company,email), supplier:suppliers(id,company,email), job_events(*)";

export async function listJobs(): Promise<Job[]> {
  const rows = unwrap<Job[]>(
    await supabase
      .from("jobs")
      .select(JOB_SELECT)
      .order("created_at", { ascending: false }),
  );
  return rows.map((j) => {
    j.job_events = [...(j.job_events || [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return j;
  });
}

/** Inline field edits on the Active Jobs board (empty string -> null). */
export async function updateJob(id: string, patch: JobPatch): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    clean[k] = v === "" ? null : v;
  }
  unwrap(await supabase.from("jobs").update(clean).eq("id", id).select("id"));
}

export async function deleteJob(id: string): Promise<void> {
  unwrap(await supabase.from("jobs").delete().eq("id", id));
}

/** Apply one patch to every listed job (Bulk Edit on the Shipments board). */
export async function updateJobsBulk(
  ids: string[],
  patch: JobPatch,
): Promise<void> {
  if (ids.length === 0) return;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) clean[k] = v === "" ? null : v;
  unwrap(await supabase.from("jobs").update(clean).in("id", ids).select("id"));
}

/** Inserts a standalone job row (Duplicate on the board) — not tied to a quote. */
export async function createJob(values: JobInsert): Promise<Job> {
  return unwrap<Job>(
    await supabase.from("jobs").insert(values).select(JOB_SELECT).single(),
  );
}

export async function setJobMilestone(
  jobId: string,
  milestone: Milestone,
  note?: string,
): Promise<void> {
  unwrap(
    await supabase.rpc("set_job_milestone", {
      p_job_id: jobId,
      p_milestone: milestone,
      p_note: note ?? null,
    }),
  );
}

/* ---------- Operations Control Tower: Tasks & Notes ---------- */
const OPS_TASK_SELECT =
  "*, job:jobs(id,reference), quote:quotes(id,reference), client:clients(id,company)";

export async function listOpsTasks(): Promise<OpsTask[]> {
  return unwrap<OpsTask[]>(
    await supabase
      .from("ops_tasks")
      .select(OPS_TASK_SELECT)
      .order("created_at", { ascending: false }),
  );
}

export async function createOpsTask(
  input: OpsTaskPatch & { title: string },
): Promise<OpsTask> {
  return unwrap<OpsTask>(
    await supabase.from("ops_tasks").insert(input).select(OPS_TASK_SELECT).single(),
  );
}

export async function updateOpsTask(
  id: string,
  patch: OpsTaskPatch,
): Promise<OpsTask> {
  return unwrap<OpsTask>(
    await supabase
      .from("ops_tasks")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(OPS_TASK_SELECT)
      .single(),
  );
}

export async function deleteOpsTask(id: string): Promise<void> {
  unwrap(await supabase.from("ops_tasks").delete().eq("id", id));
}

/* ---------- Operations Control Tower: Live Tracking ---------- */
export async function listJobTracking(): Promise<JobTracking[]> {
  return unwrap<JobTracking[]>(
    await supabase.from("job_tracking").select("*"),
  );
}

export async function upsertJobTracking(
  row: Partial<JobTracking> & { job_id: string },
): Promise<JobTracking> {
  return unwrap<JobTracking>(
    await supabase
      .from("job_tracking")
      .upsert(row, { onConflict: "job_id" })
      .select("*")
      .single(),
  );
}

/* ---------- Shipment Comms (messages) ---------- */
export async function listMessages(jobId: string): Promise<Message[]> {
  return unwrap<Message[]>(
    await supabase
      .from("messages")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
  );
}

export async function createMessage(
  row: Partial<Message> & { job_id: string; kind: Message["kind"] },
): Promise<Message> {
  return unwrap<Message>(
    await supabase.from("messages").insert(row).select("*").single(),
  );
}

export async function updateMessage(
  id: string,
  patch: MessagePatch,
): Promise<Message> {
  return unwrap<Message>(
    await supabase.from("messages").update(patch).eq("id", id).select("*").single(),
  );
}

/** Bulk fetch for the CRM activity timeline (a client's messages across all their jobs). */
export async function listMessagesForJobs(jobIds: string[]): Promise<Message[]> {
  if (jobIds.length === 0) return [];
  return unwrap<Message[]>(
    await supabase
      .from("messages")
      .select("*")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false }),
  );
}

/** Bulk fetch for the CRM activity timeline (a client's documents across all their jobs). */
export async function listShipmentDocumentsForJobs(
  jobIds: string[],
): Promise<ShipmentDocument[]> {
  if (jobIds.length === 0) return [];
  return unwrap<ShipmentDocument[]>(
    await supabase
      .from("shipment_documents")
      .select("*")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false }),
  );
}

/* ---------- Customer Portal ---------- */
export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const row = unwrap<Profile | null>(
    await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle(),
  );
  return row ? { ...row, email: auth.user.email } : null;
}

export async function createClientInvite(clientId: string): Promise<ClientInvite> {
  return unwrap<ClientInvite>(
    await supabase
      .from("client_invites")
      .insert({ client_id: clientId })
      .select("*")
      .single(),
  );
}

export async function getInvite(token: string): Promise<ClientInvite> {
  return unwrap<ClientInvite>(
    await supabase.from("client_invites").select("*").eq("token", token).single(),
  );
}

export async function claimClientInvite(token: string): Promise<void> {
  unwrap(await supabase.rpc("claim_client_invite", { p_token: token }));
}

export async function listMyQuotes(): Promise<ClientQuote[]> {
  return unwrap<ClientQuote[]>(
    await supabase
      .from("client_quotes")
      .select("*")
      .order("created_at", { ascending: false }),
  );
}

export async function listMyQuoteLines(quoteId: string): Promise<ClientQuoteLine[]> {
  return unwrap<ClientQuoteLine[]>(
    await supabase
      .from("client_quote_lines")
      .select("*")
      .eq("quote_id", quoteId)
      .order("position"),
  );
}

export async function listMyJobs(): Promise<ClientJob[]> {
  return unwrap<ClientJob[]>(
    await supabase
      .from("client_jobs")
      .select("*")
      .order("created_at", { ascending: false }),
  );
}

export async function listMyMessages(jobId: string): Promise<ClientMessage[]> {
  return unwrap<ClientMessage[]>(
    await supabase
      .from("client_messages")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
  );
}

export async function sendMyMessage(jobId: string, body: string): Promise<void> {
  unwrap(
    await supabase.rpc("client_send_message", { p_job_id: jobId, p_body: body }),
  );
}

export async function listMyDocuments(jobId: string): Promise<ClientDocument[]> {
  return unwrap<ClientDocument[]>(
    await supabase
      .from("client_documents")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
  );
}

export async function getMyDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(storagePath, 300);
  if (error || !data) throw error ?? new Error("Could not create download link");
  return data.signedUrl;
}

/* ---------- Settings ---------- */
export async function getCompanySettings(): Promise<CompanySettings> {
  return unwrap<CompanySettings>(
    await supabase.from("company_settings").select("*").eq("id", 1).single(),
  );
}

export async function updateCompanySettings(
  patch: CompanySettingsPatch,
): Promise<CompanySettings> {
  return unwrap<CompanySettings>(
    await supabase
      .from("company_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select("*")
      .single(),
  );
}

export async function listProfiles(): Promise<Profile[]> {
  return unwrap<Profile[]>(
    await supabase.from("profiles").select("*").order("created_at"),
  );
}

export async function updateProfile(
  id: string,
  patch: ProfilePatch,
): Promise<Profile> {
  return unwrap<Profile>(
    await supabase.from("profiles").update(patch).eq("id", id).select("*").single(),
  );
}

/** Apply one patch to every listed team member (Bulk Edit on Sales Person). */
export async function updateProfilesBulk(
  ids: string[],
  patch: ProfilePatch,
): Promise<void> {
  if (ids.length === 0) return;
  unwrap(
    await supabase.from("profiles").update(patch).in("id", ids).select("id"),
  );
}

/* ---------- Rates & Tariff Sheet ---------- */
export async function listRateSheet(): Promise<RateSheetItem[]> {
  return unwrap<RateSheetItem[]>(
    await supabase.from("rate_sheet").select("*").order("mode").order("description"),
  );
}

export async function saveRateSheetItem(
  id: string | undefined,
  patch: RateSheetPatch,
): Promise<RateSheetItem> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<RateSheetItem>(
    id
      ? await supabase.from("rate_sheet").update(row).eq("id", id).select("*").single()
      : await supabase.from("rate_sheet").insert(row).select("*").single(),
  );
}

export async function deleteRateSheetItem(id: string): Promise<void> {
  unwrap(await supabase.from("rate_sheet").delete().eq("id", id));
}

/** Apply one patch to every listed rate (Bulk Edit on the Rates & Tariff sheet). */
export async function updateRateSheetItemsBulk(
  ids: string[],
  patch: RateSheetPatch,
): Promise<void> {
  if (ids.length === 0) return;
  const row = { ...patch, updated_at: new Date().toISOString() };
  unwrap(
    await supabase.from("rate_sheet").update(row).in("id", ids).select("id"),
  );
}

/* ---------- Sales CRM: Leads ---------- */
const LEAD_SELECT =
  "*, lead_status:lead_statuses(id,name,promotes_to_customer), sales_person:profiles(id,full_name)";

export async function listLeadStatuses(): Promise<LeadStatus[]> {
  return unwrap<LeadStatus[]>(
    await supabase.from("lead_statuses").select("*").order("sort_order"),
  );
}

export async function saveLeadStatus(
  id: string | undefined,
  patch: LeadStatusPatch,
): Promise<LeadStatus> {
  return unwrap<LeadStatus>(
    id
      ? await supabase.from("lead_statuses").update(patch).eq("id", id).select("*").single()
      : await supabase.from("lead_statuses").insert(patch).select("*").single(),
  );
}

export async function deleteLeadStatus(id: string): Promise<void> {
  unwrap(await supabase.from("lead_statuses").delete().eq("id", id));
}

export async function listLeads(): Promise<Lead[]> {
  return unwrap<Lead[]>(
    await supabase
      .from("leads")
      .select(LEAD_SELECT)
      .order("created_at", { ascending: false }),
  );
}

export async function saveLead(
  id: string | undefined,
  patch: LeadPatch,
): Promise<Lead> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<Lead>(
    id
      ? await supabase.from("leads").update(row).eq("id", id).select(LEAD_SELECT).single()
      : await supabase.from("leads").insert(row).select(LEAD_SELECT).single(),
  );
}

export async function deleteLead(id: string): Promise<void> {
  unwrap(await supabase.from("leads").delete().eq("id", id));
}

/** Apply one patch to every listed lead (Bulk Edit on the Leads table). */
export async function updateLeadsBulk(
  ids: string[],
  patch: LeadPatch,
): Promise<void> {
  if (ids.length === 0) return;
  const row = { ...patch, updated_at: new Date().toISOString() };
  unwrap(await supabase.from("leads").update(row).in("id", ids).select("id"));
}

/** Bulk create from a CSV/Excel import — bad rows are skipped, not fatal. */
export async function createLeadsBulk(
  rows: Array<
    Pick<LeadPatch, "company" | "contact" | "email" | "phone" | "website" | "source">
  >,
): Promise<Lead[]> {
  if (rows.length === 0) return [];
  return unwrap<Lead[]>(
    await supabase.from("leads").insert(rows).select(LEAD_SELECT),
  );
}

export async function listLeadContacts(leadId: string): Promise<LeadContact[]> {
  return unwrap<LeadContact[]>(
    await supabase
      .from("lead_contacts")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at"),
  );
}

/** Bulk insert (CSV import) -- extra contacts spread across many leads. */
export async function createLeadContacts(
  rows: Array<{
    lead_id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  unwrap(await supabase.from("lead_contacts").insert(rows));
}

/** Replace-all: the lead edit modal owns the full set of extra contacts. */
export async function replaceLeadContacts(
  leadId: string,
  contacts: LeadContactDraft[],
): Promise<void> {
  unwrap(await supabase.from("lead_contacts").delete().eq("lead_id", leadId));
  const rows = contacts
    .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
    .map((c) => ({
      lead_id: leadId,
      name: c.name.trim(),
      role: c.role.trim() || null,
      email: c.email.trim() || null,
      phone: c.phone.trim() || null,
    }));
  if (rows.length) unwrap(await supabase.from("lead_contacts").insert(rows));
}

/* ---------- Sales CRM: Opportunities ---------- */
const OPPORTUNITY_SELECT =
  "*, lead:leads(id,company,contact,email,phone,lead_status_id), client:clients(id,company,contact,email,phone), quote:quotes(id,reference,status), job:jobs(id,reference,shipment_status,milestone), sales_person:profiles(id,full_name)";

export async function listOpportunities(): Promise<Opportunity[]> {
  return unwrap<Opportunity[]>(
    await supabase
      .from("opportunities")
      .select(OPPORTUNITY_SELECT)
      .order("created_at", { ascending: false }),
  );
}

export async function createOpportunity(
  patch: OpportunityPatch,
): Promise<Opportunity> {
  return unwrap<Opportunity>(
    await supabase
      .from("opportunities")
      .insert(patch)
      .select(OPPORTUNITY_SELECT)
      .single(),
  );
}

export async function updateOpportunity(
  id: string,
  patch: OpportunityPatch,
): Promise<Opportunity> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<Opportunity>(
    await supabase
      .from("opportunities")
      .update(row)
      .eq("id", id)
      .select(OPPORTUNITY_SELECT)
      .single(),
  );
}

export async function deleteOpportunity(id: string): Promise<void> {
  unwrap(await supabase.from("opportunities").delete().eq("id", id));
}

/* ---------- Sales CRM: Mail Templates ---------- */
export async function listMailTemplates(): Promise<MailTemplate[]> {
  return unwrap<MailTemplate[]>(
    await supabase.from("mail_templates").select("*").order("name"),
  );
}

export async function saveMailTemplate(
  id: string | undefined,
  patch: MailTemplatePatch,
): Promise<MailTemplate> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<MailTemplate>(
    id
      ? await supabase.from("mail_templates").update(row).eq("id", id).select("*").single()
      : await supabase.from("mail_templates").insert(row).select("*").single(),
  );
}

export async function deleteMailTemplate(id: string): Promise<void> {
  unwrap(await supabase.from("mail_templates").delete().eq("id", id));
}

/** Public bucket -- inline images/attachments must be reachable by URL
 *  from an external recipient's inbox, with no Supabase auth of its own. */
const MAIL_ASSETS_BUCKET = "mail-assets";

/** Optional CDN host fronting the public `mail-assets` bucket on an
 *  expac.co.za subdomain (e.g. https://cdn.expac.co.za/mail-assets), so
 *  `<img>` src values in emails align with the sending domain and don't
 *  trip Outlook/SmartScreen's domain-misalignment phishing signal. Set
 *  `VITE_MAIL_CDN_BASE` in the Cloudflare Pages env once the custom domain
 *  is live; until then this is empty and the raw supabase.co URL is used. */
const MAIL_CDN_BASE = (
  (import.meta.env.VITE_MAIL_CDN_BASE as string | undefined) ?? ""
).replace(/\/+$/, "");

/** Public URL for a `mail-assets` object, routed through the CDN domain
 *  when one is configured. Guarded so it degrades to the Supabase public
 *  URL if `VITE_MAIL_CDN_BASE` is unset. */
export function publicMailAssetUrl(storagePath: string): string {
  const { data } = supabase.storage
    .from(MAIL_ASSETS_BUCKET)
    .getPublicUrl(storagePath);
  if (!MAIL_CDN_BASE) return data.publicUrl;
  const marker = `/object/public/${MAIL_ASSETS_BUCKET}/`;
  const i = data.publicUrl.indexOf(marker);
  return i === -1
    ? data.publicUrl
    : `${MAIL_CDN_BASE}/${data.publicUrl.slice(i + marker.length)}`;
}

export async function uploadMailAsset(
  file: File,
): Promise<{ name: string; url: string; size: number }> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const up = await supabase.storage.from(MAIL_ASSETS_BUCKET).upload(path, file);
  if (up.error) throw up.error;
  return { name: file.name, url: publicMailAssetUrl(path), size: file.size };
}

/* ---------- Sales CRM: Media library ---------- */

export async function listMediaAssets(): Promise<MediaAsset[]> {
  return unwrap<MediaAsset[]>(
    await supabase
      .from("media_assets")
      .select("*")
      .order("created_at", { ascending: false }),
  );
}

/** Uploads into the shared public `mail-assets` bucket (under a `media/`
 *  prefix) and records a reusable `media_assets` row in the given folder. */
export async function uploadMediaAsset(
  file: File,
  folder: string,
): Promise<MediaAsset> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const storagePath = `media/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const up = await supabase.storage
    .from(MAIL_ASSETS_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;
  return unwrap<MediaAsset>(
    await supabase
      .from("media_assets")
      .insert({
        folder: folder.trim() || "General",
        name: file.name,
        url: publicMailAssetUrl(storagePath),
        storage_path: storagePath,
        size_bytes: file.size,
        mime: file.type || null,
      })
      .select("*")
      .single(),
  );
}

/** Records a `media_assets` row for a file that has already been uploaded
 *  to the `mail-assets` bucket (e.g. by the rich-text editor's own image
 *  upload path), so it becomes reusable from the Media gallery. */
export async function recordMediaAsset(input: {
  folder: string;
  name: string;
  url: string;
  storage_path: string;
  size_bytes?: number | null;
  mime?: string | null;
}): Promise<MediaAsset> {
  return unwrap<MediaAsset>(
    await supabase
      .from("media_assets")
      .insert({
        folder: input.folder.trim() || "General",
        name: input.name,
        url: input.url,
        storage_path: input.storage_path,
        size_bytes: input.size_bytes ?? null,
        mime: input.mime ?? null,
      })
      .select("*")
      .single(),
  );
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const row = unwrap<{ storage_path: string }>(
    await supabase
      .from("media_assets")
      .select("storage_path")
      .eq("id", id)
      .single(),
  );
  // Best-effort object cleanup; the row delete is the source of truth.
  await supabase.storage.from(MAIL_ASSETS_BUCKET).remove([row.storage_path]);
  unwrap(await supabase.from("media_assets").delete().eq("id", id));
}

export async function renameMediaAsset(
  id: string,
  name: string,
): Promise<MediaAsset> {
  return unwrap<MediaAsset>(
    await supabase
      .from("media_assets")
      .update({ name: name.trim() || "Untitled" })
      .eq("id", id)
      .select("*")
      .single(),
  );
}

/** Move an asset into a different folder (metadata only — the stored file
 *  keeps its path; folders here are just a `folder` label). */
export async function moveMediaAsset(
  id: string,
  folder: string,
): Promise<MediaAsset> {
  return unwrap<MediaAsset>(
    await supabase
      .from("media_assets")
      .update({ folder: folder.trim() || "General" })
      .eq("id", id)
      .select("*")
      .single(),
  );
}

/* ---------- Sales CRM: Mail Campaigns ---------- */
export async function listMailCampaigns(): Promise<MailCampaign[]> {
  return unwrap<MailCampaign[]>(
    await supabase
      .from("mail_campaigns")
      .select("*")
      .order("created_at", { ascending: false }),
  );
}

export async function createMailCampaign(
  patch: MailCampaignPatch,
): Promise<MailCampaign> {
  return unwrap<MailCampaign>(
    await supabase.from("mail_campaigns").insert(patch).select("*").single(),
  );
}

export async function updateMailCampaign(
  id: string,
  patch: MailCampaignPatch,
): Promise<MailCampaign> {
  return unwrap<MailCampaign>(
    await supabase
      .from("mail_campaigns")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single(),
  );
}

export async function deleteMailCampaign(id: string): Promise<void> {
  unwrap(await supabase.from("mail_campaigns").delete().eq("id", id));
}

const CAMPAIGN_RECIPIENT_SELECT = "*, lead:leads(id,company,contact)";

export async function listMailCampaignRecipients(
  campaignId: string,
): Promise<MailCampaignRecipient[]> {
  return unwrap<MailCampaignRecipient[]>(
    await supabase
      .from("mail_campaign_recipients")
      .select(CAMPAIGN_RECIPIENT_SELECT)
      .eq("campaign_id", campaignId)
      .order("created_at"),
  );
}

/** Lightweight cross-campaign recipient rows, for dashboard aggregates. */
export async function listAllCampaignRecipients(): Promise<
  Pick<MailCampaignRecipient, "campaign_id" | "status" | "sent_at">[]
> {
  return unwrap(
    await supabase
      .from("mail_campaign_recipients")
      .select("campaign_id,status,sent_at"),
  );
}

export async function createMailCampaignRecipients(
  rows: Array<{ campaign_id: string; lead_id: string; email: string }>,
): Promise<MailCampaignRecipient[]> {
  return unwrap<MailCampaignRecipient[]>(
    await supabase
      .from("mail_campaign_recipients")
      .insert(rows)
      .select(CAMPAIGN_RECIPIENT_SELECT),
  );
}

export async function updateMailCampaignRecipient(
  id: string,
  patch: Partial<
    Pick<MailCampaignRecipient, "status" | "provider_id" | "error" | "sent_at">
  >,
): Promise<void> {
  unwrap(
    await supabase.from("mail_campaign_recipients").update(patch).eq("id", id),
  );
}

/** Public unsubscribe page -- callable with no session (anon role). */
export async function unsubscribeLead(recipientId: string): Promise<boolean> {
  return unwrap<boolean>(
    await supabase.rpc("unsubscribe_lead", { p_recipient_id: recipientId }),
  );
}

/* ---------- Sales CRM: Web contact forms ---------- */
export async function listWebForms(): Promise<WebForm[]> {
  return unwrap<WebForm[]>(
    await supabase
      .from("web_forms")
      .select("*")
      .order("created_at", { ascending: false }),
  );
}

export async function saveWebForm(
  id: string | undefined,
  patch: WebFormPatch,
): Promise<WebForm> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<WebForm>(
    id
      ? await supabase.from("web_forms").update(row).eq("id", id).select("*").single()
      : await supabase.from("web_forms").insert(row).select("*").single(),
  );
}

export async function deleteWebForm(id: string): Promise<void> {
  unwrap(await supabase.from("web_forms").delete().eq("id", id));
}

export async function listWebFormSubmissions(
  formId: string,
): Promise<WebFormSubmission[]> {
  return unwrap<WebFormSubmission[]>(
    await supabase
      .from("web_form_submissions")
      .select("*")
      .eq("form_id", formId)
      .order("created_at", { ascending: false }),
  );
}

/** Public hosted form page -- callable with no session (anon role). */
export async function getPublicWebForm(id: string): Promise<PublicWebForm | null> {
  const data = unwrap<PublicWebForm | null>(
    await supabase.rpc("get_web_form", { p_id: id }),
  );
  return data ?? null;
}

export async function submitWebForm(
  id: string,
  data: Record<string, string>,
  utm: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  return unwrap<{ ok: boolean; error?: string }>(
    await supabase.rpc("submit_web_form", { p_id: id, p_data: data, p_utm: utm }),
  );
}

/* ---------- Sales CRM: Follow-up workflows ---------- */
export async function listFollowUpRules(): Promise<FollowUpRule[]> {
  return unwrap<FollowUpRule[]>(
    await supabase.from("follow_up_rules").select("*").order("created_at"),
  );
}

export async function saveFollowUpRule(
  id: string | undefined,
  patch: FollowUpRulePatch,
): Promise<FollowUpRule> {
  const row = { ...patch, updated_at: new Date().toISOString() };
  return unwrap<FollowUpRule>(
    id
      ? await supabase.from("follow_up_rules").update(row).eq("id", id).select("*").single()
      : await supabase.from("follow_up_rules").insert(row).select("*").single(),
  );
}

export async function deleteFollowUpRule(id: string): Promise<void> {
  unwrap(await supabase.from("follow_up_rules").delete().eq("id", id));
}

/** Apply one patch to every listed rule (Bulk Edit on the Follow-up rules table). */
export async function updateFollowUpRulesBulk(
  ids: string[],
  patch: FollowUpRulePatch,
): Promise<void> {
  if (ids.length === 0) return;
  const row = { ...patch, updated_at: new Date().toISOString() };
  unwrap(
    await supabase
      .from("follow_up_rules")
      .update(row)
      .in("id", ids)
      .select("id"),
  );
}

export async function listFollowUpLog(): Promise<FollowUpLogEntry[]> {
  return unwrap<FollowUpLogEntry[]>(
    await supabase
      .from("follow_up_log")
      .select("*, rule:follow_up_rules(id,name)")
      .order("created_at", { ascending: false })
      .limit(100),
  );
}

/** Runs the due-follow-up worker on demand; returns how many it dispatched. */
export async function runDueFollowUps(): Promise<number> {
  return unwrap<number>(await supabase.rpc("process_due_follow_ups"));
}

/* ---------- Document Vault ---------- */
const DOCS_BUCKET = "shipment-documents";

export async function listShipmentDocuments(
  jobId: string,
): Promise<ShipmentDocument[]> {
  return unwrap<ShipmentDocument[]>(
    await supabase
      .from("shipment_documents")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
  );
}

export async function uploadShipmentDocument(
  jobId: string,
  file: File,
): Promise<ShipmentDocument> {
  const path = `${jobId}/${Date.now()}-${file.name}`;
  const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
  if (up.error) throw up.error;
  return unwrap<ShipmentDocument>(
    await supabase
      .from("shipment_documents")
      .insert({
        job_id: jobId,
        name: file.name,
        storage_path: path,
        kind: "upload",
        size_bytes: file.size,
      })
      .select("*")
      .single(),
  );
}

export async function deleteShipmentDocument(
  doc: ShipmentDocument,
): Promise<void> {
  await supabase.storage.from(DOCS_BUCKET).remove([doc.storage_path]);
  unwrap(await supabase.from("shipment_documents").delete().eq("id", doc.id));
}

/** Private bucket — a short-lived signed URL is needed to view/download. */
export async function getShipmentDocumentUrl(
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(storagePath, 300);
  if (error || !data) throw error ?? new Error("Could not create download link");
  return data.signedUrl;
}
