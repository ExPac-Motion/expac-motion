import { useEffect, useMemo, useState } from "react";

/**
 * Control Tower → World Clock. Every time is rendered by the browser's Intl
 * engine against an IANA zone, so daylight-saving switches (Europe, the US,
 * Sydney, Auckland, Egypt…) are applied automatically, no hard-coded offsets.
 */

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
      { city: "New York", country: "United States", zone: "America/New_York" },
      { city: "Toronto", country: "Canada", zone: "America/Toronto" },
      { city: "Chicago", country: "United States", zone: "America/Chicago" },
      { city: "Los Angeles", country: "United States", zone: "America/Los_Angeles" },
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

const pad = (n: number) => String(n).padStart(2, "0");

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

function ClockCard({ c, now, homeOffset, home }: { c: City; now: Date; homeOffset: number; home?: boolean }) {
  const z = zoneParts(c.zone, now);
  const off = offsetMinutes(c.zone, now);
  const dst = isDst(c.zone, now);
  const open = z.weekday >= 1 && z.weekday <= 5 && z.hour >= OPEN_HOUR && z.hour < CLOSE_HOUR;
  const night = z.hour < 6 || z.hour >= 20;

  return (
    <div className={`wc-card${home ? " home" : ""}${night ? " night" : ""}`}>
      <div className="wc-top">
        <div>
          <div className="wc-city">{c.city}</div>
          <div className="wc-country">{c.country}</div>
        </div>
        <span className={`wc-badge ${open ? "open" : "closed"}`}>{open ? "Open" : "Closed"}</span>
      </div>
      <div className="wc-time">
        {pad(z.hour)}:{pad(z.minute)}
        <span className="wc-sec">:{pad(z.second)}</span>
      </div>
      <div className="wc-date">
        {WEEKDAYS[z.weekday]} {pad(z.day)}/{pad(z.month)}/{z.year}
      </div>
      <div className="wc-meta">
        <span>{fmtOffset(off)}{dst ? " · DST" : ""}</span>
        <span>{home ? "Home office" : fmtDiff(off - homeOffset)}</span>
      </div>
    </div>
  );
}

export default function WorldClock() {
  const now = useNow();
  const homeOffset = offsetMinutes(HOME.zone, now);
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // Find a city or country ("Canada" -> Toronto, Vancouver).
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const regions = term
    ? REGIONS.map((r) => ({
        ...r,
        cities: r.cities.filter((c) =>
          [c.city, c.country, r.name].some((v) => v.toLowerCase().includes(term)),
        ),
      })).filter((r) => r.cities.length > 0)
    : REGIONS;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>World Clock</h2>
          <p>
            Live local times for key trade regions. Daylight saving is applied automatically.
            "Open" = Mon–Fri {pad(OPEN_HOUR)}:00–{pad(CLOSE_HOUR)}:00 local time.
            {localZone && localZone !== HOME.zone ? ` Your device is on ${localZone}.` : ""}
          </p>
        </div>
        <input
          className="wc-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a city or country…"
          aria-label="Find a city or country"
        />
      </div>

      {regions.length === 0 && <p className="hint">No clock for "{q.trim()}" yet, ask to have it added.</p>}

      {/* One continuous grid (no gaps at the end of a region's row); the
          region name sits above its first clock, the other cells keep the
          same space so every row of cards lines up. */}
      <div className="wc-grid">
        {regions.flatMap((r) =>
          r.cities.map((c, i) => (
            <div key={c.zone} className="wc-cell">
              <h3 className={`wc-region-name${i === 0 ? "" : " wc-region-spacer"}`} aria-hidden={i !== 0}>
                {r.name}
              </h3>
              <ClockCard c={c} now={now} homeOffset={homeOffset} home={c.zone === HOME.zone} />
            </div>
          )),
        )}
      </div>
    </div>
  );
}
