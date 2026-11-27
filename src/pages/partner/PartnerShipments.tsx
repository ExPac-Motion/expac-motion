/**
 * Partner Portal › Shipments (0243): the shipments this partner is assigned
 * to, their leg only. Agents fill in the booking and move the shipment to
 * Departed; transporters and destination agents take it to Delivered with the
 * POD; everyone can report a delay, upload their documents and message ExPac.
 * Every step is logged on the shipment and opens a Control Tower task.
 */
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import BackButton from "../../components/BackButton";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import TrackingMap from "../../components/TrackingMap";
import TimelineProgress from "../../components/TimelineProgress";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, RowActions, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { packingRow, packingTotals, volumetricFactor } from "../../lib/calc";
import { getShipmentDocumentUrl } from "../../lib/db";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import { stepLabel } from "../../lib/steps";
import { aisRoute } from "../../lib/trackRoute";
import { shipmentStatusSlug, type PartnerKind } from "../../lib/types";
import {
  isMissingPartnerShipments,
  PARTNER_DOC_SLOTS,
  PARTNER_DOC_TYPES,
  partnerStatuses,
  respondToShipment,
  PARTNER_STATUSES,
  sendPartnerMessage,
  updatePartnerShipment,
  uploadPartnerDocument,
  usePartnerMutation,
  usePartnerShipment,
  usePartnerShipments,
  type PartnerShipment,
  type PartnerShipmentRow,
  type PartnerUpdate,
} from "../../lib/partnerShipments";

const n2 = (v: number) => v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | null | undefined) => (v && String(v).trim() ? v : "-");
const d = (v: string | null | undefined) => (v ? formatDate(v) : "-");
const isAir = (mode: string | null | undefined) => /air|courier/i.test(mode ?? "");

function StatusPill({ status, mode }: { status: string | null; mode: string | null }) {
  return (
    <span className={`job-status job-status-ro is-${shipmentStatusSlug(status)}`}>
      {status ? stepLabel(status, mode) : "Created"}
    </span>
  );
}

/* ---------------- List ---------------- */

const MODE_TABS = [
  { key: "all", label: "All" },
  { key: "air", label: "Air" },
  { key: "sea", label: "Sea" },
  { key: "road", label: "Road" },
] as const;
type ModeTab = (typeof MODE_TABS)[number]["key"];
const modeOf = (m: string | null | undefined): Exclude<ModeTab, "all"> =>
  /^(air|courier)/i.test(m ?? "") ? "air" : /^road/i.test(m ?? "") ? "road" : "sea";

/** Days until a date (negative = past), null without one. */
const daysUntil = (iso: string | null | undefined) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

