import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import RichTextEditor from "../../components/RichTextEditor";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  MailLink,
  Popover,
  RowActions,
  RowActionsHead,
  SearchInput,
  useRowSelection,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCompanySettings,
  useCreateLeadsBulk,
  useCreateOpportunity,
  useDeleteLead,
  useLeadContacts,
  useLeadStatuses,
  useLeads,
  useMailTemplates,
  useProfiles,
  useReplaceLeadContacts,
  useSaveLead,
  useUpdateLeadsBulk,
  useUploadMailAsset,
} from "../../lib/hooks";
import { createLeadContacts, listLeadContacts } from "../../lib/db";
import { sendMail } from "../../lib/mail";
import { htmlToText, resolveMergeFields } from "../../lib/mailMerge";
import { formatDate } from "../../lib/format";
import type { Lead, LeadContactDraft, LeadPatch } from "../../lib/types";

/** Minimal CSV parser — no quoted-comma support needed for a simple lead import. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

const SAMPLE_CSV =
  "company,contact,role,email,phone,company_phone,website,source,description\n" +
  "Acme Imports,Jane Smith,Procurement,jane@acme.co.za,+27 82 555 0100,+27 11 555 0000,https://acme.co.za,Website,Regular FCL importer ex China\n" +
  "Acme Imports,Sam Ndlovu,Logistics Mgr,sam@acme.co.za,+27 82 555 0101,,,,\n" +
  "Bluewave Trading,John Doe,Owner,john@bluewave.co.za,+27 83 555 0199,+27 21 555 0000,https://bluewave.co.za,Referral,Air freight enquiry\n";

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads-import-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const norm = (s: string) => s.trim().toLowerCase();

/* ---------- master view: columns / sort / filters ---------- */

type ColKey =
  | "contact"
  | "email"
  | "phone"
  | "companyPhone"
  | "website"
  | "status"
  | "salesPerson"
  | "source"
  | "description"
  | "created";

const ALL_COLUMNS: { key: ColKey; label: string }[] = [
  { key: "contact", label: "Contact" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Mobile" },
  { key: "companyPhone", label: "Company Phone" },
  { key: "website", label: "Website" },
  { key: "status", label: "Status" },
  { key: "salesPerson", label: "Sales Person" },
  { key: "source", label: "Source" },
  { key: "description", label: "Description" },
  { key: "created", label: "Created" },
];
const DEFAULT_COLUMNS: ColKey[] = [
  "contact",
  "email",
  "phone",
  "status",
  "salesPerson",
  "created",
];

type SortKey = "company" | "contact" | "status" | "salesPerson" | "created";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}
interface LeadFilters {
  statusId: string;
  salesPersonId: string;
  source: string;
  hasEmail: "" | "yes" | "no";
}
const EMPTY_FILTERS: LeadFilters = {
  statusId: "",
  salesPersonId: "",
  source: "",
  hasEmail: "",
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } : fallback;
  } catch {
    return fallback;
  }
}
function loadCols(): ColKey[] {
  try {
    const raw = localStorage.getItem("leads.columns");
    if (!raw) return DEFAULT_COLUMNS;
    const arr = JSON.parse(raw) as ColKey[];
    return Array.isArray(arr) ? arr : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — non-fatal */
  }
}


