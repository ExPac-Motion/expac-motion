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

/** A party's company name, address and tel on separate lines (printed with
 *  white-space: pre-line); missing address/tel lines are simply left out. */
function partyBlock(
  company: string | null | undefined,
  address: string | null | undefined,
  tel: string | null | undefined,
): string {
  if (!company) return "—";
  return [company, address, tel].filter((s) => s && s.trim()).join("\n");
}

/** Top row of Shipment Information: Shipper / Exporter then Customer /
 *  Consignee, printed on their own two-column row above the main grid. */
export function shipmentPartyRows(job: Job): [string, string][] {
  return [
    [
      "Shipper / Exporter",
      partyBlock(job.supplier?.company, job.supplier?.address, job.supplier?.phone),
    ],
    [
      "Customer / Consignee",
      partyBlock(
        job.client?.company,
        job.client?.address,
        job.client?.company_phone || job.client?.phone,
      ),
    ],
  ];
}

/** Every shipment field worth printing on operational paperwork — deliberately
 *  excludes commercial value / insurance (those only ever live on the quote,
 *  and never belong on ops-facing documents). Sea and Air differ, using the
 *  Quote Builder's own labels: Sea prints MBL No / HBL No, Voyage No,
 *  Container Type and Incoterms; Air (every non-sea mode) prints MAWB No /
 *  HAWB No, Agent / Airline, Flight No and Flight Date. Prepared By is the
 *  quote's sales person. */
export function shipmentInfoRows(
  job: Job,
  quote?: Pick<
    Quote,
    | "mbl_no"
    | "hbl_no"
    | "mawb_no"
    | "hawb_no"
    | "voyage_no"
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
): [string, string][] {
  const isSea = job.mode.startsWith("Sea Freight");

  const rows: [string, string][] = [
    ["Shipment Reference", job.reference],
    ["Mode", job.mode],
    ["Port of Load", portCode(job.origin)],
    ["Port of Discharge", portCode(job.destination)],
    ["Shipping Line", job.shipping_line || "—"],
    ["Vessel", job.vessel_name || "—"],
  ];
  if (isSea) rows.push(["Voyage No", quote?.voyage_no || "—"]);
  rows.push(["Container No", job.container_no || "—"]);
  if (isSea) {
    rows.push(
      ["Container Type", job.container_type || "—"],
      ["MBL No", quote?.mbl_no || job.awb_mbl || "—"],
      ["HBL No", quote?.hbl_no || "—"],
      ["Incoterms", quote?.incoterms || "—"],
    );
  } else {
    rows.push(
      ["MAWB No", quote?.mawb_no || job.awb_mbl || "—"],
      ["HAWB No", quote?.hawb_no || "—"],
      ["Agent / Airline", quote?.carrier_name || job.carrier_name || "—"],
    );
  }
  rows.push(
    ["Delivery Terms", quote?.delivery_terms || "—"],
    ["Customer Reference", job.po_no || quote?.customer_reference || "—"],
    ["Shipment Status", job.shipment_status || "—"],
    ["ETD", formatDate(job.etd)],
    ["ETA", formatDate(job.eta)],
    ["Provisional Delivery Date", formatDate(job.provisional_delivery_date)],
    ["Commodity", quote?.commodity || "—"],
    ["Prepared By", preparedBy || "—"],
  );
  if (!isSea) {
    rows.push(
      ["Flight No", quote?.flight_no || "—"],
      ["Flight Date", formatDate(quote?.flight_date)],
    );
  }
  return rows;
}
