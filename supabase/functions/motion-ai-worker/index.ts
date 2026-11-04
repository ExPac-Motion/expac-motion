// Motion AI worker (0218): runs the bot for queued trigger / schedule
// events. Called every minute by pg_cron (private.call_ai_worker) only when
// something is waiting, with the site's cron key in x-cron-key.
//
// Each event becomes a conversation (user_id null, source trigger /
// schedule) that admins see in the Motion AI panel; any actions it proposes
// are approval cards like in chat. Internal bots only: trigger runs use the
// service key, so portal bots are refused here.
//
// Deployed with --no-verify-jwt; the cron key is checked against the
// database (public.ai_check_worker_key).

import { audit, type Actor } from "../_shared/audit.ts";
import { json, serviceClient } from "../_shared/env.ts";
import { loadBot, loadSettings, runTurn } from "../_shared/engine.ts";

const TIME_BUDGET_MS = 110_000; // stay inside the Edge Function wall clock
const MAX_ATTEMPTS = 3;

interface EventRow {
  id: string;
  trigger_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
}
interface TriggerRow {
  key: string;
  label: string;
  kind: "event" | "schedule";
  bot_key: string;
  task: string;
  instruction: string;
  enabled: boolean;
}

function ddmmyyyy(d = new Date()): string {
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Johannesburg" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  const svc = serviceClient();
  const { data: keyOk } = await svc.rpc("ai_check_worker_key", { p_key: req.headers.get("x-cron-key") ?? "" });
  if (keyOk !== true) return json({ error: "Not allowed." }, 403);

  const started = Date.now();
  const settings = await loadSettings(svc);
  if (!settings.enabled) return json({ ok: true, paused: true });

  const { data: spend } = await svc.rpc("ai_month_spend");
  const overBudget = Number(spend ?? 0) >= Number(settings.monthly_budget_usd || 0) && Number(settings.monthly_budget_usd) > 0;

  const { data: claimed, error } = await svc.rpc("ai_claim_events", { p_limit: 5 });
  if (error) return json({ error: error.message }, 500);
  const events = (claimed ?? []) as EventRow[];
  const done: string[] = [];

  for (const ev of events) {
    // Out of time: hand the rest back untouched.
    if (Date.now() - started > TIME_BUDGET_MS) {
      await svc.from("ai_events").update({ status: "queued", attempts: Math.max(0, ev.attempts - 1) }).eq("id", ev.id);
      continue;
    }
    const finish = (patch: Record<string, unknown>) =>
      svc.from("ai_events").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", ev.id);

    if (overBudget) {
      await finish({ status: "skipped", error: "Monthly AI spend cap reached (Settings > Motion AI)." });
      continue;
    }

    const { data: trig } = await svc.from("ai_triggers").select("*").eq("key", ev.trigger_key).maybeSingle();
    const t = trig as TriggerRow | null;
    if (!t || !t.enabled) {
      await finish({ status: "skipped", error: "Trigger switched off." });
      continue;
    }
    const actor: Actor = { type: t.kind === "schedule" ? "schedule" : "trigger", triggerKey: t.key };

    let conversationId: string | null = null;
    try {
      const bot = await loadBot(svc, t.bot_key);
      if (bot.audience !== "staff") throw new Error("Only internal bots run from triggers.");
      if (!bot.enabled) throw new Error(`The ${bot.name} bot is switched off.`);

      const ref = (ev.payload.reference ?? ev.payload.company ?? "") as string;
      const title = t.key === "daily_briefing" ? `Daily briefing ${ddmmyyyy()}` : `${t.label}${ref ? `: ${ref}` : ""}`;
      const { data: conv, error: convErr } = await svc
        .from("ai_conversations")
        .insert({ bot_key: bot.key, user_id: null, source: actor.type, title, trigger_key: t.key })
        .select("id")
        .single();
      if (convErr || !conv) throw new Error(`Could not start the conversation: ${convErr?.message}`);
      conversationId = conv.id;

      const userText =
        `[Automatic run: ${t.label}. Nobody is reading live; your reply is saved for the team. ` +
        `Act only through approval cards, keep the reply short.]\n\n${t.instruction}` +
        (Object.keys(ev.payload ?? {}).length ? `\n\nEvent details:\n${JSON.stringify(ev.payload)}` : "");

      const result = await runTurn({
        svc,
        toolDb: svc,
        settings,
        bot,
        conversationId: conv.id,
        actor,
        userId: null,
        task: t.task || "trigger",
        userText,
      });
      await finish({ status: "done", conversation_id: conv.id, summary: result.text.slice(0, 500), error: null });
      done.push(ev.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retry = ev.attempts < MAX_ATTEMPTS;
      await svc
        .from("ai_events")
        .update({
          status: retry ? "queued" : "failed",
          run_after: new Date(Date.now() + ev.attempts * 5 * 60_000).toISOString(),
          error: msg,
          conversation_id: conversationId,
          finished_at: retry ? null : new Date().toISOString(),
        })
        .eq("id", ev.id);
      await audit(svc, actor, { bot_key: t.bot_key, conversation_id: conversationId, event: "error", ok: false, error: msg, input: { event_id: ev.id } });
    }
  }

  return json({ ok: true, claimed: events.length, done: done.length });
});
