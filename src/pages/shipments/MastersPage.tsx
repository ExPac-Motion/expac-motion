// Shipments › Masters and Houses (0164 / 0165 / 0223): two tabs on one page.
// Masters: every master shipment with its houses, house shipments (0223,
// HBL161005-1) and supplier houses (0164), cargo received against declared,
// documents, and the master total the customer is billed on. Houses: every
// house in one list, with a master picker. WMS co-loads stay under Warehouse.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DateInput from "../../components/DateInput";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useCustomerContacts } from "../../lib/customers";
import { createMessage, getCompanySettings } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { packingTotals, volumetricFactor } from "../../lib/calc";
import { sendMail, SUPPORT_BCC } from "../../lib/mail";
import { useWmsWarehouses } from "../../lib/wms";
import {
  HOUSE_STATUSES,
  HOUSE_STATUS_CLASS,
  autoHouseStatus,
  houseStatus,
  isReceivedStatus,
  useAssignReceiptHouse,
  useMastersBoard,
  useUpdateHouseSteps,
  type BoardDoc,
  type BoardHouse,
  type BoardReceipt,
  type BoardShipJob,
} from "../../lib/houses";
import { useSetMaster } from "../../lib/masters";
import { statusLabel } from "../../lib/steps";

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");
const billOf = (mode: string) => (isAir(mode) ? "HAWB" : "HBL");
const docTypes = (mode: string) => ["Commercial Invoice", "Packing List", billOf(mode)];
const SHORT: Record<string, string> = { "Commercial Invoice": "CI", "Packing List": "PL", HBL: "HBL", HAWB: "HAWB" };
const f0 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
const f2 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 2 });
const f3 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 3 });
const off = (a: number, b: number) => b > 0 && Math.abs(a - b) > 0.005;

type Filter = "open" | "docs" | "cargo" | "ready" | "all";
const FILTERS: [Filter, string][] = [
  ["open", "Open masters"],
  ["cargo", "Cargo not received"],
  ["docs", "Missing documents"],
  ["ready", "Ready to load"],
  ["all", "All, incl. delivered"],
];

interface HouseView {
  h: BoardHouse;
  receipts: BoardReceipt[];
  recv: { pieces: number; kg: number; cbm: number };
  have: string[];
  missing: string[];
  status: ReturnType<typeof houseStatus>;
  auto: ReturnType<typeof houseStatus>;
  /** Received here (a warehouse receipt) or marked received elsewhere. */
  received: boolean;
}

/** A house shipment (0223) under a master: a full shipment of its own. */
interface ShipView {
  j: BoardShipJob;
  receipts: BoardReceipt[];
  recv: { pieces: number; kg: number; cbm: number };
  declared: { pieces: number; kg: number; cbm: number };
  have: string[];
  missing: string[];
  received: boolean;
}

type Tot = { pieces: number; kg: number; cbm: number };
const ZERO: Tot = { pieces: 0, kg: 0, cbm: 0 };
const addTot = (a: Tot, b: Tot): Tot => ({ pieces: a.pieces + b.pieces, kg: a.kg + b.kg, cbm: a.cbm + b.cbm });

