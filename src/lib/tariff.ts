// Tier rate sheets + partner rate sheets (migration 0119): the shared code
// worksheet, weight-break matching and live price resolution used by Rates &
// Tariff, the partner records and the Quote Builder.
import { CHARGE_CATALOG, type CatalogItem } from "./chargeCatalog";
import { CUSTOMS_DUTY_CODE, CUSTOMS_VAT_CODE, SERVICE_FEE_CODES } from "./calc";
import {
  CHARGE_CATEGORIES,
  rateTier,
  type ChargeCategory,
  type LineCurrency,
  type PartnerKind,
  type PartnerRateSheet,
  type PartnerSheetLine,
  type Quote,
  type RateTierId,
  type TariffSheet,
  type TariffSheetDraft,
  type TariffSheetLine,
} from "./types";

export const PARTNER_KINDS: PartnerKind[] = ["agent", "transporter", "clearing_agent"];
export const PARTNER_LABEL: Record<PartnerKind, string> = {
  agent: "Agent",
  transporter: "Transporter",
  clearing_agent: "Clearing Agent",
};

/** Sell-only codes: no buy, the figure is a typed Sell (R). */
export function isSellOnlyCode(code: string): boolean {
  return (
    SERVICE_FEE_CODES.includes(code) || code === CUSTOMS_VAT_CODE || code === CUSTOMS_DUTY_CODE
  );
}

/** Which partner a category's buy rates come from by default. */
export const CATEGORY_SOURCE: Record<ChargeCategory, PartnerKind> = {
  "International Freight Charges": "agent",
  "Ex-Works Charges": "agent",
  "Destination Handling and Delivery Charges": "transporter",
  "Customs Clearance, VAT and Duty Charges": "clearing_agent",
};

/**
 * Which charge sections ExPac quotes under each incoterm (importer side):
 * EXW = everything from pick-up; F-terms (seller delivers to the carrier /
 * port) drop the Ex-Works charges; C-terms (seller also pays the main
 * freight) drop international freight too; DAP / DPU leave only clearance;
 * DDP = ExPac's all-in door-to-door duty-paid service. Blank = every section.
 */
