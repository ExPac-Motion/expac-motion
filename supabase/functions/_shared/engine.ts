// The Motion AI engine: one conversation turn for any bot.
//
//   load history -> call Claude with the bot's prompt + allowed tools ->
//   run the tools it asks for -> loop until it answers -> save + audit.
//
// The same function serves chat (a person) and, from stage 4, triggers and
// schedules (no person). It never chooses data access itself: the caller
// passes the right Supabase client in `toolDb`.

import Anthropic from "npm:@anthropic-ai/sdk@0.137.0";
import { audit, type Actor } from "./audit.ts";
import { type Db, sastDate } from "./env.ts";
import { toolsFor, type ToolContext } from "./tools/index.ts";

export interface AiSettings {
  enabled: boolean;
  models: Record<string, string>;
  effort: "low" | "medium" | "high";
  model_prices: Record<string, { in: number; out: number }>;
  monthly_budget_usd: number;
  max_tool_steps: number;
}

export interface Bot {
  key: string;
  name: string;
  audience: "staff" | "bdr" | "portal";
  system_prompt: string;
  allowed_tools: string[];
  enabled: boolean;
}

export async function loadSettings(svc: Db): Promise<AiSettings> {
  const { data, error } = await svc.from("ai_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error("Motion AI settings are missing. Has migration 0214 been run?");
  return data as AiSettings;
}

export async function loadBot(svc: Db, key: string): Promise<Bot> {
  const { data, error } = await svc.from("ai_bots").select("*").eq("key", key).maybeSingle();
  if (error || !data) throw new Error(`Unknown bot "${key}".`);
  return data as Bot;
}

/** USD for one call, including prompt-cache reads (0.1x) and writes (1.25x). */
function costOf(settings: AiSettings, model: string, u: Anthropic.Beta.BetaUsage): number {
  const p = settings.model_prices?.[model];
  if (!p) return 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const inCost = (u.input_tokens * p.in + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1e6;
  return inCost + (u.output_tokens * p.out) / 1e6;
}

/** Server-side refusal fallback is only accepted on these models. */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

const MAX_RESULT_CHARS = 40_000;

export interface TurnInput {
  svc: Db;
  toolDb: Db;
  settings: AiSettings;
  bot: Bot;
  conversationId: string;
  actor: Actor;
  userId: string | null;
  /** Which entry of ai_settings.models to use: chat / briefing / trigger / deep. */
  task: string;
  userText: string;
  onText?: (delta: string) => void;
  onTool?: (name: string, phase: "start" | "done" | "error") => void;
}

export interface TurnResult {
  text: string;
  stopReason: string | null;
  costUsd: number;
}

export async function runTurn(t: TurnInput): Promise<TurnResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set as a Supabase secret.");
  const client = new Anthropic({ apiKey });
  const model = t.settings.models?.[t.task] || t.settings.models?.chat || "claude-sonnet-5-5";

  // History replayed exactly as stored (thinking blocks included), never
  // edited or trimmed, so the model's earlier reasoning stays valid.
  const { data: rows, error: histErr } = await t.svc
    .from("ai_messages")
    .select("role,content")
    .eq("conversation_id", t.conversationId)
    .order("created_at");
  if (histErr) throw new Error(histErr.message);
  const messages: Anthropic.Beta.BetaMessageParam[] = (rows ?? []).map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));

  const save = async (role: "user" | "assistant", content: unknown, text: string | null, extra: Record<string, unknown> = {}) => {
    const { error } = await t.svc.from("ai_messages").insert({ conversation_id: t.conversationId, role, content, text, ...extra });
    if (error) throw new Error(`Saving the conversation failed: ${error.message}`);
  };

  // Today's date goes in the user turn, not the system prompt, so the
  // cached prefix (tools + system) stays byte-identical all day and longer.
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `[Today is ${sastDate(0)} (South Africa).]\n\n${t.userText}` },
  ];
  messages.push({ role: "user", content: userContent });
  await save("user", userContent, t.userText);

  const tools = toolsFor(t.bot.allowed_tools);
  const apiTools: Anthropic.Beta.BetaTool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Beta.BetaTool.InputSchema,
  }));
  const ctx: ToolContext = { db: t.toolDb, userId: t.userId, botKey: t.bot.key, conversationId: t.conversationId };

  let totalCost = 0;
  let finalText = "";
  let stopReason: string | null = null;
  const maxSteps = t.settings.max_tool_steps || 10;

  for (let step = 0; step < maxSteps; step++) {
    const started = Date.now();
    const params: Record<string, unknown> = {
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: t.bot.system_prompt, cache_control: { type: "ephemeral" } }],
      tools: apiTools,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: t.settings.effort || "medium" },
    };
    const betas: string[] = [];
    if (FALLBACK_MODELS.has(model)) {
      betas.push("server-side-fallback-2026-07-01");
      params.fallbacks = "default";
    }
    if (betas.length) params.betas = betas;

    let msg: Anthropic.Beta.BetaMessage;
    try {
      // deno-lint-ignore no-explicit-any
      const stream = client.beta.messages.stream(params as any);
      if (t.onText) stream.on("text", (d: string) => t.onText!(d));
      msg = await stream.finalMessage();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await audit(t.svc, t.actor, {
        bot_key: t.bot.key,
        conversation_id: t.conversationId,
        event: "error",
        model,
        ok: false,
        error: err,
        duration_ms: Date.now() - started,
      });
      throw new Error(`Claude request failed: ${err}`);
    }

    const cost = costOf(t.settings, msg.model || model, msg.usage);
    totalCost += cost;
    stopReason = msg.stop_reason;
    await audit(t.svc, t.actor, {
      bot_key: t.bot.key,
      conversation_id: t.conversationId,
      event: "model_call",
      model: msg.model || model,
      input_tokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
      output_tokens: msg.usage.output_tokens,
      cost_usd: cost,
      result: { stop_reason: msg.stop_reason, cache_read: msg.usage.cache_read_input_tokens ?? 0 },
      duration_ms: Date.now() - started,
    });

    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    await save("assistant", msg.content, text || null, {
      model: msg.model || model,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
    });
    if (text) finalText += (finalText ? "\n\n" : "") + text;

    if (msg.stop_reason === "refusal") {
      const note = "I can't help with that request.";
      t.onText?.(note);
      finalText += note;
      break;
    }
    if (msg.stop_reason === "pause_turn") continue;
    if (msg.stop_reason !== "tool_use") break;

    // Run every tool call of this step in parallel; all results go back in
    // one user message.
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = tools.find((x) => x.name === call.name);
        const toolStarted = Date.now();
        t.onTool?.(call.name, "start");
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (!tool) {
          t.onTool?.(call.name, "error");
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Tool ${call.name} is not available to this bot.` };
        }
        try {
          const out = await tool.run(ctx, input);
          let s = JSON.stringify(out);
          if (s.length > MAX_RESULT_CHARS) {
            s = s.slice(0, MAX_RESULT_CHARS) + '..."(result cut short, narrow the search)"';
          }
          await audit(t.svc, t.actor, {
            bot_key: t.bot.key,
            conversation_id: t.conversationId,
            event: "tool_call",
            tool: call.name,
            input,
            result: out,
            duration_ms: Date.now() - toolStarted,
          });
          t.onTool?.(call.name, "done");
          return { type: "tool_result", tool_use_id: call.id, content: s };
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          await audit(t.svc, t.actor, {
            bot_key: t.bot.key,
            conversation_id: t.conversationId,
            event: "tool_call",
            tool: call.name,
            input,
            ok: false,
            error: err,
            duration_ms: Date.now() - toolStarted,
          });
          t.onTool?.(call.name, "error");
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Error: ${err}` };
        }
      }),
    );
    messages.push({ role: "user", content: results });
    await save("user", results, null);

    if (step === maxSteps - 1) {
      const note = "\n\n(I reached my step limit for one answer. Ask me to continue if you need more.)";
      t.onText?.(note);
      finalText += note;
    }
  }

  await t.svc.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", t.conversationId);
  return { text: finalText, stopReason, costUsd: totalCost };
}
