// WMS — Warehouse Management System (migration 0137). Types, data access,
// hooks and the stock / storage-billing maths for the WMS module. Stock is a
// ledger (wms_stock_moves, pieces +in / −out); kg and CBM follow pro rata.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { VAT_RATE } from "./calc";

/* ---------- Types ---------- */

export type StorageBasis = "cbm" | "pallet" | "kg";
export type StoragePeriod = "day" | "week" | "month";
export type LocationKind =
  | "bay"
  | "area"
  | "bonded"
  | "yard"
  | "cold"
  | "dg"
  | "quarantine"
  | "dock";
export type ReceiptCondition = "good" | "damaged" | "wet" | "short" | "over" | "repacked";
export type ReceiptStatus = "in_store" | "part_released" | "released";

export interface WmsWarehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
  storage_basis: StorageBasis;
  storage_period: StoragePeriod;
  storage_rate: number;
  free_days: number;
  min_charge: number;
  handling_in_rate: number;
  handling_out_rate: number;
  notes: string | null;
  created_at: string;
}
export type WmsWarehouseInput = Omit<WmsWarehouse, "id" | "created_at">;

export interface WmsLocation {
  id: string;
  warehouse_id: string;
  /** Zone within the warehouse (e.g. "A", "Bonded", "Mezzanine"). */
  zone: string | null;
  code: string;
  name: string | null;
  kind: LocationKind;
  capacity_cbm: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
}
export type WmsLocationInput = Omit<WmsLocation, "id" | "created_at">;

/** One package item on a receipt — SKU, description, type, qty and per-unit
 *  dims / kg (same measures as a quote's packing list). */
export interface WmsPackage {
  sku?: string;
  description?: string;
  qty: number | string;
  type?: string;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  actual_kg: number | string;
}

export interface WmsReceipt {
  id: string;
  receipt_no: string;
  warehouse_id: string;
  location_id: string | null;
  client_id: string | null;
  job_id: string | null;
  supplier_id: string | null;
  received_at: string;
  received_by: string | null;
  delivered_by: string | null;
  vehicle_reg: string | null;
  driver_name: string | null;
  inbound_ref: string | null;
  customer_reference: string | null;
  description: string | null;
  marks: string | null;
  package_type: string | null;
  pieces: number;
  pallets: number;
  gross_kg: number;
  volume_cbm: number;
  packages: WmsPackage[];
  condition: ReceiptCondition;
  condition_notes: string | null;
  hazardous: boolean;
  notes: string | null;
  created_at: string;
  /* computed by wms_receipts_v */
  on_hand: number;
  on_hand_kg: number;
  on_hand_cbm: number;
  last_out_at: string | null;
  status: ReceiptStatus;
}
export type WmsReceiptInput = Omit<
  WmsReceipt,
  | "id"
  | "receipt_no"
  | "created_at"
  | "received_by"
  | "on_hand"
  | "on_hand_kg"
  | "on_hand_cbm"
  | "last_out_at"
  | "status"
>;

export interface WmsMove {
  id: string;
  receipt_id: string;
  location_id: string | null;
  qty: number;
  kind: "receipt" | "move" | "release" | "adjust";
  ref_id: string | null;
  at: string;
}

export interface WmsMovement {
  id: string;
  movement_no: string;
  receipt_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  pieces: number;
  reason: string | null;
  moved_at: string;
  moved_by: string | null;
  created_at: string;
}

