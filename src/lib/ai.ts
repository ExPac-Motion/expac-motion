import { supabase } from "./supabase";

export type RewriteAction = "improve" | "shorten" | "tone";
export type RewriteTone = "warmer" | "formal" | "casual";

interface RewriteInput {
  action: RewriteAction;
  tone?: RewriteTone;
  text: string;
}

/**
 * Rewrite mail template / campaign HTML through the /api/ai-rewrite
 * Cloudflare Pages Function (which holds the Anthropic key). Returns the
 * rewritten HTML fragment.
 */
export async function rewriteCopy(input: RewriteInput): Promise<{ text: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch("/api/ai-rewrite", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session?.access_token
        ? { authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(input),
  });

  const raw = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!res.ok || raw.error || !raw.text) {
    if (res.status === 404) {
      throw new Error("AI rewrite runs on the deployed site (no API here in dev).");
    }
    throw new Error(raw.error || `AI service returned ${res.status}`);
  }
  return { text: raw.text };
}
