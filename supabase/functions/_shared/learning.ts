// Learning loop (0219): every decision on an AI action is recorded in
// ai_feedback. An edit before approving, or a rejection with a reason,
// also becomes a learned knowledge entry, PENDING until an admin approves it
// in Settings > Motion AI knowledge.

import type { ActionRow } from "./actions.ts";
import type { Db } from "./env.ts";

const ACTION_LABEL: Record<string, string> = {
  create_task: "task",
  create_note: "note",
  update_shipment_status: "shipment status update",
  draft_quote: "quote draft",
  draft_email: "email",
};

/** Field-by-field "before → after" for the fields a person changed. */
function diffLines(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    if (k.endsWith("_label") || k.endsWith("_id")) continue;
    const a = JSON.stringify(before[k] ?? "");
    const b = JSON.stringify(after[k] ?? "");
    if (a !== b) out.push(`- ${k.replace(/_/g, " ")}: ${a} → ${b}`);
  }
  return out;
}

export async function recordFeedback(
  svc: Db,
  e: {
    row: ActionRow;
    userId: string;
    kind: "approve" | "edit" | "reject" | "undo";
    edited?: Record<string, unknown> | null;
    newSummary?: string;
    note?: string | null;
  },
): Promise<void> {
  try {
    let knowledgeId: string | null = null;
    const what = ACTION_LABEL[e.row.tool] ?? e.row.tool;
    let body: string | null = null;
    let title = "";
    if (e.kind === "edit" && e.edited) {
      const changes = diffLines(e.row.input, e.edited);
      if (changes.length) {
        title = `Team edit on a ${what}`;
        body =
          `Motion AI proposed: ${e.row.summary}\n` +
          (e.newSummary ? `The team approved it as: ${e.newSummary}\n` : "") +
          `What they changed:\n${changes.join("\n")}\n` +
          `Next time, propose it the way the team wanted.`;
      }
    } else if (e.kind === "reject" && e.note) {
      title = `Rejected ${what}`;
      body = `Motion AI proposed: ${e.row.summary}\nThe team rejected it. Reason: ${e.note}\nAvoid proposing this again in the same situation.`;
    }
    if (body) {
      const { data } = await svc
        .from("ai_knowledge")
        .insert({
          scope: e.row.bot_key,
          kind: "correction",
          title: `${title}: ${e.row.summary}`.slice(0, 160),
          body,
          tags: [e.row.tool],
          status: "pending",
          source: "learned",
          source_action_id: e.row.id,
          source_note: e.kind === "edit" ? "Edited before approving" : "Rejected with a reason",
          created_by: e.userId,
        })
        .select("id")
        .single();
      knowledgeId = data?.id ?? null;
    }
    await svc.from("ai_feedback").insert({
      user_id: e.userId,
      bot_key: e.row.bot_key,
      action_id: e.row.id,
      kind: e.kind,
      original: e.row.input,
      edited: e.edited ?? null,
      note: e.note ?? null,
      knowledge_id: knowledgeId,
    });
  } catch (err) {
    console.error("recordFeedback failed", err);
  }
}
