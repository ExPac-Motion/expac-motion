// Read tools: look things up, never change anything. Every query runs on
// ctx.db, the caller's own Supabase client, so RLS decides what is visible.

import { compact, sastDate } from "../env.ts";
import type { ToolDef } from "./types.ts";

/** Shipment statuses from Arrived onwards (SHIPMENT_STATUSES in src/lib/types.ts). */
const ARRIVED_OR_LATER = [
  "Arrived",
  "Unloaded",
  "Customs",
  "Detained",
  "Released",
  "On-Delivery",
  "Delivered",
];
const notArrivedFilter = `shipment_status.is.null,shipment_status.not.in.(${ARRIVED_OR_LATER.map((s) => `"${s}"`).join(",")})`;

const QUOTE_STATUSES = ["open", "sent", "accepted", "completed", "lost"];
const QUOTE_STATUS_LABEL: Record<string, string> = {
  open: "New Lead",
  sent: "Quote Sent",
  accepted: "Quote Accepted",
  completed: "Completed",
  lost: "Not Proceeding",
};

const JOB_LIST_COLS =
  "id,reference,po_no,mode,origin,destination,shipment_status,milestone,etd,eta,awb_mbl,container_no,container_type,vessel_name,carrier_name,provisional_delivery_date,ops_completed_at,invoiced_at,created_at,client:clients(company),supplier:suppliers(company)";

const QUOTE_LIST_COLS =
  "id,reference,customer_reference,status,mode,origin,destination,commodity,valid_until,sent_at,created_at,opportunity_value,mode_to_advise,portal_requested_at,client:clients!quotes_client_id_fkey(company),lead:leads!quotes_lead_id_fkey(company)";

function lim(v: unknown, dflt = 20, max = 50): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : dflt;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
/** Makes user text safe inside a PostgREST or() filter. */
function like(v: string): string {
  return `%${v.replace(/[%,()*"\\]/g, " ").trim()}%`;
}
function withStatusLabel<T extends { status?: string }>(q: T): T & { status_label?: string } {
  return { ...q, status_label: q.status ? QUOTE_STATUS_LABEL[q.status] ?? q.status : undefined };
}

/** Statuses from Arrived onwards count as arrived; a blank status does not. */
function notArrived(row: { shipment_status?: string | null }): boolean {
  return !row.shipment_status || !ARRIVED_OR_LATER.includes(row.shipment_status);
}

// ---------- shipments ----------

export const searchShipments: ToolDef = {
  name: "search_shipments",
  kind: "read",
  description:
    "Search shipments (jobs). Matches the text against shipment number, customer PO, AWB/MBL, container number, origin, destination and customer name. Defaults to active shipments (not yet Ops Complete). Use eta_within_days to find shipments arriving soon, overdue_eta for shipments whose ETA has passed but have not arrived.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free text, e.g. SEA123456, a container number, a customer or a port." },
      status: { type: "string", description: "Exact shipment status, e.g. In Transit, Customs, Detained." },
      mode: { type: "string", description: "Transport mode, e.g. Sea Freight (FCL), Air Freight." },
      include_completed: { type: "boolean", description: "Also return shipments already marked Ops Complete." },
      eta_within_days: { type: "integer", description: "Only shipments not yet arrived with ETA within this many days from today." },
      overdue_eta: { type: "boolean", description: "Only shipments whose ETA is before today and have not arrived." },
      limit: { type: "integer", description: "Max rows, default 20, max 50." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const q = str(input.query);
    const max = lim(input.limit);
    const etaFilter = input.eta_within_days != null || !!input.overdue_eta;
    // ETA filters drop arrived shipments afterwards, so fetch more first.
    let req = ctx.db.from("jobs").select(JOB_LIST_COLS).order("created_at", { ascending: false }).limit(etaFilter ? 200 : max);
    if (!input.include_completed) req = req.is("ops_completed_at", null);
    if (str(input.status)) req = req.eq("shipment_status", str(input.status));
    if (str(input.mode)) req = req.ilike("mode", like(str(input.mode)));
    if (input.eta_within_days != null) {
      req = req.gte("eta", sastDate(0)).lte("eta", sastDate(lim(input.eta_within_days, 5, 365)));
    }
    if (input.overdue_eta) req = req.lt("eta", sastDate(0));
    if (q) {
      const p = like(q);
      const { data: clients } = await ctx.db.from("clients").select("id").ilike("company", p).limit(20);
      const ids = (clients ?? []).map((c: { id: string }) => c.id);
      const parts = [
        `reference.ilike.${p}`,
        `po_no.ilike.${p}`,
        `awb_mbl.ilike.${p}`,
        `container_no.ilike.${p}`,
        `origin.ilike.${p}`,
        `destination.ilike.${p}`,
        `vessel_name.ilike.${p}`,
      ];
      if (ids.length) parts.push(`client_id.in.(${ids.join(",")})`);
      req = req.or(parts.join(","));
    }
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    const rows = (etaFilter ? (data ?? []).filter(notArrived) : data ?? []).slice(0, max);
    return { count: rows.length, shipments: compact(rows) };
  },
};

