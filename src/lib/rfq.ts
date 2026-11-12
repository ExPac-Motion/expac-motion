/**
 * Req for Quote (RFQ): a one-off rate request sent to an agent when the
 * tariff sheets can't price a shipment (peak season, odd lanes). Built from
 * the quotation's own details, with no customer or consignee on it, so the
 * agent can't go around ExPac.
 */

import { CHARGE_CATALOG } from "./chargeCatalog";
import { PUBLIC_APP_URL } from "./mailStyle";
import { PARTNER_LABEL, isSellOnlyCode, partnerSectionsForIncoterm } from "./tariff";
import { CHARGE_CATEGORIES, LINE_CURRENCIES } from "./types";
import type { ChargeCategory, LineCurrency, PartnerKind, Quote, QuoteLine, QuoteMode } from "./types";
import {
  OCEAN_LCL_DDP_CODE,
  autoQty,
  buyRate,
  fxOf,
  packingTotals,
  sellFromBuy,
  volumetricFactor,
  type FxRates,
  type PackingTotals,
} from "./calc";

export const RFQ_TITLE = "Request for Quote";

export const RFQ_KINDS: PartnerKind[] = ["agent", "destination_agent", "transporter", "clearing_agent"];
export const rfqKindLabel = (k: PartnerKind) => PARTNER_LABEL[k];

export function isRfqKind(v: string | null | undefined): v is PartnerKind {
  return RFQ_KINDS.includes(v as PartnerKind);
}

export interface RfqChargeRow {
  code: string;
  description: string;
  unit: string;
  cur: string;
}

/** The sections this partner type prices under the quote's incoterm; when
 *  the incoterm leaves none of theirs (e.g. an agent on a DAP quote), all of
 *  their sections, so the request still asks for something. */
export function rfqSections(kind: PartnerKind, incoterm: string | null | undefined): ChargeCategory[] {
  const own = partnerSectionsForIncoterm(kind, incoterm);
  if (own.length) return own;
  return partnerSectionsForIncoterm(kind, kind === "agent" ? "EXW" : "DDP");
}

/** The charges the agent is asked to price, by section: the quote's own
 *  lines in those sections when it has any, otherwise the rate-card codes
 *  for the mode. Sell-only codes (fees, VAT, duty) are never asked for. */
export function rfqChargeGroups(
  quote: Pick<Quote, "mode" | "incoterms" | "quote_lines">,
  kind: PartnerKind,
): { category: ChargeCategory; rows: RfqChargeRow[] }[] {
  return rfqSections(kind, quote.incoterms)
    .map((category) => {
      const seen = new Set<string>();
      const fromQuote = (quote.quote_lines ?? [])
        .filter((l) => l.category === category && l.code && !isSellOnlyCode(l.code))
        .filter((l) => (seen.has(l.code) ? false : (seen.add(l.code), true)))
        .map((l) => ({ code: l.code, description: l.description, unit: l.unit, cur: l.cur }));
      const rows: RfqChargeRow[] = fromQuote.length
        ? fromQuote
        : CHARGE_CATALOG.filter(
            (c) =>
              (c.category === category || (c.alsoIn ?? []).includes(category)) &&
              (!c.modes || (c.modes as string[]).includes(quote.mode)) &&
              !isSellOnlyCode(c.code) &&
              // Transporters only price transport / warehousing codes.
              (kind !== "transporter" || /^(TR|WH)-/.test(c.code)) &&
              (kind !== "destination_agent" || !/^(TR|WH)-/.test(c.code)),
          ).map((c) => ({
            code: c.code,
            description: c.description,
            unit: c.unit,
            cur: c.curIn?.[category] ?? c.cur,
          }));
      return { category, rows };
    })
    .filter((g) => g.rows.length > 0);
}

