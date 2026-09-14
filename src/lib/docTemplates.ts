import { formatDate, portCode } from "./format";
import type { Job } from "./types";

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
 *  and never belong on ops-facing documents). */
export function shipmentInfoRows(job: Job): [string, string][] {
  return [
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
    ["AWB / MBL No", job.awb_mbl || "—"],
    ["PO / Customer Ref", job.po_no || "—"],
    ["ETD", formatDate(job.etd)],
    ["ETA", formatDate(job.eta)],
    ["Provisional Delivery Date", formatDate(job.provisional_delivery_date)],
    ["Shipment Status", job.shipment_status || "—"],
  ];
}