export interface WmsReleaseLine {
  id: string;
  release_id: string;
  receipt_id: string;
  location_id: string | null;
  pieces: number;
  gross_kg: number;
  volume_cbm: number;
}
export interface WmsRelease {
  id: string;
  release_no: string;
  warehouse_id: string | null;
  client_id: string | null;
  job_id: string | null;
  consol_id: string | null;
  released_at: string;
  released_by: string | null;
  collected_by: string | null;
  vehicle_reg: string | null;
  driver_id_no: string | null;
  deliver_to: string | null;
  outbound_ref: string | null;
  notes: string | null;
  created_at: string;
  lines: WmsReleaseLine[];
}
export interface WmsReleaseHeader {
  warehouse_id?: string | null;
  client_id?: string | null;
  job_id?: string | null;
  released_at?: string | null;
  collected_by?: string | null;
  vehicle_reg?: string | null;
  driver_id_no?: string | null;
  deliver_to?: string | null;
  outbound_ref?: string | null;
  notes?: string | null;
}
export interface WmsReleaseLineInput {
  receipt_id: string;
  location_id: string | null;
  pieces: number;
}

export interface WmsRoutingLeg {
  to: string;
  by: string;
}
export interface WmsConsolHouse {
  id?: string;
  consol_id?: string;
  position: number;
  house_no: string | null;
  client_id: string | null;
  shipper: string | null;
  consignee: string | null;
  accounting_info: string | null;
  nature_of_goods: string | null;
  handling_info: string | null;
  /** Sea (0138): marks & numbers, package kind, the container it's stuffed in. */
  marks?: string | null;
  package_type?: string | null;
  container_no?: string | null;
  pieces: number;
  gross_kg: number;
  chargeable_kg: number;
  volume_cbm: number;
  receipt_ids: string[];
}
export interface WmsConsol {
  id: string;
  consol_no: string;
  /** air = MAWB/HAWB; lcl = LCL groupage; fcl = FCL consolidation (0138). */
  mode: ConsolMode;
  warehouse_id: string | null;
  job_id: string | null;
  status: "open" | "closed" | "departed";
  master_no: string | null;
  carrier: string | null;
  flight_no: string | null;
  flight_date: string | null;
  origin: string | null;
  origin_name: string | null;
  destination: string | null;
  routing: WmsRoutingLeg[];
  shipper: string | null;
  consignee: string | null;
  accounting_info: string | null;
  agent_name: string | null;
  agent_iata: string | null;
  agent_account: string | null;
  currency: string;
  charges_code: "PP" | "CC";
  declared_carriage: string;
  declared_customs: string;
  insurance: string;
  handling_info: string | null;
  rate_class: string | null;
  rate_charge: string | null;
  total_charge: string;
  signed_by: string | null;
  executed_on: string | null;
  executed_place: string | null;
  notes: string | null;
  /* Sea (0138) */
  vessel?: string | null;
  voyage_no?: string | null;
  place_of_receipt?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  place_of_delivery?: string | null;
  etd?: string | null;
  eta?: string | null;
  co_loader?: string | null;
  containers?: WmsContainer[];
  created_at: string;
  houses: WmsConsolHouse[];
}
export type ConsolMode = "air" | "lcl" | "fcl";
export interface WmsContainer {
  container_no: string;
  type: string;
  seal_no: string;
}
export const CONSOL_MODE_LABEL: Record<ConsolMode, string> = {
  air: "Air consolidation",
  lcl: "LCL groupage",
  fcl: "FCL consolidation",
};
export type WmsConsolInput = Omit<WmsConsol, "id" | "consol_no" | "created_at" | "houses">;

export interface WmsCountLine {
  id: string;
  count_id: string;
  receipt_id: string;
  location_id: string | null;
  expected: number;
  counted: number | null;
  note: string | null;
}
export interface WmsCount {
  id: string;
  count_no: string;
  warehouse_id: string;
  location_id: string | null;
  status: "open" | "completed" | "cancelled";
  counted_by: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  lines: WmsCountLine[];
}

export interface WmsBillingLine {
  receipt_id: string;
  receipt_no: string;
  description: string;
  kind: "storage" | "handling_in" | "handling_out" | "minimum";
  code: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}
