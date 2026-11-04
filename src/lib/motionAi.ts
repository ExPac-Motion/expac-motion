// Motion AI client side (migration 0214, Edge Function motion-ai-chat).
// The browser never sees the Anthropic key: it sends the signed-in user's
// own Supabase token to the Edge Function, which does the AI call.

import { supabase } from "./supabase";

export interface AiConversation {
  id: string;
  bot_key: string;
  title: string | null;
  source: "chat" | "trigger" | "schedule";
  created_at: string;
  updated_at: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
}

export async function listAiConversations(): Promise<AiConversation[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id,bot_key,title,source,created_at,updated_at")
    // Own chats, plus briefings and automatic runs (0218; RLS shows those
    // to admins only).
    .or(`user_id.eq.${uid},source.neq.chat`)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as AiConversation[];
}

/** The readable turns of a chat (tool calls and results are skipped). */
export async function listAiMessages(conversationId: string): Promise<AiChatMessage[]> {
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id,role,text,created_at")
    .eq("conversation_id", conversationId)
    .not("text", "is", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as AiChatMessage[];
}

export async function archiveAiConversation(id: string): Promise<void> {
  const { error } = await supabase.from("ai_conversations").update({ archived: true }).eq("id", id);
  if (error) throw error;
}

/** Plain-language label for "the bot is looking something up". */
export const AI_TOOL_LABEL: Record<string, string> = {
  search_shipments: "Searching shipments",
  get_shipment: "Opening the shipment",
  search_quotes: "Searching quotations",
  get_quote: "Opening the quotation",
  search_clients: "Searching customers",
  get_client: "Opening the customer",
  search_suppliers: "Searching vendors and partners",
  search_leads: "Searching leads",
  search_opportunities: "Checking the pipeline",
  list_tasks: "Checking tasks",
  get_alerts: "Checking Control Tower alerts",
  build_briefing: "Putting the briefing together",
  lookup_rates: "Checking the tariff sheet",
  find_status_updates: "Finding shipments that need a status update",
  draft_quote: "Preparing a quote draft",
  draft_email: "Drafting an email",
  create_task: "Preparing a task",
  create_note: "Preparing a note",
  update_shipment_status: "Preparing a status update",
};

export type AiStreamEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; phase: "start" | "done" | "error" }
  | { type: "action"; action: AiAction }
  | { type: "done" }
  | { type: "error"; message: string };

