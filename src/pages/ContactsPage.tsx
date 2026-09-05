import { useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  MailLink,
  PageHeader,
  RowActions,
  RowActionsHead,
} from "../components/common";
import { useToast } from "../components/Toast";
import type { Contact } from "../lib/types";
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
}

export default function ContactsPage({ kind, query, save, remove }: Props) {
  const { label, title, eyebrow } = COPY[kind];
  const Label = titleCase(label);
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [viewing, setViewing] = useState<Contact | null>(null);

  const rows = query.data ?? [];

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
      await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        values,
      });
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

  const current = editing === "new" ? null : editing;

  // A mirror row: managed from the other contact book, read-only here.
  function mirrorOf(r: Contact): Kind | null {
    if (kind === "agent" && r.source_clearing_agent_id) return "clearing_agent";
    if (kind === "clearing_agent" && r.source_agent_id) return "agent";
    return null;
  }

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        actions={
          <button className="btn" onClick={() => setEditing("new")}>
            + Add {label}
          </button>
        }
      />

      <div className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNote error={query.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No {label}s yet. Add your first one to start quoting.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>VAT No</th>
                  <th>Import Code</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mirror = mirrorOf(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        {mirror ? (
                          <div className="row-icons">
                            <input
                              type="checkbox"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="muted small">
                              Synced from {COPY[mirror].title}
                            </span>
                          </div>
                        ) : (
                          <RowActions
                            onView={() => setViewing(r)}
                            onEdit={() => setEditing(r)}
                            onDelete={() => onDelete(r)}
                            onDuplicate={() => onDuplicate(r)}
                          />
                        )}
                      </td>
                      <td>
                        <strong>{r.company}</strong>
                        {r.also_clearing_agent && (
                          <span className="tag">also clearing agent</span>
                        )}
                        {r.also_agent && <span className="tag">also agent</span>}
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
                      <td>{r.vat_no || "—"}</td>
                      <td>{r.import_code || "—"}</td>
                      <td>{r.address || "—"}</td>
                    </tr>
                  );
                })}
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
            <button
              className="btn outline"
              onClick={() => {
                setEditing(viewing);
                setViewing(null);
              }}
            >
              Edit
            </button>
          }
        >
          <div className="grid2">
            <ViewField label="Contact person" value={viewing.contact || "—"} />
            <ViewField label="Email" value={viewing.email || "—"} />
            <ViewField label="Phone" value={viewing.phone || "—"} />
            <ViewField label={`${Label} VAT No`} value={viewing.vat_no || "—"} />
            <ViewField
              label={`${Label} Import Code`}
              value={viewing.import_code || "—"}
            />
          </div>
          <ViewField label="Address" value={viewing.address || "—"} />
        </Modal>
      )}

      {editing !== null && (
        <Modal
          title={current ? `Edit ${label}` : `Add ${label}`}
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
