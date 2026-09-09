import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Modal from "../components/Modal";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  MailLink,
  PageHeader,
  RowActions,
  RowActionsHead,
  SearchInput,
  useRowSelection,
  type BulkField,
} from "../components/common";
import { useToast } from "../components/Toast";
import DataTable, { type DataColumn } from "../components/DataTable";
import {
  useCreateClientInvite,
  useProfiles,
  useReplaceClientContacts,
} from "../lib/hooks";
import { listClientContacts } from "../lib/db";
import { normalizeWebsite } from "../lib/format";
import { PORTAL_SIGNUP_ENABLED } from "../lib/flags";
import ClientActivity from "./ClientActivity";
import type { Contact, LeadContactDraft } from "../lib/types";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

type ContactValues = Omit<Contact, "id" | "created_at">;

type Kind = "client" | "supplier" | "agent" | "transporter" | "clearing_agent";

const COPY: Record<Kind, { label: string; title: string; eyebrow: string }> = {
  client: {
    label: "customer",
    title: "Customers",
    eyebrow: "Company & contact records",
  },
  supplier: {
    label: "shipper",
    title: "Shippers",
    eyebrow: "Vendor & carrier records",
  },
  agent: {
    label: "agent",
    title: "Agents",
    eyebrow: "Forwarding agents",
  },
  transporter: {
    label: "transporter",
    title: "Transporters",
    eyebrow: "Road & rail carriers",
  },
  clearing_agent: {
    label: "clearing agent",
    title: "Clearing Agents",
    eyebrow: "Customs clearing agents",
  },
};

/** Title-case every word: "clearing agent" -> "Clearing Agent". */
const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

interface Props {
  kind: Kind;
  query: UseQueryResult<Contact[]>;
  save: UseMutationResult<Contact, Error, { id?: string; values: ContactValues }>;
  remove: UseMutationResult<void, Error, string>;
  bulkUpdate: UseMutationResult<
    void,
    Error,
    { ids: string[]; patch: Partial<ContactValues> }
  >;
}

