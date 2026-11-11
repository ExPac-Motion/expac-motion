import { useEffect, useMemo, useState } from "react";

/**
 * Control Tower → World Clock. Every time is rendered by the browser's Intl
 * engine against an IANA zone, so daylight-saving switches (Europe, the US,
 * Sydney, Auckland, Egypt…) are applied automatically, no hard-coded offsets.
 *
 * Features: digital home clock, "plan a time" slider (every clock moves with
 * it), best-time-to-call heat strip for pinned locations, every US state and
 * territory mapped to its time zone (split states flagged), pin any city /
 * state / IANA zone to "My board", 12h/24h toggle, open-now filter.
 */

interface Entry {
  id: string;
  label: string;
  sub: string;
  zone: string;
  note?: string;
}
interface City {
  city: string;
  country: string;
  zone: string;
}
interface Region {
  name: string;
  cities: City[];
}

const HOME: City = { city: "Johannesburg", country: "South Africa", zone: "Africa/Johannesburg" };

const REGIONS: Region[] = [
  {
    name: "Africa",
    cities: [
      HOME,
      { city: "Nairobi", country: "Kenya", zone: "Africa/Nairobi" },
      { city: "Lagos", country: "Nigeria", zone: "Africa/Lagos" },
      { city: "Cairo", country: "Egypt", zone: "Africa/Cairo" },
      { city: "Casablanca", country: "Morocco", zone: "Africa/Casablanca" },
      { city: "Accra", country: "Ghana", zone: "Africa/Accra" },
      { city: "Dar es Salaam", country: "Tanzania", zone: "Africa/Dar_es_Salaam" },
      { city: "Luanda", country: "Angola", zone: "Africa/Luanda" },
      { city: "Port Louis", country: "Mauritius", zone: "Indian/Mauritius" },
    ],
  },
  {
    name: "Europe",
    cities: [
      { city: "London", country: "United Kingdom", zone: "Europe/London" },
      { city: "Rotterdam", country: "Netherlands", zone: "Europe/Amsterdam" },
      { city: "Hamburg", country: "Germany", zone: "Europe/Berlin" },
      { city: "Antwerp", country: "Belgium", zone: "Europe/Brussels" },
      { city: "Paris", country: "France", zone: "Europe/Paris" },
      { city: "Madrid", country: "Spain", zone: "Europe/Madrid" },
      { city: "Milan", country: "Italy", zone: "Europe/Rome" },
      { city: "Lisbon", country: "Portugal", zone: "Europe/Lisbon" },
      { city: "Warsaw", country: "Poland", zone: "Europe/Warsaw" },
      { city: "Athens", country: "Greece", zone: "Europe/Athens" },
      { city: "Istanbul", country: "Türkiye", zone: "Europe/Istanbul" },
      { city: "Moscow", country: "Russia", zone: "Europe/Moscow" },
    ],
  },
  {
    name: "Middle East & South Asia",
    cities: [
      { city: "Dubai", country: "United Arab Emirates", zone: "Asia/Dubai" },
      { city: "Riyadh", country: "Saudi Arabia", zone: "Asia/Riyadh" },
      { city: "Doha", country: "Qatar", zone: "Asia/Qatar" },
      { city: "Tel Aviv", country: "Israel", zone: "Asia/Jerusalem" },
      { city: "Karachi", country: "Pakistan", zone: "Asia/Karachi" },
      { city: "Mumbai", country: "India", zone: "Asia/Kolkata" },
      { city: "Colombo", country: "Sri Lanka", zone: "Asia/Colombo" },
      { city: "Dhaka", country: "Bangladesh", zone: "Asia/Dhaka" },
    ],
  },
  {
    name: "Asia",
    cities: [
      { city: "Shanghai", country: "China", zone: "Asia/Shanghai" },
      { city: "Hong Kong", country: "Hong Kong SAR", zone: "Asia/Hong_Kong" },
      { city: "Singapore", country: "Singapore", zone: "Asia/Singapore" },
      { city: "Ho Chi Minh City", country: "Vietnam", zone: "Asia/Ho_Chi_Minh" },
      { city: "Bangkok", country: "Thailand", zone: "Asia/Bangkok" },
      { city: "Jakarta", country: "Indonesia", zone: "Asia/Jakarta" },
      { city: "Kuala Lumpur", country: "Malaysia", zone: "Asia/Kuala_Lumpur" },
      { city: "Manila", country: "Philippines", zone: "Asia/Manila" },
      { city: "Taipei", country: "Taiwan", zone: "Asia/Taipei" },
      { city: "Seoul", country: "South Korea", zone: "Asia/Seoul" },
      { city: "Tokyo", country: "Japan", zone: "Asia/Tokyo" },
    ],
  },
  {
    name: "Oceania",
    cities: [
      { city: "Sydney", country: "Australia", zone: "Australia/Sydney" },
      { city: "Perth", country: "Australia", zone: "Australia/Perth" },
      { city: "Auckland", country: "New Zealand", zone: "Pacific/Auckland" },
    ],
  },
  {
    name: "Americas",
    cities: [
      { city: "Toronto", country: "Canada", zone: "America/Toronto" },
      { city: "Vancouver", country: "Canada", zone: "America/Vancouver" },
      { city: "Mexico City", country: "Mexico", zone: "America/Mexico_City" },
      { city: "Bogotá", country: "Colombia", zone: "America/Bogota" },
      { city: "Lima", country: "Peru", zone: "America/Lima" },
      { city: "Santiago", country: "Chile", zone: "America/Santiago" },
      { city: "Buenos Aires", country: "Argentina", zone: "America/Argentina/Buenos_Aires" },
      { city: "São Paulo", country: "Brazil", zone: "America/Sao_Paulo" },
    ],
  },
];

