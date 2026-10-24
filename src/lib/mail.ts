import { supabase } from "./supabase";

export interface MailAttachment {
  filename: string;
  /** base64-encoded file content, no data: prefix. */
  content: string;
}

export interface SendMailInput {
  jobId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  /** Overrides the sender display name (address stays the verified domain). */
  fromName?: string;
  replyTo?: string;
  /** List mail only (campaigns / follow-ups), the one-click unsubscribe API
   *  endpoint (`/api/unsubscribe?r=...`), not the human-facing page. Sets the
   *  `List-Unsubscribe` header so mail clients offer their native one-click
   *  unsubscribe. */
  unsubscribeUrl?: string;
  /** Inbox replies: thread under the original (its Message-ID / References). */
  inReplyTo?: string;
  references?: string;
}

/** Standing rule: support@ is blind-copied on every Shipment Comms message and
 *  every Quick Mail (one-off customer / lead email). Campaigns and automated
 *  follow-ups are excluded. */
export const SUPPORT_BCC = ["support@expac.co.za"];

interface SendMailResult {
  id?: string;
  error?: string;
}

/** The sender name from Settings → Email, null when it can't be read (e.g.
 *  a portal login, whose mail the server labels itself). */
async function settingsSenderName(): Promise<string | null> {
  const { data } = await supabase.from("company_settings").select("mail_sender_name").eq("id", 1).maybeSingle();
  const name = (data as { mail_sender_name?: string } | null)?.mail_sender_name?.trim();
  return name || null;
}

/**
 * Send a customer email through the /api/send-mail Cloudflare Pages Function
 * (which holds the Resend key). Returns the Resend message id. Without a
 * `fromName` the Settings sender name is used (chat, portal invites, POD and
 * warehouse notices), not the server's MAIL_FROM default.
 */
export async function sendMail(input: SendMailInput): Promise<{ id: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!input.fromName) {
    const name = await settingsSenderName().catch(() => null);
    if (name) input = { ...input, fromName: name };
  }

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
