import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  Popover,
  RowActions,
  RowActionsHead,
  SearchInput,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { VOLUMETRIC_FACTOR } from "../../lib/calc";
import {
  qty,
  round,
  useWmsConsols,
  useWmsMutation,
  useWmsReceipts,
  wmsDb,
  type WmsConsol,
  type WmsConsolHouse,
  type WmsConsolInput,
  type WmsReceipt,
} from "../../lib/wms";
import { orNull, useWmsLookups } from "./shared";

/** Default Accounting Information on a house: ExPac as notify party (from the
 *  air waybill template ExPac supplied, 2026-10-05). */
export const EXPAC_NOTIFY =
  "NOTIFY PARTY:\nEXPAC FORWARDING\nADD: ECO PARK BLVD, WITCH-HAZEL AVE, HIGHVELD\nCENTURION, 0144, SOUTH AFRICA\nTEL: +27 (0) 11 568 8281";

export function houseNo(c: Pick<WmsConsol, "consol_no">, h: Pick<WmsConsolHouse, "house_no">, i: number): string {
  return h.house_no || `${c.consol_no}-H${String(i + 1).padStart(2, "0")}`;
}

export function consolTotals(houses: WmsConsolHouse[]) {
  return houses.reduce(
    (t, h) => ({
      pieces: t.pieces + (Number(h.pieces) || 0),
      gross: t.gross + (Number(h.gross_kg) || 0),
      chargeable: t.chargeable + (Number(h.chargeable_kg) || 0),
      cbm: t.cbm + (Number(h.volume_cbm) || 0),
    }),
    { pieces: 0, gross: 0, chargeable: 0, cbm: 0 },
  );
}

const STATUS_LABEL: Record<WmsConsol["status"], string> = {
  open: "Open",
  closed: "Closed",
  departed: "Departed",
};

/** Air consolidations: a master (MAWB) built from house shipments (HAWB),
 *  each house made of warehouse receipts. Prints MAWB, HAWBs and Manifest. */
