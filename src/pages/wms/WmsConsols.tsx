import { useEffect, useState, type ReactNode } from "react";
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
  CONSOL_MODE_LABEL,
  PACKAGE_TYPES,
  qty,
  round,
  useWmsConsols,
  useWmsMutation,
  useWmsReceipts,
  wmCbm,
  wmsDb,
  type ConsolMode,
  type WmsConsol,
  type WmsConsolHouse,
  type WmsConsolInput,
  type WmsContainer,
  type WmsReceipt,
} from "../../lib/wms";
import { orNull, useWmsLookups } from "./shared";
import { useQuotes } from "../../lib/hooks";
import { isShipmentComplete, type Job } from "../../lib/types";
import { houseFromShipment, jobsOnMasters, shipmentFitsConsol, shipmentHouseNo } from "./houseFromShipment";

/** Default Accounting Information / notify party on a house: ExPac (from the
 *  air waybill template ExPac supplied, 2026-10-05). */
export const EXPAC_NOTIFY =
  "NOTIFY PARTY:\nEXPAC FORWARDING\nADD: ECO PARK BLVD, WITCH-HAZEL AVE, HIGHVELD\nCENTURION, 0144, SOUTH AFRICA\nTEL: +27 (0) 11 568 8281";

export const CONTAINER_TYPES = ["20GP", "40GP", "40HC", "20RF", "40RF", "20OT", "40OT", "20FR", "40FR", "45HC"];

export function houseNo(c: Pick<WmsConsol, "consol_no">, h: Pick<WmsConsolHouse, "house_no">, i: number): string {
  return h.house_no || `${c.consol_no}-H${String(i + 1).padStart(2, "0")}`;
}

/** "MAWB" on air, "MBL" on sea; houses "HAWB" / "HBL". */
export const masterLabel = (m: ConsolMode) => (m === "air" ? "MAWB" : "MBL");
export const houseLabel = (m: ConsolMode) => (m === "air" ? "HAWB" : "HBL");

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

/** Consolidations, one list per mode: Air (MAWB + HAWBs), LCL groupage and
 *  FCL consolidation (MBL + HBLs). Houses are built from warehouse receipts;
 *  "Release & depart" books them all out of the warehouse. */
