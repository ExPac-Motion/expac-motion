import { formatDate } from "./format";
import { LOCODES } from "./locodes";
import { resolveMergeFields, type MergeContext } from "./mailMerge";
import {
  EMAIL_FONT_SIZE,
  EMAIL_FONT_STACK,
  emailButtonHtml,
  PUBLIC_APP_URL,
} from "./mailStyle";
import type {
  Job,
  JobTracking,
  Quote,
  QuoteMode,
  ShipmentCommsConfig,
  ShipmentCommsTemplate,
  ShipmentModeKey,
} from "./types";
import { STATUS_LABEL } from "./types";

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

T: +27 (0) 11 568 8281 | WA: +27 (0) 82 682 3332 | F: +27 (0) 86 482 2371 | E: support@expac.co.za | Office: admin@expac.co.za | Portal: www.expac.co.za | Postal Address: PostNet Suite 84, Private Bag X1015, Lyttelton, 0140

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
/** A "Label: value" line — the label (with its colon) is what gets bolded.
 *  Only a label-like prefix counts: starts with a letter, ≤41 chars, no
 *  commas / sentence punctuation, and the colon ends the line or is followed
 *  by a space. Otherwise free-text remarks got bolded up to any colon in
 *  them — e.g. a ":)" smiley, a time like 10:30, or a URL. */
const LABEL_LINE = /^(\s*[A-Za-z][A-Za-z0-9 /&()'#.-]{0,40}:)(\s.*|)$/;
/** Sign-off lines that mark the end of the shipment-data block — the
 *  signature after this (incl. its own "T: / E: / Postal Address:" lines)
 *  is never bolded by the general Label: rule, even though those also
 *  look like "Label: value" (they get their own styling below instead). */
const SIGNOFF_LINE = /^(thank you|kind regards)\b/i;
/** The signature's own contact labels — bold + brand green, wherever the
 *  signature is used (Shipment Comms and Quotation Comms, and both their
 *  Replies variants, all share this one line). Captures the value after
 *  the label too (kept as plain text, never a link -- see
 *  linkifySignature below). Matched only at the start of a line or right
 *  after the "| " separator the signature uses, e.g.
 *  "T: ... | WA: ... | F: ... | E: ... | Office: ... | Portal: ... |
 *  Postal Address: ...". The value is captured non-greedily with its
 *  trailing whitespace split off, so a trailing space before the next
 *  "| " stays outside the value. */
const SIG_LINE =
  /(^|\| )(T|WA|F|E|Office|Portal|Postal Address):(\s*)([^|\n]+?)(\s*)(?=\||\n|$)/gm;
const SIG_LABEL_COLOR = "rgb(140, 188, 67)";
const SIG_VALUE_STYLE = "color:#2e2e2e;text-decoration:none;cursor:text";
/** A signature line starting with one of the contact labels. */
const SIG_START = /^\s*(\| )?(T|WA|F|E|Office|Portal|Postal Address):/;

/** Lay the signature's contact lines out as exactly two lines, however
 *  the template in Settings happens to break them:
 *    T: | WA: | F: | E:
 *    Office: | Portal: | Postal Address:
 *  (joined with " | ", then split once before Office:). */
function joinSignatureLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out[out.length - 1];
    if (prev !== undefined && SIG_START.test(line) && SIG_START.test(prev)) {
      const next = line.trim().replace(/^\| /, "");
      out[out.length - 1] = `${prev.replace(/\s*\|?\s*$/, "")} | ${next}`;
    } else {
      out.push(line);
    }
  }
  return out
    .map((l) => (SIG_START.test(l) ? l.replace(/\s*\|\s*(?=Office:)/, "\n") : l))
    .join("\n");
}

/** Bolds the T:/WA:/F:/E:/Office:/Portal:/Postal Address: labels (brand
 *  green); their values stay plain text, never links. */
function linkifySignature(html: string): string {
  return html.replace(
    SIG_LINE,
    (
      _m,
      prefix: string,
      label: string,
      ws: string,
      value: string,
      trailingWs: string,
    ) => {
      // Values are never clickable links. They sit in an href-less <a>
      // with an explicit colour: it isn't a link, but mail apps (Outlook
      // desktop, Outlook/Gmail mobile) skip text already inside an <a>
      // when auto-detecting phones/emails/addresses -- which otherwise
      // turned them blue and underlined. Explicit hex, not "inherit":
      // Outlook desktop ignores inherit on links.
      return `${prefix}<b style="color:${SIG_LABEL_COLOR}">${label}:</b>${ws}<a style="${SIG_VALUE_STYLE}">${value}</a>${trailingWs}`;
    },
  );
}

/** The line the Live Tracking button is anchored under — matches whether
 *  the label has since been HTML-bolded or not. */
const TRACKING_ANCHOR_LABEL = "Provisional Delivery Date:";

/** Job and Quote share the same reference/shipment number — a quote not
 *  yet accepted just won't have tracking data yet on the other end. */
function trackingUrl(entity: { reference: string }): string {
  return `${PUBLIC_APP_URL}/track?ref=${encodeURIComponent(entity.reference)}`;
}

