import { formatDate } from "./format";

/** A merge code the composer can insert and the sender resolves at send time.
 *  Double-brace form ({{ … }}) to match the saved templates and the
 *  `process_due_follow_ups` DB function. */
export interface MergeCode {
  token: string;
  label: string;
}

/** The codes offered in the generic "{ }" pickers (subject lines, CRM email
 *  bodies), in listed order. Anything not supplied for a given send simply
 *  resolves to an empty string. */
export const MERGE_CODES: MergeCode[] = [
  { token: "{{ contact.name }}", label: "Contact name" },
  { token: "{{ contact.company }}", label: "Contact company" },
  { token: "{{ customer.name }}", label: "Customer name" },
  { token: "{{ shipment.number }}", label: "Shipment number" },
  { token: "{{ quote.reference }}", label: "Quote reference" },
  { token: "{{ customer.reference }}", label: "Customer reference (PO)" },
  { token: "{{ origin }}", label: "Origin" },
  { token: "{{ destination }}", label: "Destination" },
  { token: "{{ mode }}", label: "Freight mode" },
  { token: "{{ valid.until }}", label: "Quote valid-until date" },
  { token: "{{ today }}", label: "Today’s date" },
];

/** The fuller code set for the Shipment Comms template editor — everything a
 *  shipment-notification email can reference. */
export const SHIPMENT_MERGE_CODES: MergeCode[] = [
  { token: "{{ customer.name }}", label: "Customer name" },
  { token: "{{ shipment.number }}", label: "Shipment number" },
  { token: "{{ supplier.name }}", label: "Supplier name" },
  { token: "{{ shipment.po }}", label: "Purchase order number" },
  { token: "{{ shipment.shipped_from }}", label: "Shipped from (country)" },
  { token: "{{ shipment.mode }}", label: "Shipping mode" },
  { token: "{{ shipment.origin }}", label: "Origin (port)" },
  { token: "{{ shipment.destination }}", label: "Destination (port)" },
  { token: "{{ shipment.shipping_line }}", label: "Shipping line" },
  { token: "{{ shipment.vessel }}", label: "Vessel name" },
  { token: "{{ shipment.container }}", label: "Container number" },
  { token: "{{ shipment.carrier }}", label: "Carrier / airline" },
  { token: "{{ shipment.awb }}", label: "AWB / MBL number" },
  { token: "{{ shipment.etd }}", label: "Departure from port of load" },
  { token: "{{ shipment.eta }}", label: "Arrival at port of discharge" },
  { token: "{{ shipment.delivery_date }}", label: "Provisional delivery date" },
  { token: "{{ shipment.status }}", label: "Shipment status" },
  { token: "{{ remarks }}", label: "Operator remarks" },
  { token: "{{ today }}", label: "Today’s date" },
];

export interface MergeContext {
  /** contact.name */
  name?: string;
  /** contact.company */
  company?: string;
  /** customer.name — falls back to `company` when not given */
  customerName?: string;
  /** customer.reference / PO number */
  customerReference?: string;
  /** shipment.number (quotes & jobs share `reference`) */
  shipmentNumber?: string;
  /** quote.reference */
  quoteReference?: string;
  origin?: string;
  destination?: string;
  mode?: string;
  /** ISO date or an already-formatted string */
  validUntil?: string;
  unsubscribeUrl?: string;

  // --- shipment-notification fields ---
  supplierName?: string;
  /** Purchase order number (job.po_no) */
  poNumber?: string;
  /** Country of the origin LOCODE */
  shippedFrom?: string;
  shippingLine?: string;
  vesselName?: string;
  containerNo?: string;
  carrierName?: string;
  /** AWB / MBL number */
  awb?: string;
  /** Departure from port of load — ISO date or preformatted */
  etd?: string;
  /** Arrival at port of discharge — ISO date or preformatted */
  eta?: string;
  /** Provisional delivery date — ISO date or preformatted */
  deliveryDate?: string;
  shipmentStatus?: string;
  /** The operator's free-text message (already merge-resolved). */
  remarks?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const fmtDate = (v: string | undefined): string =>
  v ? (ISO_DATE.test(v) ? formatDate(v) : v) : "";

/** Resolves every merge code in `text` against `ctx`. Unknown-for-this-send
 *  codes collapse to "" so nothing leaks a raw "{{ … }}" to a recipient. */
export function resolveMergeFields(text: string, ctx: MergeContext): string {
  const map: Record<string, string> = {
    "{{ contact.name }}": ctx.name ?? "",
    "{{ contact.company }}": ctx.company ?? "",
    "{{ customer.name }}": ctx.customerName ?? ctx.company ?? "",
    "{{ customer.reference }}": ctx.customerReference ?? ctx.poNumber ?? "",
    "{{ shipment.number }}": ctx.shipmentNumber ?? "",
    "{{ quote.reference }}": ctx.quoteReference ?? "",
    "{{ origin }}": ctx.origin ?? "",
    "{{ destination }}": ctx.destination ?? "",
    "{{ mode }}": ctx.mode ?? "",
    "{{ valid.until }}": fmtDate(ctx.validUntil),
    "{{ today }}": formatDate(new Date().toISOString()),
    "{{ unsubscribe_link }}": ctx.unsubscribeUrl ?? "",

    "{{ supplier.name }}": ctx.supplierName ?? "",
    "{{ shipment.po }}": ctx.poNumber ?? "",
    "{{ shipment.shipped_from }}": ctx.shippedFrom ?? "",
    "{{ shipment.mode }}": ctx.mode ?? "",
    "{{ shipment.origin }}": ctx.origin ?? "",
    "{{ shipment.destination }}": ctx.destination ?? "",
    "{{ shipment.shipping_line }}": ctx.shippingLine ?? "",
    "{{ shipment.vessel }}": ctx.vesselName ?? "",
    "{{ shipment.container }}": ctx.containerNo ?? "",
    "{{ shipment.carrier }}": ctx.carrierName ?? "",
    "{{ shipment.awb }}": ctx.awb ?? "",
    "{{ shipment.etd }}": fmtDate(ctx.etd),
    "{{ shipment.eta }}": fmtDate(ctx.eta),
    "{{ shipment.delivery_date }}": fmtDate(ctx.deliveryDate),
    "{{ shipment.status }}": ctx.shipmentStatus ?? "",
    "{{ remarks }}": ctx.remarks ?? "",
  };
  let out = text;
  for (const [token, value] of Object.entries(map)) {
    out = out.replaceAll(token, value);
  }
  return out;
}

/** A plain-text fallback for the html body, for the email's text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
