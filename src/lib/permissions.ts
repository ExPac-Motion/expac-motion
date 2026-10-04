// Roles & permissions (migration 0131). Admin User has everything; Standard
// User and Partner Portal User get each switch from Settings > Roles &
// Permissions (company_settings.role_permissions), overridable per login on
// Settings > Team (profiles.permissions). Customer Portal logins keep their
// own portal_permissions — the role settings are the defaults for new ones.

export type StaffPerm = "rates" | "settings" | "crm" | "delete";
export type PartnerPerm = "delete_sheets" | "edit_coverage" | "see_history";
export type PermKey = StaffPerm | PartnerPerm;
export type ClientPerm = "shipments" | "quotes" | "invoices" | "suppliers" | "rates" | "messaging";

export interface PermDef<K extends string> {
  key: K;
  label: string;
  hint: string;
}

export const STAFF_PERMS: PermDef<StaffPerm>[] = [
  {
    key: "rates",
    label: "Rates and buy prices",
    hint: "Rates & Tariff, partner rate sheets, Load rates / From Rates on quotes",
  },
  { key: "settings", label: "Settings", hint: "Company details, quote defaults, email and comms templates" },
  { key: "crm", label: "Sales CRM / financials", hint: "Sales dashboard, Trends, targets, Financial Snapshot" },
  {
    key: "delete",
    label: "Delete records",
    hint: "Quotes, shipments, customers, partners, leads, tasks and lists — locked in the database",
  },
];

export const PARTNER_PERMS: PermDef<PartnerPerm>[] = [
  { key: "delete_sheets", label: "Delete own rate sheets", hint: "Otherwise they add and edit only" },
  { key: "edit_coverage", label: "Edit own coverage", hint: "Modes, countries, ports / airports, notes" },
  { key: "see_history", label: "See own history", hint: "Each rate sheet's change history" },
];

export const CLIENT_PERMS: PermDef<ClientPerm>[] = [
  { key: "shipments", label: "Shipments", hint: "" },
  { key: "quotes", label: "Quotes", hint: "" },
  { key: "invoices", label: "Invoices", hint: "" },
  { key: "suppliers", label: "Suppliers", hint: "" },
  { key: "rates", label: "Tariff sheet", hint: "" },
  { key: "messaging", label: "Messaging", hint: "" },
];

export interface RolePermissions {
  user: Record<StaffPerm, boolean>;
  partner: Record<PartnerPerm, boolean>;
  client: Record<ClientPerm, boolean>;
}

/** Built-in defaults — same as the database's (0131). */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  // Delete is admin-only unless switched on (0132 locks it in the database).
  user: { rates: false, settings: true, crm: true, delete: false },
  partner: { delete_sheets: false, edit_coverage: false, see_history: false },
  client: { shipments: true, quotes: true, invoices: true, suppliers: true, rates: true, messaging: true },
};

/** One line of a login's access summary (Settings > Team). */
export interface AccessItem {
  label: string;
  on: boolean;
}

/** Everything a login can (and can't) do, for Settings > Team. */
export function accessSummary(
  p: {
    role: string;
    partner_id?: string | null;
    client_id?: string | null;
    permissions?: Partial<Record<PermKey, boolean>> | null;
    portal_permissions?: Partial<Record<ClientPerm, boolean>> | null;
  },
  stored: Partial<RolePermissions> | null | undefined,
): AccessItem[] {
  const roles = rolePermissions(stored);
  const eff = <K extends PermKey>(role: "user" | "partner", key: K) =>
    p.permissions?.[key] ?? (roles[role] as Record<string, boolean>)[key] ?? false;
  if (p.role === "admin")
    return [
      { label: "Motion (quotes, shipments, customers, partners, control tower)", on: true },
      ...STAFF_PERMS.map((d) => ({ label: d.label, on: true })),
      { label: "Team roles, permissions and partner logins", on: true },
    ];
  if (p.role === "user")
    return [
      { label: "Motion (quotes, shipments, customers, partners, control tower)", on: true },
      ...STAFF_PERMS.map((d) => ({ label: d.label, on: eff("user", d.key) })),
      { label: "Team roles, permissions and partner logins", on: false },
    ];
  if (p.role === "partner" && p.partner_id)
    return [
      { label: "Own rate sheets (add / edit)", on: true },
      ...PARTNER_PERMS.map((d) => ({ label: d.label, on: eff("partner", d.key) })),
    ];
  if (p.role === "client")
    return CLIENT_PERMS.map((d) => ({ label: d.label, on: p.portal_permissions?.[d.key] !== false }));
  return [{ label: "No access (switched off)", on: false }];
}

export function rolePermissions(stored: Partial<RolePermissions> | null | undefined): RolePermissions {
  return {
    user: { ...DEFAULT_ROLE_PERMISSIONS.user, ...(stored?.user ?? {}) },
    partner: { ...DEFAULT_ROLE_PERMISSIONS.partner, ...(stored?.partner ?? {}) },
    client: { ...DEFAULT_ROLE_PERMISSIONS.client, ...(stored?.client ?? {}) },
  };
}
