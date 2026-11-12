import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { COMPANY } from "../lib/company";
import { defaultReplyBy, isRfqKind, rfqChargeGroups } from "../lib/rfq";
import type { Rfq, RfqPublic } from "../lib/rfqDb";
import type { PackingItem, Quote } from "../lib/types";
import { RfqSheet } from "./RfqPrintPage";
import QuoteRfqPanel from "./quotes/QuoteRfqPanel";

/**
 * DEV-ONLY previews with made-up data, so the RFQ screens can be checked
 * without a login. Routes are only registered when import.meta.env.DEV.
 *   /quotes/demo/rfq                 the RFQ document (?kind=, ?mode=air)
 *   /quotes/demo/rfq?view=panel      the quote page's Agent rates tab
 *   /rfq/reply/demo                  the agent's reply form
 */

const PACKING = [
  { position: 0, length_cm: 120, width_cm: 100, height_cm: 110, actual_kg: 380, qty_pcs: 4, qty_ctns: 4, cbm: null },
  { position: 1, length_cm: 60, width_cm: 40, height_cm: 45, actual_kg: 22, qty_pcs: 30, qty_ctns: 30, cbm: null },
] as unknown as PackingItem[];

const DEMO_QUOTE = {
  id: "demo",
  reference: "SEA126049",
  mode: "Sea Freight (LCL)",
  origin: "CNSHA Shanghai, China",
  destination: "ZADUR Durban, South Africa",
  incoterms: "EXW",
  commodity: "General Cargo",
  request_ready_date: "2026-11-20",
  etd: "2026-11-27",
  container_type: null,
  request_pickup: "Pudong, Shanghai",
  quote_lines: [],
  packing_list_items: PACKING,
  fx_usd_zar: 18.2,
  fx_cny_zar: 2.55,
  fx_eur_zar: 19.8,
  fx_gbp_zar: 23.1,
} as unknown as Quote;

const demoCharges = () =>
  rfqChargeGroups(DEMO_QUOTE, "agent").flatMap((g) => g.rows.map((r) => ({ ...r, category: g.category })));

export const RFQ_PUBLIC_DEMO = (): RfqPublic => ({
  rfq_number: "RFQ-SEA126049",
  mode: DEMO_QUOTE.mode,
  origin: DEMO_QUOTE.origin,
  destination: DEMO_QUOTE.destination,
  incoterms: "EXW",
  commodity: "General Cargo",
  ready_date: "2026-11-20",
  etd: "2026-11-27",
  container_type: null,
  pickup: "Pudong, Shanghai",
  reply_by: defaultReplyBy(),
  notes: "Please quote direct sailing if available. Cargo is stackable.",
  charges: demoCharges().slice(0, 6),
  company: "Demo Logistics Co. Ltd",
  status: "awaiting",
  responded_at: null,
  validity: null,
  transit_time: null,
  remarks: null,
  packing: PACKING as unknown as RfqPublic["packing"],
  rates: [],
});

function demoRfqs(): Rfq[] {
  const charges = demoCharges().slice(0, 5);
  const rate = (code: string, cur: string, r: number | null, min: number | null, remarks: string | null = null) => {
    const c = charges.find((x) => x.code === code)!;
    return { position: 0, category: c.category, code, description: c.description, unit: c.unit, cur, rate: r, min_charge: min, remarks };
  };
  const base = { rfq_id: "r1", quote_id: "demo", partner_id: null, contact: null, token: "demo", remarks: null };
  return [
    {
      id: "r1",
      quote_id: "demo",
      partner_kind: "agent",
      reply_by: defaultReplyBy(),
      notes: "Please quote direct sailing if available.",
      charges,
      created_at: new Date().toISOString(),
      quote_rfq_recipients: [
        {
          ...base,
          id: "a",
          email: "rates@demo-logistics.example",
          company: "Demo Logistics Co. Ltd",
          status: "received",
          sent_at: "2026-11-12T08:00:00Z",
          responded_at: "2026-11-12T13:20:00Z",
          responded_via: "link",
          validity: "30/11/2026",
          transit_time: "24 days direct",
          quote_rfq_rates: [rate("OF-01", "USD", 38, 45), rate("OF-02", "USD", 55, null), rate("OR-01", "USD", 120, null, "Pudong only")],
        },
        {
          ...base,
          id: "b",
          email: "quotes@sample-freight.example",
          company: "Sample Freight Ltd",
          status: "received",
          sent_at: "2026-11-12T08:00:00Z",
          responded_at: "2026-11-12T15:05:00Z",
          responded_via: "staff",
          validity: "Month end",
          transit_time: "29 days via SIN",
          quote_rfq_rates: [rate("OF-01", "USD", 32, 60), rate("OF-02", "USD", 65, null), rate("OR-01", "CNY", 900, null)],
        },
        {
          ...base,
          id: "c",
          email: "ops@new-agent.example",
          company: null,
          status: "awaiting",
          sent_at: "2026-11-12T08:00:00Z",
          responded_at: null,
          responded_via: null,
          validity: null,
          transit_time: null,
          quote_rfq_rates: [],
        },
      ],
    },
  ] as Rfq[];
}

export default function RfqDemoPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [seeded] = useState(() => {
    qc.setQueryData(["quote_rfqs", "demo"], demoRfqs());
    return true;
  });
  if (params.get("view") === "panel" && seeded) {
    return (
      <div className="main" style={{ padding: 24 }}>
        <QuoteRfqPanel quote={DEMO_QUOTE} onNew={() => undefined} />
      </div>
    );
  }
  const k = params.get("kind");
  const air = params.get("mode") === "air";
  return (
    <div className="qs-wrap">
      <RfqSheet
        q={{ ...DEMO_QUOTE, ...(air ? { mode: "Air Freight (AIR)", reference: "AIR126101" } : {}) }}
        company={{ ...COMPANY, tel: "+27 31 000 0000", email: "support@expac.co.za" }}
        me="Demo Operator"
        ready
        kind={isRfqKind(k) ? k : "agent"}
        replyBy={defaultReplyBy()}
        agent="Demo Logistics Co. Ltd"
        notes={params.get("notes") ?? "Please quote direct sailing if available. Cargo is stackable."}
        token={params.get("t") ?? undefined}
      />
    </div>
  );
}