export default function ContactsPage({
  kind,
  query,
  save,
  remove,
  bulkUpdate,
}: Props) {
  const { label, title, eyebrow } = COPY[kind];
  const Label = titleCase(label);
  const isClient = kind === "client";
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [viewing, setViewing] = useState<Contact | null>(null);
  const createInvite = useCreateClientInvite();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  // Customer-only: salespeople for the owner dropdown + the editable list of
  // extra contacts at the company (mirrors the Lead edit form).
  const profilesQ = useProfiles();
  const salesPeople = profilesQ.data ?? [];
  const replaceClientContacts = useReplaceClientContacts();
  const [extraContacts, setExtraContacts] = useState<LeadContactDraft[]>([]);

  const editingClientId =
    isClient && editing && editing !== "new" ? editing.id : null;
  useEffect(() => {
    if (!isClient) return;
    let alive = true;
    const p = editingClientId
      ? listClientContacts(editingClientId)
      : Promise.resolve([]);
    p.then((cs) => {
      if (!alive) return;
      setExtraContacts(
        cs.map((c) => ({
          name: c.name,
          role: c.role ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
        })),
      );
    });
    return () => {
      alive = false;
    };
  }, [isClient, editingClientId, editing]);

  function updateExtraContact(i: number, patch: Partial<LeadContactDraft>) {
    setExtraContacts((prev) =>
      prev.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    );
  }

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.company, r.contact, r.email, r.phone, r.vat_no, r.import_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // Rows mirrored from the other contact book are read-only here — not selectable.
  const selectable = useMemo(
    () =>
      filtered.filter(
        (r) =>
          !(
            (kind === "agent" && r.source_clearing_agent_id) ||
            (kind === "clearing_agent" && r.source_agent_id)
          ),
      ),
    [filtered, kind],
  );
  const sel = useRowSelection(selectable);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: ContactValues = {
      company: String(fd.get("company") || "").trim(),
      contact: String(fd.get("contact") || "").trim() || null,
      email: String(fd.get("email") || "").trim() || null,
      phone: String(fd.get("phone") || "").trim() || null,
    };
    values.vat_no = String(fd.get("vat_no") || "").trim() || null;
    values.import_code = String(fd.get("import_code") || "").trim() || null;
    values.address = String(fd.get("address") || "").trim() || null;
    if (isClient) {
      values.company_phone =
        String(fd.get("company_phone") || "").trim() || null;
      values.website = normalizeWebsite(String(fd.get("website") || ""));
      values.source = String(fd.get("source") || "").trim() || null;
      values.description = String(fd.get("description") || "").trim() || null;
      values.notes = String(fd.get("notes") || "").trim() || null;
      values.sales_person_id = String(fd.get("sales_person_id") || "") || null;
    }
    if (kind === "agent") {
      values.also_clearing_agent = fd.get("also_clearing_agent") === "on";
    }
    if (kind === "clearing_agent") {
      values.also_agent = fd.get("also_agent") === "on";
    }
    if (!values.company) {
      error("Company name is required");
      return;
    }
    try {
      const saved = await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        values,
      });
      if (isClient) {
        await replaceClientContacts.mutateAsync({
          clientId: saved.id,
          contacts: extraContacts,
        });
      }
      setEditing(null);
      toast("Saved");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(row: Contact) {
    if (!window.confirm(`Remove ${row.company}?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast(`${Label} removed`);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  async function onDuplicate(row: Contact) {
    const values: ContactValues = {
      company: `${row.company} (Copy)`,
      contact: row.contact,
      email: row.email,
      phone: row.phone,
      vat_no: row.vat_no ?? null,
      import_code: row.import_code ?? null,
      address: row.address ?? null,
    };
    if (isClient) {
      values.company_phone = row.company_phone ?? null;
      values.website = row.website ?? null;
      values.source = row.source ?? null;
      values.description = row.description ?? null;
      values.notes = row.notes ?? null;
      values.sales_person_id = row.sales_person_id ?? null;
    }
    if (kind === "agent") values.also_clearing_agent = Boolean(row.also_clearing_agent);
    if (kind === "clearing_agent") values.also_agent = Boolean(row.also_agent);
    try {
      const created = await save.mutateAsync({ values });
      toast(`${Label} duplicated`);
      setEditing(created);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not duplicate");
    }
  }

  async function onInvite(row: Contact) {
    try {
      const invite = await createInvite.mutateAsync(row.id);
      const link = `${window.location.origin}/portal/signup?token=${invite.token}`;
      setInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied to clipboard");
      } catch {
        toast("Invite link created");
      }
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not create invite");
    }
  }

  const current = editing === "new" ? null : editing;

  // A mirror row: managed from the other contact book, read-only here.
  function mirrorOf(r: Contact): Kind | null {
    if (kind === "agent" && r.source_clearing_agent_id) return "clearing_agent";
    if (kind === "clearing_agent" && r.source_agent_id) return "agent";
    return null;
  }

  const columns = useMemo<DataColumn<Contact>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 150,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (r) => {
          const mirror = mirrorOf(r);
          return mirror ? (
            <div className="row-icons">
              <input type="checkbox" onClick={(e) => e.stopPropagation()} />
              <span className="muted small">Synced from {COPY[mirror].title}</span>
            </div>
          ) : (
            <RowActions
              selected={sel.isSelected(r.id)}
              onSelectToggle={() => sel.toggle(r.id)}
              onView={() => setViewing(r)}
              onEdit={() => setEditing(r)}
              onDelete={() => onDelete(r)}
              onDuplicate={() => onDuplicate(r)}
            />
          );
        },
      },
      {
        key: "company",
        header: "Company",
        width: 240,
        sortValue: (r) => r.company.toLowerCase(),
        render: (r) => (
          <>
            <strong className="row-name">{r.company}</strong>
            {r.also_clearing_agent && (
              <span className="tag">also clearing agent</span>
            )}
            {r.also_agent && <span className="tag">also agent</span>}
          </>
        ),
      },
      {
        key: "contact",
        header: "Contact",
        width: 160,
        sortValue: (r) => (r.contact ?? "").toLowerCase(),
        render: (r) => r.contact || "—",
      },
      {
        key: "email",
        header: "Email",
        width: 250,
        sortValue: (r) => (r.email ?? "").toLowerCase(),
        render: (r) =>
          r.email ? (
            <span className="email-cell">
              {r.email}
              <MailLink email={r.email} />
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "phone",
        header: "Phone",
        width: 150,
        sortValue: (r) => r.phone ?? "",
        render: (r) => r.phone || "—",
      },
      {
        key: "vat_no",
        header: `${Label} VAT No`,
        label: "VAT No",
        width: 140,
        sortValue: (r) => r.vat_no ?? "",
        render: (r) => r.vat_no || "—",
      },
      {
        key: "import_code",
        header: `${Label} Import Code`,
        label: "Import Code",
        width: 150,
        sortValue: (r) => r.import_code ?? "",
        render: (r) => r.import_code || "—",
      },
      {
        key: "address",
        header: "Address",
        width: 280,
        sortValue: (r) => r.address ?? "",
        render: (r) => r.address || "—",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, kind, Label],
  );

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        actions={
          <>
            <button
              className="btn outline"
              onClick={() => setBulkOpen(true)}
              disabled={sel.count === 0}
              title={
                sel.count === 0
                  ? "Tick rows in the Actions column to bulk edit"
                  : undefined
              }
            >
              Bulk Edit{sel.count ? ` (${sel.count})` : ""}
            </button>
            <button className="btn" onClick={() => setEditing("new")}>
              + Add {label}
            </button>
          </>
        }
      />

      <div className="panel">
        {rows.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${label} or contact…`}
            />
          </div>
        )}
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNote error={query.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No {label}s yet. Add your first one to start quoting.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>No {label}s match "{search}".</EmptyState>
        ) : (
          <DataTable
            tableKey={`contacts-${kind}`}
            className="table--compact"
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
          />
        )}
      </div>

      {viewing && (
        <Modal
          title={viewing.company}
          onClose={() => {
            setViewing(null);
            setInviteLink(null);
          }}
          wide={kind === "client"}
          stickyHeader={kind === "client"}
          headerActions={
            <>
              {kind === "client" && PORTAL_SIGNUP_ENABLED && (
                <button
                  className="btn outline"
                  onClick={() => onInvite(viewing)}
                  disabled={createInvite.isPending}
                >
                  {createInvite.isPending ? "Creating…" : "Invite to Portal"}
                </button>
              )}
              <button
                className="btn outline"
                onClick={() => {
                  setEditing(viewing);
                  setViewing(null);
                }}
              >
                Edit
              </button>
            </>
          }
        >
          {inviteLink && (
            <div
              className="hint"
              style={{
                marginBottom: 14,
                padding: 10,
                background: "#f5f4ef",
                borderRadius: 8,
                wordBreak: "break-all",
              }}
            >
              Share this link with the customer (copied to clipboard): {inviteLink}
            </div>
          )}
          <div className="grid2">
            <ViewField label="Contact person" value={viewing.contact || "—"} />
            <ViewField
              label={isClient ? "Mobile phone" : "Phone"}
              value={viewing.phone || "—"}
            />
            <ViewField label="Email" value={viewing.email || "—"} />
            {isClient && (
              <ViewField
                label="Company phone"
                value={viewing.company_phone || "—"}
              />
            )}
            {isClient && (
              <ViewField label="Website">
                {viewing.website ? (
                  <a href={viewing.website} target="_blank" rel="noreferrer">
                    {viewing.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  "—"
                )}
              </ViewField>
            )}
            {isClient && (
              <ViewField label="Source" value={viewing.source || "—"} />
            )}
            <ViewField label={`${Label} VAT No`} value={viewing.vat_no || "—"} />
            <ViewField
              label={`${Label} Import Code`}
              value={viewing.import_code || "—"}
            />
            {isClient && (
              <ViewField
                label="Sales Person"
                value={viewing.sales_person?.full_name || "—"}
              />
            )}
          </div>
          {isClient && (
            <ViewField label="Description" value={viewing.description || "—"} />
          )}
          <ViewField label="Address" value={viewing.address || "—"} />
          {isClient && (
            <ViewField label="Notes" value={viewing.notes || "—"} />
          )}
          {kind === "client" && <ClientActivity clientId={viewing.id} />}
        </Modal>
      )}

      {editing !== null && (
        <Modal
          title={current ? `Edit ${label}` : `Add ${label}`}
          onClose={() => setEditing(null)}
          wide={isClient}
        >
          <form onSubmit={onSubmit}>
            {isClient ? (
              <div className="grid2">
                <div className="field">
                  <label>Company name</label>
                  <input
                    name="company"
                    defaultValue={current?.company ?? ""}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Company website</label>
                  <input
                    name="website"
                    type="text"
                    inputMode="url"
                    placeholder="www.acme.co.za"
                    defaultValue={current?.website ?? ""}
                  />
                </div>
              </div>
            ) : (
              <div className="field">
                <label>Company name</label>
                <input
                  name="company"
                  defaultValue={current?.company ?? ""}
                  autoFocus
                />
              </div>
            )}
            {isClient && (
              <div className="grid2">
                <div className="field">
                  <label>Source</label>
                  <input
                    name="source"
                    placeholder="Referral, website, trade show…"
                    defaultValue={current?.source ?? ""}
                  />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input
                    name="description"
                    placeholder="Short summary of the customer"
                    defaultValue={current?.description ?? ""}
                  />
                </div>
              </div>
            )}
            {isClient ? (
              <div className="grid2">
                <div className="field">
                  <label>Primary contact</label>
                  <input name="contact" defaultValue={current?.contact ?? ""} />
                </div>
                <div className="field">
                  <label>Company phone</label>
                  <input
                    name="company_phone"
                    placeholder="Switchboard / landline"
                    defaultValue={current?.company_phone ?? ""}
                  />
                </div>
              </div>
            ) : (
              <div className="field">
                <label>Contact person</label>
                <input name="contact" defaultValue={current?.contact ?? ""} />
              </div>
            )}
            <div className="grid2">
              <div className="field">
                <label>Email</label>
                <input name="email" type="email" defaultValue={current?.email ?? ""} />
              </div>
              <div className="field">
                <label>{isClient ? "Mobile phone" : "Phone"}</label>
                <input name="phone" defaultValue={current?.phone ?? ""} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>{Label} VAT No</label>
                <input name="vat_no" defaultValue={current?.vat_no ?? ""} />
              </div>
              <div className="field">
                <label>{Label} Import Code</label>
                <input
                  name="import_code"
                  defaultValue={current?.import_code ?? ""}
                />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <textarea
                name="address"
                rows={2}
                defaultValue={current?.address ?? ""}
              />
            </div>
            {isClient && (
              <>
                <div className="field">
                  <label>Additional contacts at this company</label>
                  {extraContacts.map((c, i) => (
                    <div
                      key={i}
                      className="grid2"
                      style={{ gap: 8, marginBottom: 6, alignItems: "start" }}
                    >
                      <input
                        placeholder="Name"
                        value={c.name}
                        onChange={(e) =>
                          updateExtraContact(i, { name: e.target.value })
                        }
                      />
                      <input
                        placeholder="Role / title"
                        value={c.role}
                        onChange={(e) =>
                          updateExtraContact(i, { role: e.target.value })
                        }
                      />
                      <input
                        placeholder="Email"
                        value={c.email}
                        onChange={(e) =>
                          updateExtraContact(i, { email: e.target.value })
                        }
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          placeholder="Phone"
                          value={c.phone}
                          onChange={(e) =>
                            updateExtraContact(i, { phone: e.target.value })
                          }
                        />
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() =>
                            setExtraContacts((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn outline btn-sm"
                    onClick={() =>
                      setExtraContacts((prev) => [
                        ...prev,
                        { name: "", role: "", email: "", phone: "" },
                      ])
                    }
                  >
                    + Add contact
                  </button>
                </div>
                <div className="field">
                  <label>Sales Person</label>
                  <select
                    name="sales_person_id"
                    defaultValue={current?.sales_person_id ?? ""}
                  >
                    <option value="">— unassigned —</option>
                    {salesPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || "—"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <textarea
                    name="notes"
                    rows={3}
                    defaultValue={current?.notes ?? ""}
                  />
                </div>
              </>
            )}
            {kind === "agent" && (
              <label className="check">
                <input
                  type="checkbox"
                  name="also_clearing_agent"
                  defaultChecked={Boolean(current?.also_clearing_agent)}
                />
                Is also Clearing Agent
              </label>
            )}
            {kind === "clearing_agent" && (
              <label className="check">
                <input
                  type="checkbox"
                  name="also_agent"
                  defaultChecked={Boolean(current?.also_agent)}
                />
                Is also Agent
              </label>
            )}
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
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} ${
            sel.count === 1 ? label : `${label}s`
          }`}
          count={sel.count}
          noun={label}
          busy={bulkUpdate.isPending}
          fields={((): BulkField[] => {
            const f: BulkField[] = [
              { key: "vat_no", label: `${Label} VAT No`, type: "text" },
              {
                key: "import_code",
                label: `${Label} Import Code`,
                type: "text",
              },
              { key: "address", label: "Address", type: "textarea" },
            ];
            if (kind === "agent")
              f.push({
                key: "also_clearing_agent",
                label: "Is also Clearing Agent",
                type: "toggle",
              });
            if (kind === "clearing_agent")
              f.push({
                key: "also_agent",
                label: "Is also Agent",
                type: "toggle",
              });
            return f;
          })()}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as Partial<ContactValues>,
              });
              toast(`Updated ${n} ${n === 1 ? label : `${label}s`}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e2) {
              error(e2 instanceof Error ? e2.message : "Could not update");
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}

function ViewField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{children ?? value}</strong>
    </div>
  );
}
