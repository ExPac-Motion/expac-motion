import { supabase } from "./supabase";
import { insuranceAmount, packingTotals, resolveLine } from "./calc";
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
  Profile,
  ProfilePatch,
  Quote,
  QuoteDraft,
  RateSheetItem,
  RateSheetPatch,
  ShipmentDocument,
  Supplier,
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
  "*, quote_lines(*), packing_list_items(*), client:clients(id,company), supplier:suppliers(id,company), agent:agents(id,company), transporter:transporters(id,company), clearing_agent:clearing_agents(id,company)";

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
  const pack = packingTotals(draft.packing);
  const ctx = {
    mode: draft.mode,
    fx: {
      usd: Number(draft.fx_usd_zar) || 0,
      cny: Number(draft.fx_cny_zar) || 0,
    },
    pack,
    commercialValue: draft.commercial_value,
  };
  const lines = draft.lines.map((l, i) => {
    const r = resolveLine(l, ctx);
    return {
      position: i,
      category: l.category,
      code: (l.code ?? "").toString(),
      description: (l.description ?? "").toString(),
      cur: l.cur,
      unit: (l.unit ?? "").toString(),
      qty: Number(r.qty) || 0,
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
  }));
  const id = unwrap<string>(
    await supabase.rpc("save_quote", {
      p_id: draft.id,
      p_reference: draft.reference.trim(),
      p_client_id: draft.client_id || null,
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

/** Push a computed customs total onto the quote as its CU-02 / CU-03 line. */
export async function addCustomsLineToQuote(
  quoteId: string,
  code: "CU-02" | "CU-03",
  amount: number,
): Promise<void> {
  unwrap(
    await supabase.rpc("add_customs_line_to_quote", {
      p_quote_id: quoteId,
      p_code: code,
      p_amount: amount,
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
