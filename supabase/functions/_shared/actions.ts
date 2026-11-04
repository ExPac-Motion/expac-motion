// Autonomy levels in one place: propose (from the engine), execute
// (auto, or a person approving), revert (Undo). Every step is written to
// ai_actions and the audit log.

import { audit, type Actor } from "./audit.ts";
import type { Db } from "./env.ts";
import type { ActionTool, ToolContext } from "./tools/index.ts";
import { actionTool } from "./tools/index.ts";

export type Level = "suggest" | "draft" | "auto";

export interface ActionRow {
  id: string;
  bot_key: string;
  conversation_id: string | null;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
  edited_input: Record<string, unknown> | null;
  level: Level;
  status: "suggested" | "pending" | "executed" | "rejected" | "undone" | "failed";
  target_type: string | null;
  target_id: string | null;
  target_ref: string | null;
  result: unknown;
  undo: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export async function levelFor(svc: Db, botKey: string, action: string): Promise<Level> {
  const { data } = await svc
    .from("ai_action_policies")
    .select("level")
    .eq("bot_key", botKey)
    .eq("action", action)
    .maybeSingle();
  const l = data?.level;
  return l === "suggest" || l === "auto" ? l : "draft";
}

/** What the bot is told after proposing, so it reports truthfully. */
function toolReply(row: ActionRow): string {
  switch (row.status) {
    case "suggested":
      return `NOT DONE. This action is set to "Suggest only". Describe it to the user so they can do it themselves: ${row.summary}`;
    case "pending":
      return `WAITING FOR APPROVAL. An approval card was created (${row.summary}). Nothing has changed yet; tell the user it needs their Approve.`;
    case "executed":
      return `DONE automatically (autonomy level Auto): ${row.summary}. Result: ${JSON.stringify(row.result)}`;
    case "failed":
      return `FAILED: ${row.summary}. Error: ${row.error}`;
    default:
      return `${row.status}: ${row.summary}`;
  }
}

export interface ProposeInput {
  svc: Db;
  ctx: ToolContext;
  /** Client used when the level is auto (requester's login, or service in triggers). */
  execDb: Db;
  actor: Actor;
  tool: ActionTool;
  input: Record<string, unknown>;
}

export async function proposeAction(p: ProposeInput): Promise<{ row: ActionRow; reply: string }> {
  const prepared = await p.tool.prepare(p.ctx, p.input);
  const level = await levelFor(p.svc, p.ctx.botKey, p.tool.name);
  const { data, error } = await p.svc
    .from("ai_actions")
    .insert({
      bot_key: p.ctx.botKey,
      conversation_id: p.ctx.conversationId,
      tool: p.tool.name,
      summary: prepared.summary,
      input: prepared.input,
      level,
      status: level === "suggest" ? "suggested" : "pending",
      target_type: prepared.target_type ?? null,
      target_id: prepared.target_id ?? null,
      target_ref: prepared.target_ref ?? null,
      actor_type: p.actor.type,
      requested_by: p.actor.type === "user" ? p.actor.id ?? null : null,
      trigger_key: p.actor.triggerKey ?? null,
      // Suggestions and auto actions are already known to the bot.
      reported: level !== "draft",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not record the action: ${error?.message}`);
  let row = data as ActionRow;
  await audit(p.svc, p.actor, {
    bot_key: p.ctx.botKey,
    conversation_id: p.ctx.conversationId,
    event: "action",
    tool: p.tool.name,
    input: { action_id: row.id, level, ...prepared.input },
    result: { status: row.status, summary: row.summary },
  });
  if (level === "auto") {
    row = await executeAction({ svc: p.svc, db: p.execDb, actor: p.actor, row, deciderId: null });
  }
  return { row, reply: toolReply(row) };
}

export async function executeAction(e: {
  svc: Db;
  db: Db;
  actor: Actor;
  row: ActionRow;
  deciderId: string | null;
  editedInput?: Record<string, unknown> | null;
}): Promise<ActionRow> {
  const tool = actionTool(e.row.tool);
  if (!tool) throw new Error(`Unknown action ${e.row.tool}.`);
  const input = e.editedInput ?? e.row.edited_input ?? e.row.input;
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  try {
    const out = await tool.execute({ db: e.db, svc: e.svc, userId: e.deciderId }, input);
    patch = { status: "executed", result: out.result, undo: out.undo, executed_at: now, error: null };
  } catch (err) {
    patch = { status: "failed", error: err instanceof Error ? err.message : String(err), executed_at: now };
  }
  if (e.deciderId) Object.assign(patch, { decided_by: e.deciderId, decided_at: now });
  if (e.editedInput) patch.edited_input = e.editedInput;
  const { data, error } = await e.svc.from("ai_actions").update(patch).eq("id", e.row.id).select("*").single();
  if (error || !data) throw new Error(`Could not update the action: ${error?.message}`);
  const row = data as ActionRow;
  await audit(e.svc, e.actor, {
    bot_key: row.bot_key,
    conversation_id: row.conversation_id,
    event: "action",
    tool: row.tool,
    input: { action_id: row.id, executed_input: input },
    result: { status: row.status, result: row.result },
    ok: row.status === "executed",
    error: row.error ?? undefined,
  });
  return row;
}

export async function revertAction(e: { svc: Db; db: Db; actor: Actor; row: ActionRow; userId: string }): Promise<ActionRow> {
  const tool = actionTool(e.row.tool);
  if (!tool?.revert || !e.row.undo) throw new Error("This action can't be undone.");
  if (e.row.status !== "executed") throw new Error("Only a done action can be undone.");
  const result = await tool.revert({ db: e.db, svc: e.svc, userId: e.userId }, e.row.undo);
  const { data, error } = await e.svc
    .from("ai_actions")
    .update({ status: "undone", undone_by: e.userId, undone_at: new Date().toISOString(), reported: false })
    .eq("id", e.row.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not update the action: ${error?.message}`);
  await audit(e.svc, e.actor, {
    bot_key: e.row.bot_key,
    conversation_id: e.row.conversation_id,
    event: "action",
    tool: e.row.tool,
    input: { action_id: e.row.id, undo: e.row.undo },
    result: { status: "undone", result },
  });
  return data as ActionRow;
}

/** Decisions the bot hasn't heard about yet in this chat, as one line for
 *  the next user turn; marks them reported. */
export async function pendingDecisionsNote(svc: Db, conversationId: string): Promise<string> {
  const { data } = await svc
    .from("ai_actions")
    .select("id,summary,status,reject_reason,error")
    .eq("conversation_id", conversationId)
    .eq("reported", false)
    .neq("status", "pending");
  if (!data?.length) return "";
  await svc.from("ai_actions").update({ reported: true }).in("id", data.map((d) => d.id));
  const label: Record<string, string> = {
    executed: "approved and done",
    rejected: "rejected",
    undone: "undone",
    failed: "failed",
  };
  return (
    "[Since your last reply: " +
    data
      .map((d) => {
        const extra = d.status === "rejected" && d.reject_reason ? ` (reason: ${d.reject_reason})` : d.status === "failed" && d.error ? ` (${d.error})` : "";
        return `"${d.summary}" was ${label[d.status] ?? d.status}${extra}`;
      })
      .join("; ") +
    ".]"
  );
}
