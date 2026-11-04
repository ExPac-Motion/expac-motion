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

export interface ToolDef {
  name: string;
  /** read = look up only; action = changes data (goes through autonomy levels, stage 2). */
  kind: "read" | "action";
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}
