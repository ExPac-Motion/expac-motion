import { useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import type { Contact } from "../lib/types";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

type ContactValues = Omit<Contact, "id" | "created_at">;

interface Props {
  kind: "client" | "supplier";
  query: UseQueryResult<Contact[]>;
  save: UseMutationResult<Contact, Error, { id?: string; values: ContactValues }>;
  remove: UseMutationResult<void, Error, string>;
}

export default function ContactsPage({ kind, query, save, remove }: Props) {
  const label = kind === "client" ? "customer" : "shipper";
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

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
      toast(`${label[0].toUpperCase() + label.slice(1)} removed`);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  const current = editing === "new" ? null : editing;

  return (
    <>
      <PageHeader
        eyebrow={kind === "client" ? "Company & contact records" : "Vendor & carrier records"}
        title={kind === "client" ? "Customers" : "Shippers"}
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
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.company}</strong>
                    </td>
                    <td>{r.contact || "—"}</td>
                    <td>{r.email || "—"}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn ghost small"
                          onClick={() => setEditing(r)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn ghost small"
                          onClick={() => onDelete(r)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
