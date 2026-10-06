import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  SearchInput,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  qty,
  share,
  stockByLocation,
  todayIso,
  useWmsMoves,
  useWmsMutation,
  useWmsReceipts,
  useWmsConsols,
  useWmsReleases,
  wmsDb,
  type WmsRelease,
  type WmsReleaseHeader,
  type WmsReleaseLineInput,
  type WmsReleaseRequest,
  RELEASE_REQUEST_STATUS,
  closeReleaseRequest,
  useWmsReleaseRequests,
  type ConsolMode,
} from "../../lib/wms";
import WmsConsols from "./WmsConsols";
import { orNull, useWmsLookups } from "./shared";
import { notifyWms } from "../../lib/wmsNotify";

type View = "releases" | "requests" | ConsolMode;

const VIEWS: [View, string][] = [
  ["releases", "Releases"],
  ["requests", "Release requests"],
  ["air", "Air consolidations"],
  ["lcl", "LCL groupage"],
  ["fcl", "FCL consolidations"],
];

/** WMS > Warehouse Release: goods out (RL000001) and consolidations, air
 *  (MAWB / HAWB), LCL groupage and FCL consolidation (MBL / HBL). */
export default function WmsReleases() {
  const [view, setView] = useState<View>("releases");
  // ?consol=<id> (Active Shipments › Consolidate, a shipment's master link)
  // opens that consolidation in its own mode's list.
  const [params, setParams] = useSearchParams();
  const consolsQ = useWmsConsols();
  const openId = params.get("consol");
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!openId || !consolsQ.data) return;
    const c = consolsQ.data.find((x) => x.id === openId);
    if (c) {
      setView(c.mode);
      setPendingOpen(c.id);
    }
    params.delete("consol");
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, consolsQ.data]);
  const toggle = (
    <div className="wms-seg">
      {VIEWS.map(([v, label]) => (
        <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
          {label}
        </button>
      ))}
    </div>
  );
  if (view === "requests") return <RequestsList toggle={toggle} />;
  return view === "releases" ? <ReleasesList toggle={toggle} /> : <WmsConsols key={view} toggle={toggle} mode={view} openId={pendingOpen} onOpened={() => setPendingOpen(null)} />;
}

function ReleasesList({ toggle }: { toggle: ReactNode }) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const releasesQ = useWmsReleases();
  const receiptsQ = useWmsReceipts();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const undo = useWmsMutation(wmsDb.deleteRelease);
  const recById = useMemo(() => new Map((receiptsQ.data ?? []).map((r) => [r.id, r])), [receiptsQ.data]);

  const rows = releasesQ.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      !q ||
      [r.release_no, lk.clientName(r.client_id), lk.jobRef(r.job_id), r.collected_by, r.vehicle_reg, r.outbound_ref, ...r.lines.map((l) => recById.get(l.receipt_id)?.receipt_no)]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const sum = (r: WmsRelease, k: "pieces" | "gross_kg" | "volume_cbm") => r.lines.reduce((s, l) => s + l[k], 0);

  const columns: DataColumn<WmsRelease>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (r) => (
        <RowActions
          onView={() => navigate(`/wms/print/release/${r.id}`)}
          onDelete={() => {
            if (!confirm(`Undo ${r.release_no}? Its goods go back into stock.`)) return;
            undo.mutate(r.id, { onSuccess: () => toast("Release undone, goods back in stock"), onError: (e) => error(e.message) });
          }}
        />
      ),
    },
    { key: "no", header: "Release No", width: 110, render: (r) => <b>{r.release_no}</b>, sortValue: (r) => r.release_no },
    { key: "date", header: "Released", width: 100, render: (r) => formatDate(r.released_at), sortValue: (r) => r.released_at },
    { key: "client", header: "Customer", width: 180, render: (r) => lk.clientName(r.client_id), sortValue: (r) => lk.clientName(r.client_id) },
    { key: "job", header: "Shipment", width: 100, render: (r) => lk.jobRef(r.job_id) },
    {
      key: "rec",
      header: "Receipts",
      width: 160,
      render: (r) => [...new Set(r.lines.map((l) => recById.get(l.receipt_id)?.receipt_no))].join(", "),
    },
    { key: "pcs", header: "Pieces", width: 70, render: (r) => sum(r, "pieces"), sortValue: (r) => sum(r, "pieces") },
    { key: "kg", header: "Kg", width: 80, render: (r) => qty(sum(r, "gross_kg")) },
    { key: "cbm", header: "CBM", width: 80, render: (r) => qty(sum(r, "volume_cbm"), 3) },
    { key: "coll", header: "Collected by", width: 150, render: (r) => r.collected_by || "—" },
    { key: "veh", header: "Vehicle", width: 100, render: (r) => r.vehicle_reg || "—" },
    { key: "out", header: "Outbound ref", width: 120, render: (r) => r.outbound_ref || "—" },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search release, customer, receipt…" />}
        filters={toggle}
        count={releasesQ.isLoading ? undefined : `${filtered.length} release${filtered.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setCreating(true)}>
            + New release
          </button>
        }
      />
      <div className="panel">
        {releasesQ.isLoading ? (
          <Loading />
        ) : releasesQ.isError ? (
          <ErrorNote error={releasesQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>No releases yet. + New release books goods out of the warehouse.</EmptyState>
        ) : (
          <DataTable
            tableKey="wms-releases"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/wms/print/release/${r.id}`)}
          />
        )}
      </div>
      {creating && (
        <NewReleaseModal
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            navigate(`/wms/print/release/${id}`);
          }}
        />
      )}
    </>
  );
}