export const getShipment: ToolDef = {
  name: "get_shipment",
  kind: "read",
  description:
    "Full detail of one shipment: parties, booking details, status history, timeline steps, live tracking summary, packing list, open tasks, and Motion WMS warehouse status.",
  input_schema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Shipment number, e.g. SEA123456." },
      id: { type: "string", description: "Shipment id (uuid), if known." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db
      .from("jobs")
      .select("*, client:clients(company,contact,email,phone), supplier:suppliers(company,contact,email,phone)");
    if (str(input.id)) req = req.eq("id", str(input.id));
    else if (str(input.reference)) req = req.ilike("reference", str(input.reference));
    else throw new Error("Give a shipment reference or id.");
    const { data: job, error } = await req.maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { found: false };

    const [history, steps, tracking, tasks, hubs, packing] = await Promise.all([
      ctx.db.from("job_status_history").select("status,changed_at").eq("job_id", job.id).order("changed_at"),
      ctx.db
        .from("job_timeline_steps")
        .select("step,done,skipped,planned_date,actual_date,note")
        .eq("job_id", job.id)
        .order("sort_order"),
      ctx.db
        .from("job_tracking")
        .select("ref_type,ref_value,carrier,status,pol,pod,etd,eta,pod_eta,pod_ata,atd,vessel_name,voyage,next_port,next_port_eta,speed_kn,position_at")
        .eq("job_id", job.id),
      ctx.db
        .from("ops_tasks")
        .select("kind,title,status,priority,due_date")
        .eq("job_id", job.id)
        .neq("status", "done")
        .order("due_date"),
      ctx.db.from("wms_hub_sync").select("*").eq("job_id", job.id),
      job.quote_id
        ? ctx.db
            .from("packing_list_items")
            .select("position,qty_ctns,qty_pcs,length_cm,width_cm,height_cm,actual_kg,cbm")
            .eq("quote_id", job.quote_id)
        : Promise.resolve({ data: [] }),
    ]);
    return compact({
      found: true,
      shipment: job,
      status_history: history.data,
      timeline: steps.data,
      tracking: tracking.data,
      open_tasks: tasks.data,
      motion_wms: hubs.data,
      packing_list: (packing as { data: unknown[] | null }).data,
    });
  },
};

// ---------- quotes ----------