/* ---------------- United States ---------------- */

type ZoneKey = "ET" | "CT" | "MT" | "AZ" | "PT" | "AK" | "HT" | "AT" | "CH" | "SM";

interface UsZone {
  key: ZoneKey;
  name: string;
  zone: string;
  blurb?: string;
  cities: { city: string; state: string }[];
}

const US_ZONES: UsZone[] = [
  {
    key: "ET",
    name: "Eastern",
    zone: "America/New_York",
    blurb: "East Coast: NY / NJ ports, Southeast",
    cities: [
      { city: "New York", state: "NY" },
      { city: "Newark", state: "NJ" },
      { city: "Philadelphia", state: "PA" },
      { city: "Baltimore", state: "MD" },
      { city: "Atlanta", state: "GA" },
      { city: "Savannah", state: "GA" },
      { city: "Charleston", state: "SC" },
      { city: "Miami", state: "FL" },
      { city: "Detroit", state: "MI" },
    ],
  },
  {
    key: "CT",
    name: "Central",
    zone: "America/Chicago",
    blurb: "Midwest, Texas Gulf, Mississippi valley",
    cities: [
      { city: "Chicago", state: "IL" },
      { city: "Houston", state: "TX" },
      { city: "Dallas", state: "TX" },
      { city: "Memphis", state: "TN" },
      { city: "Nashville", state: "TN" },
      { city: "New Orleans", state: "LA" },
      { city: "Kansas City", state: "MO" },
      { city: "Minneapolis", state: "MN" },
    ],
  },
  {
    key: "MT",
    name: "Mountain",
    zone: "America/Denver",
    blurb: "Rockies (observes DST)",
    cities: [
      { city: "Denver", state: "CO" },
      { city: "Salt Lake City", state: "UT" },
      { city: "Albuquerque", state: "NM" },
      { city: "El Paso", state: "TX" },
      { city: "Boise", state: "ID" },
    ],
  },
  {
    key: "AZ",
    name: "Arizona",
    zone: "America/Phoenix",
    blurb: "Mountain Standard all year, no DST (matches Pacific in summer)",
    cities: [
      { city: "Phoenix", state: "AZ" },
      { city: "Tucson", state: "AZ" },
    ],
  },
  {
    key: "PT",
    name: "Pacific",
    zone: "America/Los_Angeles",
    blurb: "West Coast: LA / Long Beach, Oakland, Seattle",
    cities: [
      { city: "Los Angeles", state: "CA" },
      { city: "Long Beach", state: "CA" },
      { city: "San Francisco", state: "CA" },
      { city: "Oakland", state: "CA" },
      { city: "San Diego", state: "CA" },
      { city: "Seattle", state: "WA" },
      { city: "Portland", state: "OR" },
      { city: "Las Vegas", state: "NV" },
    ],
  },
  {
    key: "AK",
    name: "Alaska",
    zone: "America/Anchorage",
    cities: [
      { city: "Anchorage", state: "AK" },
      { city: "Juneau", state: "AK" },
    ],
  },
  {
    key: "HT",
    name: "Hawaii",
    zone: "Pacific/Honolulu",
    blurb: "No DST",
    cities: [{ city: "Honolulu", state: "HI" }],
  },
  {
    key: "AT",
    name: "Atlantic",
    zone: "America/Puerto_Rico",
    blurb: "Territories, no DST",
    cities: [{ city: "San Juan", state: "PR" }],
  },
  {
    key: "CH",
    name: "Chamorro",
    zone: "Pacific/Guam",
    blurb: "Territories, no DST",
    cities: [{ city: "Hagåtña", state: "GU" }],
  },
  {
    key: "SM",
    name: "Samoa",
    zone: "Pacific/Pago_Pago",
    blurb: "Territory, no DST",
    cities: [{ city: "Pago Pago", state: "AS" }],
  },
];

interface UsState {
  abbr: string;
  name: string;
  zone: ZoneKey;
  /** Second zone used in part of the state. */
  also?: ZoneKey;
  note?: string;
  territory?: boolean;
}

