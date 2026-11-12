import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import DateInput from "./DateInput";
import ExpacCcPicks from "./ExpacCcPicks";
import MergeCodeMenu from "./MergeCodeMenu";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "./Toast";
import {
  useAgents,
  useClearingAgents,
  useCompanySettings,
  useDestinationAgents,
  useTransporters,
  useUploadMailAsset,
} from "../lib/hooks";
import { sendMail, SUPPORT_BCC } from "../lib/mail";
import { htmlToText, resolveMergeFields, type MergeContext } from "../lib/mailMerge";
import { linkifyHtml } from "../lib/mailStyle";
import { formatDate, portCode } from "../lib/format";
import { buildPrintSheetPdf } from "../lib/shipmentAttachments";
import type { QuoteAttachment } from "../lib/quotePdf";
import {
  RFQ_KINDS,
  RFQ_TITLE,
  defaultReplyBy,
  rfqChargeGroups,
  rfqKindLabel,
  rfqPrintPath,
  rfqReplyUrl,
} from "../lib/rfq";
import { createRfq, dropUnsent, useRfqMutation, type RfqCharge } from "../lib/rfqDb";
import { createQuoteMessage } from "../lib/db";
import type { Contact, PartnerKind, Quote } from "../lib/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Placeholder href on the default message's button, swapped for each
 *  agent's own reply link when it is sent. */
const LINK_SENTINEL = "https://rfq-reply-link.invalid/";

interface Recipient {
  partnerId: string | null;
  email: string;
  company: string;
  contact: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}


