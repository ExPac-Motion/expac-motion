// Action tools: create tasks / notes, update shipment status. They never
// change data in prepare(); execute() runs only when the autonomy level is
// auto or a person approves the card.

import { sastDate } from "../env.ts";
import type { ActionTool, ToolContext } from "./types.ts";

/** SHIPMENT_STATUSES in src/lib/types.ts. */
export const SHIPMENT_STATUSES = [
  "Created",
  "Booked",
  "Vessel Booked",
  "Flight Booked",
  "Collected",
  "Received",
  "Loaded",
  "Departed",
  "In Transit",
  "Clearance Started",
  "Arrived",
  "Unloaded",
  "Customs",
  "Detained",
  "Released",
  "On-Delivery",
  "Delivered",
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

async function jobByRef(ctx: ToolContext, ref: string) {
  const { data, error } = await ctx.db
    .from("jobs")
    .select("id,reference,shipment_status,client_id")
    .ilike("reference", ref)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No shipment numbered ${ref}.`);
  return data as { id: string; reference: string; shipment_status: string | null; client_id: string | null };
}

// ---------- tasks + notes ----------

const TASK_COLUMNS = ["kind", "title", "body", "due_date", "priority", "job_id", "quote_id", "client_id", "assigned_to"];

function taskSummary(noun: string, i: Record<string, unknown>): string {
  return [
    `New ${noun}: "${i.title}"`,
    i.link_label ? `on ${i.link_label}` : "",
    i.due_date ? `due ${ddmmyyyy(String(i.due_date))}` : "",
    i.assignee_label ? `for ${i.assignee_label}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function taskTool(kind: "task" | "note"): ActionTool {
  const noun = kind === "task" ? "task" : "note";
  return {
    name: kind === "task" ? "create_task" : "create_note",
    kind: "action",
    description:
      kind === "task"
        ? "Create a Control Tower task, optionally linked to a shipment, quote or customer and assigned to a team member. Goes through the action's autonomy level (may need approval)."
        : "Create a Control Tower note (no status workflow), optionally dated and linked to a shipment, quote or customer. Goes through the action's autonomy level.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, what needs doing." },
        body: { type: "string", description: "Detail, optional." },
        due_date: { type: "string", description: "yyyy-mm-dd, optional." },
        ...(kind === "task"
          ? {
              priority: { type: "string", enum: ["low", "normal", "high"] },
              assign_to: { type: "string", description: "Team member's name, optional." },
            }
          : {}),
        shipment_reference: { type: "string", description: "Link to this shipment number, optional." },
        quote_reference: { type: "string", description: "Link to this quote number, optional." },
        customer_name: { type: "string", description: "Link to this customer, optional." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    async prepare(ctx, input) {
      const title = str(input.title).slice(0, 200);
      if (!title) throw new Error("A title is required.");
      const out: Record<string, unknown> = { kind, title };
      const body = str(input.body);
      if (body) out.body = body.slice(0, 4000);
      const due = str(input.due_date);
      if (due) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("due_date must be yyyy-mm-dd.");
        out.due_date = due;
      }
      if (kind === "task") {
        out.priority = ["low", "normal", "high"].includes(str(input.priority)) ? str(input.priority) : "normal";
      }
      const parts: string[] = [];
      let target: { type: string; id: string; ref: string } | null = null;

      const sref = str(input.shipment_reference);
      if (sref) {
        const job = await jobByRef(ctx, sref);
        out.job_id = job.id;
        if (job.client_id) out.client_id = job.client_id;
        parts.push(job.reference);
        target = { type: "job", id: job.id, ref: job.reference };
      }
      const qref = str(input.quote_reference);
      if (qref) {
        const { data } = await ctx.db.from("quotes").select("id,reference,client_id").ilike("reference", qref).maybeSingle();
        if (!data) throw new Error(`No quote numbered ${qref}.`);
        out.quote_id = data.id;
        if (data.client_id && !out.client_id) out.client_id = data.client_id;
        parts.push(data.reference);
        target ??= { type: "quote", id: data.id, ref: data.reference };
      }
      const cname = str(input.customer_name);
      if (cname && !out.client_id) {
        const { data } = await ctx.db.from("clients").select("id,company").ilike("company", `%${cname}%`).limit(2);
        if (!data?.length) throw new Error(`No customer matching "${cname}".`);
        if (data.length > 1) throw new Error(`More than one customer matches "${cname}"; use the full name.`);
        out.client_id = data[0].id;
        parts.push(data[0].company);
        target ??= { type: "client", id: data[0].id, ref: data[0].company };
      }
      const who = str(input.assign_to);
      let whoName = "";
      if (who) {
        const { data } = await ctx.db.from("profiles").select("id,full_name").ilike("full_name", `%${who}%`).in("role", ["admin", "user"]).limit(2);
        if (!data?.length) throw new Error(`No team member named "${who}".`);
        if (data.length > 1) throw new Error(`More than one team member matches "${who}".`);
        out.assigned_to = data[0].id;
        whoName = data[0].full_name;
      }
      // Labels for the card only; not ops_tasks columns (stripped on execute).
      if (parts.length) out.link_label = parts.join(", ");
      if (whoName) out.assignee_label = whoName;
      return {
        input: out,
        summary: taskSummary(noun, out),
        target_type: target?.type,
        target_id: target?.id ?? null,
        target_ref: target?.ref ?? null,
      };
    },
    applyEdit(stored, changes) {
      const next = { ...stored };
      if (changes.title !== undefined) {
        const t = str(changes.title).slice(0, 200);
        if (!t) throw new Error("A title is required.");
        next.title = t;
      }
      if (changes.body !== undefined) {
        const b = str(changes.body).slice(0, 4000);
        if (b) next.body = b;
        else delete next.body;
      }
      if (changes.due_date !== undefined) {
        const d = str(changes.due_date);
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Due date must be yyyy-mm-dd.");
        if (d) next.due_date = d;
        else delete next.due_date;
      }
      if (kind === "task" && changes.priority !== undefined) {
        if (!["low", "normal", "high"].includes(str(changes.priority))) throw new Error("Priority must be low, normal or high.");
        next.priority = str(changes.priority);
      }
      return { input: next, summary: taskSummary(noun, next) };
    },
    async execute(ctx, input) {
      const row: Record<string, unknown> = { status: "open" };
      for (const k of TASK_COLUMNS) if (input[k] !== undefined) row[k] = input[k];
      const { data, error } = await ctx.db.from("ops_tasks").insert(row).select("id,title").single();
      if (error) throw new Error(error.message);
      return { result: { task_id: data.id, title: data.title }, undo: { task_id: data.id } };
    },
    async revert(ctx, undo) {
      // The bot's own creation: removed with the service key, so Undo works
      // even for logins without the Delete permission.
      const { error } = await ctx.svc.from("ops_tasks").delete().eq("id", String(undo.task_id));
      if (error) throw new Error(error.message);
      return { removed: undo.task_id };
    },
  };
}

// ---------- shipment status ----------

export const updateShipmentStatus: ActionTool = {
  name: "update_shipment_status",
  kind: "action",
  description:
    "Change a shipment's status, exactly as the Active Shipments board does (timeline steps, milestone and milestone log follow). Goes through the action's autonomy level (may need approval). Look the shipment up first.",
  input_schema: {
    type: "object",
    properties: {
      shipment_reference: { type: "string", description: "Shipment number, e.g. SEA104512." },
      status: { type: "string", enum: SHIPMENT_STATUSES },
      reason: { type: "string", description: "Why, in a few words (shown on the approval card)." },
    },
    required: ["shipment_reference", "status"],
    additionalProperties: false,
  },
  async prepare(ctx, input) {
    const status = str(input.status);
    if (!SHIPMENT_STATUSES.includes(status)) throw new Error(`"${status}" is not a shipment status.`);
    const job = await jobByRef(ctx, str(input.shipment_reference));
    const from = job.shipment_status || "no status";
    if (job.shipment_status === status) throw new Error(`${job.reference} is already "${status}".`);
    const reason = str(input.reason).slice(0, 300);
    return {
      input: { job_id: job.id, reference: job.reference, status, from_status: job.shipment_status, reason: reason || undefined },
      summary: `Set ${job.reference} from "${from}" to "${status}"${reason ? ` (${reason})` : ""}`,
      target_type: "job",
      target_id: job.id,
      target_ref: job.reference,
    };
  },
  applyEdit(stored, changes) {
    const next = { ...stored };
    if (changes.status !== undefined) {
      const s = str(changes.status);
      if (!SHIPMENT_STATUSES.includes(s)) throw new Error(`"${s}" is not a shipment status.`);
      next.status = s;
    }
    if (changes.reason !== undefined) next.reason = str(changes.reason).slice(0, 300) || undefined;
    const from = (stored.from_status as string | null) || "no status";
    return {
      input: next,
      summary: `Set ${stored.reference} from "${from}" to "${next.status}"${next.reason ? ` (${next.reason})` : ""}`,
    };
  },
  async execute(ctx, input) {
    const jobId = String(input.job_id);
    const { data: before, error: e1 } = await ctx.db.from("jobs").select("shipment_status").eq("id", jobId).single();
    if (e1) throw new Error(e1.message);
    const { error } = await ctx.db.rpc("ai_set_shipment_status", {
      p_job: jobId,
      p_status: String(input.status),
      p_note: `Shipment Status set to "${input.status}" (Motion AI, ${sastDate(0)})`,
    });
    if (error) throw new Error(error.message);
    return {
      result: { reference: input.reference, status: input.status },
      undo: before?.shipment_status
        ? { job_id: jobId, status: before.shipment_status, set_to: input.status, reference: input.reference }
        : null,
    };
  },
  async revert(ctx, undo) {
    // Only while nobody has moved the shipment on since.
    const { data: now } = await ctx.db.from("jobs").select("shipment_status").eq("id", String(undo.job_id)).single();
    if (now && undo.set_to && now.shipment_status !== undo.set_to) {
      throw new Error(`${undo.reference} has moved on to "${now.shipment_status}" since; change it on the board instead.`);
    }
    const { error } = await ctx.db.rpc("ai_set_shipment_status", {
      p_job: String(undo.job_id),
      p_status: String(undo.status),
      p_note: `Shipment Status set back to "${undo.status}" (Motion AI undo)`,
    });
    if (error) throw new Error(error.message);
    return { reference: undo.reference, status: undo.status };
  },
};

export const ACTION_TOOLS: ActionTool[] = [taskTool("task"), taskTool("note"), updateShipmentStatus];
