/**
 * Req for Quote (RFQ): a one-off rate request sent to an agent when the
 * tariff sheets can't price a shipment (peak season, odd lanes). Built from
 * the quotation's own details, with no customer or consignee on it, so the
 * agent can't go around ExPac.
 */

import { CHARGE_CATALOG } from "./chargeCatalog";
import { PUBLIC_APP_URL } from "./mailStyle";
import { formatDate, portCode } from "./format";
import { PARTNER_LABEL, isSellOnlyCode, partnerSectionsForIncoterm } from "./tariff";
import { CHARGE_CATEGORIES, CHARGE_UNITS, LINE_CURRENCIES } from "./types";
import type { ChargeCategory, Contact, LineCurrency, PartnerKind, Quote, QuoteLine, QuoteMode } from "./types";
import { LOCODES } from "./locodes";
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

/** A requested charge with its section (what the RFQ stores and prints). */
export interface RfqChargeItem extends RfqChargeRow {
  category: ChargeCategory;
}

/** The sections this partner type prices under the quote's incoterm; when
 *  the incoterm leaves none of theirs (e.g. an agent on a DAP quote), all of
 *  their sections, so the request still asks for something. */
export function rfqSections(kind: PartnerKind, incoterm: string | null | undefined): ChargeCategory[] {
  const own = partnerSectionsForIncoterm(kind, incoterm);
  if (own.length) return own;
  return partnerSectionsForIncoterm(kind, kind === "agent" ? "EXW" : "DDP");
}

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");
const isSea = (mode: string) => mode.startsWith("Sea");

/**
 * The default charges an RFQ asks for (user, 2026-11-12), per section:
 *   Air EXW: Air Freight Fee + Terminal Handling Fee; Pick Up Fee + Customs
 *            and Documentation Fee.   Air FOB: Air Freight Fee only.
 *   Sea follows the same pattern (Ocean Freight + Release Fee on EXW).
 * Warehousing, handling in/out, battery check and safety test report are
 * never defaults; staff add them per request. `null` = the section's
 * rate-card codes for the mode (other partner types).
 */
function defaultCodes(kind: PartnerKind, category: ChargeCategory, mode: string, incoterm: string | null | undefined): string[] | null {
  const exw = ["", "EXW"].includes((incoterm ?? "").trim().toUpperCase());
  if (kind === "agent") {
    if (category === "International Freight Charges") {
      if (isAir(mode)) return exw ? ["AF-01", "AF-02"] : ["AF-01"];
      if (isSea(mode)) return exw ? ["OF-01", "OF-02"] : ["OF-01"];
      return null;
    }
    if (category === "Ex-Works Charges") return ["OR-01", "OR-02"];
    if (category === "FOB Charges") return [];
  }
  if (kind === "transporter") return ["TR-01", "TR-02"];
  return null;
}

/** Every rate-card code a partner type could be asked for in a section
 *  (the "Add a charge" list); warehousing codes included. */
export function rfqCatalogFor(kind: PartnerKind, category: ChargeCategory, mode: string): RfqChargeItem[] {
  return CHARGE_CATALOG.filter(
    (c) =>
      (c.category === category || (c.alsoIn ?? []).includes(category)) &&
      (!c.modes || (c.modes as string[]).includes(mode)) &&
      !isSellOnlyCode(c.code) &&
      (kind !== "transporter" || /^(TR|WH)-/.test(c.code)) &&
      (kind !== "destination_agent" || !/^(TR|WH)-/.test(c.code)),
  ).map((c) => ({
    category,
    code: c.code,
    description: c.description,
    unit: c.unit,
    cur: c.curIn?.[category] ?? c.cur,
  }));
}

/** The charges the agent is asked to price, by section: the quote's own
 *  lines in those sections when it has any, otherwise the defaults above.
 *  Sell-only codes (fees, VAT, duty) are never asked for. */
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
      if (fromQuote.length) return { category, rows: fromQuote as RfqChargeRow[] };
      const all = rfqCatalogFor(kind, category, quote.mode).filter((c) => !/^WH-/.test(c.code));
      const pick = defaultCodes(kind, category, quote.mode, quote.incoterms);
      const rows: RfqChargeRow[] = pick ? all.filter((c) => pick.includes(c.code)) : all;
      return { category, rows };
    })
    .filter((g) => g.rows.length > 0);
}

export function rfqDefaultCharges(quote: Pick<Quote, "mode" | "incoterms" | "quote_lines">, kind: PartnerKind): RfqChargeItem[] {
  return rfqChargeGroups(quote, kind).flatMap((g) => g.rows.map((r) => ({ ...r, category: g.category })));
}

/** Group a charge list by section, in the usual section order. */
export function groupRfqCharges(items: RfqChargeItem[]): { category: ChargeCategory; rows: RfqChargeRow[] }[] {
  return CHARGE_CATEGORIES.map((category) => ({
    category,
    rows: items.filter((i) => i.category === category),
  })).filter((g) => g.rows.length > 0);
}

/** Charges in a print URL: "<section index>:<code>" joined by commas. */
export function encodeRfqCharges(items: RfqChargeItem[]): string {
  return items.map((i) => `${CHARGE_CATEGORIES.indexOf(i.category)}:${i.code}`).join(",");
}
export function decodeRfqCharges(
  s: string,
  quote: Pick<Quote, "mode" | "quote_lines">,
): RfqChargeItem[] {
  return s
    .split(",")
    .map((part): RfqChargeItem | null => {
      const [i, code] = part.split(":");
      const category = CHARGE_CATEGORIES[Number(i)];
      if (!category || !code) return null;
      const line = (quote.quote_lines ?? []).find((l) => l.category === category && l.code === code);
      if (line) return { category, code, description: line.description, unit: line.unit, cur: line.cur };
      const item = CHARGE_CATALOG.find((c) => c.code === code);
      return item
        ? { category, code, description: item.description, unit: item.unit, cur: item.curIn?.[category] ?? item.cur }
        : null;
    })
    .filter((x): x is RfqChargeItem => x !== null);
}