/** Insert `line` right after the line containing `label`, with exactly one
 *  blank line on each side so it doesn't sit flush against the surrounding
 *  text — any blank line the template already had right after that label is
 *  absorbed first, so the gap below doesn't end up doubled against the one
 *  above. Appends at the end (same spacing) if the label isn't present —
 *  e.g. a Settings-customized template that dropped the Provisional
 *  Delivery Date field. */
function insertAfterLabelLine(text: string, label: string, line: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(label));
  if (i === -1) return `${text}\n\n${line}`;
  const before = lines.slice(0, i + 1);
  const after = lines.slice(i + 1);
  while (after.length && after[0].trim() === "") after.shift();
  return [...before, "", line, "", ...after].join("\n");
}

/** Wrap the plain-text body in the branded HTML shell. `boldHeadings` (the
 *  shipment status-update body, not the free-text reply) also bolds the
 *  first line — the customer's name, upper-cased — and the label on every
 *  "Label: value" line up to the sign-off (Shipment Status, Supplier Name,
 *  etc). The signature's own T:/WA:/F:/E:/Postal Address: labels get bold
 *  + brand-green styling either way. Pass `entity` (a Job or a Quote — both
 *  have `reference`) to insert the ExPac Motion Live Tracking button under
 *  Provisional Delivery Date (or, if that line isn't present — e.g. the
 *  Reply template — at the end). */