export default function PartnerShipments({
  kind,
  openId: openIdIn,
  onOpen,
  demoRows,
  demoShipment,
}: {
  kind: PartnerKind;
  /** Controlled from the portal (the dashboard opens shipments too). */
  openId?: string | null;
  onOpen?: (id: string | null) => void;
  /** DEV previews only. */
  demoRows?: PartnerShipmentRow[];
  demoShipment?: PartnerShipment;
}) {
  const q = usePartnerShipments(!demoRows);
  const [openLocal, setOpenLocal] = useState<string | null>(null);
  const openId = openIdIn !== undefined ? openIdIn : openLocal;
  const setOpenId = (id: string | null) => (onOpen ? onOpen(id) : setOpenLocal(id));
  const [view, setView] = useState<"active" | "delivered" | "all">("all");
  const [modeTab, setModeTab] = useState<ModeTab>("all");
  const [search, setSearch] = useState("");
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const all = useMemo(() => demoRows ?? q.data ?? [], [demoRows, q.data]);
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((r) => (view === "all" ? true : view === "delivered" ? r.completed : !r.completed))
    .filter((r) => modeTab === "all" || modeOf(r.mode) === modeTab)
    .filter(
      (r) =>
        !needle ||
        [r.reference, r.master_reference, r.awb_mbl, r.container_no, r.vessel_name, r.origin, r.destination].some((v) =>
          v?.toLowerCase().includes(needle),
        ),
    )
    // Shipments waiting for an answer first.
    .sort((a, b) => Number(b.acceptance === "pending") - Number(a.acceptance === "pending"));

  const columns: DataColumn<PartnerShipmentRow>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 70,
      render: (r) => (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <RowActions onView={() => setOpenId(r.id)} viewTitle="Open the shipment" />
        </div>
      ),
    },
    {
      key: "shipment",
      header: "Shipment",
      width: 165,
      render: (r) => (
        <>
          <button type="button" className="ref-link" onClick={() => setOpenId(r.id)}>
            {r.reference}
          </button>
          {r.unread > 0 && <span className="ps-unread">{r.unread} new</span>}
        </>
      ),
      sortValue: (r) => r.reference,
    },
    { key: "mode", header: "Mode", width: 140, render: (r) => r.mode || "-", sortValue: (r) => r.mode ?? "" },
    { key: "inco", header: "Incoterm", width: 90, render: (r) => r.incoterms || "-", sortValue: (r) => r.incoterms ?? "" },
    {
      key: "status",
      header: view === "delivered" ? "Shipment Status" : "Status",
      width: 150,
      render: (r) => <StatusPill status={r.shipment_status} mode={r.mode} />,
      sortValue: (r) => r.shipment_status ?? "",
    },
    {
      key: "action",
      header: "Action Needed",
      width: 170,
      render: (r) =>
        r.acceptance === "pending" ? (
          <span className="ps-action ps-action-accept">Accept or decline</span>
        ) : r.action ? (
          <span className="ps-action">{r.action}</span>
        ) : (
          "-"
        ),
      sortValue: (r) => r.action ?? "",
    },
    { key: "ready", header: "Cargo Ready", width: 110, render: (r) => d(r.ready_date), sortValue: (r) => r.ready_date ?? "", defaultHidden: kind !== "agent" },
    { key: "etd", header: "ETD", width: 110, render: (r) => d(r.etd), sortValue: (r) => r.etd ?? "" },
    {
      key: "eta",
      header: "ETA",
      width: 120,
      render: (r) => {
        const n = daysUntil(r.eta);
        const flag = !r.completed && n !== null && n <= 5;
        return (
          <span
            className={flag ? "job-eta is-due" : undefined}
            title={n === null ? undefined : n < 0 ? `ETA passed ${-n} day(s) ago` : n === 0 ? "Arriving today" : `Arriving in ${n} day(s)`}
          >
            {d(r.eta)}
          </span>
        );
      },
      sortValue: (r) => r.eta ?? "",
    },
    { key: "pdd", header: "PDD", width: 110, render: (r) => d(r.delivery_date), sortValue: (r) => r.delivery_date ?? "" },
    { key: "pol", header: "POL", width: 90, render: (r) => portCode(r.origin), sortValue: (r) => portCode(r.origin) },
    { key: "pod", header: "POD", width: 90, render: (r) => portCode(r.destination), sortValue: (r) => portCode(r.destination) },
    ...(kind === "transporter"
      ? []
      : ([
          { key: "awb", header: "MBL / AWB", width: 150, render: (r) => r.awb_mbl || "-", sortValue: (r) => r.awb_mbl ?? "" },
          { key: "vessel", header: "Vessel / Flight", width: 170, render: (r) => r.vessel_name || "-", sortValue: (r) => r.vessel_name ?? "" },
        ] as DataColumn<PartnerShipmentRow>[])),
    { key: "container", header: "Container No", width: 140, render: (r) => r.container_no || "-", sortValue: (r) => r.container_no ?? "" },
    { key: "master", header: "Master", width: 120, render: (r) => r.master_reference || "-", defaultHidden: true },
  ];

  if (openId) return <PartnerShipmentPage id={openId} kind={kind} demo={demoShipment} onBack={() => setOpenId(null)} />;

  return (
    <>
      <PageHeader
        eyebrow="Assigned to you"
        title={view === "delivered" ? "Delivered Shipments" : view === "all" ? "All Shipments" : "Active Shipments"}
      />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search shipment, MBL / AWB, container, vessel…" />}
        filters={
          <>
            <div className="wms-seg">
              {(["all", "active", "delivered"] as const).map((v) => (
                <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
                  {v === "all" ? "All" : v === "active" ? "Active" : "Delivered"} (
                  {v === "all" ? all.length : all.filter((r) => (v === "delivered" ? r.completed : !r.completed)).length})
                </button>
              ))}
            </div>
            <div className="wms-seg">
              {MODE_TABS.map((t) => (
                <button key={t.key} type="button" className={modeTab === t.key ? "active" : ""} onClick={() => setModeTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        }
        count={!demoRows && q.isLoading ? undefined : `${rows.length} shipment${rows.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      />
      <div className="panel jobs-panel">
        {!demoRows && q.isLoading ? (
          <Loading />
        ) : !demoRows && q.error ? (
          isMissingPartnerShipments(q.error) ? (
            <EmptyState>Shipments are being switched on. Check back shortly.</EmptyState>
          ) : (
            <ErrorNote error={q.error} />
          )
        ) : rows.length === 0 ? (
          <EmptyState>
            {needle
              ? `No shipments match "${search.trim()}".`
              : view === "delivered"
                ? "No delivered shipments in the last 60 days."
                : "No shipments right now. Shipments ExPac assigns to you appear here."}
          </EmptyState>
        ) : (
          <DataTable
            tableKey={`partner-jobs-${view}`}
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
          />
        )}
      </div>
    </>
  );
}

/* ---------------- One shipment ---------------- */

function PartnerShipmentPage({
  id,
  kind,
  demo,
  onBack,
}: {
  id: string;
  kind: PartnerKind;
  demo?: PartnerShipment;
  onBack: () => void;
}) {
  const q = usePartnerShipment(demo ? null : id);
  const s = demo ?? q.data;
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <BackButton label="All shipments" onClick={onBack} />
      </div>
      {!s && q.isLoading ? <Loading /> : !s ? <ErrorNote error={q.error} /> : <ShipmentBody s={s} kind={kind} demo={!!demo} />}
    </>
  );
}

function ShipmentBody({ s, kind, demo }: { s: PartnerShipment; kind: PartnerKind; demo: boolean }) {
  const { toast, error } = useToast();
  const save = usePartnerMutation((p: PartnerUpdate) => (demo ? Promise.resolve() : updatePartnerShipment(s.id, p)));
  const air = isAir(s.mode);
  const pending = s.acceptance === "pending";
  const run = async (p: PartnerUpdate, ok: string) => {
    try {
      await save.mutateAsync(p);
      toast(ok);
      return true;
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
      return false;
    }
  };

  const facts: [string, string][] = [
    ["Shipment No", s.reference + (s.master_reference ? ` (on ${s.master_reference})` : "")],
    ["Mode", dash(s.mode)],
    ["Incoterms", dash(s.incoterms)],
    ["Delivery Terms", dash(s.delivery_terms)],
    ["Origin", dash(s.origin)],
    ["Destination", dash(s.destination)],
    ["Commodity", dash(s.commodity)],
    ["Cargo Ready", d(s.ready_date)],
    ["ETD", d(s.etd)],
    ["ETA", d(s.eta)],
    ["Delivery Date", d(s.delivery_date)],
    ...(!air && s.container_type ? ([["Container Type", s.container_type]] as [string, string][]) : []),
  ];
  if (kind !== "transporter") {
    facts.push(
      [air ? "Airline" : "Carrier", dash(s.carrier_name ?? s.shipping_line)],
      [air ? "Flight" : "Vessel / Voyage", dash([s.vessel_name, s.voyage_no].filter(Boolean).join(" / "))],
      [air ? "MAWB" : "MBL", dash(s.awb_mbl)],
    );
  }
  if (!air) facts.push(["Container / Seal", dash([s.container_no, kind !== "transporter" ? s.seal_no : null].filter(Boolean).join(" / "))]);
  if (s.customs_stage !== undefined) {
    facts.push(["Customs", s.customs_released ? "Released" : dash(s.customs_stage?.replace(/_/g, " "))]);
    if (s.entry_no) facts.push(["Entry No", s.entry_no]);
  }

  return (
    <>
      <div className="panel ps-hero">
        <div className="ps-head">
          <h2>{s.reference}</h2>
          <StatusPill status={s.shipment_status} mode={s.mode} />
          <span className="hint">
            {dash(s.mode)}
            {s.master_reference ? ` · on ${s.master_reference}` : ""}
          </span>
        </div>
        <div className="sp-route ps-route">
          <div className="sp-port">
            <span className="sp-port-code">{s.origin ? portCode(s.origin) : "Origin"}</span>
            <span className="sp-port-name">{s.origin || "To be confirmed"}</span>
            <span className="sp-port-date">ETD {d(s.etd)}</span>
          </div>
          <div className="sp-route-line" aria-hidden>
            <span>{air ? "✈️" : "🚢"}</span>
          </div>
          <div className="sp-port end">
            <span className="sp-port-code">{s.destination ? portCode(s.destination) : "Destination"}</span>
            <span className="sp-port-name">{s.destination || "To be confirmed"}</span>
            <span className="sp-port-date">ETA {d(s.eta)}</span>
          </div>
        </div>
        {s.timeline.length > 0 && (
          <TimelineProgress steps={s.timeline} mode={s.mode ?? ""} delivered={s.completed} />
        )}
      </div>

      {pending && <AcceptBanner s={s} demo={demo} />}
      <div className="ps-grid">
        <div className="ps-main">
          <div className="panel">
            <div className="rfq-sec-head">Shipment</div>
            <div className="rfq-facts ps-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <span className="k">{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            {s.notes && (
              <p className="rfq-notes">
                <b>Notes:</b> {s.notes}
              </p>
            )}
            {(s.pickup || s.delivery) && <PartyBlock s={s} />}
          </div>

          {!pending && kind === "agent" && !s.completed && <BookingPanel s={s} air={air} busy={save.isPending} run={run} />}

          <PackingPanel s={s} />
          <ChargesPanel s={s} demo={demo} />
          {s.tracking && (s.tracking.pol_lat != null || s.tracking.vessel_lat != null) && <TrackingPanel s={s} />}
        </div>

        <div className="ps-side">
          {!pending && !s.completed && PARTNER_STATUSES[kind].length > 0 && <StatusPanel key={s.shipment_status ?? ""} s={s} kind={kind} busy={save.isPending} run={run} />}
          {!pending && <DocumentsPanel s={s} kind={kind} demo={demo} />}
          {kind === "clearing_agent" && (
            <div className="panel">
              <p className="hint" style={{ margin: 0 }}>
                Customs steps (entry lodged, query, cleared) are on the <b>Customs Files</b> tab.
              </p>
            </div>
          )}
          {!pending && !s.completed && <DelayPanel kind={kind} busy={save.isPending} run={run} />}
          {!pending && <MessagesPanel s={s} demo={demo} />}
        </div>
      </div>
    </>
  );
}

/** A shipment ExPac handed over and the partner hasn't accepted yet (0249). */
function AcceptBanner({ s, demo }: { s: PartnerShipment; demo: boolean }) {
  const { toast, error } = useToast();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const respond = usePartnerMutation((a: { accept: boolean; reason?: string }) =>
    demo ? Promise.resolve() : respondToShipment(s.id, a.accept, a.reason),
  );
  async function go(accept: boolean) {
    try {
      await respond.mutateAsync({ accept, reason: accept ? undefined : reason.trim() });
      toast(accept ? "Shipment accepted, thank you" : "Declined, ExPac has been told");
      setDeclining(false);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send your answer");
    }
  }
  return (
    <div className="panel ps-accept">
      <div>
        <b>ExPac has handed you this shipment.</b>
        <p className="hint" style={{ margin: "2px 0 0" }}>
          Check the route, dates, cargo and your charges below, then accept it to see the full details, update
          milestones, upload documents and message ExPac. If you can't handle it, decline and tell us why.
        </p>
      </div>
      <div className="ps-accept-btns">
        <button type="button" className="btn outline warn" disabled={respond.isPending} onClick={() => setDeclining(true)}>
          Decline
        </button>
        <button type="button" className="btn" disabled={respond.isPending} onClick={() => go(true)}>
          Accept shipment
        </button>
      </div>
      {declining && (
        <Modal title={`Decline ${s.reference}`} onClose={() => setDeclining(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            The shipment goes back to ExPac to hand to another partner. Tell us why so we can plan around it.
          </p>
          <div className="field">
            <label>Reason</label>
            <textarea
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. no space on the flight that week"
            />
          </div>
          <div className="ps-actions">
            <button type="button" className="btn outline" onClick={() => setDeclining(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn warn"
              disabled={respond.isPending || !reason.trim()}
              onClick={() => go(false)}
            >
              Decline shipment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PartyBlock({ s }: { s: PartnerShipment }) {
  const party = (title: string, p: NonNullable<PartnerShipment["pickup"]>) => (
    <div className="ps-party">
      <span className="k">{title}</span>
      {p.company && <b>{p.company}</b>}
      <div>{dash(p.address)}</div>
      <div className="hint">{[p.contact, p.phone, p.email].filter(Boolean).join(" · ") || "-"}</div>
    </div>
  );
  return (
    <div className="ps-parties">
      {s.pickup && party("Collect from (shipper)", s.pickup)}
      {s.delivery && party("Deliver to", s.delivery)}
    </div>
  );
}

type Run = (p: PartnerUpdate, ok: string) => Promise<boolean>;

function BookingPanel({ s, air, busy, run }: { s: PartnerShipment; air: boolean; busy: boolean; run: Run }) {
  const start = {
    carrier_name: s.carrier_name ?? "",
    shipping_line: s.shipping_line ?? "",
    vessel_name: s.vessel_name ?? "",
    voyage_no: s.voyage_no ?? "",
    awb_mbl: s.awb_mbl ?? "",
    container_no: s.container_no ?? "",
    seal_no: s.seal_no ?? "",
    etd: s.etd ?? "",
    eta: s.eta ?? "",
  };
  const [f, setF] = useState(start);
  const set = (k: keyof typeof start) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const changed = (Object.keys(start) as (keyof typeof start)[]).filter((k) => f[k] !== start[k]);
  return (
    <div className="panel">
      <div className="rfq-sec-head">Booking details</div>
      <div className="ps-form">
        <div className="field">
          <label>{air ? "Airline" : "Carrier"}</label>
          <input value={f.carrier_name} onChange={set("carrier_name")} />
        </div>
        {!air && (
          <div className="field">
            <label>Shipping line</label>
            <input value={f.shipping_line} onChange={set("shipping_line")} />
          </div>
        )}
        <div className="field">
          <label>{air ? "Flight no" : "Vessel"}</label>
          <input value={f.vessel_name} onChange={set("vessel_name")} />
        </div>
        {!air && (
          <div className="field">
            <label>Voyage</label>
            <input value={f.voyage_no} onChange={set("voyage_no")} />
          </div>
        )}
        <div className="field">
          <label>{air ? "MAWB" : "MBL"}</label>
          <input value={f.awb_mbl} onChange={set("awb_mbl")} />
        </div>
        {!air && (
          <>
            <div className="field">
              <label>Container no</label>
              <input value={f.container_no} onChange={set("container_no")} />
            </div>
            <div className="field">
              <label>Seal no</label>
              <input value={f.seal_no} onChange={set("seal_no")} />
            </div>
          </>
        )}
        <div className="field">
          <label>ETD</label>
          <DateInput value={f.etd} onChange={(v) => setF({ ...f, etd: v })} />
        </div>
        <div className="field">
          <label>ETA</label>
          <DateInput value={f.eta} onChange={(v) => setF({ ...f, eta: v })} />
        </div>
      </div>
      <div className="ps-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || changed.length === 0}
          onClick={() => run(Object.fromEntries(changed.map((k) => [k, f[k]])) as PartnerUpdate, "Booking details saved, ExPac can see them")}
        >
          Save booking details
        </button>
      </div>
    </div>
  );
}

function StatusPanel({ s, kind, busy, run }: { s: PartnerShipment; kind: PartnerKind; busy: boolean; run: Run }) {
  const options = partnerStatuses(kind, s.mode);
  const cur = options.indexOf(s.shipment_status ?? "");
  const next = options[Math.min(cur + 1, options.length - 1)] ?? options[0];
  const [status, setStatus] = useState(next);
  const [pick, setPick] = useState(false);
  const [note, setNote] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [podDate, setPodDate] = useState(new Date().toISOString().slice(0, 10));
  const delivered = status === "Delivered";
  const atEnd = cur === options.length - 1;
  return (
    <div className="panel ps-next">
      <div className="rfq-sec-head">Update the milestone</div>
      <p className="ps-next-now">
        Now: <b>{s.shipment_status ? stepLabel(s.shipment_status, s.mode) : "Created"}</b>
      </p>
      {pick || atEnd ? (
        <div className="field">
          <label>New status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {stepLabel(o, s.mode)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="ps-next-to">
          Next: <b>{stepLabel(status, s.mode)}</b>{" "}
          <button type="button" className="link-btn" onClick={() => setPick(true)}>
            choose another
          </button>
        </p>
      )}
      {delivered && (
        <>
          <div className="field">
            <label>Signed for by</label>
            <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name of the person who signed" />
          </div>
          <div className="field">
            <label>Delivered on</label>
            <DateInput value={podDate} onChange={setPodDate} />
          </div>
        </>
      )}
      <div className="field">
        <label>Note (optional)</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy || (delivered && !signedBy.trim())}
        onClick={async () => {
          const ok = await run(
            {
              status,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(delivered ? { pod_signed_by: signedBy.trim(), pod_delivered_at: podDate } : {}),
            },
            `Status set to ${stepLabel(status, s.mode)}`,
          );
          if (ok) {
            setNote("");
            setPick(false);
          }
        }}
      >
        Mark as {stepLabel(status, s.mode)}
      </button>
      {delivered && <p className="hint">Upload the signed Proof of Delivery under Documents as well.</p>}
    </div>
  );
}

function DelayPanel({ kind, busy, run }: { kind: PartnerKind; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  if (!open)
    return (
      <div className="panel">
        <button type="button" className="btn outline warn" onClick={() => setOpen(true)}>
          Report a delay
        </button>
      </div>
    );
  return (
    <div className="panel">
      <div className="rfq-sec-head">Report a delay</div>
      <div className="field">
        <label>What happened</label>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. vessel rolled to next week" />
      </div>
      {kind !== "clearing_agent" && (
        <div className="field">
          <label>{kind === "agent" ? "New ETA" : "New delivery date"}</label>
          <DateInput value={date} onChange={setDate} />
        </div>
      )}
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn outline warn"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            if (await run({ delay_reason: reason.trim(), ...(date ? { delay_date: date } : {}) }, "Delay reported to ExPac")) {
              setOpen(false);
              setReason("");
              setDate("");
            }
          }}
        >
          Send to ExPac
        </button>
      </div>
    </div>
  );
}

function PackingPanel({ s }: { s: PartnerShipment }) {
  const vf = volumetricFactor(s.mode);
  const pack = packingTotals(s.packing, vf);
  return (
    <div className="panel">
      <div className="rfq-sec-head">Packing List Information</div>
      {s.packing.length === 0 ? (
        <p className="hint">Packing list to follow.</p>
      ) : (
        <>
          <div className="rfq-scroll">
            <table className="qs-pk rfq-pk">
              <thead>
                <tr>
                  <th>L<br />(cm)</th>
                  <th>W<br />(cm)</th>
                  <th>H<br />(cm)</th>
                  <th>Act<br />(Kg)</th>
                  <th>Qty<br />(Pcs)</th>
                  <th>Qty<br />(Ctns)</th>
                  <th>CBM<br />(Ctn)</th>
                  <th>Ttl<br />(Cbm)</th>
                  <th>Ttl Act<br />(Kg)</th>
                  <th>Ttl Vol<br />(Kg)</th>
                </tr>
              </thead>
              <tbody>
                {s.packing.map((p, i) => {
                  const r = packingRow(p, vf);
                  return (
                    <tr key={i}>
                      <td>{n2(Number(p.length_cm))}</td>
                      <td>{n2(Number(p.width_cm))}</td>
                      <td>{n2(Number(p.height_cm))}</td>
                      <td>{n2(Number(p.actual_kg))}</td>
                      <td>{n2(Number(p.qty_pcs))}</td>
                      <td>{n2(Number(p.qty_ctns))}</td>
                      <td>{n2(r.cbm)}</td>
                      <td>{n2(r.totalCbm)}</td>
                      <td>{n2(r.totalActual)}</td>
                      <td>{n2(r.totalVolume)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rfq-pksum">
            <span>
              Pcs <b>{n2(pack.pcs)}</b>
            </span>
            <span>
              Total Act (KGS) <b>{n2(pack.totalActual)}</b>
            </span>
            <span>
              Chg Vol (CBM) <b>{n2(pack.totalCbm)}</b>
            </span>
            <span>
              Chg Weight (KGS) <b>{n2(pack.chargeable)}</b>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ChargesPanel({ s, demo }: { s: PartnerShipment; demo: boolean }) {
  return (
    <div className="panel">
      <div className="rfq-sec-head">Your charges on this shipment</div>
      {s.charges.length === 0 ? (
        <p className="hint">No charges from you on this shipment yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="customs-table ps-charges">
            <thead>
              <tr>
                <th>Charge</th>
                <th>Unit</th>
                <th>Cur</th>
                <th className="num">Rate</th>
                <th className="num">Qty</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.charges.map((c, i) => (
                <tr key={i}>
                  <td>
                    {c.description}
                    {c.code && <div className="hint">{c.code}</div>}
                  </td>
                  <td>{dash(c.unit)}</td>
                  <td>{c.cur}</td>
                  <td className="num">{n2(Number(c.rate))}</td>
                  <td className="num">{n2(Number(c.qty ?? 1))}</td>
                  <td className="num">{n2(Number(c.rate) * Number(c.qty ?? 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>
        Rates as agreed with ExPac, excl. VAT.{" "}
        {s.acceptance !== "pending" && !demo && (
          <Link to={`/partner/invoices?job=${s.id}`}>Invoice this shipment →</Link>
        )}
      </p>
    </div>
  );
}

function DocumentsPanel({ s, kind, demo }: { s: PartnerShipment; kind: PartnerKind; demo: boolean }) {
  const { toast, error } = useToast();
  const types = PARTNER_DOC_TYPES[kind];
  const [docType, setDocType] = useState(types[0]);
  const input = useRef<HTMLInputElement>(null);
  const upload = usePartnerMutation((f: File) => (demo ? Promise.resolve() : uploadPartnerDocument(s.id, f, docType).then(() => undefined)));
  async function open(path: string) {
    try {
      window.open(await getShipmentDocumentUrl(path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the document");
    }
  }
  const pickFile = (t: string) => {
    setDocType(t);
    input.current?.click();
  };
  const slots = PARTNER_DOC_SLOTS[kind];
  const others = s.documents.filter((doc) => !slots.includes(doc.doc_type ?? ""));
  return (
    <div className="panel">
      <div className="rfq-sec-head">Documents</div>
      <ul className="ps-slots">
        {slots.map((t) => {
          const docs = s.documents.filter((doc) => doc.doc_type === t);
          return (
            <li key={t} className={docs.length ? "has" : undefined}>
              <span className="ps-slot-tick" aria-hidden>
                {docs.length ? "✓" : ""}
              </span>
              <div className="ps-slot-body">
                <b>{t}</b>
                {docs.map((doc) => (
                  <button key={doc.id} type="button" className="link-btn" onClick={() => open(doc.storage_path)}>
                    {doc.name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn small outline" disabled={upload.isPending} onClick={() => pickFile(t)}>
                {docs.length ? "Add" : "Upload"}
              </button>
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <ul className="ps-docs">
          {others.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="link-btn" onClick={() => open(doc.storage_path)}>
                {doc.name}
              </button>
              <span className="hint">
                {dash(doc.doc_type)} · {formatDate(doc.created_at)}
                {doc.mine ? " · uploaded by you" : " · from ExPac"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="ps-upload">
        <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button type="button" className="btn outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? "Uploading…" : "Upload other"}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 20 * 1024 * 1024) return error("That file is over 20 MB");
            try {
              await upload.mutateAsync(f);
              toast(`${docType} uploaded, ExPac can see it`);
            } catch (err) {
              error(err instanceof Error ? err.message : "Could not upload");
            }
          }}
        />
      </div>
    </div>
  );
}

function TrackingPanel({ s }: { s: PartnerShipment }) {
  const t = s.tracking!;
  const route = useMemo(
    () =>
      aisRoute({
        pol: t.pol ?? s.origin,
        pod: t.pod ?? s.destination,
        pol_lat: t.pol_lat,
        pol_lon: t.pol_lon,
        pod_lat: t.pod_lat,
        pod_lon: t.pod_lon,
        atd: t.atd,
        etd: t.etd,
        pod_ata: t.pod_ata,
        pod_eta: t.pod_eta,
        eta: t.eta ?? s.eta,
        vessel_name: t.vessel_name,
        voyage: t.voyage,
        vessel_lat: t.vessel_lat,
        vessel_lon: t.vessel_lon,
        position_at: t.position_at,
        speed_kn: t.speed_kn,
      }),
    [t, s.origin, s.destination, s.eta],
  );
  return (
    <div className="panel">
      <div className="rfq-sec-head">Live tracking</div>
      <TrackingMap height={280} route={route} mode={s.mode} />
      <p className="hint" style={{ marginBottom: 0 }}>
        {[t.vessel_name, t.voyage].filter(Boolean).join(" / ") || "-"}
        {t.position_at ? ` · last update ${formatDateTime(t.position_at)}` : ""}
      </p>
    </div>
  );
}

function MessagesPanel({ s, demo }: { s: PartnerShipment; demo: boolean }) {
  const { toast, error } = useToast();
  const [draft, setDraft] = useState("");
  const send = usePartnerMutation((body: string) => (demo ? Promise.resolve() : sendPartnerMessage(s.id, body)));
  return (
    <div className="panel">
      <div className="rfq-sec-head">Messages with ExPac</div>
      <div className="ps-msgs">
        {s.messages.length === 0 ? (
          <p className="hint">No messages yet.</p>
        ) : (
          s.messages.map((m) => (
            <div key={m.id} className={`ps-msg ${m.direction === "in" ? "me" : "them"}`}>
              <div>{m.body}</div>
              <span className="hint">
                {m.direction === "in" ? "You" : "ExPac"} · {formatDateTime(m.created_at)}
              </span>
            </div>
          ))
        )}
      </div>
      <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write to ExPac about this shipment" />
      <div className="ps-actions">
        <button
          type="button"
          className="btn"
          disabled={send.isPending || !draft.trim()}
          onClick={async () => {
            try {
              await send.mutateAsync(draft.trim());
              setDraft("");
              toast("Message sent to ExPac");
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not send");
            }
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
