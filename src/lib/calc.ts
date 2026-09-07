import {
  CHARGE_CATEGORIES,
  type ChargeCategory,
  type PackingItem,
  type QuoteLine,
  type QuoteMode,
} from "./types";

/** kg per m³ used to convert volume to a chargeable weight. Air / courier /
 *  road use the 1:6 airline standard (~167). */
export const VOLUMETRIC_FACTOR = 167;
/** Sea LCL bills 1 CBM = 1000 kg. */
export const SEA_LCL_VOLUMETRIC_FACTOR = 1000;

/** The volumetric factor for a quote's transport mode. */
export function volumetricFactor(mode: string | null | undefined): number {
  return mode === "Sea Freight (LCL)"
    ? SEA_LCL_VOLUMETRIC_FACTOR
    : VOLUMETRIC_FACTOR;
}

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

/** Foreign purchase total in the line's own currency: qty x buy (pre-FX). */
export function lineBuyTotal(l: Pick<QuoteLine, "qty" | "buy">): number {
  return (Number(l.qty) || 0) * (Number(l.buy) || 0);
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

/** Units whose qty is the packing-list chargeable weight (KGS). Any mode. */
export const WEIGHT_UNITS = ["KGS", "THC"];
/** Units whose qty is the packing-list chargeable volume (CBM). Any mode. */
export const VOLUME_UNITS = ["CBM", "W/M", "R/T"];

/** Ocean Freight (LCL-DDP): qty billed per freight ton (W/M), min 0.50. */
export const OCEAN_LCL_DDP_CODE = "OF-06";

/** Freight ton (weight-or-measure): MAX(total weight in tonnes, total CBM). */
export function freightTon(pack: PackingTotals): number {
  return Math.max((pack.totalActual || 0) / 1000, pack.totalCbm || 0);
}

/**
 * When a charge line's unit / code ties its qty to a packing-list figure,
 * returns that figure; otherwise null (the line keeps its typed qty). An
 * operator override (`qty_override`) always returns null so their number wins.
 */
export function autoQty(
  line: Pick<QuoteLine, "unit" | "code" | "qty_override">,
  _mode: QuoteMode,
  pack: PackingTotals,
): number | null {
  if (line.qty_override) return null;
  if (line.code === OCEAN_LCL_DDP_CODE) {
    return Math.max(0.5, freightTon(pack));
  }
  const unit = String(line.unit ?? "");
  if (WEIGHT_UNITS.includes(unit)) {
    return pack.chargeable;
  }
  if (VOLUME_UNITS.includes(unit)) {
    return pack.totalCbm;
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
/** Forwarding Fee charge code: buy = 1% of the International Freight Charges buy total (USD). */
export const FORWARDING_CODE = "FW-01";
/** Forwarding fee rate — 1% of the International Freight Charges USD buy total. */
export const FORWARDING_RATE = 0.01;

/**
 * Σ(qty × buy) over the International Freight Charges lines, each converted to
 * USD, excluding the forwarding fee itself and cargo insurance — the base the
 * FW-01 1% fee is charged on. Feed it the resolved lines so derived qtys are
 * settled. `fx` holds USD→ZAR / CNY→ZAR, so CNY→USD = cny/usd and ZAR→USD = 1/usd.
 */
export function intlFreightBuyUsd(lines: QuoteLine[], fx: FxRates): number {
  return (lines || [])
    .filter(
      (l) =>
        (l.category ?? CHARGE_CATEGORIES[0]) === CHARGE_CATEGORIES[0] &&
        l.code !== FORWARDING_CODE &&
        l.code !== INSURANCE_CODE,
    )
    .reduce((s, l) => {
      const amt = (Number(l.qty) || 0) * (Number(l.buy) || 0);
      if (l.cur === "USD") return s + amt;
      if (l.cur === "CNY") return s + (fx.usd ? (amt * fx.cny) / fx.usd : 0);
      return s + (fx.usd ? amt / fx.usd : 0); // ZAR
    }, 0);
}

export interface LineContext {
  mode: QuoteMode;
  fx: FxRates;
  pack: PackingTotals;
  /** Declared commercial value ($) — drives the IN-01 insurance line. */
  commercialValue: number | string;
  /** USD buy total of the International Freight Charges lines — drives FW-01. */
  forwardingBaseUsd?: number;
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

  if (line.code === FORWARDING_CODE) {
    // Buy = 1% of the International Freight Charges USD buy total; no markup.
    buy = (ctx.forwardingBaseUsd ?? 0) * FORWARDING_RATE;
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

/**
 * Resolves a whole quote's lines. Two passes so the FW-01 forwarding fee can
 * be a percentage of the other International Freight Charges lines (which
 * themselves may have code/unit-driven qtys).
 */
export function resolveLines(lines: QuoteLine[], ctx: LineContext): QuoteLine[] {
  const firstPass = (lines || []).map((l) =>
    l.code === FORWARDING_CODE ? l : resolveLine(l, ctx),
  );
  const base = intlFreightBuyUsd(firstPass, ctx.fx);
  return firstPass.map((l) =>
    l.code === FORWARDING_CODE
      ? resolveLine(l, { ...ctx, forwardingBaseUsd: base })
      : l,
  );
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

export function packingRow(
  p: PackingItem,
  factor: number = VOLUMETRIC_FACTOR,
): PackingRow {
  const l = Number(p.length_cm) || 0;
  const w = Number(p.width_cm) || 0;
  const h = Number(p.height_cm) || 0;
  const actual = Number(p.actual_kg) || 0;
  const qty = Number(p.qty_ctns) || 0;
  // A manually entered CBM wins; a blank one falls back to L×W×H.
  const override = p.cbm === "" || p.cbm == null ? NaN : Number(p.cbm);
  const cbm = Number.isFinite(override) ? override : (l * w * h) / 1_000_000;
  const volumeKg = cbm * factor;
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

export function packingTotals(
  items: PackingItem[] | null | undefined,
  factor: number = VOLUMETRIC_FACTOR,
): PackingTotals {
  let qty = 0;
  let totalCbm = 0;
  let totalActual = 0;
  let totalVolume = 0;
  (items || []).forEach((p) => {
    const r = packingRow(p, factor);
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
