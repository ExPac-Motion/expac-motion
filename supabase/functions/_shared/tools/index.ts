// Tool registry: every tool any bot can use, looked up by name.

import { READ_TOOLS } from "./read.ts";
import type { ToolDef } from "./types.ts";

export const ALL_TOOLS: Record<string, ToolDef> = Object.fromEntries(
  READ_TOOLS.map((t) => [t.name, t]),
);

/** The bot's allowed tools, in a fixed order so the prompt cache holds. */
export function toolsFor(allowed: string[]): ToolDef[] {
  return [...new Set(allowed)]
    .sort()
    .map((n) => ALL_TOOLS[n])
    .filter((t): t is ToolDef => !!t);
}

export type { ToolContext, ToolDef } from "./types.ts";
