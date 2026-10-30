import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import TrackingMap from "./TrackingMap";
import { useToast } from "./Toast";
import { formatDate, formatDateTime } from "../lib/format";
import { checkVessel } from "../lib/db";
import { useJobTracking, useUpdateJob } from "../lib/hooks";
import { trackableRef, trackingTone, vesselRef, vesselSearchUrl } from "../lib/tracking";
import { aisRoute } from "../lib/trackRoute";
import type { Job, JobTracking } from "../lib/types";

/** The AIS facts for a vessel-tracked shipment (0204): ETD / ATD, ETA,
 *  ATA, the ship's own next port and its last position. */
export function VesselFacts({ job, tracking }: { job: Job; tracking: JobTracking | null | undefined }) {
  const t = tracking?.provider === "ais" ? tracking : null;
  const nextIsPod = !!t?.pod_eta && t.next_port_eta === t.pod_eta;
  const rows: [string, string][] = [
    ["Vessel / voyage", [job.vessel_name, job.voyage_no].filter((v) => (v ?? "").trim()).join(" / ") || "—"],
    ["MMSI", job.vessel_mmsi || "—"],
    ["ETD (planned)", formatDate(job.etd)],
    ["ATD", t?.atd ? formatDateTime(t.atd) : t?.position_at ? "Not seen leaving yet" : "—"],
    ["ETA (planned)", formatDate(job.eta)],
    ["ETA (vessel AIS)", t?.pod_eta ? formatDateTime(t.pod_eta) : "—"],
    ["ATA", t?.pod_ata ? formatDateTime(t.pod_ata) : "—"],
  ];
  if (t?.next_port && !nextIsPod) {
    rows.push(["Next port (vessel AIS)", `${t.next_port}${t.next_port_eta ? `, ETA ${formatDateTime(t.next_port_eta)}` : ""}`]);
  }
  if (t?.position_at) {
    rows.push([
      "Last AIS position",
      [
        formatDateTime(t.position_at),
        typeof t.speed_kn === "number" ? `${t.speed_kn.toFixed(1)} kn` : null,
        t.nav_status,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  }
  return (
    <div className="vt-facts">
      <div className="trk-detail-head">
        <span className={`ms-tag tone-${trackingTone(t?.status)}`}>{t?.status ?? "Not checked yet"}</span>
        {t?.last_event && <span className="hint">{t.last_event}</span>}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="jv-field">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      {t?.static_at && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          The vessel's own destination and ETA, as its crew last entered them ({formatDateTime(t.static_at)}).
        </p>
      )}
    </div>
  );
}

/**
 * Shipment page (Overview), Sea Freight: vessel, voyage and MMSI, and the
 * AIS tracking that follows from the MMSI when there is no container / BL
 * for ShipsGo (e.g. DDP agents who may not share them).
 */
export default function VesselTrackingCard({ job }: { job: Job }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const updateJob = useUpdateJob();
  const tracking = (useJobTracking().data ?? []).find((t) => t.job_id === job.id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ vessel_name: "", voyage_no: "", vessel_mmsi: "" });
  const [checking, setChecking] = useState(false);

  const shipsgo = trackableRef(job);
  const vessel = vesselRef(job);
  const ais = tracking?.provider === "ais" ? tracking : null;
  const mmsiOk = !form.vessel_mmsi.trim() || /^\d{9}$/.test(form.vessel_mmsi.trim());

  function startEdit() {
    setForm({
      vessel_name: job.vessel_name ?? "",
      voyage_no: job.voyage_no ?? "",
      vessel_mmsi: job.vessel_mmsi ?? "",
    });
    setEditing(true);
  }

  function save() {
    updateJob.mutate(
      {
        id: job.id,
        patch: {
          vessel_name: form.vessel_name.trim(),
          voyage_no: form.voyage_no.trim(),
          vessel_mmsi: form.vessel_mmsi.trim(),
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast(form.vessel_mmsi.trim() && !shipsgo ? "Vessel saved, tracking starts on the next check" : "Vessel saved");
        },
        onError: (e) => error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }

  async function checkNow() {
    setChecking(true);
    try {
      const r = await checkVessel(job.id);
      qc.invalidateQueries({ queryKey: ["job_tracking"] });
      if (r.warning) error(r.warning);
      else if (r.heard) toast("Vessel position updated");
      else error("No AIS signal from the vessel right now (out of coastal range). It is checked every 10 minutes.");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not check the vessel");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="panel ws-panel vt-card">
      <div className="ws-sec-head">
        <h3>Vessel tracking</h3>
        <div className="vt-actions">
          {vessel && !editing && (
            <button className="btn outline small" onClick={() => void checkNow()} disabled={checking}>
              {checking ? "Listening…" : "Check now"}
            </button>
          )}
          {!editing && (
            <button className="btn ghost small" onClick={startEdit}>
              Edit vessel
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="vt-form">
          <label>
            <span>Vessel name</span>
            <input value={form.vessel_name} onChange={(e) => setForm((f) => ({ ...f, vessel_name: e.target.value }))} />
          </label>
          <label>
            <span>Voyage No</span>
            <input value={form.voyage_no} onChange={(e) => setForm((f) => ({ ...f, voyage_no: e.target.value }))} />
          </label>
          <label>
            <span>MMSI (9 digits)</span>
            <input
              inputMode="numeric"
              value={form.vessel_mmsi}
              onChange={(e) => setForm((f) => ({ ...f, vessel_mmsi: e.target.value.replace(/\D/g, "").slice(0, 9) }))}
            />
          </label>
          <p className="hint">
            Find the MMSI on{" "}
            <a href={vesselSearchUrl(form.vessel_name)} target="_blank" rel="noreferrer">
              VesselFinder
            </a>{" "}
            (search the vessel name, check the IMO / flag match, copy its MMSI). Once per vessel.
            {!mmsiOk && <b className="vt-err"> An MMSI is 9 digits.</b>}
          </p>
          <div className="vt-foot">
            <button className="btn outline small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn small" onClick={save} disabled={!mmsiOk || updateJob.isPending}>
              {updateJob.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : shipsgo ? (
        <>
          <p className="hint">
            Tracked on ShipsGo by {shipsgo.label.toLowerCase()} {shipsgo.value} (Control Tower › Live Tracking). Vessel
            tracking is for sea shipments without a container or BL number.
          </p>
          <div className="jv-field">
            <span className="k">Vessel / voyage</span>
            <span className="v">{[job.vessel_name, job.voyage_no].filter((v) => (v ?? "").trim()).join(" / ") || "—"}</span>
          </div>
        </>
      ) : vessel ? (
        <>
          {ais && (ais.position_at || ais.pol_lat != null) && (
            <TrackingMap height={260} route={aisRoute(ais)} mode={job.mode} />
          )}
          <VesselFacts job={job} tracking={ais} />
        </>
      ) : (
        <p className="hint">
          No container or BL number to track? Add the vessel and its MMSI ({" "}
          <b>Edit vessel</b>) and Motion follows the ship on AIS: departure (ATD), the vessel's ETA and arrival (ATA)
          at {job.destination || "the port of discharge"}, marked on the timeline.
        </p>
      )}
    </div>
  );
}