export default function WmsConsols({
  toggle,
  mode,
  openId,
  onOpened,
}: {
  toggle: ReactNode;
  mode: ConsolMode;
  /** Open this consolidation's editor once loaded (deep link). */
  openId?: string | null;
  onOpened?: () => void;
}) {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const consolsQ = useWmsConsols();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<WmsConsol | "new" | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const del = useWmsMutation(wmsDb.deleteConsol);
  const ship = useWmsMutation(wmsDb.releaseConsol);
  useEffect(() => {
    if (!openId) return;
    const c = consolsQ.data?.find((x) => x.id === openId);
    if (c) {
      setEditing(c);
      onOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, consolsQ.data]);
  const sea = mode !== "air";
  const ML = masterLabel(mode);
  const HL = houseLabel(mode);

  const rows = (consolsQ.data ?? []).filter((c) => c.mode === mode);
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (c) =>
      !q ||
      [
        c.consol_no,
        c.master_no,
        c.flight_no,
        c.vessel,
        c.voyage_no,
        c.origin,
        c.destination,
        c.port_of_loading,
        c.port_of_discharge,
        ...(c.containers ?? []).map((k) => k.container_no),
        ...c.houses.map((h) => `${h.house_no} ${h.consignee}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );

  const go = (path: string, close: () => void) => {
    close();
    navigate(path);
  };

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
    { key: "master", header: ML, width: 130, render: (c) => c.master_no || "—", sortValue: (c) => c.master_no ?? "" },
    sea
      ? {
          key: "route",
          header: "POL → POD",
          width: 130,
          render: (c) => `${c.port_of_loading || "—"} → ${c.port_of_discharge || "—"}`,
        }
      : { key: "route", header: "Route", width: 110, render: (c) => `${c.origin || "—"} → ${c.destination || "—"}` },
    sea
      ? { key: "vessel", header: "Vessel / voyage", width: 150, render: (c) => [c.vessel, c.voyage_no].filter(Boolean).join(" / ") || "—" }
      : { key: "flight", header: "Flight", width: 100, render: (c) => c.flight_no || "—" },
    sea
      ? { key: "date", header: "ETD", width: 100, render: (c) => formatDate(c.etd), sortValue: (c) => c.etd ?? "" }
      : { key: "date", header: "Flight date", width: 100, render: (c) => formatDate(c.flight_date), sortValue: (c) => c.flight_date ?? "" },
    ...(sea
      ? [
          {
            key: "cont",
            header: "Containers",
            width: 170,
            render: (c: WmsConsol) => (c.containers ?? []).map((k) => `${k.container_no}${k.type ? ` (${k.type})` : ""}`).join(", ") || "—",
          },
        ]
      : []),
    { key: "houses", header: `${HL}s`, width: 70, render: (c) => c.houses.length },
    { key: "pcs", header: "Pieces", width: 70, render: (c) => consolTotals(c.houses).pieces },
    { key: "kg", header: "Gross kg", width: 90, render: (c) => qty(consolTotals(c.houses).gross) },
    sea
      ? { key: "cbm", header: "CBM", width: 80, render: (c) => qty(consolTotals(c.houses).cbm, 3) }
      : { key: "chg", header: "Chg kg", width: 90, render: (c) => qty(consolTotals(c.houses).chargeable) },
    {
      key: "status",
      header: "Status",
      width: 100,
      render: (c) => (
        <span className={`badge ${c.status === "departed" ? "completed" : c.status === "closed" ? "sent" : "open"}`}>
          {STATUS_LABEL[c.status]}
        </span>
      ),
    },
    {
      key: "docs",
      header: "Documents",
      width: 130,
      render: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Popover label="Print ▾">
            {(close) => (
              <div className="ui-pop-list">
                {sea ? (
                  <button type="button" onClick={() => go(`/wms/print/sea-manifest/${c.id}`, close)}>
                    Cargo manifest
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => go(`/wms/print/mawb/${c.id}`, close)}>
                      MAWB
                    </button>
                    <button type="button" onClick={() => go(`/wms/print/manifest/${c.id}`, close)}>
                      Manifest
                    </button>
                  </>
                )}
                <button type="button" onClick={() => go(`/wms/print/loadplan/${c.id}`, close)}>
                  Load plan (warehouse)
                </button>
                <button type="button" onClick={() => go(`/wms/print/${sea ? "hbl" : "hawb"}/${c.id}`, close)}>
                  All {HL}s
                </button>
                {c.houses.map((h, i) => (
                  <button key={i} type="button" onClick={() => go(`/wms/print/${sea ? "hbl" : "hawb"}/${c.id}?house=${i}`, close)}>
                    {HL} {houseNo(c, h, i)}
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

  const noun = CONSOL_MODE_LABEL[mode].toLowerCase();
  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder={`Search consol, ${ML}, ${HL}${sea ? ", container" : ""}…`} />}
        filters={toggle}
        count={consolsQ.isLoading ? undefined : `${filtered.length} ${noun}${filtered.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setEditing("new")}>
            + New {mode === "lcl" ? "groupage" : "consolidation"}
          </button>
        }
      />
      <div className="panel">
        {consolsQ.isLoading ? (
          <Loading />
        ) : consolsQ.isError ? (
          <ErrorNote error={consolsQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>
            No {noun}s yet. + New {mode === "lcl" ? "groupage" : "consolidation"} groups warehouse receipts into houses ({HL}s) under one {ML}.
          </EmptyState>
        ) : (
          <DataTable
            tableKey={`wms-consols-${mode}`}
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(c) => c.id}
            onRowClick={(c) => setEditing(c)}
          />
        )}
      </div>
      {editing !== null && (
        <ConsolEditModal consol={editing === "new" ? null : editing} mode={mode} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

export const blankConsol = (mode: ConsolMode): WmsConsolInput => ({
  mode,
  warehouse_id: null,
  job_id: null,
  status: "open",
  master_no: null,
  carrier: null,
  flight_no: null,
  flight_date: null,
  origin: null,
  origin_name: null,
  destination: mode === "air" ? "JNB" : null,
  routing: [],
  shipper: null,
  consignee: null,
  accounting_info: mode === "air" ? "FREIGHT COLLECT" : null,
  agent_name: null,
  agent_iata: null,
  agent_account: null,
  currency: "USD",
  charges_code: "CC",
  declared_carriage: "NVD",
  declared_customs: "NCV",
  insurance: "NIL",
  handling_info: null,
  rate_class: mode === "air" ? "K" : null,
  rate_charge: null,
  total_charge: "AS AGREED",
  signed_by: null,
  executed_on: null,
  executed_place: null,
  notes: null,
  vessel: null,
  voyage_no: null,
  place_of_receipt: null,
  port_of_loading: null,
  port_of_discharge: mode === "air" ? null : "ZADUR",
  place_of_delivery: null,
  etd: null,
  eta: null,
  co_loader: null,
  containers: [],
});

function ConsolEditModal({ consol, mode, onClose }: { consol: WmsConsol | null; mode: ConsolMode; onClose: () => void }) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const sea = mode !== "air";
  const ML = masterLabel(mode);
  const HL = houseLabel(mode);
  const save = useWmsMutation((v: { id?: string; values: WmsConsolInput; houses: WmsConsolHouse[] }) =>
    wmsDb.saveConsol(v.id, v.values, v.houses),
  );
  const [f, setF] = useState<WmsConsolInput>(() => {
    if (!consol) return blankConsol(mode);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _i, consol_no: _n, created_at: _c, houses: _h, ...rest } = consol;
    return { ...blankConsol(mode), ...rest };
  });
  const [houses, setHouses] = useState<WmsConsolHouse[]>(consol?.houses ?? []);
  const [adding, setAdding] = useState(false);
  const [addingJobs, setAddingJobs] = useState(false);
  const quotesQ = useQuotes();
  const consolsAll = useWmsConsols().data ?? [];
  const set = <K extends keyof WmsConsolInput>(k: K, v: WmsConsolInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const s = (k: keyof WmsConsolInput) => (f[k] as string | null | undefined) ?? "";
  const txt = (k: keyof WmsConsolInput, label: string, opts?: { rows?: number; placeholder?: string; upper?: boolean }) => (
    <div className="field">
      <label>{label}</label>
      {opts?.rows ? (
        <textarea rows={opts.rows} value={s(k)} placeholder={opts.placeholder} onChange={(e) => set(k, orNull(e.target.value) as never)} />
      ) : (
        <input
          value={s(k)}
          placeholder={opts?.placeholder}
          onChange={(e) => set(k, orNull(opts?.upper ? e.target.value.toUpperCase() : e.target.value) as never)}
        />
      )}
    </div>
  );
  const date = (k: keyof WmsConsolInput, label: string) => (
    <div className="field">
      <label>{label}</label>
      <DateInput value={s(k)} onChange={(v) => set(k, orNull(v) as never)} />
    </div>
  );
  const setHouse = (i: number, patch: Partial<WmsConsolHouse>) =>
    setHouses((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const legs = [0, 1, 2].map((i) => f.routing[i] ?? { to: "", by: "" });
  const setLeg = (i: number, k: "to" | "by", v: string) => {
    const next = legs.map((l, j) => (j === i ? { ...l, [k]: v } : l));
    set("routing", next.filter((l) => l.to || l.by));
  };
  const containers = f.containers ?? [];
  const setContainer = (i: number, patch: Partial<WmsContainer>) =>
    set(
      "containers",
      containers.map((k, j) => (j === i ? { ...k, ...patch } : k)),
    );
  const t = consolTotals(houses);

  // A receipt can only sit in one house of this consolidation.
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
    const types = [...new Set(recs.map((r) => r.package_type).filter(Boolean))];
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
        marks: [...new Set(recs.map((r) => r.marks).filter(Boolean))].join("\n") || null,
        package_type: types.length === 1 ? types[0] : types.length ? "Packages" : null,
        container_no: containers.length === 1 ? containers[0].container_no : null,
        pieces: recs.reduce((x, r) => x + r.on_hand, 0),
        gross_kg: round(gross, 2),
        // Air: chargeable kg (1 CBM = 167 kg). Sea: W/M revenue tons (1 CBM = 1 000 kg).
        chargeable_kg: sea ? round(wmCbm(cbm, gross), 3) : round(Math.max(gross, cbm * VOLUMETRIC_FACTOR), 1),
        volume_cbm: round(cbm, 3),
        receipt_ids: recs.map((r) => r.id),
      },
    ]);
    setAdding(false);
  }

  // Active shipments of this mode not already on another master or in this one.
  const taken = jobsOnMasters(consolsAll.filter((c) => c.status !== "departed"), consol?.id);
  const inThis = new Set(houses.map((h) => h.job_id).filter(Boolean));
  const candidates = lk.jobs.filter(
    (j) => !isShipmentComplete(j) && shipmentFitsConsol(j.mode, mode) && !taken.has(j.id) && !inThis.has(j.id),
  );
  const quoteOf = (id: string | null) => (id ? (quotesQ.data ?? []).find((q) => q.id === id) : undefined);

  function addFromJobs(ids: string[]) {
    const add = lk.jobs
      .filter((j) => ids.includes(j.id))
      .map((j, i) =>
        houseFromShipment({
          job: j,
          quote: quoteOf(j.quote_id),
          consolMode: mode,
          receipts: (receiptsQ.data ?? []).filter((r) => !used.has(r.id)),
          client: lk.client,
          supplier: lk.supplier,
          containerNo: containers.length === 1 ? containers[0].container_no : null,
          position: houses.length + i,
        }),
      );
    setHouses((hs) => [...hs, ...add]);
    setAddingJobs(false);
  }

  function submit() {
    if (houses.length === 0 && !confirm(`No ${HL}s yet — save the master anyway?`)) return;
    const values: WmsConsolInput = {
      ...f,
      mode,
      containers: containers.filter((k) => k.container_no || k.type || k.seal_no),
    };
    save.mutate(
      { id: consol?.id, values, houses },
      {
        onSuccess: () => {
          toast("Consolidation saved");
          onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }

  const title = consol ? `${CONSOL_MODE_LABEL[mode]} ${consol.consol_no}` : `New ${CONSOL_MODE_LABEL[mode].toLowerCase()}`;

  return (
    <Modal title={title} onClose={onClose} wide stickyHeader>
      {sea ? (
        <>
          <h4 className="wms-subhead" style={{ marginTop: 0 }}>
            Master bill of lading
          </h4>
          <div className="grid4">
            {txt("master_no", "MBL number")}
            {txt("carrier", "Shipping line")}
            {mode === "lcl" ? txt("co_loader", "Co-loader / consolidator") : txt("agent_name", "Origin agent")}
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
          <div className="grid4">
            {txt("vessel", "Vessel")}
            {txt("voyage_no", "Voyage no")}
            {date("etd", "ETD")}
            {date("eta", "ETA")}
          </div>
          <div className="grid4">
            {txt("place_of_receipt", "Place of receipt")}
            {txt("port_of_loading", "Port of loading", { placeholder: "CNSHA", upper: true })}
            {txt("port_of_discharge", "Port of discharge", { placeholder: "ZADUR", upper: true })}
            {txt("place_of_delivery", "Place of delivery")}
          </div>
          <div className="wms-containers">
            <label>Containers</label>
            {containers.map((k, i) => (
              <div key={i} className="wms-container-row">
                <input placeholder="Container no" value={k.container_no} onChange={(e) => setContainer(i, { container_no: e.target.value.toUpperCase() })} />
                <select value={k.type} onChange={(e) => setContainer(i, { type: e.target.value })}>
                  <option value="">Type</option>
                  {CONTAINER_TYPES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input placeholder="Seal no" value={k.seal_no} onChange={(e) => setContainer(i, { seal_no: e.target.value.toUpperCase() })} />
                <button type="button" className="row-icon-btn danger" title="Remove" onClick={() => set("containers", containers.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn outline btn-sm"
              onClick={() => set("containers", [...containers, { container_no: "", type: mode === "fcl" ? "40HC" : "", seal_no: "" }])}
            >
              + Add container
            </button>
          </div>
          <div className="grid3">
            {txt("shipper", "Shipper (on the MBL)", { rows: 4 })}
            {txt("consignee", "Consignee (on the MBL)", { rows: 4 })}
            {txt("accounting_info", "Notify party", { rows: 4 })}
          </div>
          <div className="grid4">
            <div className="field">
              <label>Freight</label>
              <select value={f.charges_code} onChange={(e) => set("charges_code", e.target.value as "PP" | "CC")}>
                <option value="CC">Freight collect</option>
                <option value="PP">Freight prepaid</option>
              </select>
            </div>
            {txt("signed_by", "Signed for the carrier (issuer)")}
            {txt("executed_place", "Place of issue")}
            {date("executed_on", "Date of issue")}
          </div>
          <div className="field">
            <label>Remarks (printed on the HBLs)</label>
            <input value={s("handling_info")} onChange={(e) => set("handling_info", orNull(e.target.value))} />
          </div>
        </>
      ) : (
        <>
          <h4 className="wms-subhead" style={{ marginTop: 0 }}>
            Master air waybill
          </h4>
          <div className="grid4">
            {txt("master_no", "MAWB number", { placeholder: "176-12345675" })}
            {txt("carrier", "Issued by (carrier)")}
            {txt("flight_no", "Flight / ID")}
            {date("flight_date", "Flight date")}
          </div>
          <div className="grid4">
            {txt("origin", "Departure airport code", { placeholder: "HKG", upper: true })}
            {txt("origin_name", "Airport of departure (name)", { placeholder: "HONG KONG" })}
            {txt("destination", "Destination airport code", { placeholder: "JNB", upper: true })}
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
            {date("executed_on", "Executed on")}
          </div>
          <div className="grid4">
            {txt("executed_place", "At (place)", { placeholder: "HKG" })}
            <div className="field" style={{ gridColumn: "span 3" }}>
              <label>Handling information</label>
              <input value={s("handling_info")} onChange={(e) => set("handling_info", orNull(e.target.value))} />
            </div>
          </div>
        </>
      )}
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
        Houses ({HL}) — {houses.length} · {t.pieces} pcs · {qty(t.gross)} kg
        {sea ? ` · ${qty(t.cbm, 3)} CBM` : ` · ${qty(t.chargeable)} kg chargeable`}
      </h4>
      {houses.map((h, i) => (
        <div key={i} className="wms-house">
          <div className="wms-house-head">
            <b>
              {HL} {i + 1}
            </b>
            {h.job_id && <span className="badge sent">Shipment {lk.jobRef(h.job_id)}</span>}
            <span className="hint">
              {h.receipt_ids.length
                ? `Receipts: ${h.receipt_ids.map((id) => (receiptsQ.data ?? []).find((r) => r.id === id)?.receipt_no ?? "?").join(", ")}`
                : "No warehouse receipts"}
            </span>
            <select
              value={h.issued_by ?? "expac"}
              onChange={(e) => setHouse(i, { issued_by: e.target.value as "expac" | "agent" })}
              title={`Who issued this ${HL}`}
              style={{ width: "auto", marginLeft: "auto" }}
            >
              <option value="expac">{HL} issued by ExPac</option>
              <option value="agent">{HL} issued by origin agent</option>
            </select>
            <button type="button" className="link-btn" onClick={() => setHouses((hs) => hs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <div className="grid4" style={sea ? { gridTemplateColumns: "repeat(6, minmax(0, 1fr))" } : undefined}>
            <div className="field">
              <label>{HL} number</label>
              <input value={h.house_no ?? ""} placeholder={consol ? houseNo(consol, h, i) : "Auto"} onChange={(e) => setHouse(i, { house_no: orNull(e.target.value) })} />
            </div>
            <div className="field">
              <label>Pieces</label>
              <input type="number" value={h.pieces} onChange={(e) => setHouse(i, { pieces: Number(e.target.value) || 0 })} />
            </div>
            {sea && (
              <div className="field">
                <label>Package kind</label>
                <select value={h.package_type ?? ""} onChange={(e) => setHouse(i, { package_type: orNull(e.target.value) })}>
                  <option value="">—</option>
                  {[...PACKAGE_TYPES, "Packages"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Gross kg</label>
              <input type="number" step="any" value={h.gross_kg} onChange={(e) => setHouse(i, { gross_kg: Number(e.target.value) || 0 })} />
            </div>
            {sea ? (
              <>
                <div className="field">
                  <label>CBM</label>
                  <input type="number" step="any" value={h.volume_cbm} onChange={(e) => setHouse(i, { volume_cbm: Number(e.target.value) || 0 })} />
                </div>
                <div className="field">
                  <label>Container</label>
                  <select value={h.container_no ?? ""} onChange={(e) => setHouse(i, { container_no: orNull(e.target.value) })}>
                    <option value="">—</option>
                    {containers
                      .filter((k) => k.container_no)
                      .map((k) => (
                        <option key={k.container_no} value={k.container_no}>
                          {k.container_no}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="field">
                <label>Chargeable kg</label>
                <input type="number" step="any" value={h.chargeable_kg} onChange={(e) => setHouse(i, { chargeable_kg: Number(e.target.value) || 0 })} />
              </div>
            )}
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
              <label>{sea ? "Notify party" : "Accounting information"}</label>
              <textarea rows={3} value={h.accounting_info ?? ""} onChange={(e) => setHouse(i, { accounting_info: orNull(e.target.value) })} />
            </div>
          </div>
          <div className={sea ? "grid2" : undefined}>
            {sea && (
              <div className="field">
                <label>Marks &amp; numbers</label>
                <input value={h.marks ?? ""} onChange={(e) => setHouse(i, { marks: orNull(e.target.value) })} />
              </div>
            )}
            <div className="field">
              <label>{sea ? "Description of goods" : "Nature and quantity of goods (incl. dimensions or volume)"}</label>
              <input value={h.nature_of_goods ?? ""} onChange={(e) => setHouse(i, { nature_of_goods: orNull(e.target.value) })} />
            </div>
          </div>
        </div>
      ))}
      {addingJobs ? (
        <AddFromShipments
          jobs={candidates}
          houseLabel={HL}
          houseNoOf={(j) => shipmentHouseNo(quoteOf(j.quote_id), mode)}
          receiptsOf={(id) => (receiptsQ.data ?? []).filter((r) => r.job_id === id && r.on_hand > 0).length}
          onAdd={addFromJobs}
          onCancel={() => setAddingJobs(false)}
        />
      ) : adding ? (
        <AddHouse receipts={available} lkClient={lk.clientName} houseLabel={HL} onAdd={addHouseFrom} onCancel={() => setAdding(false)} />
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn outline btn-sm" onClick={() => setAddingJobs(true)}>
            + Add {HL} from active shipment
          </button>
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
            + Add {HL} from warehouse receipts
          </button>
        </div>
      )}

      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="hint" style={{ textAlign: "right" }}>
        {ML} {f.master_no || "not set yet"} — save, then print the {HL}s, manifest and load plan from the list.
      </p>
    </Modal>
  );
}

function AddHouse({
  receipts,
  lkClient,
  houseLabel: HL,
  onAdd,
  onCancel,
}: {
  receipts: WmsReceipt[];
  lkClient: (id: string | null) => string;
  houseLabel: string;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div className="wms-house">
      <div className="wms-house-head">
        <b>Pick the receipts in this {HL}</b>
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
          Add {HL}
        </button>
        <button type="button" className="btn outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Picker: active shipments of this mode, each becoming one house. */
function AddFromShipments({
  jobs,
  houseLabel: HL,
  houseNoOf,
  receiptsOf,
  onAdd,
  onCancel,
}: {
  jobs: Job[];
  houseLabel: string;
  houseNoOf: (j: Job) => string | null;
  receiptsOf: (jobId: string) => number;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const shown = jobs.filter(
    (j) => !q || [j.reference, j.client?.company, j.supplier?.company, j.po_no, houseNoOf(j)].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="wms-house">
      <div className="wms-house-head">
        <b>Active shipments — each becomes one {HL}</b>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 200, marginLeft: "auto" }} />
      </div>
      {shown.length === 0 ? (
        <p className="hint">No active shipments of this mode that aren't already on a master.</p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Shipment</th>
              <th>Mode</th>
              <th>Customer</th>
              <th>Shipper</th>
              <th>{HL} on file</th>
              <th>Route</th>
              <th>In warehouse</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => {
              const n = receiptsOf(j.id);
              return (
                <tr key={j.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={ids.includes(j.id)}
                      onChange={(e) => setIds((p) => (e.target.checked ? [...p, j.id] : p.filter((x) => x !== j.id)))}
                    />
                  </td>
                  <td>
                    <b>{j.reference}</b>
                  </td>
                  <td>{j.mode}</td>
                  <td>{j.client?.company ?? "—"}</td>
                  <td>{j.supplier?.company ?? "—"}</td>
                  <td>{houseNoOf(j) || <span className="hint">— ExPac to issue</span>}</td>
                  <td>
                    {j.origin ?? "—"} → {j.destination ?? "—"}
                  </td>
                  <td>{n ? `${n} receipt${n === 1 ? "" : "s"}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-sm" disabled={ids.length === 0} onClick={() => onAdd(ids)}>
          Add {ids.length || ""} {HL}
          {ids.length === 1 ? "" : "s"}
        </button>
        <button type="button" className="btn outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