function NewReleaseModal({
  onClose,
  onDone,
  request,
}: {
  onClose: () => void;
  onDone: (id: string) => void;
  /** Booking a customer's release request (0148): pre-fills goods + collection / delivery. */
  request?: WmsReleaseRequest;
}) {
  const lk = useWmsLookups();
  const { error, toast } = useToast();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const create = useWmsMutation((v: { header: WmsReleaseHeader; lines: WmsReleaseLineInput[] }) =>
    wmsDb.createRelease(v.header, v.lines),
  );
  const [clientId, setClientId] = useState(request?.client_id ?? "");
  const [picked, setPicked] = useState<Record<string, number>>(() => {
    if (!request) return {};
    // Spread each requested quantity over the bays the receipt sits in.
    const out: Record<string, number> = {};
    const stockNow = stockByLocation(movesQ.data ?? []);
    for (const l of request.lines) {
      let left = l.pieces;
      for (const st of stockNow.filter((x) => x.receipt_id === l.receipt_id)) {
        if (left <= 0) break;
        const take = Math.min(left, st.on_hand);
        out[st.receipt_id + "|" + (st.location_id ?? "")] = take;
        left -= take;
      }
    }
    return out;
  });
  const [h, setH] = useState<WmsReleaseHeader>(() =>
    request
      ? {
          released_at: todayIso(),
          collected_by: request.collector_name,
          vehicle_reg: request.collector_vehicle,
          driver_id_no: request.collector_id_no,
          deliver_to: request.method === "deliver" ? request.deliver_to : null,
          outbound_ref: request.request_no,
          notes: ["Release request " + request.request_no, request.notes].filter(Boolean).join(". "),
        }
      : { released_at: todayIso() },
  );
  const setHf = (k: keyof WmsReleaseHeader, v: string) => setH((p) => ({ ...p, [k]: orNull(v) }));

  const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
  const stock = stockByLocation(movesQ.data ?? [])
    .map((s) => ({ ...s, receipt: recById.get(s.receipt_id)! }))
    .filter((s) => s.receipt && (!clientId || s.receipt.client_id === clientId))
    .sort((a, b) => a.receipt.receipt_no.localeCompare(b.receipt.receipt_no));
  const key = (s: { receipt_id: string; location_id: string | null }) => `${s.receipt_id}|${s.location_id ?? ""}`;
  const clientsWithStock = lk.clients.filter((c) =>
    (receiptsQ.data ?? []).some((r) => r.client_id === c.id && r.on_hand > 0),
  );
  const lines: WmsReleaseLineInput[] = stock
    .filter((s) => picked[key(s)] > 0)
    .map((s) => ({ receipt_id: s.receipt_id, location_id: s.location_id, pieces: Math.min(picked[key(s)], s.on_hand) }));
  const tot = stock
    .filter((s) => picked[key(s)] > 0)
    .reduce(
      (t, s) => {
        const sh = share(s.receipt, Math.min(picked[key(s)], s.on_hand));
        return { pcs: t.pcs + Math.min(picked[key(s)], s.on_hand), kg: t.kg + sh.kg, cbm: t.cbm + sh.cbm };
      },
      { pcs: 0, kg: 0, cbm: 0 },
    );

  function submit() {
    if (lines.length === 0) return error("Tick the goods being released");
    const receiptClients = new Set(lines.map((l) => recById.get(l.receipt_id)?.client_id));
    const header: WmsReleaseHeader = {
      ...h,
      client_id: clientId || (receiptClients.size === 1 ? [...receiptClients][0] ?? null : null),
      warehouse_id: recById.get(lines[0].receipt_id)?.warehouse_id ?? null,
      released_at: h.released_at ? new Date(`${h.released_at}T${new Date().toTimeString().slice(0, 8)}`).toISOString() : null,
    };
    create.mutate(
      { header, lines },
      {
        onSuccess: (id) => {
          toast(`${tot.pcs} piece${tot.pcs === 1 ? "" : "s"} released`);
          // Customer email: shipped (0149), for receipts with nothing left in store.
          const ship = header.job_id && lk.jobRef(header.job_id) !== "—" ? "Shipment " + lk.jobRef(header.job_id) : header.outbound_ref ? "Ref " + header.outbound_ref : "";
          void notifyWms("shipped", lines.map((l) => l.receipt_id), ship ? Object.fromEntries(lines.map((l) => [l.receipt_id, ship])) : {});
          onDone(id);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title="New release" onClose={onClose} wide stickyHeader>
      <div className="grid3">
        <div className="field">
          <label>Customer</label>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPicked({});
            }}
            autoFocus
          >
            <option value="">All customers</option>
            {clientsWithStock.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Release date</label>
          <DateInput value={h.released_at ?? ""} onChange={(v) => setHf("released_at", v)} />
        </div>
        <div className="field">
          <label>Shipment (optional)</label>
          <select value={h.job_id ?? ""} onChange={(e) => setHf("job_id", e.target.value)}>
            <option value="">—</option>
            {lk.jobs
              .filter((j) => !clientId || j.client_id === clientId)
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.reference}
                </option>
              ))}
          </select>
        </div>
      </div>

      <h4 className="wms-subhead">Goods on hand, tick what's going out</h4>
      {stock.length === 0 ? (
        <p className="hint">Nothing on hand{clientId ? " for this customer" : ""}.</p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Receipt</th>
              <th>Customer</th>
              <th>Description</th>
              <th>Zone / bay</th>
              <th>On hand</th>
              <th style={{ width: 90 }}>Release</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => {
              const k = key(s);
              const on = (picked[k] ?? 0) > 0;
              return (
                <tr key={k}>
                  <td>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked ? s.on_hand : 0 }))}
                    />
                  </td>
                  <td>{s.receipt.receipt_no}</td>
                  <td>{lk.clientName(s.receipt.client_id)}</td>
                  <td>{s.receipt.description || "—"}</td>
                  <td>{lk.locName(s.location_id)}</td>
                  <td>{s.on_hand}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={s.on_hand}
                      value={picked[k] ?? 0}
                      onChange={(e) =>
                        setPicked((p) => ({ ...p, [k]: Math.max(0, Math.min(s.on_hand, Number(e.target.value) || 0)) }))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="hint">
        Releasing {tot.pcs} pcs · {qty(tot.kg)} kg · {qty(tot.cbm, 3)} CBM
      </p>

      <div className="grid4">
        <div className="field">
          <label>Collected by</label>
          <input value={h.collected_by ?? ""} onChange={(e) => setHf("collected_by", e.target.value)} />
        </div>
        <div className="field">
          <label>Vehicle reg</label>
          <input value={h.vehicle_reg ?? ""} onChange={(e) => setHf("vehicle_reg", e.target.value)} />
        </div>
        <div className="field">
          <label>Driver ID no</label>
          <input value={h.driver_id_no ?? ""} onChange={(e) => setHf("driver_id_no", e.target.value)} />
        </div>
        <div className="field">
          <label>Outbound ref</label>
          <input value={h.outbound_ref ?? ""} onChange={(e) => setHf("outbound_ref", e.target.value)} placeholder="Waybill / DN" />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Deliver to</label>
          <textarea rows={2} value={h.deliver_to ?? ""} onChange={(e) => setHf("deliver_to", e.target.value)} />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows={2} value={h.notes ?? ""} onChange={(e) => setHf("notes", e.target.value)} />
        </div>
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={create.isPending || lines.length === 0}>
          {create.isPending ? "Releasing…" : `Release ${tot.pcs} pcs`}
        </button>
      </div>
    </Modal>
  );
}

