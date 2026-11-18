/**
 * Contacts tab on an agent / transporter / clearing agent / destination
 * agent (0247): more people at the company besides the primary contact,
 * each with role, email, phone, mobile, address and notes. Same layout as
 * a customer's Contacts tab. A mirror record ("Is also …") shows its
 * master's contacts read-only; they are edited on the master.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import { EmptyState, Loading, RowActions, RowActionsHead } from "../../components/common";
import { useToast } from "../../components/Toast";
import { deletePartnerContact, listPartnerContacts, savePartnerContact } from "../../lib/db";
import { SALUTATIONS } from "../../lib/customers";
import type { PartnerContact, PartnerKind } from "../../lib/types";

const ROLES = ["Operations", "Sales", "Accounts", "Customs", "Management", "Dispatch / Driver", "After hours"];

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

export default function PartnerContactsTab({
  kind,
  partnerId,
  primary,
  readOnlyFrom,
}: {
  kind: PartnerKind;
  partnerId: string;
  primary: { contact: string | null; email: string | null; phone: string | null };
  /** Set on a mirror record: the contacts are edited on that book's record. */
  readOnlyFrom?: string | null;
}) {
  const { toast, error } = useToast();
  const qc = useQueryClient();
  const key = ["partner_contacts", kind, partnerId];
  const q = useQuery({ queryKey: key, queryFn: () => listPartnerContacts(kind, partnerId) });
  const [editing, setEditing] = useState<PartnerContact | "new" | null>(null);
  const cur = editing && editing !== "new" ? editing : null;
  const save = useMutation({
    mutationFn: (v: { id?: string; values: Omit<PartnerContact, "id" | "created_at"> }) => savePartnerContact(v.id, v.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({
    mutationFn: deletePartnerContact,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      partner_kind: kind,
      partner_id: partnerId,
      salutation: s(fd, "salutation"),
      name: s(fd, "name") ?? "",
      role: s(fd, "role"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      mobile: s(fd, "mobile"),
      address: s(fd, "address"),
      notes: s(fd, "notes"),
    };
    if (!values.name) return error("Name is required");
    save.mutate(
      { id: cur?.id, values },
      {
        onSuccess: () => {
          toast("Contact saved");
          setEditing(null);
        },
        onError: (er) => error(er instanceof Error ? er.message : "Could not save"),
      },
    );
  }

  const rows = q.data ?? [];
  const ro = !!readOnlyFrom;
  return (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>Contacts</h3>
        {!ro && (
          <button className="btn btn-sm" onClick={() => setEditing("new")}>
            + Add contact
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Primary contact: <b>{primary.contact || "—"}</b>
        {primary.email ? ` · ${primary.email}` : ""}
        {primary.phone ? ` · ${primary.phone}` : ""} (edit it on Overview).
        {ro && ` These contacts are kept on the ${readOnlyFrom} record; edit them there.`}
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <EmptyState>Contacts aren't available yet (migration 0247 not run).</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No other contacts yet.</EmptyState>
      ) : (
        <table className="table--compact">
          <thead>
            <tr>
              {!ro && (
                <th style={{ width: 90 }}>
                  <RowActionsHead />
                </th>
              )}
              <th>Name</th>
              <th>Role</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Mobile</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                {!ro && (
                  <td>
                    <RowActions
                      onEdit={() => setEditing(c)}
                      onDelete={() => {
                        if (confirm(`Remove ${c.name}?`)) del.mutate(c.id, { onError: (er) => error(er instanceof Error ? er.message : "Could not remove") });
                      }}
                    />
                  </td>
                )}
                <td title={c.notes ?? undefined}>{[c.salutation, c.name].filter(Boolean).join(" ")}</td>
                <td>{c.role || "—"}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                <td>{c.phone || "—"}</td>
                <td>{c.mobile || "—"}</td>
                <td>{c.address || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null && (
        <Modal title={cur ? `Edit ${cur.name}` : "Add contact"} onClose={() => setEditing(null)} wide>
          <form onSubmit={submit}>
            <div className="grid3">
              <div className="field">
                <label>Salutation</label>
                <select name="salutation" defaultValue={cur?.salutation ?? ""}>
                  <option value="">—</option>
                  {SALUTATIONS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Name *</label>
                <input name="name" defaultValue={cur?.name ?? ""} autoFocus />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Role</label>
                <input name="role" list="pc-roles" defaultValue={cur?.role ?? ""} />
                <datalist id="pc-roles">
                  {ROLES.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>Email</label>
                <input name="email" type="email" defaultValue={cur?.email ?? ""} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Phone</label>
                <input name="phone" defaultValue={cur?.phone ?? ""} />
              </div>
              <div className="field">
                <label>Mobile</label>
                <input name="mobile" defaultValue={cur?.mobile ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <textarea name="address" rows={2} defaultValue={cur?.address ?? ""} placeholder="If this person works from another branch or depot" />
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea name="notes" rows={2} defaultValue={cur?.notes ?? ""} />
            </div>
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
