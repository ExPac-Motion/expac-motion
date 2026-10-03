import { formatDate, portCode } from "./format";
import type { Job, JobTracking, Quote } from "./types";

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

/** A party's company name, then "Add:", "Attn:" and "Tel:" lines (printed
 *  with white-space: pre-line); any missing line is simply left out. */
function partyBlock(
  company: string | null | undefined,
  address: string | null | undefined,
  contact: string | null | undefined,
  tel: string | null | undefined,
): string {
  if (!company) return "—";
  const line = (label: string, v: string | null | undefined) =>
    v && v.trim() ? `${label} ${v.trim()}` : null;
  return [company, line("Add:", address), line("Attn:", contact), line("Tel:", tel)]
    .filter(Boolean)
    .join("\n");
}

/** Sea-style fields (vessel, container, MBL/HBL) vs Air-style (flight, MAWB/
 *  HAWB). Road Freight uses the Sea layout until it gets its own; Air and
 *  Courier (CX) share the Air layout. Drives both the shipment documents and
 *  which fields the Quote Builder shows. */
export function usesSeaLayout(mode: string | null | undefined): boolean {
  const m = mode ?? "";
  return m.startsWith("Sea Freight") || m.startsWith("Road Freight");
}

/** Label for the `shipping_line` field: "Shipping Line" on Sea Freight,
 *  "Carrier" on every other mode. */
export function carrierLabel(mode: string | null | undefined): string {
  return (mode ?? "").startsWith("Sea") ? "Shipping Line" : "Carrier";
}

/** Top row of Shipment Information: Shipper / Exporter then Customer /
 *  Consignee, printed on their own two-column row above the main grid. */
export function shipmentPartyRows(job: Job): [string, string][] {
  return [
    [
      "Shipper / Exporter",
      partyBlock(
        job.supplier?.company,
        job.supplier?.address,
        job.supplier?.contact,
        job.supplier?.phone,
      ),
    ],
    [
      "Customer / Consignee",
      partyBlock(
        job.client?.company,
        job.client?.address,
        job.client?.contact,
        job.client?.company_phone || job.client?.phone,
      ),
    ],
  ];
}

/** Every shipment field worth printing on operational paperwork — deliberately
 *  excludes commercial value / insurance (those only ever live on the quote,
 *  and never belong on ops-facing documents). Sea and Air each print a fixed
 *  sequence using the Quote Builder's labels: Sea has Shipping Line, Vessel,
 *  Voyage No, Container No/Type, MBL No, HBL No; Air (Air Freight + Courier CX; Road uses Sea for now) has
 *  Agent / Airline, Flight No/Date, Routing, Transit Time, MAWB No, HAWB No. Both then share
 *  Incoterms → Prepared By (the quote's sales person). */
export function shipmentInfoRows(
  job: Job,
  quote?: Pick<
    Quote,
    | "mbl_no"
    | "hbl_no"
    | "mawb_no"
    | "hawb_no"
    | "voyage_no"
    | "routing"
    | "transit_time"
    | "carrier_name"
    | "customer_reference"
    | "incoterms"
    | "delivery_terms"
    | "commodity"
    | "flight_no"
    | "flight_date"
  > | null,
  /** The ExPac controller / sales person on the quote (profile full name). */
  preparedBy?: string | null,
  /** Live tracking row for this job. Its vessel / voyage / carrier / ETD / ETA
   *  win over the typed values, so a document printed before the webhook's
   *  write-back lands is still current. */
  tracking?: Pick<JobTracking, "vessel_name" | "voyage" | "carrier" | "etd" | "eta"> | null,
): [string, string][] {
  const t = tracking ?? null;
  const isSea = usesSeaLayout(job.mode);
  const head: [string, string][] = [
    ["Shipment Reference", job.reference],
    ["Mode", job.mode],
    ["Port of Load", portCode(job.origin)],
    ["Port of Discharge", portCode(job.destination)],
  ];
  const middle: [string, string][] = isSea
    ? [
        ["Shipping Line", t?.carrier || job.shipping_line || "—"],
        ["Vessel", t?.vessel_name || job.vessel_name || "—"],
        ["Voyage No", t?.voyage || quote?.voyage_no || "—"],
        ["Container No", job.container_no || "—"],
        ["Container Type", job.container_type || "—"],
        ["MBL No", quote?.mbl_no || job.awb_mbl || "—"],
        ["HBL No", quote?.hbl_no || "—"],
      ]
    : [
        ["Agent / Airline", t?.carrier || quote?.carrier_name || job.carrier_name || "—"],
        ["Flight No", quote?.flight_no || "—"],
        ["Flight Date", formatDate(quote?.flight_date)],
        ["Routing", quote?.routing || "—"],
        ["Transit Time", quote?.transit_time || "—"],
        ["MAWB No", quote?.mawb_no || job.awb_mbl || "—"],
        ["HAWB No", quote?.hawb_no || "—"],
      ];
  const tail: [string, string][] = [
    ["Incoterms", quote?.incoterms || "—"],
    ["Shipment Status", job.shipment_status || "—"],
    ["Customer Reference", job.po_no || quote?.customer_reference || "—"],
    ["Delivery Terms", quote?.delivery_terms || "—"],
    ["Commodity", quote?.commodity || "—"],
    ["ETD", formatDate(t?.etd || job.etd)],
    ["ETA", formatDate(t?.eta || job.eta)],
    ["Provisional Delivery Date", formatDate(job.provisional_delivery_date)],
    ["Prepared By", preparedBy || "—"],
  ];
  const rows = [...head, ...middle, ...tail];
  return rows;
}