/** Release requests from the customer portal (0148): book the release from
 *  the request, or decline it with a reason. */
function RequestsList({ toggle }: { toggle: ReactNode }) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const reqQ = useWmsReleaseRequests();
  const receiptsQ = useWmsReceipts();
  const [booking, setBooking] = useState<WmsReleaseRequest | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const recById = useMemo(() => new Map((receiptsQ.data ?? []).map((r) => [r.id, r])), [receiptsQ.data]);
  const rows = (reqQ.data ?? []).filter((r) => showAll || r.status === "requested");

  async function decline(r: WmsReleaseRequest) {
    const reason = prompt(`Decline ${r.request_no}? Tell the customer why:`);
    if (reason === null) return;
    try {
      await closeReleaseRequest(r, { status: "declined", decline_reason: reason.trim() || null });
      toast("Request declined, the customer sees the reason on the portal");
      reqQ.refetch();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not decline");
    }
  }

  const columns: DataColumn<WmsReleaseRequest>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 190,
      render: (r) =>
        r.status === "requested" ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setBooking(r)}>
              Book release
            </button>
            <button className="btn outline warn btn-sm" onClick={() => void decline(r)}>
              Decline
            </button>
          </div>
        ) : r.release_id ? (
          <button className="link-btn" onClick={() => navigate(`/wms/print/release/${r.release_id}`)}>
            Release note
          </button>
        ) : (
          "—"
        ),
    },
    { key: "no", header: "Request No", width: 110, render: (r) => <b>{r.request_no}</b>, sortValue: (r) => r.request_no },
    { key: "date", header: "Requested", width: 100, render: (r) => formatDate(r.created_at), sortValue: (r) => r.created_at },
    { key: "client", header: "Customer", width: 180, render: (r) => lk.clientName(r.client_id), sortValue: (r) => lk.clientName(r.client_id) },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (r) => <span className={`badge ${RELEASE_REQUEST_STATUS[r.status].cls}`}>{RELEASE_REQUEST_STATUS[r.status].label}</span>,
    },
    { key: "method", header: "Collect / Deliver", width: 120, render: (r) => (r.method === "deliver" ? "Deliver" : "Collect") },
    { key: "needed", header: "Needed by", width: 100, render: (r) => formatDate(r.required_date), sortValue: (r) => r.required_date ?? "" },
    {
      key: "goods",
      header: "Goods",
      width: 240,
      render: (r) => r.lines.map((l) => `${recById.get(l.receipt_id)?.receipt_no ?? "?"} × ${l.pieces}`).join(", "),
    },
    {
      key: "who",
      header: "Collector / Deliver to",
      width: 240,
      render: (r) =>
        r.method === "deliver"
          ? r.deliver_to || "—"
          : [r.collector_name, r.collector_vehicle, r.collector_id_no].filter(Boolean).join(", ") || "—",
    },
    { key: "notes", header: "Notes", width: 200, render: (r) => r.notes || r.decline_reason || "—" },
  ];

  return (
    <>
      <PageTools
        filters={
          <>
            {toggle}
            <label className="check" style={{ margin: 0 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show handled
            </label>
          </>
        }
        count={reqQ.isLoading ? undefined : `${rows.length} request${rows.length === 1 ? "" : "s"}`}
        hint="Customers ask for goods to be released from the portal (Warehouse > Release requests)."
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {reqQ.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState>{showAll ? "No release requests yet." : "No open release requests."}</EmptyState>
        ) : (
          <DataTable tableKey="wms-release-requests" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(r) => r.id} />
        )}
      </div>
      {booking && (
        <NewReleaseModal
          request={booking}
          onClose={() => setBooking(null)}
          onDone={async (id) => {
            try {
              await closeReleaseRequest(booking, { status: "released", release_id: id });
            } catch (e) {
              error(e instanceof Error ? e.message : "Released, but the request could not be closed");
            }
            setBooking(null);
            reqQ.refetch();
            navigate(`/wms/print/release/${id}`);
          }}
        />
      )}
    </>
  );
}
