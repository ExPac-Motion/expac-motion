// Nearest port code for whatever is typed in an Origin / Destination field:
// a full address ("13 Wilkinson Road, Freetown, Sierra Leone"), a city, an
// airport name with its IATA code ("Pune Airport (Lohegaon), PNQ") or a
// UN/LOCODE that doesn't suit the mode (ZAJNB on a sea quote).
//
// No outside lookups: the place is found by name in the curated LOCODES list
// (city first, else the country), then the closest seaport (sea freight) or
// airport (air / courier) is picked with the map coordinates in places.ts.

import { LOCODES, locodeLabel, type Locode } from "./locodes";
import { AIRPORT_COORDS, PORT_COORDS, placeOf } from "./places";

export type PortKind = "sea" | "air";

export interface PortSuggestion {
  code: string;
  /** "SLFNA, Freetown, Sierra Leone", what the quote field stores. */
  label: string;
  /** Short reason shown to the person, e.g. "nearest seaport to Johannesburg". */
  reason: string;
}

/** Air / courier quotes want an airport, sea quotes a seaport, road either. */
export function portKindForMode(mode: string | null | undefined): PortKind | null {
  const m = String(mode ?? "");
  if (m.startsWith("Air") || m.startsWith("Courier")) return "air";
  if (m.startsWith("Sea")) return "sea";
  return null;
}

const isSea = (l: Locode) => !!PORT_COORDS[l.code];
const isAir = (l: Locode) => !!AIRPORT_COORDS[l.code.slice(2)];
const hasKind = (l: Locode, k: PortKind | null) => k === null || (k === "sea" ? isSea(l) : isAir(l));

/** Lower case, no accents, single spaces: for name matching. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function hasWord(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
}

/** City names a LOCODE answers to: "Pune (Lohegaon Airport)" -> pune, lohegaon. */
function namesOf(l: Locode): string[] {
  const out = new Set<string>();
  const main = norm(l.city.replace(/\(.*?\)/g, ""));
  if (main) out.add(main);
  for (const m of l.city.matchAll(/\(([^)]+)\)/g)) {
    for (const part of m[1].split(/[/,]/)) {
      const n = norm(part.replace(/\b(airport|intl|international|port)\b/gi, ""));
      if (n) out.add(n);
    }
  }
  for (const part of l.city.replace(/\(.*?\)/g, "").split(/[/-]/)) {
    // "Ningbo-Zhoushan" answers to "Ningbo" too; not to "Port" or "Bay".
    const n = norm(part);
    if (n && !GENERIC.has(n)) out.add(n);
  }
  return [...out].filter((n) => n.length >= 4);
}
const GENERIC = new Set(["port", "bay", "city", "new", "island", "islands", "north", "south", "east", "west", "saint", "san", "santa"]);

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States",
  "u s a": "United States",
  "united states of america": "United States",
  america: "United States",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  uae: "United Arab Emirates",
  dubai: "United Arab Emirates",
  prc: "China",
  "p r china": "China",
  "peoples republic of china": "China",
  korea: "South Korea",
  "republic of korea": "South Korea",
  "ivory coast": "Cote d'Ivoire",
  drc: "DR Congo",
  "democratic republic of the congo": "DR Congo",
  "democratic republic of congo": "DR Congo",
  "the gambia": "Gambia",
  swaziland: "Eswatini",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  "viet nam": "Vietnam",
  turkiye: "Turkey",
  "cabo verde": "Cape Verde",
  rsa: "South Africa",
  "republic of south africa": "South Africa",
};

/** The country named in the text (longest match wins: "Guinea-Bissau" over "Guinea"). */
function countryIn(text: string): string | null {
  const names = new Map<string, string>();
  for (const l of LOCODES) names.set(norm(l.country), l.country);
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) names.set(alias, country);
  let best: string | null = null;
  let bestLen = 0;
  for (const [n, country] of names) {
    if (n.length > bestLen && hasWord(text, n)) {
      best = country;
      bestLen = n.length;
    }
  }
  return best;
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** The closest seaport / airport to a place; one in the same country wins
 *  unless it is much further (Johannesburg -> Durban, not Maputo). */
