import { supabase } from "./supabase";

export interface SendMailInput {
  jobId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
}

interface SendMailResult {
  id?: string;
  error?: string;
}

/**
 * Send a customer email through the /api/send-mail Cloudflare Pages Function
 * (which holds the Resend key). Returns the Resend message id.
 */
export async function sendMail(input: SendMailInput): Promise<{ id: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch("/api/send-mail", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session?.access_token
        ? { authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(input),
  });

  const raw = (await res.json().catch(() => ({}))) as SendMailResult;
  if (!res.ok || raw.error || !raw.id) {
    if (res.status === 404) {
      throw new Error(
        "Email sending runs on the deployed site (no API here in dev).",
      );
    }
    throw new Error(raw.error || `Mail service returned ${res.status}`);
  }
  return { id: raw.id };
}
