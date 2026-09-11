import { useMemo, useRef, useState } from "react";
import { Loading } from "../../components/common";
import MergeCodeMenu from "../../components/MergeCodeMenu";
import { useToast } from "../../components/Toast";
import {
  useAddNote,
  useClientContacts,
  useCompanySettings,
  useMessages,
  useSendMessage,
} from "../../lib/hooks";
import { buildShipmentEmail, buildShipmentReply } from "../../lib/mailTemplates";
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
  const { data: settings } = useCompanySettings();

  const [tab, setTab] = useState<"email" | "note">("email");
  // 'reply' (default) = quick chat-style message, no shipment-data block —
  // the common case once a thread is already going. 'update' is the full
  // per-mode status-update template (Settings -> Shipment Comms).
  const [template, setTemplate] = useState<"update" | "reply">("reply");
  const [remarks, setRemarks] = useState("");
  const remarksRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [ccText, setCcText] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const contactsQ = useClientContacts(job.client_id ?? undefined);

  // Customer (primary + every extra contact with an email) then the shipper,
  // de-duplicated by address.
  const recipients = useMemo<Recipient[]>(() => {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const add = (label: string, email: string | null | undefined) => {
      const e = (email ?? "").trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ label, email: e });
    };
    add("Customer", job.client?.email);
    for (const c of contactsQ.data ?? []) {
      add(
        `Customer · ${c.name}${c.role ? ` (${c.role})` : ""}`,
        c.email,
      );
    }
    add("Shipper", job.supplier?.email);
    return out;
  }, [job.client?.email, job.supplier?.email, contactsQ.data]);

  const customerEmails = useMemo(
    () => recipients.filter((r) => r.label.startsWith("Customer")).map((r) => r.email),
    [recipients],
  );

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
    () =>
      template === "reply"
        ? buildShipmentReply(job, remarks, settings?.shipment_replies).text
        : buildShipmentEmail(job, undefined, remarks, settings?.shipment_comms)
            .text,
    [job, remarks, settings, template],
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
      await send.mutateAsync({ job, remarks, to, cc, template });
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
            {customerEmails.length > 1 && (
              <div className="hint" style={{ margin: "0 0 4px" }}>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      customerEmails.forEach((e) => next.add(e));
                      return next;
                    })
                  }
                >
                  CC all customer contacts
                </button>{" "}
                ·{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      customerEmails.forEach((e) => next.delete(e));
                      return next;
                    })
                  }
                >
                  clear
                </button>
              </div>
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
          <div className="comms-actions" style={{ marginBottom: 6 }}>
            <button
              type="button"
              className={`chip${template === "reply" ? " on" : ""}`}
              onClick={() => setTemplate("reply")}
              title="A quick chat-style message — no shipment-data block"
            >
              Reply
            </button>
            <button
              type="button"
              className={`chip${template === "update" ? " on" : ""}`}
              onClick={() => setTemplate("update")}
              title="The full status-update template (Settings → Shipment Comms)"
            >
              Full Update
            </button>
          </div>
          <div className="field">
            <div className="merge-code-row">
              <label>Remarks (your message)</label>
              <MergeCodeMenu targetRef={remarksRef} onChange={setRemarks} />
            </div>
            <textarea
              ref={remarksRef}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Good day, …"
              rows={4}
              spellCheck
              lang="en"
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
              {send.isPending
                ? "Sending…"
                : template === "reply"
                  ? "Send Reply"
                  : "Send Update"}
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
              spellCheck
              lang="en"
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
