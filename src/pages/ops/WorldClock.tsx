import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

/**
 * Control Tower → World Clock. Every time is rendered by the browser's Intl
 * engine against an IANA zone, so daylight-saving switches (Europe, the US,
 * Sydney, Auckland, Egypt…) are applied automatically, no hard-coded offsets.
 *
 * Features: digital home clock, "plan a time" slider (every clock moves with
 * it), best-time-to-call heat strip for pinned locations, one tab per ExPac
 * trade route (China, Europe, India, UK, USA) with every region mapped to
 * its zone (split regions flagged) and shared office hours with JHB, pin any
 * city / region / IANA zone to "My board", 12h/24h toggle, open-now filter.
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

/* ---------------- ExPac trade routes ---------------- */

interface RouteZone {
  key: string;
  name: string;
  zone: string;
  blurb?: string;
  /** `area` is an Area code of the same route (shown on the chip). */
  cities: { city: string; area?: string }[];
}
interface Area {
  code: string;
  name: string;
  zone: string; // RouteZone key
  /** Second zone used in part of the area. */
  also?: string;
  note?: string;
}
interface Route {
  key: string;
  tab: string;
  country: string;
  intro: string;
  areaLabel: string;
  /** Zone used for the route's summary chip in the hero. */
  primary: string;
  zones: RouteZone[];
  areas: Area[];
}

const CHINA: Route = {
  key: "CN",
  tab: "China",
  country: "China",
  intro: "All of mainland China runs on Beijing time (no DST), 6h ahead of SAST. Hong Kong and Macau share the same clock.",
  areaLabel: "Provinces & regions",
  primary: "CN",
  zones: [
    {
      key: "CN",
      name: "China Standard",
      zone: "Asia/Shanghai",
      blurb: "Whole mainland, one zone, no DST",
      cities: [
        { city: "Shanghai", area: "SH" },
        { city: "Ningbo", area: "ZJ" },
        { city: "Yiwu", area: "ZJ" },
        { city: "Shenzhen", area: "GD" },
        { city: "Guangzhou", area: "GD" },
        { city: "Dongguan", area: "GD" },
        { city: "Foshan", area: "GD" },
        { city: "Xiamen", area: "FJ" },
        { city: "Qingdao", area: "SD" },
        { city: "Tianjin", area: "TJ" },
        { city: "Dalian", area: "LN" },
        { city: "Beijing", area: "BJ" },
      ],
    },
    {
      key: "HK",
      name: "Hong Kong & Macau",
      zone: "Asia/Hong_Kong",
      blurb: "Same time as the mainland, no DST",
      cities: [{ city: "Hong Kong", area: "HK" }, { city: "Macau", area: "MO" }],
    },
    {
      key: "XJ",
      name: "Xinjiang local",
      zone: "Asia/Urumqi",
      blurb: "Unofficial local time, 2h behind Beijing. Business mostly uses Beijing time",
      cities: [{ city: "Ürümqi", area: "XJ" }],
    },
  ],
  areas: [
    { code: "AH", name: "Anhui", zone: "CN" },
    { code: "BJ", name: "Beijing", zone: "CN" },
    { code: "CQ", name: "Chongqing", zone: "CN" },
    { code: "FJ", name: "Fujian", zone: "CN" },
    { code: "GS", name: "Gansu", zone: "CN" },
    { code: "GD", name: "Guangdong", zone: "CN" },
    { code: "GX", name: "Guangxi", zone: "CN" },
    { code: "GZ", name: "Guizhou", zone: "CN" },
    { code: "HI", name: "Hainan", zone: "CN" },
    { code: "HE", name: "Hebei", zone: "CN" },
    { code: "HL", name: "Heilongjiang", zone: "CN" },
    { code: "HA", name: "Henan", zone: "CN" },
    { code: "HB", name: "Hubei", zone: "CN" },
    { code: "HN", name: "Hunan", zone: "CN" },
    { code: "NM", name: "Inner Mongolia", zone: "CN" },
    { code: "JS", name: "Jiangsu", zone: "CN" },
    { code: "JX", name: "Jiangxi", zone: "CN" },
    { code: "JL", name: "Jilin", zone: "CN" },
    { code: "LN", name: "Liaoning", zone: "CN" },
    { code: "NX", name: "Ningxia", zone: "CN" },
    { code: "QH", name: "Qinghai", zone: "CN" },
    { code: "SN", name: "Shaanxi", zone: "CN" },
    { code: "SD", name: "Shandong", zone: "CN" },
    { code: "SH", name: "Shanghai", zone: "CN" },
    { code: "SX", name: "Shanxi", zone: "CN" },
    { code: "SC", name: "Sichuan", zone: "CN" },
    { code: "TJ", name: "Tianjin", zone: "CN" },
    { code: "XZ", name: "Tibet", zone: "CN" },
    { code: "XJ", name: "Xinjiang", zone: "CN", also: "XJ", note: "Official time is Beijing time; many locals keep Xinjiang time (2h behind)" },
    { code: "YN", name: "Yunnan", zone: "CN" },
    { code: "ZJ", name: "Zhejiang", zone: "CN" },
    { code: "HK", name: "Hong Kong SAR", zone: "HK" },
    { code: "MO", name: "Macau SAR", zone: "HK" },
  ],
};