export interface WmsBillingRun {
  id: string;
  run_no: string;
  client_id: string | null;
  warehouse_id: string | null;
  period_from: string;
  period_to: string;
  lines: WmsBillingLine[];
  subtotal: number;
  vat: number;
  total: number;
  status: "draft" | "invoiced";
  invoice_no: string | null;
  invoiced_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
export type WmsBillingRunInput = Omit<WmsBillingRun, "id" | "run_no" | "created_at" | "created_by">;

/* ---------- Labels ---------- */

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  bay: "Bay",
  area: "Floor area",
  bonded: "Bonded",
  yard: "Yard",
  cold: "Cold room",
  dg: "Dangerous goods",
  quarantine: "Quarantine / hold",
  dock: "Loading dock",
};
export const CONDITION_LABEL: Record<ReceiptCondition, string> = {
  good: "Good order",
  damaged: "Damaged",
  wet: "Wet",
  short: "Short delivered",
  over: "Over delivered",
  repacked: "Repacked",
};
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  in_store: "In store",
  part_released: "Part released",
  released: "Released",
};
export const BASIS_LABEL: Record<StorageBasis, string> = {
  cbm: "CBM (W/M)",
  pallet: "Pallet",
  kg: "Kg",
};
export const PERIOD_LABEL: Record<StoragePeriod, string> = {
  day: "day",
  week: "week",
  month: "month",
};
export const PACKAGE_TYPES = [
  "Cartons",
  "Pallets",
  "Crates",
  "Cases",
  "Bags",
  "Drums",
  "Rolls",
  "Bundles",
  "Pieces",
  "Loose",
];

/* ---------- Data access ---------- */

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

const n = (v: unknown) => Number(v) || 0;

function normReceipt(r: WmsReceipt): WmsReceipt {
  return {
    ...r,
    pieces: n(r.pieces),
    pallets: n(r.pallets),
    gross_kg: n(r.gross_kg),
    volume_cbm: n(r.volume_cbm),
    on_hand: n(r.on_hand),
    on_hand_kg: n(r.on_hand_kg),
    on_hand_cbm: n(r.on_hand_cbm),
    packages: Array.isArray(r.packages) ? r.packages : [],
  };
}

