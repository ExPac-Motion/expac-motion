import { formatDate } from "./format";
import { LOCODES } from "./locodes";
import { resolveMergeFields, type MergeContext } from "./mailMerge";
import { EMAIL_FONT_SIZE, EMAIL_FONT_STACK, emailButtonHtml } from "./mailStyle";
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
Port of Load: {{ shipment.origin }}
Port of Discharge: {{ shipment.destination }}
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
Port of Load: {{ shipment.origin }}
Port of Discharge: {{ shipment.destination }}
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

/** The effective template for a mode: stored overrides on top of a set of
 *  built-in defaults (DEFAULT_SHIPMENT_COMMS or DEFAULT_SHIPMENT_REPLIES). */
function resolveTemplate(
  key: ShipmentModeKey,
  config: ShipmentCommsConfig | null | undefined,
  defaults: Record<ShipmentModeKey, ShipmentCommsTemplate>,
): ShipmentCommsTemplate {
  const base = defaults[key];
  const over = config?.[key];
  return {
    subject: over?.subject?.trim() ? over.subject : base.subject,
    body: over?.body?.trim() ? over.body : base.body,
  };
}

export function shipmentCommsTemplate(
  key: ShipmentModeKey,
  config?: ShipmentCommsConfig | null,
): ShipmentCommsTemplate {
  return resolveTemplate(key, config, DEFAULT_SHIPMENT_COMMS);
}

export function shipmentReplyTemplate(
  key: ShipmentModeKey,
  config?: ShipmentCommsConfig | null,
): ShipmentCommsTemplate {
  return resolveTemplate(key, config, DEFAULT_SHIPMENT_REPLIES);
}

/** A quick chat-style reply within an existing thread — no shipment-data
 *  block, just the operator's message and the signature. Same per-mode
 *  override shape as Shipment Comms (Settings → Shipment Replies), but the
 *  built-in defaults are identical across modes since there's no
 *  mode-specific data to show. */
const REPLY_BODY = `{{ remarks }}

Kind Regards

Oliver | Support | ExPac Forwarding
Air and Ocean Freight Clearing & Forwarding, Great Voyages Starts Here”

T: +27 (0) 11 568 8281 | WA: +27 (0) 82 682 3332 | F: +27 (0) 86 482 2371
E: support@expac.co.za | Office: admin@expac.co.za | Portal: www.expac.co.za
Postal Address: PostNet Suite 84, Private Bag X1015, Lyttelton, 0140

Our team operates flexibly across multiple time zones, allowing us to provide responsive support
and seamless collaboration no matter where you are located. This means faster turnarounds, greater
availability, and a workflow that adapts to your schedule.`;

const REPLY_TEMPLATE: ShipmentCommsTemplate = {
  subject: "Re: Shipment {{ shipment.number }}",
  body: REPLY_BODY,
};

export const DEFAULT_SHIPMENT_REPLIES: Record<
  ShipmentModeKey,
  ShipmentCommsTemplate
> = {
  sea: REPLY_TEMPLATE,
  air: REPLY_TEMPLATE,
  courier: REPLY_TEMPLATE,
  road: REPLY_TEMPLATE,
};

/** Merge-code values for a shipment-notification email. */
export function shipmentMergeContext(job: Job): MergeContext {
  return {
    // {{ contact.name }} — the customer's contact person, else the company.
    name: job.client?.contact || job.client?.company || "Customer",
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

const RULE_LINE = /^_+$/;
/** A "Label: value" line — the label (with its colon) is what gets bolded. */
const LABEL_LINE = /^([^:\n]+:)(.*)$/;
/** Sign-off lines that mark the end of the shipment-data block — the
 *  signature after this (incl. its own "T: / E: / Postal Address:" lines)
 *  is never bolded by the general Label: rule, even though those also
 *  look like "Label: value" (they get their own styling below instead). */
const SIGNOFF_LINE = /^(thank you|kind regards)\b/i;
/** The signature's own contact labels — bold + brand green, wherever the
 *  signature is used (Shipment Comms and Shipment Replies both share it).
 *  Matched only at the start of a line or right after the "| " separator
 *  the signature uses, e.g. "T: ... | WA: ... | F: ...", so it never
 *  catches "Office:" / "Portal:" on the same E: line. */
const SIG_LABEL = /(^|\| )(T|WA|F|E|Postal Address):/gm;
const SIG_LABEL_COLOR = "rgb(140, 188, 67)";

/** The line the Live Tracking button is anchored under — matches whether
 *  the label has since been HTML-bolded or not. */
const TRACKING_ANCHOR_LABEL = "Provisional Delivery Date:";

function trackingUrl(job: Job): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://expac-motion.pages.dev";
  return `${origin}/track?ref=${encodeURIComponent(job.reference)}`;
}

/** Insert `line` right after the line containing `label`, with a blank line
 *  on each side so it doesn't sit flush against the surrounding text, or
 *  append it at the end (same spacing) if that label isn't present — e.g. a
 *  Settings-customized template that dropped the Provisional Delivery Date
 *  field. */
function insertAfterLabelLine(text: string, label: string, line: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(label));
  if (i === -1) return `${text}\n\n${line}`;
  lines.splice(i + 1, 0, "", line, "");
  return lines.join("\n");
}