const EUROPE: Route = {
  key: "EU",
  tab: "Europe",
  country: "Europe",
  intro: "Mainland Europe spans three zones plus Türkiye. All EU zones change clocks on the same dates (last Sunday of March and October).",
  areaLabel: "Countries",
  primary: "CET",
  zones: [
    {
      key: "WET",
      name: "Western European",
      zone: "Europe/Lisbon",
      blurb: "Same clock as the UK",
      cities: [
        { city: "Lisbon", area: "PT" },
        { city: "Porto / Leixões", area: "PT" },
        { city: "Sines", area: "PT" },
        { city: "Dublin", area: "IE" },
        { city: "Cork", area: "IE" },
        { city: "Las Palmas", area: "ES" },
      ],
    },
    {
      key: "CET",
      name: "Central European",
      zone: "Europe/Berlin",
      blurb: "Main North-Sea and Mediterranean ports",
      cities: [
        { city: "Rotterdam", area: "NL" },
        { city: "Antwerp", area: "BE" },
        { city: "Hamburg", area: "DE" },
        { city: "Bremerhaven", area: "DE" },
        { city: "Le Havre", area: "FR" },
        { city: "Marseille", area: "FR" },
        { city: "Valencia", area: "ES" },
        { city: "Barcelona", area: "ES" },
        { city: "Algeciras", area: "ES" },
        { city: "Genoa", area: "IT" },
        { city: "Milan", area: "IT" },
        { city: "Gdańsk", area: "PL" },
        { city: "Gothenburg", area: "SE" },
        { city: "Copenhagen", area: "DK" },
        { city: "Koper", area: "SI" },
      ],
    },
    {
      key: "EET",
      name: "Eastern European",
      zone: "Europe/Athens",
      blurb: "Greece, Balkans east, Baltics, Finland",
      cities: [
        { city: "Piraeus", area: "GR" },
        { city: "Thessaloniki", area: "GR" },
        { city: "Constanța", area: "RO" },
        { city: "Varna", area: "BG" },
        { city: "Limassol", area: "CY" },
        { city: "Helsinki", area: "FI" },
        { city: "Riga", area: "LV" },
      ],
    },
    {
      key: "TRT",
      name: "Türkiye",
      zone: "Europe/Istanbul",
      blurb: "UTC+3 all year, no DST",
      cities: [
        { city: "Istanbul", area: "TR" },
        { city: "Izmir", area: "TR" },
        { city: "Mersin", area: "TR" },
        { city: "Bursa", area: "TR" },
      ],
    },
  ],
  areas: [
    { code: "PT", name: "Portugal", zone: "WET", note: "The Azores are 1h behind Lisbon" },
    { code: "IE", name: "Ireland", zone: "WET" },
    { code: "AL", name: "Albania", zone: "CET" },
    { code: "AT", name: "Austria", zone: "CET" },
    { code: "BE", name: "Belgium", zone: "CET" },
    { code: "BA", name: "Bosnia & Herzegovina", zone: "CET" },
    { code: "HR", name: "Croatia", zone: "CET" },
    { code: "CZ", name: "Czechia", zone: "CET" },
    { code: "DK", name: "Denmark", zone: "CET" },
    { code: "FR", name: "France", zone: "CET" },
    { code: "DE", name: "Germany", zone: "CET" },
    { code: "HU", name: "Hungary", zone: "CET" },
    { code: "IT", name: "Italy", zone: "CET" },
    { code: "LU", name: "Luxembourg", zone: "CET" },
    { code: "MT", name: "Malta", zone: "CET" },
    { code: "ME", name: "Montenegro", zone: "CET" },
    { code: "NL", name: "Netherlands", zone: "CET" },
    { code: "MK", name: "North Macedonia", zone: "CET" },
    { code: "NO", name: "Norway", zone: "CET" },
    { code: "PL", name: "Poland", zone: "CET" },
    { code: "RS", name: "Serbia", zone: "CET" },
    { code: "SK", name: "Slovakia", zone: "CET" },
    { code: "SI", name: "Slovenia", zone: "CET" },
    { code: "ES", name: "Spain", zone: "CET", also: "WET", note: "Canary Islands (Las Palmas, Tenerife) are 1h behind mainland Spain" },
    { code: "SE", name: "Sweden", zone: "CET" },
    { code: "CH", name: "Switzerland", zone: "CET" },
    { code: "BG", name: "Bulgaria", zone: "EET" },
    { code: "CY", name: "Cyprus", zone: "EET" },
    { code: "EE", name: "Estonia", zone: "EET" },
    { code: "FI", name: "Finland", zone: "EET" },
    { code: "GR", name: "Greece", zone: "EET" },
    { code: "LV", name: "Latvia", zone: "EET" },
    { code: "LT", name: "Lithuania", zone: "EET" },
    { code: "MD", name: "Moldova", zone: "EET" },
    { code: "RO", name: "Romania", zone: "EET" },
    { code: "UA", name: "Ukraine", zone: "EET" },
    { code: "TR", name: "Türkiye", zone: "TRT" },
  ],
};

