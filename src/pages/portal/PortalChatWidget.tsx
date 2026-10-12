import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useMyJobs, useMyMessages, useSendMyMessage } from "../../lib/hooks";
import { useMyGeneralChat, useSendGeneral } from "../../lib/clientChat";
import { formatDateTime } from "../../lib/format";

const GENERAL = "general";

/**
 * Floating chat toggle, available on every portal page, "chat to us" per
 * the redesign brief. "General" (the default, 0158) is a message to ExPac
 * that isn't about a shipment: it lands in Motion's Sales CRM › Customer
 * Messages. Picking a shipment sends it to that shipment's Comms instead
 * (client_send_message, 0026), the same as the shipment page's Messages.
 */
export default function PortalChatWidget() {
  const [open, setOpen] = useState(false);
  const { error } = useToast();
  const jobsQ = useMyJobs();
  const jobs = jobsQ.data ?? [];
  const [target, setTarget] = useState<string>(GENERAL);
  const isGeneral = target === GENERAL;

  const generalQ = useMyGeneralChat(open && isGeneral);
  const messagesQ = useMyMessages(open && !isGeneral ? target : undefined);
  const sendShipment = useSendMyMessage();
  const sendGeneral = useSendGeneral();
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const job = jobs.find((j) => j.id === target);
  const thread: { id: string; mine: boolean; body: string; at: string; who?: string | null }[] = isGeneral
    ? (generalQ.data ?? []).map((m) => ({ id: m.id, mine: m.direction === "in", body: m.body, at: m.created_at, who: m.sender_name }))
    : (messagesQ.data ?? [])
        .slice()
        .reverse()
        .map((m) => ({ id: m.id, mine: m.direction === "in", body: m.body ?? "", at: m.created_at }));
  const loading = isGeneral ? generalQ.isLoading : messagesQ.isLoading;
  const sending = sendGeneral.isPending || sendShipment.isPending;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread.length, open, target]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    try {
      if (isGeneral) await sendGeneral.mutateAsync(body);
      else await sendShipment.mutateAsync({ jobId: target, body });
      setDraft("");
    } catch (err) {
      error(err instanceof Error ? err.message : "Could not send");
    }
  }

  return (
    <div className="portal-chat">
      {open && (
        <div className="portal-chat-panel">
          <div className="portal-chat-head">
            <strong>Chat with ExPac</strong>
            <button type="button" className="link-btn" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <select className="portal-chat-jobpick" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="About">
            <option value={GENERAL}>General (not about a shipment)</option>
            {jobs.length > 0 && (
              <optgroup label="About a shipment">
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.reference}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <div className="portal-chat-body" ref={bodyRef}>
            {loading ? (
              <Loading />
            ) : thread.length === 0 ? (
              <p className="hint">
                {isGeneral
                  ? "Ask ExPac anything, rates, your account, invoices or a new shipment. The team replies here."
                  : `No messages yet, say hello about ${job?.reference ?? "this shipment"}.`}
              </p>
            ) : (
              thread.map((m) => (
                <div key={m.id} className={`portal-chat-msg${m.mine ? " me" : ""}`}>
                  <div className="muted small">
                    {m.mine ? "You" : m.who ? `${m.who}, ExPac` : "ExPac"} · {formatDateTime(m.at)}
                  </div>
                  <div style={{ whiteSpace: "pre-line" }}>{m.body}</div>
                </div>
              ))
            )}
          </div>
          <form className="portal-chat-form" onSubmit={onSend}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={isGeneral ? "Type a message to ExPac…" : `Message about ${job?.reference ?? "this shipment"}…`}
            />
            <button className="btn" type="submit" disabled={sending || !draft.trim()}>
              Send
            </button>
          </form>
        </div>
      )}

      <button type="button" className="portal-chat-toggle" onClick={() => setOpen((v) => !v)} aria-label="Chat with ExPac">
        {open ? "▾" : "💬"} {open ? "" : "Chat"}
      </button>
    </div>
  );
}
