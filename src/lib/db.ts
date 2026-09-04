import { supabase } from "./supabase";
import { insuranceAmount, packingTotals, resolveLine } from "./calc";
import type {
  Client,
  Contact,
  Job,
  JobPatch,
  Milestone,
  Quote,
  QuoteDraft,
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

/** Marks the quote accepted and creates the linked job (idempotent). Returns the job id. */
export async function acceptQuote(quoteId: string): Promise<string> {
  return unwrap<string>(
    await supabase.rpc("accept_quote", { p_quote_id: quoteId }),
  );
}

/* ---------- Jobs ---------- */
const JOB_SELECT =
  "*, client:clients(id,company), supplier:suppliers(id,company), job_events(*)";

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
