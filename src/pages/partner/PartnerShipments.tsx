/**
 * Partner Portal › Shipments (0243): the shipments this partner is assigned
 * to, their leg only. Agents fill in the booking and move the shipment to
 * Departed; transporters and destination agents take it to Delivered with the
 * POD; everyone can report a delay, upload their documents and message ExPac.
 * Every step is logged on the shipment and opens a Control Tower task.
 */
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import BackButton from "../../components/BackButton";
import DateInput from "../../components/DateInput";
import TrackingMap from "../../components/TrackingMap";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { packingRow, packingTotals, volumetricFactor } from "../../lib/calc";
import { getShipmentDocumentUrl } from "../../lib/db";
import { formatDate, formatDateTime } from "../../lib/format";
import { stepLabel } from "../../lib/steps";
import { aisRoute } from "../../lib/trackRoute";
import { shipmentStatusSlug, type PartnerKind } from "../../lib/types";
import {
  isMissingPartnerShipments,
  PARTNER_DOC_TYPES,
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

export default function PartnerShipments({
  kind,
  demoRows,
  demoShipment,
}: {
  kind: PartnerKind;
  /** DEV previews only. */
  demoRows?: PartnerShipmentRow[];
  demoShipment?: PartnerShipment;
}) {
  const q = usePartnerShipments(!demoRows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");
  const all = useMemo(() => demoRows ?? q.data ?? [], [demoRows, q.data]);
  const active = all.filter((r) => !r.completed);
  const done = all.filter((r) => r.completed);
  const needle = search.trim().toLowerCase();
  const rows = (showDone ? done : active).filter(
    (r) => !needle || [r.reference, r.master_reference, r.awb_mbl, r.container_no].some((v) => v?.toLowerCase().includes(needle)),
  );

  if (openId)
    return <PartnerShipmentPage id={openId} kind={kind} demo={demoShipment} onBack={() => setOpenId(null)} />;
  if (!demoRows && q.isLoading) return <Loading />;
  if (!demoRows && q.error)
    return isMissingPartnerShipments(q.error) ? (
      <div className="panel">
        <EmptyState>Shipments are being switched on. Check back shortly.</EmptyState>
      </div>
    ) : (
      <ErrorNote error={q.error} />
    );

  return (
    <>
      <div className="ps-views">
        <div className="customs-views">
          <button type="button" className={`customs-view${!showDone ? " on" : ""}`} onClick={() => setShowDone(false)}>
            Active <span className="customs-view-n">{active.length}</span>
          </button>
          <button type="button" className={`customs-view${showDone ? " on" : ""}`} onClick={() => setShowDone(true)}>
            Delivered <span className="customs-view-n">{done.length}</span>
          </button>
        </div>
        <input
          className="ps-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shipment, MBL / AWB, container"
          aria-label="Search shipments"
        />
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <EmptyState>
            {needle
              ? "No shipment matches your search."
              : showDone
                ? "No delivered shipments in the last 60 days."
                : "No active shipments. Shipments ExPac assigns to you appear here."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="customs-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Route</th>
                  <th>{kind === "agent" ? "Cargo ready" : "ETD"}</th>
                  <th>ETA</th>
                  <th>MBL / AWB</th>
                  <th>Status</th>
                  <th>Action needed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="customs-row" onClick={() => setOpenId(r.id)}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => setOpenId(r.id)}>
                        {r.reference}
                      </button>
                      {r.unread > 0 && <span className="ps-unread">{r.unread} new</span>}
                      <div className="hint">
                        {r.mode?.replace(/ \(.*\)/, "")}
                        {r.incoterms ? ` · ${r.incoterms}` : ""}
                        {r.master_reference ? ` · on ${r.master_reference}` : ""}
                      </div>
                    </td>
                    <td>
                      {dash(r.origin)}
                      <div className="hint">to {dash(r.destination)}</div>
                    </td>
                    <td>{kind === "agent" ? d(r.ready_date) : d(r.etd)}</td>
                    <td>
                      <EtaCell eta={r.eta} done={r.completed} />
                    </td>
                    <td>
                      {dash(r.awb_mbl)}
                      {r.container_no && <div className="hint">{r.container_no}</div>}
                    </td>
                    <td>
                      <StatusPill status={r.shipment_status} mode={r.mode} />
                    </td>
                    <td>{r.action ? <span className="ps-action">{r.action}</span> : <span className="hint">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** ETA, flagged when it's 5 days away or past (same rule as Active Shipments). */
function EtaCell({ eta, done }: { eta: string | null; done: boolean }) {
  if (!eta) return <>-</>;
  const days = Math.ceil((new Date(eta).getTime() - Date.now()) / 86_400_000);
  return <span className={!done && days <= 5 ? "ps-eta-due" : undefined}>{formatDate(eta)}</span>;
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
      <div className="ps-head">
        <h2>{s.reference}</h2>
        <StatusPill status={s.shipment_status} mode={s.mode} />
        <span className="hint">
          {dash(s.origin)} to {dash(s.destination)}
        </span>
      </div>

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

          {kind === "agent" && !s.completed && <BookingPanel s={s} air={air} busy={save.isPending} run={run} />}

          <PackingPanel s={s} />
          <ChargesPanel s={s} />
          <DocumentsPanel s={s} kind={kind} demo={demo} />
          {s.tracking && (s.tracking.pol_lat != null || s.tracking.vessel_lat != null) && <TrackingPanel s={s} />}
        </div>

        <div className="ps-side">
          {!s.completed && PARTNER_STATUSES[kind].length > 0 && <StatusPanel s={s} kind={kind} busy={save.isPending} run={run} />}
          {kind === "clearing_agent" && (
            <div className="panel">
              <p className="hint" style={{ margin: 0 }}>
                Customs steps (entry lodged, query, cleared) are on the <b>Customs Files</b> tab.
              </p>
            </div>
          )}
          {!s.completed && <DelayPanel kind={kind} busy={save.isPending} run={run} />}
          <MessagesPanel s={s} demo={demo} />
          <HistoryPanel s={s} />
        </div>
      </div>
    </>
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
  const options = PARTNER_STATUSES[kind];
  const cur = options.indexOf(s.shipment_status ?? "");
  const [status, setStatus] = useState(options[Math.min(cur + 1, options.length - 1)] ?? options[0]);
  const [note, setNote] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [podDate, setPodDate] = useState(new Date().toISOString().slice(0, 10));
  const delivered = status === "Delivered";
  return (
    <div className="panel">
      <div className="rfq-sec-head">Update status</div>
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
          if (ok) setNote("");
        }}
      >
        Save status
      </button>
      {delivered && <p className="hint">Upload the signed POD under Documents as well.</p>}
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

function ChargesPanel({ s }: { s: PartnerShipment }) {
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
        Rates as agreed with ExPac, excl. VAT. Upload your invoice under Documents as "Supplier Invoice".
      </p>
    </div>
  );
}

function DocumentsPanel({ s, kind, demo }: { s: PartnerShipment; kind: PartnerKind; demo: boolean }) {
  const { toast, error } = useToast();
  const types = PARTNER_DOC_TYPES[kind];
  const [docType, setDocType] = useState(types[0]);
  const input = useRef<HTMLInputElement>(null);
  const upload = usePartnerMutation((f: File) => (demo ? Promise.resolve() : uploadPartnerDocument(s.id, f, docType)));
  async function open(path: string) {
    try {
      window.open(await getShipmentDocumentUrl(path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the document");
    }
  }
  return (
    <div className="panel">
      <div className="rfq-sec-head">Documents</div>
      {s.documents.length === 0 ? (
        <p className="hint">No documents yet.</p>
      ) : (
        <ul className="ps-docs">
          {s.documents.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="link-btn" onClick={() => open(doc.storage_path)}>
                {doc.name}
              </button>
              <span className="hint">
                {dash(doc.doc_type)} · {formatDate(doc.created_at)}
                {doc.mine ? " · uploaded by you" : ""}
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
          {upload.isPending ? "Uploading…" : "Upload document"}
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

function HistoryPanel({ s }: { s: PartnerShipment }) {
  if (s.timeline.length === 0 && s.history.length === 0) return null;
  return (
    <div className="panel">
      <div className="rfq-sec-head">Progress</div>
      <ol className="ps-steps">
        {s.timeline.map((t) => (
          <li key={t.step} className={t.done ? "done" : undefined}>
            <span>{stepLabel(t.step, s.mode)}</span>
            <span className="hint">{t.actual_date ? formatDate(t.actual_date) : t.planned_date ? `planned ${formatDate(t.planned_date)}` : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
