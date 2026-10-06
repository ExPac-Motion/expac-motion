import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useAgents, useClients, useMyProfile, useProfiles } from "../../lib/hooks";
import { formatDateTime, normalizeWebsite } from "../../lib/format";
import { RATE_TIERS, type RateTierId } from "../../lib/types";
import { setClientRateTier } from "../../lib/db";
import {
  CUSTOMER_ROLES,
  CUSTOMER_SEGMENTS,
  NETWORK_GROUPS,
  SALUTATIONS,
  customersDb,
  useCustomer,
  useCustomerContacts,
  useCustomerMutation,
  type CustomerRecord,
} from "../../lib/customers";
import ClientActivity from "../ClientActivity";
import PortalAccessBox from "./PortalAccessBox";
import {
  AssociatedLeadsTab,
  ContactsTab,
  FilesTab,
  PartiesTab,
  SkusTab,
} from "./CustomerTabs";

type Tab =
  | "general"
  | "contacts"
  | "other"
  | "bank"
  | "documents"
  | "permits"
  | "skus"
  | "parties"
  | "leads"
  | "margins"
  | "activity";

const TABS: [Tab, string][] = [
  ["general", "General"],
  ["contacts", "Contacts"],
  ["other", "Other Details"],
  ["bank", "Bank Detail"],
  ["documents", "Documents"],
  ["permits", "Permits, Certificates & Documents"],
  ["skus", "Products & SKUs"],
  ["parties", "Consignees & Shippers"],
  ["leads", "Associated Leads"],
  ["margins", "Margins & Charges"],
  ["activity", "Quotes & Shipments"],
];

/** Fields saved by the record's Save button (the field tabs). */
const EDITABLE: (keyof CustomerRecord)[] = [
  "company", "company_phone", "client_code", "website", "fax", "customer_segment", "network_group",
  "is_also_agent", "linked_agent_id", "sales_person_id", "customer_support_id", "notes", "quote_note",
  "bill_to_name", "import_code", "parent_client_id",
  "contact_salutation", "contact_first_name", "contact_last_name", "contact", "contact_role", "email",
  "phone", "contact_mobile", "mailing_list", "additional_emails",
  "registration_no", "vat_no", "industry", "source", "description", "address", "physical_address",
  "postal_address", "city", "country", "payment_terms", "credit_limit", "billing_currency",
  "bank_name", "bank_branch", "bank_branch_code", "bank_account_name", "bank_account_no",
  "bank_account_type", "bank_swift", "margin_override_pct", "charges_note",
];

type Draft = Partial<Record<keyof CustomerRecord, string | boolean | number | null>>;

/**
 * Customers › <customer>: the full customer record as a tabbed page (laid out
 * after the user's reference screenshot), General with the primary contact
 * and Customer Portal access, and a tab per area of the customer.
 */
