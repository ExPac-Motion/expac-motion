// The shape every Motion AI tool follows. A bot sees only the tools named
// in its ai_bots.allowed_tools row.

import type { Db } from "../env.ts";

export interface ToolContext {
  /** The caller's own client (their RLS). For trigger runs of internal
   *  bots this is the service client. */
  db: Db;
  /** Signed-in user, or null for a trigger / schedule run. */
  userId: string | null;
  botKey: string;
  conversationId: string | null;
}

interface ToolBase {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** Looks things up, never changes anything. */
export interface ReadTool extends ToolBase {
  kind: "read";
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface PreparedAction {
  /** Cleaned input with references resolved to ids; stored on ai_actions. */
  input: Record<string, unknown>;
  /** One plain line for the approval card. */
  summary: string;
  target_type?: string;
  target_id?: string | null;
  target_ref?: string | null;
}

export interface ExecContext {
  /** The person who approved it (their RLS), or the service client for an
   *  auto action in a trigger run. */
  db: Db;
  /** Service client, only for reversing the bot's own creations on Undo. */
  svc: Db;
  userId: string | null;
}

/** Changes data. Never runs directly: the engine records an ai_actions row
 *  and its autonomy level decides suggest / draft / auto. */
export interface ActionTool extends ToolBase {
  kind: "action";
  /** Validates and resolves references (as the requester). Throws a plain
   *  message the bot can relay when something doesn't add up. */
  prepare(ctx: ToolContext, input: Record<string, unknown>): Promise<PreparedAction>;
  /** Does it. Returns what to show and what Undo needs (null = no undo). */
  execute(ctx: ExecContext, input: Record<string, unknown>): Promise<{ result: unknown; undo: unknown | null }>;
  revert?(ctx: ExecContext, undo: Record<string, unknown>): Promise<unknown>;
  /** A person's edit on the approval card: only these fields can change.
   *  Returns the new stored input + summary; throws on a bad value. */
  applyEdit(stored: Record<string, unknown>, changes: Record<string, unknown>): PreparedAction;
}

export type ToolDef = ReadTool | ActionTool;
