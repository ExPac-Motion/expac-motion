// Motion AI quote drafts (0217): on Approve, the browser builds the quote
// the same way a person would in the Quote Builder (company defaults, the
// customer's rate tier, "Load rates" from the tier sheet via tierQuote.ts),
// saves it as a New Lead quote marked ai_draft, and reports back.

import { supabase } from "./supabase";
import { getCompanySettings, listTariffSheets, saveQuote } from "./db";
import { packingTotals, volumetricFactor } from "./calc";
import { newReference } from "./format";
import { blankDraft, buildTierLines, newPackingItem } from "./tierQuote";
import { applyTierMargins, type QuoteDraft, type QuoteMode, type RateTierId } from "./types";

export interface AiQuoteInput {
  client_id?: string;
  lead_id?: string;
  mode: string;
  origin?: string;
  destination?: string;
  commodity?: string;
  incoterms?: string;
  delivery_terms?: string;
  customer_reference?: string;
  rate_tier?: string;
  tariff_sheet_id?: string;
  packing?: { qty_ctns?: number; length_cm?: number; width_cm?: number; height_cm?: number; actual_kg?: number }[];
}

export async function buildAndSaveAiQuote(input: AiQuoteInput): Promise<{ quote_id: string; reference: string; lines: number }> {
  const settings = await getCompanySettings();
  applyTierMargins(settings.tier_margins);
  const mode = input.mode as QuoteMode;
  const d: QuoteDraft = {
    ...blankDraft(),
    mode,
    reference: newReference(mode),
    client_id: input.client_id ?? "",
    lead_id: input.client_id ? "" : input.lead_id ?? "",
    origin: input.origin ?? "",
    destination: input.destination ?? "",
    commodity: input.commodity || "General Cargo",
    incoterms: input.incoterms || settings.default_incoterm || "",
    delivery_terms: input.delivery_terms || "Door to Door",
    customer_reference: input.customer_reference ?? "",
    fx_usd_zar: String(settings.default_fx_usd_zar),
    fx_cny_zar: String(settings.default_fx_cny_zar),
    fx_eur_zar: String(settings.default_fx_eur_zar),
    rate_tier: (input.rate_tier as RateTierId) || "silver",
    tariff_sheet_id: input.tariff_sheet_id ?? "",
  };
  const pack = (input.packing ?? []).filter((p) => Number(p.qty_ctns) > 0 || Number(p.actual_kg) > 0);
  if (pack.length) {
    d.packing = pack.map((p, i) => ({
      ...newPackingItem(i),
      qty_ctns: Number(p.qty_ctns) || 1,
      length_cm: Number(p.length_cm) || 0,
      width_cm: Number(p.width_cm) || 0,
      height_cm: Number(p.height_cm) || 0,
      actual_kg: Number(p.actual_kg) || 0,
    }));
  }
  if (d.tariff_sheet_id) {
    const sheet = (await listTariffSheets()).find((s) => s.id === d.tariff_sheet_id);
    if (sheet) {
      const kg = packingTotals(d.packing, volumetricFactor(mode)).chargeable;
      const { lines, partnerIds } = await buildTierLines({
        sheet,
        quotePartners: {},
        incoterms: d.incoterms,
        chargeableKg: kg,
        fx: {
          usd: Number(d.fx_usd_zar) || 0,
          cny: Number(d.fx_cny_zar) || 0,
          eur: Number(d.fx_eur_zar) || 0,
          gbp: Number(d.fx_gbp_zar) || 0,
        },
      });
      if (lines.length) d.lines = lines;
      d.rate_tier = sheet.tier;
      d.agent_id = partnerIds.agent;
      d.transporter_id = partnerIds.transporter;
      d.clearing_agent_id = partnerIds.clearing_agent;
      d.destination_agent_id = partnerIds.destination_agent;
    }
  }
  const id = await saveQuote(d);
  const { error } = await supabase.from("quotes").update({ ai_draft: true }).eq("id", id);
  if (error) throw error;
  const priced = d.lines.filter((l) => l.code).length;
  return { quote_id: id, reference: d.reference, lines: priced };
}
