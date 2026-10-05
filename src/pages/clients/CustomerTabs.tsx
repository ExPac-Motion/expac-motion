import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { EmptyState, Loading, RowActions, RowActionsHead } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useLeads, useOpportunities } from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import { useWmsReceipts } from "../../lib/wms";
import {
  CUSTOMER_ROLES,
  DOCUMENT_KINDS,
  PERMIT_KINDS,
  SALUTATIONS,
  customersDb,
  useCustomerConsignees,
  useCustomerContacts,
  useCustomerFiles,
  useCustomerMutation,
  useCustomerShippers,
  type ClientContactRow,
  type ClientFile,
  type Consignee,
  type CustomerRecord,
  type Shipper,
} from "../../lib/customers";
import PortalAccessBox from "./PortalAccessBox";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

/* ---------- Contacts ---------- */

export function ContactsTab({ client, isAdmin }: { client: CustomerRecord; isAdmin: boolean }) {
  const { toast, error } = useToast();
  const q = useCustomerContacts(client.id);
  const [editing, setEditing] = useState<ClientContactRow | "new" | null>(null);
  const save = useCustomerMutation((v: { id?: string; values: Partial<ClientContactRow> }) => customersDb.saveContact(v.id, v.values));
  const del = useCustomerMutation(customersDb.deleteContact);
  const cur = editing && editing !== "new" ? editing : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      client_id: client.id,
      salutation: s(fd, "salutation"),
      name: s(fd, "name") ?? "",
      role: s(fd, "role"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      mobile: s(fd, "mobile"),
    };
    if (!values.name) return error("Name is required");
    save.mutate(
      { id: cur?.id, values },
      { onSuccess: () => { toast("Contact saved"); setEditing(null); }, onError: (er) => error(er.message) },
    );
  }

  const rows = q.data ?? [];
  return (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>Contacts</h3>
        <button className="btn btn-sm" onClick={() => setEditing("new")}>
          + Add contact
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Primary contact: <b>{client.contact || "—"}</b> {client.email ? `· ${client.email}` : ""} (edit it on General).
      </p>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No other contacts yet.</EmptyState>
      ) : (
        <table className="table--compact">
          <thead>
            <tr>
              <th style={{ width: 90 }}>
                <RowActionsHead />
              </th>
              <th>Name</th>
              <th>Role</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <RowActions
                    onEdit={() => setEditing(c)}
                    onDelete={() => {
                      if (confirm(`Remove ${c.name}?`)) del.mutate(c.id, { onError: (er) => error(er.message) });
                    }}
                  />
                </td>
                <td>{[c.salutation, c.name].filter(Boolean).join(" ")}</td>
                <td>{c.role || "—"}</td>
                <td>{c.email || "—"}</td>
                <td>{c.phone || "—"}</td>
                <td>{c.mobile || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null && (
        <Modal title={cur ? `Edit ${cur.name}` : "Add contact"} onClose={() => setEditing(null)} wide={!!cur}>
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
                <label>Customer Role</label>
                <input name="role" list="cr-roles" defaultValue={cur?.role ?? ""} />
                <datalist id="cr-roles">
                  {CUSTOMER_ROLES.map((r) => (
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
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
          {cur?.email && (
            <PortalAccessBox
              client={client}
              email={cur.email}
              name={cur.name}
              salutation={cur.salutation ?? ""}
              lastName={cur.name.split(" ").slice(-1)[0] ?? ""}
              isAdmin={isAdmin}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---------- Documents / Permits ---------- */

export function FilesTab({ clientId, kind }: { clientId: string; kind: "document" | "permit" }) {
  const { toast, error } = useToast();
  const q = useCustomerFiles(clientId);
  const [editing, setEditing] = useState<ClientFile | "new" | null>(null);
  const [issued, setIssued] = useState("");
  const [expires, setExpires] = useState("");
  const save = useCustomerMutation((v: { id?: string; values: Partial<ClientFile>; file: File | null }) => customersDb.saveFile(v.id, v.values, v.file));
  const del = useCustomerMutation(customersDb.deleteFile);
  const cur = editing && editing !== "new" ? editing : null;
  const kinds = kind === "permit" ? PERMIT_KINDS : DOCUMENT_KINDS;
  const rows = (q.data ?? []).filter((f) => f.kind === kind);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  function open(f: ClientFile | "new") {
    setEditing(f);
    setIssued(f !== "new" ? f.issued_on ?? "" : "");
    setExpires(f !== "new" ? f.expires_on ?? "" : "");
  }
  async function view(f: ClientFile) {
    if (!f.storage_path) return;
    const tab = window.open("", "_blank");
    try {
      const url = await customersDb.fileUrl(f.storage_path);
      if (tab) tab.location.href = url;
    } catch (e) {
      tab?.close();
      error(e instanceof Error ? e.message : "Could not open the file");
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = (fd.get("file") as File | null) && (fd.get("file") as File).size ? (fd.get("file") as File) : null;
    const values: Partial<ClientFile> = {
      client_id: clientId,
      kind,
      name: s(fd, "name") ?? file?.name ?? "",
      doc_type: s(fd, "doc_type"),
      number: s(fd, "number"),
      issued_on: issued || null,
      expires_on: expires || null,
      notes: s(fd, "notes"),
    };
    if (!values.name && !file) return error("Give it a name or attach the file");
    save.mutate(
      { id: cur?.id, values, file },
      { onSuccess: () => { toast("Saved"); setEditing(null); }, onError: (er) => error(er.message) },
    );
  }

  const title = kind === "permit" ? "Permits, Certificates & Documents" : "Documents";
  return (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>{title}</h3>
        <button className="btn btn-sm" onClick={() => open("new")}>
          + Add {kind === "permit" ? "permit / certificate" : "document"}
        </button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>Nothing on file yet.</EmptyState>
      ) : (
        <table className="table--compact">
          <thead>
            <tr>
              <th style={{ width: 120 }}>
                <RowActionsHead />
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>Number</th>
              <th>Issued</th>
              <th>Expires</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>
                  <RowActions
                    onView={f.storage_path ? () => void view(f) : undefined}
                    onEdit={() => open(f)}
                    onDelete={() => {
                      if (confirm(`Delete ${f.name}?`)) del.mutate(f, { onError: (er) => error(er.message) });
                    }}
                  />
                </td>
                <td>
                  <b>{f.name}</b>
                  {!f.storage_path && <span className="muted small"> (no file)</span>}
                </td>
                <td>{f.doc_type || "—"}</td>
                <td>{f.number || "—"}</td>
                <td>{formatDate(f.issued_on)}</td>
                <td>
                  {f.expires_on ? (
                    <span className={f.expires_on < today ? "wms-warn" : f.expires_on <= soon ? "cr-soon" : undefined}>
                      {formatDate(f.expires_on)}
                      {f.expires_on < today ? " · expired" : f.expires_on <= soon ? " · expiring" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{formatDate(f.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null && (
        <Modal title={cur ? `Edit ${cur.name}` : `Add ${kind === "permit" ? "permit / certificate" : "document"}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit}>
            <div className="field">
              <label>Type</label>
              <select name="doc_type" defaultValue={cur?.doc_type ?? ""}>
                <option value="">—</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Name</label>
                <input name="name" defaultValue={cur?.name ?? ""} placeholder="Defaults to the file name" />
              </div>
              <div className="field">
                <label>Number / reference</label>
                <input name="number" defaultValue={cur?.number ?? ""} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Issued</label>
                <DateInput value={issued} onChange={setIssued} />
              </div>
              <div className="field">
                <label>Expires</label>
                <DateInput value={expires} onChange={setExpires} />
              </div>
            </div>
            <div className="field">
              <label>{cur?.storage_path ? "Replace file" : "File"}</label>
              <input name="file" type="file" />
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

/* ---------- Products & SKUs (from the WMS) ---------- */

export function SkusTab({ clientId }: { clientId: string }) {
  const receiptsQ = useWmsReceipts();
  const rows = useMemo(() => {
    const m = new Map<string, { sku: string; description: string; received: number; onHand: number; receipts: Set<string>; last: string }>();
    for (const r of (receiptsQ.data ?? []).filter((x) => x.client_id === clientId)) {
      for (const p of r.packages) {
        const key = (p.sku || p.description || "—").trim();
        const q = Number(p.qty) || 0;
        const cur = m.get(key) ?? { sku: p.sku || "—", description: p.description || r.description || "—", received: 0, onHand: 0, receipts: new Set<string>(), last: r.received_at };
        cur.received += q;
        cur.onHand += r.pieces > 0 ? Math.round((q * r.on_hand) / r.pieces) : 0;
        cur.receipts.add(r.receipt_no);
        if (r.received_at > cur.last) cur.last = r.received_at;
        m.set(key, cur);
      }
    }
    return [...m.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [receiptsQ.data, clientId]);
  return (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>Products &amp; SKUs</h3>
        <Link to="/wms?tab=inventory" className="link-btn">
          WMS inventory
        </Link>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        From the package items on this customer's warehouse receipts.
      </p>
      {receiptsQ.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No SKUs booked into the warehouse for this customer yet.</EmptyState>
      ) : (
        <table className="table--compact">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th>In store</th>
              <th>Received</th>
              <th>Receipts</th>
              <th>Last received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku + r.description}>
                <td>
                  <b>{r.sku}</b>
                </td>
                <td>{r.description}</td>
                <td>{r.onHand}</td>
                <td>{r.received}</td>
                <td>{[...r.receipts].join(", ")}</td>
                <td>{formatDate(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- Consignees & Shippers ---------- */

type PartyKind = "shipper" | "consignee";

export function PartiesTab({ clientId }: { clientId: string }) {
  const { toast, error } = useToast();
  const shippersQ = useCustomerShippers(clientId);
  const consigneesQ = useCustomerConsignees(clientId);
  const [editing, setEditing] = useState<{ kind: PartyKind; row: Shipper | Consignee | null } | null>(null);
  const saveShipper = useCustomerMutation((v: { id?: string; values: Partial<Shipper> }) => customersDb.saveShipper(v.id, v.values));
  const saveConsignee = useCustomerMutation((v: { id?: string; values: Partial<Consignee> }) => customersDb.saveConsignee(v.id, v.values));
  const delShipper = useCustomerMutation(customersDb.deleteShipper);
  const delConsignee = useCustomerMutation(customersDb.deleteConsignee);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const base = {
      client_id: clientId,
      company: s(fd, "company") ?? "",
      contact: s(fd, "contact"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      address: s(fd, "address"),
    };
    if (!base.company) return error("Company name is required");
    const done = { onSuccess: () => { toast("Saved"); setEditing(null); }, onError: (er: Error) => error(er.message) };
    if (editing.kind === "shipper") saveShipper.mutate({ id: editing.row?.id, values: { ...base, vat_no: s(fd, "vat_no"), import_code: s(fd, "import_code") } }, done);
    else saveConsignee.mutate({ id: editing.row?.id, values: { ...base, notes: s(fd, "notes") } }, done);
  }

  const table = (kind: PartyKind, rows: (Shipper | Consignee)[], loading: boolean) => (
    <div className="panel cr-section">
      <div className="cr-section-head">
        <h3>{kind === "shipper" ? "Shippers / Suppliers" : "Consignees"}</h3>
        <button className="btn btn-sm" onClick={() => setEditing({ kind, row: null })}>
          + Add {kind}
        </button>
      </div>
      {kind === "shipper" && (
        <p className="hint" style={{ marginTop: 0 }}>
          This customer's own shippers — they show in its portal under Customer Party and in the Quote Builder.
        </p>
      )}
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>None yet.</EmptyState>
      ) : (
        <table className="table--compact">
          <thead>
            <tr>
              <th style={{ width: 90 }}>
                <RowActionsHead />
              </th>
              <th>Company</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <RowActions
                    onEdit={() => setEditing({ kind, row: r })}
                    onDelete={() => {
                      if (!confirm(`Delete ${r.company}?`)) return;
                      (kind === "shipper" ? delShipper : delConsignee).mutate(r.id, { onError: (er: Error) => error(er.message) });
                    }}
                  />
                </td>
                <td>
                  <b>{r.company}</b>
                </td>
                <td>{r.contact || "—"}</td>
                <td>{r.email || "—"}</td>
                <td>{r.phone || "—"}</td>
                <td className="cr-wrap">{r.address || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const row = editing?.row as (Shipper & Consignee) | null;
  return (
    <>
      {table("consignee", consigneesQ.data ?? [], consigneesQ.isLoading)}
      {table("shipper", shippersQ.data ?? [], shippersQ.isLoading)}
      {editing && (
        <Modal title={`${row ? "Edit" : "Add"} ${editing.kind}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit}>
            <div className="field">
              <label>Company *</label>
              <input name="company" defaultValue={row?.company ?? ""} autoFocus />
            </div>
            <div className="grid3">
              <div className="field">
                <label>Contact</label>
                <input name="contact" defaultValue={row?.contact ?? ""} />
              </div>
              <div className="field">
                <label>Email</label>
                <input name="email" type="email" defaultValue={row?.email ?? ""} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input name="phone" defaultValue={row?.phone ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <textarea name="address" rows={2} defaultValue={row?.address ?? ""} />
            </div>
            {editing.kind === "shipper" ? (
              <div className="grid2">
                <div className="field">
                  <label>VAT No</label>
                  <input name="vat_no" defaultValue={row?.vat_no ?? ""} />
                </div>
                <div className="field">
                  <label>Export / Import Code</label>
                  <input name="import_code" defaultValue={row?.import_code ?? ""} />
                </div>
              </div>
            ) : (
              <div className="field">
                <label>Notes (delivery hours, instructions)</label>
                <textarea name="notes" rows={2} defaultValue={row?.notes ?? ""} />
              </div>
            )}
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ---------- Associated Leads ---------- */

export function AssociatedLeadsTab({ client }: { client: CustomerRecord }) {
  const leadsQ = useLeads();
  const oppsQ = useOpportunities();
  const name = client.company.trim().toLowerCase();
  const leads = (leadsQ.data ?? []).filter((l) => l.promoted_client_id === client.id || l.company.trim().toLowerCase() === name);
  const opps = (oppsQ.data ?? []).filter((o) => o.client_id === client.id);
  return (
    <>
      <div className="panel cr-section">
        <div className="cr-section-head">
          <h3>Leads</h3>
          <Link to="/crm?tab=leads" className="link-btn">
            Sales CRM › Leads
          </Link>
        </div>
        {leadsQ.isLoading ? (
          <Loading />
        ) : leads.length === 0 ? (
          <EmptyState>No leads linked to this customer.</EmptyState>
        ) : (
          <table className="table--compact">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Status</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <b>{l.company}</b>
                    {l.promoted_client_id === client.id && <span className="tag">became this customer</span>}
                  </td>
                  <td>{l.contact || "—"}</td>
                  <td>{l.email || "—"}</td>
                  <td>{l.lead_status?.name ?? "—"}</td>
                  <td>{l.source || "—"}</td>
                  <td>{formatDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel cr-section">
        <div className="cr-section-head">
          <h3>Opportunities</h3>
          <Link to="/crm?tab=opportunities" className="link-btn">
            Opportunities board
          </Link>
        </div>
        {oppsQ.isLoading ? (
          <Loading />
        ) : opps.length === 0 ? (
          <EmptyState>No opportunities for this customer.</EmptyState>
        ) : (
          <table className="table--compact">
            <thead>
              <tr>
                <th>Title</th>
                <th>Stage</th>
                <th>Value</th>
                <th>Quote</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => (
                <tr key={o.id}>
                  <td>{o.title || "—"}</td>
                  <td>{o.status.replace(/_/g, " ")}</td>
                  <td>{money(o.opportunity_value ?? o.value)}</td>
                  <td>{o.quote ? <Link to={`/quotes/${o.quote.id}`}>{o.quote.reference}</Link> : "—"}</td>
                  <td>{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