const INDIA: Route = {
  key: "IN",
  tab: "India",
  country: "India",
  intro: "All of India is on one zone, IST (UTC+5:30, no DST), 3h 30m ahead of SAST all year. Neighbouring transhipment and sourcing hubs are shown too.",
  areaLabel: "States & union territories",
  primary: "IST",
  zones: [
    {
      key: "IST",
      name: "India Standard",
      zone: "Asia/Kolkata",
      blurb: "Whole country, one zone, no DST",
      cities: [
        { city: "Mumbai", area: "MH" },
        { city: "Nhava Sheva", area: "MH" },
        { city: "Pune", area: "MH" },
        { city: "Mundra", area: "GJ" },
        { city: "Ahmedabad", area: "GJ" },
        { city: "Delhi", area: "DL" },
        { city: "Chennai", area: "TN" },
        { city: "Tiruppur", area: "TN" },
        { city: "Bengaluru", area: "KA" },
        { city: "Hyderabad", area: "TG" },
        { city: "Kolkata", area: "WB" },
        { city: "Kochi", area: "KL" },
        { city: "Visakhapatnam", area: "AP" },
        { city: "Ludhiana", area: "PB" },
      ],
    },
    {
      key: "LK",
      name: "Sri Lanka",
      zone: "Asia/Colombo",
      blurb: "Same clock as India; Colombo transhipment hub",
      cities: [{ city: "Colombo", area: "LKA" }],
    },
    {
      key: "BD",
      name: "Bangladesh",
      zone: "Asia/Dhaka",
      blurb: "30m ahead of India, no DST",
      cities: [{ city: "Dhaka", area: "BGD" }, { city: "Chattogram", area: "BGD" }],
    },
    {
      key: "PK",
      name: "Pakistan",
      zone: "Asia/Karachi",
      blurb: "30m behind India, no DST",
      cities: [{ city: "Karachi", area: "PAK" }, { city: "Lahore", area: "PAK" }],
    },
  ],
  areas: [
    { code: "AP", name: "Andhra Pradesh", zone: "IST" },
    { code: "AR", name: "Arunachal Pradesh", zone: "IST" },
    { code: "AS", name: "Assam", zone: "IST" },
    { code: "BR", name: "Bihar", zone: "IST" },
    { code: "CG", name: "Chhattisgarh", zone: "IST" },
    { code: "GA", name: "Goa", zone: "IST" },
    { code: "GJ", name: "Gujarat", zone: "IST" },
    { code: "HR", name: "Haryana", zone: "IST" },
    { code: "HP", name: "Himachal Pradesh", zone: "IST" },
    { code: "JH", name: "Jharkhand", zone: "IST" },
    { code: "KA", name: "Karnataka", zone: "IST" },
    { code: "KL", name: "Kerala", zone: "IST" },
    { code: "MP", name: "Madhya Pradesh", zone: "IST" },
    { code: "MH", name: "Maharashtra", zone: "IST" },
    { code: "MN", name: "Manipur", zone: "IST" },
    { code: "ML", name: "Meghalaya", zone: "IST" },
    { code: "MZ", name: "Mizoram", zone: "IST" },
    { code: "NL", name: "Nagaland", zone: "IST" },
    { code: "OD", name: "Odisha", zone: "IST" },
    { code: "PB", name: "Punjab", zone: "IST" },
    { code: "RJ", name: "Rajasthan", zone: "IST" },
    { code: "SK", name: "Sikkim", zone: "IST" },
    { code: "TN", name: "Tamil Nadu", zone: "IST" },
    { code: "TG", name: "Telangana", zone: "IST" },
    { code: "TR", name: "Tripura", zone: "IST" },
    { code: "UP", name: "Uttar Pradesh", zone: "IST" },
    { code: "UK", name: "Uttarakhand", zone: "IST" },
    { code: "WB", name: "West Bengal", zone: "IST" },
    { code: "AN", name: "Andaman & Nicobar", zone: "IST" },
    { code: "CH", name: "Chandigarh", zone: "IST" },
    { code: "DH", name: "Dadra & Nagar Haveli and Daman & Diu", zone: "IST" },
    { code: "DL", name: "Delhi", zone: "IST" },
    { code: "JK", name: "Jammu & Kashmir", zone: "IST" },
    { code: "LA", name: "Ladakh", zone: "IST" },
    { code: "LD", name: "Lakshadweep", zone: "IST" },
    { code: "PY", name: "Puducherry", zone: "IST" },
    { code: "LKA", name: "Sri Lanka", zone: "LK" },
    { code: "BGD", name: "Bangladesh", zone: "BD" },
    { code: "PAK", name: "Pakistan", zone: "PK" },
  ],
};

const UK: Route = {
  key: "UK",
  tab: "UK",
  country: "UK",
  intro: "The UK is on GMT in winter (2h behind SAST) and BST in summer (1h behind). Gibraltar is the one British territory on Central European time.",
  areaLabel: "Nations & territories",
  primary: "UK",
  zones: [
    {
      key: "UK",
      name: "UK (GMT / BST)",
      zone: "Europe/London",
      blurb: "Great Britain, Northern Ireland, Channel Islands, Isle of Man",
      cities: [
        { city: "London", area: "ENG" },
        { city: "Heathrow", area: "ENG" },
        { city: "Felixstowe", area: "ENG" },
        { city: "London Gateway", area: "ENG" },
        { city: "Southampton", area: "ENG" },
        { city: "Tilbury", area: "ENG" },
        { city: "Immingham", area: "ENG" },
        { city: "Liverpool", area: "ENG" },
        { city: "Manchester", area: "ENG" },
        { city: "Birmingham", area: "ENG" },
        { city: "Leeds", area: "ENG" },
        { city: "Glasgow", area: "SCT" },
        { city: "Cardiff", area: "WLS" },
        { city: "Belfast", area: "NIR" },
      ],
    },
    {
      key: "GI",
      name: "Gibraltar",
      zone: "Europe/Gibraltar",
      blurb: "British territory on Central European time",
      cities: [{ city: "Gibraltar", area: "GI" }],
    },
  ],
  areas: [
    { code: "ENG", name: "England", zone: "UK" },
    { code: "SCT", name: "Scotland", zone: "UK" },
    { code: "WLS", name: "Wales", zone: "UK" },
    { code: "NIR", name: "Northern Ireland", zone: "UK" },
    { code: "JE", name: "Jersey", zone: "UK" },
    { code: "GG", name: "Guernsey", zone: "UK" },
    { code: "IM", name: "Isle of Man", zone: "UK" },
    { code: "GI", name: "Gibraltar", zone: "GI" },
  ],
};

