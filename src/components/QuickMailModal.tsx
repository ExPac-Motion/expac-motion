import { useState } from "react";
import Modal from "./Modal";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "./Toast";
import {
  useCompanySettings,
  useMailTemplates,
  useUploadMailAsset,
} from "../lib/hooks";
import { sendMail } from "../lib/mail";
import { htmlToText, resolveMergeFields } from "../lib/mailMerge";

/**
 * Compose-and-send a one-off email to a customer / contact, straight from a
 * list row. Templates, merge fields and the saved signature are applied the
 * same way the CRM Quick-Mail does.
 */
export default function QuickMailModal({
  to,
  company,
  name,
  onClose,
}: {
  to: string | null | undefined;
  company: string;
  name?: string | null;
  onClose: () => void;
}) {
  const { data: templates } = useMailTemplates();
  const { data: settings } = useCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const { toast, error: toastError } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const mergeCtx = {
    name: name || company,
    company,
    unsubscribeUrl: `${window.location.origin}/unsubscribe`,
  };

  function applyTemplate(id: string) {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  }

  async function onSend() {
    if (!to) return toastError("This customer has no email address");
    if (!subject.trim()) return toastError("Subject is required");
    setSending(true);
    try {
      let html = resolveMergeFields(body, mergeCtx);
      const sig = settings?.mail_signature_html?.trim();
      if (sig) html += `<br><br>${sig}`;
      await sendMail({
        to: [to],
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
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label>Message</label>
        <RichTextEditor
          value={body}
          onChange={setBody}
          onUploadImage={(f) => uploadAsset.mutateAsync(f)}
        />
        <span className="hint">
          Your saved signature is added automatically. Sends from{" "}
          {settings?.mail_sender_name || "the configured sender"}.
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