/** Replies are due 48 hours from the date of issue. */
export function defaultReplyBy(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shipment facts shown to the agent, identical on the PDF and the reply
 *  form so the two never disagree. Never any customer / consignee / shipper. */
export function rfqFactRows(f: {
  reference: string;
  rfqDate: string | null;
  replyBy: string | null;
  mode: string;
  origin: string | null;
  destination: string | null;
  incoterms: string | null;
  deliveryTerms: string | null;
  commodity: string | null;
  readyDate: string | null;
  etd: string | null;
  containerType: string | null;
  pickup: string | null;
  kind: PartnerKind;
}): [string, string][] {
  const d = (iso: string | null) => (iso ? formatDate(iso) : "-");
  const t = (v: string | null) => v?.trim() || "-";
  return [
    ["RFQ Number", `RFQ-${f.reference}`],
    ["RFQ Date", d(f.rfqDate)],
    ["Reply By", d(f.replyBy)],
    ["Mode", f.mode],
    ["Port of Load", f.origin ? portCode(f.origin) : "-"],
    ["Port of Discharge", f.destination ? portCode(f.destination) : "-"],
    ["Origin", t(f.origin)],
    ["Destination", t(f.destination)],
    ["Incoterms", t(f.incoterms)],
    ["Delivery Terms", t(f.deliveryTerms)],
    ["Commodity", t(f.commodity)],
    ["Cargo Ready", d(f.readyDate)],
    ["ETD", d(f.etd)],
    ...(isSea(f.mode) ? ([["Container Type", t(f.containerType)]] as [string, string][]) : []),
    ["Collect From", t(f.pickup)],
    ["Service Scope", rfqSections(f.kind, f.incoterms).map((c) => SCOPE_LABEL[c] ?? c).join(", ")],
    ["Rates In", "Currency per line, excl. VAT"],
  ];
}

const SCOPE_LABEL: Record<string, string> = {
  "International Freight Charges": "International freight",
  "Ex-Works Charges": "Ex-works / pick up",
  "FOB Charges": "FOB charges",
  "Destination Handling and Delivery Charges": "Destination handling and delivery",
  "Customs Clearance, VAT and Duty Charges": "Customs clearance",
};

export interface RfqOptions {
  kind: PartnerKind;
  replyBy: string;
  /** The agent's company, printed in the parties row. */
  agent?: string;
  /** The agent's reply-link token: the sheet prints their online reply link. */
  token?: string;
  /** Free text from the operator, printed under Notes to Agent. */
  notes?: string;
  /** The charges asked for, when staff changed the defaults. */
  charges?: RfqChargeItem[];
}

export function rfqPrintPath(quoteId: string, o: RfqOptions): string {
  const p = new URLSearchParams({ kind: o.kind, reply: o.replyBy });
  if (o.agent?.trim()) p.set("agent", o.agent.trim());
  if (o.notes?.trim()) p.set("notes", o.notes.trim());
  if (o.token) p.set("t", o.token);
  if (o.charges) p.set("c", encodeRfqCharges(o.charges));
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

/** Units an agent can quote a charge per: ExPac's own charge units (the
 *  Quote Builder's list), so the builder works out the qty from them. */
export const RFQ_UNITS: { value: string; label: string }[] = CHARGE_UNITS.map((u) => ({ value: u, label: u }));
/** The unit choices for a row, keeping a unit that isn't in the list
 *  (a blank unit = once per shipment). */
export function rfqUnitOptions(current: string): { value: string; label: string }[] {
  if (RFQ_UNITS.some((u) => u.value === current)) return RFQ_UNITS;
  return [{ value: current, label: current || "Shipment" }, ...RFQ_UNITS];
}

/* ---------- trade routes -> agents ---------- */

/** "CNSHA → ZAJNB" -> ["CNSHA", "ZAJNB"]. */
export function routeEnds(route: string): [string, string] {
  const [a = "", b = ""] = route.split(/\s*(?:→|->)\s*/);
  return [a.trim().toUpperCase(), b.trim().toUpperCase()];
}

/** Country name for a UN/LOCODE ("CNSHA" -> "China"), from the port list. */
export function locodeCountry(code: string): string | null {
  const cc = code.slice(0, 2).toUpperCase();
  return LOCODES.find((l) => l.code.slice(0, 2) === cc)?.country ?? null;
}

/**
 * The partners of a type on a trade route: shipping agents at the route's
 * origin, the other types at its destination. A partner is on it when its
 * coverage ports include that port, or (no ports listed) its coverage
 * countries include that port's country, or a tier sheet for the route
 * links it. Only partners with an email address can be sent an RFQ.
 */
export function partnersOnRoute<P extends Pick<Contact, "id" | "email" | "ports" | "countries">>(
  route: string,
  partners: P[],
  kind: PartnerKind,
  linkedIds: string[] = [],
): P[] {
  const [from, to] = routeEnds(route);
  const port = kind === "agent" ? from : to;
  const country = locodeCountry(port)?.toLowerCase();
  return partners.filter((p) => {
    if (!p.email?.trim()) return false;
    if (linkedIds.includes(p.id)) return true;
    const ports = (p.ports ?? []).map((x) => x.trim().toUpperCase());
    if (ports.includes(port)) return true;
    if (ports.length > 0) return false;
    return !!country && (p.countries ?? []).some((c) => c.trim().toLowerCase() === country);
  });
}