const USA: Route = {
  key: "US",
  tab: "USA",
  country: "USA",
  intro: "Every state, DC and territory, by time zone. US clocks change on different dates from Europe, so the gap to SAST shifts in March and November.",
  areaLabel: "States",
  primary: "ET",
  zones: [
    {
      key: "ET",
      name: "Eastern",
      zone: "America/New_York",
      blurb: "East Coast: NY / NJ ports, Southeast",
      cities: [
        { city: "New York", area: "NY" },
        { city: "Newark", area: "NJ" },
        { city: "Philadelphia", area: "PA" },
        { city: "Baltimore", area: "MD" },
        { city: "Atlanta", area: "GA" },
        { city: "Savannah", area: "GA" },
        { city: "Charleston", area: "SC" },
        { city: "Miami", area: "FL" },
        { city: "Detroit", area: "MI" },
      ],
    },
    {
      key: "CT",
      name: "Central",
      zone: "America/Chicago",
      blurb: "Midwest, Texas Gulf, Mississippi valley",
      cities: [
        { city: "Chicago", area: "IL" },
        { city: "Houston", area: "TX" },
        { city: "Dallas", area: "TX" },
        { city: "Memphis", area: "TN" },
        { city: "Nashville", area: "TN" },
        { city: "New Orleans", area: "LA" },
        { city: "Kansas City", area: "MO" },
        { city: "Minneapolis", area: "MN" },
      ],
    },
    {
      key: "MT",
      name: "Mountain",
      zone: "America/Denver",
      blurb: "Rockies (observes DST)",
      cities: [
        { city: "Denver", area: "CO" },
        { city: "Salt Lake City", area: "UT" },
        { city: "Albuquerque", area: "NM" },
        { city: "El Paso", area: "TX" },
        { city: "Boise", area: "ID" },
      ],
    },
    {
      key: "AZ",
      name: "Arizona",
      zone: "America/Phoenix",
      blurb: "Mountain Standard all year, no DST (matches Pacific in summer)",
      cities: [{ city: "Phoenix", area: "AZ" }, { city: "Tucson", area: "AZ" }],
    },
    {
      key: "PT",
      name: "Pacific",
      zone: "America/Los_Angeles",
      blurb: "West Coast: LA / Long Beach, Oakland, Seattle",
      cities: [
        { city: "Los Angeles", area: "CA" },
        { city: "Long Beach", area: "CA" },
        { city: "San Francisco", area: "CA" },
        { city: "Oakland", area: "CA" },
        { city: "San Diego", area: "CA" },
        { city: "Seattle", area: "WA" },
        { city: "Portland", area: "OR" },
        { city: "Las Vegas", area: "NV" },
      ],
    },
    {
      key: "AK",
      name: "Alaska",
      zone: "America/Anchorage",
      cities: [{ city: "Anchorage", area: "AK" }, { city: "Juneau", area: "AK" }],
    },
    { key: "HT", name: "Hawaii", zone: "Pacific/Honolulu", blurb: "No DST", cities: [{ city: "Honolulu", area: "HI" }] },
    { key: "AT", name: "Atlantic", zone: "America/Puerto_Rico", blurb: "Territories, no DST", cities: [{ city: "San Juan", area: "PR" }] },
    { key: "CH", name: "Chamorro", zone: "Pacific/Guam", blurb: "Territories, no DST", cities: [{ city: "Hagåtña", area: "GU" }] },
    { key: "SM", name: "Samoa", zone: "Pacific/Pago_Pago", blurb: "Territory, no DST", cities: [{ city: "Pago Pago", area: "AS" }] },
  ],
  areas: [
    { code: "AL", name: "Alabama", zone: "CT" },
    { code: "AK", name: "Alaska", zone: "AK", note: "Western Aleutian Islands use Hawaii–Aleutian time" },
    { code: "AZ", name: "Arizona", zone: "AZ", also: "MT", note: "No DST, except the Navajo Nation (follows Mountain DST)" },
    { code: "AR", name: "Arkansas", zone: "CT" },
    { code: "CA", name: "California", zone: "PT" },
    { code: "CO", name: "Colorado", zone: "MT" },
    { code: "CT", name: "Connecticut", zone: "ET" },
    { code: "DE", name: "Delaware", zone: "ET" },
    { code: "DC", name: "District of Columbia", zone: "ET" },
    { code: "FL", name: "Florida", zone: "ET", also: "CT", note: "Panhandle west of the Apalachicola River (Pensacola) is Central" },
    { code: "GA", name: "Georgia", zone: "ET" },
    { code: "HI", name: "Hawaii", zone: "HT" },
    { code: "ID", name: "Idaho", zone: "MT", also: "PT", note: "Northern panhandle (Coeur d'Alene) is Pacific" },
    { code: "IL", name: "Illinois", zone: "CT" },
    { code: "IN", name: "Indiana", zone: "ET", also: "CT", note: "NW corner (Gary) and SW corner (Evansville) are Central" },
    { code: "IA", name: "Iowa", zone: "CT" },
    { code: "KS", name: "Kansas", zone: "CT", also: "MT", note: "Four western border counties are Mountain" },
    { code: "KY", name: "Kentucky", zone: "ET", also: "CT", note: "Western half (Bowling Green, Paducah) is Central" },
    { code: "LA", name: "Louisiana", zone: "CT" },
    { code: "ME", name: "Maine", zone: "ET" },
    { code: "MD", name: "Maryland", zone: "ET" },
    { code: "MA", name: "Massachusetts", zone: "ET" },
    { code: "MI", name: "Michigan", zone: "ET", also: "CT", note: "Four Upper Peninsula counties bordering Wisconsin are Central" },
    { code: "MN", name: "Minnesota", zone: "CT" },
    { code: "MS", name: "Mississippi", zone: "CT" },
    { code: "MO", name: "Missouri", zone: "CT" },
    { code: "MT", name: "Montana", zone: "MT" },
    { code: "NE", name: "Nebraska", zone: "CT", also: "MT", note: "Western panhandle is Mountain" },
    { code: "NV", name: "Nevada", zone: "PT", also: "MT", note: "West Wendover is Mountain" },
    { code: "NH", name: "New Hampshire", zone: "ET" },
    { code: "NJ", name: "New Jersey", zone: "ET" },
    { code: "NM", name: "New Mexico", zone: "MT" },
    { code: "NY", name: "New York", zone: "ET" },
    { code: "NC", name: "North Carolina", zone: "ET" },
    { code: "ND", name: "North Dakota", zone: "CT", also: "MT", note: "South-west corner is Mountain" },
    { code: "OH", name: "Ohio", zone: "ET" },
    { code: "OK", name: "Oklahoma", zone: "CT" },
    { code: "OR", name: "Oregon", zone: "PT", also: "MT", note: "Most of Malheur County is Mountain" },
    { code: "PA", name: "Pennsylvania", zone: "ET" },
    { code: "RI", name: "Rhode Island", zone: "ET" },
    { code: "SC", name: "South Carolina", zone: "ET" },
    { code: "SD", name: "South Dakota", zone: "CT", also: "MT", note: "Western half (Rapid City) is Mountain" },
    { code: "TN", name: "Tennessee", zone: "CT", also: "ET", note: "East Tennessee (Knoxville, Chattanooga) is Eastern" },
    { code: "TX", name: "Texas", zone: "CT", also: "MT", note: "El Paso and Hudspeth counties are Mountain" },
    { code: "UT", name: "Utah", zone: "MT" },
    { code: "VT", name: "Vermont", zone: "ET" },
    { code: "VA", name: "Virginia", zone: "ET" },
    { code: "WA", name: "Washington", zone: "PT" },
    { code: "WV", name: "West Virginia", zone: "ET" },
    { code: "WI", name: "Wisconsin", zone: "CT" },
    { code: "WY", name: "Wyoming", zone: "MT" },
    { code: "PR", name: "Puerto Rico", zone: "AT" },
    { code: "VI", name: "U.S. Virgin Islands", zone: "AT" },
    { code: "GU", name: "Guam", zone: "CH" },
    { code: "MP", name: "Northern Mariana Islands", zone: "CH" },
    { code: "AS", name: "American Samoa", zone: "SM" },
  ],
};

