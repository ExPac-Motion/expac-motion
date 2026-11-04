// Motion AI chat: POST { message, conversation_id?, bot? }
// Streams the reply back as Server-Sent Events:
//   {type:"conversation", id}  first, so the panel knows the chat id
//   {type:"text", delta}       pieces of the answer as they are written
//   {type:"tool", name, phase} the bot is looking something up
//   {type:"action", action}    an approval card / suggestion / auto action
//   {type:"done"} | {type:"error", message}
//
// Deployed with --no-verify-jwt because the login is checked here (so the
// browser's CORS preflight gets through), using the caller's own token.

import { audit, type Actor } from "../_shared/audit.ts";
import { corsHeaders, json, serviceClient, userClient } from "../_shared/env.ts";
import { loadBot, loadSettings, runTurn } from "../_shared/engine.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);

  const db = userClient(authHeader);
  const { data: userData, error: userErr } = await db.auth.getUser(authHeader.slice(7));
  if (userErr || !userData?.user) return json({ error: "Not signed in." }, 401);
  const userId = userData.user.id;

  let body: { message?: unknown; conversation_id?: unknown; bot?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Type a message." }, 400);
  if (message.length > 8000) return json({ error: "Message is too long." }, 400);
  const botKey = typeof body.bot === "string" ? body.bot : "ops";

  const svc = serviceClient();
  let settings, bot;
  try {
    [settings, bot] = await Promise.all([loadSettings(svc), loadBot(svc, botKey)]);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!settings.enabled || !bot.enabled) return json({ error: "Motion AI is switched off in Settings." }, 403);

  // Access is decided by the database, not by this code or the prompt.
  if (bot.audience === "staff") {
    const { data: allowed } = await db.rpc("can_use_motion_ai");
    if (allowed !== true) return json({ error: "Your login does not have Motion AI access." }, 403);
  } else {
    // Portal / BDR bots arrive in a later phase with their own checks.
    return json({ error: "This bot is not available yet." }, 403);
  }

  // Continue an existing chat (must be the caller's own) or start one.
  let conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  if (conversationId) {
    const { data: conv } = await db.from("ai_conversations").select("id,bot_key").eq("id", conversationId).maybeSingle();
    if (!conv || conv.bot_key !== bot.key) return json({ error: "Chat not found." }, 404);
  } else {
    const { data: conv, error } = await svc
      .from("ai_conversations")
      .insert({ bot_key: bot.key, user_id: userId, source: "chat", title: message.slice(0, 80) })
      .select("id")
      .single();
    if (error || !conv) return json({ error: `Could not start a chat: ${error?.message}` }, 500);
    conversationId = conv.id;
  }

  const actor: Actor = { type: "user", id: userId };
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "conversation", id: conversationId });
      try {
        await runTurn({
          svc,
          toolDb: db,
          settings,
          bot,
          conversationId,
          actor,
          userId,
          task: "chat",
          userText: message,
          onText: (delta) => send({ type: "text", delta }),
          onTool: (name, phase) => send({ type: "tool", name, phase }),
          onAction: (row) => send({ type: "action", action: row }),
        });
        send({ type: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(svc, actor, { bot_key: bot.key, conversation_id: conversationId, event: "error", ok: false, error: msg });
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});
