import {
  CHARGE_CATEGORIES,
  type ChargeCategory,
  type PackingItem,
  type QuoteLine,
  type QuoteMode,
} from "./types";

/** kg per m³ used to convert volume to a chargeable weight (air standard, per the ExPac packing sheet). */
export const VOLUMETRIC_FACTOR = 167;

/** Insurance is 0.50% of the declared commercial value. */
export const INSURANCE_RATE = 0.005;
export function insuranceAmount(commercialValue: number | string): number {
  return (Number(commercialValue) || 0) * INSURANCE_RATE;
}

/** South African standard VAT rate (%). Per-line vat_pct defaults to 0. */
export const VAT_RATE = 15;

export interface ChargeTotals {
  /** Internal buy cost, converted to ZAR using the quote's FX rates. */
  cost: number;
  /** Client-facing sell total, always ZAR (VAT-exclusive). */
  sell: number;
  gp: number;
  margin: number;
  /** VAT on the sell total, always ZAR (sum of per-line VAT). */
  vat: number;
  /** Client-facing sell total including VAT, always ZAR. */
  sellIncl: number;
}

export interface FxRates {
  usd: number;
  cny: number;
}

/** Pulls FX rates off a quote (or draft-like object) with safe fallbacks. */
export function fxOf(q: {
  fx_usd_zar?: number | string | null;
  fx_cny_zar?: number | string | null;
}): FxRates {
  return {
    usd: Number(q?.fx_usd_zar) || 0,
    cny: Number(q?.fx_cny_zar) || 0,
  };
}

export function buyRate(cur: QuoteLine["cur"], fx: FxRates): number {
  if (cur === "USD") return fx.usd;
  if (cur === "CNY") return fx.cny;
  return 1; // ZAR
}

/** Sell unit rate in the line's own currency = buy x (1 + margin%/100). */
export function sellInCur(
  buy: number | string,
  margin: number | string,
): number {
  return (Number(buy) || 0) * (1 + (Number(margin) || 0) / 100);
}

/** ZAR sell unit rate = sellInCur x fx(cur). */
export function sellFromBuy(
  buy: number | string,
  margin: number | string,
  cur: QuoteLine["cur"],
  fx: FxRates,
): number {
  return sellInCur(buy, margin) * buyRate(cur, fx);
}

/** Back-out the markup % that reproduces a stored sell (for loading legacy lines). */
export function impliedMargin(
  buy: number | string,
  sell: number | string,
  cur: QuoteLine["cur"],
  fx: FxRates,
): number {
  const b = Number(buy) || 0;
  const s = Number(sell) || 0;
  const rate = buyRate(cur, fx);
  if (b <= 0 || rate <= 0) return 0;
  return (s / (b * rate) - 1) * 100;
}

/** ZAR line total the client sees, VAT-exclusive: qty x sell. */
export function lineTotal(l: QuoteLine): number {
  return (Number(l.qty) || 0) * (Number(l.sell) || 0);
}

/** VAT % applied to a line (0 when unset / zero-rated). */
export function lineVatPct(l: Pick<QuoteLine, "vat_pct">): number {
  return Number(l.vat_pct) || 0;
}

/** ZAR VAT amount on a line: lineTotal x vat_pct/100. */
export function lineVat(l: QuoteLine): number {
  return lineTotal(l) * (lineVatPct(l) / 100);
}

/** ZAR line total including VAT. */
export function lineTotalIncl(l: QuoteLine): number {
  return lineTotal(l) + lineVat(l);
}

/* ---------- Unit-driven quantity ---------- */

/** Units whose quantity is the packing-list chargeable weight (air modes only). */
export const WEIGHT_UNITS = ["KGS", "THC"];
export const WEIGHT_MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Courier Express (CX)",
];

/** Freight-ton units: qty = greater of weight-in-tonnes and volume-in-CBM. Any mode. */
export const REVENUE_TON_UNITS = ["R/T", "W/M"];
/** 1 metric tonne (1000 kg) = 1 CBM. */
export const KG_PER_CBM = 1000;

/**
 * When a charge line's unit ties it to a packing-list figure, returns that
 * figure; otherwise null (the line keeps its typed qty).
 */
export function autoQty(
  line: Pick<QuoteLine, "unit">,
  mode: QuoteMode,
  pack: PackingTotals,
): number | null {
  const unit = String(line.unit ?? "");
  if (WEIGHT_MODES.includes(mode) && WEIGHT_UNITS.includes(unit)) {
    return pack.chargeable;
  }
  if (REVENUE_TON_UNITS.includes(unit)) {
    return Math.max(pack.totalActual / KG_PER_CBM, pack.totalCbm);
  }
  return null;
}

export function effectiveQty(
  line: QuoteLine,
  mode: QuoteMode,
  pack: PackingTotals,
): number {
  const auto = autoQty(line, mode, pack);
  return auto != null ? auto : Number(line.qty) || 0;
}