export default function CustomerRecordPage() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = ((params.get("tab") as Tab) || "general") as Tab;
  const setTab = (t: Tab) => setParams(t === "general" ? {} : { tab: t }, { replace: true });
  const { toast, error } = useToast();
  const customerQ = useCustomer(isNew ? undefined : id);
  const contactsQ = useCustomerContacts(isNew ? undefined : id);
  const clientsQ = useClients();
  const agentsQ = useAgents();
  const profilesQ = useProfiles();
  const meQ = useMyProfile();
  const isAdmin = meQ.data?.role === "admin";
  const staff = (profilesQ.data ?? []).filter((p) => p.role === "admin" || p.role === "user");
  const [d, setD] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);
  const [tier, setTier] = useState<RateTierId | "">("");

  useEffect(() => {
    if (customerQ.data) {
      const src = customerQ.data as unknown as Record<string, unknown>;
      setD(Object.fromEntries(EDITABLE.map((k) => [k, (src[k] as Draft[keyof Draft]) ?? null])) as Draft);
      setTier((customerQ.data.rate_tier as RateTierId) ?? "");
      setDirty(false);
    } else if (isNew) {
      setD({ mailing_list: true });
    }
  }, [customerQ.data, isNew]);

  const save = useCustomerMutation(async () => {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      const v = d[k];
      patch[k] = typeof v === "string" ? v.trim() || null : v ?? null;
    }
    patch.company = String(d.company ?? "").trim();
    patch.website = normalizeWebsite(String(d.website ?? ""));
    // "Name" follows first + last name unless typed.
    if (!patch.contact) patch.contact = [d.contact_first_name, d.contact_last_name].filter(Boolean).join(" ").trim() || null;
    for (const k of ["credit_limit", "margin_override_pct"] as const)
      patch[k] = d[k] === null || d[k] === "" || d[k] === undefined ? null : Number(d[k]);
    if (!patch.company) throw new Error("Company name is required");
    if (isNew) {
      const newId = await customersDb.create(patch as Partial<CustomerRecord>);
      if (tier) await setClientRateTier(newId, tier);
      return newId;
    }
    await customersDb.update(id, patch as Partial<CustomerRecord>);
    if (tier && tier !== customerQ.data?.rate_tier) await setClientRateTier(id, tier);
    return id;
  });

  function onSave() {
    save.mutate(undefined, {
      onSuccess: (savedId) => {
        toast("Customer saved");
        setDirty(false);
        if (isNew) navigate(`/clients/${savedId}`, { replace: true });
      },
      onError: (e) => error(e.message),
    });
  }

  const set = (k: keyof CustomerRecord, v: string | boolean | null) => {
    setD((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  const str = (k: keyof CustomerRecord) => (d[k] as string | null | undefined) ?? "";

  const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

  const contactsCount = 1 + (contactsQ.data ?? []).length;
  const otherClients = useMemo(() => (clientsQ.data ?? []).filter((c) => c.id !== id), [clientsQ.data, id]);

  if (!isNew && customerQ.isLoading) return <div className="empty">Loading customer…</div>;
  if (!isNew && !customerQ.data) return <div className="empty">Customer not found.</div>;

  const fieldTab = ["general", "other", "bank", "margins"].includes(tab);
  const panel = (title: string, children: ReactNode, right?: ReactNode) => (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );

  return (
    <FieldCtx.Provider value={{ str, set }}>
      <PageHeader
        eyebrow="Customer"
        title={isNew ? "New customer" : customerQ.data?.company || "Customer"}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate("/clients")}>
              All customers
            </button>
            {(fieldTab || isNew) && (
              <button className="btn" onClick={onSave} disabled={save.isPending || (!dirty && !isNew)}>
                {save.isPending ? "Saving…" : isNew ? "Create customer" : dirty ? "Save changes" : "Saved"}
              </button>
            )}
          </>
        }
      />

      {customerQ.data?.portal_updated_at && (
        <p className="hint" style={{ margin: "-8px 0 10px" }}>
          The customer last updated these details on the portal on {formatDateTime(customerQ.data.portal_updated_at)}.
        </p>
      )}
      <div className="cr-tabs" role="tablist">
        {TABS.filter(([t]) => !isNew || t === "general").map(([t, label]) => (
          <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <>
          {panel(
            "Company",
            <div className="cr-grid">
              <F k="company" label="Company Name" span={2} required />
              <F k="company_phone" label="Phone" />
              <F k="client_code" label="Client Code" />
              <F k="website" label="Website" />
              <F k="fax" label="Fax" />
              <S k="customer_segment" label="Customer Segment" options={opts(CUSTOMER_SEGMENTS)} />
              <S k="network_group" label="Network Group" options={opts(NETWORK_GROUPS)} />
              <label className="check cr-check" style={{ gridColumn: "1 / -1" }}>
                <input type="checkbox" checked={!!d.is_also_agent} onChange={(e) => set("is_also_agent", e.target.checked)} /> Is Also Agent ?
              </label>
              <S k="linked_agent_id" label="Linked Vendor" span={2} options={(agentsQ.data ?? []).map((a) => ({ value: a.id, label: a.company }))} />
              <S k="sales_person_id" label="Sales Person" options={staff.map((p) => ({ value: p.id, label: p.full_name ?? p.id }))} />
              <S k="customer_support_id" label="Customer Support" options={staff.map((p) => ({ value: p.id, label: p.full_name ?? p.id }))} />
              <F k="notes" label="Notes (INTERNAL)" />
              <F k="quote_note" label="Invoice / Quote Customer Note" />
              <F k="bill_to_name" label="Bill To Name (shown on invoice / quote)" />
              <F k="import_code" label="Customs Code" />
              <S k="parent_client_id" label="Main Company (Parent)" span={2} options={otherClients.map((c) => ({ value: c.id, label: c.company }))} />
            </div>,
            !isNew ? (
              <span className="cr-portal-count">
                Portal Access ({contactsCount === 1 ? "1 contact" : `${contactsCount} contacts`})
              </span>
            ) : undefined,
          )}
          {panel(
            "Primary Contact",
            <>
              <div className="cr-grid">
                <S k="contact_salutation" label="Salutation" options={opts(SALUTATIONS)} />
                <F k="contact_first_name" label="First Name" required />
                <F k="contact_last_name" label="Last Name" />
                <div />
                <F k="contact" label="Name (as shown)" span={2} />
                <S k="contact_role" label="Customer Role" span={2} options={opts(CUSTOMER_ROLES)} />
                <F k="email" label="Email" type="email" required />
                <F k="phone" label="Phone" />
                <F k="contact_mobile" label="Mobile" />
                <label className="cr-field">
                  <span>Mailing List</span>
                  <select value={d.mailing_list === false ? "no" : "yes"} onChange={(e) => set("mailing_list", e.target.value === "yes")}>
                    <option value="yes">Subscribed</option>
                    <option value="no">Not subscribed</option>
                  </select>
                </label>
                <F k="additional_emails" label="Additional Emails (comma separated)" span={4} />
              </div>
              {!isNew && customerQ.data && (
                <PortalAccessBox
                  client={customerQ.data}
                  email={str("email")}
                  name={str("contact") || [str("contact_first_name"), str("contact_last_name")].filter(Boolean).join(" ")}
                  salutation={str("contact_salutation")}
                  lastName={str("contact_last_name") || str("contact_first_name")}
                  isAdmin={isAdmin}
                />
              )}
            </>,
          )}
        </>
      )}

      {tab === "other" &&
        panel(
          "Other Details",
          <div className="cr-grid">
            <F k="registration_no" label="Company Registration No" />
            <F k="vat_no" label="VAT No" />
            <F k="industry" label="Industry" />
            <F k="source" label="Lead Source" />
            <T k="address" label="Address (on quotes & documents)" span={2} />
            <T k="physical_address" label="Physical / Delivery Address" span={2} />
            <T k="postal_address" label="Postal Address" span={2} />
            <F k="city" label="City" />
            <F k="country" label="Country" />
            <F k="payment_terms" label="Payment Terms" />
            <F k="credit_limit" label="Credit Limit (R)" type="number" />
            <S k="billing_currency" label="Billing Currency" options={opts(["ZAR", "USD", "EUR", "GBP", "CNY"])} />
            <div />
            <T k="description" label="About the customer" span={4} rows={3} />
          </div>,
        )}

      {tab === "bank" &&
        panel(
          "Bank Detail",
          <div className="cr-grid">
            <F k="bank_name" label="Bank Name" />
            <F k="bank_branch" label="Branch" />
            <F k="bank_branch_code" label="Branch Code" />
            <F k="bank_swift" label="SWIFT / BIC" />
            <F k="bank_account_name" label="Account Name" span={2} />
            <F k="bank_account_no" label="Account Number" />
            <S k="bank_account_type" label="Account Type" options={opts(["Current / Cheque", "Business Current", "Savings", "Transmission"])} />
          </div>,
        )}

      {tab === "margins" &&
        panel(
          "Margins & Charges",
          <>
            <div className="cr-grid">
              <label className="cr-field">
                <span>Rate Tier</span>
                <select
                  value={tier}
                  onChange={(e) => {
                    setTier(e.target.value as RateTierId);
                    setDirty(true);
                  }}
                >
                  <option value="">—</option>
                  {RATE_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.margin}%)
                    </option>
                  ))}
                </select>
              </label>
              <F k="margin_override_pct" label="Customer Margin Override (%)" type="number" />
              <F k="payment_terms" label="Payment Terms" />
              <F k="quote_note" label="Invoice / Quote Customer Note" />
              <T k="charges_note" label="Agreed charges / special rates (internal)" span={4} rows={4} />
            </div>
            <p className="hint">
              The Rate Tier sets the margin the Quote Builder loads for this customer (Rates &amp; Tariff › Tier margins). A margin override
              is recorded for reference, apply it on the quote's lines.
            </p>
          </>,
        )}

      {!isNew && customerQ.data && (
        <>
          {tab === "contacts" && <ContactsTab client={customerQ.data} isAdmin={isAdmin} />}
          {tab === "documents" && <FilesTab clientId={id} kind="document" />}
          {tab === "permits" && <FilesTab clientId={id} kind="permit" />}
          {tab === "skus" && <SkusTab clientId={id} />}
          {tab === "parties" && <PartiesTab clientId={id} />}
          {tab === "leads" && <AssociatedLeadsTab client={customerQ.data} />}
          {tab === "activity" && (
            <div className="panel">
              <ClientActivity clientId={id} />
            </div>
          )}
        </>
      )}
      {isNew && <p className="hint">Create the customer first, the other tabs open once it's saved.</p>}
      {!isNew && (
        <p className="hint" style={{ marginTop: 8 }}>
          <Link to={`/clients?tab=portal-access`}>All portal logins</Link>
        </p>
      )}
    </FieldCtx.Provider>
  );
}

