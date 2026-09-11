import { useState, type FormEvent, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import trackHeroBg from "../assets/track-hero-plane.png";
import TrackingMap from "../components/TrackingMap";
import { trackShipment } from "../lib/db";
import { formatDate, formatDateTime, portCode } from "../lib/format";
import type { TrackedShipment } from "../lib/types";

/**
 * Public, unauthenticated "track by shipment number" page — no portal login.
 * Meant to replace the generic ShipsGo embed widget that currently lives at
 * expac.co.za/live-tracking (that widget searches ShipsGo's own database by
 * container/BL/booking/AWB number — it has never heard of our shipment
 * numbers like SEA170869, so a customer searching one there always comes
 * back empty). This page looks up our own job_tracking data instead, via
 * the track_shipment() RPC (security definer, granted to anon — see
 * migration 0064).
 */
export default function PublicTrackPage() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "found" | "notfound" | "error">(
    "idle",
  );
  const [result, setResult] = useState<TrackedShipment | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ref = input.trim();
    if (!ref) return;
    setState("loading");
    try {
      const r = await trackShipment(ref);
      setResult(r);
      setState(r ? "found" : "notfound");
    } catch {
      setResult(null);
      setState("error");
    }
  }

  const contentStyle = {
    "--track-content-bg": `url(${trackHeroBg})`,
  } as CSSProperties;

  return (
    <div className="track-page">
      <header className="track-hero">
        <div className="track-hero-inner">
          <div className="brand">
            <div className="brand-mark">E</div>
            <div>
              <div className="brand-name">ExPac</div>
              <div className="brand-sub" style={{ color: "#9aa39a" }}>
                FORWARDING
              </div>
            </div>
          </div>
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
              placeholder="e.g. SEA170869"
              autoFocus
            />
            <button className="btn" type="submit" disabled={state === "loading"}>
              {state === "loading" ? "Searching…" : "Track"}
            </button>
          </form>
        </div>
      </header>

      <div className="track-content" style={contentStyle}>
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
              <p className="hint">Something went wrong — please try again shortly.</p>
            </div>
          )}

          {state === "found" && result && (
            <div className="panel">
              <div className="track-fields">
                <Field label="Shipment Number" value={result.reference} />
                <Field label="Reference" value={result.customer_ref || "—"} />
                <Field label="Shipper Name" value={result.shipper || "—"} />
                <Field label="Mode" value={result.mode} />
                <Field label="Status" value={result.status || "—"} />
                <Field label="Carrier" value={result.carrier || "—"} />
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

              <TrackingMap
                height={420}
                pol={
                  result.pol_lat != null
                    ? { lat: result.pol_lat, lon: result.pol_lon, label: result.pol }
                    : null
                }
                pod={
                  result.pod_lat != null
                    ? { lat: result.pod_lat, lon: result.pod_lon, label: result.pod }
                    : null
                }
                vessel={
                  result.vessel_lat != null
                    ? {
                        lat: result.vessel_lat,
                        lon: result.vessel_lon,
                        label: result.vessel_name,
                        at: result.position_at,
                      }
                    : null
                }
                events={result.events.map((e) => ({
                  lat: e.lat,
                  lon: e.lon,
                  description: e.description,
                  occurred_at: e.occurred_at,
                  is_actual: e.is_actual,
                }))}
              />

              {result.events.length > 0 && (
                <ol className="trk-timeline" style={{ marginTop: 16 }}>
                  {result.events
                    .slice()
                    .reverse()
                    .map((e, i) => (
                      <li key={i} className={e.is_actual ? "done" : ""}>
                        <span className="trk-when">{formatDateTime(e.occurred_at)}</span>
                        <span className="trk-where">
                          {e.description || e.location || "—"}
                          {e.vessel_name && (
                            <span className="muted small"> · {e.vessel_name}</span>
                          )}
                        </span>
                        <span className="trk-tick">{e.is_actual ? "✓" : "•"}</span>
                      </li>
                    ))}
                </ol>
              )}
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