/** Wrap the plain-text body in the branded HTML shell. `boldHeadings` (the
 *  shipment status-update body, not the free-text reply) also bolds the
 *  first line — the customer's name, upper-cased — and the label on every
 *  "Label: value" line up to the sign-off (Shipment Status, Supplier Name,
 *  etc). The signature's own T:/WA:/F:/E:/Postal Address: labels get bold
 *  + brand-green styling either way. Pass `job` to insert the ExPac Motion
 *  Live Tracking button under Provisional Delivery Date (or, if that line
 *  isn't present — e.g. the Reply template — at the end). */
export function shipmentEmailHtml(
  text: string,
  boldHeadings = false,
  job?: Job,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const formatted = boldHeadings ? formatShipmentBody(text, esc) : esc(text);
  let body = formatted.replace(
    SIG_LABEL,
    (_m, prefix: string, label: string) =>
      `${prefix}<b style="color:${SIG_LABEL_COLOR}">${label}:</b>`,
  );
  if (job) {
    body = insertAfterLabelLine(
      body,
      TRACKING_ANCHOR_LABEL,
      emailButtonHtml(trackingUrl(job), "ExPac Motion Live Tracking"),
    );
  }
  // Plain text in the house font — no logo image (it rendered as a broken
  // attachment in Outlook); branding lives in the signature.
  return `<div style="font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};color:#2e2e2e;line-height:1.55;max-width:640px">
  <pre style="font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};white-space:pre-wrap;margin:0">${body}</pre>
</div>`;
}

function formatShipmentBody(text: string, esc: (s: string) => string): string {
  let sawFirstLine = false;
  let pastSignoff = false;
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!sawFirstLine) {
        if (trimmed === "") return line;
        sawFirstLine = true;
        return `<b>${esc(line.toUpperCase())}</b>`;
      }
      if (SIGNOFF_LINE.test(trimmed)) pastSignoff = true;
      if (pastSignoff) return esc(line);
      if (trimmed === "" || RULE_LINE.test(trimmed)) return esc(line);
      const m = line.match(LABEL_LINE);
      return m ? `<b>${esc(m[1])}</b>${esc(m[2])}` : esc(line);
    })
    .join("\n");
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
  // Plain-text counterpart of the button shipmentEmailHtml inlines into the
  // html version — same spot, under Provisional Delivery Date.
  const textWithLink = insertAfterLabelLine(
    text,
    TRACKING_ANCHOR_LABEL,
    `Live Tracking: ${trackingUrl(job)}`,
  );
  return { subject, text: textWithLink, html: shipmentEmailHtml(text, true, job) };
}

/**
 * A quick chat-style reply within an existing thread (Settings → Shipment
 * Replies, or the built-in default) — just the operator's message and
 * signature, no shipment-data block. Use for ongoing back-and-forth;
 * buildShipmentEmail is still there for a full status-update notification.
 */
export function buildShipmentReply(
  job: Job,
  remarks: string,
  config?: ShipmentCommsConfig | null,
): BuiltEmail {
  const tpl = shipmentReplyTemplate(shipmentModeKey(job.mode), config);
  const { subject, text } = renderShipmentEmail(job, tpl, remarks);
  // No Provisional Delivery Date line in the Reply body, so this falls back
  // to appending at the end — same fallback shipmentEmailHtml uses below.
  const textWithLink = insertAfterLabelLine(
    text,
    TRACKING_ANCHOR_LABEL,
    `Live Tracking: ${trackingUrl(job)}`,
  );
  return { subject, text: textWithLink, html: shipmentEmailHtml(text, false, job) };
}