const US_STATES: UsState[] = [
  { abbr: "AL", name: "Alabama", zone: "CT" },
  { abbr: "AK", name: "Alaska", zone: "AK", note: "Western Aleutian Islands use Hawaii–Aleutian time" },
  { abbr: "AZ", name: "Arizona", zone: "AZ", also: "MT", note: "No DST, except the Navajo Nation (follows Mountain DST)" },
  { abbr: "AR", name: "Arkansas", zone: "CT" },
  { abbr: "CA", name: "California", zone: "PT" },
  { abbr: "CO", name: "Colorado", zone: "MT" },
  { abbr: "CT", name: "Connecticut", zone: "ET" },
  { abbr: "DE", name: "Delaware", zone: "ET" },
  { abbr: "DC", name: "District of Columbia", zone: "ET" },
  { abbr: "FL", name: "Florida", zone: "ET", also: "CT", note: "Panhandle west of the Apalachicola River (Pensacola) is Central" },
  { abbr: "GA", name: "Georgia", zone: "ET" },
  { abbr: "HI", name: "Hawaii", zone: "HT" },
  { abbr: "ID", name: "Idaho", zone: "MT", also: "PT", note: "Northern panhandle (Coeur d'Alene) is Pacific" },
  { abbr: "IL", name: "Illinois", zone: "CT" },
  { abbr: "IN", name: "Indiana", zone: "ET", also: "CT", note: "NW corner (Gary) and SW corner (Evansville) are Central" },
  { abbr: "IA", name: "Iowa", zone: "CT" },
  { abbr: "KS", name: "Kansas", zone: "CT", also: "MT", note: "Four western border counties are Mountain" },
  { abbr: "KY", name: "Kentucky", zone: "ET", also: "CT", note: "Western half (Bowling Green, Paducah) is Central" },
  { abbr: "LA", name: "Louisiana", zone: "CT" },
  { abbr: "ME", name: "Maine", zone: "ET" },
  { abbr: "MD", name: "Maryland", zone: "ET" },
  { abbr: "MA", name: "Massachusetts", zone: "ET" },
  { abbr: "MI", name: "Michigan", zone: "ET", also: "CT", note: "Four Upper Peninsula counties bordering Wisconsin are Central" },
  { abbr: "MN", name: "Minnesota", zone: "CT" },
  { abbr: "MS", name: "Mississippi", zone: "CT" },
  { abbr: "MO", name: "Missouri", zone: "CT" },
  { abbr: "MT", name: "Montana", zone: "MT" },
  { abbr: "NE", name: "Nebraska", zone: "CT", also: "MT", note: "Western panhandle is Mountain" },
  { abbr: "NV", name: "Nevada", zone: "PT", also: "MT", note: "West Wendover is Mountain" },
  { abbr: "NH", name: "New Hampshire", zone: "ET" },
  { abbr: "NJ", name: "New Jersey", zone: "ET" },
  { abbr: "NM", name: "New Mexico", zone: "MT" },
  { abbr: "NY", name: "New York", zone: "ET" },
  { abbr: "NC", name: "North Carolina", zone: "ET" },
  { abbr: "ND", name: "North Dakota", zone: "CT", also: "MT", note: "South-west corner is Mountain" },
  { abbr: "OH", name: "Ohio", zone: "ET" },
  { abbr: "OK", name: "Oklahoma", zone: "CT" },
  { abbr: "OR", name: "Oregon", zone: "PT", also: "MT", note: "Most of Malheur County is Mountain" },
  { abbr: "PA", name: "Pennsylvania", zone: "ET" },
  { abbr: "RI", name: "Rhode Island", zone: "ET" },
  { abbr: "SC", name: "South Carolina", zone: "ET" },
  { abbr: "SD", name: "South Dakota", zone: "CT", also: "MT", note: "Western half (Rapid City) is Mountain" },
  { abbr: "TN", name: "Tennessee", zone: "CT", also: "ET", note: "East Tennessee (Knoxville, Chattanooga) is Eastern" },
  { abbr: "TX", name: "Texas", zone: "CT", also: "MT", note: "El Paso and Hudspeth counties are Mountain" },
  { abbr: "UT", name: "Utah", zone: "MT" },
  { abbr: "VT", name: "Vermont", zone: "ET" },
  { abbr: "VA", name: "Virginia", zone: "ET" },
  { abbr: "WA", name: "Washington", zone: "PT" },
  { abbr: "WV", name: "West Virginia", zone: "ET" },
  { abbr: "WI", name: "Wisconsin", zone: "CT" },
  { abbr: "WY", name: "Wyoming", zone: "MT" },
  { abbr: "PR", name: "Puerto Rico", zone: "AT", territory: true },
  { abbr: "VI", name: "U.S. Virgin Islands", zone: "AT", territory: true },
  { abbr: "GU", name: "Guam", zone: "CH", territory: true },
  { abbr: "MP", name: "Northern Mariana Islands", zone: "CH", territory: true },
  { abbr: "AS", name: "American Samoa", zone: "SM", territory: true },
];

const US_ZONE_BY_KEY = new Map(US_ZONES.map((z) => [z.key, z]));
const STATE_BY_ABBR = new Map(US_STATES.map((s) => [s.abbr, s]));

/* ---------------- entries (anything that can be a clock) ---------------- */

const cityId = (zone: string, city: string) => `city:${zone}:${city}`;

const US_CITY_ENTRIES: Entry[] = US_ZONES.flatMap((z) =>
  z.cities.map((c) => ({
    id: cityId(z.zone, c.city),
    label: c.city,
    sub: `${STATE_BY_ABBR.get(c.state)?.name ?? c.state}, USA · ${z.name}`,
    zone: z.zone,
  })),
);

