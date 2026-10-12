// A customer's General portal chat (0158) in Motion: the thread, read on
// open, and ExPac's reply (optionally also by email). Used by Sales CRM ›
// Customer Messages and the customer record's Messages tab.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorNote, Loading } from "./common";
import { useToast } from "./Toast";
import { formatDateTime } from "../lib/format";
import { useMyProfile } from "../lib/hooks";
import { replyEmails, useClientThread, useMarkClientChatRead, useReplyClientChat } from "../lib/clientChat";

export default function ClientChatThread({
  clientId,
  company,
  clientEmail,
}: {
  clientId: string;
  company: string;
  clientEmail?: string | null;
}) {
  const { toast, error } = useToast();
  const threadQ = useClientThread(clientId);
  const markRead = useMarkClientChatRead();
  const reply = useReplyClientChat();
  const meQ = useMyProfile();
  const [draft, setDraft] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const thread = threadQ.data ?? [];
  const unread = thread.some((m) => m.direction === "in" && !m.read_at);
  const emails = replyEmails(thread, clientEmail);

  useEffect(() => {
    if (unread && !markRead.isPending) markRead.mutate(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, clientId]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread.length]);

  function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    reply.mutate(
      {
        clientId,
        body,
        senderName: meQ.data?.full_name ?? null,
        email: alsoEmail && emails.length > 0 ? emails : null,
      },
      {
        onSuccess: () => {
          setDraft("");
          toast(alsoEmail && emails.length ? `Sent, and emailed to ${emails.join(", ")}` : "Sent to the portal");
        },
        onError: (err) => error(err.message),
      },
    );
  }

  return (
    <div className="cchat">
      <div className="cchat-body" ref={bodyRef}>
        {threadQ.isLoading ? (
          <Loading />
        ) : threadQ.isError ? (
          <ErrorNote error={threadQ.error} />
        ) : thread.length === 0 ? (
          <p className="hint">No general messages with {company} yet. Write the first one below, it shows in their portal chat.</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} className={`cchat-msg${m.direction === "out" ? " ours" : ""}`}>
              <div className="cchat-meta">
                {m.direction === "out" ? `${m.sender_name || "ExPac"} (ExPac)` : m.sender_name || m.sender_email || company} ·{" "}
                {formatDateTime(m.created_at)}
              </div>
              <div className="cchat-text">{m.body}</div>
            </div>
          ))
        )}
      </div>
      <form className="cchat-form" onSubmit={onSend}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Reply to ${company}…`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend(e);
          }}
        />
        <div className="cchat-actions">
          <label className="check" title={emails.length ? emails.join(", ") : "No email address on file"}>
            <input
              type="checkbox"
              checked={alsoEmail && emails.length > 0}
              disabled={emails.length === 0}
              onChange={(e) => setAlsoEmail(e.target.checked)}
            />{" "}
            Also email the customer{emails.length ? ` (${emails.join(", ")})` : " (no email on file)"}
          </label>
          <button className="btn" type="submit" disabled={reply.isPending || !draft.trim()}>
            {reply.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