/** Two working days from today, ISO. */
export function defaultReplyBy(from = new Date()): string {
  const d = new Date(from);
  let left = 2;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface RfqOptions {
  kind: PartnerKind;
  replyBy: string;
  /** The agent's company, printed in the parties row. */
  agent?: string;
  /** The agent's reply-link token: the sheet prints their online reply link. */
  token?: string;
  /** Free text from the operator, printed under Notes to Agent. */
  notes?: string;
}

export function rfqPrintPath(quoteId: string, o: RfqOptions): string {
  const p = new URLSearchParams({ kind: o.kind, reply: o.replyBy });
  if (o.agent?.trim()) p.set("agent", o.agent.trim());
  if (o.notes?.trim()) p.set("notes", o.notes.trim());
  if (o.token) p.set("t", o.token);
  return `/quotes/${encodeURIComponent(quoteId)}/rfq?${p.toString()}`;
}

/** The agent's no-login reply form (public route /rfq/reply/:token). */
export function rfqReplyUrl(token: string): string {
  return `${PUBLIC_APP_URL}/rfq/reply/${token}`;
}

/* ---------- agent replies -> client quote ---------- */

/** One rate an agent sent back (quote_rfq_rates). */
export interface RfqReplyRate {
  category: string;
  code: string;
  description: string;
  unit: string;
  cur: string;
  rate: number | string | null;
  min_charge: number | string | null;
}

const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** Buy rate, qty and override for one agent rate on this shipment. The min
 *  charge wins when rate x qty comes out lower: it is billed as one unit
 *  (OF-06 is priced per 0.50 CBM block, so its one unit is qty 0.50). */
export function rfqLineFigures(
  r: Pick<RfqReplyRate, "code" | "unit" | "rate" | "min_charge">,
  mode: QuoteMode,
  pack: PackingTotals,
): { buy: number; qty: number; qtyOverride: boolean; total: number } | null {
  const rate = num(r.rate);
  const min = num(r.min_charge);
  if (rate == null && min == null) return null;
  const one = r.code === OCEAN_LCL_DDP_CODE ? 0.5 : 1;
  const auto = autoQty({ unit: r.unit, code: r.code, qty_override: false }, mode, pack);
  const qty = auto ?? 1;
  const mult = r.code === OCEAN_LCL_DDP_CODE ? qty / 0.5 : qty;
  const byRate = rate != null ? rate * mult : null;
  if (byRate != null && (min == null || byRate >= min)) {
    return { buy: rate as number, qty, qtyOverride: false, total: byRate };
  }
  return { buy: min as number, qty: one, qtyOverride: true, total: min as number };
}

/** Estimated ZAR buy total of a reply at the quote's exchange rates. */
export function rfqReplyTotalZar(
  rates: RfqReplyRate[],
  quote: Pick<Quote, "mode" | "packing_list_items" | "fx_usd_zar" | "fx_cny_zar" | "fx_eur_zar" | "fx_gbp_zar">,
): number {
  const pack = packingTotals(quote.packing_list_items ?? [], volumetricFactor(quote.mode));
  const fx = fxOf(quote);
  return rates.reduce((sum, r) => {
    const f = rfqLineFigures(r, quote.mode, pack);
    return f ? sum + f.total * buyRate(r.cur as LineCurrency, fx) : sum;
  }, 0);
}

/** The chosen reply as Quote Builder lines: same codes in the same section
 *  are replaced, every other line stays; the margin is the quote's tier
 *  margin. Extra charges the agent added (no code) come in as new lines. */
export function applyRfqRates(
  lines: QuoteLine[],
  rates: RfqReplyRate[],
  opts: { mode: QuoteMode; pack: PackingTotals; fx: FxRates; margin: number; fallback: ChargeCategory },
): { lines: QuoteLine[]; added: number; replaced: number } {
  const fresh: QuoteLine[] = [];
  for (const r of rates) {
    const f = rfqLineFigures(r, opts.mode, opts.pack);
    if (!f) continue;
    const category = (CHARGE_CATEGORIES as string[]).includes(r.category)
      ? (r.category as ChargeCategory)
      : opts.fallback;
    const item = r.code ? CHARGE_CATALOG.find((c) => c.code === r.code) : undefined;
    const cur = ((LINE_CURRENCIES as string[]).includes(r.cur) ? r.cur : "USD") as LineCurrency;
    fresh.push({
      position: 0,
      category,
      code: r.code,
      description: r.description || item?.description || "",
      cur,
      unit: r.unit,
      qty: f.qty,
      qty_override: f.qtyOverride || undefined,
      buy: f.buy,
      margin: opts.margin,
      vat_pct: item?.vat_pct ?? 0,
      sell: sellFromBuy(f.buy, opts.margin, cur, opts.fx),
    });
  }
  const key = (l: Pick<QuoteLine, "category" | "code">) => `${l.category}|${l.code}`;
  const incoming = new Set(fresh.filter((l) => l.code).map(key));
  const keep = lines.filter((l) => !(l.code && incoming.has(key(l))));
  const replaced = lines.length - keep.length;
  const merged = CHARGE_CATEGORIES.flatMap((c) => [
    ...keep.filter((l) => l.category === c),
    ...fresh.filter((l) => l.category === c),
  ]).map((l, i) => ({ ...l, position: i }));
  return { lines: merged, added: fresh.length - replaced, replaced };
}
