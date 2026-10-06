import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNote, Loading, PageHeader } from "../../components/common";
import { useMyJobTracking, useMyJobs, useMyProfile } from "../../lib/hooks";
import { formatDate, money, portCode } from "../../lib/format";
import { DELIVERED_STATUS, type ClientJob } from "../../lib/types";
import { WMS_STAGE_LABEL, greetingFor, portalQuoteStatus, usePortalQuotes, wmsStage } from "../../lib/portal";
import {
  accruedThisMonth,
  useWmsMoves,
  useWmsPreadvices,
  useWmsReleaseRequests,
  useWmsReceipts,
  useWmsServices,
  useWmsWarehouses,
  type WmsReceipt,
} from "../../lib/wms";
import { JourneySteps, useWmsJourney } from "./PortalWmsOverview";
import { PortalIcon, modeEmoji } from "./PortalLayout";
import { usePortalAnnouncements } from "../../lib/portal";

const isDone = (j: ClientJob) => j.shipment_status === DELIVERED_STATUS || j.milestone === "Delivered";
const modeKey = (m: string) =>
  m.startsWith("Air") ? "Air" : m.startsWith("Sea") ? "Sea" : m.startsWith("Road") ? "Road" : "Courier";
const MODE_COLOR: Record<string, string> = {
  Air: "var(--teal)",
  Sea: "var(--blue)",
  Road: "var(--amber)",
  Courier: "var(--green)",
};

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

/** Customer Portal › Dashboard (v2): greeting, KPIs, action list, shipment
 *  calendar, mode / quotation mix and recent shipments. */
