import { useMemo, useRef, useState } from "react";
import { useShipmentDocuments } from "../lib/hooks";
import { DOCUMENT_TYPES_LIST } from "../lib/docTemplates";
import type { ShipmentAttachmentPick } from "../lib/shipmentAttachments";

/** "📎 Attach document" for Shipment and Quotation Comms: a shipment's
 *  generated documents (sent as PDF) and Document Vault uploads, the
 *  quotation, and files picked from the computer (e.g. a shipper's
 *  invoice). Controlled -- the panel owns `picks` and sends them. */
export default function AttachDocumentPicker({
  job,
  quote,
  picks,
  onChange,
}: {
  /** The shipment whose documents can be attached (none on an unbooked quote). */
  job: { id: string; reference: string } | null;
  /** Offer the quotation PDF (left out where the panel has its own toggle). */
  quote: { id: string; reference: string } | null;
  picks: ShipmentAttachmentPick[];
  onChange: (p: ShipmentAttachmentPick[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const docsQ = useShipmentDocuments(job?.id);

  const options = useMemo(() => {
    const generated: ShipmentAttachmentPick[] = job
      ? DOCUMENT_TYPES_LIST.map((d) => ({
          key: `gen:${d.slug}`,
          label: d.title,
          kind: "generated",
          slug: d.slug,
          title: d.title,
          jobId: job.id,
          reference: job.reference,
        }))
      : [];
    const files: ShipmentAttachmentPick[] = (job ? docsQ.data ?? [] : []).map((d) => ({
      key: `file:${d.id}`,
      label: d.name,
      kind: "file",
      doc: d,
    }));
    const quoteOpt: ShipmentAttachmentPick[] = quote
      ? [
          {
            key: "quote",
            label: "Quotation",
            kind: "quote",
            quoteId: quote.id,
            reference: quote.reference,
          },
        ]
      : [];
    return { generated, files, quoteOpt };
  }, [job, quote, docsQ.data]);

  const picked = (key: string) => picks.some((p) => p.key === key);
  const toggle = (o: ShipmentAttachmentPick) =>
    onChange(picked(o.key) ? picks.filter((p) => p.key !== o.key) : [...picks, o]);

  function addLocal(list: FileList | null) {
    if (!list?.length) return;
    const added: ShipmentAttachmentPick[] = Array.from(list).map((file) => ({
      key: `local:${file.name}:${file.size}:${file.lastModified}`,
      label: file.name,
      kind: "local",
      file,
    }));
    onChange([...picks, ...added.filter((a) => !picked(a.key))]);
    if (fileRef.current) fileRef.current.value = "";
  }

  const row = (o: ShipmentAttachmentPick, extra?: string | null) => (
    <label key={o.key} className="check">
      <input type="checkbox" checked={picked(o.key)} onChange={() => toggle(o)} />
      {o.label}
      {extra && <span className="hint"> · {extra}</span>}
    </label>
  );

  return (
    <div className="comms-attach">
      <button
        type="button"
        className={`chip${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        📎 Attach document{picks.length ? ` (${picks.length})` : ""}
      </button>
      {picks.length > 0 && (
        <div className="comms-attach-chips">
          {picks.map((p) => (
            <span key={p.key} className="cov-chip">
              {p.label}
              <button type="button" aria-label={`Remove ${p.label}`} onClick={() => toggle(p)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="comms-attach-list">
          {(options.generated.length > 0 || options.quoteOpt.length > 0) && (
            <div className="hint">Documents (sent as PDF)</div>
          )}
          {options.generated.map((o) => row(o))}
          {options.quoteOpt.map((o) => row(o))}
          {job && (
            <>
              <div className="hint" style={{ marginTop: 8 }}>
                Uploaded to shipment {job.reference}
              </div>
              {docsQ.isLoading ? (
                <span className="hint">Loading…</span>
              ) : options.files.length === 0 ? (
                <span className="hint">No files uploaded to this shipment yet.</span>
              ) : (
                options.files.map((o) => row(o, o.kind === "file" ? o.doc.doc_type : null))
              )}
            </>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            From your computer
          </div>
          <div>
            <button
              type="button"
              className="btn outline btn-sm"
              onClick={() => fileRef.current?.click()}
            >
              Upload from computer…
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => addLocal(e.target.files)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
