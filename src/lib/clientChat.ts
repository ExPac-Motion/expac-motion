// Portal chat, "General" messages (migration 0158): a customer's messages
// to ExPac that aren't about a shipment, and ExPac's replies. Shipment chat
// stays in messages / Shipment Comms.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { sendMail, SUPPORT_BCC } from "./mail";

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export interface ClientChatMessage {
  id: string;
  client_id: string;
  direction: "in" | "out";
  body: string;
  sender_name: string | null;
  sender_email: string | null;
  created_at: string;
  read_at: string | null;
}
export interface ClientChatRow extends ClientChatMessage {
  clients: { company: string; email: string | null } | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- Customer Portal ---------- */

/** The signed-in customer's General thread, oldest first. */
export function useMyGeneralChat(enabled = true) {
  return useQuery({
    queryKey: ["my_general_chat"],
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    queryFn: async () =>
      unwrap<ClientChatMessage[]>(
        await supabase.from("client_chat").select("*").order("created_at", { ascending: true }),
      ),
  });
}
export function useSendGeneral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => unwrap(await supabase.rpc("portal_send_general", { p_body: body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my_general_chat"] }),
  });
}

/* ---------- Motion (staff) ---------- */

/** Every General message (newest first), for Sales CRM › Customer Messages. */
export function useClientChats() {
  return useQuery({
    queryKey: ["client_chat"],
    refetchInterval: 45_000,
    queryFn: async () =>
      unwrap<ClientChatRow[]>(
        await supabase
          .from("client_chat")
          .select("*, clients(company, email)")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
  });
}
/** One customer's thread, oldest first. */
export function useClientThread(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["client_chat", clientId],
    enabled: !!clientId,
    refetchInterval: 45_000,
    queryFn: async () =>
      unwrap<ClientChatMessage[]>(
        await supabase
          .from("client_chat")
          .select("*")
          .eq("client_id", clientId as string)
          .order("created_at", { ascending: true }),
      ),
  });
}
/** Unread customer messages (notification bell). */
export function useUnreadClientChat() {
  return useQuery({
    queryKey: ["client_chat", "unread"],
    refetchInterval: 45_000,
    queryFn: async () =>
      unwrap<{ id: string; client_id: string; created_at: string; clients: { company: string } | null }[]>(
        // many-to-one join: PostgREST returns one object, not the array the types guess
        (await supabase
          .from("client_chat")
          .select("id, client_id, created_at, clients(company)")
          .eq("direction", "in")
          .is("read_at", null)
          .order("created_at", { ascending: false })) as never,
      ),
  });
}

export function useMarkClientChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) =>
      unwrap(
        await supabase
          .from("client_chat")
          .update({ read_at: new Date().toISOString() })
          .eq("client_id", clientId)
          .eq("direction", "in")
          .is("read_at", null),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client_chat"] }),
  });
}

/** ExPac's reply; with `email`, the customer also gets it by email (to the
 *  logins that wrote in, else the customer's main email), support@ in Bcc. */
export function useReplyClientChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      body: string;
      senderName: string | null;
      email: string[] | null;
    }) => {
      unwrap(
        await supabase.from("client_chat").insert({
          client_id: input.clientId,
          direction: "out",
          body: input.body,
          sender_name: input.senderName,
        }),
      );
      if (input.email && input.email.length > 0) {
        const link = `${window.location.origin}/portal`;
        const html =
          `<p>${esc(input.body).replace(/\n/g, "<br>")}</p>` +
          `<p>${esc(input.senderName || "ExPac")}<br>ExPac</p>` +
          `<p style="color:#6f756d">Reply in the ExPac Motion portal (Chat with ExPac): <a href="${link}">${link}</a></p>`;
        const text = `${input.body}\n\n${input.senderName || "ExPac"}\nExPac\n\nReply in the ExPac Motion portal (Chat with ExPac): ${link}`;
        await sendMail({
          to: input.email,
          bcc: SUPPORT_BCC,
          subject: "New message from ExPac",
          html,
          text,
        });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["client_chat"] }),
  });
}

/** Where a reply's email goes: the logins that wrote in, else the customer's email. */
export function replyEmails(thread: ClientChatMessage[], fallback: string | null | undefined): string[] {
  const fromThread = [
    ...new Set(
      thread
        .filter((m) => m.direction === "in" && m.sender_email)
        .slice(-5)
        .map((m) => (m.sender_email as string).toLowerCase()),
    ),
  ];
  if (fromThread.length > 0) return fromThread;
  return fallback ? [fallback] : [];
}
