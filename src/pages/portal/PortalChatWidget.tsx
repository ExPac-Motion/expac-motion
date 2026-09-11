import { useEffect, useState, type FormEvent } from "react";
import { Loading } from "../../components/common";
import { useMyJobs, useMyMessages, useSendMyMessage } from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";

/**
 * Floating chat toggle, available on every portal page — "chat to us" per
 * the redesign brief. Messages are still per-shipment under the hood
 * (client_send_message needs a job_id, see 0026), so with more than one
 * shipment the panel opens with a small picker; sending still goes through
 * the exact same RPC as the shipment page's own Messages panel.
 */
export default function PortalChatWidget() {
  const [open, setOpen] = useState(false);
  const jobsQ = useMyJobs();
  const jobs = jobsQ.data ?? [];
  const [jobId, setJobId] = useState<string>("");

  useEffect(() => {
    if (!jobId && jobsQ.data && jobsQ.data.length > 0) setJobId(jobsQ.data[0].id);
  }, [jobId, jobsQ.data]);

  const messagesQ = useMyMessages(jobId || undefined);
  const sendMessage = useSendMyMessage();
  const [draft, setDraft] = useState("");

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !jobId) return;
    setDraft("");
    await sendMessage.mutateAsync({ jobId, body });
  }

  const messages = (messagesQ.data ?? []).slice().reverse();

  return (
    <div className="portal-chat">
      {open && (
        <div className="portal-chat-panel">
          <div className="portal-chat-head">
            <strong>Chat with ExPac</strong>
            <button
              type="button"
              className="link-btn"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className="hint" style={{ padding: 14 }}>
              You don't have any shipments yet — nothing to chat about.
            </p>
          ) : (
            <>
              {jobs.length > 1 && (
                <select
                  className="portal-chat-jobpick"
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                >
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.reference}
                    </option>
                  ))}
                </select>
              )}
              <div className="portal-chat-body">
                {messagesQ.isLoading ? (
                  <Loading />
                ) : messages.length === 0 ? (
                  <p className="hint">
                    No messages yet — say hello about {jobs[0]?.reference}.
                  </p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`portal-chat-msg${m.direction === "in" ? " me" : ""}`}
                    >
                      <div className="muted small">
                        {m.direction === "in" ? "You" : "ExPac"} ·{" "}
                        {formatDateTime(m.created_at)}
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
                  placeholder="Type a message…"
                />
                <button
                  className="btn"
                  type="submit"
                  disabled={sendMessage.isPending || !draft.trim()}
                >
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="portal-chat-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Chat with ExPac"
      >
        {open ? "▾" : "💬"} {open ? "" : "Chat"}
      </button>
    </div>
  );
}