/** Cargo Insurance charge code: sell is the insurance premium, not a marked-up buy. */
export const INSURANCE_CODE = "IN-01";

export interface LineContext {
  mode: QuoteMode;
  fx: FxRates;
  pack: PackingTotals;
  /** Declared commercial value ($) — drives the IN-01 insurance line. */
  commercialValue: number | string;
}

/**
 * Applies code- and unit-driven rules to a charge line and returns a copy with
 * qty / buy / margin / sell resolved. Used for the builder preview, saving, and
 * the read-only quote detail view so they always agree.
 */
export function resolveLine(line: QuoteLine, ctx: LineContext): QuoteLine {
  let qty: number | string = line.qty;
  let buy: number | string = line.buy;
  let margin: number | string = line.margin;

  const auto = autoQty(line, ctx.mode, ctx.pack);
  if (auto != null) qty = auto;

  if (line.code === INSURANCE_CODE) {
    // Sell (R) = insurance amount ($) converted at the line's currency rate.
    buy = insuranceAmount(ctx.commercialValue);
    margin = 0;
    qty = 1;
  }

  return {
    ...line,
    qty,
    buy,
    margin,
    sell: sellFromBuy(buy, margin, line.cur, ctx.fx),
  };
}

/** ZAR buy cost for a line: qty x buy x fx rate for the line's currency. */
export function lineCostZar(l: QuoteLine, fx: FxRates): number {
  return (Number(l.qty) || 0) * (Number(l.buy) || 0) * buyRate(l.cur, fx);
}

export function chargeTotals(
  lines: QuoteLine[] | null | undefined,
  fx: FxRates = { usd: 0, cny: 0 },
): ChargeTotals {
  let cost = 0;
  let sell = 0;
  let vat = 0;
  (lines || []).forEach((l) => {
    cost += lineCostZar(l, fx);
    sell += lineTotal(l);
    vat += lineVat(l);
  });
  const gp = sell - cost;
  const margin = sell > 0 ? (gp / sell) * 100 : 0;
  return { cost, sell, gp, margin, vat, sellIncl: sell + vat };
}

export interface CategoryGroup {
  category: ChargeCategory;
  lines: { line: QuoteLine; index: number }[];
  /** VAT-exclusive section subtotal (ZAR). */
  subtotal: number;
  /** VAT on the section (ZAR). */
  vat: number;
  /** Section subtotal including VAT (ZAR). */
  subtotalIncl: number;
}

/* ---------- Packing list ---------- */

export interface PackingRow {
  /** L x W x H / 1,000,000, dims in cm. */
  cbm: number;
  /** cbm x VOLUMETRIC_FACTOR. */
  volumeKg: number;
  totalCbm: number;
  totalActual: number;
  totalVolume: number;
}

export function packingRow(p: PackingItem): PackingRow {
  const l = Number(p.length_cm) || 0;
  const w = Number(p.width_cm) || 0;
  const h = Number(p.height_cm) || 0;
  const actual = Number(p.actual_kg) || 0;
  const qty = Number(p.qty_ctns) || 0;
  const cbm = (l * w * h) / 1_000_000;
  const volumeKg = cbm * VOLUMETRIC_FACTOR;
  return {
    cbm,
    volumeKg,
    totalCbm: cbm * qty,
    totalActual: actual * qty,
    totalVolume: volumeKg * qty,
  };
}

export interface PackingTotals {
  qty: number;
  totalCbm: number;
  totalActual: number;
  totalVolume: number;
  /** MAX(total actual weight, total volume weight). */
  chargeable: number;
}

export function packingTotals(items: PackingItem[] | null | undefined): PackingTotals {
  let qty = 0;
  let totalCbm = 0;
  let totalActual = 0;
  let totalVolume = 0;
  (items || []).forEach((p) => {
    const r = packingRow(p);
    qty += Number(p.qty_ctns) || 0;
    totalCbm += r.totalCbm;
    totalActual += r.totalActual;
    totalVolume += r.totalVolume;
  });
  return {
    qty,
    totalCbm,
    totalActual,
    totalVolume,
    chargeable: Math.max(totalActual, totalVolume),
  };
}

/** Splits lines into the four fixed categories, preserving original indexes. */
export function groupByCategory(lines: QuoteLine[]): CategoryGroup[] {
  return CHARGE_CATEGORIES.map((category) => {
    const groupLines = lines
      .map((line, index) => ({ line, index }))
      .filter((x) => (x.line.category ?? CHARGE_CATEGORIES[0]) === category);
    const subtotal = groupLines.reduce((s, x) => s + lineTotal(x.line), 0);
    const vat = groupLines.reduce((s, x) => s + lineVat(x.line), 0);
    return {
      category,
      lines: groupLines,
      subtotal,
      vat,
      subtotalIncl: subtotal + vat,
    };
  });
}
