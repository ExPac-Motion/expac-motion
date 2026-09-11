export function money(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return (
    "R " +
    v.toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function num(n: number | string | null | undefined): number {
  return Number(n) || 0;
}

/** Plain comma-grouped amount, no currency symbol — for a figure that isn't
 *  always in the same currency (e.g. Commercial Value). "—" when unset. */
export function plainAmount(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** USD amount, or "—" when unset. */
export function usd(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n) || 0;
  return (
    "$ " +
    v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** dd/mm/yyyy — the house date format used everywhere dates are displayed. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** dd/mm/yyyy HH:mm (24-hour). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)} ${hh}:${min}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return formatDate(iso);
}

/**
 * Reference prefix by transport mode: AIR (air freight), SEA (FCL/LCL),
 * RDX (road), CX (courier express).
 */
export function referencePrefix(mode: string | null | undefined): string {
  const m = (mode ?? "").toLowerCase();
  if (m.startsWith("sea")) return "SEA";
  if (m.startsWith("road")) return "RDX";
  if (m.startsWith("courier")) return "CX";
  return "AIR";
}

/** Auto-pattern for a generated reference (mode prefix + 6 digits, or legacy JOB). */
export const AUTO_REFERENCE = /^(AIR|SEA|RDX|CX|JOB)\d{6}$/;

/**
 * Local reference generator, e.g. AIR462193. The DB is the source of truth for
 * ids; the 6-digit sequence is unchanged, only the mode prefix varies.
 */
export function newReference(mode?: string | null): string {
  return referencePrefix(mode) + Date.now().toString().slice(-6);
}

export function todayPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Accept "www.acme.co.za" / "acme.co.za" as a website and return a
 * scheme-qualified URL, so an <a href> resolves absolutely rather than
 * relative to the app. Empty in -> null out; already-qualified left as-is.
 */
export function normalizeWebsite(
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
}

/**
 * Port code for the big FROM → TO line on the quotation. Expects a UN/LOCODE
 * (2-letter country + 3-char location, e.g. "CNSNZ", "ZAJNB") at the start of
 * the Origin/Destination text — "CNSNZ — Shenzhen, China" -> "CNSNZ". Falls back
 * to the first token capped at 5 chars.
 */
export function portCode(place: string | null | undefined): string {
  const s = (place ?? "").trim();
  if (!s) return "—";
  const locode = s.toUpperCase().match(/^([A-Z]{2})\s?([A-Z0-9]{3})\b/);
  if (locode) return locode[1] + locode[2];
  const first = s.split(/[\s,\-–—/]+/)[0] ?? s;
  return first.toUpperCase().slice(0, 5);
}

/**
 * App-wide naming for a generated/saved document: "<description> - <shipment
 * number>", e.g. docName("Quotation", "SEA174070") -> "Quotation - SEA174070".
 * No file extension — the caller (or the browser's Save dialog) adds it.
 */
export function docName(
  description: string,
  shipmentNumber: string | null | undefined,
): string {
  const ref = (shipmentNumber ?? "").trim();
  return ref ? `${description} - ${ref}` : description;
}