export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const profileQ = useMyProfile();
  const jobsQ = useMyJobs();
  const trackQ = useMyJobTracking();
  const quotesQ = usePortalQuotes();
  const wmsQ = useWmsReceipts();
  const jobs = jobsQ.data ?? [];
  const quotes = quotesQ.data ?? [];
  const perms = profileQ.data?.portal_permissions;
  const canQuote = perms?.quotes !== false;

  const track = useMemo(() => new Map((trackQ.data ?? []).map((t) => [t.job_id, t])), [trackQ.data]);
  const etaOf = (j: ClientJob) => track.get(j.id)?.pod_eta || track.get(j.id)?.eta || j.eta;
  const etdOf = (j: ClientJob) => track.get(j.id)?.etd || j.etd;

  const active = jobs.filter((j) => !isDone(j));
  const byMode = ["Air", "Sea", "Road", "Courier"].map((m) => ({ m, n: active.filter((j) => modeKey(j.mode) === m).length }));
  const responses = quotes.filter((q) => portalQuoteStatus(q).label === "Response available");
  const requested = quotes.filter((q) => q.status === "open");
  const inStore = (wmsQ.data ?? []).filter((r) => r.on_hand > 0);
  // Motion Warehouse (0147-0150): requests, expected goods, services, exceptions.
  const relReqQ = useWmsReleaseRequests();
  const preQ = useWmsPreadvices();
  const svcQ = useWmsServices();
  const pendingReleases = (relReqQ.data ?? []).filter((r) => r.status === "requested");
  const expected = (preQ.data ?? []).filter((p) => p.status === "expected");
  const openServices = (svcQ.data ?? []).filter((s) => s.status === "requested" || s.status === "in_progress");
  const exceptions = (wmsQ.data ?? []).filter((r) => r.condition !== "good" && !r.exception_ack_at);
  const delivered = jobs
    .filter(isDone)
    .sort((a, b) => (b.pod_delivered_at ?? b.created_at).localeCompare(a.pod_delivered_at ?? a.created_at))
    .slice(0, 5);
  const soon = active.filter((j) => {
    const e = etaOf(j);
    if (!e) return false;
    const days = (new Date(e).getTime() - Date.now()) / 86_400_000;
    return days >= -1 && days <= 7;
  });

  return (
    <>
      <PageHeader
        eyebrow="ExPac Motion · your supply chain"
        title={`${greetingFor(profileQ.data, user?.email)}! 👋`}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate("/portal/rates")}>
              Search Rates
            </button>
            {canQuote && (
              <button className="btn" onClick={() => navigate("/portal/quotes/new")}>
                Request Quote
              </button>
            )}
          </>
        }
      />

      <div className="pt-kpis">
        <Kpi label="Total Active Shipments" value={active.length} icon="shipments" to="/portal/shipments" />
        <Kpi label="Air Shipments" value={byMode[0].n + byMode[3].n} icon="plane" to="/portal/shipments" />
        <Kpi label="Sea Shipments" value={byMode[1].n} icon="ship" to="/portal/shipments" />
        <Kpi label="Arriving in 7 days" value={soon.length} icon="calendar" to="/portal/shipments" />
        {canQuote && <Kpi label="Quotes ready for you" value={responses.length} icon="quotes" to="/portal/quotes" tone={responses.length ? "amber" : undefined} />}
        {inStore.length > 0 && <Kpi label="Receipts in warehouse" value={inStore.length} icon="warehouse" to="/portal/warehouse?view=stock" />}
      </div>

      <div className="pt-dash-grid">
        <div className="panel pt-span2">
          <ShipmentCalendar jobs={jobs} etaOf={etaOf} etdOf={etdOf} />
        </div>

        <WhatsNew />

        <div className="panel">
          <div className="panel-head">
            <h2>📊 Active shipments by mode</h2>
          </div>
          <Donut
            parts={byMode.filter((b) => b.n).map((b) => ({ label: b.m, value: b.n, color: MODE_COLOR[b.m] }))}
            total={active.length}
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>🏷️ Quotations</h2>
            <Link to="/portal/quotes" className="link-btn">
              View all
            </Link>
          </div>
          <Donut
            parts={[
              { label: "Requested", value: requested.length, color: "var(--muted)" },
              { label: "Ready for you", value: responses.length, color: "var(--amber)" },
              { label: "Accepted", value: quotes.filter((q) => q.status === "accepted" || q.status === "completed").length, color: "var(--green)" },
            ].filter((p) => p.value)}
            total={quotes.length}
          />
        </div>

        <div className="panel pt-span3">
          <div className="panel-head">
            <h2>🔔 Action required</h2>
          </div>
          {responses.length === 0 && requested.length === 0 && soon.length === 0 && exceptions.length === 0 && pendingReleases.length === 0 ? (
            <p className="hint">Nothing waiting on you right now.</p>
          ) : (
            <div className="pt-actions">
              {responses.map((q) => (
                <Link key={q.id} to={`/portal/quotes?open=${q.id}`} className="pt-action amber">
                  <b>{q.reference}</b>
                  <span>
                    Quotation ready, {portCode(q.origin)} → {portCode(q.destination)}
                    {q.valid_until ? ` · valid until ${formatDate(q.valid_until)}` : ""}
                  </span>
                  <em>Review &amp; accept →</em>
                </Link>
              ))}
              {exceptions.map((r) => (
                <Link key={r.id} to="/portal/warehouse?view=exceptions" className="pt-action amber">
                  <b>{r.receipt_no}</b>
                  <span>Goods received {r.condition}, please review the photos and ExPac's notes</span>
                  <em>Acknowledge →</em>
                </Link>
              ))}
              {soon.map((j) => (
                <Link key={j.id} to={`/portal/shipments/${j.id}`} className="pt-action">
                  <b>{j.reference}</b>
                  <span>
                    Arriving {formatDate(etaOf(j))} at {portCode(j.destination)}, have your documents / clearance ready
                  </span>
                </Link>
              ))}
              {requested.map((q) => (
                <Link key={q.id} to={`/portal/quotes?open=${q.id}`} className="pt-action muted">
                  <b>{q.reference}</b>
                  <span>Quote request with ExPac, we'll respond shortly</span>
                </Link>
              ))}
              {pendingReleases.map((r) => (
                <Link key={r.id} to="/portal/warehouse?view=requests" className="pt-action muted">
                  <b>{r.request_no}</b>
                  <span>Release request with ExPac, we'll confirm the release shortly</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="panel pt-span3">
          <div className="panel-head">
            <h2>🚚 Shipment activity</h2>
            <Link className="btn outline btn-sm" to="/portal/shipments">
              View all
            </Link>
          </div>
          {jobsQ.isLoading ? (
            <Loading />
          ) : jobsQ.isError ? (
            <ErrorNote error={jobsQ.error} />
          ) : jobs.length === 0 ? (
            <p className="hint">No shipments yet, request a quote to get your first one moving.</p>
          ) : (
            <div className="table-wrap">
              <table className="table--compact">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Shipper</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>ETD</th>
                    <th>ETA</th>
                    <th>PDD</th>
                  </tr>
                </thead>
                <tbody>
                  {active.slice(0, 8).map((j) => (
                    <tr key={j.id} className="clickable" onClick={() => navigate(`/portal/shipments/${j.id}`)}>
                      <td>
                        <span className="ref-link">{j.reference}</span>
                      </td>
                      <td>
                        {modeEmoji(j.mode)} {j.mode}
                      </td>
                      <td>
                        <span className="badge sent">{j.shipment_status || j.milestone}</span>
                      </td>
                      <td>{j.supplier_company || "—"}</td>
                      <td>{j.origin || "—"}</td>
                      <td>{j.destination || "—"}</td>
                      <td>{formatDate(etdOf(j))}</td>
                      <td>{formatDate(etaOf(j))}</td>
                      <td>{formatDate(j.provisional_delivery_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <WarehousePanel
          receipts={wmsQ.data ?? []}
          pendingReleases={pendingReleases.length}
          expected={expected.length}
          openServices={openServices.length}
        />

        <div className="panel pt-span3">
          <div className="panel-head">
            <h2>✅ Delivered</h2>
            <Link className="btn outline btn-sm" to="/portal/shipments">
              View all
            </Link>
          </div>
          {delivered.length === 0 ? (
            <p className="hint">No deliveries yet. Once a shipment is delivered, the signed proof of delivery shows here and on the shipment.</p>
          ) : (
            <div className="table-wrap">
              <table className="table--compact">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>Mode</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Delivered</th>
                    <th>Signed for by</th>
                    <th>Proof of Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {delivered.map((j) => (
                    <tr key={j.id} className="clickable" onClick={() => navigate("/portal/shipments")}>
                      <td>
                        <span className="ref-link">{j.reference}</span>
                      </td>
                      <td>
                        {modeEmoji(j.mode)} {j.mode}
                      </td>
                      <td>{portCode(j.origin) || "—"}</td>
                      <td>{portCode(j.destination) || "—"}</td>
                      <td>{formatDate(j.pod_delivered_at)}</td>
                      <td>{j.pod_signed_by || "—"}</td>
                      <td>{j.pod_delivered_at || j.pod_signed_by ? "✓ In the shipment's documents" : "Awaiting POD"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Dashboard › Motion Warehouse: what's in store, where it is in its
 *  journey, storage so far this month and open requests. */
function WarehousePanel({
  receipts,
  pendingReleases,
  expected,
  openServices,
}: {
  receipts: WmsReceipt[];
  pendingReleases: number;
  expected: number;
  openServices: number;
}) {
  const navigate = useNavigate();
  const j = useWmsJourney();
  const whQ = useWmsWarehouses();
  const movesQ = useWmsMoves();
  const accrued = useMemo(() => accruedThisMonth(whQ.data ?? [], receipts, movesQ.data ?? []), [whQ.data, receipts, movesQ.data]);
  const inStore = receipts.filter((r) => r.on_hand > 0);
  const preparing = inStore.filter((r) => wmsStage(r, j.tracker.get(r.id)) === "preparing").length;
  const storage = inStore.reduce((t, r) => t + (accrued.get(r.id) ?? 0), 0);
  const latest = [...receipts].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 6);
  const stats: [string, string, string][] = [
    ["In Motion Warehouse", String(inStore.length), "/portal/warehouse?view=stock"],
    ["Pieces in store", String(inStore.reduce((t, r) => t + r.on_hand, 0)), "/portal/warehouse?view=stock"],
    ["Being prepared for shipping", String(preparing), "/portal/warehouse"],
    ["Storage this month (est., excl. VAT)", money(storage), "/portal/warehouse?view=statements"],
    ["Release requests pending", String(pendingReleases), "/portal/warehouse?view=requests"],
    ["Goods expected (pre-advised)", String(expected), "/portal/warehouse?view=preadvice"],
    ["Services in progress", String(openServices), "/portal/warehouse?view=services"],
  ];
  return (
    <div className="panel pt-span3">
      <div className="panel-head">
        <h2>🏭 Motion Warehouse</h2>
        <span style={{ display: "flex", gap: 8 }}>
          <Link className="btn outline btn-sm" to="/portal/warehouse?view=preadvice">
            Pre-advise goods
          </Link>
          <Link className="btn outline btn-sm" to="/portal/warehouse?view=requests">
            Request a release
          </Link>
          <Link className="btn outline btn-sm" to="/portal/warehouse">
            View all
          </Link>
        </span>
      </div>
      <div className="pt-mini-stats">
        {stats.map(([k, v, to]) => (
          <Link key={k} to={to}>
            <span>{k}</span>
            <b>{v}</b>
          </Link>
        ))}
      </div>
      {latest.length === 0 ? (
        <p className="hint">Nothing received for you yet. Pre-advise goods you're sending to ExPac and follow them here from receipt to shipment.</p>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received</th>
                <th>Description</th>
                <th>Pieces</th>
                <th>Where</th>
                <th>Journey</th>
                <th>Shipment</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((r) => {
                const t = j.tracker.get(r.id);
                const stage = wmsStage(r, t);
                return (
                  <tr key={r.id} className="clickable" onClick={() => navigate("/portal/warehouse")} title={WMS_STAGE_LABEL[stage]}>
                    <td>
                      <b>{r.receipt_no}</b>
                    </td>
                    <td>{formatDate(r.received_at)}</td>
                    <td>{r.description || "—"}</td>
                    <td>
                      {r.on_hand} / {r.pieces}
                    </td>
                    <td>{r.on_hand > 0 ? j.whereOf(r) : "Shipped"}</td>
                    <td>
                      <JourneySteps stage={stage} />
                    </td>
                    <td>{t?.shipment_ref ? <span className="ref-link">{t.shipment_ref}</span> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, to, tone }: { label: string; value: number; icon: string; to: string; tone?: "amber" }) {
  return (
    <Link to={to} className={`pt-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="pt-kpi-label">{label}</span>
      <span className="pt-kpi-icon" aria-hidden>
        <PortalIcon name={icon} />
      </span>
      <span className="pt-kpi-value">{value}</span>
    </Link>
  );
}

function Donut({ parts, total }: { parts: { label: string; value: number; color: string }[]; total: number }) {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="pt-donut">
      <svg viewBox="0 0 120 120" width="150" height="150">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--paper)" strokeWidth="16" />
        {sum > 0 &&
          parts.map((p) => {
            const len = (p.value / sum) * C;
            const el = (
              <circle
                key={p.label}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="60" y="56" textAnchor="middle" className="pt-donut-cap">
          Total
        </text>
        <text x="60" y="74" textAnchor="middle" className="pt-donut-num">
          {total}
        </text>
      </svg>
      <div className="pt-legend">
        {parts.length === 0 && <span className="hint">Nothing yet</span>}
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.value} {p.label}
            {sum ? ` (${Math.round((p.value / sum) * 100)}%)` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Week view: departures (ETD) and arrivals (ETA) per day. */
function ShipmentCalendar({
  jobs,
  etaOf,
  etdOf,
}: {
  jobs: ClientJob[];
  etaOf: (j: ClientJob) => string | null | undefined;
  etdOf: (j: ClientJob) => string | null | undefined;
}) {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [show, setShow] = useState<"all" | "dep" | "arr">("all");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = iso(new Date());
  const end = days[6];
  const shift = (n: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + n * 7);
    setWeekStart(d);
  };
  const isThisWeek = iso(weekStart) === iso(startOfWeek(new Date()));
  return (
    <>
      <div className="panel-head">
        <h2>📅 Shipments calendar</h2>
        <div className="wms-seg">
          {(
            [
              ["all", "All"],
              ["dep", "Departures"],
              ["arr", "Arrivals"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={show === k ? "active" : ""} onClick={() => setShow(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-cal-bar">
        <b>{isThisWeek ? "This week" : `Week of ${formatDate(iso(weekStart))}`}</b>
        <span>
          <button type="button" className="link-btn" onClick={() => shift(-1)}>
            ‹
          </button>{" "}
          {formatDate(iso(weekStart))} – {formatDate(iso(end))}{" "}
          <button type="button" className="link-btn" onClick={() => shift(1)}>
            ›
          </button>
        </span>
      </div>
      <div className="pt-cal">
        {days.map((d) => {
          const key = iso(d);
          const dep = show !== "arr" ? jobs.filter((j) => (etdOf(j) ?? "").slice(0, 10) === key) : [];
          const arr = show !== "dep" ? jobs.filter((j) => (etaOf(j) ?? "").slice(0, 10) === key) : [];
          return (
            <div key={key} className={`pt-cal-day${key === today ? " today" : ""}`}>
              <div className="pt-cal-head">
                {d.toLocaleDateString("en-ZA", { weekday: "short" }).toUpperCase()} {d.getDate()}
              </div>
              {dep.map((j) => (
                <button key={`d${j.id}`} type="button" className="pt-cal-ev dep" onClick={() => navigate(`/portal/shipments/${j.id}`)}>
                  <b>{j.reference}</b>
                  <span>Departing {j.origin ? portCode(j.origin) : ""}</span>
                </button>
              ))}
              {arr.map((j) => (
                <button key={`a${j.id}`} type="button" className="pt-cal-ev arr" onClick={() => navigate(`/portal/shipments/${j.id}`)}>
                  <b>{j.reference}</b>
                  <span>Arriving at {j.destination || "destination"}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** What's new, the images in Sales CRM › Media › Announcements (0144). */
function WhatsNew() {
  const q = usePortalAnnouncements();
  const items = q.data ?? [];
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const cur = items[Math.min(i, items.length - 1)];
  return (
    <div className="panel pt-news">
      <div className="panel-head">
        <h2>📣 Announcements</h2>
        {items.length > 1 && (
          <span className="pt-news-nav">
            <button type="button" className="link-btn" onClick={() => setI((i - 1 + items.length) % items.length)} aria-label="Previous">
              ‹
            </button>
            {i + 1} / {items.length}
            <button type="button" className="link-btn" onClick={() => setI((i + 1) % items.length)} aria-label="Next">
              ›
            </button>
          </span>
        )}
      </div>
      {cur ? (
        // Whole image, fitted to the box (no cropping); click for full size.
        <button type="button" className="pt-news-item" onClick={() => setZoom(true)} title="View full image">
          <img src={cur.url} alt={cur.title} />
        </button>
      ) : (
        <div className="pt-news-empty">
          <img src="/Logo.jpg" alt="ExPac" />
          <p>
            Welcome to ExPac Motion, request quotes, accept quotations and follow every shipment here. News and updates from the
            ExPac team will show in this space.
          </p>
        </div>
      )}
      {zoom && cur && (
        <div className="pt-lightbox" onClick={() => setZoom(false)} role="dialog" aria-label="Announcements">
          <img src={cur.url} alt={cur.title} />
          <button type="button" className="pt-lightbox-x" aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
