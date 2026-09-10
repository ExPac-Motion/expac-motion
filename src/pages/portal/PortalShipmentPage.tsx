import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useMyDocuments,
  useMyJobs,
  useMyJobTracking,
  useMyMessages,
  useMyTrackingEvents,
  useSendMyMessage,
} from "../../lib/hooks";
import { getMyDocumentUrl } from "../../lib/db";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import TrackingMap from "../../components/TrackingMap";

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
  const docsQ = useMyDocuments(id);
  const messagesQ = useMyMessages(id);
  const sendMessage = useSendMyMessage();
  const [draft, setDraft] = useState("");

  async function onDownload(storagePath: string) {
    const tab = window.open("", "_blank", "noopener");
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

  return (
    <>
      <PageHeader
        eyebrow="My Shipments"
        title={job.reference}
        actions={
          <button className="btn outline" onClick={() => navigate("/portal")}>
            ← Back
          </button>
        }
      />

      <div className="panel">
        <div className="grid2">
          <Field label="Mode" value={job.mode} />
          <Field
            label="Status"
            value={tracking?.status || job.shipment_status || job.milestone}
          />
          <Field label="Shipper" value={job.supplier_company ?? "—"} />
          <Field
            label="Carrier"
            value={tracking?.carrier || job.carrier_name || "—"}
          />
          <Field
            label="Vessel"
            value={tracking?.vessel_name || job.vessel_name || "—"}
          />
          <Field label="Port of Load" value={portCode(job.origin)} />
          <Field label="Port of Discharge" value={portCode(job.destination)} />
          <Field
            label="ETD"
            value={formatDate(tracking?.etd || job.etd)}
          />
          <Field
            label="ETA"
            value={formatDate(
              tracking?.pod_ata || tracking?.pod_eta || tracking?.eta || job.eta,
            )}
          />
          <Field
            label="Provisional Delivery"
            value={formatDate(job.provisional_delivery_date)}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Live Tracking</h2>
          </div>
        </div>
        {!tracking ? (
          <EmptyState>
            Tracking will appear here once the shipment is on the water / in the
            air.
          </EmptyState>
        ) : (
          <>
            <TrackingMap
              height={300}
              pol={
                tracking.pol_lat != null
                  ? { lat: tracking.pol_lat, lon: tracking.pol_lon, label: tracking.pol }
                  : null
              }
              pod={
                tracking.pod_lat != null
                  ? { lat: tracking.pod_lat, lon: tracking.pod_lon, label: tracking.pod }
                  : null
              }
              vessel={
                tracking.vessel_lat != null
                  ? {
                      lat: tracking.vessel_lat,
                      lon: tracking.vessel_lon,
                      label: tracking.vessel_name,
                      at: tracking.position_at,
                    }
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
                      <span className="trk-when">
                        {formatDateTime(e.occurred_at)}
                      </span>
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
          </>
        )}
      </div>

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
          <div className="stack-sm">
            {(docsQ.data ?? []).map((d) => (
              <button
                key={d.id}
                className="btn ghost small"
                style={{ display: "block", textAlign: "left" }}
                onClick={() => onDownload(d.storage_path)}
              >
                {d.name}{" "}
                <span className="muted small">— {formatDate(d.created_at)}</span>
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
            {(messagesQ.data ?? []).map((m) => (
              <div
                key={m.id}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #f0efe8",
                }}
              >
                <div className="muted small">
                  {m.direction === "in" ? "You" : "ExPac"} ·{" "}
                  {formatDate(m.created_at)}
                </div>
                <div>{m.subject && <strong>{m.subject}</strong>}</div>
                <div style={{ whiteSpace: "pre-line" }}>{m.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
