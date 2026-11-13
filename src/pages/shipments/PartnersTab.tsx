/**
 * Shipment workspace › Partners (0243, plan step 5): who's on each leg of the
 * shipment (origin agent, destination agent, transporter, clearing agent),
 * whether they have a Partner Portal login, what they've updated, and the
 * message thread with each one. Staff replies show in the partner's portal
 * (and can also go out by email); "Request a document" prefills a reply.
 * Partner messages never reach the customer.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useCompanySettings } from "../../lib/hooks";
import { sendMail, SUPPORT_BCC } from "../../lib/mail";
import { emailButtonHtml, PUBLIC_APP_URL } from "../../lib/mailStyle";
import { formatDateTime } from "../../lib/format";
import { PARTNER_LABEL } from "../../lib/tariff";
import type { Job, PartnerKind } from "../../lib/types";
import {
  markPartnerMessagesRead,
  PARTNER_DOC_TYPES,
  sendStaffPartnerMessage,
  useJobPartnerMessages,
  useJobPartners,
  useStaffPartnerMutation,
  type JobPartner,
  type JobPartnerMessage,
} from "../../lib/partnerShipments";

const PARTNER_PATH: Record<PartnerKind, string> = {
  agent: "/agents",
  transporter: "/transporters",
  clearing_agent: "/clearing-agents",
  destination_agent: "/destination-agents",
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type QuotePartners = {
  agent_id: string | null;
  transporter_id: string | null;
  clearing_agent_id: string | null;
  destination_agent_id?: string | null;
} | null;

/** Unread partner messages on a shipment (for the tab badge). */
export function usePartnerUnread(jobId: string | undefined): number {
  const q = useJobPartnerMessages(jobId);
  return (q.data ?? []).filter((m) => m.direction === "in" && !m.read_at).length;
}

export default function PartnersTab({
  job,
  quote,
  demo,
}: {
  job: Job;
  quote: QuotePartners;
  /** DEV previews only. */
  demo?: { partners: JobPartner[]; messages: JobPartnerMessage[] };
}) {
  const partnersQ = useJobPartners(demo ? null : { jobId: job.id, masterJobId: job.master_job_id, quote });
  const msgsQ = useJobPartnerMessages(demo ? undefined : job.id);
  const partners = demo?.partners ?? partnersQ.data ?? [];
  const messages = useMemo(() => demo?.messages ?? msgsQ.data ?? [], [demo, msgsQ.data]);
  const [pick, setPick] = useState<string | null>(null);
  const current = partners.find((p) => p.id === pick) ?? partners[0] ?? null;

  if (!demo && partnersQ.isLoading) return <Loading />;
  if (!demo && partnersQ.error) return <ErrorNote error={partnersQ.error} />;
  if (partners.length === 0)
    return (
      <div className="panel">
        <EmptyState>
          No partners on this shipment yet. Set the agent, transporter, clearing agent or destination agent on its quotation.
        </EmptyState>
      </div>
    );

  return (
    <div className="spt-grid">
      <div className="spt-list">
        {partners.map((p) => {
          const mine = messages.filter((m) => m.partner_id === p.id);
          const unread = mine.filter((m) => m.direction === "in" && !m.read_at).length;
          const last = lastActivity(job, p, mine);
          return (
            <button
              key={p.kind + p.id}
              type="button"
              className={`spt-card${current?.id === p.id ? " on" : ""}`}
              onClick={() => setPick(p.id)}
            >
              <span className="spt-kind">{PARTNER_LABEL[p.kind]}</span>
              <b>{p.company}</b>
              <span className="hint">{[p.contact, p.email, p.phone].filter(Boolean).join(" · ") || "-"}</span>
              <span className="spt-chips">
                <span className={`spt-chip${p.hasLogin ? " ok" : ""}`}>{p.hasLogin ? "Portal login" : "No portal login"}</span>
                {unread > 0 && <span className="spt-chip new">{unread} new</span>}
              </span>
              <span className="hint">{last ? `Last activity ${formatDateTime(last)}` : "No activity yet"}</span>
            </button>
          );
        })}
      </div>
      {current && <PartnerThread key={current.id} job={job} partner={current} messages={messages} demo={!!demo} />}
    </div>
  );
}

/** Latest message from / to this partner, or a log line they wrote. */
function lastActivity(job: Job, p: JobPartner, mine: JobPartnerMessage[]): string | null {
  const times = mine.map((m) => m.created_at);
  for (const e of job.job_events ?? []) if (e.note?.startsWith(`${p.company}:`) || e.note?.startsWith(`${p.company} `)) times.push(e.created_at);
  return times.sort().at(-1) ?? null;
}

