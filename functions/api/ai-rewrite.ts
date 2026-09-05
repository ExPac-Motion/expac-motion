/**
 * Cloudflare Pages Function — AI rewrite of mail template / campaign copy
 * via the Anthropic Messages API.
 *
 * Holds ANTHROPIC_API_KEY (Cloudflare Pages env). Verifies the caller is a
 * signed-in Supabase user (same as functions/api/send-mail.ts), then asks
 * Claude Haiku to rewrite an HTML fragment per a fixed action and returns
 * the rewritten HTML. Merge-field tokens ({{ contact.name }} etc.) and
 * <a> hrefs are preserved by the system prompt.
 *
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Request (POST /api/ai-rewrite):
 *   { action: "improve" | "shorten" | "tone", tone?: "warmer" | "formal" | "casual", text: string }
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

const MODEL = "claude-haiku-4-5-20251001";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

async function verifyUser(env, authHeader) {
  if (!authHeader || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
    });
    return r.ok;
  } catch {
    return false;
  }
}

const INSTRUCTION = {
  improve:
    "Rewrite to read more clearly and professionally, keeping the meaning and roughly the same length.",
  shorten:
    "Tighten this to be significantly more concise while keeping the key points.",
  "tone:warmer": "Rewrite in a warmer, friendlier tone.",
  "tone:formal": "Rewrite in a more formal, businesslike tone.",
  "tone:casual": "Rewrite in a more casual, conversational tone.",
};

const SYSTEM = [
  "You are an editor that rewrites outreach email copy for ExPac Forwarding, a freight-forwarding company.",
  "You receive an HTML fragment and an instruction.",
  "Rules:",
  "1. Return ONLY the rewritten HTML fragment — no explanation, no markdown code fences, no preamble.",
  "2. Keep the same kind of HTML structure (<p>, <br>, <b>, <a>, <ul>, <li>). You may merge or split paragraphs if the instruction calls for it.",
  "3. Never alter, remove, translate, or reformat these merge-field tokens — they must appear verbatim if present: {{ contact.name }}, {{ contact.company }}, {{ unsubscribe_link }}",
  "4. Keep every <a> href attribute exactly as given.",
  "5. Keep the original language.",
].join("\n");

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.ANTHROPIC_API_KEY) {
    return json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment." },
      500,
    );
  }

  const ok = await verifyUser(env, context.request.headers.get("authorization"));
  if (!ok) return json({ error: "Not authenticated." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Nothing to rewrite." }, 400);
  if (text.length > 20000) return json({ error: "Text is too long." }, 400);

  const key =
    body.action === "tone" ? `tone:${body.tone || "warmer"}` : body.action;
  const instruction = INSTRUCTION[key];
  if (!instruction) return json({ error: "Unknown action." }, 400);

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Instruction: ${instruction}\n\nHTML:\n${text}`,
          },
        ],
      }),
    });
  } catch (e) {
    return json(
      { error: "Could not reach Anthropic: " + (e && e.message ? e.message : e) },
      502,
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json(
      { error: (data && data.error && data.error.message) || "Anthropic returned " + res.status },
      res.status >= 500 ? 502 : 400,
    );
  }
  const out =
    Array.isArray(data.content) && data.content[0] && data.content[0].text
      ? String(data.content[0].text).trim()
      : "";
  if (!out) return json({ error: "Empty response from the model." }, 502);
  return json({ text: out });
}