export const searchQuotes: ToolDef = {
  name: "search_quotes",
  kind: "read",
  description:
    "Search quotations. Statuses: open (New Lead), sent (Quote Sent, awaiting customer), accepted, completed, lost (Not Proceeding). Use awaiting_follow_up for sent quotes that have had no answer for a few days, expiring_within_days for quotes about to expire.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Quote number, customer PO, customer or lead name, origin, destination or commodity." },
      status: { type: "string", enum: QUOTE_STATUSES },
      awaiting_follow_up: { type: "boolean", description: "Status sent, and sent at least follow_up_days ago." },
      follow_up_days: { type: "integer", description: "Days since sent for awaiting_follow_up, default 3." },
      expiring_within_days: { type: "integer", description: "Open or sent quotes whose valid-until date is within this many days." },
      created_within_days: { type: "integer", description: "Only quotes created in the last N days." },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db.from("quotes").select(QUOTE_LIST_COLS).order("created_at", { ascending: false }).limit(lim(input.limit));
    if (str(input.status)) req = req.eq("status", str(input.status));
    if (input.awaiting_follow_up) {
      const days = lim(input.follow_up_days, 3, 90);
      req = req.eq("status", "sent").lte("sent_at", new Date(Date.now() - days * 86_400_000).toISOString());
    }
    if (input.expiring_within_days != null) {
      req = req
        .in("status", ["open", "sent"])
        .gte("valid_until", sastDate(0))
        .lte("valid_until", sastDate(lim(input.expiring_within_days, 7, 365)));
    }
    if (input.created_within_days != null) {
      req = req.gte("created_at", new Date(Date.now() - lim(input.created_within_days, 7, 365) * 86_400_000).toISOString());
    }
    const q = str(input.query);
    if (q) {
      const p = like(q);
      const [{ data: clients }, { data: leads }] = await Promise.all([
        ctx.db.from("clients").select("id").ilike("company", p).limit(20),
        ctx.db.from("leads").select("id").ilike("company", p).limit(20),
      ]);
      const parts = [
        `reference.ilike.${p}`,
        `customer_reference.ilike.${p}`,
        `origin.ilike.${p}`,
        `destination.ilike.${p}`,
        `commodity.ilike.${p}`,
      ];
      const cids = (clients ?? []).map((c: { id: string }) => c.id);
      const lids = (leads ?? []).map((c: { id: string }) => c.id);
      if (cids.length) parts.push(`client_id.in.(${cids.join(",")})`);
      if (lids.length) parts.push(`lead_id.in.(${lids.join(",")})`);
      req = req.or(parts.join(","));
    }
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, quotes: compact((data ?? []).map(withStatusLabel)) };
  },
};

export const getQuote: ToolDef = {
  name: "get_quote",
  kind: "read",
  description: "Full detail of one quotation: parties, route, charge lines (buy, margin, sell), packing list, follow-up notes and the shipment it became.",
  input_schema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Quote / shipment number, e.g. SEA123456." },
      id: { type: "string" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db
      .from("quotes")
      .select(
        "*, quote_lines(position,category,code,description,cur,unit,qty,buy,margin,vat_pct,sell), packing_list_items(position,qty_ctns,qty_pcs,length_cm,width_cm,height_cm,actual_kg,cbm), client:clients!quotes_client_id_fkey(company,contact,email), lead:leads!quotes_lead_id_fkey(company,contact,email), supplier:suppliers(company), agent:agents(company), transporter:transporters(company), clearing_agent:clearing_agents(company)",
      );
    if (str(input.id)) req = req.eq("id", str(input.id));
    else if (str(input.reference)) req = req.ilike("reference", str(input.reference));
    else throw new Error("Give a quote reference or id.");
    const { data, error } = await req.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { found: false };
    const { data: job } = await ctx.db.from("jobs").select("reference,shipment_status").eq("quote_id", data.id).maybeSingle();
    return compact({ found: true, quote: withStatusLabel(data), shipment: job });
  },
};

// ---------- customers, suppliers, CRM ----------

export const searchClients: ToolDef = {
  name: "search_clients",
  kind: "read",
  description: "Search customers by company, contact person, email or phone.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer" } },
    required: ["query"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const p = like(str(input.query));
    const { data, error } = await ctx.db
      .from("clients")
      .select("*")
      .or(`company.ilike.${p},contact.ilike.${p},email.ilike.${p},phone.ilike.${p}`)
      .order("company")
      .limit(lim(input.limit));
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, customers: compact(data ?? []) };
  },
};