export default function MastersPage({ view = "masters" }: { view?: "masters" | "houses" }) {
  const boardQ = useMastersBoard();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [mode, setMode] = useState<"all" | "sea" | "air">("all");
  const [asking, setAsking] = useState<HouseView | null>(null);

  const masters = useMemo(() => {
    const d = boardQ.data;
    if (!d) return [];
    const ships = d.ships ?? [];
    const shipDocs = d.shipDocs ?? [];
    const sumReceipts = (rs: BoardReceipt[]): Tot =>
      rs.reduce((t, r) => ({ pieces: t.pieces + Number(r.pieces || 0), kg: t.kg + Number(r.gross_kg || 0), cbm: t.cbm + Number(r.volume_cbm || 0) }), ZERO);
    const quotedOf = (quoteId: string | null, jobMode: string) => {
      const items = quoteId ? d.quoted.filter((q) => q.quote_id === quoteId) : [];
      return items.length ? packingTotals(items as never, volumetricFactor(jobMode)) : null;
    };

    // Master shipments: those with supplier houses (0164) and those marked Master (0223).
    const byJob = new Map<string, BoardHouse[]>();
    for (const h of d.houses) if (h.job) byJob.set(h.job.id, [...(byJob.get(h.job.id) ?? []), h]);
    const masterJobs = new Map<string, MasterJob>();
    for (const hs of byJob.values()) masterJobs.set(hs[0].job!.id, hs[0].job!);
    for (const j of ships) if (j.shipment_kind === "master" && !j.master_job_id && !masterJobs.has(j.id)) masterJobs.set(j.id, j);

    return [...masterJobs.values()].map((job) => {
      const houses = byJob.get(job.id) ?? [];
      const types = docTypes(job.mode);
      const views: HouseView[] = houses.map((h) => {
        const receipts = d.receipts.filter((r) => r.house_id === h.id);
        const recv = sumReceipts(receipts);
        const docs: BoardDoc[] = d.docs.filter((x) => x.house_id === h.id);
        const have = types.filter((t) => docs.some((x) => x.doc_type === t));
        const missing = types.filter((t) => !have.includes(t));
        const status = houseStatus(h, receipts.length > 0, missing.length === 0);
        return {
          h,
          receipts,
          recv,
          have,
          missing,
          status,
          auto: autoHouseStatus(h, receipts.length > 0, missing.length === 0),
          received: receipts.length > 0 || isReceivedStatus(status),
        };
      });
      const shipViews: ShipView[] = ships
        .filter((j) => j.master_job_id === job.id)
        .sort((a, b) => (a.house_position ?? 0) - (b.house_position ?? 0))
        .map((j) => {
          const receipts = d.receipts.filter((r) => r.job_id === j.id);
          const q = quotedOf(j.quote_id, j.mode);
          const docs = shipDocs.filter((x) => x.job_id === j.id);
          const have = types.filter((t) => docs.some((x) => x.doc_type === t));
          return {
            j,
            receipts,
            recv: sumReceipts(receipts),
            declared: q ? { pieces: q.qty, kg: q.totalActual, cbm: q.totalCbm } : ZERO,
            have,
            missing: types.filter((t) => !have.includes(t)),
            received: receipts.length > 0,
          };
        });
      const quoted = quotedOf(job.quote_id, job.mode);
      const declared = [
        ...views.map((v) => ({ pieces: Number(v.h.pieces || 0), kg: Number(v.h.gross_kg || 0), cbm: Number(v.h.volume_cbm || 0) })),
        ...shipViews.map((v) => v.declared),
      ].reduce(addTot, ZERO);
      // What the customer is billed on: received figures once checked in, declared before.
      const billed = [
        ...views.map((v) => (v.receipts.length ? v.recv : { pieces: Number(v.h.pieces || 0), kg: Number(v.h.gross_kg || 0), cbm: Number(v.h.volume_cbm || 0) })),
        ...shipViews.map((v) => (v.receipts.length ? v.recv : v.declared)),
      ].reduce(addTot, ZERO);
      const allChecked = views.every((v) => v.receipts.length > 0) && shipViews.every((v) => v.receipts.length > 0);
      const unassigned = views.length ? d.receipts.filter((r) => r.job_id === job.id && !r.house_id) : [];
      return { job, views, shipViews, quoted, declared, billed, allChecked, unassigned };
    });
  }, [boardQ.data]);

  const n = search.trim().toLowerCase();
  const shown = masters.filter(({ job, views, shipViews }) => {
    const delivered = job.milestone === "Delivered";
    const all = [...views.map((v) => ({ received: v.received, missing: v.missing.length, loaded: !!v.h.loaded_at })), ...shipViews.map((v) => ({ received: v.received, missing: v.missing.length, loaded: false }))];
    if (filter !== "all" && delivered) return false;
    if (mode === "air" && !isAir(job.mode)) return false;
    if (mode === "sea" && isAir(job.mode)) return false;
    if (filter === "cargo" && !all.some((v) => !v.received)) return false;
    if (filter === "docs" && !all.some((v) => v.missing > 0)) return false;
    if (filter === "ready" && !(all.length > 0 && all.every((v) => v.received && v.missing === 0 && !v.loaded))) return false;
    if (!n) return true;
    return [
      job.reference,
      job.client?.company,
      job.awb_mbl,
      job.container_no,
      ...views.flatMap((v) => [v.h.house_no, v.h.supplier?.company, v.h.carrier_house_no]),
      ...shipViews.flatMap((v) => [v.j.house_no, v.j.reference, v.j.supplier?.company, v.j.po_no]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(n);
  });

  // Houses tab: every house, supplier houses (0164) and house shipments (0223).
  const houseRows = shown.flatMap((m) => [
    ...m.shipViews.map((v) => ({ key: v.j.id, master: m.job, ship: v as ShipView | null, legacy: null as HouseView | null })),
    ...m.views.map((v) => ({ key: v.h.id, master: m.job, ship: null as ShipView | null, legacy: v as HouseView | null })),
  ]);
  const mastersOf = (clientId: string | null, jobMode: string) =>
    masters.filter((m) => m.job.client_id === clientId && isAir(m.job.mode) === isAir(jobMode)).map((m) => m.job);

  const houseCount = houseRows.length;
  return (
    <>
      <PageHeader eyebrow="Shipments" title={view === "houses" ? "Houses" : "Masters"} />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search shipment, house, customer, supplier, MBL…" />}
        filters={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
              {FILTERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <div className="wms-seg">
              {(["all", "sea", "air"] as const).map((m) => (
                <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  {m === "all" ? "All" : m === "sea" ? "Sea" : "Air"}
                </button>
              ))}
            </div>
          </>
        }
        count={
          boardQ.isLoading
            ? undefined
            : view === "houses"
              ? `${houseCount} house${houseCount === 1 ? "" : "s"}`
              : `${shown.length} master${shown.length === 1 ? "" : "s"}`
        }
        hint={
          view === "houses"
            ? "Every house: a shipment under a master (HBL / HAWB + master number), or a supplier house of a master. Change a house's master here."
            : "Master shipments and their houses. The customer is billed on the master: its houses' cargo, received figures once checked in. Make houses on Active Shipments › Consolidate or on the shipment."
        }
      />

      {boardQ.isLoading ? (
        <div className="panel">
          <Loading />
        </div>
      ) : boardQ.isError ? (
        <div className="panel">
          <ErrorNote error={boardQ.error} />
        </div>
      ) : view === "houses" ? (
        <div className="panel">
          {houseRows.length === 0 ? (
            <EmptyState>{masters.length === 0 ? "No houses yet. Tick shipments of one customer on Active Shipments and use Consolidate." : "No houses match."}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="ms-houses ms-houses-all">
                <colgroup>
                  <col style={{ width: 150 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 230 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>House No</th>
                    <th>Master</th>
                    <th>Customer</th>
                    <th>Supplier</th>
                    <th>Declared cargo</th>
                    <th>Received</th>
                    <th>Documents</th>
                    <th>Status</th>
                    <th>Change master</th>
                  </tr>
                </thead>
                <tbody>
                  {houseRows.map((r) => (
                    <AllHousesRow key={r.key} master={r.master} ship={r.ship} legacy={r.legacy} masters={mastersOf(r.master.client_id, r.master.mode)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState>
            {masters.length === 0
              ? "No master shipments yet. Tick shipments of one customer on Active Shipments and use Consolidate, or Make master on a shipment."
              : "No masters match."}
          </EmptyState>
        </div>
      ) : (
        shown.map(({ job, views, shipViews, quoted, declared, billed, allChecked, unassigned }) => {
          const types = docTypes(job.mode);
          const total = views.length + shipViews.length;
          const received = views.filter((v) => v.received).length + shipViews.filter((v) => v.received).length;
          const docsHave = views.reduce((s, v) => s + v.have.length, 0) + shipViews.reduce((s, v) => s + v.have.length, 0);
          const issued = views.filter((v) => v.h.hbl_issued_at).length;
          const loaded = views.filter((v) => v.h.loaded_at).length;
          const qCbm = quoted?.totalCbm ?? 0;
          const qKg = quoted?.totalActual ?? 0;
          return (
            <div key={job.id} className="panel ms-master">
              <div className="ms-master-head">
                <button type="button" className="ms-ref" onClick={() => navigate(`/jobs/${job.id}?tab=cargo`)} title="Open the shipment">
                  {job.reference}
                </button>
                <span className="ms-cust">{job.client?.company ?? "Customer"}</span>
                <span className="ms-meta">
                  {job.mode}
                  {job.awb_mbl ? ` · ${isAir(job.mode) ? "MAWB" : "MBL"} ${job.awb_mbl}` : ""}
                  {job.container_no ? ` · ${job.container_no}` : ""}
                  {job.etd ? ` · ETD ${formatDate(job.etd)}` : ""}
                  {job.eta ? ` · ETA ${formatDate(job.eta)}` : ""}
                </span>
                <span className="ms-status">{statusLabel(job.shipment_status, job.mode) || job.milestone}</span>
                {views.length > 0 && (
                  <>
                    <a className="link-btn" href={`/jobs/${job.id}/houses/print/house`} target="_blank" rel="noopener">
                      Print all {billOf(job.mode)}s
                    </a>
                    <a className="link-btn" href={`/jobs/${job.id}/houses/print/manifest`} target="_blank" rel="noopener">
                      Manifest
                    </a>
                  </>
                )}
              </div>
              <div className="ms-rollup">
                <span>
                  <b>{total}</b> house{total === 1 ? "" : "s"}
                </span>
                <span className={received < total ? "warn" : "ok"}>
                  <b>
                    {received}/{total}
                  </b>{" "}
                  cargo received
                </span>
                <span className={docsHave < total * types.length ? "warn" : "ok"}>
                  <b>
                    {docsHave}/{total * types.length}
                  </b>{" "}
                  documents
                </span>
                {views.length > 0 && (
                  <>
                    <span>
                      <b>
                        {issued}/{views.length}
                      </b>{" "}
                      {billOf(job.mode)} issued
                    </span>
                    <span>
                      <b>
                        {loaded}/{views.length}
                      </b>{" "}
                      loaded
                    </span>
                  </>
                )}
                <span className={`ms-tot${quoted && (off(declared.cbm, qCbm) || off(declared.kg, qKg)) ? " warn" : ""}`}>
                  Declared {f0(declared.pieces)} pcs · {f2(declared.kg)} kg · {f3(declared.cbm)} CBM
                  {quoted ? ` (quoted ${f2(qKg)} kg · ${f3(qCbm)} CBM)` : ""}
                  <br />
                  <b>
                    Master {f0(billed.pieces)} pcs · {f2(billed.kg)} kg · {f3(billed.cbm)} CBM
                  </b>{" "}
                  <span className="hint">{allChecked ? "(all received)" : "(received where checked in, else declared)"}</span>
                </span>
              </div>
              {unassigned.length > 0 && <UnassignedReceipts receipts={unassigned} views={views} reference={job.reference} />}
              {total === 0 ? (
                <p className="hint" style={{ padding: "6px 2px" }}>
                  No houses yet: tick shipments of {job.client?.company ?? "this customer"} on Active Shipments and use Consolidate, or + Add houses on the shipment.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="ms-houses">
                    <colgroup>
                      <col style={{ width: 120 }} />
                      <col style={{ width: 230 }} />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 126 }} />
                      <col style={{ width: 126 }} />
                      <col style={{ width: 126 }} />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 205 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>House No</th>
                        <th>Supplier</th>
                        <th>Declared cargo</th>
                        <th>Received at</th>
                        <th>Documents</th>
                        <th>Cargo ready</th>
                        <th>{billOf(job.mode)} issued</th>
                        <th>Loaded</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shipViews.map((v) => (
                        <ShipHouseRow key={v.j.id} v={v} types={types} />
                      ))}
                      {views.map((v) => (
                        <HouseRow key={v.h.id} v={v} types={types} onAsk={() => setAsking(v)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
      {asking && <RequestDocsModal v={asking} onClose={() => setAsking(null)} />}
    </>
  );
}

type MasterJob = NonNullable<BoardHouse["job"]> | BoardShipJob;

/** A house shipment's row on its master's card. */
function ShipHouseRow({ v, types }: { v: ShipView; types: string[] }) {
  const { j, receipts, recv, declared, have } = v;
  const diff = receipts.length > 0 && declared.pieces > 0 && (recv.pieces !== declared.pieces || off(recv.kg, declared.kg) || off(recv.cbm, declared.cbm));
  return (
    <tr>
      <td className="nowrap">
        <b>{j.house_no ?? j.reference}</b>
        <div className="hint">{j.reference}</div>
      </td>
      <td className="ms-supplier">{j.supplier?.company ?? <span className="hint">Not set</span>}</td>
      <td>{declared.pieces || declared.kg ? <CargoFigures pieces={declared.pieces} kg={declared.kg} cbm={declared.cbm} /> : <span className="hint">No packing list</span>}</td>
      <td className={diff ? "ms-diff" : undefined}>
        {receipts.length > 0 ? (
          <>
            <CargoFigures pieces={recv.pieces} kg={recv.kg} cbm={recv.cbm} />
            <div className="hint">{receipts.map((r) => r.receipt_no).join(", ")}</div>
          </>
        ) : (
          <span className="hint">Not received</span>
        )}
      </td>
      <td className="nowrap">
        {types.map((t) => (
          <span key={t} className={`ms-doc${have.includes(t) ? " on" : ""}`} title={`${t}: ${have.includes(t) ? "on file" : "missing"}`}>
            {have.includes(t) ? "✓" : "·"} {SHORT[t] ?? t}
          </span>
        ))}
      </td>
      <td colSpan={3} className="hint">
        House shipment: dates and documents on its own shipment
      </td>
      <td className="nowrap">{statusLabel(j.shipment_status, j.mode) || j.milestone}</td>
      <td className="nowrap">
        <a className="btn outline btn-sm" href={`/jobs/${j.id}`}>
          Open shipment
        </a>
      </td>
    </tr>
  );
}

/** Houses tab: one row per house, and (house shipments) a master picker. */
function AllHousesRow({ master, ship, legacy, masters }: { master: MasterJob; ship: ShipView | null; legacy: HouseView | null; masters: MasterJob[] }) {
  const { toast, error } = useToast();
  const run = useSetMaster();
  const houseNo = ship ? (ship.j.house_no ?? ship.j.reference) : legacy!.h.house_no;
  const supplier = ship ? ship.j.supplier?.company : legacy!.h.supplier?.company;
  const declared = ship ? ship.declared : { pieces: Number(legacy!.h.pieces || 0), kg: Number(legacy!.h.gross_kg || 0), cbm: Number(legacy!.h.volume_cbm || 0) };
  const receipts = ship ? ship.receipts : legacy!.receipts;
  const recv = ship ? ship.recv : legacy!.recv;
  const have = ship ? ship.have : legacy!.have;
  const types = docTypes(master.mode);
  return (
    <tr>
      <td className="nowrap">
        {ship ? (
          <a href={`/jobs/${ship.j.id}`}>
            <b>{houseNo}</b>
          </a>
        ) : (
          <b>{houseNo}</b>
        )}
        <div className="hint">{ship ? ship.j.reference : "Supplier house"}</div>
      </td>
      <td className="nowrap">
        <a href={`/jobs/${master.id}`}>{master.reference}</a>
      </td>
      <td className="ms-supplier">{master.client?.company ?? "—"}</td>
      <td className="ms-supplier">{supplier ?? <span className="hint">Not set</span>}</td>
      <td>{declared.pieces || declared.kg ? <CargoFigures pieces={declared.pieces} kg={declared.kg} cbm={declared.cbm} /> : <span className="hint">—</span>}</td>
      <td>{receipts.length ? <CargoFigures pieces={recv.pieces} kg={recv.kg} cbm={recv.cbm} /> : <span className="hint">Not received</span>}</td>
      <td className="nowrap">
        {types.map((t) => (
          <span key={t} className={`ms-doc${have.includes(t) ? " on" : ""}`} title={`${t}: ${have.includes(t) ? "on file" : "missing"}`}>
            {have.includes(t) ? "✓" : "·"} {SHORT[t] ?? t}
          </span>
        ))}
      </td>
      <td className="nowrap">{ship ? statusLabel(ship.j.shipment_status, ship.j.mode) || ship.j.milestone : legacy!.status}</td>
      <td className="nowrap">
        {ship ? (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <select
              value={master.id}
              style={{ width: 130 }}
              disabled={run.isPending}
              onChange={(e) =>
                run.mutate(
                  { jobIds: [ship.j.id], masterId: e.target.value },
                  { onSuccess: () => toast(`${ship.j.reference} moved, new house number given`), onError: (er) => error(er.message) },
                )
              }
              title="Move this house to another master of the same customer"
            >
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.reference}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn outline btn-sm"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(
                  { jobIds: [ship.j.id], masterId: null },
                  { onSuccess: () => toast(`${ship.j.reference} is a direct shipment again`), onError: (er) => error(er.message) },
                )
              }
            >
              Take off
            </button>
          </span>
        ) : (
          <span className="hint">Part of {master.reference}</span>
        )}
      </td>
    </tr>
  );
}

/** Warehouse receipts on the master that aren't on a house yet: assign them. */
function UnassignedReceipts({ receipts, views, reference }: { receipts: BoardReceipt[]; views: HouseView[]; reference: string }) {
  const { toast, error } = useToast();
  const assign = useAssignReceiptHouse();
  const totalPcs = views.reduce((n, v) => n + (Number(v.h.pieces) || 0), 0);
  return (
    <div className="ms-unassigned">
      <b>
        {receipts.length} warehouse receipt{receipts.length === 1 ? "" : "s"} on {reference} not on a house yet
      </b>
      {receipts.map((r) => (
        <span key={r.id} className="ms-unassigned-item">
          {r.receipt_no} · {f0(Number(r.pieces))} pcs · {f2(Number(r.gross_kg))} kg · {f3(Number(r.volume_cbm))} CBM
          {views.length > 1 && Number(r.pieces) > 0 && Number(r.pieces) >= totalPcs && (
            <span className="hint"> (the whole shipment, every house's cargo)</span>
          )}
          <select
            value=""
            onChange={(e) => {
              const v = views.find((x) => x.h.id === e.target.value);
              if (!v) return;
              // A receipt holding more than this house declared (e.g. one receipt for
              // the whole master) would move other houses' cargo onto it: ask first.
              const pcs = Number(r.pieces);
              const housePcs = Number(v.h.pieces) || 0;
              if (
                housePcs > 0 &&
                pcs > housePcs &&
                !confirm(
                  `${r.receipt_no} holds ${f0(pcs)} pcs, but ${v.h.house_no} declared ${f0(housePcs)} pcs` +
                    (views.length > 1 && pcs >= totalPcs ? " (it looks like every house's cargo on one receipt)" : "") +
                    `.\n\nPut all ${f0(pcs)} pcs on ${v.h.house_no}? Otherwise book in a receipt per house.`,
                )
              )
                return;
              assign.mutate(
                { receiptId: r.id, houseId: v.h.id },
                {
                  onSuccess: () => toast(`${r.receipt_no} put on ${v.h.house_no}`),
                  onError: (er) => error(er.message),
                },
              );
            }}
          >
            <option value="">Assign to house…</option>
            {views.map((v) => (
              <option key={v.h.id} value={v.h.id}>
                {v.h.house_no}
                {v.h.supplier?.company ? ` (${v.h.supplier.company})` : ""}
              </option>
            ))}
          </select>
        </span>
      ))}
    </div>
  );
}

/** Pieces / kg / CBM, one line each, so the columns line up. */
function CargoFigures({ pieces, kg, cbm }: { pieces: number; kg: number; cbm: number }) {
  return (
    <div className="ms-fig">
      <span>
        <b>{f0(pieces)}</b> pcs
      </span>
      <span>
        <b>{f2(kg)}</b> kg
      </span>
      <span>
        <b>{f3(cbm)}</b> CBM
      </span>
    </div>
  );
}

/** Where cargo marked Received (without a Motion receipt) was received:
 *  one of the warehouses (Motion WMS › Warehouses) or Other. */
function ReceivedAt({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const whQ = useWmsWarehouses();
  const names = (whQ.data ?? []).filter((w) => w.active).map((w) => w.name);
  const isOther = !!value && !names.includes(value);
  const [other, setOther] = useState(isOther);
  return (
    <div className="ms-where">
      <select
        value={other ? "__other" : value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__other") return setOther(true);
          setOther(false);
          onChange(v || null);
        }}
      >
        <option value="">Pick the warehouse…</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {other && (
        <input
          defaultValue={isOther ? value ?? "" : ""}
          placeholder="Where? e.g. supplier's warehouse"
          autoFocus={!isOther}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (value ?? null)) onChange(v);
          }}
        />
      )}
    </div>
  );
}

function HouseRow({ v, types, onAsk }: { v: HouseView; types: string[]; onAsk: () => void }) {
  const { error } = useToast();
  const upd = useUpdateHouseSteps();
  const { h, receipts, recv, have, missing, status } = v;
  const step = (patch: Parameters<typeof upd.mutate>[0]["patch"]) =>
    upd.mutate({ id: h.id, patch }, { onError: (e) => error(e.message) });
  const diff = receipts.length > 0 && (recv.pieces !== Number(h.pieces) || off(recv.kg, Number(h.gross_kg)) || off(recv.cbm, Number(h.volume_cbm)));
  return (
    <tr>
      <td className="nowrap">
        <b>{h.house_no}</b>
        {h.carrier_house_no && <div className="hint">{h.carrier_house_no}</div>}
      </td>
      <td className="ms-supplier">{h.supplier?.company ?? <span className="hint">Not set</span>}</td>
      <td>
        <CargoFigures pieces={Number(h.pieces)} kg={Number(h.gross_kg)} cbm={Number(h.volume_cbm)} />
      </td>
      <td className={diff ? "ms-diff" : undefined}>
        {receipts.length > 0 ? (
          <>
            <CargoFigures pieces={recv.pieces} kg={recv.kg} cbm={recv.cbm} />
            <div className="hint">{receipts.map((r) => r.receipt_no).join(", ")}</div>
          </>
        ) : v.received ? (
          <ReceivedAt value={h.received_note} onChange={(val) => step({ received_note: val })} />
        ) : (
          <span className="hint">Not received</span>
        )}
      </td>
      <td className="nowrap">
        {types.map((t) => (
          <span key={t} className={`ms-doc${have.includes(t) ? " on" : ""}`} title={`${t}: ${have.includes(t) ? "on file" : "missing"}`}>
            {have.includes(t) ? "✓" : "·"} {SHORT[t] ?? t}
          </span>
        ))}
      </td>
      <td>
        <DateInput value={h.cargo_ready_date} onChange={(d) => step({ cargo_ready_date: d || null })} />
      </td>
      <td>
        <DateInput value={h.hbl_issued_at} onChange={(d) => step({ hbl_issued_at: d || null })} />
      </td>
      <td>
        <DateInput value={h.loaded_at} onChange={(d) => step({ loaded_at: d || null })} />
      </td>
      <td className="nowrap">
        <select
          className={`ms-status-pick badge ${HOUSE_STATUS_CLASS[status]}`}
          value={h.status ?? ""}
          title={h.status ? "Set by the team, pick Auto to follow the receipts, documents and dates again" : "Worked out automatically, pick a status to set it"}
          onChange={(e) => {
            const s = (e.target.value || null) as typeof h.status;
            step({ status: s, status_at: s ? new Date().toISOString() : null });
          }}
        >
          <option value="">Auto: {v.auto}</option>
          {HOUSE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="nowrap">
        <span style={{ display: "inline-flex", gap: 6 }}>
          <a className="btn outline btn-sm" href={`/jobs/${h.job_id}/houses/print/house?h=${h.id}`} target="_blank" rel="noopener" title="Print this house bill">
            Print
          </a>
          {missing.length > 0 && (
            <button type="button" className="btn outline btn-sm" onClick={onAsk}>
              Request documents
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

/** Ask for a house's missing documents: the team picks who (customer
 *  contacts and / or the supplier) each time; logged on the shipment. */
function RequestDocsModal({ v, onClose }: { v: HouseView; onClose: () => void }) {
  const { toast, error } = useToast();
  const job = v.h.job!;
  const contactsQ = useCustomerContacts(job.client_id ?? undefined);
  const people = useMemo(() => {
    const out: { label: string; email: string; customer: boolean }[] = [];
    const seen = new Set<string>();
    const add = (label: string, email: string | null | undefined, customer: boolean) => {
      const e = (email ?? "").trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ label, email: e, customer });
    };
    add(`Customer · ${job.client?.company ?? ""}`, job.client?.email, true);
    for (const c of contactsQ.data ?? []) add(`Customer · ${c.name}`, c.email, true);
    add(`Supplier · ${v.h.supplier?.company ?? ""}${v.h.supplier?.contact ? ` (${v.h.supplier.contact})` : ""}`, v.h.supplier?.email, false);
    return out;
  }, [job.client, contactsQ.data, v.h.supplier]);
  const [to, setTo] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [want, setWant] = useState<Set<string>>(new Set(v.missing));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const recipients = [...to, ...extra.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /@/.test(x))];
  const toCustomer = people.some((p) => p.customer && to.has(p.email));
  const list = [...want];
  const subject = `Documents needed: ${v.h.house_no}${v.h.supplier?.company ? ` (${v.h.supplier.company})` : ""}`;
  const portal = `${window.location.origin}/portal/shipments/${job.id}#house-${v.h.id}`;
  const text =
    `Good day,\n\nFor shipment ${job.reference}, house ${v.h.house_no}${v.h.supplier?.company ? ` from ${v.h.supplier.company}` : ""}, we still need:\n` +
    list.map((d) => `  - ${d}`).join("\n") +
    (note.trim() ? `\n\n${note.trim()}` : "") +
    (toCustomer ? `\n\nYou can upload them on your ExPac portal: ${portal}` : "") +
    `\n\nOr reply to this email with the documents attached.\n\nKind regards,\nExPac Forwarding`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${esc(text)
    .replace(/\n/g, "<br>")
    .replace(esc(portal), `<a href="${portal}">${esc(portal)}</a>`)}</div>`;

  async function onSend() {
    if (recipients.length === 0) return error("Pick who to ask");
    if (list.length === 0) return error("Tick at least one document");
    setBusy(true);
    try {
      const settings = await getCompanySettings().catch(() => null);
      const { id } = await sendMail({
        jobId: job.id,
        to: recipients,
        bcc: SUPPORT_BCC,
        subject,
        html,
        text,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
      });
      await createMessage({
        job_id: job.id,
        kind: "email",
        direction: "out",
        to_emails: recipients,
        cc_emails: [],
        subject,
        body: text,
        status: "sent",
        provider_id: id,
        sent_at: new Date().toISOString(),
      });
      toast(`Request sent to ${recipients.join(", ")}`);
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, value: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    fn(n);
  };

  return (
    <Modal title={`Request documents · ${v.h.house_no}`} onClose={onClose}>
      <div className="field">
        <label>Send to</label>
        {people.length === 0 && <p className="hint">No email on file for the customer or the supplier, type one below.</p>}
        {people.map((p) => (
          <label key={p.email} className="check">
            <input type="checkbox" checked={to.has(p.email)} onChange={() => toggle(to, p.email, setTo)} /> {p.label}{" "}
            <span className="hint">{p.email}</span>
          </label>
        ))}
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Other email(s), comma separated" style={{ marginTop: 6 }} />
      </div>
      <div className="field">
        <label>Documents needed</label>
        {docTypes(job.mode).map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={want.has(d)} onChange={() => toggle(want, d, setWant)} /> {d}
            {!v.missing.includes(d) && <span className="hint"> (already on file)</span>}
          </label>
        ))}
      </div>
      <div className="field">
        <label>Note (optional)</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. please send before the cut-off on Friday" />
      </div>
      <div className="field">
        <label>Email preview</label>
        <pre className="ms-preview">{`Subject: ${subject}\n\n${text}`}</pre>
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy || recipients.length === 0 || list.length === 0} onClick={() => void onSend()}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
    </Modal>
  );
}
