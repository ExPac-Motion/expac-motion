import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Modal from "../components/Modal";
import MailHistory from "../components/MailHistory";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  MailLink,
  PageHeader,
  PageTools,
  RowActions,
  RowActionsHead,
  SearchInput,
  useRowSelection,
  type BulkField,
} from "../components/common";
import { useToast } from "../components/Toast";
import DataTable, { type DataColumn } from "../components/DataTable";
import {
  useLeadSources,
  useClients,
  useMyProfile,
  useCan,
  useOpsTasks,
  usePartnerRateStructures,
  useProfiles,
  useReplaceClientContacts,
} from "../lib/hooks";
import { listClientContacts, setClientRateTier } from "../lib/db";
import { normalizeWebsite } from "../lib/format";
import TaskEditModal from "./ops/TaskEditModal";
import { RecordTasks } from "./shipments/ShipmentWorkspacePage";
import {
  DEFAULT_RATE_TIER,
  RATE_TIERS,
  rateTier,
  type Contact,
  type LeadContactDraft,
  type OpsTask,
  type PartnerKind,
  type RateTierId,
} from "../lib/types";
import {
  ChipRow,
  CoverageEditor,
  CoverageView,
  coverageOf,
  type Coverage,
} from "./partners/PartnerCoverage";
import RateStructures from "./partners/RateStructures";
import PartnerRateSheets from "./partners/PartnerRateSheets";
import PartnerMailModal from "./partners/PartnerMailModal";
import PartnerLoginAccess from "./partners/PartnerLoginAccess";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

type ContactValues = Omit<Contact, "id" | "created_at">;

type Kind =
  | "client"
  | "supplier"
  | "agent"
  | "transporter"
  | "clearing_agent"
  | "destination_agent";

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
  destination_agent: {
    label: "destination agent",
    title: "Destination Agents",
    eyebrow: "Destination handling agents",
  },
};

