import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import MergeCodeMenu from "../components/MergeCodeMenu";
import Modal from "../components/Modal";
import RichTextEditor from "../components/RichTextEditor";
import { useToast } from "../components/Toast";
import {
  useCompanySettings,
  useJobs,
  useMyProfile,
  useProfiles,
  useQuotes,
  useUpdateCompanySettings,
  useUpdateProfile,
  useUploadMailAsset,
} from "../lib/hooks";
import { SHIPMENT_MERGE_CODES } from "../lib/mailMerge";
import {
  DEFAULT_QUOTATION_COMMS,
  DEFAULT_QUOTATION_REPLIES,
  DEFAULT_SHIPMENT_COMMS,
  DEFAULT_SHIPMENT_REPLIES,
  quotationCommsTemplate,
  quotationReplyTemplate,
  renderQuoteEmail,
  renderShipmentEmail,
  SHIPMENT_MODE_KEYS,
  SHIPMENT_MODE_LABEL,
  shipmentCommsTemplate,
  shipmentModeKey,
  shipmentReplyTemplate,
} from "../lib/mailTemplates";
import type {
  CompanySettingsPatch,
  Profile,
  QuoteMode,
  ShipmentCommsConfig,
  ShipmentCommsTemplate,
  ShipmentModeKey,
  UserRole,
} from "../lib/types";
import { formatDate } from "../lib/format";
import { PARTNER_LABEL } from "../lib/tariff";
import { useQueryClient } from "@tanstack/react-query";
import {
  CLIENT_PERMS,
  PARTNER_PERMS,
  STAFF_PERMS,
  rolePermissions,
  type PermDef,
  type PermKey,
  type RolePermissions,
} from "../lib/permissions";

type Tab =
  | "company"
  | "defaults"
  | "team"
  | "roles"
  | "email"
  | "comms"
  | "replies"
  | "qcomms"
  | "qreplies";

