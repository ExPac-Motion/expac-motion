// Admin-only panel on an Agent / Transporter / Clearing Agent record: invite
// a partner-portal login (migration 0121), see who has one, and switch
// access off / on. A partner login only ever sees this partner's own rate
// sheets — never tier sheets, sell rates, margins, customers or quotes.
import { useState } from "react";
import { useToast } from "../../components/Toast";
import {
  useCompanySettings,
  useCreatePartnerInvite,
  useDeletePartnerInvite,
  usePartnerInvites,
  usePartnerUsers,
  useSetPartnerAccess,
} from "../../lib/hooks";
import { sendMail, SUPPORT_BCC } from "../../lib/mail";
import { formatDateTime } from "../../lib/format";
import type { PartnerKind, PartnerInvite } from "../../lib/types";
import { PARTNER_LABEL } from "../../lib/tariff";

const inviteUrl = (i: PartnerInvite) => `${window.location.origin}/partner/signup?token=${i.token}`;

export default function PartnerLoginAccess({
  kind,
  partnerId,
  company,
  email,
}: {
  kind: PartnerKind;
  partnerId: string;
  company: string;
  email: string | null;
}) {
  const usersQ = usePartnerUsers(kind, partnerId);
  const invitesQ = usePartnerInvites(kind, partnerId);
  const create = useCreatePartnerInvite();
  const remove = useDeletePartnerInvite();
  const setAccess = useSetPartnerAccess();
  const { data: settings } = useCompanySettings();
  const { toast, error } = useToast();
  const [to, setTo] = useState(email ?? "");
  const [sending, setSending] = useState<string | null>(null);

  const open = (invitesQ.data ?? []).filter((i) => !i.claimed_at);

  async function onCreate() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) {
      error("Enter the partner's email address");
      return;
    }
    try {
      const inv = await create.mutateAsync({ kind, partnerId, email: to });
      await navigator.clipboard?.writeText(inviteUrl(inv)).catch(() => undefined);
      toast("Invite link created and copied");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not create the invite");
    }
  }

  async function onEmail(i: PartnerInvite) {
    setSending(i.token);
    const url = inviteUrl(i);
    try {
      await sendMail({
        to: [i.email],
        bcc: SUPPORT_BCC,
        subject: `ExPac partner portal: keep your rates up to date`,
        text: `Good day,\n\nExPac has set up a partner portal login for ${company}. Use the link below to create your login, then add or update your rate sheets — we'll use them when quoting.\n\n${url}\n\nPlease sign up with this email address (${i.email}).\n\nKind regards`,
        html: `<p>Good day,</p><p>ExPac has set up a partner portal login for <strong>${company}</strong>. Use the link below to create your login, then add or update your rate sheets — we'll use them when quoting.</p><p><a href="${url}">Create your partner login</a></p><p>Please sign up with this email address (${i.email}).</p><p>Kind regards</p>`,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
      });
      toast(`Invite emailed to ${i.email}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send the invite");
    } finally {
      setSending(null);
    }
  }

  if (usersQ.isError || invitesQ.isError) {
    return (
      <section className="rs-wrap">
        <h3>Partner Login</h3>
        <p className="hint">Partner logins need migration 0121 in Supabase.</p>
      </section>
    );
  }

  return (
    <section className="rs-wrap">
      <div className="rs-head">
        <h3>Partner Login</h3>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        A partner login sees and edits only {company}'s own rate sheets — never your tier sheets,
        sell rates, margins, customers or quotes. Every change shows in each sheet's History.
      </p>

      {(usersQ.data ?? []).map((u) => (
        <div key={u.id} className="rs-meta" style={{ marginBottom: 6 }}>
          <strong>{u.email || u.full_name}</strong>
          <span>{u.role === "partner" ? "Active" : "Access off"}</span>
          <span>
            Last sign-in {u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "never"}
          </span>
          <button
            type="button"
            className="btn small outline"
            disabled={setAccess.isPending}
            onClick={async () => {
              const enable = u.role !== "partner";
              if (!enable && !window.confirm(`Switch off ${u.email}'s partner login?`)) return;
              try {
                await setAccess.mutateAsync({ profileId: u.id, enabled: enable });
                toast(enable ? "Access restored" : "Access switched off");
              } catch (e) {
                error(e instanceof Error ? e.message : "Could not change access");
              }
            }}
          >
            {u.role === "partner" ? "Switch off" : "Restore"}
          </button>
        </div>
      ))}

      {open.map((i) => (
        <div key={i.token} className="rs-meta" style={{ marginBottom: 6 }}>
          <span>Invite sent to</span>
          <strong>{i.email}</strong>
          <span>{formatDateTime(i.created_at)}</span>
          <button
            type="button"
            className="btn small outline"
            onClick={() =>
              navigator.clipboard
                ?.writeText(inviteUrl(i))
                .then(() => toast("Invite link copied"))
                .catch(() => error("Could not copy"))
            }
          >
            Copy link
          </button>
          <button
            type="button"
            className="btn small outline"
            disabled={sending === i.token}
            onClick={() => onEmail(i)}
          >
            {sending === i.token ? "Sending…" : "Email invite"}
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => remove.mutate(i.token)}
            title="Cancel this invite"
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={`${PARTNER_LABEL[kind]}'s email`}
          style={{ maxWidth: 280 }}
        />
        <button
          type="button"
          className="btn outline"
          onClick={onCreate}
          disabled={create.isPending}
        >
          {create.isPending ? "Creating…" : "Create invite link"}
        </button>
      </div>
      <span className="hint">
        The link works once, and only for this email address.
      </span>
    </section>
  );
}
