/**
 * One customs file (0230): documents checklist, clearing agent, handover
 * (clearing instruction email with the documents attached), quick
 * milestones and the file's history.
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import QuickMailModal from "../../components/QuickMailModal";
import { useToast } from "../../components/Toast";
import {
  useAddCustomsEvent,
  useClearingAgents,
  useCustomsEvents,
  useProfiles,
  useShipmentDocuments,
  useUpdateCustomsFile,
  useUpdateJob,
  useUploadShipmentDocument,
} from "../../lib/hooks";
import { getShipmentDocumentUrl } from "../../lib/db";
import { CUSTOMS_STAGES, WITH_AGENT, checklist, daysBetween, fmtDays, requiredDocType, stageLabel } from "../../lib/customs";
import { formatDate, formatDateTime } from "../../lib/format";
import type { ShipmentAttachmentPick } from "../../lib/shipmentAttachments";
import { DOCUMENT_TYPES, type CustomsFile, type CustomsStage, type ShipmentDocument } from "../../lib/types";
import { CustomsStagePill, anfWaiting } from "./CustomsPage";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function CustomsFileModal({ file, onClose }: { file: CustomsFile; onClose: () => void }) {
  const job = file.job;
  const ownDocsQ = useShipmentDocuments(file.job_id);
  const masterDocsQ = useShipmentDocuments(job?.master_job_id ?? undefined);
  const docs = useMemo(() => [...(ownDocsQ.data ?? []), ...(masterDocsQ.data ?? [])], [ownDocsQ.data, masterDocsQ.data]);
  const list = checklist(file, docs);
  const missing = list.filter((i) => i.docs.length === 0);
  const agentsQ = useClearingAgents();
  const eventsQ = useCustomsEvents(file.id);
  const profilesQ = useProfiles();
  const update = useUpdateCustomsFile();
  const addEvent = useAddCustomsEvent();
  const updateJob = useUpdateJob();
  const upload = useUploadShipmentDocument();
  const { toast, error } = useToast();
  const [handover, setHandover] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<null | "query" | "cleared" | "lodged">(null);
  const [entryNo, setEntryNo] = useState(file.entry_no ?? "");
  const [queryNote, setQueryNote] = useState("");
  const [alsoRelease, setAlsoRelease] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string>("");
  const closed = !!file.closed_at;

  async function save(patch: Parameters<typeof update.mutateAsync>[0]["patch"], done?: string) {
    try {
      await update.mutateAsync({ id: file.id, patch });
      if (done) toast(done);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function openDoc(d: ShipmentDocument) {
    try {
      window.open(await getShipmentDocumentUrl(d.storage_path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the document");
    }
  }

  function pickUpload(docType: string) {
    setUploadType(docType);
    fileInput.current?.click();
  }
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const f of Array.from(files)) await upload.mutateAsync({ jobId: file.job_id, file: f, docType: uploadType });
      toast(files.length === 1 ? "Document added" : `${files.length} documents added`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not upload");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function setStage(stage: CustomsStage, patch: Parameters<typeof update.mutateAsync>[0]["patch"] = {}) {
    await save({ ...patch, stage }, stageLabel(stage));
  }

  async function confirmAsk() {
    if (asking === "lodged") await setStage("lodged", { entry_no: entryNo.trim() || null });
    if (asking === "query") {
      if (!queryNote.trim()) return error("Say what the query is about");
      await setStage("query", { query_note: queryNote.trim() });
      await addEvent.mutateAsync({ fileId: file.id, kind: "note", note: `Query: ${queryNote.trim()}` });
    }
    if (asking === "cleared") {
      await setStage("cleared", { entry_no: entryNo.trim() || file.entry_no });
      if (alsoRelease && job) {
        try {
          await updateJob.mutateAsync({ id: job.id, patch: { shipment_status: "Released" } });
        } catch (e) {
          error(e instanceof Error ? e.message : "Cleared, but the shipment status could not be changed");
        }
      }
    }
    setAsking(null);
    setQueryNote("");
  }

  const agents = agentsQ.data ?? [];
  const agent = agents.find((a) => a.id === file.clearing_agent_id) ?? file.agent ?? null;
  const people = new Map((profilesQ.data ?? []).map((p) => [p.id, p.full_name || "Someone"]));

  // Handover email: the shipment details and the documents, attached.
  const attachDocs = list.flatMap((i) => i.docs);
  const initialFiles: ShipmentAttachmentPick[] = attachDocs.map((d) => ({ key: `file-${d.id}`, label: d.name, kind: "file", doc: d }));
  const subject = `Customs clearing instruction – ${job?.reference ?? ""}${job?.client?.company ? ` – ${job.client.company}` : ""}`;
  const row = (k: string, v: string | null | undefined) =>
    v ? `<tr><td style="padding:3px 12px 3px 0;color:#666">${esc(k)}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>` : "";
  const body =
    `<p>Good day${agent?.contact ? ` ${esc(agent.contact.split(" ")[0])}` : ""},</p>` +
    `<p>Please clear the shipment below on our behalf. The documents are attached.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    row("Our reference", job?.reference) +
    row("Importer", job?.client?.company) +
    row("Mode", job?.mode) +
    row(job?.mode?.startsWith("Air") ? "AWB" : "B/L", job?.awb_mbl) +
    row("Container", job?.container_no) +
    row(job?.mode?.startsWith("Air") ? "Airline" : "Vessel", job?.mode?.startsWith("Air") ? job?.carrier_name : job?.vessel_name) +
    row("Origin", job?.origin) +
    row("Destination", job?.destination) +
    row("ETA", job?.eta ? formatDate(job.eta) : null) +
    row("Customer PO", job?.po_no) +
    `</table>` +
    `<p>Documents attached:</p><ul>${list.map((i) => `<li>${esc(i.label)}${i.docs.length ? "" : " – <i>to follow</i>"}</li>`).join("")}</ul>` +
    `<p>Please confirm receipt, and send us the entry number once lodged and the release note once cleared, quoting our reference ${esc(job?.reference)}.</p>` +
    `<p>Thank you</p>`;

  const stageAt: Partial<Record<CustomsStage, string | null>> = {
    handed_over: file.handed_over_at,
    lodged: file.lodged_at,
    query: file.query_at,
    cleared: file.cleared_at,
  };
  const order = CUSTOMS_STAGES.map((s) => s.key);
  const at = order.indexOf(file.stage);
  const withAgent = daysBetween(file.handed_over_at, file.cleared_at);

  return (
    <Modal
      title={`Customs – ${job?.reference ?? ""}`}
      onClose={onClose}
      wide
      headerActions={job ? <Link className="btn ghost small" to={`/jobs/${job.id}`}>Open shipment</Link> : undefined}
    >
      <div className="customs-file">
        <div className="customs-file-head">
          <div>
            <strong>{job?.client?.company ?? "—"}</strong>
            <div className="hint">
              {[job?.mode, job?.awb_mbl, job?.container_no, job?.eta ? `ETA ${formatDate(job.eta)}` : null, job?.shipment_status]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <CustomsStagePill stage={file.stage} />
        </div>
        {closed && <p className="customs-note">This file is closed ({file.stage === "cleared" ? "cleared" : "shipment completed"}).</p>}

        <ol className="customs-steps">
          {CUSTOMS_STAGES.map((s, i) => (
            <li key={s.key} className={i < at ? "done" : i === at ? "now" : ""}>
              <span className="customs-step-dot">{i < at ? "✓" : i + 1}</span>
              <span>
                {s.short}
                {stageAt[s.key] && <span className="hint"> {formatDateTime(stageAt[s.key])}</span>}
              </span>
            </li>
          ))}
        </ol>

        <div className="customs-file-grid">
          <section>
            <h4>Documents</h4>
            <ul className="customs-check">
              {list.map((i) => (
                <li key={i.key} className={i.docs.length ? "ok" : "missing"}>
                  <span className="customs-check-mark">{i.docs.length ? "✓" : "✗"}</span>
                  <span className="customs-check-label">
                    {i.label}
                    {i.docs.map((d) => (
                      <button key={d.id} type="button" className="link-btn customs-doc" onClick={() => void openDoc(d)}>
                        {d.name}
                      </button>
                    ))}
                  </span>
                  {!i.docs.length && !closed && (
                    <button type="button" className="btn ghost small" onClick={() => pickUpload(requiredDocType(i.key, job?.mode))} disabled={upload.isPending}>
                      Upload
                    </button>
                  )}
                  {!["ci", "pl", "tdoc"].includes(i.key) && !closed && (
                    <button
                      type="button"
                      className="btn ghost small"
                      title="Not required on this file"
                      onClick={() => void save({ required_docs: file.required_docs.filter((k) => k !== i.key) })}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!closed && (
              <div className="customs-row-tools">
                <select
                  value=""
                  onChange={(e) => e.target.value && void save({ required_docs: [...file.required_docs, e.target.value] })}
                  aria-label="Add a required document"
                >
                  <option value="">+ Require another document…</option>
                  {DOCUMENT_TYPES.filter((t) => !["Invoice", "Commercial Invoice", "Packing List", "HAWB", "HBL", "Bill of Lading / AWB", "Proof of Delivery", "Other"].includes(t))
                    .filter((t) => !file.required_docs.includes(t))
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
                <button type="button" className="btn ghost small" onClick={() => pickUpload("Customs Release Note")} disabled={upload.isPending}>
                  Upload release note
                </button>
              </div>
            )}
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
            {docs.filter((d) => !list.some((i) => i.docs.includes(d))).length > 0 && (
              <>
                <h5>Other documents on the shipment</h5>
                <ul className="customs-other-docs">
                  {docs
                    .filter((d) => !list.some((i) => i.docs.includes(d)))
                    .map((d) => (
                      <li key={d.id}>
                        <button type="button" className="link-btn" onClick={() => void openDoc(d)}>
                          {d.name}
                        </button>{" "}
                        <span className="hint">{d.doc_type || "No type"}</span>
                      </li>
                    ))}
                </ul>
              </>
            )}
            <p className="hint">Documents live in the shipment's Document Vault; give each one its type so it ticks off here.</p>
          </section>

          <section>
            <h4>Clearing agent</h4>
            <select
              value={file.clearing_agent_id ?? ""}
              disabled={closed}
              onChange={(e) => void save({ clearing_agent_id: e.target.value || null }, "Clearing agent saved")}
            >
              <option value="">Not assigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company}
                </option>
              ))}
            </select>
            {agent && (
              <p className="hint">
                {[agent.contact, agent.email, agent.phone].filter(Boolean).join(" · ") || "No contact details on the agent yet"}
              </p>
            )}

            <h4>Carrier arrival notification (ANF)</h4>
            {file.anf_at ? (
              <div className={`customs-anf-box${anfWaiting(file) ? " waiting" : ""}`}>
                <strong>ANF received {formatDateTime(file.anf_at)}</strong>
                {file.anf_source && <div className="hint">{file.anf_source}</div>}
                {anfWaiting(file) && <div>Not handed over to the agent yet.</div>}
                {!closed && (
                  <button type="button" className="link-btn" onClick={() => void save({ anf_at: null }, "ANF removed")}>
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="customs-actions">
                <span className="hint">Not received yet.</span>
                {!closed && (
                  <>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void save({ anf_at: new Date().toISOString(), anf_source: "Marked by hand" }, "ANF marked as received")}
                    >
                      Mark ANF received
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => pickUpload("Arrival Notification (ANF)")} disabled={upload.isPending}>
                      Upload ANF
                    </button>
                  </>
                )}
              </div>
            )}
            <p className="hint">Arrival notice emails linked to this shipment in the Inbox mark it by themselves.</p>

            <h4>Customs</h4>
            <label className="customs-field">
              Entry no. (MRN)
              <input
                value={entryNo}
                disabled={closed}
                onChange={(e) => setEntryNo(e.target.value)}
                onBlur={() => entryNo.trim() !== (file.entry_no ?? "") && void save({ entry_no: entryNo.trim() || null }, "Entry number saved")}
              />
            </label>
            {file.stage === "query" && file.query_note && <p className="customs-note">Query: {file.query_note}</p>}
            {file.handed_over_at && (
              <p className="hint">
                Handed over {formatDateTime(file.handed_over_at)}
                {file.handover_to ? ` to ${file.handover_to}` : ""} · with the agent {fmtDays(withAgent)}
              </p>
            )}

            {!closed && (
              <div className="customs-actions">
                {(file.stage === "docs_pending" || file.stage === "ready") && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!agent?.email) return error("Assign a clearing agent with an email address first");
                      if (missing.length && !window.confirm(`Still missing: ${missing.map((m) => m.label).join(", ")}. Hand over anyway?`)) return;
                      setHandover(true);
                    }}
                  >
                    Hand over to agent
                  </button>
                )}
                {WITH_AGENT.includes(file.stage) && file.stage !== "lodged" && (
                  <button type="button" className="btn outline" onClick={() => setAsking("lodged")}>
                    Entry lodged
                  </button>
                )}
                {WITH_AGENT.includes(file.stage) && (
                  <button type="button" className="btn outline" onClick={() => setAsking("query")}>
                    Query raised
                  </button>
                )}
                {file.stage !== "cleared" && (
                  <button type="button" className="btn outline" onClick={() => setAsking("cleared")}>
                    Customs cleared
                  </button>
                )}
                {WITH_AGENT.includes(file.stage) && (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => window.confirm("Take this file back from the agent (back to documents)?") && void setStage("ready")}
                  >
                    Undo handover
                  </button>
                )}
              </div>
            )}
            {file.stage === "cleared" && !closed && (
              <button type="button" className="btn ghost small" onClick={() => void setStage("lodged")}>
                Not cleared after all
              </button>
            )}

            {asking && (
              <div className="customs-ask">
                {asking === "query" ? (
                  <label className="customs-field">
                    What is the query?
                    <textarea rows={2} value={queryNote} onChange={(e) => setQueryNote(e.target.value)} autoFocus />
                  </label>
                ) : (
                  <label className="customs-field">
                    Entry no. (MRN){asking === "cleared" ? ", if you have it" : ""}
                    <input value={entryNo} onChange={(e) => setEntryNo(e.target.value)} autoFocus />
                  </label>
                )}
                {asking === "cleared" && (
                  <label className="customs-check-line">
                    <input type="checkbox" checked={alsoRelease} onChange={(e) => setAlsoRelease(e.target.checked)} /> Also set the shipment
                    to Released
                  </label>
                )}
                <div className="customs-actions">
                  <button type="button" className="btn" onClick={() => void confirmAsk()} disabled={update.isPending}>
                    {asking === "lodged" ? "Mark entry lodged" : asking === "query" ? "Mark query raised" : "Mark customs cleared"}
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <h4>Notes and history</h4>
            <div className="customs-note-add">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (call with the agent, ETA change…)" />
              <button
                type="button"
                className="btn ghost small"
                disabled={!note.trim() || addEvent.isPending}
                onClick={async () => {
                  await addEvent.mutateAsync({ fileId: file.id, kind: "note", note: note.trim() });
                  setNote("");
                }}
              >
                Add
              </button>
            </div>
            <ul className="customs-history">
              {(eventsQ.data ?? []).map((e) => (
                <li key={e.id}>
                  <span className="hint">{formatDateTime(e.at)}</span>{" "}
                  <span>
                    {e.kind === "stage" && e.stage ? stageLabel(e.stage) : e.kind === "opened" ? "File opened" : e.kind === "closed" ? "File closed" : e.kind === "reopened" ? "File reopened" : e.kind === "agent" ? "Clearing agent" : e.kind === "handover" ? "Handed over" : e.kind === "anf" ? "ANF" : "Note"}
                    {e.note && e.kind !== "stage" ? `: ${e.note}` : ""}
                  </span>{" "}
                  {e.by && <span className="hint">– {people.get(e.by) ?? "Someone"}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {handover && agent?.email && (
        <QuickMailModal
          to={agent.email}
          company={agent.company}
          name={agent.contact}
          job={job ? { id: job.id, reference: job.reference } : null}
          initialSubject={subject}
          initialBody={body}
          initialFiles={initialFiles}
          onClose={() => setHandover(false)}
          onSent={async (info) => {
            await save({ stage: "handed_over", handover_to: info.to });
            await addEvent.mutateAsync({ fileId: file.id, kind: "handover", note: `Clearing instruction sent to ${info.to}` });
            toast("Handed over to the clearing agent");
          }}
        />
      )}
    </Modal>
  );
}