const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "Company Details" },
  { key: "defaults", label: "Quote Defaults" },
  { key: "team", label: "Team" },
  { key: "roles", label: "Roles & Permissions" },
  { key: "email", label: "Email" },
  { key: "comms", label: "Shipment Comms" },
  { key: "replies", label: "Shipment Replies" },
  { key: "qcomms", label: "Quotation Comms" },
  { key: "qreplies", label: "Quotation Replies" },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "company";

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`subnav-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel">
        {tab === "company" && <CompanyTab />}
        {tab === "defaults" && <DefaultsTab />}
        {tab === "team" && <TeamTab />}
        {tab === "roles" && <RolesTab />}
        {tab === "email" && <EmailTab />}
        {tab === "comms" && <ShipmentCommsTab />}
        {tab === "replies" && <ShipmentRepliesTab />}
        {tab === "qcomms" && <QuotationCommsTab />}
        {tab === "qreplies" && <QuotationRepliesTab />}
      </div>
    </>
  );
}

function CompanyTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      legal_name: String(fd.get("legal_name") || ""),
      reg_no: String(fd.get("reg_no") || ""),
      vat_no: String(fd.get("vat_no") || ""),
      tel: String(fd.get("tel") || ""),
      email: String(fd.get("email") || ""),
      postal_address: String(fd.get("postal_address") || ""),
      strapline: String(fd.get("strapline") || ""),
      blurb: String(fd.get("blurb") || ""),
      bank_details: String(fd.get("bank_details") || ""),
    };
    try {
      await update.mutateAsync(patch);
      toast("Company details saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Used on the printed quotation letterhead and email sign-off.
      </p>
      <div className="field">
        <label>Legal Name</label>
        <input name="legal_name" defaultValue={data.legal_name} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>Reg No</label>
          <input name="reg_no" defaultValue={data.reg_no} />
        </div>
        <div className="field">
          <label>VAT No</label>
          <input name="vat_no" defaultValue={data.vat_no} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Tel Number</label>
          <input name="tel" defaultValue={data.tel} />
        </div>
        <div className="field">
          <label>Email Address</label>
          <input name="email" type="email" defaultValue={data.email} />
        </div>
      </div>
      <div className="field">
        <label>Postal Address</label>
        <input name="postal_address" defaultValue={data.postal_address} />
      </div>
      <div className="field">
        <label>Strapline</label>
        <input name="strapline" defaultValue={data.strapline} />
      </div>
      <div className="field">
        <label>Quotation Footer Blurb</label>
        <textarea name="blurb" rows={5} defaultValue={data.blurb} />
      </div>
      <div className="field">
        <label>Banking Details (one line per field)</label>
        <textarea name="bank_details" rows={6} defaultValue={data.bank_details} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button type="submit" className="btn" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save Company Details"}
        </button>
      </div>
    </form>
  );
}

function DefaultsTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      default_fx_usd_zar: Number(fd.get("default_fx_usd_zar")) || 0,
      default_fx_cny_zar: Number(fd.get("default_fx_cny_zar")) || 0,
      default_fx_eur_zar: Number(fd.get("default_fx_eur_zar")) || 0,
      default_fx_gbp_zar: Number(fd.get("default_fx_gbp_zar")) || 0,
      default_vat_pct: Number(fd.get("default_vat_pct")) || 0,
      default_incoterm: String(fd.get("default_incoterm") || ""),
    };
    try {
      await update.mutateAsync(patch);
      toast("Defaults saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Seeded into every new quotation — still editable per quote.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Default FX Rate — USD/ZAR</label>
          <input
            name="default_fx_usd_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_usd_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate — CNY/ZAR</label>
          <input
            name="default_fx_cny_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_cny_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate — EUR/ZAR</label>
          <input
            name="default_fx_eur_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_eur_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate — GBP/ZAR</label>
          <input
            name="default_fx_gbp_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_gbp_zar ?? 24}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Default VAT %</label>
          <input
            name="default_vat_pct"
            type="number"
            step="0.01"
            defaultValue={data.default_vat_pct}
          />
        </div>
        <div className="field">
          <label>Default Incoterm</label>
          <input name="default_incoterm" defaultValue={data.default_incoterm} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button type="submit" className="btn" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save Defaults"}
        </button>
      </div>
    </form>
  );
}

/** Portal logins (partner or customer, incl. switched-off ones) aren't staff. */
function isStaffLogin(p: Profile) {
  return (p.role === "admin" || p.role === "user" || p.role === "restricted") && !p.client_id && !p.partner_id;
}
function roleRank(p: Profile) {
  if (isStaffLogin(p)) return p.role === "admin" ? 0 : p.role === "user" ? 1 : 2;
  return p.partner_id || p.role === "partner" ? 3 : 4;
}
function roleLabel(p: Profile) {
  if (p.role === "admin") return "Admin User";
  if (p.role === "user") return "Standard User";
  if (p.role === "partner")
    return `Partner Portal User${p.partner_kind ? ` · ${PARTNER_LABEL[p.partner_kind]}` : ""}`;
  if (p.role === "client") return "Customer Portal";
  if (p.partner_id) return "Partner Portal (switched off)";
  if (p.client_id) return "Customer Portal (access off)";
  return "Restricted";
}

function TeamTab() {
  const { data, isLoading, isError, error } = useProfiles();
  const myProfileQ = useMyProfile();
  const isAdmin = myProfileQ.data?.role === "admin";
  const update = useUpdateProfile();
  const { toast, error: toastError } = useToast();
  const [editingName, setEditingName] = useState<string | null>(null);
  const [permsFor, setPermsFor] = useState<Profile | null>(null);

  if (isLoading) return <Loading />;
  if (isError) return <ErrorNote error={error} />;
  // Every login, each under its real role: staff first (their role can be
  // changed here), then partner-portal and customer-portal logins — those
  // are read-only here (managed on the partner / customer record), so a
  // portal login can never be turned into staff from this list.
  const rows = [...(data ?? [])].sort((a, b) => roleRank(a) - roleRank(b));
  if (rows.length === 0) return <EmptyState>No team members yet.</EmptyState>;

  async function onRole(p: Profile, role: UserRole) {
    try {
      await update.mutateAsync({ id: p.id, patch: { role } });
      toast(`${p.full_name || "Member"} is now ${role}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update role");
    }
  }

  async function onRename(p: Profile, full_name: string) {
    try {
      await update.mutateAsync({ id: p.id, patch: { full_name } });
      toast("Name updated");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update name");
    } finally {
      setEditingName(null);
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Every login and its role. Only Admin can change a staff role — Standard User is full Motion
        access, Restricted blocks it entirely. Partner Portal and Customer Portal logins are managed on
        the partner / customer record.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Permissions</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {editingName === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.full_name ?? ""}
                      onBlur={(e) => onRename(p, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingName(null);
                      }}
                    />
                  ) : (
                    <button
                      className="btn ghost small"
                      onClick={() => setEditingName(p.id)}
                    >
                      {p.full_name || "—"}
                    </button>
                  )}
                </td>
                <td className="muted">{p.email || "—"}</td>
                <td>
                  {isAdmin && isStaffLogin(p) ? (
                    <select
                      value={p.role}
                      onChange={(e) => onRole(p, e.target.value as UserRole)}
                    >
                      <option value="admin">Admin User</option>
                      <option value="user">Standard User</option>
                      <option value="restricted">Restricted</option>
                    </select>
                  ) : (
                    <span className="tag">{roleLabel(p)}</span>
                  )}
                </td>
                <td>
                  {p.role === "admin" ? (
                    <span className="muted">Everything</span>
                  ) : isAdmin && (p.role === "user" || (p.role === "partner" && p.partner_id)) ? (
                    <button type="button" className="btn small outline" onClick={() => setPermsFor(p)}>
                      {Object.keys(p.permissions ?? {}).length ? "Custom ✎" : "Role default ✎"}
                    </button>
                  ) : p.role === "client" ? (
                    <span className="muted">Customers › Portal Access</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="nowrap">{formatDate(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {permsFor && <PermOverrideModal profile={permsFor} onClose={() => setPermsFor(null)} />}
    </>
  );
}

/** Settings > Roles & Permissions (0131): what each role may do. Admin User
 *  has everything; a single login can differ via Team > Permissions. */
function RolesTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const isAdmin = useMyProfile().data?.role === "admin";
  const qc = useQueryClient();
  const { toast, error: toastError } = useToast();
  const [draft, setDraft] = useState<RolePermissions | null>(null);

  if (isLoading) return <Loading />;
  if (isError) return <ErrorNote error={error} />;
  const saved = rolePermissions(data?.role_permissions);
  const v = draft ?? saved;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);

  function toggle<R extends keyof RolePermissions>(role: R, key: keyof RolePermissions[R]) {
    setDraft({ ...v, [role]: { ...v[role], [key]: !v[role][key] } });
  }
  async function onSave() {
    try {
      await update.mutateAsync({ role_permissions: v });
      qc.invalidateQueries({ queryKey: ["my_permissions"] });
      setDraft(null);
      toast("Role permissions saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save — is migration 0131 applied?");
    }
  }

  const section = <R extends keyof RolePermissions>(
    title: string,
    note: string,
    role: R,
    defs: PermDef<string>[],
  ) => (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px" }}>{title}</h3>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        {note}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              <th style={{ width: 120 }}>Allowed</th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const on = (v[role] as Record<string, boolean>)[d.key];
              return (
                <tr key={d.key}>
                  <td>
                    <strong>{d.label}</strong>
                    {d.hint && <div className="muted" style={{ fontSize: "0.78rem" }}>{d.hint}</div>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!isAdmin}
                      onChange={() => toggle(role, d.key as keyof RolePermissions[R])}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        What each role can do. <strong>Admin User</strong> always has everything (incl. team roles,
        partner logins and these settings). A single login can be given more or less on{" "}
        <strong>Team › Permissions</strong>.{!isAdmin && " Only Admin can change these."}
      </p>
      {section("Standard User", "Staff logins — full Motion access apart from the switches below.", "user", STAFF_PERMS)}
      {section(
        "Partner Portal User",
        "Agent / transporter / clearing agent / destination agent logins — they always see and edit their own rate sheets.",
        "partner",
        PARTNER_PERMS,
      )}
      {section(
        "Customer Portal",
        "Defaults for new customer logins — each login's own sections stay editable on Customers › Portal Access.",
        "client",
        CLIENT_PERMS,
      )}
      {isAdmin && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {dirty && (
            <button type="button" className="btn outline" onClick={() => setDraft(null)}>
              Undo
            </button>
          )}
          <button type="button" className="btn" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "Saving…" : "Save permissions"}
          </button>
        </div>
      )}
    </>
  );
}

