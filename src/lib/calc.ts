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
  eur: number;
}

/** Pulls FX rates off a quote (or draft-like object) with safe fallbacks. */
export function fxOf(q: {
  fx_usd_zar?: number | string | null;
  fx_cny_zar?: number | string | null;
  fx_eur_zar?: number | string | null;
}): FxRates {
  return {
    usd: Number(q?.fx_usd_zar) || 0,
    cny: Number(q?.fx_cny_zar) || 0,
    eur: Number(q?.fx_eur_zar) || 0,
  };
}

export function buyRate(cur: QuoteLine["cur"], fx: FxRates): number {
  if (cur === "USD") return fx.usd;
  if (cur === "CNY") return fx.cny;
  if (cur === "EUR") return fx.eur;
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

/** A line whose whole amount IS a VAT amount (e.g. Customs VAT): vat_pct 100.
 *  It carries no VAT-exclusive value — the sell is the tax itself. */
export function isVatOnlyLine(l: Pick<QuoteLine, "vat_pct">): boolean {
  return lineVatPct(l) >= 100;
}

/** VAT-exclusive ZAR value of a line: 0 for a VAT-only line, else lineTotal. */
export function lineNet(l: QuoteLine): number {
  return isVatOnlyLine(l) ? 0 : lineTotal(l);
}

/** ZAR VAT amount on a line: the whole amount for a VAT-only line, otherwise
 *  lineTotal x vat_pct/100. */
export function lineVat(l: QuoteLine): number {
  return isVatOnlyLine(l)
    ? lineTotal(l)
    : lineTotal(l) * (lineVatPct(l) / 100);
}

/** ZAR line total including VAT (net + VAT — equals lineTotal either way). */
export function lineTotalIncl(l: QuoteLine): number {
  return lineNet(l) + lineVat(l);
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

/** ExPac sell-only codes: no buy cost — the operator types the sell. Picking
 *  the code pre-fills a suggested sell (see serviceFeePrefillZar), then every
 *  cell is a normal editable field. */
export const INSURANCE_CODE = "IN-01";
export const FORWARDING_CODE = "FW-01";
export const DISBURSEMENT_CODE = "DIS-01";
export const CUSTOMS_CLEARANCE_CODE = "CU-05";
export const SERVICE_FEE_CODES: readonly string[] = [
  INSURANCE_CODE,
  FORWARDING_CODE,
  DISBURSEMENT_CODE,
  CUSTOMS_CLEARANCE_CODE,
];
/** Default suggested rates (decimal) for the pre-fill. */
export const FORWARDING_RATE = 0.01;
export const DISBURSEMENT_RATE = 0.025;
/** Customs VAT / Customs Duty charge codes — the base for the DIS-01 pre-fill. */
export const CUSTOMS_VAT_CODE = "CU-02";
export const CUSTOMS_DUTY_CODE = "CU-03";

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
      if (l.cur === "EUR") return s + (fx.usd ? (amt * fx.eur) / fx.usd : 0);
      return s + (fx.usd ? amt / fx.usd : 0); // ZAR
    }, 0);
}

/**
 * Σ(qty × buy) over the Customs VAT (CU-02) + Customs Duty (CU-03) lines,
 * converted to ZAR — the base the DIS-01 2.5% disbursement fee is charged on.
 */
export function customsVatDutyZar(lines: QuoteLine[], fx: FxRates): number {
  return (lines || [])
    .filter((l) => l.code === CUSTOMS_VAT_CODE || l.code === CUSTOMS_DUTY_CODE)
    .reduce(
      (s, l) =>
        s + (Number(l.qty) || 0) * (Number(l.buy) || 0) * buyRate(l.cur, fx),
      0,
    );
}

/** Suggested SELL (R) to drop in when a sell-only code is picked.
 *  IN-01 = 0.50% of Commercial Value ($→ZAR); FW-01 = 1% of International
 *  Freight ($→ZAR); DIS-01 = 2.5% of Customs VAT + Duty (ZAR); CU-05 has no
 *  formula, so 0. `lines` should exclude the line being picked. */
export function serviceFeePrefillZar(
  code: string,
  lines: QuoteLine[],
  fx: FxRates,
  commercialValue: number | string = "",
): number {
  if (code === INSURANCE_CODE)
    return insuranceAmount(commercialValue) * (fx.usd || 0);
  if (code === FORWARDING_CODE)
    return intlFreightBuyUsd(lines, fx) * FORWARDING_RATE * (fx.usd || 0);
  if (code === DISBURSEMENT_CODE)
    return customsVatDutyZar(lines, fx) * DISBURSEMENT_RATE;
  return 0;
}

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

  // Sell-only codes (IN-01 / FW-01 / DIS-01 / CU-05): there is no buy cost and
  // no markup — the whole amount is a selling rate, held only in sell (R)
  // (pre-filled on pick, see serviceFeePrefillZar). buy / margin are pinned to
  // 0 everywhere (builder, quote detail, print, list totals) so nothing that
  // was ever stored on the row leaks back into a Buy figure.
  if (SERVICE_FEE_CODES.includes(line.code)) {
    return { ...line, qty, buy: 0, margin: 0, sell: Number(line.sell) || 0 };
  }

  // Customs VAT (CU-02): the whole amount is tax — a 100%-VAT line with no buy
  // cost and no markup. The sell stands as entered / stored.
  if (line.code === CUSTOMS_VAT_CODE) {
    return {
      ...line,
      qty,
      buy: 0,
      margin: 0,
      vat_pct: 100,
      sell: Number(line.sell) || 0,
    };
  }

  // Customs Duty (CU-03): a recoverable disbursement. The operator types the
  // amount once into Sell (R); it is billed to the client at cost (buy mirrors
  // sell, so the line makes no margin) and is always zero-rated for VAT.
  if (line.code === CUSTOMS_DUTY_CODE) {
    const amt = Number(line.sell) || 0;
    return { ...line, qty, buy: amt, margin: 0, vat_pct: 0, sell: amt };
  }

  return {
    ...line,
    qty,
    buy,
    margin,
    sell: sellFromBuy(buy, margin, line.cur, ctx.fx),
  };
}

/** Resolves a whole quote's lines. */
export function resolveLines(lines: QuoteLine[], ctx: LineContext): QuoteLine[] {
  return (lines || []).map((l) => resolveLine(l, ctx));
}

/** ZAR buy cost for a line: qty x buy x fx rate for the line's currency. */
export function lineCostZar(l: QuoteLine, fx: FxRates): number {
  return (Number(l.qty) || 0) * (Number(l.buy) || 0) * buyRate(l.cur, fx);
}

export function chargeTotals(
  lines: QuoteLine[] | null | undefined,
  fx: FxRates = { usd: 0, cny: 0, eur: 0 },
): ChargeTotals {
  let cost = 0;
  let sell = 0;
  let vat = 0;
  (lines || []).forEach((l) => {
    // A VAT-only line (Customs VAT) is a pure pass-through — no cost, no
    // margin, no net sale; the whole amount lands in the VAT bucket.
    cost += isVatOnlyLine(l) ? 0 : lineCostZar(l, fx);
    sell += lineNet(l);
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
    const subtotal = groupLines.reduce((s, x) => s + lineNet(x.line), 0);
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