export default function WmsConsols({ toggle }: { toggle: ReactNode }) {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const consolsQ = useWmsConsols();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<WmsConsol | "new" | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const del = useWmsMutation(wmsDb.deleteConsol);
  const ship = useWmsMutation(wmsDb.releaseConsol);

  const rows = consolsQ.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (c) =>
      !q ||
      [c.consol_no, c.master_no, c.flight_no, c.origin, c.destination, ...c.houses.map((h) => `${h.house_no} ${h.consignee}`)]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );

  const columns: DataColumn<WmsConsol>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (c) => (
        <RowActions
          onEdit={() => setEditing(c)}
          onDelete={() => {
            if (!confirm(`Delete ${c.consol_no}? (Goods already released stay released.)`)) return;
            del.mutate(c.id, { onSuccess: () => toast("Consolidation deleted"), onError: (e) => error(e.message) });
          }}
        />
      ),
    },
    { key: "no", header: "Consol No", width: 110, render: (c) => <b>{c.consol_no}</b>, sortValue: (c) => c.consol_no },
    { key: "mawb", header: "MAWB", width: 130, render: (c) => c.master_no || "—", sortValue: (c) => c.master_no ?? "" },
    { key: "route", header: "Route", width: 110, render: (c) => `${c.origin || "—"} → ${c.destination || "—"}` },
    { key: "flight", header: "Flight", width: 100, render: (c) => c.flight_no || "—" },
    { key: "date", header: "Flight date", width: 100, render: (c) => formatDate(c.flight_date), sortValue: (c) => c.flight_date ?? "" },
    { key: "houses", header: "Houses", width: 70, render: (c) => c.houses.length },
    { key: "pcs", header: "Pieces", width: 70, render: (c) => consolTotals(c.houses).pieces },
    { key: "kg", header: "Gross kg", width: 90, render: (c) => qty(consolTotals(c.houses).gross) },
    { key: "chg", header: "Chg kg", width: 90, render: (c) => qty(consolTotals(c.houses).chargeable) },
    { key: "status", header: "Status", width: 100, render: (c) => <span className={`badge ${c.status === "departed" ? "completed" : c.status === "closed" ? "sent" : "open"}`}>{STATUS_LABEL[c.status]}</span> },
    {
      key: "docs",
      header: "Documents",
      width: 130,
      render: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Popover label="Print ▾">
            {(close) => (
              <div className="ui-pop-list">
                <button type="button" onClick={() => { close(); navigate(`/wms/print/mawb/${c.id}`); }}>MAWB</button>
                <button type="button" onClick={() => { close(); navigate(`/wms/print/manifest/${c.id}`); }}>Manifest</button>
                <button type="button" onClick={() => { close(); navigate(`/wms/print/hawb/${c.id}`); }}>All HAWBs</button>
                {c.houses.map((h, i) => (
                  <button key={i} type="button" onClick={() => { close(); navigate(`/wms/print/hawb/${c.id}?house=${i}`); }}>
                    HAWB {houseNo(c, h, i)}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        </div>
      ),
    },
    {
      key: "ship",
      header: "Warehouse",
      width: 150,
      render: (c) =>
        c.status === "departed" ? (
          <span className="hint">Released</span>
        ) : (
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm(`Release every receipt on ${c.consol_no} from the warehouse and mark it departed?`)) return;
              ship.mutate(c.id, {
                onSuccess: () => toast(`${c.consol_no} released from the warehouse`),
                onError: (er) => error(er.message),
              });
            }}
          >
            Release &amp; depart
          </button>
        ),
    },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search consol, MAWB, HAWB…" />}
        filters={toggle}
        count={consolsQ.isLoading ? undefined : `${filtered.length} consolidation${filtered.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setEditing("new")}>
            + New consolidation
          </button>
        }
      />
      <div className="panel">
        {consolsQ.isLoading ? (
          <Loading />
        ) : consolsQ.isError ? (
          <ErrorNote error={consolsQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>No consolidations yet. + New consolidation groups receipts into houses under one MAWB.</EmptyState>
        ) : (
          <DataTable
            tableKey="wms-consols"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(c) => c.id}
            onRowClick={(c) => setEditing(c)}
          />
        )}
      </div>
      {editing !== null && <ConsolEditModal consol={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const blankConsol = (): WmsConsolInput => ({
  mode: "air",
  warehouse_id: null,
  job_id: null,
  status: "open",
  master_no: null,
  carrier: null,
  flight_no: null,
  flight_date: null,
  origin: null,
  origin_name: null,
  destination: "JNB",
  routing: [],
  shipper: null,
  consignee: null,
  accounting_info: "FREIGHT COLLECT",
  agent_name: null,
  agent_iata: null,
  agent_account: null,
  currency: "USD",
  charges_code: "CC",
  declared_carriage: "NVD",
  declared_customs: "NCV",
  insurance: "NIL",
  handling_info: null,
  rate_class: "K",
  rate_charge: null,
  total_charge: "AS AGREED",
  signed_by: null,
  executed_on: null,
  executed_place: null,
  notes: null,
});

function ConsolEditModal({ consol, onClose }: { consol: WmsConsol | null; onClose: () => void }) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const save = useWmsMutation((v: { id?: string; values: WmsConsolInput; houses: WmsConsolHouse[] }) =>
    wmsDb.saveConsol(v.id, v.values, v.houses),
  );
  const [f, setF] = useState<WmsConsolInput>(() => {
    if (!consol) return blankConsol();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _i, consol_no: _n, created_at: _c, houses: _h, ...rest } = consol;
    return rest;
  });
  const [houses, setHouses] = useState<WmsConsolHouse[]>(consol?.houses ?? []);
  const [adding, setAdding] = useState(false);
  const set = <K extends keyof WmsConsolInput>(k: K, v: WmsConsolInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const s = (k: keyof WmsConsolInput) => (f[k] as string | null) ?? "";
  const txt = (k: keyof WmsConsolInput, label: string, opts?: { rows?: number; placeholder?: string }) => (
    <div className="field">
      <label>{label}</label>
      {opts?.rows ? (
        <textarea rows={opts.rows} value={s(k)} placeholder={opts.placeholder} onChange={(e) => set(k, orNull(e.target.value) as never)} />
      ) : (
        <input value={s(k)} placeholder={opts?.placeholder} onChange={(e) => set(k, orNull(e.target.value) as never)} />
      )}
    </div>
  );
  const setHouse = (i: number, patch: Partial<WmsConsolHouse>) =>
    setHouses((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const legs = [0, 1, 2].map((i) => f.routing[i] ?? { to: "", by: "" });
  const setLeg = (i: number, k: "to" | "by", v: string) => {
    const next = legs.map((l, j) => (j === i ? { ...l, [k]: v } : l));
    set("routing", next.filter((l) => l.to || l.by));
  };
  const t = consolTotals(houses);

  // Receipts already in another house of this consol can't be added twice.
  const used = new Set(houses.flatMap((h) => h.receipt_ids));
  const available = (receiptsQ.data ?? []).filter((r) => r.on_hand > 0 && !used.has(r.id));

  function addHouseFrom(ids: string[]) {
    const recs = (receiptsQ.data ?? []).filter((r) => ids.includes(r.id));
    if (recs.length === 0) return;
    const c = lk.client(recs[0].client_id);
    const sup = lk.supplier(recs[0].supplier_id);
    const gross = recs.reduce((x, r) => x + r.on_hand_kg, 0);
    const cbm = recs.reduce((x, r) => x + r.on_hand_cbm, 0);
    const block = (co?: { company: string; address?: string | null; phone?: string | null; company_phone?: string | null } | null) =>
      co ? [co.company, co.address, co.company_phone || co.phone ? `TEL: ${co.company_phone || co.phone}` : null].filter(Boolean).join("\n") : null;
    setHouses((hs) => [
      ...hs,
      {
        position: hs.length,
        house_no: null,
        client_id: recs[0].client_id,
        shipper: block(sup),
        consignee: block(c),
        accounting_info: EXPAC_NOTIFY,
        nature_of_goods: [...new Set(recs.map((r) => r.description).filter(Boolean))].join(", ") || null,
        handling_info: null,
        pieces: recs.reduce((x, r) => x + r.on_hand, 0),
        gross_kg: round(gross, 2),
        chargeable_kg: round(Math.max(gross, cbm * VOLUMETRIC_FACTOR), 1),
        volume_cbm: round(cbm, 3),
        receipt_ids: recs.map((r) => r.id),
      },
    ]);
    setAdding(false);
  }

  function submit() {
    if (houses.length === 0 && !confirm("No houses yet — save the master anyway?")) return;
    save.mutate(
      { id: consol?.id, values: f, houses },
      {
        onSuccess: () => {
          toast("Consolidation saved");
          onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title={consol ? `Consolidation ${consol.consol_no}` : "New air consolidation"} onClose={onClose} wide stickyHeader>
      <h4 className="wms-subhead" style={{ marginTop: 0 }}>Master air waybill</h4>
      <div className="grid4">
        {txt("master_no", "MAWB number", { placeholder: "176-12345675" })}
        {txt("carrier", "Issued by (carrier)")}
        {txt("flight_no", "Flight / ID")}
        <div className="field">
          <label>Flight date</label>
          <DateInput value={f.flight_date ?? ""} onChange={(v) => set("flight_date", orNull(v))} />
        </div>
      </div>
      <div className="grid4">
        {txt("origin", "Departure airport code", { placeholder: "HKG" })}
        {txt("origin_name", "Airport of departure (name)", { placeholder: "HONG KONG" })}
        {txt("destination", "Destination airport code", { placeholder: "JNB" })}
        <div className="field">
          <label>Status</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value as WmsConsol["status"])}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="wms-legs">
        <label>Routing (To / By)</label>
        {legs.map((l, i) => (
          <div key={i} className="wms-leg">
            <input value={l.to} placeholder={i === 0 ? "JNB" : "To"} onChange={(e) => setLeg(i, "to", e.target.value.toUpperCase())} />
            <input value={l.by} placeholder={i === 0 ? "By first carrier" : "By"} onChange={(e) => setLeg(i, "by", e.target.value)} />
          </div>
        ))}
      </div>
      <div className="grid2">
        {txt("shipper", "Shipper's name and address", { rows: 4 })}
        {txt("consignee", "Consignee's name and address", { rows: 4 })}
      </div>
      <div className="grid2">
        {txt("accounting_info", "Accounting information (notify party)", { rows: 4 })}
        <div>
          {txt("agent_name", "Issuing carrier's agent name and city")}
          <div className="grid2">
            {txt("agent_iata", "Agent's IATA code")}
            {txt("agent_account", "Account no")}
          </div>
        </div>
      </div>
      <div className="grid4" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {txt("currency", "Currency")}
        <div className="field">
          <label>Charges</label>
          <select value={f.charges_code} onChange={(e) => set("charges_code", e.target.value as "PP" | "CC")}>
            <option value="CC">CC (collect)</option>
            <option value="PP">PP (prepaid)</option>
          </select>
        </div>
        {txt("declared_carriage", "Decl. value carriage")}
        {txt("declared_customs", "Decl. value customs")}
        {txt("insurance", "Insurance")}
        {txt("rate_class", "Rate class")}
      </div>
      <div className="grid4">
        {txt("rate_charge", "Rate / charge")}
        {txt("total_charge", "Total")}
        {txt("signed_by", "Signature of shipper or agent")}
        <div className="field">
          <label>Executed on</label>
          <DateInput value={f.executed_on ?? ""} onChange={(v) => set("executed_on", orNull(v))} />
        </div>
      </div>
      <div className="grid4">
        {txt("executed_place", "At (place)", { placeholder: "HKG" })}
        <div className="field" style={{ gridColumn: "span 3" }}>
          <label>Handling information</label>
          <input value={s("handling_info")} onChange={(e) => set("handling_info", orNull(e.target.value))} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Shipment (master job, optional)</label>
          <select value={f.job_id ?? ""} onChange={(e) => set("job_id", orNull(e.target.value))}>
            <option value="">—</option>
            {lk.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.reference}
                {j.client?.company ? ` — ${j.client.company}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Warehouse</label>
          <select value={f.warehouse_id ?? ""} onChange={(e) => set("warehouse_id", orNull(e.target.value))}>
            <option value="">—</option>
            {lk.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h4 className="wms-subhead">
        Houses (HAWB) — {houses.length} · {t.pieces} pcs · {qty(t.gross)} kg gross · {qty(t.chargeable)} kg chargeable
      </h4>
      {houses.map((h, i) => (
        <div key={i} className="wms-house">
          <div className="wms-house-head">
            <b>House {i + 1}</b>
            <span className="hint">
              {h.receipt_ids.length
                ? `Receipts: ${h.receipt_ids.map((id) => (receiptsQ.data ?? []).find((r) => r.id === id)?.receipt_no ?? "?").join(", ")}`
                : "No receipts linked"}
            </span>
            <button type="button" className="link-btn" onClick={() => setHouses((hs) => hs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <div className="grid4">
            <div className="field">
              <label>HAWB number</label>
              <input value={h.house_no ?? ""} placeholder={consol ? houseNo(consol, h, i) : "Auto"} onChange={(e) => setHouse(i, { house_no: orNull(e.target.value) })} />
            </div>
            <div className="field">
              <label>Pieces</label>
              <input type="number" value={h.pieces} onChange={(e) => setHouse(i, { pieces: Number(e.target.value) || 0 })} />
            </div>
            <div className="field">
              <label>Gross kg</label>
              <input type="number" step="any" value={h.gross_kg} onChange={(e) => setHouse(i, { gross_kg: Number(e.target.value) || 0 })} />
            </div>
            <div className="field">
              <label>Chargeable kg</label>
              <input type="number" step="any" value={h.chargeable_kg} onChange={(e) => setHouse(i, { chargeable_kg: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>Shipper</label>
              <textarea rows={3} value={h.shipper ?? ""} onChange={(e) => setHouse(i, { shipper: orNull(e.target.value) })} />
            </div>
            <div className="field">
              <label>Consignee</label>
              <textarea rows={3} value={h.consignee ?? ""} onChange={(e) => setHouse(i, { consignee: orNull(e.target.value) })} />
            </div>
            <div className="field">
              <label>Accounting information</label>
              <textarea rows={3} value={h.accounting_info ?? ""} onChange={(e) => setHouse(i, { accounting_info: orNull(e.target.value) })} />
            </div>
          </div>
          <div className="field">
            <label>Nature and quantity of goods (incl. dimensions or volume)</label>
            <input value={h.nature_of_goods ?? ""} onChange={(e) => setHouse(i, { nature_of_goods: orNull(e.target.value) })} />
          </div>
        </div>
      ))}
      {adding ? (
        <AddHouse receipts={available} lkClient={lk.clientName} onAdd={addHouseFrom} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
          + Add house from warehouse receipts
        </button>
      )}

      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function AddHouse({
  receipts,
  lkClient,
  onAdd,
  onCancel,
}: {
  receipts: WmsReceipt[];
  lkClient: (id: string | null) => string;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div className="wms-house">
      <div className="wms-house-head">
        <b>Pick the receipts in this house</b>
        <span className="hint">Usually one consignee per house</span>
      </div>
      {receipts.length === 0 ? (
        <p className="hint">No receipts on hand to add.</p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Receipt</th>
              <th>Customer</th>
              <th>Description</th>
              <th>Pieces</th>
              <th>Kg</th>
              <th>CBM</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={ids.includes(r.id)}
                    onChange={(e) => setIds((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                  />
                </td>
                <td>{r.receipt_no}</td>
                <td>{lkClient(r.client_id)}</td>
                <td>{r.description || "—"}</td>
                <td>{r.on_hand}</td>
                <td>{qty(r.on_hand_kg)}</td>
                <td>{qty(r.on_hand_cbm, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-sm" disabled={ids.length === 0} onClick={() => onAdd(ids)}>
          Add house
        </button>
        <button type="button" className="btn outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
