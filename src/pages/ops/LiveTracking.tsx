import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import DataTable, { type DataColumn } from "../../components/DataTable";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  useJobTracking,
  useJobs,
  useRefreshTracking,
  useTrackingEvents,
} from "../../lib/hooks";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import { etaSlipped, trackableRef, trackingTone } from "../../lib/tracking";
import TrackingMap from "../../components/TrackingMap";
import { isShipmentComplete, type Job, type JobTracking } from "../../lib/types";

export default function LiveTracking() {
  const { error } = useToast();
  const jobsQ = useJobs();
  const trackQ = useJobTracking();
  const refresh = useRefreshTracking();
  const [mapJob, setMapJob] = useState<Job | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeJobs = useMemo(
    () => (jobsQ.data ?? []).filter((j) => !isShipmentComplete(j)),
    [jobsQ.data],
  );
  const trackingByJob = useMemo(() => {
    const m = new Map<string, JobTracking>();
    for (const t of trackQ.data ?? []) m.set(t.job_id, t);
    return m;
  }, [trackQ.data]);

  const trackable = useMemo(
    () => activeJobs.filter((j) => trackableRef(j)),
    [activeJobs],
  );
  const noNumber = useMemo(
    () => activeJobs.filter((j) => !trackableRef(j)),
    [activeJobs],
  );

  const summary = useMemo(() => {
    let onTrack = 0;
    let exceptions = 0;
    let arriving = 0;
    const in7 = new Date(new Date().getTime() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    for (const j of trackable) {
      const t = trackingByJob.get(j.id);
      const tone = trackingTone(t?.status ?? j.shipment_status);
      if (tone === "alert" || j.shipment_status === "Detained") exceptions += 1;
      else onTrack += 1;
      const eta = t?.eta ?? j.eta;
      if (eta && eta >= today && eta <= in7) arriving += 1;
    }
    return { onTrack, exceptions, arriving };
  }, [trackable, trackingByJob]);

  async function onRefresh(job: Job) {
    setBusyId(job.id);
    try {
      const existing = trackingByJob.get(job.id);
      const ref = trackableRef(job);
      // A stored ShipsGo id only applies to the number it was resolved
      // against. If the container/AWB/MBL on the job changed since the last
      // sync, the id is stale — force a fresh lookup by number instead of
      // re-fetching whatever the old number pointed to.
      const sameRef = !!ref && existing?.ref_value === ref.value;
      await refresh.mutateAsync({
        job,
        shipsgoId: sameRef ? (existing?.shipsgo_id ?? null) : null,
      });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not refresh");
    } finally {
      setBusyId(null);
    }
  }

  const trkCols = useMemo<DataColumn<Job>[]>(
    () => [
      {
        key: "refresh",
        fixed: true,
        width: 92,
        header: "",
        render: (j) => (
          <button
            className="btn small outline"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(j);
            }}
            disabled={busyId === j.id}
          >
            {busyId === j.id ? "…" : "Refresh"}
          </button>
        ),
      },
      {
        key: "shipment",
        header: "Shipment",
        width: 220,
        sortValue: (j) => j.reference,
        render: (j) => (
          <div style={{ lineHeight: 1.35 }}>
            <span className="ref-link">{j.reference}</span>
            <div className="hint">
              {j.supplier?.company ?? "—"} → {j.client?.company ?? "—"}
            </div>
          </div>
        ),
      },
      {
        key: "mode",
        header: "Mode",
        width: 130,
        sortValue: (j) => j.mode,
        render: (j) => <span className="mode-tag">{j.mode}</span>,
      },
      {
        key: "lane",
        header: "Lane",
        width: 140,
        cellClass: "nowrap",
        sortValue: (j) => `${portCode(j.origin)} → ${portCode(j.destination)}`,
        render: (j) => `${portCode(j.origin)} → ${portCode(j.destination)}`,
      },
      {
        key: "reference",
        header: "Reference",
        width: 180,
        cellClass: "nowrap",
        sortValue: (j) => trackableRef(j)?.value ?? "",
        render: (j) => {
          const ref = trackableRef(j);
          return ref ? (
            <>
              <span className="ref-badge">{ref.label}</span> {ref.value}
            </>
          ) : (
            "—"
          );
        },
      },
      {
        key: "status",
        header: "Status",
        width: 150,
        sortValue: (j) =>
          trackingByJob.get(j.id)?.status ?? j.shipment_status ?? "",
        render: (j) => {
          const status =
            trackingByJob.get(j.id)?.status ?? j.shipment_status ?? "—";
          return (
            <span className={`ms-tag tone-${trackingTone(status)}`}>
              {status}
            </span>
          );
        },
      },
      {
        key: "carrier",
        header: "Carrier",
        width: 150,
        sortValue: (j) => trackingByJob.get(j.id)?.carrier ?? "",
        render: (j) => trackingByJob.get(j.id)?.carrier ?? "—",
      },
      {
        key: "eta",
        header: "ETA",
        width: 130,
        sortValue: (j) => trackingByJob.get(j.id)?.eta ?? j.eta ?? "",
        render: (j) => {
          const t = trackingByJob.get(j.id);
          const eta = t?.eta ?? j.eta;
          const slipped = etaSlipped(j.eta, t?.eta);
          return (
            <span className={slipped ? "eta-slip" : ""}>
              {eta ? formatDate(eta) : "—"}
              {slipped && <span title="Later than planned ETA"> ▲</span>}
            </span>
          );
        },
      },
      {
        key: "synced",
        header: "Synced",
        width: 150,
        cellClass: "hint",
        sortValue: (j) => trackingByJob.get(j.id)?.synced_at ?? "",
        render: (j) => {
          const s = trackingByJob.get(j.id)?.synced_at;
          return s ? formatDateTime(s) : "never";
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackingByJob, busyId],
  );

  if (jobsQ.isLoading || trackQ.isLoading) return <div className="panel"><Loading /></div>;
  if (jobsQ.isError) return <div className="panel"><ErrorNote error={jobsQ.error} /></div>;

  return (
    <>
      <div className="panel">
        <div className="mini-stats">
          <div>
            <div className="k">Trackable shipments</div>
            <div className="v">{trackable.length}</div>
          </div>
          <div>
            <div className="k">On track</div>
            <div className="v">{summary.onTrack}</div>
          </div>
          <div>
            <div className="k">Exceptions</div>
            <div className="v" style={{ color: summary.exceptions ? "#b3261e" : undefined }}>
              {summary.exceptions}
            </div>
          </div>
          <div>
            <div className="k">Arriving ≤ 7 days</div>
            <div className="v">{summary.arriving}</div>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          ShipsGo pushes updates automatically once a shipment is registered —
          this board and the customer portal refresh live as they arrive.
          <strong> Refresh</strong> registers a new number / forces a re-sync
          (runs on the deployed site). Click a row for the live map.
        </p>
      </div>

      <div className="panel">
        {trackable.length === 0 ? (
          <EmptyState>
            No active shipment carries an AWB, MBL or container number yet.
          </EmptyState>
        ) : (
          <DataTable
            tableKey="live-tracking"
            className="trk-table"
            headerTools="row"
            columns={trkCols}
            rows={trackable}
            rowKey={(j) => j.id}
            onRowClick={(j) => setMapJob(j)}
          />
        )}

        {noNumber.length > 0 && (
          <div className="trk-nonum">
            <h3>Not trackable yet</h3>
            <p className="hint">
              Add an AWB / MBL or container number on the{" "}
              <Link to="/jobs">Active Shipments</Link> board.
            </p>
            <ul>
              {noNumber.map((j) => (
                <li key={j.id}>
                  <strong>{j.reference}</strong> · {j.mode} ·{" "}
                  {portCode(j.origin)} → {portCode(j.destination)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {mapJob && (
        <TrackMapModal
          job={mapJob}
          tracking={trackingByJob.get(mapJob.id)}
          onClose={() => setMapJob(null)}
        />
      )}
    </>
  );
}

function TrackMapModal({
  job,
  tracking,
  onClose,
}: {
  job: Job;
  tracking: JobTracking | undefined;
  onClose: () => void;
}) {
  const ref = trackableRef(job);
  const eventsQ = useTrackingEvents(job.id);
  const events = eventsQ.data ?? [];
  return (
    <Modal
      title={`${job.reference} — live tracking`}
      onClose={onClose}
      wide
      belowHeader={
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {tracking?.carrier ?? job.mode}
          {ref ? ` · ${ref.label} ${ref.value}` : ""}
          {tracking?.status ? ` · ${tracking.status}` : ""}
        </p>
      }
    >
      <TrackingMap
        height={440}
        pol={
          tracking?.pol_lat != null
            ? { lat: tracking.pol_lat, lon: tracking.pol_lon, label: tracking.pol }
            : null
        }
        pod={
          tracking?.pod_lat != null
            ? { lat: tracking.pod_lat, lon: tracking.pod_lon, label: tracking.pod }
            : null
        }
        vessel={
          tracking?.vessel_lat != null
            ? {
                lat: tracking.vessel_lat,
                lon: tracking.vessel_lon,
                label: tracking.vessel_name,
                at: tracking.position_at,
              }
            : null
        }
        events={events.map((e) => ({
          lat: e.lat,
          lon: e.lon,
          description: e.description,
          occurred_at: e.occurred_at,
          is_actual: e.is_actual,
        }))}
      />
      <TrackDetail
        job={job}
        tracking={tracking}
        events={events}
        refValue={ref?.value ?? ""}
      />
    </Modal>
  );
}

function TrackDetail({
  job,
  tracking,
  events,
  refValue,
}: {
  job: Job;
  tracking: JobTracking | undefined;
  events: import("../../lib/types").TrackingEvent[];
  refValue: string;
}) {
  if (!tracking) {
    return (
      <div className="trk-detail">
        <p className="hint">
          Not registered yet. Hit <strong>Refresh</strong> on the deployed site
          to register {refValue} with ShipsGo — after that, updates arrive
          automatically.
        </p>
      </div>
    );
  }
  // Prefer the tracking_events table; fall back to the legacy movements blob.
  const rows =
    events.length > 0
      ? events.map((e) => ({
          code: e.event_code || "",
          date: e.occurred_at,
          description: e.description || e.location || "",
          vessel: e.vessel_name,
          voyage: e.voyage,
          done: e.is_actual,
        }))
      : (tracking.movements ?? []).map((m) => ({
          code: m.code,
          date: m.date,
          description: m.description || m.location || "",
          vessel: m.vessel,
          voyage: m.voyage,
          done: m.done,
        }));
  return (
    <div className="trk-detail">
      <div className="trk-detail-head">
        <span className={`ms-tag tone-${trackingTone(tracking.status)}`}>
          {tracking.status ?? "—"}
        </span>
        <span>
          <b>Carrier</b> {tracking.carrier ?? "—"}
        </span>
        {tracking.vessel_name && (
          <span>
            <b>Vessel</b> {tracking.vessel_name}
          </span>
        )}
        <span>
          <b>{tracking.ref_type === "air" ? "AWB" : "Container / BL"}</b> {refValue}
        </span>
      </div>
      <div className="trk-route">
        <div>
          <div className="trk-port">{tracking.pol ?? portCode(job.origin)}</div>
          <div className="hint">{formatDate(tracking.etd)}</div>
        </div>
        <div className="trk-line" />
        <div>
          <div className="trk-port">{tracking.pod ?? portCode(job.destination)}</div>
          <div className="hint">
            {formatDate(tracking.pod_eta ?? tracking.eta)}
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="hint">No movements recorded yet.</p>
      ) : (
        <ol className="trk-timeline">
          {rows.map((m, i) => (
            <li key={i} className={m.done ? "done" : ""}>
              <span className="trk-code">{m.code || "—"}</span>
              <span className="trk-when">{formatDate(m.date)}</span>
              <span className="trk-where">
                {m.description || "—"}
                {m.vessel && <span className="hint"> · {m.vessel}</span>}
                {m.voyage && <span className="hint"> {m.voyage}</span>}
              </span>
              <span className="trk-tick">{m.done ? "✓" : "•"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