function nearestOfKind(from: Locode, kind: PortKind): Locode | null {
  const at = placeOf(from.code);
  if (!at) return null;
  let best: { l: Locode; d: number } | null = null;
  const home: { l: Locode; d: number }[] = [];
  for (const l of LOCODES) {
    if (!hasKind(l, kind)) continue;
    const p = placeOf(l.code);
    if (!p) continue;
    const d = km(at, p);
    if (!best || d < best.d) best = { l, d };
    if (l.country === from.country) home.push({ l, d });
  }
  if (home.length && best) {
    const closest = Math.min(...home.map((h) => h.d));
    if (closest <= Math.max(best.d * 1.6, best.d + 300)) {
      // Within 20% of the closest, the main port wins: the list puts each
      // country's main port first (Johannesburg -> Durban, not Richards Bay).
      return home.find((h) => h.d <= closest * 1.2)!.l;
    }
  }
  return best?.l ?? null;
}

function suggestion(l: Locode, reason: string): PortSuggestion {
  return { code: l.code, label: locodeLabel(l), reason };
}

const KIND_WORD: Record<PortKind, string> = { sea: "seaport", air: "airport" };

/**
 * The port code to suggest for this field text, or null when the text is
 * empty, already a suitable code, or names no place we know.
 */
export function suggestPort(raw: string | null | undefined, kind: PortKind | null): PortSuggestion | null {
  const text = String(raw ?? "").trim();
  if (text.length < 3) return null;
  const byCode = new Map(LOCODES.map((l) => [l.code, l]));

  // Already a known code at the front ("CNSHA, Shanghai, China").
  const lead = text.toUpperCase().match(/^[A-Z]{5}\b/)?.[0];
  const leadL = lead ? byCode.get(lead) : undefined;
  if (leadL && hasKind(leadL, kind)) return null;

  const t = norm(text);
  const country = countryIn(t);

  // 1. A place: a LOCODE or an IATA code written in the text, else a city name.
  let anchor: Locode | undefined = leadL;
  if (!anchor) {
    for (const tok of text.toUpperCase().match(/\b[A-Z]{5}\b/g) ?? []) {
      const l = byCode.get(tok);
      if (l) {
        anchor = l;
        break;
      }
    }
  }
  if (!anchor) {
    for (const tok of text.match(/\b[A-Z]{3}\b/g) ?? []) {
      const hits = LOCODES.filter((l) => isAir(l) && l.code.slice(2) === tok && (!country || l.country === country));
      if (hits.length === 1) {
        anchor = hits[0];
        break;
      }
    }
  }
  if (!anchor) {
    // Longest name wins; on a tie, the entry that suits the mode
    // ("Dubai" on an air quote -> AEDXB, not Jebel Ali).
    let bestScore = 0;
    for (const l of LOCODES) {
      if (country && l.country !== country) continue;
      for (const n of namesOf(l)) {
        const score = n.length * 2 + (hasKind(l, kind) ? 1 : 0);
        if (score > bestScore && hasWord(t, n)) {
          anchor = l;
          bestScore = score;
        }
      }
    }
  }
  const place = anchor ? anchor.city.replace(/\s*\(.*?\)/g, "") : null;

  // 2. No city: the country's main entry (the list puts the main port first).
  if (!anchor && country) {
    const inCountry = LOCODES.filter((l) => l.country === country);
    const main = inCountry.find((l) => hasKind(l, kind));
    if (main) return suggestion(main, kind ? `main ${KIND_WORD[kind]} in ${country}` : `main port in ${country}`);
    // Landlocked / no airport listed: nearest one from the country's first place.
    const from = inCountry.find((l) => placeOf(l.code));
    const near = from && kind ? nearestOfKind(from, kind) : null;
    return near ? suggestion(near, `nearest ${KIND_WORD[kind!]} to ${country}`) : null;
  }
  if (!anchor) return null;

  // 3. The place itself if it suits the mode, else the nearest that does.
  if (hasKind(anchor, kind)) return suggestion(anchor, `matches ${place}`);
  const near = kind ? nearestOfKind(anchor, kind) : null;
  if (near) return suggestion(near, `nearest ${KIND_WORD[kind!]} to ${place}`);
  return suggestion(anchor, `matches ${place}`);
}

/** For Motion AI: the field value from a code the AI gave and/or the text
 *  on the document. Falls back to the text when nothing is recognised. */
export function portFieldValue(code: string | null | undefined, text: string | null | undefined, kind: PortKind | null): string {
  const c = String(code ?? "").trim().toUpperCase();
  const known = LOCODES.find((l) => l.code === c);
  if (known && hasKind(known, kind)) return locodeLabel(known);
  const s = suggestPort(known ? locodeLabel(known) : (text ?? c), kind);
  if (s) return s.label;
  // A code we don't list: keep it at the front, as the quote builder asks.
  if (/^[A-Z]{5}$/.test(c)) return text ? `${c}, ${text}` : c;
  return text ?? "";
}
