import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, Popover } from "../components/common";
import MergeCodeMenu from "../components/MergeCodeMenu";
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
  useDeleteLogin,
  useSetPortalPermissions,
  useUploadMailAsset,
  useCan,
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
  Department,
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
  ADMIN_ONLY_LABEL,
  rolePermissions,
  type PermDef,
  type PermKey,
  type RolePermissions,
} from "../lib/permissions";
import SageSettingsTab from "./SageSettingsTab";
import OperationsSettingsTab from "./OperationsSettingsTab";
import SystemHealthTab from "./SystemHealthTab";
import MotionAiSettingsTab from "./MotionAiSettingsTab";
import MotionAiKnowledgeTab from "./MotionAiKnowledgeTab";
import AppearanceSettingsTab from "./AppearanceSettingsTab";

type Tab =
  | "company"
  | "defaults"
  | "appearance"
  | "team"
  | "portal"
  | "roles"
  | "email"
  | "comms"
  | "replies"
  | "qcomms"
  | "qreplies"
  | "operations"
  | "sage"
  | "health"
  | "motionai"
  | "aiknowledge";

// The side menu, grouped (12 sections no longer fit one row of tabs). The
// ?tab= keys stay as they were, so existing links (e.g. ?tab=health in the
// health alert email) keep working.
const GROUPS: { title: string; tabs: { key: Tab; label: string }[] }[] = [
  {
    title: "Company",
    tabs: [
      { key: "company", label: "Company Details" },
      { key: "defaults", label: "Quote Defaults" },
      { key: "appearance", label: "Appearance & Brand" },
    ],
  },
  {
    title: "People & access",
    tabs: [
      { key: "team", label: "Team" },
      { key: "portal", label: "Customers on Portal" },
      { key: "roles", label: "Roles & Permissions" },
    ],
  },
  {
    title: "Communication",
    tabs: [
      { key: "email", label: "Email" },
      { key: "comms", label: "Shipment Comms" },
      { key: "replies", label: "Shipment Replies" },
      { key: "qcomms", label: "Quotation Comms" },
      { key: "qreplies", label: "Quotation Replies" },
    ],
  },
  {
    title: "Operations & integrations",
    tabs: [
      { key: "operations", label: "Operations" },
      { key: "sage", label: "Sage Accounting" },
      { key: "health", label: "System health" },
      { key: "motionai", label: "Motion AI" },
      { key: "aiknowledge", label: "Motion AI knowledge" },
    ],
  },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const requestedTab = (params.get("tab") as Tab) || "company";
  // Motion AI settings only for logins with Motion AI access (0214).
  const tab: Tab = (requestedTab === "motionai" || requestedTab === "aiknowledge") && !can("motion_ai") ? "company" : requestedTab;

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div className="set-layout">
        <nav className="set-nav panel" aria-label="Settings sections">
          {GROUPS.map((g) => (
            <div key={g.title} className="set-nav-group">
              <div className="set-nav-title">{g.title}</div>
              {g.tabs.filter((t) => (t.key !== "motionai" && t.key !== "aiknowledge") || can("motion_ai")).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`set-nav-item${tab === t.key ? " active" : ""}`}
                  aria-current={tab === t.key ? "page" : undefined}
                  onClick={() => setParams({ tab: t.key })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="panel set-body">
          {tab === "company" && <CompanyTab />}
          {tab === "defaults" && <DefaultsTab />}
          {tab === "appearance" && <AppearanceSettingsTab />}
          {tab === "team" && <TeamTab view="team" />}
          {tab === "portal" && <TeamTab view="portal" />}
          {tab === "roles" && <RolesTab />}
          {tab === "email" && <EmailTab />}
          {tab === "comms" && <ShipmentCommsTab />}
          {tab === "replies" && <ShipmentRepliesTab />}
          {tab === "qcomms" && <QuotationCommsTab />}
          {tab === "qreplies" && <QuotationRepliesTab />}
          {tab === "operations" && <OperationsSettingsTab />}
          {tab === "sage" && <SageSettingsTab />}
          {tab === "health" && <SystemHealthTab />}
          {tab === "motionai" && <MotionAiSettingsTab />}
          {tab === "aiknowledge" && <MotionAiKnowledgeTab />}
        </div>
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
        Seeded into every new quotation, still editable per quote.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Default FX Rate, USD/ZAR</label>
          <input
            name="default_fx_usd_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_usd_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate, CNY/ZAR</label>
          <input
            name="default_fx_cny_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_cny_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate, EUR/ZAR</label>
          <input
            name="default_fx_eur_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_eur_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate, GBP/ZAR</label>
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
/** A self sign-up still waiting (0189): an Admin can make it a staff login. */
function isWaitingSignup(p: Profile) {
  return p.role === "client" && !p.client_id && p.portal_status === "pending";
}
function roleRank(p: Profile) {
  if (isStaffLogin(p)) return p.role === "admin" ? 0 : p.role === "user" ? 1 : 2;
  return p.partner_id || p.role === "partner" ? 3 : 4;
}
/** The ExPac team's departments (0210), in the order Team shows them. */
const DEPARTMENTS: { key: Department; label: string }[] = [
  { key: "management", label: "Management" },
  { key: "support", label: "Support Division" },
  { key: "sales", label: "Sales Division" },
  { key: "accounts", label: "Accounts Division" },
  { key: "bdr", label: "BDR Division" },
];
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

/** Settings › Team (view "team"): the ExPac team by department. Settings ›
 *  Customers on Portal (view "portal"): every other login, i.e. sign-ups
 *  waiting, customer-portal and partner-portal logins. Same table, roles,
 *  access, rename and delete in both. */
function TeamTab({ view }: { view: "team" | "portal" }) {
  const { data, isLoading, isError, error } = useProfiles();
  const myProfileQ = useMyProfile();
  const isAdmin = myProfileQ.data?.role === "admin";
  const update = useUpdateProfile();
  const deleteLogin = useDeleteLogin();
  const { toast, error: toastError } = useToast();
  const [editingName, setEditingName] = useState<string | null>(null);
  const myId = myProfileQ.data?.id;

  if (isLoading) return <Loading />;
  if (isError) return <ErrorNote error={error} />;
  // Staff logins grouped by department (0210 / 0211). Portal logins are
  // read-only here (managed on the partner / customer record), so a portal
  // login can never be turned into staff; only a sign-up still waiting can.
  const rows = [...(data ?? [])].sort(
    (a, b) => roleRank(a) - roleRank(b) || (a.full_name ?? "").localeCompare(b.full_name ?? ""),
  );
  const staff = rows.filter(isStaffLogin);
  const unassigned = staff.filter((p) => !p.department || !DEPARTMENTS.some((d) => d.key === p.department));
  const waiting = rows.filter(isWaitingSignup);
  const partners = rows.filter((p) => !isStaffLogin(p) && (p.role === "partner" || !!p.partner_id));
  const customers = rows.filter((p) => !isStaffLogin(p) && !isWaitingSignup(p) && !partners.includes(p));

  async function onRole(p: Profile, role: UserRole) {
    try {
      await update.mutateAsync({ id: p.id, patch: { role } });
      toast(`${p.full_name || "Member"} is now ${role}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update role");
    }
  }

  async function onDelete(p: Profile) {
    const who = p.full_name || p.email || "this login";
    if (
      !window.confirm(
        `Delete ${who}'s login? They can't sign in again and this can't be undone. Records they made stay in Motion.`,
      )
    )
      return;
    try {
      await deleteLogin.mutateAsync(p.id);
      toast(`${who} deleted`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete the login, is migration 0189 applied?");
    }
  }

  async function onDepartment(p: Profile, department: Department | null) {
    try {
      await update.mutateAsync({ id: p.id, patch: { department } });
      toast(`${p.full_name || "Member"} moved to ${DEPARTMENTS.find((d) => d.key === department)?.label ?? "Not assigned"}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not change the department, is migration 0210 applied?");
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

  const group = (title: string, list: Profile[], note: string, empty: string) => (
    <section className="team-group">
      <h3 className="team-group-head">
        {title} <span className="ws-count">{list.length}</span>
      </h3>
      {note && <p className="hint team-empty">{note}</p>}
      {list.length ? teamTable(list, false) : <p className="hint team-empty">{empty}</p>}
    </section>
  );

  if (view === "portal") {
    return (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          Everyone who signs in to the Customer Portal or the Partner Portal. Their access is managed on the
          customer / partner record; a portal login can never become staff from here.
        </p>
        {waiting.length > 0 &&
          group(
            "Sign-ups waiting for approval",
            waiting,
            isAdmin
              ? "Approve a customer on Customers › Portal Access. A new ExPac team member also lands here first: pick Admin User or Standard User for them, and they move to Team."
              : "",
            "",
          )}
        {group("Customers on the portal", customers, "", "No customer portal logins yet.")}
        {group("Partner portal logins", partners, "Agents, transporters and clearing agents.", "No partner portal logins yet.")}
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The ExPac team by department. Only Admin can change a role or department. Standard User is full
        Motion access, Restricted blocks it entirely.
      </p>
      <p className="muted">
        Nobody can sign up as staff. To add a team member, create their login in Supabase
        (Authentication › Users › Add user); it shows under Customers on Portal as a sign-up waiting, pick
        Admin User or Standard User for it, then its department here.
      </p>
      {staff.length === 0 && <EmptyState>No team members yet.</EmptyState>}
      {DEPARTMENTS.map((d) => {
        const people = staff.filter((p) => p.department === d.key);
        return (
          <section key={d.key} className="team-group">
            <h3 className="team-group-head">
              {d.label} <span className="ws-count">{people.length}</span>
            </h3>
            {people.length ? teamTable(people, true) : <p className="hint team-empty">No one in {d.label} yet.</p>}
          </section>
        );
      })}
      {unassigned.length > 0 && (
        <section className="team-group">
          <h3 className="team-group-head">
            Not assigned to a department <span className="ws-count warn">{unassigned.length}</span>
          </h3>
          {isAdmin && <p className="hint team-empty">Pick each person's department in the Department column.</p>}
          {teamTable(unassigned, true)}
        </section>
      )}
    </>
  );

  function teamTable(list: Profile[], withDepartment: boolean) {
    return (
      <div className={`table-wrap team-wrap${withDepartment ? "" : " team-wrap--portal"}`}>
        <table>
          <thead>
            {/* Fixed widths, so every department's table lines up. */}
            <tr>
              <th className="tm-name">Name</th>
              <th className="tm-email">Email</th>
              {withDepartment && <th className="tm-dept">Department</th>}
              <th className="tm-role">Role</th>
              <th>Access</th>
              <th className="tm-joined">Joined</th>
              {isAdmin && <th className="tm-del"></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
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
                {withDepartment && (
                  <td>
                    {isAdmin ? (
                      <select
                        value={p.department ?? ""}
                        onChange={(e) => void onDepartment(p, (e.target.value || null) as Department | null)}
                      >
                        <option value="">Not assigned</option>
                        {DEPARTMENTS.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="tag">{DEPARTMENTS.find((d) => d.key === p.department)?.label ?? "Not assigned"}</span>
                    )}
                  </td>
                )}
                <td>
                  {isAdmin && (isStaffLogin(p) || isWaitingSignup(p)) ? (
                    <select
                      value={p.role}
                      onChange={(e) => {
                        if (e.target.value !== "client") void onRole(p, e.target.value as UserRole);
                      }}
                    >
                      {isWaitingSignup(p) && <option value="client">Customer sign-up (awaiting approval)</option>}
                      <option value="admin">Admin User</option>
                      <option value="user">Standard User</option>
                      <option value="restricted">Restricted</option>
                    </select>
                  ) : (
                    <span className="tag">{roleLabel(p)}</span>
                  )}
                </td>
                <td>
                  <AccessChecklist profile={p} canEdit={isAdmin} />
                </td>
                <td className="nowrap">{formatDate(p.created_at)}</td>
                {isAdmin && (
                  <td>
                    {p.id !== myId && (
                      <button
                        type="button"
                        className="btn outline warn btn-sm"
                        onClick={() => void onDelete(p)}
                        disabled={deleteLogin.isPending}
                        title="Delete this login"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
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
      toastError(e instanceof Error ? e.message : "Could not save, is migration 0131 applied?");
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
      {section("Standard User", "Staff logins, full Motion access apart from the switches below.", "user", STAFF_PERMS)}
      {section(
        "Partner Portal User",
        "Agent / transporter / clearing agent / destination agent logins, they always see and edit their own rate sheets.",
        "partner",
        PARTNER_PERMS,
      )}
      {section(
        "Customer Portal",
        "Defaults for new customer logins, each login's own sections stay editable on Customers › Portal Access.",
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

/** Settings › Team › Access: every function a login can use, as a
 *  dropdown checklist. Ticking / unticking saves straight away as that
 *  login's own setting (Standard User / Partner Portal User, Role default
 *  follows Settings › Roles & Permissions) or its portal sections
 *  (Customer Portal). Admin always has everything. */
function AccessChecklist({ profile: p, canEdit }: { profile: Profile; canEdit: boolean }) {
  const settingsQ = useCompanySettings();
  const update = useUpdateProfile();
  const setPortal = useSetPortalPermissions();
  const qc = useQueryClient();
  const { toast, error: toastError } = useToast();
  const roles = rolePermissions(settingsQ.data?.role_permissions);
  const roleKey = p.role === "user" ? "user" : p.role === "partner" && p.partner_id ? "partner" : null;
  const busy = update.isPending || setPortal.isPending;

  type Row = { key: string; label: string; hint?: string; on: boolean; fixed?: boolean; custom?: boolean };
  let rows: Row[];
  if (p.role === "admin") {
    rows = [
      ...STAFF_PERMS.map((d) => ({ key: d.key, label: d.label, hint: d.hint, on: true, fixed: true })),
      { key: "admin", label: ADMIN_ONLY_LABEL, on: true, fixed: true },
    ];
  } else if (roleKey) {
    const defs: PermDef<PermKey>[] = roleKey === "user" ? STAFF_PERMS : PARTNER_PERMS;
    const base = roles[roleKey] as Record<string, boolean>;
    rows = defs.map((d) => {
      const own = p.permissions?.[d.key];
      return { key: d.key, label: d.label, hint: d.hint, on: own ?? base[d.key] ?? false, custom: own != null };
    });
    rows =
      roleKey === "user"
        ? [...rows, { key: "admin", label: ADMIN_ONLY_LABEL, on: false, fixed: true }]
        : [{ key: "own", label: "Own rate sheets (add / edit)", on: true, fixed: true }, ...rows];
  } else if (p.role === "client") {
    rows = CLIENT_PERMS.map((d) => ({ key: d.key, label: d.label, on: p.portal_permissions?.[d.key] !== false }));
  } else {
    rows = [{ key: "none", label: "No access (switched off)", on: false, fixed: true }];
  }
  const editable = rows.filter((r) => !r.fixed);
  const onCount = rows.filter((r) => r.on).length;
  const hasCustom = rows.some((r) => r.custom);

  async function saveOverrides(next: Partial<Record<PermKey, boolean>>) {
    await update.mutateAsync({ id: p.id, patch: { permissions: Object.keys(next).length ? next : null } });
    qc.invalidateQueries({ queryKey: ["my_permissions"] });
  }
  async function toggle(r: Row) {
    try {
      if (p.role === "client") {
        const next = { ...p.portal_permissions, [r.key]: !r.on } as Profile["portal_permissions"];
        await setPortal.mutateAsync({ profileId: p.id, permissions: next });
      } else if (roleKey) {
        const base = (roles[roleKey] as Record<string, boolean>)[r.key] ?? false;
        const next = { ...(p.permissions ?? {}) } as Partial<Record<PermKey, boolean>>;
        // Back to the role's setting = no override.
        if (!r.on === base) delete next[r.key as PermKey];
        else next[r.key as PermKey] = !r.on;
        await saveOverrides(next);
      }
      toast(`${r.label}: ${r.on ? "removed" : "allowed"}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not change access");
    }
  }

  return (
    <Popover
      label={p.role === "admin" ? "Everything" : `${onCount} of ${rows.length}${hasCustom ? " · custom" : ""}`}
    >
      {() => (
        <div className="access-menu">
          {rows.map((r) => (
            <label key={r.key} className={`access-row${r.fixed || !canEdit ? " fixed" : ""}`}>
              <input
                type="checkbox"
                checked={r.on}
                disabled={r.fixed || !canEdit || busy}
                onChange={() => toggle(r)}
              />
              <span>
                <strong>{r.label}</strong>
                {r.custom && <em className="access-custom"> custom</em>}
                {r.hint && <span className="access-hint">{r.hint}</span>}
              </span>
            </label>
          ))}
          {canEdit && roleKey && hasCustom && (
            <button
              type="button"
              className="btn ghost small"
              disabled={busy}
              onClick={async () => {
                try {
                  await saveOverrides({});
                  toast("Back to the role default");
                } catch (e) {
                  toastError(e instanceof Error ? e.message : "Could not reset");
                }
              }}
            >
              Reset to role default
            </button>
          )}
          {editable.length > 0 && !canEdit && <p className="hint">Only Admin can change access.</p>}
        </div>
      )}
    </Popover>
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
    // The send.* subdomain only sends (no MX), so replies to it bounce.
    if (/@send\./i.test(patch.mail_reply_to ?? "")) {
      toastError("Reply-to can't be a send-only address. Use support@expac.co.za.");
      return;
    }
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
          sending address stays the verified domain, only the display name
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
            Added to the bottom of every email: Inbox, campaigns, follow-ups,
            and Shipment / Quotation Comms and Replies (in place of the
            template's own typed sign-off from "Kind Regards" / "Thank you" down).
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
            Live, sends via the Resend API. Configured in Cloudflare Pages
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
          freight group has its own template, edit the wording and drop in{" "}
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
          A quick chat-style reply within an existing thread, no
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
          The customer update email sent from a quotation's Comms panel,
          same method as Shipment Comms, just with the quote's own status
          (New Lead/Quote Sent/Quote Accepted/Completed/Not Proceeding)
          instead of a shipment milestone. Each freight group has its own
          template, edit the wording and drop in{" "}
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
          A quick chat-style reply within an existing thread, no
          quotation-data block, just your message and the signature. Use
          Quotation Comms instead for a full status-update notification.
        </>
      }
      saveLabel="Save Quotation Replies"
    />
  );
}

/** Shared by Shipment Comms/Replies and Quotation Comms/Replies, generic
 *  over the entity a template renders against (a Job or a Quote), since
 *  both share the same {id, mode, reference, client?.company} shape that
 *  the mode tabs and preview picker need. `lead?.company` is optional,
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
  /** e.g. "shipment" / "quotation", used in the preview-picker copy. */
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
          <label>Email body, {SHIPMENT_MODE_LABEL[activeKey]}</label>
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
              (no {SHIPMENT_MODE_LABEL[activeKey]} {entityNoun}s yet, showing
              any)
            </option>
          )}
          {(modeEntities.length ? modeEntities : entities).map((e) => (
            <option key={e.id} value={e.id}>
              {e.reference}, {e.client?.company ?? e.lead?.company ?? "—"}
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
