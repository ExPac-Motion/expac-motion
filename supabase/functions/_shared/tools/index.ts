// Tool registry: every tool any bot can use, looked up by name.

import { ACTION_TOOLS } from "./actions.ts";
import { READ_TOOLS } from "./read.ts";
import { findStatusUpdates } from "./status.ts";
import { DRAFT_TOOLS } from "./drafts.ts";
import { searchKnowledge } from "../knowledge.ts";
import type { ActionTool, ToolDef } from "./types.ts";

export const ALL_TOOLS: Record<string, ToolDef> = Object.fromEntries(
  [...READ_TOOLS, findStatusUpdates, searchKnowledge, ...ACTION_TOOLS, ...DRAFT_TOOLS].map((t) => [t.name, t]),
);

export function actionTool(name: string): ActionTool | null {
  const t = ALL_TOOLS[name];
  return t && t.kind === "action" ? t : null;
}

/** The bot's allowed tools, in a fixed order so the prompt cache holds. */
export function toolsFor(allowed: string[]): ToolDef[] {
  return [...new Set(allowed)]
    .sort()
    .map((n) => ALL_TOOLS[n])
    .filter((t): t is ToolDef => !!t);
}

export type { ActionTool, ExecContext, ReadTool, ToolContext, ToolDef } from "./types.ts";
