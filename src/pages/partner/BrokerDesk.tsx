/**
 * Broker Desk (Customs Phase 2, 0232): the clearing agent's side of the
 * customs files ExPac handed over to them. They see the shipment details,
 * open or download the documents (one by one or all as a ZIP), download the
 * data as CSV, mark Entry lodged / Query raised / Customs cleared, upload
 * the release note and other customs documents, and leave notes. ExPac sees
 * every step (Control Tower tasks and the file's history).
 */
import { useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useBrokerFiles, useBrokerUpdate, useBrokerUpload } from "../../lib/hooks";
import { downloadShipmentDocument, getShipmentDocumentUrl } from "../../lib/db";
import { CUSTOMS_STAGES, daysBetween, fmtDays, stageLabel, stageShort, type BrokerDocument, type BrokerFile } from "../../lib/customs";
import { formatDate, formatDateTime } from "../../lib/format";
import { makeZip, saveBlob, toCsv } from "../../lib/zip";
import CustomsDataPanel from "../customs/CustomsDataPanel";

const UPLOAD_TYPES = ["Customs Release Note", "Customs Entry", "Duty / VAT Invoice", "Customs", "Other"];

export default function BrokerDesk() {
  const q = useBrokerFiles();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const files = useMemo(() => q.data ?? [], [q.data]);
  const active = files.filter((f) => !f.closed_at && f.stage !== "cleared");
  const done = files.filter((f) => f.closed_at || f.stage === "cleared");
  const rows = showDone ? done : active;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const open = files.find((f) => f.id === openId) ?? null;
  return (
    <>
      <div className="customs-views">
        <button type="button" className={`customs-view${!showDone ? " on" : ""}`} onClick={() => setShowDone(false)}>
          To clear <span className="customs-view-n">{active.length}</span>
        </button>
        <button type="button" className={`customs-view${showDone ? " on" : ""}`} onClick={() => setShowDone(true)}>
          Cleared (last 30 days) <span className="customs-view-n">{done.length}</span>
        </button>
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <EmptyState>{showDone ? "Nothing cleared in the last 30 days." : "No customs files waiting for you. ExPac's instructions appear here."}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="customs-table">
              <thead>
                <tr>
                  <th>ExPac ref</th>
                  <th>Importer</th>
                  <th>AWB / B/L</th>
                  <th>ETA</th>
                  <th>Instructed</th>
                  <th>Entry no.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="customs-row" onClick={() => setOpenId(f.id)}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => setOpenId(f.id)}>
                        {f.reference}
                      </button>
                      <div className="hint">{f.mode?.replace(/ \(.*\)/, "")}</div>
                    </td>
                    <td>{f.importer.company ?? "—"}</td>
                    <td>
                      {f.awb_mbl || "—"}
                      {f.container_no && <div className="hint">{f.container_no}</div>}
                    </td>
                    <td>{f.eta ? formatDate(f.eta) : "—"}</td>
                    <td>
                      {f.handed_over_at ? formatDate(f.handed_over_at) : "—"}
                      <div className="hint">{fmtDays(daysBetween(f.handed_over_at, f.cleared_at))} ago</div>
                    </td>
                    <td>{f.entry_no || "—"}</td>
                    <td>
                      <span className={`customs-stage is-${f.stage}`}>{f.stage === "handed_over" ? "New" : stageShort(f.stage)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <BrokerFileModal file={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function BrokerFileModal({ file, onClose }: { file: BrokerFile; onClose: () => void }) {
  const update = useBrokerUpdate();
  const upload = useBrokerUpload();
  const { toast, error } = useToast();
  const [asking, setAsking] = useState<null | "lodged" | "query" | "cleared">(null);
  const [entryNo, setEntryNo] = useState(file.entry_no ?? "");
  const [note, setNote] = useState("");
  const [zipping, setZipping] = useState(false);
  const [docType, setDocType] = useState(UPLOAD_TYPES[0]);
  const fileInput = useRef<HTMLInputElement>(null);
  const closed = !!file.closed_at || file.stage === "cleared";
  const air = file.mode?.startsWith("Air");

  async function openDoc(d: BrokerDocument) {
    try {
      window.open(await getShipmentDocumentUrl(d.storage_path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the document");
    }
  }
  async function downloadAll() {
    setZipping(true);
    try {
      const parts = [];
      for (const d of file.documents) parts.push({ name: d.name, data: await downloadShipmentDocument(d.storage_path) });
      if (file.extraction) {
        const { extractionCsvRows } = await import("../../lib/customs");
        parts.push({ name: `${file.reference} customs data.csv`, data: new TextEncoder().encode(toCsv(extractionCsvRows(file.reference, file.extraction))) });
      }
      saveBlob(makeZip(parts), `${file.reference} documents.zip`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not download the documents");
    } finally {
      setZipping(false);
    }
  }
  function downloadShipmentCsv() {
    const rows = [
      ["ExPac reference", file.reference],
      ["Mode", file.mode],
      [air ? "AWB" : "B/L", file.awb_mbl],
      ["Container", file.container_no],
      [air ? "Airline" : "Vessel", air ? file.carrier_name : file.vessel_name],
      ["Origin", file.origin],
      ["Destination", file.destination],
      ["ETD", file.etd],
      ["ETA", file.eta],
      ["Customer PO", file.po_no],
      ["Importer", file.importer.company],
      ["Importer VAT no.", file.importer.vat_no],
      ["Importer customs code", file.importer.import_code],
      ["Importer address", file.importer.address],
    ];
    saveBlob(new Blob([toCsv(rows)], { type: "text/csv" }), `${file.reference} shipment.csv`);
  }
  async function confirm() {
    try {
      if (asking === "query" && !note.trim()) return error("Say what the query is about");
      await update.mutateAsync({ fileId: file.id, stage: asking, entryNo: entryNo.trim() || null, note: note.trim() || null });
      toast(asking === "lodged" ? "Entry lodged, ExPac notified" : asking === "query" ? "Query sent to ExPac" : "Customs cleared, ExPac notified");
      setAsking(null);
      setNote("");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }
  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    try {
      for (const f of Array.from(list)) await upload.mutateAsync({ fileId: file.id, file: f, docType });
      toast(list.length === 1 ? "Uploaded, ExPac notified" : `${list.length} files uploaded`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not upload");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const at = CUSTOMS_STAGES.findIndex((s) => s.key === file.stage);
  const detail = (k: string, v: string | null | undefined) =>
    v ? (
      <div>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ) : null;

  return (
    <Modal title={`Customs file – ${file.reference}`} onClose={onClose} wide>
      <div className="customs-file">
        <ol className="customs-steps broker">
          {CUSTOMS_STAGES.slice(2).map((s, i) => (
            <li key={s.key} className={i + 2 < at ? "done" : i + 2 === at ? "now" : ""}>
              <span className="customs-step-dot">{i + 2 < at ? "✓" : i + 1}</span>
              <span>{s.key === "handed_over" ? "Instructed" : s.short}</span>
            </li>
          ))}
        </ol>
        {file.stage === "query" && file.query_note && <p className="customs-note">Open query: {file.query_note}</p>}

        <div className="customs-file-grid">
          <section>
            <h4>Shipment</h4>
            <dl className="customs-data-facts">
              {detail("ExPac reference", file.reference)}
              {detail("Mode", file.mode)}
              {detail(air ? "AWB" : "B/L", file.awb_mbl)}
              {detail("Container", file.container_no)}
              {detail(air ? "Airline" : "Vessel", air ? file.carrier_name : file.vessel_name)}
              {detail("Origin", file.origin)}
              {detail("Destination", file.destination)}
              {detail("ETA", file.eta ? formatDate(file.eta) : null)}
              {detail("Customer PO", file.po_no)}
              {detail("Carrier ANF", file.anf_at ? formatDate(file.anf_at) : null)}
            </dl>
            <h4>Importer</h4>
            <dl className="customs-data-facts">
              {detail("Company", file.importer.company)}
              {detail("VAT no.", file.importer.vat_no)}
              {detail("Customs code", file.importer.import_code)}
              {detail("Address", file.importer.address)}
              {detail("Contact", [file.importer.contact, file.importer.phone, file.importer.email].filter(Boolean).join(" · "))}
            </dl>
            <div className="customs-actions">
              <button type="button" className="btn ghost small" onClick={downloadShipmentCsv}>
                Shipment CSV
              </button>
            </div>
          </section>

          <section>
            <h4>Documents</h4>
            <ul className="customs-other-docs broker-docs">
              {file.documents.map((d) => (
                <li key={d.id}>
                  <button type="button" className="link-btn" onClick={() => void openDoc(d)}>
                    {d.name}
                  </button>{" "}
                  <span className="hint">
                    {d.doc_type || "Document"}
                    {d.from_broker ? " · from you" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="customs-actions">
              <button type="button" className="btn small outline" onClick={() => void downloadAll()} disabled={zipping || !file.documents.length}>
                {zipping ? "Preparing…" : "Download all (ZIP)"}
              </button>
            </div>
            {!file.closed_at && (
              <div className="customs-row-tools">
                <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
                  {UPLOAD_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <button type="button" className="btn small" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                  {upload.isPending ? "Uploading…" : "Upload"}
                </button>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
              </div>
            )}

            {!closed && (
              <>
                <h4>Update ExPac</h4>
                <div className="customs-actions">
                  {file.stage !== "lodged" && (
                    <button type="button" className="btn outline" onClick={() => setAsking("lodged")}>
                      Entry lodged
                    </button>
                  )}
                  <button type="button" className="btn outline" onClick={() => setAsking("query")}>
                    Raise a query
                  </button>
                  <button type="button" className="btn" onClick={() => setAsking("cleared")}>
                    Customs cleared
                  </button>
                </div>
                {asking && (
                  <div className="customs-ask">
                    {asking !== "query" && (
                      <label className="customs-field">
                        Entry no. (MRN)
                        <input value={entryNo} onChange={(e) => setEntryNo(e.target.value)} autoFocus />
                      </label>
                    )}
                    <label className="customs-field">
                      {asking === "query" ? "What do you need from ExPac?" : "Note for ExPac (optional)"}
                      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus={asking === "query"} />
                    </label>
                    {asking === "cleared" && (
                      <p className="hint">Upload the release note above too, so ExPac can send it to the transporter.</p>
                    )}
                    <div className="customs-actions">
                      <button type="button" className="btn" onClick={() => void confirm()} disabled={update.isPending}>
                        {asking === "lodged" ? "Mark entry lodged" : asking === "query" ? "Send query" : "Mark customs cleared"}
                      </button>
                      <button type="button" className="btn ghost small" onClick={() => setAsking(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!asking && (
                  <div className="customs-note-add">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Send ExPac a note…" />
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={!note.trim() || update.isPending}
                      onClick={async () => {
                        try {
                          await update.mutateAsync({ fileId: file.id, note: note.trim() });
                          setNote("");
                          toast("Note sent to ExPac");
                        } catch (e) {
                          error(e instanceof Error ? e.message : "Could not send");
                        }
                      }}
                    >
                      Send
                    </button>
                  </div>
                )}
              </>
            )}

            <h4>History</h4>
            <ul className="customs-history">
              {file.events.map((e, i) => (
                <li key={i}>
                  <span className="hint">{formatDateTime(e.at)}</span>{" "}
                  {e.kind === "stage" && e.stage ? (e.stage === "handed_over" ? "Instructed by ExPac" : stageLabel(e.stage)) : e.note}
                  {e.mine ? <span className="hint"> – you</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {file.extraction && (
          <section className="customs-wide">
            <h4>Invoice data from ExPac</h4>
            <CustomsDataPanel reference={file.reference} value={file.extraction} />
          </section>
        )}
      </div>
    </Modal>
  );
}
