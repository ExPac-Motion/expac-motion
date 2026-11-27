// Admin-only panel on an Agent / Transporter / Clearing Agent record: invite
// a partner-portal login (migration 0121), see who has one, and switch
// access off / on. A partner login only ever sees this partner's own rate
// sheets, never tier sheets, sell rates, margins, customers or quotes.
import { useState, type FormEvent } from "react";
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
import { supabase } from "../../lib/supabase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listPartnerContacts, savePartnerContact } from "../../lib/db";
import { SALUTATIONS } from "../../lib/customers";
import { formatDateTime } from "../../lib/format";
import type { PartnerKind, PartnerInvite } from "../../lib/types";
import { PARTNER_LABEL } from "../../lib/tariff";

const CONTACT_ROLES = ["Operations", "Sales", "Accounts", "Customs", "Management", "Dispatch / Driver", "After hours"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

const inviteUrl = (i: PartnerInvite) => `${window.location.origin}/partner/signup?token=${i.token}`;

/** Creates (or resets) the partner's login with a generated password via the
 *  /api/partner-login Pages Function (service role, migration 0129). */
async function generatePartnerLogin(input: {
  kind: PartnerKind;
  partnerId: string;
  email: string;
  company: string;
}): Promise<{ email: string; password: string; created: boolean }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch("/api/partner-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  const raw = (await res.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    created?: boolean;
    error?: string;
  };
  if (!res.ok || !raw.password) {
    if (res.status === 404) throw new Error("Partner logins run on the deployed site (no API here in dev).");
    throw new Error(raw.error || `Login service returned ${res.status}`);
  }
  return { email: raw.email ?? input.email, password: raw.password, created: !!raw.created };
}

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
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  // Shown once, right after it's made, never stored in the app.
  const [madeLogin, setMadeLogin] = useState<{ email: string; password: string } | null>(null);

  async function onGenerate(addr: string = to.trim()) {
    if (!EMAIL_RE.test(addr)) {
      error("Enter the partner's email address");
      return;
    }
    const has = (usersQ.data ?? []).some((u) => (u.email ?? "").toLowerCase() === addr.toLowerCase());
    if (
      !window.confirm(
        has
          ? `Set a new password for ${addr}? Their current password stops working.`
          : `Create a partner login for ${addr} with a generated password?`,
      )
    )
      return;
    setGenerating(true);
    try {
      const r = await generatePartnerLogin({ kind, partnerId, email: addr, company });
      setMadeLogin({ email: r.email, password: r.password });
      qc.invalidateQueries({ queryKey: ["partner_users"] });
      toast(r.created ? "Partner login created" : "New password set");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not create the login");
    } finally {
      setGenerating(false);
    }
  }

  const open = (invitesQ.data ?? []).filter((i) => !i.claimed_at);

  async function onCreate(addr: string = to.trim()) {
    if (!EMAIL_RE.test(addr)) {
      error("Enter the partner's email address");
      return;
    }
    try {
      const inv = await create.mutateAsync({ kind, partnerId, email: addr });
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
        text: `Good day,\n\nExPac has set up a partner portal login for ${company}. Use the link below to create your login, then add or update your rate sheets, we'll use them when quoting.\n\n${url}\n\nPlease sign up with this email address (${i.email}).\n\nKind regards`,
        html: `<p>Good day,</p><p>ExPac has set up a partner portal login for <strong>${company}</strong>. Use the link below to create your login, then add or update your rate sheets, we'll use them when quoting.</p><p><a href="${url}">Create your partner login</a></p><p>Please sign up with this email address (${i.email}).</p><p>Kind regards</p>`,
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

  type PartnerUserRow = NonNullable<typeof usersQ.data>[number];
  async function toggleAccess(u: PartnerUserRow) {
    const enable = u.role !== "partner";
    if (!enable && !window.confirm(`Switch off ${u.email}'s partner login?`)) return;
    try {
      await setAccess.mutateAsync({ profileId: u.id, enabled: enable });
      toast(enable ? "Access restored" : "Access switched off");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not change access");
    }
  }

  // More people at this partner (Contacts tab, 0247), each with their own login.
  const contactsKey = ["partner_contacts", kind, partnerId];
  const contactsQ = useQuery({ queryKey: contactsKey, queryFn: () => listPartnerContacts(kind, partnerId) });
  const addContact = useMutation({
    mutationFn: (v: Parameters<typeof savePartnerContact>[1]) => savePartnerContact(undefined, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactsKey }),
  });
  const [adding, setAdding] = useState(false);
  const primary = low(email);
  const contacts = contactsQ.data ?? [];
  const loginContacts = contacts.filter((c) => c.email && low(c.email) !== primary);
  const noEmail = contacts.filter((c) => !c.email);
  const contactEmails = new Set(loginContacts.map((c) => low(c.email)));
  // A login that belongs to a listed contact shows on that contact's row instead.
  const otherUsers = (usersQ.data ?? []).filter((u) => !contactEmails.has(low(u.email)));

  function submitContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "").trim() || null;
    const name = g("name");
    const addr = g("email");
    if (!name) return error("Enter the contact's name");
    if (!addr || !EMAIL_RE.test(addr)) return error("Enter the contact's email address");
    if (low(addr) === primary || contacts.some((c) => low(c.email) === low(addr)))
      return error("That email is already a contact on this partner");
    addContact.mutate(
      {
        partner_kind: kind,
        partner_id: partnerId,
        salutation: g("salutation"),
        name,
        role: g("role"),
        email: addr,
        phone: null,
        mobile: null,
        address: null,
        notes: null,
      },
      {
        onSuccess: () => {
          toast(`${name} added, now create their login`);
          setAdding(false);
        },
        onError: (er) => error(er instanceof Error ? er.message : "Could not add the contact"),
      },
    );
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
        A partner login sees and edits only {company}'s own rate sheets, never your tier sheets,
        sell rates, margins, customers or quotes. Every change shows in each sheet's History.
      </p>

      {otherUsers.map((u) => (
        <div key={u.id} className="rs-meta" style={{ marginBottom: 6 }}>
          <strong>{u.email || u.full_name}</strong>
          <span>{u.role === "partner" ? "Active" : "Access off"}</span>
          <span>
            Last sign-in {u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "never"}
          </span>
          <button
            type="button"
            className={`btn small outline${u.role === "partner" ? " warn" : ""}`}
            disabled={setAccess.isPending}
            onClick={() => toggleAccess(u)}
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
          onClick={() => onCreate()}
          disabled={create.isPending}
        >
          {create.isPending ? "Creating…" : "Create invite link"}
        </button>
        <button type="button" className="btn outline" onClick={() => onGenerate()} disabled={generating}>
          {generating ? "Generating…" : "Generate password"}
        </button>
      </div>
      <span className="hint">
        The link works once, and only for this email address. Or generate a password to create the
        login straight away (or reset it), sign in at {window.location.origin} to add their rates.
      </span>
      <div className="cr-portal-contacts">
        <div className="cr-portal-contacts-head">
          <b>Other contacts with partner login</b>
          {!adding && (
            <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
              + Add contact
            </button>
          )}
        </div>
        <p className="hint" style={{ margin: "0 0 6px" }}>
          Each contact gets their own login to {company}&apos;s rate sheets. They also show on the Contacts tab.
        </p>

        {loginContacts.map((c) => {
          const u = (usersQ.data ?? []).find((x) => low(x.email) === low(c.email));
          const inv = open.find((i) => low(i.email) === low(c.email));
          const label = [c.salutation, c.name].filter(Boolean).join(" ");
          return (
            <div key={c.id} className="cr-portal-contact">
              <div className="rs-meta" style={{ marginBottom: 4 }}>
                <strong>{label}</strong>
                <span>{c.email}</span>
                {c.role && <span>{c.role}</span>}
                <span>
                  {u
                    ? `${u.role === "partner" ? "Active" : "Access off"} · last sign-in ${
                        u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "never"
                      }`
                    : inv
                      ? "Invite sent"
                      : "No login yet"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn small outline"
                  disabled={generating}
                  onClick={() => onGenerate(c.email ?? "")}
                >
                  {u ? "Reset password" : "Generate password"}
                </button>
                {!u && (
                  <button
                    type="button"
                    className="btn small outline"
                    disabled={create.isPending}
                    onClick={() => onCreate(c.email ?? "")}
                  >
                    {inv ? "New invite link" : "Create invite link"}
                  </button>
                )}
                {u && (
                  <button
                    type="button"
                    className={`btn small outline${u.role === "partner" ? " warn" : ""}`}
                    disabled={setAccess.isPending}
                    onClick={() => toggleAccess(u)}
                  >
                    {u.role === "partner" ? "Switch off" : "Restore"}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {loginContacts.length === 0 && !adding && !contactsQ.isLoading && (
          <p className="hint" style={{ margin: 0 }}>No other contacts yet.</p>
        )}

        {noEmail.length > 0 && (
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {noEmail.map((c) => c.name).join(", ")} {noEmail.length === 1 ? "has" : "have"} no email. Add one on
            the Contacts tab to give them a login.
          </p>
        )}

        {adding && (
          <form className="cr-portal-add" onSubmit={submitContact}>
            <label className="cr-field">
              <span>Salutation</span>
              <select name="salutation" defaultValue="">
                <option value="">—</option>
                {SALUTATIONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="cr-field">
              <span>Name *</span>
              <input name="name" autoFocus />
            </label>
            <label className="cr-field">
              <span>Email *</span>
              <input name="email" type="email" />
            </label>
            <label className="cr-field">
              <span>Role</span>
              <input name="role" list="pl-contact-roles" />
              <datalist id="pl-contact-roles">
                {CONTACT_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <div className="cr-portal-add-foot">
              <button type="button" className="btn outline btn-sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="btn btn-sm" disabled={addContact.isPending}>
                {addContact.isPending ? "Adding…" : "Add contact"}
              </button>
            </div>
          </form>
        )}
      </div>

      {madeLogin && (
        <div className="rs-meta" style={{ marginTop: 8 }}>
          <span>Login</span>
          <strong>{madeLogin.email}</strong>
          <span>Password</span>
          <strong style={{ fontFamily: "monospace", fontSize: "0.95rem" }}>{madeLogin.password}</strong>
          <button
            type="button"
            className="btn small outline"
            onClick={() =>
              navigator.clipboard
                ?.writeText(`${window.location.origin}\nEmail: ${madeLogin.email}\nPassword: ${madeLogin.password}`)
                .then(() => toast("Login details copied"))
                .catch(() => error("Could not copy"))
            }
          >
            Copy
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setMadeLogin(null)}
            title="Hide"
          >
            ✕
          </button>
          <span className="hint" style={{ flexBasis: "100%" }}>
            Shown once only, copy it now. Sign in as the partner in a private / incognito window,
            or you'll be signed out of ExPac here.
          </span>
        </div>
      )}
    </section>
  );
}
