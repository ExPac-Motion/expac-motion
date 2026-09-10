import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import MergeCodeMenu from "./MergeCodeMenu";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "./Toast";
import {
  useCompanySettings,
  useMailTemplates,
  useUploadMailAsset,
} from "../lib/hooks";
import { sendMail } from "../lib/mail";
import {
  htmlToText,
  resolveMergeFields,
  type MergeContext,
} from "../lib/mailMerge";

/**
 * Compose-and-send a one-off email to a customer / contact, straight from a
 * list row. Templates, merge fields and the saved signature are applied the
 * same way the CRM Quick-Mail does.
 */
export default function QuickMailModal({
  to,
  company,
  name,
  merge,
  onClose,
}: {
  to: string | null | undefined;
  company: string;
  name?: string | null;
  /** Extra merge-code values for this record (shipment no, lane, etc.). */
  merge?: MergeContext;
  onClose: () => void;
}) {
  const { data: templates } = useMailTemplates();
  const { data: settings } = useCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const { toast, error: toastError } = useToast();
  const [subject, setSubject] = useState("");
  const [cc, setCc] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  const sig = settings?.mail_signature_html?.trim() || "";
  const withSig = (html: string) => (sig ? `${html}<br><br>${sig}` : html);

  // Seed the editor with the saved signature once settings resolve, so it is
  // visible in the message body and the operator can edit or delete it before
  // sending. Only seeds an untouched (empty) body.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !settings) return;
    seeded.current = true;
    setBody((b) => (b.trim() ? b : sig ? `<br><br>${sig}` : b));
  }, [settings, sig]);

  const mergeCtx: MergeContext = {
    name: name || company,
    company,
    customerName: company,
    unsubscribeUrl: `${window.location.origin}/unsubscribe`,
    ...merge,
  };

  function applyTemplate(id: string) {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(withSig(t.body));
  }

  async function onSend() {
    if (!to) return toastError("This customer has no email address");
    if (!subject.trim()) return toastError("Subject is required");
    const ccList = cc
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const badCc = ccList.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (badCc) return toastError(`Not a valid CC address: ${badCc}`);
    setSending(true);
    try {
      // The signature already lives in the body (seeded on open), so it is not
      // appended again here.
      const html = resolveMergeFields(body, mergeCtx);
      await sendMail({
        to: [to],
        cc: ccList.length ? ccList : undefined,
        subject: resolveMergeFields(subject.trim(), mergeCtx),
        html,
        text: htmlToText(html),
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
      });
      toast("Email sent");
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={`Email ${company}`} onClose={onClose} wide>
      <div className="field">
        <label>To</label>
        <strong>{to || "— no email on this customer —"}</strong>
      </div>
      <div className="field">
        <label>CC</label>
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder="cc@example.com, another@example.com"
        />
        <span className="hint">Separate multiple addresses with a comma.</span>
      </div>
      <div className="field">
        <label>Start from a template (optional)</label>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) applyTemplate(e.target.value);
          }}
        >
          <option value="">— blank —</option>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="merge-code-row">
          <label>Subject</label>
          <MergeCodeMenu targetRef={subjectRef} onChange={setSubject} />
        </div>
        <input
          ref={subjectRef}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Message</label>
        <RichTextEditor
          value={body}
          onChange={setBody}
          onUploadImage={(f) => uploadAsset.mutateAsync(f)}
        />
        <span className="hint">
          {sig
            ? "Your saved signature is included below — edit or remove it as needed. "
            : ""}
          Sends from {settings?.mail_sender_name || "the configured sender"}.
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}
      >
        <button
          type="button"
          className="btn outline"
          onClick={onClose}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSend}
          disabled={sending || !to}
        >
          {sending ? "Sending…" : "Send Email"}
        </button>
      </div>
    </Modal>
  );
}
