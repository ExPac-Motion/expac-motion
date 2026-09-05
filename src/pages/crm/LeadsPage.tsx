import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  MailLink,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCreateLeadsBulk,
  useCreateOpportunity,
  useDeleteLead,
  useLeadStatuses,
  useLeads,
  useProfiles,
  useSaveLead,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { Lead, LeadPatch } from "../../lib/types";

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

export default function LeadsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useLeads();
  const statusesQ = useLeadStatuses();
  const profilesQ = useProfiles();
  const save = useSaveLead();
  const remove = useDeleteLead();
  const bulkCreate = useCreateLeadsBulk();
  const createOpportunity = useCreateOpportunity();
  const { toast, error: toastError } = useToast();

  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = data ?? [];
  const statuses = statusesQ.data ?? [];
  const salesPeople = profilesQ.data ?? [];

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
      source: String(fd.get("source") || "").trim() || null,
      notes: String(fd.get("notes") || "").trim() || null,
      lead_status_id: String(fd.get("lead_status_id") || "") || null,
      sales_person_id: String(fd.get("sales_person_id") || "") || null,
    };
    try {
      await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        patch,
      });
      setEditing(null);
      toast("Saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(row: Lead) {
    if (!window.confirm(`Remove lead "${row.company}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Lead removed");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  async function onDuplicate(row: Lead) {
    try {
      await save.mutateAsync({
        patch: {
          company: `${row.company} (Copy)`,
          contact: row.contact,
          email: row.email,
          phone: row.phone,
          source: row.source,
          notes: row.notes,
          lead_status_id: row.lead_status_id,
          sales_person_id: row.sales_person_id,
        },
      });
      toast("Lead duplicated");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not duplicate");
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
      const toCreate: Array<Pick<LeadPatch, "company" | "contact" | "email" | "phone" | "source">> =
        [];
      let skipped = 0;
      for (const row of parsed) {
        const company = (row.company || row["company name"] || "").trim();
        if (!company) {
          skipped++;
          continue;
        }
        toCreate.push({
          company,
          contact: row.contact || row["contact name"] || row.name || null,
          email: row.email || null,
          phone: row.phone || row["phone number"] || null,
          source: row.source || "CSV import",
        });
      }
      if (toCreate.length === 0) {
        toastError("No valid rows found — check the file has a Company column");
        return;
      }
      await bulkCreate.mutateAsync(toCreate);
      toast(
        `Imported ${toCreate.length} lead${toCreate.length === 1 ? "" : "s"}` +
          (skipped > 0 ? ` — skipped ${skipped} row(s) missing a company name` : ""),
      );
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not import file");
    }
  }

  const current = editing === "new" ? null : editing;
  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? "—";

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{rows.length} lead{rows.length === 1 ? "" : "s"}</h2>
            <p>Prospects not yet promoted to a customer.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
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
            <button className="btn" onClick={() => setEditing("new")}>
              + Add Lead
            </button>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            No leads yet. Add one, or import a CSV with a Company column.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Sales Person</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <RowActions
                        onView={() => setViewing(r)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => onDelete(r)}
                        onDuplicate={() => onDuplicate(r)}
                      />
                    </td>
                    <td>
                      <strong>{r.company}</strong>
                      {r.promoted_client_id && (
                        <span className="tag">promoted to customer</span>
                      )}
                    </td>
                    <td>{r.contact || "—"}</td>
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
                    <td>{r.phone || "—"}</td>
                    <td>{r.lead_status?.name ?? statusName(r.lead_status_id)}</td>
                    <td>{r.sales_person?.full_name || "—"}</td>
                    <td className="nowrap">{formatDate(r.created_at)}</td>
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
            <ViewField label="Contact" value={viewing.contact || "—"} />
            <ViewField label="Email" value={viewing.email || "—"} />
            <ViewField label="Phone" value={viewing.phone || "—"} />
            <ViewField label="Source" value={viewing.source || "—"} />
            <ViewField
              label="Status"
              value={viewing.lead_status?.name ?? statusName(viewing.lead_status_id)}
            />
            <ViewField
              label="Sales Person"
              value={viewing.sales_person?.full_name || "—"}
            />
          </div>
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
        <Modal
          title={current ? `Edit lead` : "Add lead"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Company name</label>
              <input name="company" defaultValue={current?.company ?? ""} autoFocus />
            </div>
            <div className="field">
              <label>Contact person</label>
              <input name="contact" defaultValue={current?.contact ?? ""} />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Email</label>
                <input name="email" type="email" defaultValue={current?.email ?? ""} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input name="phone" defaultValue={current?.phone ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Source</label>
              <input
                name="source"
                placeholder="Referral, website, trade show…"
                defaultValue={current?.source ?? ""}
              />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Lead Status</label>
                <select
                  name="lead_status_id"
                  defaultValue={current?.lead_status_id ?? ""}
                >
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
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea name="notes" rows={3} defaultValue={current?.notes ?? ""} />
            </div>
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
    </>
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
