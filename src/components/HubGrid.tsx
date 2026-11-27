import { useState } from "react";
import Modal from "./Modal";
import type { HubItem } from "../lib/hub";

/**
 * Information Hub cards (customer + partner portals): cover, tag, title,
 * description, View / Download. Images open full size in a lightbox.
 * Same look as the customer portal's Hub (.pt-hub).
 */
export default function HubGrid({ items }: { items: HubItem[] }) {
  const [zoom, setZoom] = useState<HubItem | null>(null);
  return (
    <>
      <div className="pt-hub">
        {items.map((r) => {
          const cover = r.cover_url || (r.kind === "image" ? r.file_url : null);
          const view =
            r.kind === "image"
              ? { onClick: (e: React.MouseEvent) => (e.preventDefault(), setZoom(r)) }
              : { target: "_blank", rel: "noreferrer" };
          return (
            <article key={r.id} className="pt-hub-card">
              <a href={r.file_url} className="pt-hub-cover" title={`View ${r.title}`} {...view}>
                {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="pt-hub-nocover">📄</span>}
              </a>
              <div className="pt-hub-body">
                <span className="pt-hub-tag">{r.tag}</span>
                <h3>{r.title}</h3>
                {r.description && <p>{r.description}</p>}
                <div className="pt-hub-foot">
                  <span className="hint">{r.meta}</span>
                  <span className="pt-hub-actions">
                    {r.kind !== "link" && (
                      <a className="btn outline btn-sm" href={r.file_url} download>
                        Download
                      </a>
                    )}
                    <a className="btn btn-sm" href={r.file_url} {...view}>
                      {r.kind === "link" ? "Open" : "View"}
                    </a>
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {zoom && (
        <Modal title={zoom.title} onClose={() => setZoom(null)} wide>
          <img
            src={zoom.file_url}
            alt={zoom.title}
            style={{ display: "block", maxWidth: "100%", maxHeight: "78vh", margin: "0 auto", borderRadius: 8 }}
          />
        </Modal>
      )}
    </>
  );
}