/** Sends one message and calls `onEvent` for each streamed event. */
export async function sendAiMessage(
  input: { message: string; conversationId?: string | null; bot?: string },
  onEvent: (e: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You're signed out. Sign in again.");

  const res = await fetch(`${url}/functions/v1/motion-ai-chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ message: input.message, conversation_id: input.conversationId || undefined, bot: input.bot || "ops" }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Motion AI is not reachable (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AiStreamEvent);
      } catch {
        /* ignore a malformed chunk */
      }
    }
  }
}

/* ---------- Stage 2: actions, autonomy levels, settings (0215) ---------- */

export type AiLevel = "suggest" | "draft" | "auto";
export type AiActionStatus = "suggested" | "pending" | "executed" | "rejected" | "undone" | "failed";

export interface AiAction {
  id: string;
  created_at: string;
  bot_key: string;
  conversation_id: string | null;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
  edited_input: Record<string, unknown> | null;
  level: AiLevel;
  status: AiActionStatus;
  target_type: string | null;
  target_id: string | null;
  target_ref: string | null;
  actor_type: "user" | "trigger" | "schedule" | "system";
  requested_by: string | null;
  trigger_key: string | null;
  decided_by: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  executed_at: string | null;
  result: unknown;
  undo: Record<string, unknown> | null;
  undone_by: string | null;
  undone_at: string | null;
  error: string | null;
}

export const AI_ACTION_LABEL: Record<string, string> = {
  create_task: "Create a task",
  create_note: "Create a note",
  update_shipment_status: "Update shipment status",
  draft_quote: "Draft a quotation",
  draft_email: "Email a customer or supplier",
};

export const AI_STATUS_LABEL: Record<AiActionStatus, string> = {
  suggested: "Suggested",
  pending: "Awaiting approval",
  executed: "Done",
  rejected: "Rejected",
  undone: "Undone",
  failed: "Failed",
};

export const AI_LEVEL_LABEL: Record<AiLevel, string> = {
  suggest: "Suggest only",
  draft: "Draft for approval",
  auto: "Auto-execute",
};

export async function listAiActions(opts: { conversationId?: string; status?: string; limit?: number } = {}): Promise<AiAction[]> {
  let q = supabase.from("ai_actions").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.conversationId) q = q.eq("conversation_id", opts.conversationId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AiAction[];
}

/** Approve (optionally with edits), reject (optional reason) or undo. */
export async function decideAiAction(
  actionId: string,
  decision: "approve" | "reject" | "undo" | "complete",
  extra: { edited_input?: Record<string, unknown>; reason?: string; result?: Record<string, unknown> } = {},
): Promise<AiAction> {
  const { data, error } = await supabase.functions.invoke("motion-ai-action", {
    body: { action_id: actionId, decision, ...extra },
  });
  if (error) {
    // The function's own message is in the response body.
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) msg = j.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(msg);
  }
  return (data as { action: AiAction }).action;
}

export interface AiPolicy {
  bot_key: string;
  action: string;
  label: string;
  level: AiLevel;
  locked: boolean;
}
export async function listAiPolicies(): Promise<AiPolicy[]> {
  const { data, error } = await supabase.from("ai_action_policies").select("bot_key,action,label,level,locked").order("action");
  if (error) throw error;
  return (data ?? []) as AiPolicy[];
}
export async function setAiPolicyLevel(botKey: string, action: string, level: AiLevel): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("ai_action_policies")
    .update({ level, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("bot_key", botKey)
    .eq("action", action);
  if (error) throw error;
}

export interface AiScore {
  bot_key: string;
  action: string;
  approved_as_is: number;
  approved_edited: number;
  rejected: number;
  undone: number;
  failed: number;
  auto_done: number;
  pending: number;
  streak: number;
}
export async function listAiScorecard(): Promise<AiScore[]> {
  const { data, error } = await supabase.from("ai_action_scorecard").select("*");
  if (error) throw error;
  return (data ?? []) as AiScore[];
}

export interface AiSettingsRow {
  enabled: boolean;
  models: Record<string, string>;
  effort: "low" | "medium" | "high";
  model_prices: Record<string, { in: number; out: number }>;
  monthly_budget_usd: number;
  briefing_time: string;
  briefing_days: number[];
  max_tool_steps: number;
}
export async function getAiSettings(): Promise<AiSettingsRow> {
  const { data, error } = await supabase.from("ai_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as AiSettingsRow;
}
export async function saveAiSettings(patch: Partial<AiSettingsRow>): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("ai_settings")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("id", 1);
  if (error) throw error;
}
export async function getAiMonthSpend(): Promise<number> {
  const { data, error } = await supabase.rpc("ai_month_spend");
  if (error) throw error;
  return Number(data ?? 0);
}

export interface AiBotRow {
  key: string;
  name: string;
  system_prompt: string;
  allowed_tools: string[];
  enabled: boolean;
}
export async function listAiBots(): Promise<AiBotRow[]> {
  const { data, error } = await supabase.from("ai_bots").select("key,name,system_prompt,allowed_tools,enabled").order("key");
  if (error) throw error;
  return (data ?? []) as AiBotRow[];
}
export async function saveAiBotPrompt(key: string, system_prompt: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("ai_bots")
    .update({ system_prompt, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("key", key);
  if (error) throw error;
}

/** Models offered in Settings; any other model id can be typed in. */
export const AI_MODEL_CHOICES = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast, cheapest)" },
];
export const AI_TASK_LABEL: Record<string, string> = {
  chat: "Chat panel",
  briefing: "Daily briefing",
  trigger: "Trigger checks",
  deep: "Drafting quotes",
};

/* ---------- Stage 4: triggers, events, briefings (0218) ---------- */

export interface AiTrigger {
  key: string;
  label: string;
  kind: "event" | "schedule";
  enabled: boolean;
  sort: number;
  instruction: string;
}
export async function listAiTriggers(): Promise<AiTrigger[]> {
  const { data, error } = await supabase.from("ai_triggers").select("key,label,kind,enabled,sort,instruction").order("sort");
  if (error) throw error;
  return (data ?? []) as AiTrigger[];
}
export async function setAiTriggerEnabled(key: string, enabled: boolean): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("ai_triggers")
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("key", key);
  if (error) throw error;
}

export interface AiEvent {
  id: string;
  created_at: string;
  trigger_key: string;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  attempts: number;
  finished_at: string | null;
  conversation_id: string | null;
  summary: string | null;
  error: string | null;
}
export async function listAiEvents(limit = 40): Promise<AiEvent[]> {
  const { data, error } = await supabase
    .from("ai_events")
    .select("id,created_at,trigger_key,payload,status,attempts,finished_at,conversation_id,summary,error")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AiEvent[];
}

/** The newest daily briefing: its conversation and the bot's text. */
export async function getLatestBriefing(): Promise<{ conversation: AiConversation; text: string } | null> {
  const { data: conv, error } = await supabase
    .from("ai_conversations")
    .select("id,bot_key,title,source,created_at,updated_at")
    .eq("trigger_key", "daily_briefing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!conv) return null;
  const msgs = await listAiMessages(conv.id);
  const text = msgs
    .filter((m) => m.role === "assistant")
    .map((m) => m.text)
    .join("\n\n");
  return { conversation: conv as AiConversation, text };
}