/** The five ExPac trade lanes, in the order the website lists them. */
const ROUTES: Route[] = [CHINA, EUROPE, INDIA, UK, USA];
const ROUTE_BY_KEY = new Map(ROUTES.map((r) => [r.key, r]));

const zoneOf = (r: Route, key: string) => r.zones.find((z) => z.key === key)!;
const areaOf = (r: Route, code?: string) => (code ? r.areas.find((a) => a.code === code) : undefined);
const cityChip = (r: Route, c: { city: string; area?: string }) =>
  c.area && r.key === "US" ? `${c.city}, ${c.area}` : c.city;

/* ---------------- entries (anything that can be a clock) ---------------- */

const cityId = (zone: string, city: string) => `city:${zone}:${city}`;
const areaId = (r: Route, code: string) => `area:${r.key}:${code}`;
const rzoneId = (r: Route, key: string) => `rzone:${r.key}:${key}`;

function routeCityEntries(r: Route): Entry[] {
  return r.zones.flatMap((z) =>
    z.cities.map((c) => {
      const a = areaOf(r, c.area);
      return {
        id: cityId(z.zone, c.city),
        label: c.city,
        sub: `${a ? a.name : r.country} · ${z.name} time`,
        zone: z.zone,
      };
    }),
  );
}

const ROUTE_CITY_ENTRIES: Entry[] = ROUTES.flatMap(routeCityEntries);

const WORLD_GROUPS: { name: string; entries: Entry[] }[] = [
  ...REGIONS.slice(0, 5).map((r) => ({
    name: r.name,
    entries: r.cities.map((c) => ({ id: cityId(c.zone, c.city), label: c.city, sub: c.country, zone: c.zone })),
  })),
  { name: "United States", entries: routeCityEntries(USA) },
  {
    name: "Americas",
    entries: REGIONS[5].cities.map((c) => ({ id: cityId(c.zone, c.city), label: c.city, sub: c.country, zone: c.zone })),
  },
];

const AREA_ENTRIES: Entry[] = ROUTES.flatMap((r) =>
  r.areas.map((a) => {
    const z = zoneOf(r, a.zone);
    return {
      id: areaId(r, a.code),
      label: a.name,
      sub: `${r.country === a.name ? "" : `${r.country} · `}${z.name} time`,
      zone: z.zone,
      note: a.note,
    };
  }),
);

const RZONE_ENTRIES: Entry[] = ROUTES.flatMap((r) =>
  r.zones.map((z) => ({
    id: rzoneId(r, z.key),
    label: r.key === "US" ? `US ${z.name}` : z.name,
    sub: `${r.tab} trade route · time zone`,
    zone: z.zone,
    note: z.blurb,
  })),
);

const HOME_ID = cityId(HOME.zone, HOME.city);
const ALL_ENTRIES: Entry[] = [
  ...WORLD_GROUPS.flatMap((g) => g.entries),
  ...ROUTE_CITY_ENTRIES,
  ...AREA_ENTRIES,
  ...RZONE_ENTRIES,
];
const ENTRY_BY_ID = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

