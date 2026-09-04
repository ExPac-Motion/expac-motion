import { useMemo, useState } from "react";
import { Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useAddNote, useMessages, useSendMessage } from "../../lib/hooks";
import { buildShipmentEmail } from "../../lib/mailTemplates";
import { formatDateTime } from "../../lib/format";
import type { Job, Message, MessageStatus } from "../../lib/types";

function statusTone(s: MessageStatus): string {
  if (s === "failed" || s === "bounced") return "alert";
  if (s === "delivered" || s === "opened") return "done";
  if (s === "sent") return "mid";
  return "start";
}

interface Recipient {
  label: string;
  email: string;
}

/** The activity/comms body for one shipment — compose + full message thread.
 *  Hosted by CommsRail (docked panel) on the Shipments board. */
export default function CommsPanel({ job }: { job: Job }) {
  const { toast, error } = useToast();
  const msgsQ = useMessages(job.id);
  const send = useSendMessage();
  const addNote = useAddNote();

  const [tab, setTab] = useState<"email" | "note">("email");
  const [remarks, setRemarks] = useState("");
  const [note, setNote] = useState("");
  const [ccText, setCcText] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const recipients: Recipient[] = [];
  if (job.client?.email)
    recipients.push({ label: "Customer", email: job.client.email });
  if (job.supplier?.email)
    recipients.push({ label: "Shipper", email: job.supplier.email });

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(job.client?.email ? [job.client.email] : []),
  );
  function toggle(email: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const preview = useMemo(
    () => buildShipmentEmail(job, undefined, remarks).text,
    [job, remarks],
  );

  const messages = msgsQ.data ?? [];

  async function onSend() {
    const to = recipients.map((r) => r.email).filter((e) => checked.has(e));
    if (to.length === 0) {
      error("Pick at least one recipient");
      return;
    }
    const cc = ccText
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await send.mutateAsync({ job, remarks, to, cc });
      toast("Message sent");
      setRemarks("");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    }
  }

  async function onAddNote() {
    if (!note.trim()) return;
    try {
      await addNote.mutateAsync({ jobId: job.id, body: note.trim() });
      setNote("");
      toast("Note added");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add note");
    }
  }

  async function onResend(m: Message) {
    try {
      await send.mutateAsync({
        job,
        remarks: m.remarks ?? "",
        to: m.to_emails,
        cc: m.cc_emails,
      });
      toast("Resent");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not resend");
    }
  }

  return (
    <>
      <div className="comms-actions">
        <button
          className={`chip${tab === "email" ? " on" : ""}`}
          onClick={() => setTab("email")}
        >
          ✉ Customer Message
        </button>
        <button
          className={`chip${tab === "note" ? " on" : ""}`}
          onClick={() => setTab("note")}
        >
          + Private Note
        </button>
      </div>

      {tab === "email" ? (
        <div className="comms-compose">
          <div className="comms-recipients">
            {recipients.length === 0 && (
              <span className="hint">
                No email on the customer or shipper record.
              </span>
            )}
            {recipients.map((r) => (
              <label key={r.email} className="check">
                <input
                  type="checkbox"
                  checked={checked.has(r.email)}
                  onChange={() => toggle(r.email)}
                />
                {r.label} — {r.email}
              </label>
            ))}
          </div>
          <div className="field">
            <label>CC</label>
            <input
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              placeholder="extra@address.com, …"
            />
          </div>
          <div className="field">
            <label>Remarks (your message)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Good day, …"
              rows={4}
            />
          </div>
          {showPreview && <pre className="msg-preview">{preview}</pre>}
          <div className="comms-send-row">
            <button
              className="link-btn"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? "Hide" : "Preview"} email
            </button>
            <button className="btn" onClick={onSend} disabled={send.isPending}>
              {send.isPending ? "Sending…" : "Send Message"}
            </button>
          </div>
        </div>
      ) : (
        <div className="comms-compose">
          <div className="field">
            <label>Private note (internal only)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Not emailed to anyone."
            />
          </div>
          <button
            className="btn"
            onClick={onAddNote}
            disabled={addNote.isPending}
          >
            {addNote.isPending ? "Saving…" : "Add Note"}
          </button>
        </div>
      )}

      <div className="msg-thread">
        {msgsQ.isLoading ? (
          <Loading />
        ) : messages.length === 0 ? (
          <p className="hint">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`msg${m.kind === "note" ? " note" : ""}${
                m.direction === "in" ? " in" : ""
              }`}
            >
              <div className="msg-top">
                <span className="msg-kind">
                  {m.kind === "note"
                    ? "Private note"
                    : m.direction === "in"
                      ? "Reply"
                      : "Email"}
                </span>
                {m.kind === "email" && (
                  <span className={`ms-tag tone-${statusTone(m.status)}`}>
                    {m.status}
                  </span>
                )}
                <span className="msg-when">{formatDateTime(m.created_at)}</span>
              </div>
              {m.subject && <div className="msg-subject">{m.subject}</div>}
              {m.kind === "email" && (
                <div className="hint">
                  To: {m.to_emails.join(", ") || "—"}
                  {m.cc_emails.length > 0 && ` · CC: ${m.cc_emails.join(", ")}`}
                </div>
              )}
              {m.error && <div className="msg-err">{m.error}</div>}
              <pre className="msg-body">{m.body}</pre>
              <div className="msg-foot">
                <button
                  className="link-btn"
                  onClick={() => navigator.clipboard?.writeText(m.body)}
                >
                  Copy
                </button>
                {m.kind === "email" &&
                  m.direction === "out" &&
                  m.status === "failed" && (
                    <button className="link-btn" onClick={() => onResend(m)}>
                      Resend
                    </button>
                  )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
