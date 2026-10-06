import { useState } from "react";
import { useToast } from "../../components/Toast";
import { usePortalUsers, useRestorePortalAccess, useRevokePortalAccess } from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import { sendMail } from "../../lib/mail";
import { EMAIL_BODY_STYLE, PUBLIC_APP_URL, emailButtonHtml } from "../../lib/mailStyle";
import { customersDb, useCustomerMutation, type CustomerRecord } from "../../lib/customers";

/**
 * General › Primary Contact › "Enable Customer Portal Access" (like the
 * reference screenshot): create the contact's portal login with a password,
 * reset it, send the login details by email, or switch access off.
 * Admin only, same as Customers › Portal Access.
 */
export default function PortalAccessBox({
  client,
  email,
  name,
  salutation,
  lastName,
  isAdmin,
}: {
  client: CustomerRecord;
  email: string;
  name: string;
  salutation: string;
  lastName: string;
  isAdmin: boolean;
}) {
  const { toast, error } = useToast();
  const usersQ = usePortalUsers();
  const revoke = useRevokePortalAccess();
  const restore = useRestorePortalAccess();
  const login = useCustomerMutation(customersDb.portalLogin);
  const [password, setPassword] = useState("");
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const logins = (usersQ.data ?? []).filter((u) => u.client_id === client.id);
  const mine = logins.find((u) => (u.email ?? "").toLowerCase() === email.trim().toLowerCase());
  const active = !!mine && mine.role === "client";
  const greeting = [salutation, lastName].filter(Boolean).join(" ");

  if (!isAdmin) {
    return (
      <div className="cr-portal">
        <b>Customer Portal Access</b>
        <p className="hint">
          {active ? "This contact can sign in to the portal." : "No portal login for this contact."} An admin manages portal logins.
        </p>
      </div>
    );
  }

  function issue(reset: boolean) {
    if (!email.trim()) return error("Add the contact's email first (and save)");
    login.mutate(
      { clientId: client.id, email: email.trim(), fullName: name || client.company, password: password || undefined, greeting: greeting || undefined },
      {
        onSuccess: (r) => {
          setIssued({ email: r.email, password: r.password });
          setPassword("");
          setEnabling(false);
          toast(reset ? "Password reset" : r.created ? "Portal login created" : "Portal access enabled");
        },
        onError: (e) => error(e.message),
      },
    );
  }

  async function sendDetails() {
    if (!issued) return;
    setSending(true);
    const hello = greeting ? `Good day ${greeting},` : "Good day,";
    const url = `${PUBLIC_APP_URL}/login`;
    try {
      await sendMail({
        to: [issued.email],
        bcc: ["support@expac.co.za"],
        subject: "Your ExPac Motion customer portal login",
        html:
          `<div style="${EMAIL_BODY_STYLE}"><p>${hello}</p>` +
          `<p>Your ExPac Motion customer portal is ready, request quotes, accept quotations, track every shipment and see your goods in our warehouse, all in one place.</p>` +
          `<p><b>Sign in:</b> ${url}<br><b>Email:</b> ${issued.email}<br><b>Password:</b> ${issued.password}</p>` +
          `<p>${emailButtonHtml(url, "Open the portal")}</p>` +
          `<p>Please change your password after your first sign-in (Forgot password on the sign-in page).</p>` +
          `<p>Kind regards,<br>ExPac Forwarding</p></div>`,
        text:
          `${hello}\n\nYour ExPac Motion customer portal is ready.\n\nSign in: ${url}\nEmail: ${issued.email}\nPassword: ${issued.password}\n\n` +
          `Please change your password after your first sign-in.\n\nKind regards,\nExPac Forwarding`,
      });
      toast(`Login details sent to ${issued.email}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send the email");
    } finally {
      setSending(false);
    }
  }

  const checked = active || enabling;
  return (
    <div className="cr-portal">
      <label className="check" style={{ margin: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            if (e.target.checked) {
              if (mine && mine.role === "restricted") {
                restore.mutate(mine.id, { onSuccess: () => toast("Portal access restored"), onError: (er) => error(er.message) });
              } else setEnabling(true);
            } else if (active && mine) {
              if (!confirm(`Switch off portal access for ${mine.email}? They can't sign in until it's switched back on.`)) return;
              revoke.mutate(mine.id, { onSuccess: () => toast("Portal access switched off"), onError: (er) => error(er.message) });
            } else setEnabling(false);
          }}
        />
        <b>Enable Customer Portal Access</b>
      </label>
      <p className="hint" style={{ margin: "4px 0 10px" }}>
        Note: grants the customer instant access to the customer portal for easier interaction and communication.
      </p>
      {checked && (
        <div className="cr-portal-row">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={active ? "New password (blank = generate)" : "Password (blank = generate)"}
            autoComplete="new-password"
          />
          {active ? (
            <button type="button" className="btn outline btn-sm" disabled={login.isPending} onClick={() => issue(true)}>
              {login.isPending ? "Resetting…" : "Reset Password"}
            </button>
          ) : (
            <button type="button" className="btn btn-sm" disabled={login.isPending} onClick={() => issue(false)}>
              {login.isPending ? "Creating…" : "Create login"}
            </button>
          )}
          <button
            type="button"
            className="btn outline btn-sm"
            disabled={!issued || sending}
            title={issued ? undefined : "Create the login or reset the password first, the email includes the password"}
            onClick={sendDetails}
          >
            {sending ? "Sending…" : "Send Login Details To Customer"}
          </button>
        </div>
      )}
      {issued && (
        <p className="cr-portal-issued">
          Login: <b>{issued.email}</b> · Password: <b>{issued.password}</b>, shown once; send it to the customer or note it now.
        </p>
      )}
      {logins.length > 0 && (
        <div className="cr-portal-logins">
          {logins.map((u) => (
            <span key={u.id}>
              {u.email}, {u.role === "client" ? "active" : "switched off"}
              {u.last_sign_in_at ? ` · last sign-in ${formatDateTime(u.last_sign_in_at)}` : " · never signed in"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
