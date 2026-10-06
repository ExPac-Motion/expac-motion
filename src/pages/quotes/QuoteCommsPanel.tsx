import { useEffect, useMemo, useRef, useState } from "react";
import { Loading } from "../../components/common";
import MergeCodeMenu from "../../components/MergeCodeMenu";
import { useToast } from "../../components/Toast";
import {
  useAddQuoteNote,
  useClientContacts,
  useCompanySettings,
  useQuoteMessages,
  useSendQuoteMessage,
  useJobs,
} from "../../lib/hooks";
import AttachDocumentPicker from "../../components/AttachDocumentPicker";
import type { ShipmentAttachmentPick } from "../../lib/shipmentAttachments";
import { buildQuoteCommsEmail, buildQuoteCommsReply } from "../../lib/mailTemplates";
import { formatDateTime } from "../../lib/format";
import type { Quote, QuoteMessage, MessageStatus } from "../../lib/types";

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

/** The activity/comms body for one quotation, compose + full message
 *  thread. Same method as Shipment Comms (CommsPanel), just against a
 *  Quote instead of a Job, hosted by QuoteCommsRail (docked panel) on
 *  the Quotations list. */
export default function QuoteCommsPanel({ quote }: { quote: Quote }) {
  const { toast, error } = useToast();
  const msgsQ = useQuoteMessages(quote.id);
  const send = useSendQuoteMessage();
  const addNote = useAddQuoteNote();
  const { data: settings } = useCompanySettings();

  const [tab, setTab] = useState<"email" | "note">("email");
  // 'update' (default) = the full status-update template (Settings ->
  // Quotation Comms), the common case on first contact. 'reply' is the
  // quick chat-style message, no quotation-data block. Auto-switches to
  // 'reply' once the thread already has a message, below, but stays
  // whatever the operator picks after that.
  const [template, setTemplate] = useState<"update" | "reply">("update");
  const [templateAutoSet, setTemplateAutoSet] = useState(false);
  const [remarks, setRemarks] = useState("");
  const remarksRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [ccText, setCcText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [attachQuote, setAttachQuote] = useState(false);
  // Attach document: files from the computer (e.g. a shipper's invoice) and,
  // once the quote is a shipment, that shipment's documents.
  const [picks, setPicks] = useState<ShipmentAttachmentPick[]>([]);
  const jobsQ = useJobs();
  const attachJob = useMemo(() => {
    const j = (jobsQ.data ?? []).find((x) => x.quote_id === quote.id);
    return j ? { id: j.id, reference: j.reference } : null;
  }, [jobsQ.data, quote.id]);

  const contactsQ = useClientContacts(quote.client_id ?? undefined);

  // Customer (primary + every extra contact with an email) then the
  // shipper, de-duplicated by address.
  const recipients = useMemo<Recipient[]>(() => {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const add = (label: string, email: string | null | undefined) => {
      const e = (email ?? "").trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ label, email: e });
    };
    add("Customer", quote.client?.email ?? quote.lead?.email);
    for (const c of contactsQ.data ?? []) {
      add(
        `Customer · ${c.name}${c.role ? ` (${c.role})` : ""}`,
        c.email,
      );
    }
    add("Shipper", quote.supplier?.email);
    return out;
  }, [quote.client?.email, quote.lead?.email, quote.supplier?.email, contactsQ.data]);

  const customerEmails = useMemo(
    () => recipients.filter((r) => r.label.startsWith("Customer")).map((r) => r.email),
    [recipients],
  );

  const [checked, setChecked] = useState<Set<string>>(() => {
    const primary = quote.client?.email ?? quote.lead?.email;
    return new Set(primary ? [primary] : []);
  });
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
        ? buildQuoteCommsReply(quote, remarks, settings?.quotation_replies).text
        : buildQuoteCommsEmail(quote, remarks, settings?.quotation_comms).text,
    [quote, remarks, settings, template],
  );

  const messages = msgsQ.data ?? [];

  // Full Update is the default on a fresh thread; once there's already a
  // conversation going, switch to Reply once (not on every refetch, and
  // never overriding a manual pick the operator already made).
  useEffect(() => {
    if (templateAutoSet || msgsQ.isLoading) return;
    setTemplateAutoSet(true);
    if (messages.length > 0) setTemplate("reply");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgsQ.isLoading]);

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
      await send.mutateAsync({
        quote,
        remarks,
        to,
        cc,
        template,
        attachQuote,
        attachments: picks,
      });
      const n = picks.length + (attachQuote ? 1 : 0);
      toast(n ? `Message sent with ${n} attachment${n === 1 ? "" : "s"}` : "Message sent");
      setRemarks("");
      setAttachQuote(false);
      setPicks([]);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    }
  }

  async function onAddNote() {
    if (!note.trim()) return;
    try {
      await addNote.mutateAsync({ quoteId: quote.id, body: note.trim() });
      setNote("");
      toast("Note added");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add note");
    }
  }

  async function onResend(m: QuoteMessage) {
    try {
      await send.mutateAsync({
        quote,
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
              <span className="hint">No email on the customer or shipper record.</span>
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
                {r.label}, {r.email}
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
              title="A quick chat-style message, no quotation-data block"
            >
              Reply
            </button>
            <button
              type="button"
              className={`chip${template === "update" ? " on" : ""}`}
              onClick={() => setTemplate("update")}
              title="The full status-update template (Settings → Quotation Comms)"
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
            <label className="attach-quote" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={attachQuote}
                onChange={(e) => setAttachQuote(e.target.checked)}
              />
              Attach "Quotation - {quote.reference}.pdf"
            </label>
          </div>
          <AttachDocumentPicker
            job={attachJob}
            quote={null}
            picks={picks}
            onChange={setPicks}
          />
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
                ? picks.length || attachQuote
                  ? "Attaching & sending…"
                  : "Sending…"
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
              className={`msg${m.kind === "note" ? " note" : ""}${m.direction === "in" ? " in" : ""}`}
            >
              <div className="msg-top">
                <span className="msg-kind">
                  {m.kind === "note" ? "Private note" : m.direction === "in" ? "Reply" : "Email"}
                </span>
                {m.kind === "email" && (
                  <span className={`ms-tag tone-${statusTone(m.status)}`}>{m.status}</span>
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
                {m.kind === "email" && m.direction === "out" && m.status === "failed" && (
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
