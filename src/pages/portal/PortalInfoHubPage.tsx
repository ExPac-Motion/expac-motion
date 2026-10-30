import { PageHeader } from "../../components/common";

/** A guide or brochure on the Information Hub. Files live in public/hub
 *  (served as they are, no login needed to open the link). */
interface Resource {
  title: string;
  tag: string;
  description: string;
  file: string;
  cover: string;
  meta: string;
}

const RESOURCES: Resource[] = [
  {
    title: "Quote Request & Portal Manual",
    tag: "How-to guide",
    description:
      "Step by step: request a quotation, ask for a revision, accept it, add your shippers and follow every shipment, live.",
    file: "/hub/expac-motion-quote-request-manual.pdf",
    cover: "/hub/cover-quote-manual.jpg",
    meta: "PDF · 15 pages · 4 MB",
  },
  {
    title: "Introducing ExPac Motion",
    tag: "Presentation",
    description:
      "A tour of the portal: quotes, tracking, documents, warehouse, invoices, reports and a direct line to our team.",
    file: "/hub/expac-motion-presentation.pdf",
    cover: "/hub/cover-presentation.jpg",
    meta: "PDF · 17 pages · 8.5 MB",
  },
];

/** Information Hub: ExPac's guides and presentations for customers, to
 *  view in the browser or download. Grows as new material is added. */
export default function PortalInfoHubPage() {
  return (
    <>
      <PageHeader eyebrow="Help & resources" title="Information Hub" />
      <p className="hint" style={{ marginTop: 0 }}>
        Guides and presentations from ExPac, to read online, download or share with your team.
      </p>
      <div className="pt-hub">
        {RESOURCES.map((r) => (
          <article key={r.file} className="pt-hub-card">
            <a href={r.file} target="_blank" rel="noreferrer" className="pt-hub-cover" title={`View ${r.title}`}>
              <img src={r.cover} alt="" loading="lazy" />
            </a>
            <div className="pt-hub-body">
              <span className="pt-hub-tag">{r.tag}</span>
              <h3>{r.title}</h3>
              <p>{r.description}</p>
              <div className="pt-hub-foot">
                <span className="hint">{r.meta}</span>
                <span className="pt-hub-actions">
                  <a className="btn outline btn-sm" href={r.file} download>
                    Download
                  </a>
                  <a className="btn btn-sm" href={r.file} target="_blank" rel="noreferrer">
                    View
                  </a>
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 18 }}>
        Need help with something not covered here? Use Chat (bottom right) or email support@expac.co.za.
      </p>
    </>
  );
}