function PartnerThread({
  job,
  partner,
  messages,
  demo,
}: {
  job: Job;
  partner: JobPartner;
  messages: JobPartnerMessage[];
  demo: boolean;
}) {
  const { toast, error } = useToast();
  const { data: settings } = useCompanySettings();
  const thread = messages.filter((m) => m.partner_id === partner.id);
  const updates = (job.job_events ?? [])
    .filter((e) => e.note?.startsWith(`${partner.company}:`) || e.note?.startsWith(`${partner.company} `))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [draft, setDraft] = useState("");
  const [email, setEmail] = useState(!!partner.email);
  const send = useStaffPartnerMutation((body: string) =>
    demo ? Promise.resolve() : sendStaffPartnerMessage({ jobId: job.id, kind: partner.kind, partnerId: partner.id, body }),
  );
  const unreadIds = thread.filter((m) => m.direction === "in" && !m.read_at).length;

  // Opening the thread marks the partner's messages read.
  useEffect(() => {
    if (!demo && unreadIds > 0) void markPartnerMessagesRead(job.id, partner.id);
  }, [demo, unreadIds, job.id, partner.id]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    try {
      await send.mutateAsync(body);
      if (email && partner.email && !demo) {
        const link = `${PUBLIC_APP_URL}/partner`;
        const html =
          `<p>Good day${partner.contact ? ` ${esc(partner.contact)}` : ""},</p>` +
          `<p>ExPac sent you a message about shipment <b>${esc(job.reference)}</b>:</p>` +
          `<p style="white-space:pre-wrap">${esc(body)}</p>` +
          `<p>${partner.hasLogin ? "Reply, update the shipment or upload documents on the ExPac Partner Portal." : "Please reply to this email."}</p>` +
          (partner.hasLogin ? `<p>${emailButtonHtml(link, "Open the Partner Portal")}</p>` : "") +
          (settings?.mail_signature_html?.trim() || "<p>Kind regards,<br>ExPac</p>");
        try {
          await sendMail({
            to: [partner.email],
            bcc: SUPPORT_BCC,
            subject: `${job.reference}: message from ExPac`,
            html,
            text: `ExPac sent you a message about shipment ${job.reference}:\n\n${body}\n\n${partner.hasLogin ? link : ""}`,
            fromName: settings?.mail_sender_name || undefined,
            replyTo: settings?.mail_reply_to || undefined,
          });
        } catch (e) {
          error(`Saved on the portal, but the email failed: ${e instanceof Error ? e.message : "send error"}`);
          setDraft("");
          return;
        }
      }
      setDraft("");
      toast(email && partner.email ? `Sent to ${partner.company} (portal + email)` : `Sent to ${partner.company}'s portal`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    }
  }

  return (
    <div className="spt-main">
      <div className="panel">
        <div className="spt-thread-head">
          <h3>
            {partner.company} <span className="hint">· {PARTNER_LABEL[partner.kind]}</span>
          </h3>
          <Link className="btn outline small" to={`${PARTNER_PATH[partner.kind]}/${partner.id}`}>
            Open partner
          </Link>
        </div>
        {!partner.hasLogin && (
          <p className="spt-note">
            {partner.company} has no Partner Portal login, so they only see your messages by email. Set up their login on the
            partner's record (Portal access).
          </p>
        )}
        <div className="ps-msgs spt-msgs">
          {thread.length === 0 ? (
            <p className="hint">No messages with {partner.company} on this shipment yet.</p>
          ) : (
            thread.map((m) => (
              <div key={m.id} className={`ps-msg ${m.direction === "out" ? "me" : "them"}`}>
                <div>{m.body}</div>
                <span className="hint">
                  {m.direction === "out" ? "ExPac" : partner.company} · {formatDateTime(m.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="spt-compose">
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setDraft(
                `Please upload the ${e.target.value} for ${job.reference}${partner.hasLogin ? " on the ExPac Partner Portal (Shipments)" : " by reply to this email"}.`,
              );
            }}
            aria-label="Request a document"
          >
            <option value="">Request a document…</option>
            {PARTNER_DOC_TYPES[partner.kind]
              .filter((t) => t !== "Other")
              .map((t) => (
                <option key={t}>{t}</option>
              ))}
          </select>
          <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Write to ${partner.company}`} />
          <div className="spt-send">
            <label className="spt-email">
              <input type="checkbox" checked={email} disabled={!partner.email} onChange={(e) => setEmail(e.target.checked)} />
              Also email {partner.email ?? "(no email on file)"}
            </label>
            <button type="button" className="btn" disabled={send.isPending || !draft.trim()} onClick={submit}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="rfq-sec-head">Updated by {partner.company}</div>
        {updates.length === 0 ? (
          <p className="hint">No updates from {partner.company} yet.</p>
        ) : (
          <ul className="spt-updates">
            {updates.map((e) => (
              <li key={e.id}>
                <span>{e.note!.replace(new RegExp(`^${partner.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:?\\s*`), "")}</span>
                <span className="hint">{formatDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
