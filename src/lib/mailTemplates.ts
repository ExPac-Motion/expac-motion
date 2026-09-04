import { COMPANY } from "./company";
import { formatDate } from "./format";
import { LOCODES } from "./locodes";
import type { Job, JobTracking } from "./types";

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

function line(label: string, value: string | null | undefined): string {
  return `${label}: ${value ? String(value) : ""}`;
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

/**
 * Assemble the customer update email for a shipment. Sea Freight gets the
 * fuller block (shipping line / vessel / container); Air / Road / Courier use
 * the shorter one. `remarks` is the operator's free-text message.
 */
export function buildShipmentEmail(
  job: Job,
  _tracking: JobTracking | undefined,
  remarks: string,
): BuiltEmail {
  const isSea = job.mode.startsWith("Sea");
  const heading = isSea
    ? `Update for Shipment: ${job.reference}`
    : `Notification for Shipment: ${job.reference}`;
  const subject = heading;

  const head = [
    job.client?.company ?? "Customer",
    "",
    heading,
    line("Supplier Name", job.supplier?.company),
    line("Purchase Order Number", job.po_no),
    line("Shipped From", locodeCountry(job.origin)),
    RULE,
    "",
  ];

  const detail = isSea
    ? [
        line("Shipping Mode", modeLabel(job.mode)),
        line("Shipment Number", job.reference),
        line("Shipping Line", job.shipping_line),
        line("Vessel Name", job.vessel_name),
        line("Container Number", job.container_no),
        line("Departure from Port of Load", d(job.etd)),
        line("Arrival at Port of Discharge", d(job.eta)),
        line("Provisional Delivery Date", d(job.provisional_delivery_date)),
        line("Shipment Status", job.shipment_status),
      ]
    : [
        line("Shipping Mode", modeLabel(job.mode)),
        line("Shipment Number", job.reference),
        line("Departure from Port of Load", d(job.etd)),
        line("Arrival at Port of Discharge", d(job.eta)),
        line("Provisional Delivery Date", d(job.provisional_delivery_date)),
        line("Shipment Status", job.shipment_status),
      ];

  const tail = [
    RULE,
    "",
    `Remarks: ${remarks.trim()}`,
    "",
    "Thank you,",
    "Support at EXPAC (ZAJNB)",
    RULE,
  ];

  const text = [...head, ...detail, ...tail].join("\n");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202426;line-height:1.55;max-width:640px">
  <img src="https://expac.co.za${COMPANY.logoPrint}" alt="EXPAC Forwarding" style="max-height:46px;margin-bottom:8px" />
  <div style="border-top:3px solid #8cbc43;margin:6px 0 14px"></div>
  <pre style="font-family:Arial,Helvetica,sans-serif;font-size:14px;white-space:pre-wrap;margin:0">${esc(text)}</pre>
</div>`;

  return { subject, text, html };
}