const WORLD_GROUPS: { name: string; entries: Entry[] }[] = [
  ...REGIONS.slice(0, 5).map((r) => ({
    name: r.name,
    entries: r.cities.map((c) => ({ id: cityId(c.zone, c.city), label: c.city, sub: c.country, zone: c.zone })),
  })),
  { name: "United States", entries: US_CITY_ENTRIES },
  {
    name: "Americas",
    entries: REGIONS[5].cities.map((c) => ({ id: cityId(c.zone, c.city), label: c.city, sub: c.country, zone: c.zone })),
  },
];

const STATE_ENTRIES: Entry[] = US_STATES.map((s) => {
  const z = US_ZONE_BY_KEY.get(s.zone)!;
  return {
    id: `state:${s.abbr}`,
    label: s.name,
    sub: `${s.territory ? "US territory" : "USA"} · ${z.name} time`,
    zone: z.zone,
    note: s.note,
  };
});

const ZONE_ENTRIES: Entry[] = US_ZONES.map((z) => ({
  id: `uszone:${z.key}`,
  label: `US ${z.name}`,
  sub: "United States time zone",
  zone: z.zone,
  note: z.blurb,
}));

const HOME_ID = cityId(HOME.zone, HOME.city);
const ALL_ENTRIES: Entry[] = [...WORLD_GROUPS.flatMap((g) => g.entries), ...STATE_ENTRIES, ...ZONE_ENTRIES];
const ENTRY_BY_ID = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

function tzEntry(zone: string): Entry {
  const last = zone.split("/").pop() ?? zone;
  return { id: `tz:${zone}`, label: last.replace(/_/g, " "), sub: zone, zone };
}
function resolveEntry(id: string): Entry | undefined {
  return ENTRY_BY_ID.get(id) ?? (id.startsWith("tz:") ? tzEntry(id.slice(3)) : undefined);
}

const IANA_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

/* ---------------- time maths ---------------- */

/** Office hours used for the Open / Closed badge (local time, Mon–Fri). */
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

