import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useMyDocuments,
  useMyJobEvents,
  useMyJobs,
  useMyJobTracking,
  useMyMessages,
  useMyTrackingEvents,
  useSendMyMessage,
} from "../../lib/hooks";
import { getMyDocumentUrl } from "../../lib/db";
import { carrierLabel } from "../../lib/docTemplates";
import { currencyAmount, formatDate, formatDateTime, money, portCode } from "../../lib/format";
import { packingTotals, volumetricFactor } from "../../lib/calc";
import { MILESTONES, type Milestone, type PackingItem } from "../../lib/types";
import { portalTotals, usePortalLines, usePortalPacking, usePortalQuotes } from "../../lib/portal";
import TrackingMap from "../../components/TrackingMap";
import PortalQuoteModal from "./PortalQuoteViewPage";
import { modeEmoji } from "./PortalLayout";

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");
const day = (iso: string | null | undefined) => (iso ? formatDate(iso) : null);
const num = (n: number, unit: string, dp = 2) =>
  n > 0 ? `${n.toLocaleString("en-ZA", { maximumFractionDigits: dp })} ${unit}` : null;

/** Customer Portal › one shipment: progress from Created to Delivered,
 *  the route, the shipment / cargo / quotation details, live tracking,
 *  documents and messages. */
export default function PortalShipmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, error: toastError } = useToast();
  const jobsQ = useMyJobs();
  const job = jobsQ.data?.find((j) => j.id === id);
  const trackingQ = useMyJobTracking();
  const tracking = trackingQ.data?.find((t) => t.job_id === id);
  const trkEventsQ = useMyTrackingEvents(id);
  const trkEvents = trkEventsQ.data ?? [];
  const eventsQ = useMyJobEvents(id);
  const docsQ = useMyDocuments(id);
  const messagesQ = useMyMessages(id);
  const sendMessage = useSendMyMessage();
  const [draft, setDraft] = useState("");
  const [showQuote, setShowQuote] = useState(false);

  const quotesQ = usePortalQuotes();
  const quote = (quotesQ.data ?? []).find((q) => q.id === job?.quote_id) ?? null;
  const linesQ = usePortalLines(quote ? [quote.id] : []);
  const packQ = usePortalPacking(quote?.id);

  // When each milestone was reached: Created = booked into Motion, the rest
  // from the milestone log, Delivered from the proof of delivery.
  const reachedAt = useMemo(() => {
    const m = new Map<Milestone, string>();
    if (job) m.set("Created", job.created_at);
    for (const e of eventsQ.data ?? []) m.set(e.milestone as Milestone, e.created_at);
    if (job?.pod_delivered_at) m.set("Delivered", job.pod_delivered_at);
    return m;
  }, [job, eventsQ.data]);

  async function onDownload(storagePath: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await getMyDocumentUrl(storagePath);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      toastError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!id || !draft.trim()) return;
    try {
      await sendMessage.mutateAsync({ jobId: id, body: draft.trim() });
      setDraft("");
      toast("Message sent");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not send message");
    }
  }

  if (jobsQ.isLoading) return <Loading />;
  if (!job) return <ErrorNote error={new Error("Shipment not found")} />;

  const current = Math.max(0, MILESTONES.indexOf(job.milestone as Milestone));
  const delivered = job.milestone === "Delivered" || !!job.pod_delivered_at;
  const status = tracking?.status || job.shipment_status || job.milestone;
  const etd = tracking?.etd || job.etd;
  const eta = tracking?.pod_ata || tracking?.pod_eta || tracking?.eta || job.eta;
  const transitDays =
    etd && eta ? Math.round((Date.parse(eta.slice(0, 10)) - Date.parse(etd.slice(0, 10))) / 86_400_000) : null;
  const air = isAir(job.mode);

  const packing: PackingItem[] = (packQ.data ?? []).map((p) => ({ ...p, cbm: p.cbm ?? "" }));
  const pack = packingTotals(packing, volumetricFactor(job.mode));
  const tot = portalTotals(linesQ.data ?? []);

  return (
    <>
      <PageHeader
        eyebrow="My Shipments"
        title={job.reference}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate(-1)}>
              ← Back
            </button>
            {quote && (
              <button className="btn" onClick={() => setShowQuote(true)}>
                View quotation
              </button>
            )}
          </>
        }
      />

      {/* Progress, Created → Delivered */}
      <div className="panel sp-progress-panel">
        <div className="sp-progress-head">
          <div>
            <span className="sp-mode">
              {modeEmoji(job.mode)} {job.mode}
            </span>
            <span className={`sp-status${delivered ? " done" : ""}`}>{status}</span>
          </div>
          {!delivered && eta && <span className="sp-eta">Expected {formatDate(eta)}</span>}
          {delivered && job.pod_signed_by && <span className="sp-eta">Signed for by {job.pod_signed_by}</span>}
        </div>
        <ol className="sp-steps" style={{ ["--sp-frac" as string]: current / (MILESTONES.length - 1) }}>
          {MILESTONES.map((m, i) => {
            const state = i < current || (i === current && delivered) ? "done" : i === current ? "current" : "todo";
            const at = reachedAt.get(m);
            return (
              <li key={m} className={`sp-step ${state}`}>
                <span className="sp-dot" aria-hidden>
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className="sp-label">{m}</span>
                <span className="sp-when">{at && state !== "todo" ? formatDateTime(at) : state === "current" ? "Now" : ""}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Route */}
      <div className="panel sp-route">
        <div className="sp-port">
          <span className="sp-port-code">{job.origin ? portCode(job.origin) : "Origin"}</span>
          <span className="sp-port-name">{job.origin || "To be confirmed"}</span>
          <span className="sp-port-date">
            {air ? "Departs" : "ETD"} <b>{day(etd) ?? "to be confirmed"}</b>
          </span>
        </div>
        <div className="sp-route-line" aria-hidden>
          <span>{modeEmoji(job.mode)}</span>
          {transitDays != null && transitDays >= 0 && <em>{transitDays} days</em>}
        </div>
        <div className="sp-port end">
          <span className="sp-port-code">{job.destination ? portCode(job.destination) : "Destination"}</span>
          <span className="sp-port-name">{job.destination || "To be confirmed"}</span>
          <span className="sp-port-date">
            {tracking?.pod_ata ? "Arrived" : air ? "Arrives" : "ETA"} <b>{day(eta) ?? "to be confirmed"}</b>
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="sp-cards">
        <Card title="Shipment">
          <Row label="Shipment No" value={job.reference} />
          <Row label="Your reference" value={job.po_no || quote?.customer_reference} />
          <Row label={carrierLabel(job.mode)} value={tracking?.carrier || job.carrier_name || job.shipping_line} />
          {!air && <Row label="Vessel" value={tracking?.vessel_name || job.vessel_name} />}
          <Row label={air ? "AWB" : "MBL / B/L"} value={job.awb_mbl} />
          {!air && <Row label="Container" value={job.container_no} />}
          <Row label="Provisional delivery" value={day(job.provisional_delivery_date)} />
        </Card>

        <Card title="Cargo & parties">
          <Row label="Shipper" value={job.supplier_company} />
          <Row label="Consignee" value={quote?.consignee_company} />
          <Row label="Commodity" value={quote?.commodity} />
          <Row label="Incoterms" value={quote?.incoterms} />
          <Row label="Pieces" value={pack.qty > 0 ? String(pack.qty) : null} />
          <Row label="Gross weight" value={num(pack.totalActual, "kg")} />
          <Row label="Volume" value={num(pack.totalCbm, "CBM", 3)} />
          <Row label="Chargeable" value={num(pack.chargeable, "kg")} />
        </Card>

        <Card
          title="Quotation"
          action={
            quote ? (
              <button type="button" className="link-btn" onClick={() => setShowQuote(true)}>
                Open
              </button>
            ) : undefined
          }
        >
          {quote ? (
            <>
              <Row label="Quotation" value={quote.reference + ((quote.revision_no ?? 1) > 1 ? ` · Revision ${quote.revision_no}` : "")} />
              <Row label="Accepted" value={day(quote.accepted_at ?? quote.portal_decided_at)} />
              <Row label="Delivery terms" value={quote.delivery_terms} />
              <Row label="Commercial value" value={quote.commercial_value ? currencyAmount(quote.commercial_value, quote.value_currency as never) : null} />
              <Row label="Insurance" value={quote.insurance_amount ? currencyAmount(quote.insurance_amount, quote.value_currency as never) : null} />
              <Row label="Quoted total (incl. VAT)" value={tot.total > 0 ? money(tot.total) : null} strong />
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              {quotesQ.isLoading ? "Loading…" : "This shipment wasn't booked from a quotation on the portal."}
            </p>
          )}
        </Card>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Live Tracking</h2>
          </div>
        </div>
        {!tracking ? (
          <EmptyState>Tracking will appear here once the shipment is on the water / in the air.</EmptyState>
        ) : (
          <>
            <TrackingMap
              height={300}
              pol={tracking.pol_lat != null ? { lat: tracking.pol_lat, lon: tracking.pol_lon, label: tracking.pol } : null}
              pod={tracking.pod_lat != null ? { lat: tracking.pod_lat, lon: tracking.pod_lon, label: tracking.pod } : null}
              vessel={
                tracking.vessel_lat != null
                  ? { lat: tracking.vessel_lat, lon: tracking.vessel_lon, label: tracking.vessel_name, at: tracking.position_at }
                  : null
              }
              events={trkEvents.map((e) => ({
                lat: e.lat,
                lon: e.lon,
                description: e.description,
                occurred_at: e.occurred_at,
                is_actual: e.is_actual,
              }))}
            />
            {trkEvents.length > 0 && (
              <ol className="trk-timeline" style={{ marginTop: 12 }}>
                {trkEvents
                  .slice()
                  .reverse()
                  .map((e) => (
                    <li key={e.id} className={e.is_actual ? "done" : ""}>
                      <span className="trk-when">{formatDateTime(e.occurred_at)}</span>
                      <span className="trk-where">
                        {e.description || e.location || ""}
                        {e.vessel_name && <span className="muted small"> · {e.vessel_name}</span>}
                      </span>
                      <span className="trk-tick">{e.is_actual ? "✓" : "•"}</span>
                    </li>
                  ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="sp-two">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Documents</h2>
            </div>
          </div>
          {docsQ.isLoading ? (
            <Loading />
          ) : (docsQ.data ?? []).length === 0 ? (
            <EmptyState>No documents shared yet.</EmptyState>
          ) : (
            <div className="sp-docs">
              {(docsQ.data ?? []).map((d) => (
                <button key={d.id} type="button" className="sp-doc" onClick={() => onDownload(d.storage_path)}>
                  <span className="sp-doc-ico" aria-hidden>
                    📄
                  </span>
                  <span className="sp-doc-name">{d.name}</span>
                  <span className="sp-doc-meta">
                    {d.doc_type ? `${d.doc_type} · ` : ""}
                    {formatDate(d.created_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Messages</h2>
            </div>
          </div>
          <form onSubmit={onSend} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message ExPac about this shipment…"
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit" disabled={sendMessage.isPending}>
              Send
            </button>
          </form>
          {messagesQ.isLoading ? (
            <Loading />
          ) : (messagesQ.data ?? []).length === 0 ? (
            <EmptyState>No messages yet.</EmptyState>
          ) : (
            <div className="stack-sm">
              {(messagesQ.data ?? [])
                .slice()
                .reverse()
                .map((m) => (
                  <div key={m.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                    <div className="muted small">
                      {m.direction === "in" ? "You" : "ExPac"} · {formatDate(m.created_at)}
                    </div>
                    <div>{m.subject && <strong>{m.subject}</strong>}</div>
                    <div style={{ whiteSpace: "pre-line" }}>{m.body}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {showQuote && quote && <PortalQuoteModal quoteId={quote.id} onClose={() => setShowQuote(false)} />}
    </>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel sp-card">
      <div className="sp-card-head">
        <h3>{title}</h3>
        {action}
      </div>
      <dl className="sp-rows">{children}</dl>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={strong ? "strong" : undefined}>{value || <span className="hint">Not yet</span>}</dd>
    </>
  );
}
