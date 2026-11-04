// Quote drafts outside the Quote Builder screen: the blank draft and line
// factories, and "Load rates" from a tier rate sheet (0119). The Quote
// Builder and Motion AI's quote drafts both use these, so an AI draft is
// priced by exactly the same code as a person pressing Load rates.

import { getPartnerRateSheets, listPartnerRateSheets } from "./db";
import { sellFromBuy, type FxRates } from "./calc";
import { newReference, todayPlusDays } from "./format";
import {
  PARTNER_KINDS,
  lineSection,
  partnerIdKey,
  sectionsForIncoterm,
  sheetIdKey,
  tierLine,
  worksheetGroups,
  type PartnerSheets,
} from "./tariff";
import type { ChargeCategory, PackingItem, QuoteDraft, QuoteLine, TariffSheet } from "./types";

export function newPackingItem(position: number): PackingItem {
  return {
    position,
    length_cm: 0,
    width_cm: 0,
    height_cm: 0,
    actual_kg: 0,
    qty_pcs: 0,
    qty_ctns: 1,
    cbm: "",
  };
}

export function newLine(category: ChargeCategory, position: number): QuoteLine {
  return {
    position,
    category,
    code: "",
    description: "",
    cur: "USD",
    unit: "",
    qty: 1,
    qty_override: false,
    fee_rate: null,
    buy: 0,
    margin: 0,
    vat_pct: 0,
    sell: 0,
  };
}

export function blankDraft(): QuoteDraft {
  const mode: QuoteDraft["mode"] = "Air Freight (AIR)";
  return {
    id: null,
    reference: newReference(mode),
    customer_reference: "",
    client_id: "",
    lead_id: "",
    sales_person_id: "",
    supplier_id: "",
    consignee_id: "",
    consignee_lead_id: "",
    client_consignee_id: "",
    agent_id: "",
    transporter_id: "",
    clearing_agent_id: "",
    destination_agent_id: "",
    mode,
    commodity: "General Cargo",
    origin: "",
    destination: "",
    delivery_terms: "Door to Door",
    valid_until: todayPlusDays(14),
    status: "open",
    commercial_value: "",
    insurance_amount: "",
    vessel_name: "",
    voyage_no: "",
    routing: "",
    transit_time: "",
    mbl_no: "",
    hbl_no: "",
    container_no: "",
    container_type: "",
    etd: "",
    eta: "",
    provisional_delivery_date: "",
    incoterms: "",
    mawb_no: "",
    hawb_no: "",
    flight_no: "",
    flight_date: "",
    carrier_name: "",
    shipping_line: "",
    fx_usd_zar: "18.50",
    fx_cny_zar: "2.60",
    fx_eur_zar: "20.00",
    fx_gbp_zar: "0",
    sell_currency: "",
    value_currency: "ZAR",
    rate_tier: "silver",
    tariff_sheet_id: "",
    packing: [newPackingItem(0)],
    lines: [newLine("International Freight Charges", 0)],
  };
}

export type TierPartnerIds = Record<(typeof PARTNER_KINDS)[number], string>;

/** The charge lines a tier sheet gives a quote (the Quote Builder's "Load
 *  rates"): each code's buy follows the linked partner rate sheet (weight
 *  break by the chargeable weight) plus the tier margin; sell-only codes take
 *  the sheet's Sell (R). A partner already on the quote wins over the
 *  sheet's, using their rate sheet for the same mode + route. Only the
 *  sections the incoterm covers. Returns the lines and the partners used. */
export async function buildTierLines(input: {
  sheet: TariffSheet;
  /** Partners already picked on the quote ("" = none). */
  quotePartners: Partial<TierPartnerIds>;
  incoterms: string | null | undefined;
  chargeableKg: number;
  fx: FxRates;
}): Promise<{ lines: QuoteLine[]; partnerIds: TierPartnerIds }> {
  const { sheet } = input;
  const partnerIds = Object.fromEntries(
    PARTNER_KINDS.map((k) => [k, input.quotePartners[k] || sheet[partnerIdKey(k)] || ""]),
  ) as TierPartnerIds;
  const own = PARTNER_KINDS.filter(
    (k) => partnerIds[k] && partnerIds[k] === sheet[partnerIdKey(k)] && sheet[sheetIdKey(k)],
  );
  const fetched = await getPartnerRateSheets(own.map((k) => sheet[sheetIdKey(k)] as string));
  const partners: PartnerSheets = {};
  for (const k of PARTNER_KINDS) {
    const pid = partnerIds[k];
    if (!pid) continue;
    if (own.includes(k)) {
      partners[k] = fetched.find((s) => s.id === sheet[sheetIdKey(k)]) ?? null;
      continue;
    }
    const theirs = (await listPartnerRateSheets(k, pid)).filter((s) => s.mode === sheet.mode);
    partners[k] =
      theirs.find((s) => s.route.toLowerCase() === sheet.route.toLowerCase()) ?? theirs[0] ?? null;
  }
  const lines: QuoteLine[] = [];
  const sections = sectionsForIncoterm(input.incoterms);
  for (const g of worksheetGroups(sheet.mode))
    for (const item of g.items) {
      if (
        !sections.includes(g.category) ||
        !(item.code in sheet.lines) ||
        lineSection(item, sheet.lines[item.code]) !== g.category
      )
        continue;
      const r = tierLine(sheet, item, partners, input.chargeableKg);
      if (r.sellOnly ? !(r.sell != null && r.sell > 0) : r.buy == null) continue;
      const base = {
        ...newLine(g.category, lines.length),
        code: item.code,
        description: sheet.lines[item.code]?.description ?? item.description,
        unit: sheet.lines[item.code]?.unit ?? item.unit,
        qty: 1,
        vat_pct: item.vat_pct ?? 0,
      };
      lines.push(
        r.sellOnly
          ? { ...base, cur: item.cur, buy: 0, margin: 0, sell: r.sell as number }
          : {
              ...base,
              cur: r.cur,
              buy: r.buy as number,
              margin: r.margin,
              sell: sellFromBuy(r.buy as number, r.margin, r.cur, input.fx),
            },
      );
    }
  return { lines, partnerIds };
}
