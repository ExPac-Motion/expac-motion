// ai_audit_log writer (append-only, service key). A failed log write
// never breaks the bot's answer, but is printed to the function logs.

import type { Db } from "./env.ts";

export interface Actor {
  type: "user" | "trigger" | "schedule" | "system";
  id?: string | null;
  triggerKey?: string | null;
}

export interface AuditRow {
  bot_key?: string;
  conversation_id?: string | null;
  event: "model_call" | "tool_call" | "action" | "error";
  tool?: string;
  input?: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
}

/** Keeps logged payloads to a sensible size. */
function clip(v: unknown, max = 20_000): unknown {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  if (s.length <= max) return v;
  return { truncated: true, preview: s.slice(0, max) };
}

export async function audit(svc: Db, actor: Actor, row: AuditRow): Promise<void> {
  const { error } = await svc.from("ai_audit_log").insert({
    ...row,
    input: clip(row.input),
    result: clip(row.result),
    ok: row.ok ?? true,
    actor_type: actor.type,
    actor_id: actor.id ?? null,
    trigger_key: actor.triggerKey ?? null,
  });
  if (error) console.error("ai_audit_log insert failed", error.message);
}
