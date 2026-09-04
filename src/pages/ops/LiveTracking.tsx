import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useJobTracking, useJobs, useRefreshTracking } from "../../lib/hooks";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import { etaSlipped, trackableRef, trackingTone } from "../../lib/tracking";
import { isShipmentComplete, type Job, type JobTracking } from "../../lib/types";

export default function LiveTracking() {
  const { error } = useToast();
  const jobsQ = useJobs();
  const trackQ = useJobTracking();
  const refresh = useRefreshTracking();
  const [openId, setOpenId] = useState<string | null>(null);
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
      if (tone === "alert" || j.shipment_status === "Customs Detained") exceptions += 1;
      else onTrack += 1;
      const eta = t?.eta ?? j.eta;
      if (eta && eta >= today && eta <= in7) arriving += 1;
    }
    return { onTrack, exceptions, arriving };
  }, [trackable, trackingByJob]);

  async function onRefresh(job: Job) {
    setBusyId(job.id);
    try {
      await refresh.mutateAsync({
        job,
        shipsgoId: trackingByJob.get(job.id)?.shipsgo_id ?? null,
      });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not refresh");
    } finally {
      setBusyId(null);
    }
  }

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
          Data is pulled from ShipsGo on demand. The live pull runs on the
          deployed site; here in dev the last saved result is shown.
        </p>
      </div>

      <div className="panel">
        {trackable.length === 0 ? (
          <EmptyState>
            No active shipment carries an AWB, MBL or container number yet.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="trk-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Mode</th>
                  <th>Lane</th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Carrier</th>
                  <th>ETA</th>
                  <th>Synced</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trackable.map((j) => {
                  const ref = trackableRef(j)!;
                  const t = trackingByJob.get(j.id);
                  const status = t?.status ?? j.shipment_status ?? "—";
                  const eta = t?.eta ?? j.eta;
                  const slipped = etaSlipped(j.eta, t?.eta);
                  const open = openId === j.id;
                  return (
                    <Fragment key={j.id}>
                      <tr
                        className="trk-row clickable"
                        onClick={() => setOpenId(open ? null : j.id)}
                      >
                        <td>
                          <strong>{j.reference}</strong>
                        </td>
                        <td>
                          <span className="mode-tag">{j.mode}</span>
                        </td>
                        <td className="nowrap">
                          {portCode(j.origin)} → {portCode(j.destination)}
                        </td>
                        <td className="nowrap">
                          <span className="ref-badge">{ref.label}</span> {ref.value}
                        </td>
                        <td>
                          <span className={`ms-tag tone-${trackingTone(status)}`}>
                            {status}
                          </span>
                        </td>
                        <td>{t?.carrier ?? "—"}</td>
                        <td className={slipped ? "eta-slip" : ""}>
                          {eta ? formatDate(eta) : "—"}
                          {slipped && <span title="Later than planned ETA"> ▲</span>}
                        </td>
                        <td className="hint">
                          {t?.synced_at ? formatDateTime(t.synced_at) : "never"}
                        </td>
                        <td>
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
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={9}>
                            <TrackDetail job={j} tracking={t} refValue={ref.value} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
    </>
  );
}

function TrackDetail({
  job,
  tracking,
  refValue,
}: {
  job: Job;
  tracking: JobTracking | undefined;
  refValue: string;
}) {
  if (!tracking) {
    return (
      <div className="trk-detail">
        <p className="hint">
          No pull yet. Hit <strong>Refresh</strong> on the deployed site to fetch
          the movements for {refValue}.
        </p>
      </div>
    );
  }
  const moves = tracking.movements ?? [];
  return (
    <div className="trk-detail">
      <div className="trk-detail-head">
        <span className={`ms-tag tone-${trackingTone(tracking.status)}`}>
          {tracking.status ?? "—"}
        </span>
        <span>
          <b>Carrier</b> {tracking.carrier ?? "—"}
        </span>
        <span>
          <b>Reference</b> {job.reference}
        </span>
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
          <div className="hint">{formatDate(tracking.eta)}</div>
        </div>
      </div>
      {moves.length === 0 ? (
        <p className="hint">No movements recorded.</p>
      ) : (
        <ol className="trk-timeline">
          {moves.map((m, i) => (
            <li key={i} className={m.done ? "done" : ""}>
              <span className="trk-code">{m.code || "—"}</span>
              <span className="trk-when">{formatDate(m.date)}</span>
              <span className="trk-where">
                {m.description || m.location || "—"}
                {m.vessel && <span className="hint"> · {m.vessel}</span>}
                {m.voyage && <span className="hint"> {m.voyage}</span>}
              </span>
              <span className="trk-tick">{m.done ? "✓" : "•"}</span>
            </li>
          ))}
        </ol>
      )}
      <a
        className="btn small outline"
        href="https://expac.co.za/live-tracking/"
        target="_blank"
        rel="noreferrer"
      >
        Open live map ↗
      </a>
    </div>
  );
}
