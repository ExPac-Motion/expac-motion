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
    .eq("user_id", uid)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(30);
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
};

export type AiStreamEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; phase: "start" | "done" | "error" }
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