/* Field helpers, labels inside the box, like the reference layout. Outside
   the page component so inputs keep focus while typing. */
const FieldCtx = createContext<{
  str: (k: keyof CustomerRecord) => string;
  set: (k: keyof CustomerRecord, v: string | boolean | null) => void;
}>({ str: () => "", set: () => {} });

function F({ k, label, span, type, required }: { k: keyof CustomerRecord; label: string; span?: number; type?: string; required?: boolean }) {
  const { str, set } = useContext(FieldCtx);
  return (
    <label className="cr-field" style={span ? { gridColumn: "span " + span } : undefined}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input type={type ?? "text"} value={str(k)} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
}
function S({ k, label, options, span }: { k: keyof CustomerRecord; label: string; options: { value: string; label: string }[]; span?: number }) {
  const { str, set } = useContext(FieldCtx);
  return (
    <label className="cr-field" style={span ? { gridColumn: "span " + span } : undefined}>
      <span>{label}</span>
      <select value={str(k)} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function T({ k, label, span, rows }: { k: keyof CustomerRecord; label: string; span?: number; rows?: number }) {
  const { str, set } = useContext(FieldCtx);
  return (
    <label className="cr-field" style={span ? { gridColumn: "span " + span } : undefined}>
      <span>{label}</span>
      <textarea rows={rows ?? 2} value={str(k)} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
}
