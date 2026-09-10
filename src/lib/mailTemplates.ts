import { COMPANY } from "./company";
import { formatDate } from "./format";
import { LOCODES } from "./locodes";
import { resolveMergeFields, type MergeContext } from "./mailMerge";
import { EMAIL_FONT_SIZE, EMAIL_FONT_STACK } from "./mailStyle";
import type {
  Job,
  JobTracking,
  QuoteMode,
  ShipmentCommsConfig,
  ShipmentCommsTemplate,
  ShipmentModeKey,
} from "./types";

const RULE = "________________________________________";

/** Country for the leading UN/LOCODE in an Origin/Destination string. */
export function locodeCountry(place: string | null | undefined): string {
  const s = (place ?? "").trim().toUpperCase();
  const m = s.match(/^([A-Z]{2}[A-Z0-9]{3})\b/);
  const code = m ? m[1] : s.slice(0, 5);
  return LOCODES.find((l) => l.code === code)?.country ?? "";
}

/** "Sea Freight (FCL)" -> "Sea Freight". */
function modeLabel(mode: string): string {
  return mode.replace(/\s*\(.*\)\s*$/, "").trim();
}

/** formatDate, but blank (not "—") when there's no date — matches the template. */
function d(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : "";
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/* ------------------------------------------------------------------ */
/*  Per-mode shipment-notification templates                          */
/* ------------------------------------------------------------------ */

/** Which of the four configurable groups a job's mode belongs to. */
export function shipmentModeKey(mode: QuoteMode): ShipmentModeKey {
  if (mode.startsWith("Sea")) return "sea";
  if (mode.startsWith("Air")) return "air";
  if (mode.startsWith("Courier")) return "courier";
  return "road";
}

export const SHIPMENT_MODE_LABEL: Record<ShipmentModeKey, string> = {
  air: "Air Freight",
  sea: "Sea Freight",
  courier: "Courier Express",
  road: "Road Freight",
};

/** Order the Shipment Comms tab lists the modes in. */
export const SHIPMENT_MODE_KEYS: ShipmentModeKey[] = [
  "air",
  "sea",
  "courier",
  "road",
];

const SEA_BODY = `{{ customer.name }}

Update for Shipment: {{ shipment.number }}
Supplier Name: {{ supplier.name }}
Purchase Order Number: {{ shipment.po }}
Shipped From: {{ shipment.shipped_from }}
${RULE}

Shipping Mode: {{ shipment.mode }}
Shipment Number: {{ shipment.number }}
Shipping Line: {{ shipment.shipping_line }}
Vessel Name: {{ shipment.vessel }}
Container Number: {{ shipment.container }}
Departure from Port of Load: {{ shipment.etd }}
Arrival at Port of Discharge: {{ shipment.eta }}
Provisional Delivery Date: {{ shipment.delivery_date }}
Shipment Status: {{ shipment.status }}
${RULE}

Remarks: {{ remarks }}

Thank you,
Support at EXPAC (ZAJNB)
${RULE}`;

const SHORT_BODY = `{{ customer.name }}

Notification for Shipment: {{ shipment.number }}
Supplier Name: {{ supplier.name }}
Purchase Order Number: {{ shipment.po }}
Shipped From: {{ shipment.shipped_from }}
${RULE}

Shipping Mode: {{ shipment.mode }}
Shipment Number: {{ shipment.number }}
Departure from Port of Load: {{ shipment.etd }}
Arrival at Port of Discharge: {{ shipment.eta }}
Provisional Delivery Date: {{ shipment.delivery_date }}
Shipment Status: {{ shipment.status }}
${RULE}

Remarks: {{ remarks }}

Thank you,
Support at EXPAC (ZAJNB)
${RULE}`;

/** Built-in templates — reproduce the previous hard-coded email exactly.
 *  Sea gets the fuller block; Air / Courier / Road use the shorter one. */
export const DEFAULT_SHIPMENT_COMMS: Record<
  ShipmentModeKey,
  ShipmentCommsTemplate
> = {
  sea: { subject: "Update for Shipment: {{ shipment.number }}", body: SEA_BODY },
  air: {
    subject: "Notification for Shipment: {{ shipment.number }}",
    body: SHORT_BODY,
  },
  courier: {
    subject: "Notification for Shipment: {{ shipment.number }}",
    body: SHORT_BODY,
  },
  road: {
    subject: "Notification for Shipment: {{ shipment.number }}",
    body: SHORT_BODY,
  },
};

/** The effective template for a mode: stored overrides on top of the default. */
export function shipmentCommsTemplate(
  key: ShipmentModeKey,
  config?: ShipmentCommsConfig | null,
): ShipmentCommsTemplate {
  const base = DEFAULT_SHIPMENT_COMMS[key];
  const over = config?.[key];
  return {
    subject: over?.subject?.trim() ? over.subject : base.subject,
    body: over?.body?.trim() ? over.body : base.body,
  };
}

/** Merge-code values for a shipment-notification email. */
export function shipmentMergeContext(job: Job): MergeContext {
  return {
    customerName: job.client?.company || "Customer",
    company: job.client?.company ?? "",
    supplierName: job.supplier?.company ?? "",
    poNumber: job.po_no ?? "",
    customerReference: job.po_no ?? "",
    shipmentNumber: job.reference,
    quoteReference: job.reference,
    shippedFrom: locodeCountry(job.origin),
    mode: modeLabel(job.mode),
    origin: job.origin ?? "",
    destination: job.destination ?? "",
    shippingLine: job.shipping_line ?? "",
    vesselName: job.vessel_name ?? "",
    containerNo: job.container_no ?? "",
    carrierName: job.carrier_name ?? "",
    awb: job.awb_mbl ?? "",
    etd: d(job.etd),
    eta: d(job.eta),
    deliveryDate: d(job.provisional_delivery_date),
    shipmentStatus: job.shipment_status ?? "",
  };
}

/** Resolve a template against a job + the operator's remarks. */
export function renderShipmentEmail(
  job: Job,
  tpl: ShipmentCommsTemplate,
  remarks: string,
): { subject: string; text: string } {
  const ctx = shipmentMergeContext(job);
  // Resolve codes the operator typed into their message first, then feed the
  // result in as {{ remarks }} so it isn't double-processed.
  const resolvedRemarks = resolveMergeFields((remarks ?? "").trim(), ctx);
  return {
    subject: resolveMergeFields(tpl.subject, ctx).trim(),
    text: resolveMergeFields(tpl.body, { ...ctx, remarks: resolvedRemarks }),
  };
}

/** Wrap the plain-text body in the branded HTML shell. */
export function shipmentEmailHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};color:#2e2e2e;line-height:1.55;max-width:640px">
  <img src="https://expac.co.za${COMPANY.logoPrint}" alt="EXPAC Forwarding" style="max-height:46px;margin-bottom:8px" />
  <div style="border-top:3px solid #8cbc43;margin:6px 0 14px"></div>
  <pre style="font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};white-space:pre-wrap;margin:0">${esc(text)}</pre>
</div>`;
}

/**
 * Assemble the customer update email for a shipment, using the team's
 * per-mode template (Settings → Shipment Comms) or the built-in default.
 * `remarks` is the operator's free-text message.
 */
export function buildShipmentEmail(
  job: Job,
  _tracking: JobTracking | undefined,
  remarks: string,
  config?: ShipmentCommsConfig | null,
): BuiltEmail {
  const tpl = shipmentCommsTemplate(shipmentModeKey(job.mode), config);
  const { subject, text } = renderShipmentEmail(job, tpl, remarks);
  return { subject, text, html: shipmentEmailHtml(text) };
}