export const INCOTERM_SECTIONS: Record<string, ChargeCategory[]> = {
  EXW: [...CHARGE_CATEGORIES],
  FCA: ["International Freight Charges", "Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  FAS: ["International Freight Charges", "Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  FOB: ["International Freight Charges", "Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  CPT: ["Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  CFR: ["Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  CIP: ["Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  CIF: ["Destination Handling and Delivery Charges", "Customs Clearance, VAT and Duty Charges"],
  DAP: ["Customs Clearance, VAT and Duty Charges"],
  DPU: ["Customs Clearance, VAT and Duty Charges"],
  DDP: [...CHARGE_CATEGORIES],
};
export function sectionsForIncoterm(incoterm: string | null | undefined): ChargeCategory[] {
  return INCOTERM_SECTIONS[(incoterm ?? "").trim().toUpperCase()] ?? [...CHARGE_CATEGORIES];
}

/** The Quote Builder's code worksheet for a mode, in its four sections. */
export function worksheetGroups(
  mode: string,
  opts: { sellOnly?: boolean } = {},
): { category: ChargeCategory; items: CatalogItem[] }[] {
  return CHARGE_CATEGORIES.map((category) => ({
    category,
    items: CHARGE_CATALOG.filter(
      (c) =>
        c.category === category &&
        (!c.modes || (c.modes as string[]).includes(mode)) &&
        (opts.sellOnly !== false || !isSellOnlyCode(c.code)),
    ),
  })).filter((g) => g.items.length > 0);
}

/* ---------- weight breaks ---------- */

/** "0-45KG" -> [0, 45]; "+45KG" / "45+" / ">45" / "Min 100 KGS" -> [45|100, ∞]. */
export function breakRange(label: string): [number, number] | null {
  const nums = (label.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));
  if (nums.length === 0) return null;
  if (nums.length >= 2) return [nums[0], nums[1]];
  return [nums[0], Infinity];
}

/** Index of the break that applies to `kg`: the highest floor it clears,
 *  then the narrowest range — so 35 kg on 0-45 / 0-100 / 0-300 picks 0-45. */
export function matchingIndex(labels: string[], kg: number): number {
  if (!(kg > 0)) return -1;
  let best = -1;
  let bestLo = -Infinity;
  let bestHi = Infinity;
  labels.forEach((l, i) => {
    const r = breakRange(l);
    if (!r) return;
    const [lo, hi] = r;
    if (kg < lo || kg > hi) return;
    if (lo > bestLo || (lo === bestLo && hi < bestHi)) {
      best = i;
      bestLo = lo;
      bestHi = hi;
    }
  });
  return best;
}

/** A partner's rate for one code at a chargeable weight. */
export function partnerRate(
  line: PartnerSheetLine | undefined,
  kg: number,
): { buy: number; cur: LineCurrency; breakLabel?: string } | null {
  if (!line) return null;
  const breaks = (line.breaks ?? []).filter((b) => b.rate != null);
  if (breaks.length > 0) {
    const i = matchingIndex(
      breaks.map((b) => b.label),
      kg,
    );
    // No weight yet: the first break, so the sheet still reads sensibly.
    // Heavier than every break: the last (highest) one.
    const b = breaks[i >= 0 ? i : kg > 0 ? breaks.length - 1 : 0];
    return { buy: Number(b.rate), cur: line.cur, breakLabel: b.label };
  }
  if (line.buy == null) return null;
  return { buy: Number(line.buy), cur: line.cur };
}

/* ---------- tier sheets ---------- */

export type PartnerSheets = Partial<Record<PartnerKind, PartnerRateSheet | null>>;

export interface ResolvedTierLine {
  item: CatalogItem;
  sellOnly: boolean;
  source: TariffSheetLine["source"];
  /** null when the linked partner has no rate for this code. */
  buy: number | null;
  cur: LineCurrency;
  margin: number;
  /** Line-currency sell (buy × (1 + margin)), or Sell (R) for sell-only codes. */
  sell: number | null;
  breakLabel?: string;
  /** The partner line carries weight breaks. */
  hasBreaks: boolean;
}

export function tierLine(
  sheet: Pick<TariffSheet, "margin" | "lines">,
  item: CatalogItem,
  partners: PartnerSheets,
  kg: number,
): ResolvedTierLine {
  const line = sheet.lines[item.code] ?? defaultTierLine(item);
  const sellOnly = isSellOnlyCode(item.code);
  const margin = line.margin ?? sheet.margin;
  if (sellOnly) {
    return {
      item,
      sellOnly,
      source: "manual",
      buy: null,
      cur: item.cur,
      margin: 0,
      sell: line.sell ?? null,
      hasBreaks: false,
    };
  }
  if (line.source === "manual") {
    const buy = line.buy ?? null;
    return {
      item,
      sellOnly,
      source: "manual",
      buy,
      cur: line.cur ?? item.cur,
      margin,
      sell: buy == null ? null : buy * (1 + margin / 100),
      hasBreaks: false,
    };
  }
  const pLine = partners[line.source]?.lines[item.code];
  const r = partnerRate(pLine, kg);
  return {
    item,
    sellOnly,
    source: line.source,
    buy: r?.buy ?? null,
    cur: r?.cur ?? item.cur,
    margin,
    sell: r ? r.buy * (1 + margin / 100) : null,
    breakLabel: r?.breakLabel,
    hasBreaks: (pLine?.breaks ?? []).length > 0,
  };
}

export function defaultTierLine(item: CatalogItem): TariffSheetLine {
  return {
    source: isSellOnlyCode(item.code) ? "manual" : CATEGORY_SOURCE[item.category],
    buy: null,
    margin: null,
    sell: null,
  };
}

export function emptyTariffSheet(tier: RateTierId, mode: string): TariffSheetDraft {
  const lines: Record<string, TariffSheetLine> = {};
  for (const g of worksheetGroups(mode))
    for (const item of g.items) lines[item.code] = defaultTierLine(item);
  return {
    tier,
    mode,
    route: "",
    origin: null,
    destination: null,
    valid_from: null,
    valid_until: null,
    margin: rateTier(tier).margin,
    agent_id: null,
    agent_sheet_id: null,
    transporter_id: null,
    transporter_sheet_id: null,
    clearing_agent_id: null,
    clearing_agent_sheet_id: null,
    notes: null,
    lines,
  };
}

export function sheetIdKey(kind: PartnerKind) {
  return `${kind}_sheet_id` as const;
}
export function partnerIdKey(kind: PartnerKind) {
  return `${kind}_id` as const;
}

/* ---------- trade routes from quotes / shipments ---------- */

/** "CNSZX — Shenzhen, China" -> "CNSZX"; free text stays as typed. */
export function placeShort(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const m = t.match(/^([A-Z]{2}[A-Z0-9]{3})\b/);
  return m ? m[1] : t;
}
export function routeName(origin: string | null | undefined, destination: string | null | undefined) {
  return `${placeShort(origin) || "Any"} → ${placeShort(destination) || "Any"}`;
}

/** A tier sheet's lines seeded from a quotation: each coded charge's buy
 *  (as a manual buy, in the quote line's currency) and the service fees'
 *  Sell (R). Customs VAT / Duty are per-shipment, so they're left out. */
export function tariffLinesFromQuote(q: Quote): Record<string, TariffSheetLine> {
  const lines = emptyTariffSheet("silver", q.mode).lines;
  for (const l of q.quote_lines ?? []) {
    const code = String(l.code ?? "");
    if (!(code in lines) || code === CUSTOMS_VAT_CODE || code === CUSTOMS_DUTY_CODE) continue;
    if (isSellOnlyCode(code)) {
      const sell = Number(l.sell) || 0;
      if (sell > 0) lines[code] = { ...lines[code], sell };
    } else {
      const buy = Number(l.buy) || 0;
      if (buy > 0) lines[code] = { source: "manual", buy, cur: l.cur, margin: null, sell: null };
    }
  }
  return lines;
}

/** dd/mm/yyyy for an ISO date. */
export function ddmmyyyy(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}