export const wmsDb = {
  async warehouses(): Promise<WmsWarehouse[]> {
    const rows = unwrap(
      await supabase.from("wms_warehouses").select("*").order("code"),
    ) as WmsWarehouse[];
    return rows.map((w) => ({
      ...w,
      storage_rate: n(w.storage_rate),
      min_charge: n(w.min_charge),
      handling_in_rate: n(w.handling_in_rate),
      handling_out_rate: n(w.handling_out_rate),
    }));
  },
  async saveWarehouse(id: string | undefined, values: WmsWarehouseInput) {
    return id
      ? unwrap(await supabase.from("wms_warehouses").update(values).eq("id", id))
      : unwrap(await supabase.from("wms_warehouses").insert(values));
  },
  async deleteWarehouse(id: string) {
    unwrap(await supabase.from("wms_warehouses").delete().eq("id", id));
  },
  async locations(): Promise<WmsLocation[]> {
    return unwrap(await supabase.from("wms_locations").select("*").order("code"));
  },
  async saveLocation(id: string | undefined, values: WmsLocationInput) {
    return id
      ? unwrap(await supabase.from("wms_locations").update(values).eq("id", id))
      : unwrap(await supabase.from("wms_locations").insert(values));
  },
  async deleteLocation(id: string) {
    unwrap(await supabase.from("wms_locations").delete().eq("id", id));
  },
  async receipts(): Promise<WmsReceipt[]> {
    const rows = unwrap(
      await supabase
        .from("wms_receipts_v")
        .select("*")
        .order("received_at", { ascending: false }),
    ) as WmsReceipt[];
    return rows.map(normReceipt);
  },
  async saveReceipt(id: string | undefined, values: WmsReceiptInput): Promise<string> {
    if (id) {
      unwrap(await supabase.from("wms_receipts").update(values).eq("id", id));
      return id;
    }
    const row = unwrap(
      await supabase.from("wms_receipts").insert(values).select("id").single(),
    ) as { id: string };
    return row.id;
  },
  async deleteReceipt(id: string) {
    unwrap(await supabase.from("wms_receipts").delete().eq("id", id));
  },
  async moves(): Promise<WmsMove[]> {
    const rows = unwrap(
      await supabase
        .from("wms_stock_moves")
        .select("id, receipt_id, location_id, qty, kind, ref_id, at")
        .order("at"),
    ) as WmsMove[];
    return rows.map((m) => ({ ...m, qty: n(m.qty) }));
  },
  async movements(): Promise<WmsMovement[]> {
    return unwrap(
      await supabase.from("wms_movements").select("*").order("moved_at", { ascending: false }),
    );
  },
  async createMovement(values: {
    receipt_id: string;
    from_location_id: string | null;
    to_location_id: string | null;
    pieces: number;
    reason: string | null;
    moved_at?: string;
  }) {
    unwrap(await supabase.from("wms_movements").insert(values));
  },
  async deleteMovement(id: string) {
    unwrap(await supabase.from("wms_movements").delete().eq("id", id));
  },
  async releases(): Promise<WmsRelease[]> {
    const rows = unwrap(
      await supabase
        .from("wms_releases")
        .select("*, lines:wms_release_lines(*)")
        .order("released_at", { ascending: false }),
    ) as WmsRelease[];
    return rows.map((r) => ({
      ...r,
      lines: (r.lines ?? []).map((l) => ({
        ...l,
        pieces: n(l.pieces),
        gross_kg: n(l.gross_kg),
        volume_cbm: n(l.volume_cbm),
      })),
    }));
  },
  async createRelease(header: WmsReleaseHeader, lines: WmsReleaseLineInput[]): Promise<string> {
    return unwrap(
      await supabase.rpc("wms_create_release", { p_header: header, p_lines: lines }),
    ) as string;
  },
  async updateRelease(id: string, patch: Partial<WmsReleaseHeader>) {
    unwrap(await supabase.from("wms_releases").update(patch).eq("id", id));
  },
  async deleteRelease(id: string) {
    unwrap(await supabase.from("wms_releases").delete().eq("id", id));
  },
  async consols(): Promise<WmsConsol[]> {
    const rows = unwrap(
      await supabase
        .from("wms_consols")
        .select("*, houses:wms_consol_houses(*)")
        .order("created_at", { ascending: false }),
    ) as WmsConsol[];
    return rows.map((c) => ({
      ...c,
      routing: Array.isArray(c.routing) ? c.routing : [],
      containers: Array.isArray(c.containers) ? c.containers : [],
      houses: [...(c.houses ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((h) => ({
          ...h,
          pieces: n(h.pieces),
          gross_kg: n(h.gross_kg),
          chargeable_kg: n(h.chargeable_kg),
          volume_cbm: n(h.volume_cbm),
          receipt_ids: h.receipt_ids ?? [],
        })),
    }));
  },
  async saveConsol(
    id: string | undefined,
    values: WmsConsolInput,
    houses: WmsConsolHouse[],
  ): Promise<string> {
    let cid = id;
    if (cid) {
      unwrap(await supabase.from("wms_consols").update(values).eq("id", cid));
    } else {
      const row = unwrap(
        await supabase.from("wms_consols").insert(values).select("id").single(),
      ) as { id: string };
      cid = row.id;
    }
    // Houses are replaced wholesale on save (child rows, like quote lines).
    unwrap(await supabase.from("wms_consol_houses").delete().eq("consol_id", cid));
    if (houses.length) {
      unwrap(
        await supabase.from("wms_consol_houses").insert(
          houses.map((h, i) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, consol_id: _c, ...rest } = h;
            return { ...rest, consol_id: cid, position: i };
          }),
        ),
      );
    }
    return cid;
  },
  async setConsolStatus(id: string, status: WmsConsol["status"]) {
    unwrap(await supabase.from("wms_consols").update({ status }).eq("id", id));
  },
  async releaseConsol(id: string): Promise<string> {
    return unwrap(await supabase.rpc("wms_release_consol", { p_consol: id })) as string;
  },
  async deleteConsol(id: string) {
    unwrap(await supabase.from("wms_consols").delete().eq("id", id));
  },
  async counts(): Promise<WmsCount[]> {
    const rows = unwrap(
      await supabase
        .from("wms_counts")
        .select("*, lines:wms_count_lines(*)")
        .order("created_at", { ascending: false }),
    ) as WmsCount[];
    return rows.map((c) => ({ ...c, lines: c.lines ?? [] }));
  },
  async startCount(warehouseId: string, locationId: string | null, notes: string): Promise<string> {
    return unwrap(
      await supabase.rpc("wms_start_count", {
        p_warehouse: warehouseId,
        p_location: locationId,
        p_notes: notes,
      }),
    ) as string;
  },
  async saveCountLines(lines: { id: string; counted: number | null; note: string | null }[]) {
    for (const l of lines) {
      unwrap(
        await supabase
          .from("wms_count_lines")
          .update({ counted: l.counted, note: l.note })
          .eq("id", l.id),
      );
    }
  },
  async completeCount(id: string): Promise<number> {
    return unwrap(await supabase.rpc("wms_complete_count", { p_count: id })) as number;
  },
  async cancelCount(id: string) {
    unwrap(await supabase.from("wms_counts").update({ status: "cancelled" }).eq("id", id));
  },
  async deleteCount(id: string) {
    unwrap(await supabase.from("wms_counts").delete().eq("id", id));
  },
  async billingRuns(): Promise<WmsBillingRun[]> {
    const rows = unwrap(
      await supabase.from("wms_billing_runs").select("*").order("created_at", { ascending: false }),
    ) as WmsBillingRun[];
    return rows.map((r) => ({
      ...r,
      subtotal: n(r.subtotal),
      vat: n(r.vat),
      total: n(r.total),
      lines: Array.isArray(r.lines) ? r.lines : [],
    }));
  },
  async saveBillingRun(id: string | undefined, values: Partial<WmsBillingRunInput>): Promise<string> {
    if (id) {
      unwrap(await supabase.from("wms_billing_runs").update(values).eq("id", id));
      return id;
    }
    const row = unwrap(
      await supabase.from("wms_billing_runs").insert(values).select("id").single(),
    ) as { id: string };
    return row.id;
  },
  async deleteBillingRun(id: string) {
    unwrap(await supabase.from("wms_billing_runs").delete().eq("id", id));
  },
};