export const getClient: ToolDef = {
  name: "get_client",
  kind: "read",
  description: "One customer's record with their recent shipments, open quotes and open tasks.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string", description: "Company name (best match is used)." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db.from("clients").select("*");
    if (str(input.id)) req = req.eq("id", str(input.id));
    else if (str(input.name)) req = req.ilike("company", like(str(input.name)));
    else throw new Error("Give a customer id or name.");
    const { data: rows, error } = await req.limit(2);
    if (error) throw new Error(error.message);
    if (!rows?.length) return { found: false };
    const client = rows[0];
    const [jobs, quotes, tasks] = await Promise.all([
      ctx.db.from("jobs").select(JOB_LIST_COLS).eq("client_id", client.id).order("created_at", { ascending: false }).limit(10),
      ctx.db.from("quotes").select(QUOTE_LIST_COLS).eq("client_id", client.id).in("status", ["open", "sent"]).limit(10),
      ctx.db.from("ops_tasks").select("kind,title,status,priority,due_date").eq("client_id", client.id).neq("status", "done").limit(10),
    ]);
    return compact({
      found: true,
      other_matches: rows.length > 1 ? "More than one customer matched, ask the user which one if unsure." : undefined,
      customer: client,
      recent_shipments: jobs.data,
      open_quotes: (quotes.data ?? []).map(withStatusLabel),
      open_tasks: tasks.data,
    });
  },
};

const PARTNER_TABLES: Record<string, string> = {
  vendor: "suppliers",
  agent: "agents",
  transporter: "transporters",
  clearing_agent: "clearing_agents",
  destination_agent: "destination_agents",
};

export const searchSuppliers: ToolDef = {
  name: "search_suppliers",
  kind: "read",
  description:
    "Search vendors (shippers / suppliers) and partners: overseas agents, transporters, clearing agents and destination agents. Leave kind empty to search them all.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      kind: { type: "string", enum: Object.keys(PARTNER_TABLES) },
      limit: { type: "integer" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const kinds = str(input.kind) ? [str(input.kind)] : Object.keys(PARTNER_TABLES);
    const p = like(str(input.query));
    const out: Record<string, unknown> = {};
    await Promise.all(
      kinds.map(async (k) => {
        const { data, error } = await ctx.db
          .from(PARTNER_TABLES[k])
          .select("*")
          .ilike("company", p)
          .limit(lim(input.limit, 10));
        out[k] = error ? { error: error.message } : compact(data ?? []);
      }),
    );
    return out;
  },
};

export const searchLeads: ToolDef = {
  name: "search_leads",
  kind: "read",
  description: "Search Sales CRM leads (prospects not yet customers). Use created_within_days for new leads.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Company, contact, email or source." },
      created_within_days: { type: "integer" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db
      .from("leads")
      .select("id,company,contact,email,phone,source,description,notes,created_at,promoted_at,lead_status:lead_statuses(name),sales_person:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(lim(input.limit));
    if (input.created_within_days != null) {
      req = req.gte("created_at", new Date(Date.now() - lim(input.created_within_days, 7, 365) * 86_400_000).toISOString());
    }
    const q = str(input.query);
    if (q) {
      const p = like(q);
      req = req.or(`company.ilike.${p},contact.ilike.${p},email.ilike.${p},source.ilike.${p}`);
    }
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, leads: compact(data ?? []) };
  },
};

export const searchOpportunities: ToolDef = {
  name: "search_opportunities",
  kind: "read",
  description:
    "Sales pipeline opportunities. Stages: new_lead, quote_sent, quote_accepted, job_completed, not_proceeding.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["new_lead", "quote_sent", "quote_accepted", "job_completed", "not_proceeding"] },
      query: { type: "string", description: "Matches the opportunity title." },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db
      .from("opportunities")
      .select("id,title,status,value,opportunity_value,close_date,notes,created_at,lead:leads(company),client:clients(company),quote:quotes(reference,status),job:jobs(reference,shipment_status),sales_person:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(lim(input.limit));
    if (str(input.status)) req = req.eq("status", str(input.status));
    if (str(input.query)) req = req.ilike("title", like(str(input.query)));
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, opportunities: compact(data ?? []) };
  },
};

// ---------- tasks + alerts ----------