/** Team › Permissions: one login's overrides (Default = the role's setting). */
function PermOverrideModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const settingsQ = useCompanySettings();
  const update = useUpdateProfile();
  const qc = useQueryClient();
  const { toast, error: toastError } = useToast();
  const roleKey = profile.role === "partner" ? "partner" : "user";
  const defs: PermDef<PermKey>[] = roleKey === "partner" ? PARTNER_PERMS : STAFF_PERMS;
  const roleVals = rolePermissions(settingsQ.data?.role_permissions)[roleKey] as Record<string, boolean>;
  const [over, setOver] = useState<Partial<Record<PermKey, boolean>>>(profile.permissions ?? {});

  async function onSave() {
    try {
      const permissions = Object.keys(over).length ? over : null;
      await update.mutateAsync({ id: profile.id, patch: { permissions } });
      qc.invalidateQueries({ queryKey: ["my_permissions"] });
      toast("Permissions saved");
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save — is migration 0131 applied?");
    }
  }

  return (
    <Modal title={`Permissions — ${profile.full_name || profile.email || "login"}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {roleLabel(profile)}. <strong>Role default</strong> follows Settings › Roles & Permissions.
      </p>
      <div className="table-wrap">
        <table>
          <tbody>
            {defs.map((d) => {
              const val = over[d.key];
              return (
                <tr key={d.key}>
                  <td>
                    <strong>{d.label}</strong>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>{d.hint}</div>
                  </td>
                  <td style={{ width: 210 }}>
                    <select
                      value={val == null ? "" : val ? "on" : "off"}
                      onChange={(e) => {
                        const next = { ...over };
                        if (e.target.value === "") delete next[d.key];
                        else next[d.key] = e.target.value === "on";
                        setOver(next);
                      }}
                    >
                      <option value="">Role default ({roleVals[d.key] ? "allowed" : "blocked"})</option>
                      <option value="on">Allow</option>
                      <option value="off">Block</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={update.isPending} onClick={onSave}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function EmailTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const { toast, error: toastError } = useToast();
  const [sig, setSig] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  const signature = sig ?? data.mail_signature_html;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      mail_sender_name: String(fd.get("mail_sender_name") || "").trim(),
      mail_reply_to: String(fd.get("mail_reply_to") || "").trim(),
      mail_signature_html: signature,
    };
    try {
      await update.mutateAsync(patch);
      toast("Email settings saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <p className="muted" style={{ marginTop: 0 }}>
          Applied to campaigns, follow-up emails and form notifications. The
          sending address stays the verified domain — only the display name
          and reply-to change.
        </p>
        <div className="grid2">
          <div className="field">
            <label>Sent-as name</label>
            <input name="mail_sender_name" defaultValue={data.mail_sender_name} />
          </div>
          <div className="field">
            <label>Reply-to address</label>
            <input
              name="mail_reply_to"
              type="email"
              defaultValue={data.mail_reply_to}
            />
          </div>
        </div>
        <div className="field">
          <label>Email signature</label>
          <RichTextEditor
            value={signature}
            onChange={setSig}
            onUploadImage={(file) => uploadAsset.mutateAsync(file)}
          />
          <span className="hint">
            Added to the bottom of every campaign and follow-up email.
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save Email Settings"}
          </button>
        </div>
      </form>

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />

      <div className="field">
        <label>Active provider</label>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <strong>Resend</strong>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Live — sends via the Resend API. Configured in Cloudflare Pages
            environment variables.
          </p>
        </div>
      </div>
    </>
  );
}

function ShipmentCommsTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const jobsQ = useJobs();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  return (
    <CommsTemplateEditor
      config={data.shipment_comms ?? {}}
      entities={jobsQ.data ?? []}
      entityNoun="shipment"
      settingsField="shipment_comms"
      defaults={DEFAULT_SHIPMENT_COMMS}
      resolve={shipmentCommsTemplate}
      render={renderShipmentEmail}
      description={
        <>
          The customer update email sent from a shipment's Comms panel. Each
          freight group has its own template — edit the wording and drop in{" "}
          <code>{"{{ shipment.number }}"}</code>-style codes. The preview
          renders a real shipment; missing values show blank.
        </>
      }
      saveLabel="Save Shipment Comms"
    />
  );
}

function ShipmentRepliesTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const jobsQ = useJobs();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  return (
    <CommsTemplateEditor
      config={data.shipment_replies ?? {}}
      entities={jobsQ.data ?? []}
      entityNoun="shipment"
      settingsField="shipment_replies"
      defaults={DEFAULT_SHIPMENT_REPLIES}
      resolve={shipmentReplyTemplate}
      render={renderShipmentEmail}
      description={
        <>
          A quick chat-style reply within an existing thread — no
          shipment-data block, just your message and the signature. Use
          Shipment Comms instead for a full status-update notification.
        </>
      }
      saveLabel="Save Shipment Replies"
    />
  );
}

function QuotationCommsTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const quotesQ = useQuotes();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  return (
    <CommsTemplateEditor
      config={data.quotation_comms ?? {}}
      entities={quotesQ.data ?? []}
      entityNoun="quotation"
      settingsField="quotation_comms"
      defaults={DEFAULT_QUOTATION_COMMS}
      resolve={quotationCommsTemplate}
      render={renderQuoteEmail}
      description={
        <>
          The customer update email sent from a quotation's Comms panel —
          same method as Shipment Comms, just with the quote's own status
          (New Lead/Quote Sent/Quote Accepted/Completed/Not Proceeding)
          instead of a shipment milestone. Each freight group has its own
          template — edit the wording and drop in{" "}
          <code>{"{{ shipment.number }}"}</code>-style codes. The preview
          renders a real quotation; missing values show blank.
        </>
      }
      saveLabel="Save Quotation Comms"
    />
  );
}

function QuotationRepliesTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const quotesQ = useQuotes();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  return (
    <CommsTemplateEditor
      config={data.quotation_replies ?? {}}
      entities={quotesQ.data ?? []}
      entityNoun="quotation"
      settingsField="quotation_replies"
      defaults={DEFAULT_QUOTATION_REPLIES}
      resolve={quotationReplyTemplate}
      render={renderQuoteEmail}
      description={
        <>
          A quick chat-style reply within an existing thread — no
          quotation-data block, just your message and the signature. Use
          Quotation Comms instead for a full status-update notification.
        </>
      }
      saveLabel="Save Quotation Replies"
    />
  );
}

/** Shared by Shipment Comms/Replies and Quotation Comms/Replies — generic
 *  over the entity a template renders against (a Job or a Quote), since
 *  both share the same {id, mode, reference, client?.company} shape that
 *  the mode tabs and preview picker need. `lead?.company` is optional —
 *  a Quote can be against a not-yet-promoted lead instead of a client;
 *  Job has no such field, so it's simply absent there. */
function CommsTemplateEditor<
  T extends {
    id: string;
    mode: QuoteMode;
    reference: string;
    client?: { company?: string | null } | null;
    lead?: { company?: string | null } | null;
  },
>({
  config,
  entities,
  entityNoun,
  settingsField,
  defaults,
  resolve,
  render,
  description,
  saveLabel,
}: {
  config: ShipmentCommsConfig;
  entities: T[];
  /** e.g. "shipment" / "quotation" — used in the preview-picker copy. */
  entityNoun: string;
  settingsField:
    | "shipment_comms"
    | "shipment_replies"
    | "quotation_comms"
    | "quotation_replies";
  defaults: Record<ShipmentModeKey, ShipmentCommsTemplate>;
  resolve: (
    key: ShipmentModeKey,
    config?: ShipmentCommsConfig | null,
  ) => ShipmentCommsTemplate;
  render: (
    entity: T,
    tpl: ShipmentCommsTemplate,
    remarks: string,
  ) => { subject: string; text: string };
  description: ReactNode;
  saveLabel: string;
}) {
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  const [drafts, setDrafts] = useState<
    Record<ShipmentModeKey, ShipmentCommsTemplate>
  >(
    () =>
      Object.fromEntries(
        SHIPMENT_MODE_KEYS.map((k) => [k, resolve(k, config)]),
      ) as Record<ShipmentModeKey, ShipmentCommsTemplate>,
  );
  const [activeKey, setActiveKey] = useState<ShipmentModeKey>("sea");
  const [previewId, setPreviewId] = useState<string>("");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const draft = drafts[activeKey];
  const setDraft = (patch: Partial<ShipmentCommsTemplate>) =>
    setDrafts((d) => ({ ...d, [activeKey]: { ...d[activeKey], ...patch } }));

  const modeEntities = useMemo(
    () => entities.filter((e) => shipmentModeKey(e.mode) === activeKey),
    [entities, activeKey],
  );
  const previewEntity =
    modeEntities.find((e) => e.id === previewId) ??
    modeEntities[0] ??
    entities[0] ??
    null;
  const preview = previewEntity ? render(previewEntity, draft, "") : null;

  const dft = defaults[activeKey];
  const isDefault = draft.subject === dft.subject && draft.body === dft.body;

  async function onSave() {
    const next: ShipmentCommsConfig = {};
    for (const k of SHIPMENT_MODE_KEYS) {
      const base = defaults[k];
      const cur = drafts[k];
      if (cur.subject !== base.subject || cur.body !== base.body) {
        next[k] = { subject: cur.subject, body: cur.body };
      }
    }
    try {
      await update.mutateAsync({ [settingsField]: next });
      toast("Templates saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {description}
      </p>

      <div
        style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}
      >
        {SHIPMENT_MODE_KEYS.map((k) => (
          <button
            key={k}
            className={`subnav-tab${activeKey === k ? " active" : ""}`}
            onClick={() => setActiveKey(k)}
          >
            {SHIPMENT_MODE_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="field">
        <div className="merge-code-row">
          <label>Subject</label>
          <MergeCodeMenu
            targetRef={subjectRef}
            onChange={(v) => setDraft({ subject: v })}
            codes={SHIPMENT_MERGE_CODES}
          />
        </div>
        <input
          ref={subjectRef}
          value={draft.subject}
          onChange={(e) => setDraft({ subject: e.target.value })}
        />
      </div>

      <div className="field">
        <div className="merge-code-row">
          <label>Email body — {SHIPMENT_MODE_LABEL[activeKey]}</label>
          <MergeCodeMenu
            targetRef={bodyRef}
            onChange={(v) => setDraft({ body: v })}
            codes={SHIPMENT_MERGE_CODES}
          />
        </div>
        <textarea
          ref={bodyRef}
          rows={20}
          value={draft.body}
          onChange={(e) => setDraft({ body: e.target.value })}
          style={{
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: "0.8rem",
          }}
        />
        <span className="hint">
          {isDefault ? (
            "Using the built-in default."
          ) : (
            <button
              type="button"
              className="link-btn"
              onClick={() => setDraft({ ...dft })}
            >
              Reset this template to the default
            </button>
          )}
        </span>
      </div>

      <div className="field">
        <label>Preview against {entityNoun}</label>
        <select
          value={previewEntity?.id ?? ""}
          onChange={(e) => setPreviewId(e.target.value)}
        >
          {modeEntities.length === 0 && entities.length > 0 && (
            <option value="">
              (no {SHIPMENT_MODE_LABEL[activeKey]} {entityNoun}s yet — showing
              any)
            </option>
          )}
          {(modeEntities.length ? modeEntities : entities).map((e) => (
            <option key={e.id} value={e.id}>
              {e.reference} — {e.client?.company ?? e.lead?.company ?? "—"}
            </option>
          ))}
        </select>
      </div>

      {preview ? (
        <div className="field">
          <label>Preview</label>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: 14,
              background: "var(--white)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              {preview.subject}
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                fontFamily:
                  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', sans-serif",
                fontSize: "11pt",
                lineHeight: 1.55,
              }}
            >
              {preview.text}
            </pre>
          </div>
        </div>
      ) : (
        <EmptyState>Add a {entityNoun} to see a preview.</EmptyState>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={onSave}
          disabled={update.isPending}
        >
          {update.isPending ? "Saving…" : saveLabel}
        </button>
      </div>
    </>
  );
}