/* ---------- Hooks ---------- */
// Every WMS query lives under ["wms", …]; any WMS change refreshes them all
// (stock, receipts' on-hand and the dashboard all derive from the ledger).

export const useWmsWarehouses = () =>
  useQuery({ queryKey: ["wms", "warehouses"], queryFn: wmsDb.warehouses });
export const useWmsLocations = () =>
  useQuery({ queryKey: ["wms", "locations"], queryFn: wmsDb.locations });
export const useWmsReceipts = () =>
  useQuery({ queryKey: ["wms", "receipts"], queryFn: wmsDb.receipts });
export const useWmsMoves = () => useQuery({ queryKey: ["wms", "moves"], queryFn: wmsDb.moves });
export const useWmsMovements = () =>
  useQuery({ queryKey: ["wms", "movements"], queryFn: wmsDb.movements });
export const useWmsReleases = () =>
  useQuery({ queryKey: ["wms", "releases"], queryFn: wmsDb.releases });
export const useWmsConsols = () =>
  useQuery({ queryKey: ["wms", "consols"], queryFn: wmsDb.consols });
export const useWmsCounts = () => useQuery({ queryKey: ["wms", "counts"], queryFn: wmsDb.counts });
export const useWmsBillingRuns = () =>
  useQuery({ queryKey: ["wms", "billing"], queryFn: wmsDb.billingRuns });

