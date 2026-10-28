import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import TrackingMap from "../components/TrackingMap";
import TrackMovements from "../components/TrackMovements";
import TimelineProgress from "../components/TimelineProgress";
import { stepLabel } from "../lib/timeline";
import { buildRoute, routeEventsFromRows } from "../lib/trackRoute";
import { trackShipment } from "../lib/db";
import { carrierLabel } from "../lib/docTemplates";
import { formatDate, portCode } from "../lib/format";
import type { TrackedShipment } from "../lib/types";

/**
 * Public, unauthenticated "track by shipment number" page, no portal login.
 * Meant to replace the generic ShipsGo embed widget that currently lives at
 * expac.co.za/live-tracking (that widget searches ShipsGo's own database by
 * container/BL/booking/AWB number, it has never heard of our shipment
 * numbers like SEA170869, so a customer searching one there always comes
 * back empty). This page looks up our own job_tracking data instead, via
 * the track_shipment() RPC (security definer, granted to anon, see
 * migration 0064).
 */
export default function PublicTrackPage() {
  const [searchParams] = useSearchParams();
  const initialRef = searchParams.get("ref") ?? "";
  // The email link's private key (0186), only for the number it came with.
  const linkKey = searchParams.get("k") ?? "";
  const [input, setInput] = useState(initialRef);
  const [state, setState] = useState<"idle" | "loading" | "found" | "notfound" | "error">(
    "idle",
  );
  const [result, setResult] = useState<TrackedShipment | null>(null);

  async function runTrack(ref: string) {
    if (!ref) return;
    setState("loading");
    try {
      const r = await trackShipment(ref, ref === initialRef ? linkKey : null);
      setResult(r);
      setState(r ? "found" : "notfound");
    } catch {
      setResult(null);
      setState("error");
    }
  }

  // Deep link from a shipment email's "Live Tracking" button, e.g. /track?ref=SEA170869.
  useEffect(() => {
    if (initialRef) runTrack(initialRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await runTrack(input.trim());
  }

  return (
    <div className="track-page">
      <header className="track-hero">
        <div className="track-hero-inner">
          <h1>Track Your Shipment</h1>
          <p className="sub">Enter your shipment number to see its current status.</p>
          <p className="sub track-portal-note">
            Should you require more information on your shipment, kindly log
            in to your <Link to="/portal">ExPac Motion Portal</Link>.
          </p>

          <form onSubmit={onSubmit} className="track-search">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. SEA170869, AIR482910 or CX330218"
              autoFocus
            />
            <button className="btn" type="submit" disabled={state === "loading"}>
              {state === "loading" ? "Searching…" : "Track"}
            </button>
          </form>
        </div>
      </header>

      <div className="track-content">
        <div className="track-content-inner">
          {state === "notfound" && (
            <div className="panel">
              <p className="hint">
                We couldn't find a shipment with that number. Double-check it
                and try again, or contact ExPac Forwarding for help.
              </p>
            </div>
          )}
          {state === "error" && (
            <div className="panel">
              <p className="hint">Something went wrong, please try again shortly.</p>
            </div>
          )}

          {state === "found" && result && (
            <div className="panel">
              <div className="track-fields">
                <Field label="Shipment Number" value={result.reference} />
                {/* Only with the private link key (0186), from the customer's email. */}
                {result.customer_ref && <Field label="Reference" value={result.customer_ref} />}
                {result.shipper && <Field label="Shipper Name" value={result.shipper} />}
                <Field label="Mode" value={result.mode} />
                <Field label="Status" value={result.status ? stepLabel(result.status, result.mode) : "—"} />
                <Field label={carrierLabel(result.mode)} value={result.carrier || "—"} />
                {result.vessel_name && (
                  <Field label="Vessel" value={result.vessel_name} />
                )}
                {result.voyage && <Field label="Voyage" value={result.voyage} />}
                <Field label="Origin" value={portCode(result.pol)} />
                <Field label="Destination" value={portCode(result.pod)} />
                <Field label="ETD" value={formatDate(result.etd)} />
                <Field label="ETA" value={formatDate(result.eta)} />
                <Field label="PDD" value={formatDate(result.pdd)} />
                <Field label="Qty" value={result.qty != null ? String(result.qty) : "—"} />
                <Field
                  label="C.W (Kgs)"
                  value={result.cw_kg != null ? `${result.cw_kg.toFixed(2)} kg` : "—"}
                />
                <Field
                  label="Ttl Vol"
                  value={result.ttl_vol != null ? `${result.ttl_vol.toFixed(3)} m³` : "—"}
                />
              </div>

              {(result.timeline ?? []).length > 0 && (
                <div className="track-timeline">
                  <h3>Shipment progress</h3>
                  <TimelineProgress
                    steps={result.timeline ?? []}
                    mode={result.mode}
                    delivered={(result.status ?? "") === "Delivered"}
                  />
                </div>
              )}

              <PublicRoute result={result} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="qd-label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

/** Map + movements, built once per result. */
function PublicRoute({ result }: { result: TrackedShipment }) {
  const route = buildRoute(
    routeEventsFromRows(result.events),
    { code: result.pol, lat: result.pol_lat, lon: result.pol_lon },
    { code: result.pod, lat: result.pod_lat, lon: result.pod_lon },
  );
  return (
    <>
      <TrackingMap height={520} route={route} mode={result.mode} path={result.route_path} />
      <TrackMovements route={route} />
    </>
  );
}
