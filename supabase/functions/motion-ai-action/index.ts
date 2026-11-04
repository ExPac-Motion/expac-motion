// Motion AI action decisions:
//   POST { action_id, decision: "approve", edited_input? }
//   POST { action_id, decision: "reject", reason? }
//   POST { action_id, decision: "undo" }
// Approve and Undo run with the caller's own login, so RLS and history show
// the real person. Returns { action } (the updated ai_actions row).
//
// Deployed with --no-verify-jwt; the login is checked here.

import { audit, type Actor } from "../_shared/audit.ts";
import { type ActionRow, executeAction, revertAction } from "../_shared/actions.ts";
import { corsHeaders, json, serviceClient, userClient } from "../_shared/env.ts";
import { actionTool } from "../_shared/tools/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);
  const db = userClient(authHeader);
  const { data: userData } = await db.auth.getUser(authHeader.slice(7));
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "Not signed in." }, 401);

  const { data: allowed } = await db.rpc("can_use_motion_ai");
  if (allowed !== true) return json({ error: "Your login does not have Motion AI access." }, 403);

  let body: { action_id?: unknown; decision?: unknown; edited_input?: unknown; reason?: unknown; result?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const id = typeof body.action_id === "string" ? body.action_id : "";
  const decision = body.decision;
  if (!id || !["approve", "reject", "undo", "complete"].includes(String(decision))) {
    return json({ error: "Give action_id and decision approve / reject / undo / complete." }, 400);
  }

  const svc = serviceClient();
  const { data, error } = await svc.from("ai_actions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return json({ error: "Action not found." }, 404);
  const row = data as ActionRow;
  const actor: Actor = { type: "user", id: userId };

  try {
    // Quote drafts and emails are finished in the app (priced / sent there);
    // it reports the result here.
    if (decision === "complete") {
      const tool = actionTool(row.tool);
      if (!tool || tool.runsIn !== "browser") return json({ error: "This action is approved on the server." }, 400);
      if (row.status !== "pending") return json({ error: `Already ${row.status}.` }, 409);
      const res = (body as { result?: Record<string, unknown> }).result ?? {};
      let undo: Record<string, unknown> | null = null;
      if (row.tool === "draft_quote") {
        const qid = String(res.quote_id ?? "");
        const { data: q } = await db.from("quotes").select("id,reference,ai_draft").eq("id", qid).maybeSingle();
        if (!q?.ai_draft) return json({ error: "That quote wasn't found as an AI draft." }, 400);
        undo = { quote_id: q.id, reference: q.reference };
      }
      const now = new Date().toISOString();
      const { data: upd, error: e3 } = await svc
        .from("ai_actions")
        .update({ status: "executed", result: res, undo, executed_at: now, decided_by: userId, decided_at: now })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("*")
        .single();
      if (e3 || !upd) return json({ error: "Could not record it." }, 409);
      await audit(svc, actor, {
        bot_key: row.bot_key,
        conversation_id: row.conversation_id,
        event: "action",
        tool: row.tool,
        input: { action_id: row.id },
        result: { status: "executed", result: res },
      });
      return json({ action: upd });
    }

    if (decision === "approve") {
      if (actionTool(row.tool)?.runsIn === "browser") {
        return json({ error: "Approve this one in the Motion AI panel; it finishes in the app." }, 400);
      }
      if (row.status !== "pending") return json({ error: `Already ${row.status}.` }, 409);
      let edited: Record<string, unknown> | null = null;
      if (body.edited_input && typeof body.edited_input === "object") {
        // Only the tool's editable fields can change, each re-checked.
        const tool = actionTool(row.tool);
        if (!tool) return json({ error: "Unknown action." }, 400);
        const prepared = tool.applyEdit(row.input, body.edited_input as Record<string, unknown>);
        edited = prepared.input;
        await svc.from("ai_actions").update({ summary: prepared.summary }).eq("id", row.id);
      }
      // Claim it first so a double click can't run it twice.
      const { data: claimed } = await svc
        .from("ai_actions")
        .update({ decided_by: userId, decided_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .is("decided_by", null)
        .select("id");
      if (!claimed?.length) return json({ error: "Someone else is already deciding this one." }, 409);
      const done = await executeAction({ svc, db, actor, row, deciderId: userId, editedInput: edited });
      return json({ action: done });
    }

    if (decision === "reject") {
      if (row.status !== "pending") return json({ error: `Already ${row.status}.` }, 409);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const { data: upd, error: e2 } = await svc
        .from("ai_actions")
        .update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString(), reject_reason: reason || null })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("*")
        .single();
      if (e2 || !upd) return json({ error: "Could not reject it." }, 409);
      await audit(svc, actor, {
        bot_key: row.bot_key,
        conversation_id: row.conversation_id,
        event: "action",
        tool: row.tool,
        input: { action_id: row.id },
        result: { status: "rejected", reason },
      });
      return json({ action: upd });
    }

    const undone = await revertAction({ svc, db, actor, row, userId });
    return json({ action: undone });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(svc, actor, {
      bot_key: row.bot_key,
      conversation_id: row.conversation_id,
      event: "error",
      tool: row.tool,
      input: { action_id: row.id, decision },
      ok: false,
      error: msg,
    });
    return json({ error: msg }, 400);
  }
});