/** Wraps any WMS write so it refreshes every WMS query afterwards. */
export function useWmsMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: ["wms"] }),
  });
}

/* ---------- Stock maths ---------- */

/** W/M chargeable CBM: 1 CBM = 1000 kg (as Sea LCL). */
export function wmCbm(cbm: number, kg: number): number {
  return Math.max(n(cbm), n(kg) / 1000);
}

/** On hand per (receipt, location) from the ledger — positives only. */
export function stockByLocation(
  moves: WmsMove[],
): { receipt_id: string; location_id: string | null; on_hand: number }[] {
  const map = new Map<string, { receipt_id: string; location_id: string | null; on_hand: number }>();
  for (const m of moves) {
    const k = `${m.receipt_id}|${m.location_id ?? ""}`;
    const cur = map.get(k) ?? { receipt_id: m.receipt_id, location_id: m.location_id, on_hand: 0 };
    cur.on_hand += m.qty;
    map.set(k, cur);
  }
  return [...map.values()].filter((s) => s.on_hand > 0);
}

/** Pro-rata share of a receipt's kg / CBM / pallets for `pieces` of it. */
export function share(r: Pick<WmsReceipt, "pieces" | "gross_kg" | "volume_cbm" | "pallets">, pieces: number) {
  const f = r.pieces > 0 ? pieces / r.pieces : 0;
  return {
    kg: r.gross_kg * f,
    cbm: r.volume_cbm * f,
    pallets: r.pallets * f,
  };
}

/** Whole days between two dates (local midnight), b − a. */
export function daysBetween(a: string | Date, b: string | Date): number {
  const d0 = new Date(a);
  const d1 = new Date(b);
  d0.setHours(0, 0, 0, 0);
  d1.setHours(0, 0, 0, 0);
  return Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
}

export function packageTotals(pk: WmsPackage[]): { pieces: number; kg: number; cbm: number } {
  let pieces = 0;
  let kg = 0;
  let cbm = 0;
  for (const p of pk) {
    const q = n(p.qty);
    pieces += q;
    kg += n(p.actual_kg) * q;
    cbm += ((n(p.length_cm) * n(p.width_cm) * n(p.height_cm)) / 1_000_000) * q;
  }
  return { pieces, kg, cbm };
}

const PERIOD_DAYS: Record<StoragePeriod, number> = { day: 1, week: 7, month: 30 };

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Storage billing for one customer over [from, to] (yyyy-mm-dd, inclusive):
 *  - Storage (WH-01): every day a piece is on hand after the warehouse's free
 *    days (counted from the receipt date), × units per piece (W/M CBM, pallets
 *    or kg) × rate ÷ period length (pro rata per day). A receipt with storage
 *    under the minimum charge is lifted to the minimum.
 *  - Handling in (WH-02): receipts received in the period, W/M CBM × rate.
 *  - Handling out (WH-02): pieces released in the period, W/M CBM × rate.
 */
