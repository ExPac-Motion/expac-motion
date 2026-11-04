// Company knowledge for a bot turn (0219): the tone guide plus the active
// entries that best match the request, as one block for the user turn (not
// the system prompt, so the prompt cache holds). Learned corrections count
// only once an admin has approved them (status active).

import type { Db } from "./env.ts";
import type { ReadTool } from "./tools/types.ts";

const MAX_CHARS = 7000;

interface Entry {
  id: string;
  kind: string;
  title: string;
  body: string;
}

const KIND_LABEL: Record<string, string> = {
  sop: "SOP",
  pricing_rule: "Pricing rule",
  tone: "Tone",
  example: "Approved example",
  correction: "Correction from the team",
};

export async function knowledgeBlock(svc: Db, botKey: string, query: string): Promise<string> {
  try {
    const [tone, hits] = await Promise.all([
      svc
        .from("ai_knowledge")
        .select("id,kind,title,body")
        .eq("status", "active")
        .eq("kind", "tone")
        .in("scope", ["all", botKey])
        .limit(3),
      svc.rpc("ai_search_knowledge", { p_bot: botKey, p_query: query.slice(0, 2000), p_limit: 6 }),
    ]);
    const entries = [...((tone.data ?? []) as Entry[]), ...((hits.data ?? []) as Entry[])];
    if (!entries.length) return "";
    let out = "";
    const used: string[] = [];
    for (const e of entries) {
      const part = `### ${KIND_LABEL[e.kind] ?? e.kind}: ${e.title}\n${e.body.trim()}\n\n`;
      if (out.length + part.length > MAX_CHARS) break;
      out += part;
      used.push(e.id);
    }
    if (used.length) await svc.rpc("ai_mark_knowledge_used", { p_ids: used });
    return out ? `[Company knowledge, follow it:\n${out.trim()}]` : "";
  } catch (e) {
    console.error("knowledge lookup failed", e);
    return "";
  }
}

export const searchKnowledge: ReadTool = {
  name: "search_knowledge",
  kind: "read",
  description:
    "Search ExPac's knowledge base: SOPs, pricing rules, tone guide, approved examples and corrections from the team. Use it before guessing how ExPac does something.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "What you need, in a few words." } },
    required: ["query"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const q = typeof input.query === "string" ? input.query : "";
    const { data, error } = await ctx.db.rpc("ai_search_knowledge", { p_bot: ctx.botKey, p_query: q, p_limit: 6 });
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, entries: data ?? [] };
  },
};