/** List route per contact book; a record opens at <route>/<id>. */
const ROUTE: Record<Kind, string> = {
  client: "clients",
  supplier: "suppliers",
  agent: "agents",
  transporter: "transporters",
  clearing_agent: "clearing-agents",
  destination_agent: "destination-agents",
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
  const navigate = useNavigate();
  const location = useLocation();
  const { id: recordId } = useParams();
  const { label, title, eyebrow } = COPY[kind];
  const Label = titleCase(label);
  const isClient = kind === "client";
  const isAdmin = useMyProfile().data?.role === "admin";
  // Partner rate sheets need "rates" (0131); partner logins stay admin-only.
  const canRates = useCan()("rates");
  // Agents / transporters / clearing agents carry coverage (modes, countries,
  // ports) and rate structures.
  const isPartner =
    kind === "agent" ||
    kind === "transporter" ||
    kind === "clearing_agent" ||
    kind === "destination_agent";
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [taskingRow, setTaskingRow] = useState<Contact | null>(null);
  const tasksQ = useOpsTasks();
  // Contacts with an open (not done) task linked, the row task icon is filled.
  const openTaskIds = useMemo(() => {
    const linkOf = (t: OpsTask) =>
      kind === "client" ? t.client_id
      : kind === "supplier" ? t.supplier_id
      : kind === "agent" ? t.agent_id
      : kind === "transporter" ? t.transporter_id
      : kind === "clearing_agent" ? t.clearing_agent_id
      : null;
    return new Set(
      (tasksQ.data ?? [])
        .filter((t) => t.kind === "task" && t.status !== "done")
        .map(linkOf)
        .filter((id): id is string => !!id),
    );
  }, [tasksQ.data, kind]);
  const [mailingRow, setMailingRow] = useState<Contact | null>(null);
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  // Slot in the header row (beside "+ Add ...") that DataTable portals its
  // Save Grid / Reset columns / Table settings controls into, keeps the
  // search-bar row free so the table starts right after it.
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  // Customer-only: salespeople for the owner dropdown + the editable list of
  // extra contacts at the company (mirrors the Lead edit form).
  const profilesQ = useProfiles();
  const salesPeople = (profilesQ.data ?? []).filter(
    (p) => p.role === "admin" || p.role === "user",
  );
  const sourcesQ = useLeadSources();
  const clientsQ = useClients();
  const clientName = useMemo(() => new Map((clientsQ.data ?? []).map((c) => [c.id, c.company])), [clientsQ.data]);
  const sources = sourcesQ.data ?? [];
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

  // Partner coverage being edited in the form (controlled, not FormData).
  const [coverage, setCoverage] = useState<Coverage>(coverageOf(null));
  useEffect(() => {
    if (editing !== null) setCoverage(coverageOf(editing === "new" ? null : editing));
  }, [editing]);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  // The open record as the list has it now (a saved rate sheet adds ports /
  // countries to a partner's coverage).

  // Deep-link from a Notification: navigate here with
  // { state: { openContactId } } to pop the existing view modal open on a
  // specific record, same as clicking its row. Closing it then returns to
  // Notifications instead of stranding the user here.
  useEffect(() => {
    const openId = (location.state as { openContactId?: string } | null)
      ?.openContactId;
    if (!openId || rows.length === 0) return;
    const row = rows.find((r) => r.id === openId);
    if (row && isClient) {
      navigate("/clients/" + row.id);
      return;
    }
    // Old links (openContactId) open the record page now.
    if (row) navigate(`/${ROUTE[kind]}/${row.id}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.company,
        r.contact,
        r.email,
        r.phone,
        r.vat_no,
        r.import_code,
        ...(r.modes ?? []),
        ...(r.countries ?? []),
        ...(r.ports ?? []),
        r.coverage_notes,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // Rows mirrored from the other contact book are read-only here, not selectable.
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
    if (isPartner) {
      values.modes = coverage.modes;
      values.countries = coverage.countries;
      values.ports = coverage.ports;
      values.coverage_notes = coverage.coverage_notes.trim() || null;
    }
    if (kind === "agent") {
      values.also_clearing_agent = fd.get("also_clearing_agent") === "on";
    }
    if (kind === "clearing_agent") {
      values.also_agent = fd.get("also_agent") === "on";
    }
    if (kind === "client") {
      values.also_shipper = fd.get("also_shipper") === "on";
    }
    if (kind === "supplier") {
      values.also_customer = fd.get("also_customer") === "on";
      // Every shipper belongs to a customer (0142).
      values.client_id = String(fd.get("client_id") || "") || null;
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
        await setClientRateTier(
          saved.id,
          (String(fd.get("rate_tier") || "") || DEFAULT_RATE_TIER) as RateTierId,
        );
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
    if (isPartner) {
      values.modes = row.modes ?? [];
      values.countries = row.countries ?? [];
      values.ports = row.ports ?? [];
      values.coverage_notes = row.coverage_notes ?? null;
    }
    if (kind === "agent") values.also_clearing_agent = Boolean(row.also_clearing_agent);
    if (kind === "clearing_agent") values.also_agent = Boolean(row.also_agent);
    if (kind === "client") values.also_shipper = Boolean(row.also_shipper);
    if (kind === "supplier") values.also_customer = Boolean(row.also_customer);
    try {
      const created = await save.mutateAsync({ values });
      toast(`${Label} duplicated`);
      setEditing(created);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not duplicate");
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
        // Partner lists carry a mail icon too (7 icons), keep them clear of Company.
        width: isPartner ? 250 : 200,
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
              onMail={isPartner ? () => setMailingRow(r) : undefined}
              mailTitle={`Email this ${label}`}
              onTask={kind === "destination_agent" ? undefined : () => setTaskingRow(r)}
              taskTitle={`Create a task for this ${label}`}
              taskOpen={openTaskIds.has(r.id)}
              taskOpenAmber
              onView={() => navigate(`/${ROUTE[kind]}/${r.id}`)}
              viewTitle={`Open this ${label}`}
              onEdit={() => navigate(`/${ROUTE[kind]}/${r.id}`)}
              editTitle={`Open this ${label} to edit it`}
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
            {r.also_shipper && <span className="tag">also shipper</span>}
            {r.also_customer && <span className="tag">also customer</span>}
          </>
        ),
      },
      ...(kind === "supplier"
        ? [
            {
              key: "customer",
              header: "Customer",
              width: 200,
              sortValue: (r: Contact) => clientName.get(r.client_id ?? "") ?? "",
              render: (r: Contact) => clientName.get(r.client_id ?? "") ?? <span className="muted small">not linked</span>,
            },
          ]
        : []),
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
      ...(kind === "client"
        ? ([
            {
              key: "rate_tier",
              header: "Rate Tier",
              width: 110,
              sortValue: (r) => RATE_TIERS.findIndex((t) => t.id === rateTier(r.rate_tier).id),
              render: (r) => rateTier(r.rate_tier).label,
            },
          ] as DataColumn<Contact>[])
        : []),
      ...(isPartner
        ? ([
            {
              key: "modes",
              header: "Services / Modes",
              width: 220,
              sortValue: (r) => (r.modes ?? []).join(", "),
              render: (r) => <ChipRow items={r.modes ?? []} />,
            },
            {
              key: "countries",
              header: "Countries",
              width: 200,
              sortValue: (r) => (r.countries ?? []).join(", "),
              render: (r) => <ChipRow items={r.countries ?? []} />,
            },
            {
              key: "ports",
              header: "Ports / Airports",
              width: 200,
              sortValue: (r) => (r.ports ?? []).join(", "),
              render: (r) => <ChipRow items={r.ports ?? []} />,
            },
          ] as DataColumn<Contact>[])
        : []),
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
    [sel, kind, Label, clientName, openTaskIds],
  );

  if (recordId && !isClient) {
    const record = rows.find((r) => r.id === recordId) ?? null;
    if (query.isLoading) return <Loading />;
    if (!record) return <ErrorNote error={new Error(`${Label} not found`)} />;
    return (
      <ContactRecord
        kind={kind}
        record={record}
        save={save}
        isPartner={isPartner}
        canRates={canRates}
        isAdmin={isAdmin}
        clients={clientsQ.data ?? []}
        tasks={(tasksQ.data ?? []).filter((t) => t.kind === "task")}
      />
    );
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <PageTools
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${label} or contact…`}
          />
        }
        count={
          query.isLoading
            ? undefined
            : `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ""} ${label}${rows.length === 1 ? "" : "s"}`
        }
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => (isClient ? navigate("/clients/new") : setEditing("new"))}>
            + Add {label}
          </button>
        }
      >
        <button
          className="btn outline bulk"
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
      </PageTools>

      <div className="panel">
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
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={isClient ? (r) => navigate("/clients/" + r.id) : undefined}
          />
        )}
      </div>

      {editing !== null && (
        <Modal
          title={current ? `Edit ${label}` : `Add ${label}`}
          onClose={() => setEditing(null)}
          wide={isClient || isPartner}
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
                  <select name="source" defaultValue={current?.source ?? ""}>
                    <option value="">—</option>
                    {(current?.source &&
                    !sources.some((s) => s.name === current.source)
                      ? [
                          {
                            id: current.source,
                            name: current.source,
                            sort_order: -1,
                            created_at: "",
                          },
                          ...sources,
                        ]
                      : sources
                    ).map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
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
            {kind === "supplier" && (
              <div className="field">
                <label>Customer (whose shipper this is)</label>
                <select name="client_id" defaultValue={current?.client_id ?? ""}>
                  <option value="">— not linked yet —</option>
                  {(clientsQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company}
                    </option>
                  ))}
                </select>
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
                  <label>Rate Tier</label>
                  <select
                    name="rate_tier"
                    defaultValue={current?.rate_tier ?? DEFAULT_RATE_TIER}
                  >
                    {RATE_TIERS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.margin}%), {t.note}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Picks the tier rate sheet on this customer's quotes.
                  </span>
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
            {isPartner && (
              <CoverageEditor value={coverage} onChange={setCoverage} />
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
            {kind === "client" && (
              <label className="check">
                <input
                  type="checkbox"
                  name="also_shipper"
                  defaultChecked={Boolean(current?.also_shipper)}
                />
                Is also Shipper/Exporter
              </label>
            )}
            {kind === "supplier" && (
              <label className="check">
                <input
                  type="checkbox"
                  name="also_customer"
                  defaultChecked={Boolean(current?.also_customer)}
                />
                Is also Customer/Importer
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
            if (kind === "client")
              f.push({
                key: "rate_tier",
                label: "Rate Tier",
                type: "select",
                allowClear: false,
                options: RATE_TIERS.map((t) => ({
                  value: t.id,
                  label: `${t.label} (${t.margin}%)`,
                })),
              });
            if (kind === "client")
              f.push({
                key: "also_shipper",
                label: "Is also Shipper/Exporter",
                type: "toggle",
              });
            if (kind === "supplier")
              f.push({
                key: "also_customer",
                label: "Is also Customer/Importer",
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

      {mailingRow && isPartner && (
        <PartnerMailModal
          key={mailingRow.id}
          kind={kind as PartnerKind}
          partner={mailingRow}
          onClose={() => setMailingRow(null)}
        />
      )}

      {taskingRow && (
        <TaskEditModal
          key={taskingRow.id}
          task={null}
          defaults={{
            ...(kind === "client" ? { client_id: taskingRow.id } : {}),
            ...(kind === "supplier" ? { supplier_id: taskingRow.id } : {}),
            ...(kind === "agent" ? { agent_id: taskingRow.id } : {}),
            ...(kind === "transporter" ? { transporter_id: taskingRow.id } : {}),
            ...(kind === "clearing_agent" ? { clearing_agent_id: taskingRow.id } : {}),
            title: `Follow up: ${taskingRow.company}`,
          }}
          onClose={() => setTaskingRow(null)}
        />
      )}
    </>
  );
}

/** Old-format rate structures (0114), shown under the code-based rate
 *  sheets only while a partner still has any, read and copy across. */
function LegacyRateStructures({
  kind,
  partnerId,
  partnerName,
}: {
  kind: PartnerKind;
  partnerId: string;
  partnerName: string;
}) {
  const q = usePartnerRateStructures(kind, partnerId);
  if (!q.data?.length) return null;
  return (
    <details className="rs-wrap">
      <summary className="hint">
        Earlier rate structures (old format, {q.data.length}), copy these into a rate sheet above
      </summary>
      <RateStructures kind={kind} partnerId={partnerId} partnerName={partnerName} />
    </details>
  );
}

type ContactPatch = Partial<ContactValues>;

/**
 * Record page for a shipper, agent, transporter, clearing or destination
 * agent (/suppliers/:id ...): same build as the shipment / quote / lead
 * pages. Cards edit in place; coverage, rates, logins, mail and tasks in
 * tabs. Replaces the contact View pop-up.
 */
function ContactRecord({
  kind,
  record,
  save,
  isPartner,
  canRates,
  isAdmin,
  clients,
  tasks: allTasks,
}: {
  kind: Kind;
  record: Contact;
  save: UseMutationResult<Contact, Error, { id?: string; values: ContactValues }>;
  isPartner: boolean;
  canRates: boolean;
  isAdmin: boolean;
  clients: Contact[];
  tasks: OpsTask[];
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast, error } = useToast();
  const { label, title } = COPY[kind];
  const [mailing, setMailing] = useState(false);
  const [editCoverage, setEditCoverage] = useState(false);
  const [coverage, setCoverage] = useState<Coverage>(coverageOf(record));

  const linkKey =
    kind === "supplier" ? "supplier_id"
    : kind === "agent" ? "agent_id"
    : kind === "transporter" ? "transporter_id"
    : kind === "clearing_agent" ? "clearing_agent_id"
    : null;
  const tasks = linkKey ? allTasks.filter((t) => t[linkKey] === record.id) : [];
  const openTasks = tasks.filter((t) => t.status !== "done");
  const mirror =
    (kind === "agent" && record.source_clearing_agent_id) || (kind === "clearing_agent" && record.source_agent_id);

  type Tab = "overview" | "coverage" | "rates" | "logins" | "mail" | "tasks";
  const tabs: Tab[] = [
    "overview",
    ...(isPartner ? (["coverage"] as Tab[]) : []),
    ...(isPartner && canRates ? (["rates"] as Tab[]) : []),
    ...(isPartner && isAdmin ? (["logins"] as Tab[]) : []),
    "mail",
    ...(linkKey ? (["tasks"] as Tab[]) : []),
  ];
  const TAB_LABEL: Record<Tab, string> = {
    overview: "Overview",
    coverage: "Coverage",
    rates: "Rates",
    logins: "Partner login",
    mail: "Mail history",
    tasks: "Tasks",
  };
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && tabs.includes(tabParam) ? tabParam : "overview";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  async function patch(p: ContactPatch, msg = "Saved") {
    const values = {
      company: record.company,
      contact: record.contact,
      email: record.email,
      phone: record.phone,
      ...p,
    } as ContactValues;
    if (!values.company?.trim()) return error("Company name is required");
    try {
      await save.mutateAsync({ id: record.id, values });
      toast(msg);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  const owner = clients.find((c) => c.id === record.client_id);

  return (
    <>
      <PageHeader
        eyebrow={title}
        title={record.company}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate(`/${ROUTE[kind]}`)}>
              ← {title}
            </button>
            {isPartner ? (
              <button className="btn outline" onClick={() => setMailing(true)} disabled={!record.email}>
                Send email
              </button>
            ) : record.email ? (
              <a className="btn outline" href={`mailto:${record.email}`}>
                Send email
              </a>
            ) : null}
            {linkKey && (
              <button className="btn" onClick={() => setTab("tasks")}>
                Tasks{openTasks.length ? ` (${openTasks.length})` : ""}
              </button>
            )}
          </>
        }
      />

      {mirror && (
        <div className="jv-notes">
          <span className="k">Synced</span>
          <span>This {label} is mirrored from the other contact book, edit it there.</span>
        </div>
      )}

      <div className="ws-head panel">
        <div className="ws-title">
          <span className="ws-status">{titleCase(label)}</span>
          <span className="ws-route">{[record.contact, record.email, record.phone].filter(Boolean).join(" · ") || "No contact details yet"}</span>
          {owner && (
            <span className="ws-customer">
              Shipper for <Link to={`/clients/${owner.id}`}>{owner.company}</Link>
            </span>
          )}
        </div>
        <div className="ws-tiles">
          <div className="ws-tile">
            <span className="k">Contact person</span>
            <b>{record.contact || "—"}</b>
            <span className="muted">{record.phone || "no phone"}</span>
          </div>
          <div className="ws-tile">
            <span className="k">Email</span>
            <b style={{ fontSize: "0.95rem", overflowWrap: "anywhere" }}>{record.email || "—"}</b>
          </div>
          {isPartner ? (
            <button className="ws-tile" onClick={() => setTab("coverage")}>
              <span className="k">Coverage</span>
              <b>{(record.modes ?? []).length} modes</b>
              <span className="muted">
                {(record.countries ?? []).length} countries · {(record.ports ?? []).length} ports
              </span>
            </button>
          ) : (
            <div className="ws-tile">
              <span className="k">VAT No</span>
              <b>{record.vat_no || "—"}</b>
            </div>
          )}
          {linkKey ? (
            <button className="ws-tile" onClick={() => setTab("tasks")}>
              <span className="k">Open tasks</span>
              <b>{openTasks.length}</b>
              <span className="muted">{tasks.length - openTasks.length} done</span>
            </button>
          ) : (
            <div className="ws-tile">
              <span className="k">Since</span>
              <b>{new Date(record.created_at).toLocaleDateString("en-GB")}</b>
            </div>
          )}
        </div>
      </div>

      <nav className="ws-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "tasks" && openTasks.length > 0 && <span className="ws-count">{openTasks.length}</span>}
          </button>
        ))}
      </nav>

      <div className="ws-body">
        {tab === "overview" && (
          <div className="jv-cards">
            <ContactCard
              title="Contact"
              record={record}
              readOnly={!!mirror}
              fields={[
                ["contact", "Contact person"],
                ["email", "Email"],
                ["phone", "Phone"],
              ]}
              onSave={patch}
            />
            <ContactCard
              title="Company"
              record={record}
              readOnly={!!mirror}
              fields={[
                ["company", "Company"],
                ["vat_no", "VAT No"],
                ["import_code", "Import code"],
                ["address", "Address", true],
              ]}
              onSave={patch}
            />
            <div className="jv-card panel">
              <h4>Settings</h4>
              {kind === "supplier" && (
                <>
                  <label className="jv-field">
                    <span className="k">Belongs to customer</span>
                    <select
                      value={record.client_id ?? ""}
                      onChange={(e) => void patch({ client_id: e.target.value || null }, "Customer updated")}
                    >
                      <option value="">— none —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="jv-field">
                    <span className="k">Also a customer</span>
                    <input
                      type="checkbox"
                      checked={!!record.also_customer}
                      onChange={(e) => void patch({ also_customer: e.target.checked })}
                    />
                  </label>
                </>
              )}
              {kind === "agent" && !mirror && (
                <label className="jv-field">
                  <span className="k">Also a clearing agent</span>
                  <input
                    type="checkbox"
                    checked={!!record.also_clearing_agent}
                    onChange={(e) => void patch({ also_clearing_agent: e.target.checked })}
                  />
                </label>
              )}
              {kind === "clearing_agent" && !mirror && (
                <label className="jv-field">
                  <span className="k">Also a forwarding agent</span>
                  <input
                    type="checkbox"
                    checked={!!record.also_agent}
                    onChange={(e) => void patch({ also_agent: e.target.checked })}
                  />
                </label>
              )}
              <div className="jv-field">
                <span className="k">Added</span>
                <span className="v">{new Date(record.created_at).toLocaleDateString("en-GB")}</span>
              </div>
            </div>
          </div>
        )}

        {tab === "coverage" && isPartner && (
          <div className="panel ws-panel">
            <div className="ws-sec-head">
              <h3>Coverage</h3>
              {!editCoverage && !mirror && (
                <button
                  className="btn outline small"
                  onClick={() => {
                    setCoverage(coverageOf(record));
                    setEditCoverage(true);
                  }}
                >
                  ✎ Edit coverage
                </button>
              )}
            </div>
            {editCoverage ? (
              <>
                <CoverageEditor value={coverage} onChange={setCoverage} />
                <div className="jv-form-foot" style={{ marginTop: 10 }}>
                  <button className="btn ghost small" onClick={() => setEditCoverage(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn small"
                    disabled={save.isPending}
                    onClick={async () => {
                      await patch(
                        {
                          modes: coverage.modes,
                          countries: coverage.countries,
                          ports: coverage.ports,
                          coverage_notes: coverage.coverage_notes.trim() || null,
                        },
                        "Coverage saved",
                      );
                      setEditCoverage(false);
                    }}
                  >
                    Save coverage
                  </button>
                </div>
              </>
            ) : (
              <CoverageView value={coverageOf(record)} />
            )}
          </div>
        )}

        {tab === "rates" && isPartner && canRates && (
          <div className="panel ws-panel">
            <PartnerRateSheets
              kind={kind as PartnerKind}
              partnerId={record.id}
              partnerName={record.company}
              modes={record.modes}
              countries={record.countries}
              showHistory
            />
            <LegacyRateStructures kind={kind as PartnerKind} partnerId={record.id} partnerName={record.company} />
          </div>
        )}

        {tab === "logins" && isPartner && isAdmin && (
          <div className="panel ws-panel">
            <PartnerLoginAccess kind={kind as PartnerKind} partnerId={record.id} company={record.company} email={record.email} />
          </div>
        )}

        {tab === "mail" && (
          <div className="panel ws-panel">
            <MailHistory emails={[record.email]} />
          </div>
        )}

        {tab === "tasks" && linkKey && (
          <RecordTasks
            tasks={tasks}
            defaults={{ [linkKey]: record.id, title: `Follow up: ${record.company}` }}
            empty={`No tasks for this ${label}.`}
          />
        )}
      </div>

      {mailing && isPartner && (
        <PartnerMailModal kind={kind as PartnerKind} partner={record} onClose={() => setMailing(false)} />
      )}
    </>
  );
}

type ContactField = "company" | "contact" | "email" | "phone" | "vat_no" | "import_code" | "address";

/** A contact card that edits in place (✎), "+ add" on empty fields. */
function ContactCard({
  title,
  record,
  fields,
  onSave,
  readOnly,
}: {
  title: string;
  record: Contact;
  fields: [ContactField, string, boolean?][];
  onSave: (p: ContactPatch) => Promise<void> | void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p: Record<string, string | null> = {};
    for (const [k] of fields) {
      const v = String(fd.get(k) ?? "").trim();
      p[k] = k === "company" ? v : v || null;
    }
    await onSave(p as ContactPatch);
    setEditing(false);
  }
  return (
    <div className="jv-card panel">
      <h4>
        {title}
        {!editing && !readOnly && (
          <button type="button" className="jv-edit" onClick={() => setEditing(true)} title={`Edit ${title.toLowerCase()}`}>
            ✎
          </button>
        )}
      </h4>
      {editing ? (
        <form className="jv-form" onSubmit={onSubmit}>
          {fields.map(([k, lbl, long]) => (
            <label key={k}>
              {lbl}
              {long ? (
                <textarea name={k} rows={3} defaultValue={record[k] ?? ""} />
              ) : (
                <input name={k} type={k === "email" ? "email" : "text"} defaultValue={record[k] ?? ""} required={k === "company"} />
              )}
            </label>
          ))}
          <div className="jv-form-foot">
            <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn small">
              Save
            </button>
          </div>
        </form>
      ) : (
        fields.map(([k, lbl, long]) => {
          const v = record[k];
          if (long)
            return (
              <div key={k} className="jv-long">
                <span className="k">{lbl}</span>
                {v ? <p>{v}</p> : readOnly ? <span className="muted">—</span> : <button className="jv-add" onClick={() => setEditing(true)}>+ add</button>}
              </div>
            );
          return (
            <div key={k} className="jv-field">
              <span className="k">{lbl}</span>
              {v ? (
                <span className="v">
                  {k === "email" ? <a href={`mailto:${v}`}>{v}</a> : k === "phone" ? <a href={`tel:${v.replace(/[^+\d]/g, "")}`}>{v}</a> : v}
                </span>
              ) : readOnly ? (
                <span className="muted">—</span>
              ) : (
                <button type="button" className="jv-add" onClick={() => setEditing(true)}>
                  + add
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
