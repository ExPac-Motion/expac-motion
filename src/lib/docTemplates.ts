import { formatDate, portCode } from "./format";
import type { Job, Quote } from "./types";

export interface DocumentTypeDef {
  slug: string;
  title: string;
  /** Letter-style documents also show a free-text body section (job.notes)
   *  between Shipment Information and the Packing List — every other
   *  document is shipment info + packing list + sign-off only. */
  showNotes?: boolean;
  /** Heading for that free-text section. Defaults to `title` when unset. */
  notesLabel?: string;
}

export const DOCUMENT_TYPES_LIST: DocumentTypeDef[] = [
  { slug: "delivery-release-order", title: "Delivery Release Order" },
  {
    slug: "delivery-instruction",
    title: "Delivery Instruction",
    showNotes: true,
    notesLabel: "Delivery Instructions",
  },
  { slug: "delivery-note", title: "Delivery Note" },
  { slug: "airline-draw-letter", title: "Airline Draw Letter", showNotes: true },
  { slug: "authorization-letter", title: "Authorization Letter", showNotes: true },
  { slug: "arrival-notification", title: "Arrival Notification" },
  { slug: "booking-confirmation", title: "Booking Confirmation" },
];

export function docTypeBySlug(slug: string | undefined): DocumentTypeDef | undefined {
  return DOCUMENT_TYPES_LIST.find((d) => d.slug === slug);
}

/** Every shipment field worth printing on operational paperwork — deliberately
 *  excludes commercial value / insurance (those only ever live on the quote,
 *  and never belong on ops-facing documents). Container Type and Incoterms
 *  only apply to Sea Freight; HBL/HAWB Number is shown on every document,
 *  resolved from the linked quote's HBL (sea) or HAWB (air) field. */
export function shipmentInfoRows(
  job: Job,
  quote?: Pick<
    Quote,
    "hbl_no" | "hawb_no" | "incoterms" | "delivery_terms"
  > | null,
): [string, string][] {
  const isSea = job.mode.startsWith("Sea Freight");
  const hblHawb = isSea ? quote?.hbl_no : quote?.hawb_no;

  const rows: [string, string][] = [
    ["Shipment Reference", job.reference],
    ["Mode", job.mode],
    ["Customer / Consignee", job.client?.company ?? "—"],
    ["Shipper / Exporter", job.supplier?.company ?? "—"],
    ["Port of Load", portCode(job.origin)],
    ["Port of Discharge", portCode(job.destination)],
    ["Carrier / Airline", job.carrier_name || "—"],
    ["Shipping Line", job.shipping_line || "—"],
    ["Vessel", job.vessel_name || "—"],
    ["Container No", job.container_no || "—"],
  ];
  if (isSea) rows.push(["Container Type", job.container_type || "—"]);
  rows.push(
    ["AWB / MBL No", job.awb_mbl || "—"],
    ["HBL/HAWB Number", hblHawb || "—"],
  );
  if (isSea) rows.push(["Incoterms", quote?.incoterms || "—"]);
  rows.push(
    ["Delivery Terms", quote?.delivery_terms || "—"],
    ["PO / Customer Ref", job.po_no || "—"],
    ["ETD", formatDate(job.etd)],
    ["Provisional Delivery Date", formatDate(job.provisional_delivery_date)],
    ["ETA", formatDate(job.eta)],
    ["Shipment Status", job.shipment_status || "—"],
  );
  return rows;
}
