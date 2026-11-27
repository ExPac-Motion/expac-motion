import { Loading, PageHeader } from "../../components/common";
import HubGrid from "../../components/HubGrid";
import { useHubItems, type HubItem } from "../../lib/hub";

/** Shown until the Hub table exists (before migration 0252) or if it's empty. */
const FALLBACK: HubItem[] = [
  {
    id: "quote-manual",
    title: "Quote Request & Portal Manual",
    tag: "How-to guide",
    description:
      "Step by step: request a quotation, ask for a revision, accept it, add your shippers and follow every shipment, live.",
    kind: "file",
    file_url: "/hub/expac-motion-quote-request-manual.pdf",
    cover_url: "/hub/cover-quote-manual.jpg",
    meta: "PDF · 15 pages · 4 MB",
    audience: "customers",
    published: true,
    sort: 10,
    created_at: "",
  },
  {
    id: "presentation",
    title: "Introducing ExPac Motion",
    tag: "Presentation",
    description:
      "A tour of the portal: quotes, tracking, documents, warehouse, invoices, reports and a direct line to our team.",
    kind: "file",
    file_url: "/hub/expac-motion-presentation.pdf",
    cover_url: "/hub/cover-presentation.jpg",
    meta: "PDF · 17 pages · 8.5 MB",
    audience: "both",
    published: true,
    sort: 20,
    created_at: "",
  },
];

/** Information Hub: ExPac's guides, presentations and marketing content for
 *  customers (managed in CRM › Media › Information Hub, 0252). */
export default function PortalInfoHubPage() {
  const q = useHubItems();
  const items = q.error || (q.data && q.data.length === 0) ? FALLBACK : (q.data ?? []);
  return (
    <>
      <PageHeader eyebrow="Help & resources" title="Information Hub" />
      <p className="hint" style={{ marginTop: 0 }}>
        Guides and presentations from ExPac, to read online, download or share with your team.
      </p>
      {q.isLoading ? <Loading /> : <HubGrid items={items} />}
      <p className="hint" style={{ marginTop: 18 }}>
        Need help with something not covered here? Use Chat (bottom right) or email support@expac.co.za.
      </p>
    </>
  );
}