function tzEntry(zone: string): Entry {
  const last = zone.split("/").pop() ?? zone;
  return { id: `tz:${zone}`, label: last.replace(/_/g, " "), sub: zone, zone };
}
/** Pins saved by the first version used `state:NJ` / `uszone:ET`. */
function upgradeId(id: string): string {
  if (id.startsWith("state:")) return `area:US:${id.slice(6)}`;
  if (id.startsWith("uszone:")) return `rzone:US:${id.slice(7)}`;
  return id;
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
/** Short zone name like "EST" / "BST" / "CET"; null when Intl only knows "GMT+x". */
function zoneAbbr(zone: string, at: Date): string | null {
  let f = abbrCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" });
    abbrCache.set(zone, f);
  }
  let name = f.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  if (/^(GMT|UTC)[+−-]/.test(name) && zone.startsWith("America/")) {
    // en-GB lacks US abbreviations; en-US has them.
    name =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? name;
  }
  return name && !/^(GMT|UTC)[+−-]/.test(name) ? name : null;
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

interface Transition {
  at: Date;
  from: number;
  to: number;
}
/** Next daylight-saving change within ~13 months, to the day. */
function nextTransition(zone: string, from: Date): Transition | null {
  const DAY = 86_400_000;
  let prev = offsetMinutes(zone, from);
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
function fmtMinOfDay(min: number, h12: boolean): string {
  const t = fmtHM(Math.floor(min / 60), min % 60, h12);
  return t.ampm ? `${t.hm} ${t.ampm}` : t.hm;
}

/** Office-hours overlap with JHB on a weekday, in SAST. `diff` = zone − SAST minutes. */
function sharedHours(diff: number, h12: boolean): { text: string; none: boolean } {
  const s = Math.max(OPEN_HOUR * 60, OPEN_HOUR * 60 - diff);
  const e = Math.min(CLOSE_HOUR * 60, CLOSE_HOUR * 60 - diff);
  if (e <= s) return { text: "No shared office hours with JHB: email or call outside hours", none: true };
  return { text: `Shared office hours: ${fmtMinOfDay(s, h12)}–${fmtMinOfDay(e, h12)} SAST (${fmtDur(e - s)})`, none: false };
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

function StatusRow({ st }: { st: BizStatus }) {
  return (
    <div className="wc-status">
      <span className={`wc-badge ${st.open ? (st.soon ? "soon" : "open") : "closed"}`}>{st.open ? "Open" : "Closed"}</span>
      <span className="wc-status-label">{st.label}</span>
    </div>
  );
}

function PinButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`wc-pin${on ? " on" : ""}`}
      onClick={(ev) => {
        ev.stopPropagation(); // the card itself is clickable (focus)
        onClick();
      }}
      title={on ? "Remove from My board" : "Pin to My board"}
      aria-label={on ? `Unpin ${label}` : `Pin ${label}`}
      aria-pressed={on}
    >
      {on ? "★" : "☆"}
    </button>
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
  focused?: boolean;
  onFocus?: () => void;
}

/** Props that make a card act as a button which puts it in the big top panel. */
function focusProps(label: string, onFocus?: () => void) {
  if (!onFocus) return {};
  return {
    role: "button",
    tabIndex: 0,
    title: `Show ${label} in the top panel`,
    onClick: onFocus,
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) {
        ev.preventDefault();
        onFocus();
      }
    },
  };
}