export default function LeadsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useLeads();
  const statusesQ = useLeadStatuses();
  const remove = useDeleteLead();
  const bulkCreate = useCreateLeadsBulk();
  const bulkUpdate = useUpdateLeadsBulk();
  const createOpportunity = useCreateOpportunity();
  const { toast, error: toastError } = useToast();
  const [bulkOpen, setBulkOpen] = useState(false);

  const profilesQ = useProfiles();
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);
  const [mailing, setMailing] = useState<Lead | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewContactsQ = useLeadContacts(viewing?.id);

  const [columns, setColumns] = useState<ColKey[]>(loadCols);
  const [sort, setSort] = useState<SortState>(() =>
    loadJson<SortState>("leads.sort", { key: "created", dir: "desc" }),
  );
  const [filters, setFilters] = useState<LeadFilters>(() =>
    loadJson<LeadFilters>("leads.filters", EMPTY_FILTERS),
  );
  const [colSearch, setColSearch] = useState("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => data ?? [], [data]);
  const statuses = statusesQ.data ?? [];
  const salesPeople = profilesQ.data ?? [];

  function patchColumns(next: ColKey[]) {
    setColumns(next);
    saveJson("leads.columns", next);
  }
  function patchSort(next: SortState) {
    setSort(next);
    saveJson("leads.sort", next);
  }
  function patchFilters(next: LeadFilters) {
    setFilters(next);
    saveJson("leads.filters", next);
  }

  const show = (k: ColKey) => columns.includes(k);
  const activeFilterCount =
    (filters.statusId ? 1 : 0) +
    (filters.salesPersonId ? 1 : 0) +
    (filters.source.trim() ? 1 : 0) +
    (filters.hasEmail ? 1 : 0);

  const displayed = useMemo(() => {
    let out = rows.slice();
    const q = norm(search);
    if (q) {
      out = out.filter((l) =>
        [l.company, l.contact, l.email, l.phone, l.company_phone]
          .filter(Boolean)
          .some((v) => norm(v as string).includes(q)),
      );
    }
    if (filters.statusId)
      out = out.filter((l) => l.lead_status_id === filters.statusId);
    if (filters.salesPersonId)
      out = out.filter((l) => l.sales_person_id === filters.salesPersonId);
    if (filters.source.trim()) {
      const q = norm(filters.source);
      out = out.filter((l) => norm(l.source ?? "").includes(q));
    }
    if (filters.hasEmail === "yes") out = out.filter((l) => !!l.email);
    if (filters.hasEmail === "no") out = out.filter((l) => !l.email);

    const key = (l: Lead): string => {
      if (sort.key === "company") return l.company ?? "";
      if (sort.key === "contact") return l.contact ?? "";
      if (sort.key === "status") return l.lead_status?.name ?? "";
      if (sort.key === "salesPerson") return l.sales_person?.full_name ?? "";
      return l.created_at ?? "";
    };
    out.sort((a, b) => key(a).localeCompare(key(b)));
    if (sort.dir === "desc") out.reverse();
    return out;
  }, [rows, filters, sort, search]);

  const sel = useRowSelection(rows, displayed);

  async function onDelete(row: Lead) {
    if (!window.confirm(`Remove lead "${row.company}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Lead removed");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  async function onAddOpportunity(row: Lead) {
    try {
      await createOpportunity.mutateAsync({
        lead_id: row.id,
        client_id: null,
        status: "new_lead",
        value: 0,
        sales_person_id: row.sales_person_id,
      });
      toast("Opportunity added to the pipeline");
      navigate("/crm?tab=opportunities");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not add opportunity");
    }
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      const cell = (row: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) if (row[k]?.trim()) return row[k].trim();
        return "";
      };

      // Group CSV rows by company — the first row per company becomes the
      // lead, the rest become additional contacts on it.
      const existingCompany = new Set(rows.map((l) => norm(l.company)));
      const groups = new Map<string, Record<string, string>[]>();
      let skipped = 0;
      for (const row of parsed) {
        const company = cell(row, "company", "company name");
        if (!company) {
          skipped++;
          continue;
        }
        const ck = norm(company);
        (groups.get(ck) ?? groups.set(ck, []).get(ck)!).push(row);
      }

      let dupes = 0;
      const leadRows: Array<
        Pick<
          LeadPatch,
          | "company"
          | "contact"
          | "email"
          | "phone"
          | "company_phone"
          | "website"
          | "source"
          | "description"
        >
      > = [];
      const extraByCompany = new Map<string, Record<string, string>[]>();

      for (const [ck, gRows] of groups) {
        if (existingCompany.has(ck)) {
          dupes++;
          continue;
        }
        const head = gRows[0];
        leadRows.push({
          company: cell(head, "company", "company name"),
          contact: cell(head, "contact", "contact name", "name") || null,
          email: cell(head, "email") || null,
          phone:
            cell(head, "phone", "mobile", "mobile phone", "phone number") || null,
          company_phone: cell(head, "company_phone", "company phone") || null,
          website: cell(head, "website", "url", "company url") || null,
          source: cell(head, "source") || "CSV import",
          description: cell(head, "description") || null,
        });
        if (gRows.length > 1) extraByCompany.set(ck, gRows.slice(1));
      }

      if (leadRows.length === 0) {
        toastError(
          dupes > 0
            ? `Nothing imported — all ${dupes} compan${dupes === 1 ? "y is" : "ies are"} already in Leads`
            : "No valid rows found — check the file has a Company column",
        );
        return;
      }

      const created = await bulkCreate.mutateAsync(leadRows);
      const byCompany = new Map(created.map((l) => [norm(l.company), l.id]));

      const contactRows: Array<{
        lead_id: string;
        name: string;
        role: string | null;
        email: string | null;
        phone: string | null;
      }> = [];
      let dupContacts = 0;
      for (const [ck, extras] of extraByCompany) {
        const leadId = byCompany.get(ck);
        if (!leadId) continue;
        // Skip anyone already the primary contact, or repeated in the group.
        const head = groups.get(ck)![0];
        const seen = new Set<string>(
          [
            cell(head, "email").toLowerCase(),
            cell(head, "contact", "contact name", "name").toLowerCase(),
          ].filter(Boolean),
        );
        for (const r of extras) {
          const name = cell(r, "contact", "contact name", "name");
          const email = cell(r, "email");
          const key = email.toLowerCase() || name.toLowerCase();
          if (!key || seen.has(key)) {
            dupContacts++;
            continue;
          }
          seen.add(key);
          contactRows.push({
            lead_id: leadId,
            name,
            role: cell(r, "role", "title", "job title") || null,
            email: email || null,
            phone:
              cell(r, "phone", "mobile", "mobile phone", "phone number") || null,
          });
        }
      }
      if (contactRows.length) await createLeadContacts(contactRows);

      toast(
        `Imported ${leadRows.length} lead${leadRows.length === 1 ? "" : "s"}` +
          (contactRows.length
            ? ` (+${contactRows.length} extra contact${contactRows.length === 1 ? "" : "s"})`
            : "") +
          (dupes > 0 ? ` — skipped ${dupes} existing` : "") +
          (dupContacts > 0 ? ` — skipped ${dupContacts} duplicate contact(s)` : "") +
          (skipped > 0 ? ` — skipped ${skipped} row(s) with no company` : ""),
      );
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not import file");
    }
  }

  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? "—";
  const viewContacts = viewContactsQ.data ?? [];

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>
              {displayed.length}
              {displayed.length !== rows.length ? ` of ${rows.length}` : ""} lead
              {rows.length === 1 ? "" : "s"}
            </h2>
            <p>Prospects not yet promoted to a customer.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn ghost small" onClick={downloadSampleCsv}>
              Sample .csv
            </button>
            <button
              className="btn outline"
              onClick={() => fileInput.current?.click()}
              disabled={bulkCreate.isPending}
            >
              {bulkCreate.isPending ? "Importing…" : "Import CSV"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={onImportFile}
            />
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
              + Add Lead
            </button>
          </div>
        </div>

        <div className="lead-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search company or contact…"
          />
          <Popover label="+ Add Filter" badge={activeFilterCount}>
            {() => (
              <>
                <label className="ui-pop-row">
                  <span>Status</span>
                  <select
                    value={filters.statusId}
                    onChange={(e) =>
                      patchFilters({ ...filters, statusId: e.target.value })
                    }
                  >
                    <option value="">Any</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-pop-row">
                  <span>Sales Person</span>
                  <select
                    value={filters.salesPersonId}
                    onChange={(e) =>
                      patchFilters({ ...filters, salesPersonId: e.target.value })
                    }
                  >
                    <option value="">Any</option>
                    {salesPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || "—"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-pop-row">
                  <span>Source contains</span>
                  <input
                    value={filters.source}
                    onChange={(e) =>
                      patchFilters({ ...filters, source: e.target.value })
                    }
                  />
                </label>
                <label className="ui-pop-row">
                  <span>Has email</span>
                  <select
                    value={filters.hasEmail}
                    onChange={(e) =>
                      patchFilters({
                        ...filters,
                        hasEmail: e.target.value as LeadFilters["hasEmail"],
                      })
                    }
                  >
                    <option value="">Any</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => patchFilters(EMPTY_FILTERS)}
                  >
                    Clear filters
                  </button>
                )}
              </>
            )}
          </Popover>

          <Popover label="Sort">
            {() => (
              <>
                <label className="ui-pop-row">
                  <span>Field</span>
                  <select
                    value={sort.key}
                    onChange={(e) =>
                      patchSort({ ...sort, key: e.target.value as SortKey })
                    }
                  >
                    <option value="created">Created</option>
                    <option value="company">Company</option>
                    <option value="contact">Contact</option>
                    <option value="status">Status</option>
                    <option value="salesPerson">Sales Person</option>
                  </select>
                </label>
                <div className="ui-pop-row">
                  <span>Direction</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className={`chip${sort.dir === "asc" ? " on" : ""}`}
                      onClick={() => patchSort({ ...sort, dir: "asc" })}
                    >
                      Asc
                    </button>
                    <button
                      type="button"
                      className={`chip${sort.dir === "desc" ? " on" : ""}`}
                      onClick={() => patchSort({ ...sort, dir: "desc" })}
                    >
                      Desc
                    </button>
                  </div>
                </div>
              </>
            )}
          </Popover>

          <Popover label="Columns">
            {() => (
              <>
                <input
                  className="ui-pop-search"
                  placeholder="Search columns…"
                  value={colSearch}
                  onChange={(e) => setColSearch(e.target.value)}
                />
                <div className="ui-pop-row" style={{ opacity: 0.6 }}>
                  <label className="check">
                    <input type="checkbox" checked disabled /> Company
                  </label>
                </div>
                {ALL_COLUMNS.filter((c) =>
                  c.label.toLowerCase().includes(colSearch.trim().toLowerCase()),
                ).map((c) => (
                  <div key={c.key} className="ui-pop-row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={show(c.key)}
                        onChange={(e) =>
                          patchColumns(
                            e.target.checked
                              ? [...columns, c.key]
                              : columns.filter((k) => k !== c.key),
                          )
                        }
                      />
                      {c.label}
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => patchColumns(DEFAULT_COLUMNS)}
                >
                  Reset to default
                </button>
              </>
            )}
          </Popover>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            No leads yet. Add one, or import a CSV — grab the sample for the
            column layout.
          </EmptyState>
        ) : displayed.length === 0 ? (
          <EmptyState>No leads match the current filters.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="leads-table">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead
                      checked={sel.allChecked}
                      indeterminate={sel.someChecked}
                      onToggle={sel.toggleAll}
                    />
                  </th>
                  <th>Company</th>
                  {show("contact") && <th>Contact</th>}
                  {show("email") && <th>Email</th>}
                  {show("phone") && <th>Mobile</th>}
                  {show("companyPhone") && <th>Company Phone</th>}
                  {show("website") && <th>Website</th>}
                  {show("status") && <th>Status</th>}
                  {show("salesPerson") && <th>Sales Person</th>}
                  {show("source") && <th>Source</th>}
                  {show("description") && <th>Description</th>}
                  {show("created") && <th>Created</th>}
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <RowActions
                        selected={sel.isSelected(r.id)}
                        onSelectToggle={() => sel.toggle(r.id)}
                        onMail={() => setMailing(r)}
                        mailTitle="Send email"
                        onView={() => setViewing(r)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => onDelete(r)}
                      />
                    </td>
                    <td>
                      <strong>{r.company}</strong>
                      {r.promoted_client_id && (
                        <span className="tag">promoted to customer</span>
                      )}
                    </td>
                    {show("contact") && <td>{r.contact || "—"}</td>}
                    {show("email") && (
                      <td>
                        {r.email ? (
                          <span className="email-cell">
                            {r.email}
                            <MailLink email={r.email} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {show("phone") && <td>{r.phone || "—"}</td>}
                    {show("companyPhone") && <td>{r.company_phone || "—"}</td>}
                    {show("website") && (
                      <td>
                        {r.website ? (
                          <a href={r.website} target="_blank" rel="noreferrer">
                            {r.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {show("status") && (
                      <td>{r.lead_status?.name ?? statusName(r.lead_status_id)}</td>
                    )}
                    {show("salesPerson") && (
                      <td>{r.sales_person?.full_name || "—"}</td>
                    )}
                    {show("source") && <td>{r.source || "—"}</td>}
                    {show("description") && <td>{r.description || "—"}</td>}
                    {show("created") && (
                      <td className="nowrap">{formatDate(r.created_at)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <Modal
          title={viewing.company}
          onClose={() => setViewing(null)}
          headerActions={
            <>
              <button
                className="btn outline"
                onClick={() => onAddOpportunity(viewing)}
                disabled={createOpportunity.isPending}
              >
                {createOpportunity.isPending ? "Adding…" : "+ Add Opportunity"}
              </button>
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
          <div className="grid2">
            <ViewField label="Primary contact" value={viewing.contact || "—"} />
            <ViewField label="Company phone" value={viewing.company_phone || "—"} />
            <ViewField label="Email" value={viewing.email || "—"} />
            <ViewField label="Mobile phone" value={viewing.phone || "—"} />
            <ViewField label="Website" value={viewing.website || "—"} />
            <ViewField label="Source" value={viewing.source || "—"} />
            <ViewField label="Description" value={viewing.description || "—"} />
            <ViewField
              label="Status"
              value={viewing.lead_status?.name ?? statusName(viewing.lead_status_id)}
            />
            <ViewField
              label="Sales Person"
              value={viewing.sales_person?.full_name || "—"}
            />
          </div>
          {viewContacts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="hint" style={{ marginBottom: 4 }}>
                Additional contacts
              </div>
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Email</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewContacts.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name || "—"}</td>
                        <td>{c.role || "—"}</td>
                        <td>{c.email || "—"}</td>
                        <td>{c.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <ViewField label="Notes" value={viewing.notes || "—"} />
          {viewing.promoted_at && (
            <ViewField
              label="Promoted to Customer"
              value={formatDate(viewing.promoted_at)}
            />
          )}
        </Modal>
      )}

      {editing !== null && (
        <LeadEditModal
          key={editing === "new" ? "new" : editing.id}
          lead={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {mailing && (
        <QuickMailModal
          key={mailing.id}
          lead={mailing}
          onClose={() => setMailing(null)}
        />
      )}

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} lead${sel.count === 1 ? "" : "s"}`}
          count={sel.count}
          noun="lead"
          busy={bulkUpdate.isPending}
          fields={[
            {
              key: "lead_status_id",
              label: "Status",
              type: "select",
              options: statuses.map((s) => ({ value: s.id, label: s.name })),
            },
            {
              key: "sales_person_id",
              label: "Sales Person",
              type: "select",
              options: salesPeople.map((p) => ({
                value: p.id,
                label: p.full_name || "—",
              })),
            },
            {
              key: "source",
              label: "Source",
              type: "text",
              placeholder: "Referral, website, trade show…",
            },
            {
              key: "description",
              label: "Description",
              type: "textarea",
              placeholder: "Short summary of the lead",
            },
          ]}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as LeadPatch,
              });
              toast(`Updated ${n} lead${n === 1 ? "" : "s"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e2) {
              toastError(
                e2 instanceof Error ? e2.message : "Could not update leads",
              );
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}

function QuickMailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { data: templates } = useMailTemplates();
  const { data: settings } = useCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const { toast, error: toastError } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const mergeCtx = {
    name: lead.contact || lead.company,
    company: lead.company,
    unsubscribeUrl: `${window.location.origin}/unsubscribe`,
  };

  function applyTemplate(id: string) {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  }

  async function onSend() {
    if (!lead.email) return toastError("This lead has no email address");
    if (!subject.trim()) return toastError("Subject is required");
    setSending(true);
    try {
      let html = resolveMergeFields(body, mergeCtx);
      const sig = settings?.mail_signature_html?.trim();
      if (sig) html += `<br><br>${sig}`;
      await sendMail({
        to: [lead.email],
        subject: resolveMergeFields(subject.trim(), mergeCtx),
        html,
        text: htmlToText(html),
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
      });
      toast("Email sent");
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={`Email ${lead.company}`} onClose={onClose} wide>
      <div className="field">
        <label>To</label>
        <strong>{lead.email || "— no email on this lead —"}</strong>
      </div>
      <div className="field">
        <label>Start from a template (optional)</label>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) applyTemplate(e.target.value);
          }}
        >
          <option value="">— blank —</option>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label>Message</label>
        <RichTextEditor
          value={body}
          onChange={setBody}
          onUploadImage={(f) => uploadAsset.mutateAsync(f)}
        />
        <span className="hint">
          Your saved signature is added automatically. Sends from{" "}
          {settings?.mail_sender_name || "the configured sender"}.
        </span>
      </div>
      <div
        style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}
      >
        <button
          type="button"
          className="btn outline"
          onClick={onClose}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSend}
          disabled={sending || !lead.email}
        >
          {sending ? "Sending…" : "Send Email"}
        </button>
      </div>
    </Modal>
  );
}

function LeadEditModal({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  const save = useSaveLead();
  const replaceContacts = useReplaceLeadContacts();
  const statusesQ = useLeadStatuses();
  const profilesQ = useProfiles();
  const { toast, error: toastError } = useToast();

  const statuses = statusesQ.data ?? [];
  const salesPeople = profilesQ.data ?? [];

  const [contacts, setContacts] = useState<LeadContactDraft[]>([]);

  useEffect(() => {
    let alive = true;
    const p = lead ? listLeadContacts(lead.id) : Promise.resolve([]);
    p.then((cs) => {
      if (!alive) return;
      setContacts(
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
  }, [lead]);

  function updateContact(i: number, patch: Partial<LeadContactDraft>) {
    setContacts((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const company = String(fd.get("company") || "").trim();
    if (!company) {
      toastError("Company name is required");
      return;
    }
    const patch: LeadPatch = {
      company,
      contact: String(fd.get("contact") || "").trim() || null,
      email: String(fd.get("email") || "").trim() || null,
      phone: String(fd.get("phone") || "").trim() || null,
      company_phone: String(fd.get("company_phone") || "").trim() || null,
      website: String(fd.get("website") || "").trim() || null,
      source: String(fd.get("source") || "").trim() || null,
      description: String(fd.get("description") || "").trim() || null,
      notes: String(fd.get("notes") || "").trim() || null,
      lead_status_id: String(fd.get("lead_status_id") || "") || null,
      sales_person_id: String(fd.get("sales_person_id") || "") || null,
    };
    try {
      const saved = await save.mutateAsync({ id: lead?.id, patch });
      await replaceContacts.mutateAsync({ leadId: saved.id, contacts });
      toast("Saved");
      onClose();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  const busy = save.isPending || replaceContacts.isPending;

  return (
    <Modal title={lead ? "Edit lead" : "Add lead"} onClose={onClose} wide>
      <form onSubmit={onSubmit}>
        <div className="grid2">
          <div className="field">
            <label>Company name</label>
            <input name="company" defaultValue={lead?.company ?? ""} autoFocus />
          </div>
          <div className="field">
            <label>Company website</label>
            <input
              name="website"
              type="url"
              placeholder="https://acme.co.za"
              defaultValue={lead?.website ?? ""}
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Source</label>
            <input
              name="source"
              placeholder="Referral, website, trade show…"
              defaultValue={lead?.source ?? ""}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <input
              name="description"
              placeholder="Short summary of the lead"
              defaultValue={lead?.description ?? ""}
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Primary contact</label>
            <input name="contact" defaultValue={lead?.contact ?? ""} />
          </div>
          <div className="field">
            <label>Company phone</label>
            <input
              name="company_phone"
              placeholder="Switchboard / landline"
              defaultValue={lead?.company_phone ?? ""}
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Email</label>
            <input name="email" type="email" defaultValue={lead?.email ?? ""} />
          </div>
          <div className="field">
            <label>Mobile phone</label>
            <input name="phone" defaultValue={lead?.phone ?? ""} />
          </div>
        </div>

        <div className="field">
          <label>Additional contacts at this company</label>
          {contacts.map((c, i) => (
            <div
              key={i}
              className="grid2"
              style={{ gap: 8, marginBottom: 6, alignItems: "start" }}
            >
              <input
                placeholder="Name"
                value={c.name}
                onChange={(e) => updateContact(i, { name: e.target.value })}
              />
              <input
                placeholder="Role / title"
                value={c.role}
                onChange={(e) => updateContact(i, { role: e.target.value })}
              />
              <input
                placeholder="Email"
                value={c.email}
                onChange={(e) => updateContact(i, { email: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  placeholder="Phone"
                  value={c.phone}
                  onChange={(e) => updateContact(i, { phone: e.target.value })}
                />
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() =>
                    setContacts((prev) => prev.filter((_, j) => j !== i))
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
              setContacts((prev) => [
                ...prev,
                { name: "", role: "", email: "", phone: "" },
              ])
            }
          >
            + Add contact
          </button>
        </div>

        <div className="grid2">
          <div className="field">
            <label>Lead Status</label>
            <select name="lead_status_id" defaultValue={lead?.lead_status_id ?? ""}>
              <option value="">— none —</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Sales Person</label>
            <select
              name="sales_person_id"
              defaultValue={lead?.sales_person_id ?? ""}
            >
              <option value="">— unassigned —</option>
              {salesPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || "—"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={3} defaultValue={lead?.notes ?? ""} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ViewField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