const TASK_COLS =
  "id,kind,title,body,status,priority,due_date,due_time,created_at,assigned_to,job:jobs(reference),quote:quotes(reference),client:clients(company)";

export const listTasks: ToolDef = {
  name: "list_tasks",
  kind: "read",
  description: "Control Tower Tasks & Notes. filter: open, overdue, due_today, mine (assigned to or created by the user), recently_done.",
  input_schema: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["open", "overdue", "due_today", "mine", "recently_done"] },
      shipment_reference: { type: "string", description: "Only tasks linked to this shipment number." },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db.from("ops_tasks").select(TASK_COLS).limit(lim(input.limit, 30));
    const today = sastDate(0);
    switch (str(input.filter) || "open") {
      case "overdue":
        req = req.neq("status", "done").lt("due_date", today).order("due_date");
        break;
      case "due_today":
        req = req.neq("status", "done").eq("due_date", today);
        break;
      case "mine":
        if (!ctx.userId) throw new Error("No signed-in user for 'mine'.");
        req = req.neq("status", "done").or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`).order("due_date");
        break;
      case "recently_done":
        req = req.eq("status", "done").order("done_at", { ascending: false });
        break;
      default:
        req = req.neq("status", "done").order("due_date", { nullsFirst: false });
    }
    if (str(input.shipment_reference)) {
      const { data: job } = await ctx.db.from("jobs").select("id").ilike("reference", str(input.shipment_reference)).maybeSingle();
      if (!job) return { count: 0, tasks: [], note: "No shipment with that number." };
      req = req.eq("job_id", job.id);
    }
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    return { today, count: data?.length ?? 0, tasks: compact(data ?? []) };
  },
};

/** The figures behind both get_alerts and build_briefing. */
async function gatherAttention(ctx: Parameters<ToolDef["run"]>[0]) {
  const today = sastDate(0);
  const in5 = sastDate(5);
  const in7 = sastDate(7);
  const [health, overdueTasks, dueToday, etaSoon, etaPast, held, expiring, followUp, tracking] = await Promise.all([
    ctx.db.from("system_health").select("label,ok,detail,failing_since").eq("ok", false),
    ctx.db.from("ops_tasks").select(TASK_COLS).neq("status", "done").lt("due_date", today).order("due_date").limit(30),
    ctx.db.from("ops_tasks").select(TASK_COLS).neq("status", "done").eq("due_date", today).limit(30),
    ctx.db.from("jobs").select(JOB_LIST_COLS).is("ops_completed_at", null).gte("eta", today).lte("eta", in5).or(notArrivedFilter).order("eta").limit(30),
    ctx.db.from("jobs").select(JOB_LIST_COLS).is("ops_completed_at", null).lt("eta", today).or(notArrivedFilter).order("eta").limit(30),
    ctx.db.from("jobs").select(JOB_LIST_COLS).is("ops_completed_at", null).in("shipment_status", ["Detained", "Customs"]).limit(30),
    ctx.db.from("quotes").select(QUOTE_LIST_COLS).in("status", ["open", "sent"]).gte("valid_until", today).lte("valid_until", in7).order("valid_until").limit(30),
    ctx.db
      .from("quotes")
      .select(QUOTE_LIST_COLS)
      .eq("status", "sent")
      .lte("sent_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order("sent_at")
      .limit(30),
    ctx.db.from("job_tracking").select("status,eta,pod_eta,job:jobs!inner(reference,ops_completed_at)").is("job.ops_completed_at", null),
  ]);
  const trackingExceptions = (tracking.data ?? []).filter((t: { status?: string | null }) =>
    /(detain|hold|delay|roll|exception|problem|cancel)/i.test(t.status ?? ""),
  );
  return {
    today,
    system_health_failing: health.data ?? [],
    tasks_overdue: overdueTasks.data ?? [],
    tasks_due_today: dueToday.data ?? [],
    shipments_eta_within_5_days_not_arrived: etaSoon.data ?? [],
    shipments_eta_passed_not_arrived: etaPast.data ?? [],
    shipments_in_customs_or_detained: held.data ?? [],
    tracking_exceptions: trackingExceptions,
    quotes_expiring_within_7_days: (expiring.data ?? []).map(withStatusLabel),
    quotes_sent_3_plus_days_no_answer: (followUp.data ?? []).map(withStatusLabel),
  };
}

export const getAlerts: ToolDef = {
  name: "get_alerts",
  kind: "read",
  description:
    "Control Tower alerts right now: failing system health checks, overdue tasks, shipments due within 5 days or past ETA without arriving, shipments in Customs or Detained, tracking exceptions, quotes expiring and quotes awaiting follow-up.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    return compact(await gatherAttention(ctx));
  },
};

export const buildBriefing: ToolDef = {
  name: "build_briefing",
  kind: "read",
  description:
    "Everything for the daily operations briefing: all Control Tower alerts plus new leads, new website / portal enquiries and new quotes since the last working day. Call this when the user asks for a briefing, summary of the day or what needs attention.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    // Since the previous working day: Monday looks back to Friday morning.
    const dow = new Date(sastDate(0) + "T12:00:00Z").getUTCDay(); // 0 Sun .. 6 Sat
    const back = dow === 1 ? 3 : dow === 0 ? 2 : 1;
    const since = new Date(Date.now() - back * 86_400_000).toISOString();
    const [attention, leads, enquiries, newQuotes] = await Promise.all([
      gatherAttention(ctx),
      ctx.db.from("leads").select("company,contact,source,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
      ctx.db
        .from("quotes")
        .select(QUOTE_LIST_COLS)
        .or(`portal_requested_at.gte."${since}",enquiry_notes.not.is.null`)
        .gte("created_at", since)
        .limit(30),
      ctx.db.from("quotes").select(QUOTE_LIST_COLS).gte("created_at", since).order("created_at", { ascending: false }).limit(30),
    ]);
    return compact({
      ...attention,
      since,
      new_leads: leads.data ?? [],
      new_enquiries: (enquiries.data ?? []).map(withStatusLabel),
      new_quotes: (newQuotes.data ?? []).map(withStatusLabel),
    });
  },
};

// ---------- rates ----------

export const lookupRates: ToolDef = {
  name: "lookup_rates",
  kind: "read",
  description:
    "Rates & Tariff Sheet lookup. Tier sheets are Platinum / Gold / Silver per mode and trade route. Each line is a charge code with buy, margin and sell. Filter by mode, origin, destination or tier.",
  input_schema: {
    type: "object",
    properties: {
      mode: { type: "string" },
      origin: { type: "string" },
      destination: { type: "string" },
      tier: { type: "string", description: "platinum, gold or silver" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    let req = ctx.db
      .from("tariff_sheets")
      .select("tier,mode,route,origin,destination,valid_from,valid_until,margin,notes,lines")
      .order("route")
      .limit(300);
    if (str(input.mode)) req = req.ilike("mode", like(str(input.mode)));
    if (str(input.tier)) req = req.ilike("tier", str(input.tier));
    const { data, error } = await req;
    if (error) {
      if (/permission|denied/i.test(error.message)) return { error: "This login has no access to rates." };
      throw new Error(error.message);
    }
    type Sheet = { route?: string | null; origin?: string | null; destination?: string | null };
    const has = (hay: Array<string | null | undefined>, needle: string) =>
      !needle || hay.some((h) => (h ?? "").toLowerCase().includes(needle.toLowerCase()));
    const o = str(input.origin);
    const d = str(input.destination);
    const rows = (data ?? [])
      .filter((r: Sheet) => has([r.origin, r.route], o) && has([r.destination, r.route], d))
      .slice(0, lim(input.limit, 6, 12));
    return { count: rows.length, sheets: compact(rows) };
  },
};

export const READ_TOOLS: ToolDef[] = [
  searchShipments,
  getShipment,
  searchQuotes,
  getQuote,
  searchClients,
  getClient,
  searchSuppliers,
  searchLeads,
  searchOpportunities,
  listTasks,
  getAlerts,
  buildBriefing,
  lookupRates,
];