function downloadPdf(a: QuoteAttachment) {
  const bin = atob(a.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = a.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Req for Quote: send the quotation's shipment details (no customer or
 * consignee) to one or more agents for case-by-case rates. Each agent gets
 * their own email, PDF and no-login reply link; the request is recorded on
 * the quote (Agent rates tab) with a status per agent.
 */
export default function RfqModal({
  quote,
  onClose,
  onSent,
}: {
  quote: Quote;
  onClose: () => void;
  /** After at least one agent was sent the request. */
  onSent?: () => void;
}) {
  const { toast, error: toastError } = useToast();
  const { data: settings } = useCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const lists: Record<PartnerKind, Contact[] | undefined> = {
    agent: useAgents().data,
    destination_agent: useDestinationAgents().data,
    transporter: useTransporters().data,
    clearing_agent: useClearingAgents().data,
  };
  const linked: Record<PartnerKind, string | null | undefined> = {
    agent: quote.agent_id,
    destination_agent: quote.destination_agent_id,
    transporter: quote.transporter_id,
    clearing_agent: quote.clearing_agent_id,
  };

  const [kind, setKind] = useState<PartnerKind>("agent");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [replyBy, setReplyBy] = useState(defaultReplyBy());
  const [notes, setNotes] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    `${RFQ_TITLE} RFQ-${quote.reference}: ${quote.mode}, ${portCode(quote.origin)} to ${portCode(quote.destination)}`,
  );
  const [body, setBody] = useState("");
  const [bodyTouched, setBodyTouched] = useState(false);
  const [phase, setPhase] = useState<"idle" | "download" | "sending">("idle");
  const [progress, setProgress] = useState("");
  const busy = phase !== "idle";
  const subjectRef = useRef<HTMLInputElement>(null);
  const create = useRfqMutation(createRfq, quote.id);

  const partners = useMemo(
    () => (lists[kind] ?? []).filter((p) => p.email?.trim()).sort((a, b) => a.company.localeCompare(b.company)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, lists.agent, lists.destination_agent, lists.transporter, lists.clearing_agent],
  );

  // Start with the partner already on the quote, once the list loads.
  const seededKind = useRef<PartnerKind | null>(null);
  useEffect(() => {
    if (seededKind.current === kind || !lists[kind]) return;
    seededKind.current = kind;
    const p = partners.find((x) => x.id === linked[kind]);
    setRecipients(p ? [toRecipient(p)] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, partners]);

  function toRecipient(p: Contact): Recipient {
    return { partnerId: p.id, email: (p.email ?? "").trim(), company: p.company, contact: (p.contact ?? "").trim() };
  }
  function addPartner(id: string) {
    const p = partners.find((x) => x.id === id);
    if (!p || recipients.some((r) => r.email.toLowerCase() === (p.email ?? "").trim().toLowerCase())) return;
    setRecipients((rs) => [...rs, toRecipient(p)]);
  }
  function addNew() {
    const email = newEmail.trim();
    if (!EMAIL_RE.test(email)) return toastError(`Not a valid email address: ${email || "(blank)"}`);
    if (recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) return toastError("Already on the list");
    setRecipients((rs) => [...rs, { partnerId: null, email, company: newCompany.trim(), contact: "" }]);
    setNewEmail("");
    setNewCompany("");
  }

  const groups = rfqChargeGroups(quote, kind);
  const charges: RfqCharge[] = groups.flatMap((g) => g.rows.map((r) => ({ ...r, category: g.category })));
  const previewPath = rfqPrintPath(quote.id, { kind, replyBy, notes, agent: recipients[0]?.company });

  // Default message: follows the reply-by date until the operator edits it.
  // {{ contact.name }} becomes each agent's contact (or company) on send.
  const sig = settings?.mail_signature_html?.trim() || "";
  useEffect(() => {
    if (bodyTouched || !settings) return;
    const lane = `${escapeHtml(quote.mode)} from ${escapeHtml(quote.origin || "TBA")} to ${escapeHtml(quote.destination || "TBA")}`;
    const term = quote.incoterms ? ` (${escapeHtml(quote.incoterms)})` : "";
    const ref = escapeHtml(quote.reference);
    const html =
      `Dear {{ contact.name }},<br><br>` +
      `Please find attached our request for quote RFQ-${ref} for a ${lane}${term} shipment. ` +
      `The cargo details and the charges we need are on the attached document.<br><br>` +
      `Kindly send us your best rates, rate validity and transit time by <b>${formatDate(replyBy)}</b>. ` +
      `The quickest way is the button below, no login needed; a reply to this email quoting RFQ-${ref} also works.<br><br>` +
      `<a href="${LINK_SENTINEL}" style="display:inline-block;background:#719d2f;color:#fff;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:6px">Submit your rates</a>` +
      `<br><br>Thank you.` +
      (sig ? `<br><br>${sig}` : "");
    setBody(html);
  }, [bodyTouched, settings, sig, replyBy, quote.mode, quote.origin, quote.destination, quote.incoterms, quote.reference]);

  function changeKind(k: PartnerKind) {
    setKind(k);
  }

  async function onDownload() {
    setPhase("download");
    try {
      downloadPdf(await buildPrintSheetPdf(previewPath, RFQ_TITLE, quote.reference));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setPhase("idle");
    }
  }

  async function onSend() {
    if (recipients.length === 0) return toastError("Add at least one agent");
    if (!subject.trim()) return toastError("Subject is required");
    if (charges.length === 0) return toastError(`No ${rfqKindLabel(kind)} charges apply to this quote`);
    const ccList = cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const badCc = ccList.find((e) => !EMAIL_RE.test(e));
    if (badCc) return toastError(`Not a valid CC address: ${badCc}`);
    setPhase("sending");
    let rfqId = "";
    const failed: { id: string; email: string; why: string }[] = [];
    const sent: string[] = [];
    try {
      setProgress("Saving the request…");
      const made = await create.mutateAsync({ quoteId: quote.id, kind, replyBy, notes, charges, recipients });
      rfqId = made.rfqId;
      for (const [i, r] of made.recipients.entries()) {
        const who = r.company || r.email;
        try {
          setProgress(`Preparing PDF for ${who} (${i + 1} of ${made.recipients.length})…`);
          const pdf = await buildPrintSheetPdf(
            rfqPrintPath(quote.id, { kind, replyBy, notes, agent: r.company ?? "", token: r.token }),
            RFQ_TITLE,
            quote.reference,
          );
          setProgress(`Sending to ${who}…`);
          const ctx: MergeContext = {
            name: r.contact?.split(/\s+/)[0] || r.company || "Partner",
            company: r.company ?? "",
            quoteReference: quote.reference,
            shipmentNumber: quote.reference,
            origin: quote.origin ?? "",
            destination: quote.destination ?? "",
            mode: quote.mode,
          };
          const link = rfqReplyUrl(r.token);
          let filled = resolveMergeFields(body, ctx);
          filled = filled.includes(LINK_SENTINEL)
            ? filled.split(LINK_SENTINEL).join(link)
            : `${filled}<br><br>Submit your rates online: <a href="${link}">${link}</a>`;
          const html = linkifyHtml(filled);
          await sendMail({
            to: [r.email],
            cc: ccList.length ? ccList : undefined,
            bcc: SUPPORT_BCC,
            subject: resolveMergeFields(subject.trim(), ctx),
            html,
            text: htmlToText(html),
            attachments: [pdf],
            fromName: settings?.mail_sender_name || undefined,
            replyTo: settings?.mail_reply_to || undefined,
          });
          sent.push(who);
        } catch (e) {
          failed.push({ id: r.id, email: r.email, why: e instanceof Error ? e.message : "failed" });
        }
      }
      if (failed.length) await dropUnsent(rfqId, failed.map((f) => f.id), sent.length === 0).catch(() => undefined);
      if (sent.length) {
        await createQuoteMessage({
          quote_id: quote.id,
          kind: "note",
          direction: "out",
          body: `${RFQ_TITLE} RFQ-${quote.reference} sent to ${sent.join(", ")} (${rfqKindLabel(kind)}), reply by ${formatDate(replyBy)}.`,
          status: "sent",
        }).catch(() => undefined);
      }
      if (failed.length) {
        toastError(`Not sent to ${failed.map((f) => `${f.email} (${f.why})`).join(", ")}`);
        if (sent.length) {
          toast(`RFQ sent to ${sent.join(", ")}`);
          onSent?.();
        }
        // Keep the modal open on the ones that failed so they can be retried.
        setRecipients((rs) => rs.filter((r) => failed.some((f) => f.email === r.email)));
        return;
      }
      toast(`RFQ sent to ${sent.join(", ")}`);
      onSent?.();
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not send");
      if (rfqId && sent.length === 0) await dropUnsent(rfqId, [], true).catch(() => undefined);
    } finally {
      setPhase("idle");
      setProgress("");
    }
  }

  return (
    <Modal title={`Req for Quote RFQ-${quote.reference}`} onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Sends the shipment details and packing list only, no customer, consignee or shipper. Each agent gets their own
        email and reply link, and can't see who else was asked.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Send to</label>
          <select value={kind} onChange={(e) => changeKind(e.target.value as PartnerKind)} disabled={busy}>
            {RFQ_KINDS.map((k) => (
              <option key={k} value={k}>
                {rfqKindLabel(k)}s
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Reply by</label>
          <DateInput value={replyBy} onChange={(v) => setReplyBy(v || defaultReplyBy())} disabled={busy} />
        </div>
      </div>
      <div className="field">
        <label>{rfqKindLabel(kind)}s to ask ({recipients.length})</label>
        <div className="rfq-recips">
          {recipients.map((r) => (
            <span key={r.email} className="rfq-recip">
              <b>{r.company || r.email}</b>
              {r.company && <span className="muted"> {r.email}</span>}
              <button
                type="button"
                className="link-btn"
                aria-label={`Remove ${r.email}`}
                onClick={() => setRecipients((rs) => rs.filter((x) => x.email !== r.email))}
                disabled={busy}
              >
                ×
              </button>
            </span>
          ))}
          {recipients.length === 0 && <span className="hint">Add one or more below.</span>}
        </div>
        <div className="rfq-add">
          <select value="" onChange={(e) => addPartner(e.target.value)} disabled={busy}>
            <option value="">Add a saved {rfqKindLabel(kind).toLowerCase()}…</option>
            {partners
              .filter((p) => !recipients.some((r) => r.partnerId === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.company} ({p.email})
                </option>
              ))}
          </select>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="or type a new email"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNew();
              }
            }}
          />
          <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company (optional)" disabled={busy} />
          <button type="button" className="btn outline" onClick={addNew} disabled={busy || !newEmail.trim()}>
            Add
          </button>
        </div>
      </div>
      <div className="field">
        <label>CC</label>
        <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" disabled={busy} />
        <ExpacCcPicks value={cc} onChange={setCc} />
      </div>
      <div className="field">
        <label>Notes to agent (printed on the RFQ)</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Please quote via direct sailing, cargo is stackable"
          disabled={busy}
        />
      </div>
      <div className="field">
        <div className="merge-code-row">
          <label>Subject</label>
          <MergeCodeMenu targetRef={subjectRef} onChange={setSubject} />
        </div>
        <input ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
      </div>
      <div className="field">
        <div className="merge-code-row">
          <label>Message</label>
          <span className="hint">
            Attaches “{RFQ_TITLE} - {quote.reference}.pdf” · {charges.length} charge{charges.length === 1 ? "" : "s"} requested
          </span>
        </div>
        <RichTextEditor
          value={body}
          onChange={(v) => {
            setBody(v);
            setBodyTouched(true);
          }}
          onUploadImage={(f) => uploadAsset.mutateAsync(f)}
        />
        <span className="hint">The Submit your rates button opens each agent's own reply form.</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {progress && <span className="hint">{progress}</span>}
        <button type="button" className="btn outline" onClick={() => window.open(previewPath, "_blank", "noopener")} disabled={busy}>
          Preview
        </button>
        <button type="button" className="btn outline" onClick={onDownload} disabled={busy}>
          {phase === "download" ? "Building PDF…" : "Download PDF"}
        </button>
        <button type="button" className="btn outline" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onSend} disabled={busy || recipients.length === 0}>
          {phase === "sending"
            ? "Sending…"
            : `Send to ${recipients.length || ""} ${recipients.length === 1 ? rfqKindLabel(kind).toLowerCase() : `${rfqKindLabel(kind).toLowerCase()}s`}`.replace("  ", " ")}
        </button>
      </div>
    </Modal>
  );
}
