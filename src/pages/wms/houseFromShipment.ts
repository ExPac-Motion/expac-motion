// Houses from active shipments (0139): every air / sea shipment travels on a
// house document (HAWB / HBL) — ExPac's or the origin agent's — on its own or
// under a master. These helpers turn a shipment into a consolidation house.
import { VOLUMETRIC_FACTOR, packingTotals, volumetricFactor } from "../../lib/calc";
import type { Contact, Job, Quote, QuoteMode } from "../../lib/types";
import { round, wmCbm, type ConsolMode, type WmsConsol, type WmsConsolHouse, type WmsReceipt } from "../../lib/wms";
import { EXPAC_NOTIFY } from "./WmsConsols";

/** Which consolidation a shipment's mode belongs on (null: road — no master). */
export function consolModeFor(mode: QuoteMode | string | null | undefined): ConsolMode | null {
  const m = mode ?? "";
  if (m.startsWith("Air") || m.startsWith("Courier")) return "air";
  if (m === "Sea Freight (LCL)") return "lcl";
  if (m === "Sea Freight (FCL)") return "fcl";
  return null;
}

/** Air shipments go on air masters; any sea shipment (LCL or FCL) can go on an
 *  LCL groupage or FCL consolidation (e.g. a buyer's consolidation into an FCL). */
export function shipmentFitsConsol(mode: QuoteMode | string | null | undefined, consol: ConsolMode): boolean {
  const m = consolModeFor(mode);
  if (!m) return false;
  return consol === "air" ? m === "air" : m !== "air";
}

/** Shipment ids already on a master that hasn't left yet. */
export function jobsOnMasters(consols: WmsConsol[], exceptConsolId?: string): Map<string, WmsConsol> {
  const map = new Map<string, WmsConsol>();
  for (const c of consols) {
    if (c.id === exceptConsolId) continue;
    for (const h of c.houses) if (h.job_id) map.set(h.job_id, c);
  }
  return map;
}

function block(co?: Pick<Contact, "company" | "address" | "phone" | "company_phone"> | null): string | null {
  if (!co) return null;
  return [co.company, co.address, co.company_phone || co.phone ? `TEL: ${co.company_phone || co.phone}` : null]
    .filter(Boolean)
    .join("\n");
}

/** The house document number already on the shipment (its quote). */
export function shipmentHouseNo(quote: Quote | undefined, consol: ConsolMode): string | null {
  return (consol === "air" ? quote?.hawb_no : quote?.hbl_no) || null;
}

export function houseFromShipment(args: {
  job: Job;
  quote: Quote | undefined;
  consolMode: ConsolMode;
  receipts: WmsReceipt[];
  client: (id: string | null | undefined) => Contact | undefined;
  supplier: (id: string | null | undefined) => Contact | undefined;
  containerNo?: string | null;
  position: number;
}): WmsConsolHouse {
  const { job, quote, consolMode, receipts, client, supplier } = args;
  const sea = consolMode !== "air";
  // Goods already in the warehouse for this shipment win over the quote's packing list.
  const recs = receipts.filter((r) => r.job_id === job.id && r.on_hand > 0);
  let pieces: number;
  let gross: number;
  let cbm: number;
  if (recs.length) {
    pieces = recs.reduce((s, r) => s + r.on_hand, 0);
    gross = recs.reduce((s, r) => s + r.on_hand_kg, 0);
    cbm = recs.reduce((s, r) => s + r.on_hand_cbm, 0);
  } else {
    const pk = packingTotals(quote?.packing_list_items ?? [], volumetricFactor(job.mode));
    pieces = pk.qty;
    gross = pk.totalActual;
    cbm = pk.totalCbm;
  }
  const houseNo = shipmentHouseNo(quote, consolMode);
  const consignee = client(quote?.consignee_id ?? null) ?? client(job.client_id);
  const types = [...new Set(recs.map((r) => r.package_type).filter(Boolean))];
  return {
    position: args.position,
    job_id: job.id,
    // A number already on the shipment is usually the origin agent's house document.
    issued_by: houseNo ? "agent" : "expac",
    house_no: houseNo,
    client_id: job.client_id,
    shipper: block(supplier(job.supplier_id) ?? null) ?? job.supplier?.company ?? null,
    consignee: block(consignee ?? null) ?? job.client?.company ?? null,
    accounting_info: EXPAC_NOTIFY,
    nature_of_goods: quote?.commodity || [...new Set(recs.map((r) => r.description).filter(Boolean))].join(", ") || null,
    handling_info: null,
    marks: [...new Set(recs.map((r) => r.marks).filter(Boolean))].join("\n") || null,
    package_type: types.length === 1 ? types[0] : sea ? "Packages" : null,
    container_no: sea ? args.containerNo ?? job.container_no ?? null : null,
    pieces,
    gross_kg: round(gross, 2),
    chargeable_kg: sea ? round(wmCbm(cbm, gross), 3) : round(Math.max(gross, cbm * VOLUMETRIC_FACTOR), 1),
    volume_cbm: round(cbm, 3),
    receipt_ids: recs.map((r) => r.id),
  };
}
