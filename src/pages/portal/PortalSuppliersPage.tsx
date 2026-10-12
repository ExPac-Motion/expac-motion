import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useDeleteMyShipper, useMyJobs, useMySuppliers, useSaveMyShipper } from "../../lib/hooks";
import { formatDate, portCode } from "../../lib/format";
import type { ClientSupplier, ClientSupplierInput } from "../../lib/types";
import { modeEmoji } from "./PortalLayout";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const initials = (s: string) =>
  s
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const NotOnFile = () => <span className="hint">Not on file</span>;

/** "Customer Party", the customer's shippers (suppliers.client_id, 0142,
 *  plus any on its shipments) as cards with their details and the
 *  customer's shipments from them. The customer adds and edits its own
 *  shippers here (0157). */
export default function PortalSuppliersPage() {
  const suppliersQ = useMySuppliers();
  const jobsQ = useMyJobs();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ClientSupplier | "new" | null>(null);

  const parties = useMemo(() => {
    const jobs = jobsQ.data ?? [];
    return (suppliersQ.data ?? []).map((s) => {
      const theirs = jobs
        .filter((j) => norm(j.supplier_company) === norm(s.company))
        .sort((a, b) => (b.etd ?? b.created_at).localeCompare(a.etd ?? a.created_at));
      const origins = [...new Set(theirs.map((j) => portCode(j.origin)).filter(Boolean))];
      const modes = [...new Set(theirs.map((j) => j.mode))];
      return { ...s, shipments: theirs.length, last: theirs[0] ?? null, origins, modes };
    });
  }, [suppliersQ.data, jobsQ.data]);

  const n = norm(search);
  const shown = n
    ? parties.filter((p) =>
        [p.company, p.contact, p.email, p.phone, p.address, p.vat_no, ...p.origins].some((v) => norm(v).includes(n)),
      )
    : parties;

  return (
    <>
      <PageHeader eyebrow="Your account" title="Customer Party" />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search company, contact, email, port…" />}
        count={suppliersQ.isLoading ? undefined : `${shown.length} shipper${shown.length === 1 ? "" : "s"}`}
        hint="Your shippers / exporters. Add new ones and keep their details up to date, ExPac uses them on your quotations and shipments."
        primary={
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            + Add shipper
          </button>
        }
      />
      {suppliersQ.isLoading ? (
        <div className="panel">
          <Loading />
        </div>
      ) : suppliersQ.isError ? (
        <div className="panel">
          <ErrorNote error={suppliersQ.error} />
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState>{n ? `No shippers match "${search.trim()}".` : "No shippers yet. Add your first one with + Add shipper."}</EmptyState>
        </div>
      ) : (
        <div className="pt-parties">
          {shown.map((p) => (
            <div key={p.id} className="pt-party">
              <div className="pt-party-head">
                <span className="pt-party-avatar" aria-hidden>
                  {initials(p.company)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3 title={p.company}>{p.company}</h3>
                  <span className="pt-party-role">Shipper / Exporter</span>
                </div>
                {p.editable !== false && (
                  <button type="button" className="btn outline btn-sm" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                )}
              </div>
              <dl className="pt-party-details">
                <dt>Contact</dt>
                <dd>{p.contact || <NotOnFile />}</dd>
                <dt>Email</dt>
                <dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : <NotOnFile />}</dd>
                <dt>Phone</dt>
                <dd>{p.phone ? <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a> : <NotOnFile />}</dd>
                {p.address && (
                  <>
                    <dt>Address</dt>
                    <dd className="pt-party-address">{p.address}</dd>
                  </>
                )}
                {p.vat_no && (
                  <>
                    <dt>VAT No</dt>
                    <dd>{p.vat_no}</dd>
                  </>
                )}
              </dl>
              <div className="pt-party-foot">
                <div className="pt-party-stats">
                  <span>
                    <b>{p.shipments}</b> shipment{p.shipments === 1 ? "" : "s"}
                  </span>
                  {p.modes.length > 0 && <span aria-label="Modes">{p.modes.map((m) => modeEmoji(m)).join(" ")}</span>}
                  {p.origins.length > 0 && <span>From {p.origins.slice(0, 3).join(", ")}</span>}
                  {p.last && <span>Last {formatDate(p.last.etd ?? p.last.created_at)}</span>}
                </div>
                {p.shipments > 0 && (
                  <Link to="/portal/shipments" state={{ search: p.company }} className="link-btn">
                    View shipments
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ShipperModal shipper={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const FIELDS: { k: keyof ClientSupplierInput; label: string; type?: string; rows?: number }[] = [
  { k: "company", label: "Company name *" },
  { k: "contact", label: "Contact person" },
  { k: "email", label: "Email", type: "email" },
  { k: "phone", label: "Phone" },
  { k: "vat_no", label: "VAT / Tax No" },
  { k: "address", label: "Address", rows: 3 },
];

function ShipperModal({ shipper, onClose }: { shipper: ClientSupplier | null; onClose: () => void }) {
  const { toast, error } = useToast();
  const save = useSaveMyShipper();
  const remove = useDeleteMyShipper();
  const [v, setV] = useState<ClientSupplierInput>({
    company: shipper?.company ?? "",
    contact: shipper?.contact ?? "",
    email: shipper?.email ?? "",
    phone: shipper?.phone ?? "",
    vat_no: shipper?.vat_no ?? "",
    address: shipper?.address ?? "",
  });
  const busy = save.isPending || remove.isPending;

  function onSave() {
    if (!v.company.trim()) return error("Company name is required");
    save.mutate(
      { id: shipper?.id ?? null, input: v },
      {
        onSuccess: () => {
          toast(shipper ? "Shipper updated" : "Shipper added");
          onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }
  function onRemove() {
    if (!shipper || !window.confirm(`Remove ${shipper.company} from your shippers?`)) return;
    remove.mutate(shipper.id, {
      onSuccess: () => {
        toast("Shipper removed");
        onClose();
      },
      onError: (e) => error(e.message),
    });
  }

  const input = (f: (typeof FIELDS)[number]) =>
    f.rows ? (
      <textarea rows={f.rows} value={v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
    ) : (
      <input
        type={f.type ?? "text"}
        value={v[f.k] ?? ""}
        onChange={(e) => setV({ ...v, [f.k]: e.target.value })}
        autoFocus={f.k === "company"}
      />
    );

  return (
    <Modal title={shipper ? `Edit ${shipper.company}` : "Add a shipper"} onClose={onClose}>
      <div className="field">
        <label>{FIELDS[0].label}</label>
        {input(FIELDS[0])}
      </div>
      <div className="grid2">
        {FIELDS.slice(1, 5).map((f) => (
          <div key={f.k} className="field">
            <label>{f.label}</label>
            {input(f)}
          </div>
        ))}
      </div>
      <div className="field">
        <label>{FIELDS[5].label}</label>
        {input(FIELDS[5])}
      </div>
      <div className="modal-foot-row">
        {shipper && (
          <button type="button" className="btn outline warn" style={{ marginRight: "auto" }} onClick={onRemove} disabled={busy}>
            Remove
          </button>
        )}
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onSave}>
          {save.isPending ? "Saving…" : shipper ? "Save changes" : "Add shipper"}
        </button>
      </div>
    </Modal>
  );
}
