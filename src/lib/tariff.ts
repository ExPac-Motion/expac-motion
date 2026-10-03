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
      cur: item.cur,
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

/** dd/mm/yyyy for an ISO date. */
export function ddmmyyyy(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}