function ClockCard({ e, at, homeOffset, h12, live, home, pinned, onPin, focused, onFocus }: CardProps) {
  const z = zoneParts(e.zone, at);
  const off = offsetMinutes(e.zone, at);
  const dst = isDst(e.zone, at);
  const st = bizStatus(z);
  const night = z.hour < 6 || z.hour >= 20;
  const abbr = zoneAbbr(e.zone, at);
  const t = fmtHM(z.hour, z.minute, h12);

  return (
    <div
      className={`wc-card${home ? " home" : ""}${night ? " night" : ""}${pinned ? " pinned" : ""}${focused ? " focused" : ""}${onFocus ? " clickable" : ""}`}
      {...focusProps(e.label, onFocus)}
    >
      <div className="wc-top">
        <div className="wc-name">
          <div className="wc-city">{e.label}</div>
          <div className="wc-country">{e.sub}</div>
        </div>
        {onPin && <PinButton on={!!pinned} label={e.label} onClick={onPin} />}
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
      <StatusRow st={st} />
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
            ? "Showing your 5 trade routes. Pin locations (☆) to plan around your own suppliers instead."
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
              <span className="wc-heat-label">
                {h12 ? `${parseInt(s.label.hm, 10)}${s.label.ampm[0].toLowerCase()}` : s.label.hm.slice(0, 2)}
              </span>
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

function RouteZoneCard({
  route,
  z,
  at,
  homeOffset,
  h12,
  live,
  term,
  pins,
  togglePin,
  transition,
  focused,
  onFocus,
}: {
  route: Route;
  z: RouteZone;
  at: Date;
  homeOffset: number;
  h12: boolean;
  live: boolean;
  term: string;
  pins: string[];
  togglePin: (id: string) => void;
  transition: Transition | null;
  focused: boolean;
  onFocus: () => void;
}) {
  const p = zoneParts(z.zone, at);
  const off = offsetMinutes(z.zone, at);
  const st = bizStatus(p);
  const abbr = zoneAbbr(z.zone, at);
  const t = fmtHM(p.hour, p.minute, h12);
  const shared = sharedHours(off - homeOffset, h12);
  const primary = route.areas.filter((a) => a.zone === z.key);
  const partial = route.areas.filter((a) => a.also === z.key);
  const matches = (a: Area) => !!term && (a.name.toLowerCase().includes(term) || a.code.toLowerCase() === term);
  const anyMatch =
    !term ||
    [...primary, ...partial].some(matches) ||
    z.name.toLowerCase().includes(term) ||
    z.cities.some((c) => c.city.toLowerCase().includes(term));
  const zid = rzoneId(route, z.key);
  // Hide an area list that only repeats the zone's own name (e.g. "Sri Lanka").
  const showAreas = primary.length > 1 || (primary.length === 1 && primary[0].name !== z.name);

  return (
    <div
      className={`wc-us clickable${anyMatch ? "" : " dim"}${p.hour < 6 || p.hour >= 20 ? " night" : ""}${focused ? " focused" : ""}`}
      {...focusProps(z.name, onFocus)}
    >
      <div className="wc-us-head">
        <div>
          <div className="wc-us-name">
            {z.name}
            {abbr && <span className="wc-abbr">{abbr}</span>}
          </div>
          {z.blurb && <div className="wc-country">{z.blurb}</div>}
        </div>
        <PinButton on={pins.includes(zid)} label={z.name} onClick={() => togglePin(zid)} />
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
      <StatusRow st={st} />
      <div className={`wc-shared${shared.none ? " none" : ""}`}>{shared.text}</div>
      {transition && (
        <div className="wc-dst-next">
          Clocks change {WEEKDAYS[transition.at.getUTCDay()]} {transition.at.getUTCDate()} {MONTHS[transition.at.getUTCMonth()]}: gap
          to SAST becomes {fmtDiff(transition.to - offsetMinutes(HOME.zone, transition.at)).replace(" vs SAST", "")}
        </div>
      )}

      <div className="wc-us-sec">Cities & ports</div>
      <div className="wc-chips">
        {z.cities.map((c) => {
          const id = cityId(z.zone, c.city);
          const on = pins.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`wc-chip${on ? " on" : ""}${term && c.city.toLowerCase().includes(term) ? " hit" : ""}`}
              onClick={(ev) => {
                ev.stopPropagation();
                togglePin(id);
              }}
              title={`${areaOf(route, c.area)?.name ?? route.country} (click to ${on ? "unpin" : "pin"})`}
            >
              {cityChip(route, c)}
            </button>
          );
        })}
      </div>

      {showAreas && (
        <>
          <div className="wc-us-sec">
            {route.areaLabel} ({primary.length})
          </div>
          <div className="wc-chips">
            {primary.map((a) => {
              const id = areaId(route, a.code);
              const on = pins.includes(id);
              return (
                <button
                  key={a.code}
                  type="button"
                  className={`wc-chip state${on ? " on" : ""}${matches(a) ? " hit" : ""}${a.also || a.note ? " split" : ""}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    togglePin(id);
                  }}
                  title={`${a.name}${a.note ? `: ${a.note}` : ""} (click to ${on ? "unpin" : "pin"})`}
                >
                  {a.name}
                  {a.also || a.note ? " *" : ""}
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
            {partial.map((a) => (
              <span
                key={a.code}
                className={`wc-chip partial${matches(a) ? " hit" : ""}`}
                title={a.note}
                onClick={(ev) => ev.stopPropagation()}
              >
                {a.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- main ---------------- */

type Tab = "board" | "world" | string; // or a route key

export default function WorldClock() {
  const now = useNow();
  const [shiftMin, setShift] = useState(0);
  const [h12, setH12] = useStored<boolean>("wc:h12", false);
  const [rawPins, setPins] = useStored<string[]>("wc:pins", []);
  const [rawTab, setTab] = useStored<Tab>("wc:tab", "world");
  const [openOnly, setOpenOnly] = useState(false);
  const [q, setQ] = useState("");
  const [addZone, setAddZone] = useState("");
  // Clicking a clock puts it in the big top panel (null = Johannesburg).
  const [focusId, setFocusId] = useState<string | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  const pins = useMemo(() => rawPins.map(upgradeId), [rawPins]);
  const tab: Tab = rawTab === "usa" ? "US" : rawTab;
  const route = ROUTE_BY_KEY.get(tab);

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
    const byZone = new Map<string, Transition | null>();
    for (const r of ROUTES) for (const z of r.zones) if (!byZone.has(z.zone)) byZone.set(z.zone, nextTransition(z.zone, from));
    return byZone;
  }, [dayKey]);

  const routePrimaryEntries = ROUTES.map((r) => ENTRY_BY_ID.get(rzoneId(r, r.primary))!).map((e, i) => ({
    ...e,
    label: ROUTES[i].tab,
  }));
  const plannerTargets = pinnedEntries.length ? pinnedEntries : routePrimaryEntries;

  const passOpen = (e: Entry) => !openOnly || isOpenAt(e.zone, at);

  // Global search: cities, every route region, any IANA zone.
  const results: Entry[] = useMemo(() => {
    if (!term) return [];
    const hit = (e: Entry) => [e.label, e.sub, e.zone].some((v) => v.toLowerCase().includes(term));
    const areaHits = AREA_ENTRIES.filter((e) => hit(e) || e.id.split(":")[2].toLowerCase() === term);
    const cityHits = [
      ...WORLD_GROUPS.flatMap((g) => g.entries.filter((e) => hit(e) || g.name.toLowerCase().includes(term))),
      ...ROUTE_CITY_ENTRIES.filter(hit),
    ];
    const zoneHits = RZONE_ENTRIES.filter(hit);
    const known = new Set([...areaHits, ...cityHits, ...zoneHits].map((e) => e.zone));
    const tzHits =
      term.length >= 3
        ? IANA_ZONES.filter((z) => z.toLowerCase().replace(/_/g, " ").includes(term) && !known.has(z))
            .slice(0, 8)
            .map(tzEntry)
        : [];
    const seen = new Set<string>();
    return [...areaHits, ...zoneHits, ...cityHits, ...tzHits].filter((e) => !seen.has(e.id) && !!seen.add(e.id));
  }, [term]);

  const focusEntry = focusId && focusId !== HOME_ID ? resolveEntry(focusId) ?? null : null;
  const focusOn = (id: string) => {
    setFocusId(id === HOME_ID ? null : id);
    heroRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // Big panel: the focused clock, or Johannesburg.
  const heroZone = focusEntry?.zone ?? HOME.zone;
  const heroZ = zoneParts(heroZone, at);
  const heroT = fmtHM(heroZ.hour, heroZ.minute, h12);
  const heroSt = bizStatus(heroZ);
  const heroOff = offsetMinutes(heroZone, at);
  const heroAbbr = focusEntry ? zoneAbbr(heroZone, at) ?? fmtOffset(heroOff) : "SAST";
  const homeZ = zoneParts(HOME.zone, at);
  const homeT = fmtHM(homeZ.hour, homeZ.minute, h12);
  const homeSt = bizStatus(homeZ);

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
      focused={(focusEntry?.id ?? HOME_ID) === e.id}
      onFocus={() => focusOn(e.id)}
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
      <div ref={heroRef} className={`wc-hero${live ? "" : " planning"}${focusEntry ? " focused" : ""}`}>
        <div className="wc-hero-clock">
          <div className="wc-hero-label">
            <span className={`wc-led-dot${live ? " live" : ""}`} />
            {live ? "LIVE" : "PLANNING"} · {focusEntry ? focusEntry.label : "Johannesburg"} · {heroAbbr}
            {focusEntry && (
              <button type="button" className="wc-hero-back" onClick={() => setFocusId(null)}>
                ← Back to Johannesburg
              </button>
            )}
          </div>
          {focusEntry && <div className="wc-hero-sub">{focusEntry.sub}</div>}
          <div className="wc-hero-time">
            {heroT.hm}
            {live && <span className="wc-hero-sec">:{pad(heroZ.second)}</span>}
            {heroT.ampm && <span className="wc-hero-ampm">{heroT.ampm}</span>}
          </div>
          <div className="wc-hero-date">
            {WEEKDAYS[heroZ.weekday]} {heroZ.day} {MONTHS[heroZ.month - 1]} {heroZ.year} ·{" "}
            <span className={heroSt.open ? "ok" : "off"}>
              Office {heroSt.open ? "open" : "closed"}
            </span>{" "}
            · {heroSt.label}
          </div>
          {focusEntry ? (
            <div className="wc-hero-sub">
              Johannesburg {homeT.hm}
              {homeT.ampm && ` ${homeT.ampm}`} ({homeSt.open ? "open" : "closed"}) · {fmtDiff(heroOff - homeOffset)} ·{" "}
              {sharedHours(heroOff - homeOffset, h12).text}
            </div>
          ) : (
            <>
              {localZone && localZone !== HOME.zone && <div className="wc-hero-sub">Your device is on {localZone}.</div>}
              <div className="wc-hero-sub">Click any clock below to show it here.</div>
            </>
          )}
          <div className="wc-hero-routes" aria-label="Trade routes">
            {ROUTES.map((r) => {
              const pz = zoneOf(r, r.primary);
              const zp = zoneParts(pz.zone, at);
              const open = bizStatus(zp).open;
              const rt = fmtHM(zp.hour, zp.minute, h12);
              return (
                <button
                  key={r.key}
                  type="button"
                  className={`wc-route-chip${open ? " open" : ""}${tab === r.key ? " on" : ""}`}
                  onClick={() => {
                    setTab(r.key);
                    setQ("");
                    setFocusId(rzoneId(r, r.primary));
                  }}
                  title={`${r.tab} ⇄ South Africa · ${pz.name} · ${open ? "open" : "closed"}`}
                >
                  <i />
                  <span className="rc-name">{r.tab}</span>
                  <span className="rc-time">
                    {rt.hm}
                    {rt.ampm && ` ${rt.ampm}`}
                  </span>
                </button>
              );
            })}
          </div>
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
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          <span className="wc-tabs-label">Trade routes</span>
          {ROUTES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={tab === r.key}
              className={tab === r.key ? "on" : ""}
              onClick={() => setTab(r.key)}
            >
              {r.tab}
            </button>
          ))}
        </div>
        <input
          className="wc-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={route ? `Find in ${route.tab}: city, ${route.areaLabel.toLowerCase()}…` : "City, country, state or province…"}
          aria-label="Find a city, country, state or province"
        />
        <label className="wc-toggle">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open now only
        </label>
      </div>
      <p className="hint wc-hint">
        "Open" = Mon–Fri {pad(OPEN_HOUR)}:00–{pad(CLOSE_HOUR)}:00 local time. Daylight saving is applied automatically. ☆ pins a clock to My board
        and the call planner.
      </p>

      {term && !route ? (
        <>
          <h3 className="wc-section-title">Results for "{q.trim()}"</h3>
          {results.filter(passOpen).length === 0 ? (
            <p className="hint">No match. Try a city, a country, a state or province, or a zone like "Asia/Kathmandu".</p>
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
              Nothing pinned yet. Tap ☆ on any clock, or a city or region in a trade route tab, to build a board for the suppliers you deal with.
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
            <button
              type="button"
              className="wc-ghost primary"
              onClick={addCustom}
              disabled={!IANA_ZONES.some((v) => v.toLowerCase() === addZone.trim().toLowerCase())}
            >
              Add clock
            </button>
          </div>
        </>
      ) : route ? (
        <>
          <p className="hint">
            <strong>{route.tab} ⇄ South Africa.</strong> {route.intro} * = split across zones or has an exception (hover for detail). Click a
            city or region to pin it.
          </p>
          <div className="wc-us-grid">
            {route.zones
              .filter((z) => !openOnly || isOpenAt(z.zone, at))
              .map((z) => (
                <RouteZoneCard
                  key={z.key}
                  route={route}
                  z={z}
                  at={at}
                  homeOffset={homeOffset}
                  h12={h12}
                  live={live}
                  term={term}
                  pins={pins}
                  togglePin={togglePin}
                  transition={transitions.get(z.zone) ?? null}
                  focused={focusEntry?.id === rzoneId(route, z.key)}
                  onFocus={() => focusOn(rzoneId(route, z.key))}
                />
              ))}
          </div>
        </>
      ) : (
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
      )}
    </div>
  );
}