export function shipmentEmailHtml(
  text: string,
  boldHeadings = false,
  entity?: { reference: string },
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const joined = joinSignatureLines(text);
  const formatted = boldHeadings ? formatShipmentBody(joined, esc) : esc(joined);
  let body = linkifySignature(formatted);
  if (entity) {
    body = insertAfterLabelLine(
      body,
      TRACKING_ANCHOR_LABEL,
      emailButtonHtml(trackingUrl(entity), "ExPac Motion Live Tracking"),
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

/* ------------------------------------------------------------------ */
/*  Per-mode quotation-notification templates (Quotation Comms)       */
/* ------------------------------------------------------------------ */

const QUOTE_SEA_BODY = `{{ customer.name }}

Update for Quotation: {{ shipment.number }}
Supplier Name: {{ supplier.name }}
Customer Reference: {{ shipment.po }}
Shipped From: {{ shipment.shipped_from }}
${RULE}

Shipping Mode: {{ shipment.mode }}
Quotation Number: {{ shipment.number }}
Shipping Line: {{ shipment.shipping_line }}
Vessel Name: {{ shipment.vessel }}
Container Number: {{ shipment.container }}
Port of Load: {{ shipment.origin }}
Port of Discharge: {{ shipment.destination }}
Departure from Port of Load: {{ shipment.etd }}
Arrival at Port of Discharge: {{ shipment.eta }}
Provisional Delivery Date: {{ shipment.delivery_date }}
Quotation Status: {{ shipment.status }}
${RULE}

Remarks: {{ remarks }}

Thank you,
Support at EXPAC (ZAJNB)
${RULE}`;

const QUOTE_SHORT_BODY = `{{ customer.name }}

Notification for Quotation: {{ shipment.number }}
Supplier Name: {{ supplier.name }}
Customer Reference: {{ shipment.po }}
Shipped From: {{ shipment.shipped_from }}
${RULE}

Shipping Mode: {{ shipment.mode }}
Quotation Number: {{ shipment.number }}
Port of Load: {{ shipment.origin }}
Port of Discharge: {{ shipment.destination }}
Departure from Port of Load: {{ shipment.etd }}
Arrival at Port of Discharge: {{ shipment.eta }}
Provisional Delivery Date: {{ shipment.delivery_date }}
Quotation Status: {{ shipment.status }}
${RULE}

Remarks: {{ remarks }}

Thank you,
Support at EXPAC (ZAJNB)
${RULE}`;

/** Same shape as Shipment Comms, one status field swapped for the quote's
 *  own pipeline status (New Lead/Quote Sent/Quote Accepted/Completed/Not
 *  Proceeding) instead of a shipment milestone. */
export const DEFAULT_QUOTATION_COMMS: Record<
  ShipmentModeKey,
  ShipmentCommsTemplate
> = {
  sea: {
    subject: "Update for Quotation: {{ shipment.number }}",
    body: QUOTE_SEA_BODY,
  },
  air: {
    subject: "Notification for Quotation: {{ shipment.number }}",
    body: QUOTE_SHORT_BODY,
  },
  courier: {
    subject: "Notification for Quotation: {{ shipment.number }}",
    body: QUOTE_SHORT_BODY,
  },
  road: {
    subject: "Notification for Quotation: {{ shipment.number }}",
    body: QUOTE_SHORT_BODY,
  },
};

export function quotationCommsTemplate(
  key: ShipmentModeKey,
  config?: ShipmentCommsConfig | null,
): ShipmentCommsTemplate {
  return resolveTemplate(key, config, DEFAULT_QUOTATION_COMMS);
}

export function quotationReplyTemplate(
  key: ShipmentModeKey,
  config?: ShipmentCommsConfig | null,
): ShipmentCommsTemplate {
  return resolveTemplate(key, config, DEFAULT_QUOTATION_REPLIES);
}

const QUOTE_REPLY_TEMPLATE: ShipmentCommsTemplate = {
  subject: "Re: Quotation {{ shipment.number }}",
  body: REPLY_BODY,
};

export const DEFAULT_QUOTATION_REPLIES: Record<
  ShipmentModeKey,
  ShipmentCommsTemplate
> = {
  sea: QUOTE_REPLY_TEMPLATE,
  air: QUOTE_REPLY_TEMPLATE,
  courier: QUOTE_REPLY_TEMPLATE,
  road: QUOTE_REPLY_TEMPLATE,
};

/** Merge-code values for a quotation-notification email. Mirrors
 *  shipmentMergeContext, adapted for the fields that differ on a Quote:
 *  no po_no (uses customer_reference), MBL/AWB split across
 *  mawb_no/hawb_no/mbl_no/hbl_no instead of one awb_mbl column (same
 *  mode-aware fallback accept_quote() uses), a customer that may be a
 *  not-yet-promoted lead, and the quote's own pipeline status in place of
 *  a shipment milestone. */
export function quoteMergeContext(quote: Quote): MergeContext {
  const isAirOrCourier =
    quote.mode.startsWith("Air") || quote.mode.startsWith("Courier");
  const awb = isAirOrCourier
    ? quote.mawb_no || quote.hawb_no || ""
    : quote.mbl_no || quote.hbl_no || "";
  return {
    name:
      quote.lead?.contact ||
      quote.client?.company ||
      quote.lead?.company ||
      "Customer",
    customerName: quote.client?.company || quote.lead?.company || "Customer",
    company: quote.client?.company || quote.lead?.company || "",
    supplierName: quote.supplier?.company ?? "",
    poNumber: quote.customer_reference ?? "",
    customerReference: quote.customer_reference ?? "",
    shipmentNumber: quote.reference,
    quoteReference: quote.reference,
    shippedFrom: locodeCountry(quote.origin),
    mode: modeLabel(quote.mode),
    origin: quote.origin ?? "",
    destination: quote.destination ?? "",
    shippingLine: quote.shipping_line ?? "",
    vesselName: quote.vessel_name ?? "",
    containerNo: quote.container_no ?? "",
    carrierName: quote.carrier_name ?? "",
    awb,
    etd: d(quote.etd),
    eta: d(quote.eta),
    deliveryDate: d(quote.provisional_delivery_date),
    shipmentStatus: STATUS_LABEL[quote.status],
  };
}

/** Resolve a template against a quote + the operator's remarks. */
export function renderQuoteEmail(
  quote: Quote,
  tpl: ShipmentCommsTemplate,
  remarks: string,
): { subject: string; text: string } {
  const ctx = quoteMergeContext(quote);
  const resolvedRemarks = resolveMergeFields((remarks ?? "").trim(), ctx);
  return {
    subject: resolveMergeFields(tpl.subject, ctx).trim(),
    text: resolveMergeFields(tpl.body, { ...ctx, remarks: resolvedRemarks }),
  };
}

/**
 * Assemble the customer update email for a quotation, using the team's
 * per-mode template (Settings → Quotation Comms) or the built-in default.
 * Includes the ExPac Motion Live Tracking button under Provisional
 * Delivery Date, same as Shipment Comms — it deep-links by reference, so
 * it works once the quote is accepted and tracking data exists.
 */
export function buildQuoteCommsEmail(
  quote: Quote,
  remarks: string,
  config?: ShipmentCommsConfig | null,
): BuiltEmail {
  const tpl = quotationCommsTemplate(shipmentModeKey(quote.mode), config);
  const { subject, text } = renderQuoteEmail(quote, tpl, remarks);
  const textWithLink = insertAfterLabelLine(
    text,
    TRACKING_ANCHOR_LABEL,
    `Live Tracking: ${trackingUrl(quote)}`,
  );
  return {
    subject,
    text: textWithLink,
    html: shipmentEmailHtml(text, true, quote),
  };
}

/**
 * A quick chat-style reply within an existing thread (Settings →
 * Quotation Replies, or the built-in default) — just the operator's
 * message and signature, no quotation-data block.
 */
export function buildQuoteCommsReply(
  quote: Quote,
  remarks: string,
  config?: ShipmentCommsConfig | null,
): BuiltEmail {
  const tpl = quotationReplyTemplate(shipmentModeKey(quote.mode), config);
  const { subject, text } = renderQuoteEmail(quote, tpl, remarks);
  // No Provisional Delivery Date line in the Reply body, so this falls back
  // to appending at the end — same fallback shipmentEmailHtml uses below.
  const textWithLink = insertAfterLabelLine(
    text,
    TRACKING_ANCHOR_LABEL,
    `Live Tracking: ${trackingUrl(quote)}`,
  );
  return {
    subject,
    text: textWithLink,
    html: shipmentEmailHtml(text, false, quote),
  };
}