export function computeStorageBilling(
  wh: WmsWarehouse,
  receipts: WmsReceipt[],
  moves: WmsMove[],
  from: string,
  to: string,
): WmsBillingLine[] {
  const lines: WmsBillingLine[] = [];
  const dailyRate = wh.storage_rate / PERIOD_DAYS[wh.storage_period];
  const basisUnit = wh.storage_basis === "cbm" ? "CBM-days" : wh.storage_basis === "pallet" ? "Pallet-days" : "Kg-days";
  const fromD = new Date(from + "T00:00:00");
  const toD = new Date(to + "T00:00:00");
  for (const r of receipts) {
    if (r.warehouse_id !== wh.id || r.pieces <= 0) continue;
    const recDay = isoDay(new Date(r.received_at));
    if (recDay > to) continue;
    const rm = moves.filter((m) => m.receipt_id === r.id);
    const perPiece =
      wh.storage_basis === "cbm"
        ? wmCbm(r.volume_cbm, r.gross_kg) / r.pieces
        : wh.storage_basis === "pallet"
          ? r.pallets / r.pieces
          : r.gross_kg / r.pieces;
    const wmPerPiece = wmCbm(r.volume_cbm, r.gross_kg) / r.pieces;
    const label = `${r.receipt_no}${r.description ? ` — ${r.description}` : ""}`;

    // Storage: walk each day of the period.
    let unitDays = 0;
    for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
      const day = isoDay(d);
      if (day < recDay) continue;
      if (daysBetween(recDay, day) < wh.free_days) continue;
      const onHand = rm.filter((m) => isoDay(new Date(m.at)) <= day).reduce((s, m) => s + m.qty, 0);
      if (onHand > 0) unitDays += onHand * perPiece;
    }
    if (unitDays > 0 && dailyRate > 0) {
      const amount = unitDays * dailyRate;
      const min = wh.min_charge > amount;
      lines.push({
        receipt_id: r.id,
        receipt_no: r.receipt_no,
        description: `Storage ${label}`,
        kind: min ? "minimum" : "storage",
        code: "WH-01",
        qty: round(unitDays, 3),
        unit: basisUnit,
        rate: round(dailyRate, 4),
        amount: round(min ? wh.min_charge : amount, 2),
      });
    }

    // Handling in.
    if (wh.handling_in_rate > 0 && recDay >= from && recDay <= to) {
      const q = wmCbm(r.volume_cbm, r.gross_kg);
      lines.push({
        receipt_id: r.id,
        receipt_no: r.receipt_no,
        description: `Handling in ${label}`,
        kind: "handling_in",
        code: "WH-02",
        qty: round(q, 3),
        unit: "CBM",
        rate: wh.handling_in_rate,
        amount: round(q * wh.handling_in_rate, 2),
      });
    }

    // Handling out.
    if (wh.handling_out_rate > 0) {
      const outPieces = -rm
        .filter((m) => m.kind === "release")
        .filter((m) => {
          const day = isoDay(new Date(m.at));
          return day >= from && day <= to;
        })
        .reduce((s, m) => s + m.qty, 0);
      if (outPieces > 0) {
        const q = outPieces * wmPerPiece;
        lines.push({
          receipt_id: r.id,
          receipt_no: r.receipt_no,
          description: `Handling out ${label}`,
          kind: "handling_out",
          code: "WH-02",
          qty: round(q, 3),
          unit: "CBM",
          rate: wh.handling_out_rate,
          amount: round(q * wh.handling_out_rate, 2),
        });
      }
    }
  }
  return lines;
}

export function billingTotals(lines: WmsBillingLine[]) {
  const subtotal = round(lines.reduce((s, l) => s + l.amount, 0), 2);
  const vat = round((subtotal * VAT_RATE) / 100, 2);
  return { subtotal, vat, total: round(subtotal + vat, 2) };
}

export function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** "1 234.5" style quantities for WMS tables. */
export function qty(v: number | null | undefined, dp = 2): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Today as yyyy-mm-dd (local). */
export function todayIso(): string {
  return isoDay(new Date());
}
export function firstOfMonthIso(): string {
  const d = new Date();
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Simple CSV download for WMS reports. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "A / B03" — zone then bay code; "Unassigned" when there's no location. */
export function locationLabel(loc: Pick<WmsLocation, "zone" | "code"> | null | undefined): string {
  if (!loc) return "Unassigned";
  return loc.zone ? `${loc.zone} / ${loc.code}` : loc.code;
}

export async function bulkUpdateReceipts(ids: string[], patch: Record<string, unknown>) {
  unwrap(await supabase.from("wms_receipts").update(patch).in("id", ids));
}
