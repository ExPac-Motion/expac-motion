import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/Toast";
import { deleteReceiptImage, uploadReceiptImages, useReceiptImages } from "../../lib/wms";

/** Photos of the goods on a warehouse receipt (0147). Staff upload / delete;
 *  the customer sees the same gallery on the receipt in the portal. */
export default function ReceiptImages({ receiptId, editable }: { receiptId: string; editable: boolean }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useReceiptImages(receiptId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const images = q.data ?? [];

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    try {
      await uploadReceiptImages(receiptId, files);
      toast(`${files.length} image${files.length === 1 ? "" : "s"} added`);
    } catch (er) {
      error(er instanceof Error ? er.message : "Could not upload");
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["wms", "images", receiptId] });
    }
  }

  return (
    <div className="rc-images">
      {editable && (
        <div className="rc-images-head">
          <button type="button" className="btn outline btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "+ Add images"}
          </button>
          <span className="hint">Photos of the goods as received, the customer sees them on the portal.</span>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        </div>
      )}
      {q.isLoading ? (
        <p className="hint">Loading images…</p>
      ) : images.length === 0 ? (
        <p className="hint">No images yet.</p>
      ) : (
        <div className="rc-images-grid">
          {images.map((img) => (
            <figure key={img.id}>
              <button type="button" onClick={() => setZoom(img.url)} title="View full size">
                <img src={img.url} alt={img.name ?? "Goods received"} loading="lazy" />
              </button>
              {editable && (
                <button
                  type="button"
                  className="rc-images-del"
                  title="Delete image"
                  onClick={async () => {
                    if (!confirm("Delete this image?")) return;
                    try {
                      await deleteReceiptImage(img);
                      qc.invalidateQueries({ queryKey: ["wms", "images", receiptId] });
                    } catch (er) {
                      error(er instanceof Error ? er.message : "Could not delete");
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      {zoom && (
        <div className="pt-lightbox" onClick={() => setZoom(null)} role="dialog" aria-label="Image">
          <img src={zoom} alt="Goods received" />
          <button type="button" className="pt-lightbox-x" aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