const abbrCache = new Map<string, Intl.DateTimeFormat>();
/** Short zone name like "EST" / "EDT" / "PST"; null when Intl only knows "GMT+x". */
function zoneAbbr(zone: string, at: Date): string | null {
  let f = abbrCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    abbrCache.set(zone, f);
  }
  const name = f.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  return name && !/^(GMT|UTC)/.test(name) ? name : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function zoneParts(zone: string, at: Date): ZoneParts {
  const p: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(at)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** Minutes east of UTC for `zone` at instant `at`. */
function offsetMinutes(zone: string, at: Date): number {
  const z = zoneParts(zone, at);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Standard (non-DST) offset = the smaller of the January and July offsets. */
function isDst(zone: string, at: Date): boolean {
  const y = at.getUTCFullYear();
  const jan = offsetMinutes(zone, new Date(Date.UTC(y, 0, 1)));
  const jul = offsetMinutes(zone, new Date(Date.UTC(y, 6, 1)));
  return jan !== jul && offsetMinutes(zone, at) > Math.min(jan, jul);
}

/** Next daylight-saving change within ~13 months, to the day. */
function nextTransition(zone: string, from: Date): { at: Date; from: number; to: number } | null {
  const DAY = 86_400_000;
  const start = offsetMinutes(zone, from);
  let prev = start;
  for (let d = 1; d <= 400; d++) {
    const t = new Date(from.getTime() + d * DAY);
    const off = offsetMinutes(zone, t);
    if (off !== prev) return { at: t, from: prev, to: off };
    prev = off;
  }
  return null;
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

function fmtDiff(min: number): string {
  if (min === 0) return "Same as SAST";
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h}h${m ? ` ${m}m` : ""} vs SAST`;
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const pad = (n: number) => String(n).padStart(2, "0");

function fmtHM(hour: number, minute: number, h12: boolean): { hm: string; ampm: string } {
  if (!h12) return { hm: `${pad(hour)}:${pad(minute)}`, ampm: "" };
  return { hm: `${pad(hour % 12 || 12)}:${pad(minute)}`, ampm: hour < 12 ? "AM" : "PM" };
}

interface BizStatus {
  open: boolean;
  soon: boolean;
  label: string;
}
function bizStatus(z: ZoneParts): BizStatus {
  const nowMin = z.hour * 60 + z.minute;
  const weekday = z.weekday >= 1 && z.weekday <= 5;
  if (weekday && nowMin >= OPEN_HOUR * 60 && nowMin < CLOSE_HOUR * 60) {
    const left = CLOSE_HOUR * 60 - nowMin;
    return { open: true, soon: left <= 60, label: `Closes in ${fmtDur(left)}` };
  }
  for (let d = 0; d <= 7; d++) {
    const wd = (z.weekday + d) % 7;
    if (wd < 1 || wd > 5) continue;
    const mins = d * 1440 + OPEN_HOUR * 60 - nowMin;
    if (mins > 0) {
      return {
        open: false,
        soon: mins <= 60,
        label: mins < 1440 ? `Opens in ${fmtDur(mins)}` : `Opens ${WEEKDAYS[wd]} ${pad(OPEN_HOUR)}:00`,
      };
    }
  }
  return { open: false, soon: false, label: "Closed" };
}

function isOpenAt(zone: string, at: Date): boolean {
  return bizStatus(zoneParts(zone, at)).open;
}

/* ---------------- hooks ---------------- */

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align ticks to the start of each second so every clock flips together.
    let id: number;
    const tick = () => {
      setNow(new Date());
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    id = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(id);
  }, []);
  return now;
}

/** Per-viewer preference kept in localStorage; works (unsaved) if storage is blocked. */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setVal(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable: keep in memory only */
    }
  };
  return [val, set];
}

/* ---------------- pieces ---------------- */

/** 24h local-day strip: night / business hours band / now marker. */
function DayStrip({ z }: { z: ZoneParts }) {
  const weekend = z.weekday === 0 || z.weekday === 6;
  const pos = ((z.hour * 60 + z.minute) / 1440) * 100;
  return (
    <div className={`wc-strip${weekend ? " weekend" : ""}`} aria-hidden>
      <span className="wc-strip-biz" style={{ left: `${(OPEN_HOUR / 24) * 100}%`, width: `${((CLOSE_HOUR - OPEN_HOUR) / 24) * 100}%` }} />
      <span className="wc-strip-now" style={{ left: `${pos}%` }} />
    </div>
  );
}

interface CardProps {
  e: Entry;
  at: Date;
  homeOffset: number;
  h12: boolean;
  live: boolean;
  home?: boolean;
  pinned?: boolean;
  onPin?: () => void;
}

function ClockCard({ e, at, homeOffset, h12, live, home, pinned, onPin }: CardProps) {
  const z = zoneParts(e.zone, at);
  const off = offsetMinutes(e.zone, at);
  const dst = isDst(e.zone, at);
  const st = bizStatus(z);
  const night = z.hour < 6 || z.hour >= 20;
  const abbr = zoneAbbr(e.zone, at);
  const t = fmtHM(z.hour, z.minute, h12);

  return (
    <div className={`wc-card${home ? " home" : ""}${night ? " night" : ""}${pinned ? " pinned" : ""}`}>
      <div className="wc-top">
        <div className="wc-name">
          <div className="wc-city">{e.label}</div>
          <div className="wc-country">{e.sub}</div>
        </div>
        {onPin && (
          <button
            type="button"
            className={`wc-pin${pinned ? " on" : ""}`}
            onClick={onPin}
            title={pinned ? "Remove from My board" : "Pin to My board"}
            aria-label={pinned ? `Unpin ${e.label}` : `Pin ${e.label}`}
            aria-pressed={pinned}
          >
            {pinned ? "★" : "☆"}
          </button>
        )}
      </div>
      <div className="wc-time">
        {t.hm}
        {live && <span className="wc-sec">:{pad(z.second)}</span>}
        {t.ampm && <span className="wc-ampm">{t.ampm}</span>}
      </div>
      <div className="wc-date">
        {WEEKDAYS[z.weekday]} {z.day} {MONTHS[z.month - 1]}
        {abbr && <span className="wc-abbr">{abbr}</span>}
      </div>
      <DayStrip z={z} />
      <div className="wc-status">
        <span className={`wc-badge ${st.open ? (st.soon ? "soon" : "open") : "closed"}`}>
          {st.open ? "Open" : "Closed"}
        </span>
        <span className="wc-status-label">{st.label}</span>
      </div>
      <div className="wc-meta">
        <span>
          {fmtOffset(off)}
          {dst ? " · DST" : ""}
        </span>
        <span>{home ? "Home office" : fmtDiff(off - homeOffset)}</span>
      </div>
      {e.note && <div className="wc-note">{e.note}</div>}
    </div>
  );
}

/** Next 24 hours, hour by hour: how many target locations are in office hours. */
function CallPlanner({
  now,
  targets,
  fallback,
  shiftMin,
  setShift,
  h12,
}: {
  now: Date;
  targets: Entry[];
  fallback: boolean;
  shiftMin: number;
  setShift: (m: number) => void;
  h12: boolean;
}) {
  const hourStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const slots = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(hourStart + i * 3_600_000);
    const openList = targets.filter((e) => isOpenAt(e.zone, t));
    const zh = zoneParts(HOME.zone, t);
    return { i, t, openList, homeOpen: isOpenAt(HOME.zone, t), label: fmtHM(zh.hour, 0, h12), weekday: zh.weekday };
  });
  const planned = now.getTime() + shiftMin * 60_000;
  const total = targets.length || 1;

  return (
    <div className="wc-planner">
      <div className="wc-planner-head">
        <strong>Best time to call</strong>
        <span>
          {fallback
            ? "Pin locations (☆) to plan around your own suppliers. Showing the main US zones meanwhile."
            : `Next 24 hours (SAST) vs ${targets.length} pinned location${targets.length === 1 ? "" : "s"}.`}{" "}
          Click an hour to preview it.
        </span>
      </div>
      <div className="wc-heat" role="list">
        {slots.map((s) => {
          const share = s.openList.length / total;
          const best = s.homeOpen && s.openList.length === targets.length && targets.length > 0;
          const sel = shiftMin !== 0 && planned >= s.t.getTime() && planned < s.t.getTime() + 3_600_000;
          const title = `${WEEKDAYS[s.weekday]} ${s.label.hm}${s.label.ampm ? ` ${s.label.ampm}` : ""} SAST · ${
            s.homeOpen ? "JHB open" : "JHB closed"
          } · ${s.openList.length}/${targets.length} open${s.openList.length ? `: ${s.openList.map((e) => e.label).join(", ")}` : ""}`;
          return (
            <button
              key={s.i}
              type="button"
              role="listitem"
              className={`wc-heat-cell${s.homeOpen ? " home-open" : ""}${best ? " best" : ""}${sel ? " sel" : ""}`}
              style={{ ["--share" as string]: share }}
              title={title}
              aria-label={title}
              onClick={() => setShift(s.i === 0 ? 0 : Math.ceil((s.t.getTime() - now.getTime()) / 60_000))}
            >
              <span className="wc-heat-bar" />
              <span className="wc-heat-label">{h12 ? `${parseInt(s.label.hm, 10)}${s.label.ampm[0].toLowerCase()}` : s.label.hm.slice(0, 2)}</span>
            </button>
          );
        })}
      </div>
      <div className="wc-heat-legend">
        <span><i className="lg-bar" /> share of locations open</span>
        <span><i className="lg-home" /> Johannesburg office open</span>
        <span><i className="lg-best" /> everyone open</span>
      </div>
    </div>
  );
}

function UsZoneCard({
  z,
  at,
  homeOffset,
  h12,
  live,
  term,
  pins,
  togglePin,
  transition,
}: {
  z: UsZone;
  at: Date;
  homeOffset: number;
  h12: boolean;
  live: boolean;
  term: string;
  pins: string[];
  togglePin: (id: string) => void;
  transition: { at: Date; from: number; to: number } | null;
}) {
  const p = zoneParts(z.zone, at);
  const off = offsetMinutes(z.zone, at);
  const st = bizStatus(p);
  const abbr = zoneAbbr(z.zone, at);
  const t = fmtHM(p.hour, p.minute, h12);
  const primary = US_STATES.filter((s) => s.zone === z.key);
  const partial = US_STATES.filter((s) => s.also === z.key);
  const matches = (s: UsState) =>
    !!term && (s.name.toLowerCase().includes(term) || s.abbr.toLowerCase() === term);
  const anyMatch =
    !term ||
    [...primary, ...partial].some(matches) ||
    z.name.toLowerCase().includes(term) ||
    z.cities.some((c) => c.city.toLowerCase().includes(term));
  const zoneId = `uszone:${z.key}`;

  return (
    <div className={`wc-us${anyMatch ? "" : " dim"}${p.hour < 6 || p.hour >= 20 ? " night" : ""}`}>
      <div className="wc-us-head">
        <div>
          <div className="wc-us-name">
            {z.name}
            {abbr && <span className="wc-abbr">{abbr}</span>}
          </div>
          {z.blurb && <div className="wc-country">{z.blurb}</div>}
        </div>
        <button
          type="button"
          className={`wc-pin${pins.includes(zoneId) ? " on" : ""}`}
          onClick={() => togglePin(zoneId)}
          title={pins.includes(zoneId) ? "Remove from My board" : "Pin this zone to My board"}
          aria-pressed={pins.includes(zoneId)}
        >
          {pins.includes(zoneId) ? "★" : "☆"}
        </button>
      </div>
      <div className="wc-time">
        {t.hm}
        {live && <span className="wc-sec">:{pad(p.second)}</span>}
        {t.ampm && <span className="wc-ampm">{t.ampm}</span>}
      </div>
      <div className="wc-date">
        {WEEKDAYS[p.weekday]} {p.day} {MONTHS[p.month - 1]} · {fmtOffset(off)} · {fmtDiff(off - homeOffset)}
      </div>
      <DayStrip z={p} />
      <div className="wc-status">
        <span className={`wc-badge ${st.open ? (st.soon ? "soon" : "open") : "closed"}`}>{st.open ? "Open" : "Closed"}</span>
        <span className="wc-status-label">{st.label}</span>
      </div>
      {transition && (
        <div className="wc-dst-next">
          Clocks change {WEEKDAYS[transition.at.getUTCDay()]} {transition.at.getUTCDate()} {MONTHS[transition.at.getUTCMonth()]}: gap
          to SAST becomes {fmtDiff(transition.to - offsetMinutes(HOME.zone, transition.at)).replace(" vs SAST", "")}
        </div>
      )}

      <div className="wc-us-sec">Cities</div>
      <div className="wc-chips">
        {z.cities.map((c) => {
          const id = cityId(z.zone, c.city);
          const on = pins.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`wc-chip${on ? " on" : ""}${term && c.city.toLowerCase().includes(term) ? " hit" : ""}`}
              onClick={() => togglePin(id)}
              title={on ? "Unpin" : "Pin to My board"}
            >
              {c.city}, {c.state}
            </button>
          );
        })}
      </div>

      {primary.length > 0 && (
        <>
          <div className="wc-us-sec">States ({primary.length})</div>
          <div className="wc-chips">
            {primary.map((s) => {
              const id = `state:${s.abbr}`;
              const on = pins.includes(id);
              return (
                <button
                  key={s.abbr}
                  type="button"
                  className={`wc-chip state${on ? " on" : ""}${matches(s) ? " hit" : ""}${s.also ? " split" : ""}`}
                  onClick={() => togglePin(id)}
                  title={`${s.name}${s.note ? `: ${s.note}` : ""} (click to ${on ? "unpin" : "pin"})`}
                >
                  {s.name}
                  {s.also ? " *" : ""}
                </button>
              );
            })}
          </div>
        </>
      )}
      {partial.length > 0 && (
        <>
          <div className="wc-us-sec">Partly in this zone</div>
          <div className="wc-chips">
            {partial.map((s) => (
              <span key={s.abbr} className={`wc-chip partial${matches(s) ? " hit" : ""}`} title={s.note}>
                {s.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- main ---------------- */

type Tab = "board" | "world" | "usa";

export default function WorldClock() {
  const now = useNow();
  const [shiftMin, setShift] = useState(0);
  const [h12, setH12] = useStored<boolean>("wc:h12", false);
  const [pins, setPins] = useStored<string[]>("wc:pins", []);
  const [tab, setTab] = useStored<Tab>("wc:tab", "world");
  const [openOnly, setOpenOnly] = useState(false);
  const [q, setQ] = useState("");
  const [addZone, setAddZone] = useState("");

  const live = shiftMin === 0;
  const at = live ? now : new Date(now.getTime() + shiftMin * 60_000);
  const homeOffset = offsetMinutes(HOME.zone, at);
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const term = q.trim().toLowerCase();

  const togglePin = (id: string) => setPins(pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);
  const pinnedEntries = pins.map(resolveEntry).filter((e): e is Entry => !!e && e.id !== HOME_ID);

  // DST transitions only change daily; recompute once per day, not every tick.
  const dayKey = now.toISOString().slice(0, 10);
  const transitions = useMemo(() => {
    const from = new Date(`${dayKey}T12:00:00Z`);
    return new Map(US_ZONES.map((z) => [z.key, nextTransition(z.zone, from)]));
  }, [dayKey]);

  const plannerTargets = pinnedEntries.length
    ? pinnedEntries
    : ["ET", "CT", "MT", "PT"].map((k) => ZONE_ENTRIES.find((e) => e.id === `uszone:${k}`)!);

  const passOpen = (e: Entry) => !openOnly || isOpenAt(e.zone, at);

  // Global search: cities, every US state / territory, any IANA zone.
  const results: Entry[] = useMemo(() => {
    if (!term) return [];
    const hit = (e: Entry) => [e.label, e.sub, e.zone].some((v) => v.toLowerCase().includes(term));
    const stateHits = STATE_ENTRIES.filter(
      (e) => hit(e) || e.id.slice(6).toLowerCase() === term,
    );
    const cityHits = WORLD_GROUPS.flatMap((g) =>
      g.entries.filter((e) => hit(e) || g.name.toLowerCase().includes(term)),
    );
    const zoneHits = ZONE_ENTRIES.filter(hit);
    const known = new Set([...stateHits, ...cityHits, ...zoneHits].map((e) => e.zone));
    const tzHits =
      term.length >= 3
        ? IANA_ZONES.filter((z) => z.toLowerCase().replace(/_/g, " ").includes(term) && !known.has(z))
            .slice(0, 8)
            .map(tzEntry)
        : [];
    const seen = new Set<string>();
    return [...stateHits, ...zoneHits, ...cityHits, ...tzHits].filter((e) => !seen.has(e.id) && !!seen.add(e.id));
  }, [term]);

  const homeZ = zoneParts(HOME.zone, at);
  const homeT = fmtHM(homeZ.hour, homeZ.minute, h12);
  const homeSt = bizStatus(homeZ);
  const usOpen = US_ZONES.slice(0, 5).filter((z) => isOpenAt(z.zone, at)).length;

  const card = (e: Entry) => (
    <ClockCard
      key={e.id}
      e={e}
      at={at}
      homeOffset={homeOffset}
      h12={h12}
      live={live}
      home={e.id === HOME_ID}
      pinned={pins.includes(e.id)}
      onPin={e.id === HOME_ID ? undefined : () => togglePin(e.id)}
    />
  );

  const addCustom = () => {
    const z = IANA_ZONES.find((v) => v.toLowerCase() === addZone.trim().toLowerCase());
    if (!z) return;
    const id = `tz:${z}`;
    if (!pins.includes(id)) setPins([...pins, id]);
    setAddZone("");
    setTab("board");
  };

  const shiftLabel = (() => {
    if (live) return "";
    const a = Math.abs(shiftMin);
    return `${shiftMin < 0 ? "−" : "+"}${fmtDur(a)} ${shiftMin < 0 ? "ago" : "from now"}`;
  })();

  return (
    <div className="panel wc">
      {/* ---------- hero: digital home clock + time planner ---------- */}
      <div className={`wc-hero${live ? "" : " planning"}`}>
        <div className="wc-hero-clock">
          <div className="wc-hero-label">
            <span className={`wc-led-dot${live ? " live" : ""}`} />
            {live ? "LIVE" : "PLANNING"} · Johannesburg · SAST
          </div>
          <div className="wc-hero-time">
            {homeT.hm}
            {live && <span className="wc-hero-sec">:{pad(homeZ.second)}</span>}
            {homeT.ampm && <span className="wc-hero-ampm">{homeT.ampm}</span>}
          </div>
          <div className="wc-hero-date">
            {WEEKDAYS[homeZ.weekday]} {homeZ.day} {MONTHS[homeZ.month - 1]} {homeZ.year} ·{" "}
            <span className={homeSt.open ? "ok" : "off"}>Office {homeSt.open ? "open" : "closed"}</span> · {usOpen}/5 mainland US
            zones open
          </div>
          {localZone && localZone !== HOME.zone && <div className="wc-hero-sub">Your device is on {localZone}.</div>}
        </div>

        <div className="wc-hero-controls">
          <label className="wc-slider-label" htmlFor="wc-shift">
            Plan a time {shiftLabel && <b>{shiftLabel}</b>}
          </label>
          <input
            id="wc-shift"
            className="wc-slider"
            type="range"
            min={-720}
            max={1440}
            step={15}
            value={shiftMin}
            onChange={(e) => setShift(Number(e.target.value))}
          />
          <div className="wc-slider-ticks">
            <span>−12h</span>
            <span>now</span>
            <span>+12h</span>
            <span>+24h</span>
          </div>
          <div className="wc-hero-buttons">
            {[-60, 60, 180].map((m) => (
              <button key={m} type="button" className="wc-ghost" onClick={() => setShift(Math.max(-720, Math.min(1440, shiftMin + m)))}>
                {m > 0 ? "+" : "−"}
                {Math.abs(m) / 60}h
              </button>
            ))}
            <button type="button" className="wc-ghost primary" disabled={live} onClick={() => setShift(0)}>
              Back to live
            </button>
            <div className="wc-seg" role="group" aria-label="Clock format">
              <button type="button" className={!h12 ? "on" : ""} onClick={() => setH12(false)}>24h</button>
              <button type="button" className={h12 ? "on" : ""} onClick={() => setH12(true)}>12h</button>
            </div>
          </div>
        </div>
      </div>

      <CallPlanner
        now={now}
        targets={plannerTargets}
        fallback={!pinnedEntries.length}
        shiftMin={shiftMin}
        setShift={setShift}
        h12={h12}
      />

      {/* ---------- toolbar ---------- */}
      <div className="wc-toolbar">
        <div className="wc-tabs" role="tablist">
          {(
            [
              ["board", `My board${pinnedEntries.length ? ` (${pinnedEntries.length})` : ""}`],
              ["world", "World"],
              ["usa", "USA time zones"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <input
          className="wc-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="City, country, US state (e.g. New Jersey, TX)…"
          aria-label="Find a city, country or US state"
        />
        <label className="wc-toggle">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open now only
        </label>
      </div>
      <p className="hint wc-hint">
        "Open" = Mon–Fri {pad(OPEN_HOUR)}:00–{pad(CLOSE_HOUR)}:00 local time. Daylight saving is applied automatically. ☆ pins a clock to My board
        and the call planner.
      </p>

      {/* ---------- search results ---------- */}
      {term && tab !== "usa" ? (
        <>
          <h3 className="wc-section-title">Results for "{q.trim()}"</h3>
          {results.filter(passOpen).length === 0 ? (
            <p className="hint">No match. Try a city, a country, a US state name or abbreviation, or a zone like "Asia/Kathmandu".</p>
          ) : (
            <div className="wc-grid">{results.filter(passOpen).map(card)}</div>
          )}
        </>
      ) : tab === "board" ? (
        <>
          <div className="wc-grid">
            {card(ENTRY_BY_ID.get(HOME_ID)!)}
            {pinnedEntries.filter(passOpen).map(card)}
          </div>
          {pinnedEntries.length === 0 && (
            <p className="hint">
              Nothing pinned yet. Tap ☆ on any clock (or a state in "USA time zones") to build a board for the suppliers you deal with.
            </p>
          )}
          <div className="wc-add">
            <input
              list="wc-iana"
              value={addZone}
              onChange={(e) => setAddZone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
              placeholder="Add any time zone, e.g. Asia/Kathmandu"
              aria-label="Add any time zone"
            />
            <datalist id="wc-iana">
              {IANA_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <button type="button" className="wc-ghost primary" onClick={addCustom} disabled={!IANA_ZONES.some((v) => v.toLowerCase() === addZone.trim().toLowerCase())}>
              Add clock
            </button>
          </div>
        </>
      ) : tab === "world" ? (
        /* One continuous grid (no gaps at the end of a region's row); the
           region name sits above its first clock, the other cells keep the
           same space so every row of cards lines up. */
        <div className="wc-grid">
          {WORLD_GROUPS.flatMap((g) =>
            g.entries.filter(passOpen).map((e, i) => (
              <div key={e.id} className="wc-cell">
                <h3 className={`wc-region-name${i === 0 ? "" : " wc-region-spacer"}`} aria-hidden={i !== 0}>
                  {g.name}
                </h3>
                {card(e)}
              </div>
            )),
          )}
        </div>
      ) : (
        <>
          <p className="hint">
            Every state, DC and territory, by time zone. * = state split across two zones (hover for which part). Click a state or city to pin it.
          </p>
          <div className="wc-us-grid">
            {US_ZONES.filter((z) => !openOnly || isOpenAt(z.zone, at)).map((z) => (
              <UsZoneCard
                key={z.key}
                z={z}
                at={at}
                homeOffset={homeOffset}
                h12={h12}
                live={live}
                term={term}
                pins={pins}
                togglePin={togglePin}
                transition={transitions.get(z.key) ?? null}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
