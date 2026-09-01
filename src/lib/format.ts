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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local reference generator, e.g. JOB462193. The DB is the source of truth for ids. */
export function newReference(): string {
  return "JOB" + Date.now().toString().slice(-6);
}

export function todayPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
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

