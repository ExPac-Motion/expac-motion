import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import DateInput from "../components/DateInput";
import { useNavigate, useParams } from "react-router-dom";
import Modal from "../components/Modal";
import { ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import {
  useAgents,
  useClearingAgents,
  useClients,
  useCompanySettings,
  useLeads,
  useProfiles,
  useQuote,
  useMyProfile,
  useRateSheet,
  useTariffSheets,
  useSaveQuote,
  useFinalizeCopiedQuote,
  useSaveSupplier,
  useSuppliers,
  useTransporters,
} from "../lib/hooks";
import {
  autoQty,
  buyRate,
  chargeTotals,
  convertZar,
  groupByCategory,
  impliedMargin,
  insuranceAmount,
  CUSTOMS_DUTY_CODE,
  CUSTOMS_VAT_CODE,
  SERVICE_FEE_CODES,
  serviceFeePrefillZar,
  lineTotal,
  lineBuyTotal,
  lineSellTotal,
  packingRow,
  packingTotals,
  resolveLines,
  sellFromBuy,
  sellInCur,
  volumetricFactor,
  type FxRates,
} from "../lib/calc";
import { catalogForCategory, catalogItem } from "../lib/chargeCatalog";
import { carrierLabel, usesSeaLayout } from "../lib/docTemplates";
import { fetchZarRates } from "../lib/fx";
import { getPartnerRateSheets, listPartnerRateSheets } from "../lib/db";
import {
  PARTNER_KINDS,
  partnerIdKey,
  sheetIdKey,
  tierLine,
  worksheetGroups,
  type PartnerSheets,
} from "../lib/tariff";
import { TierDot } from "./rates/TierSheetsPage";
import {
  AUTO_REFERENCE,
  money,
  moneyCur,
  newReference,
  referencePrefix,
  todayPlusDays,
} from "../lib/format";
import { LOCODE_OPTIONS } from "../lib/locodes";
import {
  CHARGE_CATEGORIES,
  CHARGE_UNITS,
  COMMODITIES,
  INCOTERM_CODES,
  INCOTERMS_ANY_MODE,
  INCOTERMS_SEA,
  LINE_CURRENCIES,
  QUOTE_MODES,
  RATE_TIERS,
  rateTier,
  STATUS_LABEL,
  STATUS_ORDER,
  WON_QUOTE_STATUSES,
  type ChargeCategory,
  type Commodity,
  type LineCurrency,
  type PackingItem,
  type Quote,
  type QuoteDraft,
  type QuoteLine,
  type RateSheetItem,
  type RateTierId,
} from "../lib/types";

function newPackingItem(position: number): PackingItem {
  return {
    position,
    length_cm: 0,
    width_cm: 0,
    height_cm: 0,
    actual_kg: 0,
    qty_ctns: 1,
    cbm: "",
  };
}

function newLine(category: ChargeCategory, position: number): QuoteLine {
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

function blankDraft(): QuoteDraft {
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
    agent_id: "",
    transporter_id: "",
    clearing_agent_id: "",
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

function draftFromQuote(q: Quote): QuoteDraft {
  return {
    id: q.id,
    reference: q.reference,
    customer_reference: q.customer_reference ?? "",
    client_id: q.client_id ?? "",
    lead_id: q.lead_id ?? "",
    sales_person_id: q.sales_person_id ?? "",
    supplier_id: q.supplier_id ?? "",
    consignee_id: q.consignee_id ?? "",
    consignee_lead_id: q.consignee_lead_id ?? "",
    agent_id: q.agent_id ?? "",
    transporter_id: q.transporter_id ?? "",
    clearing_agent_id: q.clearing_agent_id ?? "",
    mode: q.mode,
    commodity: q.commodity ?? "",
    origin: q.origin ?? "",
    destination: q.destination ?? "",
    delivery_terms: q.delivery_terms ?? "",
    valid_until: q.valid_until ?? "",
    status: q.status,
    commercial_value: q.commercial_value != null ? String(q.commercial_value) : "",
    insurance_amount: q.insurance_amount != null ? String(q.insurance_amount) : "",
    vessel_name: q.vessel_name ?? "",
    voyage_no: q.voyage_no ?? "",
    routing: q.routing ?? "",
    transit_time: q.transit_time ?? "",
    mbl_no: q.mbl_no ?? "",
    hbl_no: q.hbl_no ?? "",
    container_no: q.container_no ?? "",
    container_type: q.container_type ?? "",
    etd: q.etd ?? "",
    eta: q.eta ?? "",
    provisional_delivery_date: q.provisional_delivery_date ?? "",
    incoterms: q.incoterms ?? "",
    mawb_no: q.mawb_no ?? "",
    hawb_no: q.hawb_no ?? "",
    flight_no: q.flight_no ?? "",
    flight_date: q.flight_date ?? "",
    carrier_name: q.carrier_name ?? "",
    shipping_line: q.shipping_line ?? "",
    fx_usd_zar: q.fx_usd_zar != null ? String(q.fx_usd_zar) : "0",
    fx_cny_zar: q.fx_cny_zar != null ? String(q.fx_cny_zar) : "0",
    fx_eur_zar: q.fx_eur_zar != null ? String(q.fx_eur_zar) : "0",
    fx_gbp_zar: q.fx_gbp_zar != null ? String(q.fx_gbp_zar) : "0",
    sell_currency: q.sell_currency ?? "",
    value_currency: q.value_currency ?? "ZAR",
    rate_tier: q.rate_tier ?? "silver",
    tariff_sheet_id: q.tariff_sheet_id ?? "",
    packing: (q.packing_list_items ?? []).map((p, i) => ({
      position: i,
      length_cm: p.length_cm ?? 0,
      width_cm: p.width_cm ?? 0,
      height_cm: p.height_cm ?? 0,
      actual_kg: p.actual_kg ?? 0,
      qty_ctns: p.qty_ctns ?? 0,
      cbm: p.cbm ?? "",
    })),
    lines: q.quote_lines.map((l, i) => {
      const fx: FxRates = {
        usd: Number(q.fx_usd_zar) || 0,
        cny: Number(q.fx_cny_zar) || 0,
        eur: Number(q.fx_eur_zar) || 0,
        gbp: Number(q.fx_gbp_zar) || 0,
      };
      const cur = (l.cur as QuoteLine["cur"]) ?? "USD";
      let buy = Number(l.buy) || 0;
      const storedSell = Number(l.sell) || 0;
      const rate = buyRate(cur, fx);
      // Legacy sell-only line (no buy): treat the stored sell as the buy basis.
      if (buy <= 0 && storedSell > 0 && rate > 0) buy = storedSell / rate;
      const margin =
        Number(l.margin) || impliedMargin(buy, storedSell, cur, fx);
      // Heal legacy formula-style units on catalog-coded lines (e.g. an old
      // "1% on Total International Charges + R350" -> the code's standard unit).
      const storedUnit = l.unit ?? "";
      const catUnit = catalogItem(l.code ?? "", q.mode)?.unit;
      const unit =
        storedUnit && !CHARGE_UNITS.includes(storedUnit) && catUnit
          ? catUnit
          : storedUnit;
      // Sell-only service fees (IN-01 / FW-01 / DIS-01 / CU-05): the stored
      // sell (R) is the source of truth. Buy / margin open at 0 (the cells stay
      // editable) — never reconstructed from the sell, and any stray legacy
      // Buy value on the row is dropped.
      if (SERVICE_FEE_CODES.includes(l.code ?? "")) {
        return {
          position: i,
          category: (l.category as ChargeCategory) ?? CHARGE_CATEGORIES[0],
          code: l.code ?? "",
          description: l.description ?? "",
          cur,
          unit,
          qty: l.qty ?? 1,
          qty_override: l.qty_override ?? false,
          fee_rate: l.fee_rate ?? null,
          buy: 0,
          margin: 0,
          vat_pct: l.vat_pct ?? 0,
          sell: Math.round(storedSell * 100) / 100,
        };
      }
      return {
        position: i,
        category: (l.category as ChargeCategory) ?? CHARGE_CATEGORIES[0],
        code: l.code ?? "",
        description: l.description ?? "",
        cur,
        unit,
        qty: l.qty ?? 0,
        qty_override: l.qty_override ?? false,
        fee_rate: l.fee_rate ?? null,
        buy,
        margin,
        vat_pct: l.vat_pct ?? 0,
        sell: sellFromBuy(buy, margin, cur, fx),
      };
    }),
  };
}

/** Added to every live exchange rate fetched with "Get live rates" -- the
 *  market rate is not the buying rate, and this covers currency movement
 *  between quoting and booking. */
const LIVE_RATE_BUFFER_ZAR = 0.3;

export default function QuoteBuilderPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { toast, error } = useToast();

  const clientsQ = useClients();
  const leadsQ = useLeads();
  const profilesQ = useProfiles();
  const suppliersQ = useSuppliers();
  const agentsQ = useAgents();
  const transportersQ = useTransporters();
  const clearingAgentsQ = useClearingAgents();
  const existingQ = useQuote(id);
  const saveQuote = useSaveQuote();
  const finalizeCopied = useFinalizeCopiedQuote();
  const saveSupplier = useSaveSupplier();
  const settingsQ = useCompanySettings();
  const ratesQ = useRateSheet();

  const [draft, setDraft] = useState<QuoteDraft | null>(isEdit ? null : blankDraft());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxAsOf, setFxAsOf] = useState("");
  const [ratePickerFor, setRatePickerFor] = useState<ChargeCategory | null>(null);
  const [addingShipper, setAddingShipper] = useState(false);
  // Charge-line drag-reorder: the line being dragged and where it would land.
  const [dragLine, setDragLine] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null);
  // Tier rate sheets (migration 0119) for the "Rate tier" / "Trade route" pick.
  const tariffQ = useTariffSheets();
  const isAdmin = useMyProfile().data?.role === "admin";
  const [tierLoading, setTierLoading] = useState(false);

  // Adjust state when the loaded quote arrives (React-sanctioned set-state-in-render).
  if (isEdit && existingQ.data && loadedFor !== existingQ.data.id) {
    setLoadedFor(existingQ.data.id);
    setDraft(draftFromQuote(existingQ.data));
  }

  // Seed a brand-new quote's FX rates / incoterm from Settings > Quote Defaults,
  // once, as soon as they load — never touches an existing (edit) quote.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (isEdit || defaultsApplied.current || !settingsQ.data) return;
    defaultsApplied.current = true;
    const s = settingsQ.data;
    setDraft((d) =>
      d
        ? {
            ...d,
            fx_usd_zar: String(s.default_fx_usd_zar),
            fx_cny_zar: String(s.default_fx_cny_zar),
            fx_eur_zar: String(s.default_fx_eur_zar),
            incoterms: d.incoterms || s.default_incoterm,
          }
        : d,
    );
  }, [isEdit, settingsQ.data]);

  const fx = useMemo(
    () => ({
      usd: Number(draft?.fx_usd_zar) || 0,
      cny: Number(draft?.fx_cny_zar) || 0,
      eur: Number(draft?.fx_eur_zar) || 0,
      gbp: Number(draft?.fx_gbp_zar) || 0,
    }),
    [draft?.fx_usd_zar, draft?.fx_cny_zar, draft?.fx_eur_zar, draft?.fx_gbp_zar],
  );
  const vFactor = volumetricFactor(draft?.mode);
  const packTotals = useMemo(
    () => packingTotals(draft?.packing ?? [], vFactor),
    [draft?.packing, vFactor],
  );
  // Lines with code/unit-driven values resolved (KGS qty -> chargeable weight,
  // IN-01 -> insurance, FW-01 -> 1% of International Freight).
  const resolvedLines = useMemo(
    () =>
      resolveLines(draft?.lines ?? [], {
        mode: draft?.mode ?? "Air Freight (AIR)",
        fx,
        pack: packTotals,
        commercialValue: draft?.commercial_value ?? "",
      }),
    [draft?.lines, draft?.mode, fx, packTotals, draft?.commercial_value],
  );
  const totals = useMemo(
    () => chargeTotals(resolvedLines, fx),
    [resolvedLines, fx],
  );
  const sellCur = (draft?.sell_currency || null) as LineCurrency | null;
  const costOfSalesTarget = settingsQ.data?.cost_of_sales_target ?? 85;
  const costOfSalesRatio = totals.sell > 0 ? (totals.cost / totals.sell) * 100 : 0;
  const groups = useMemo(
    () => groupByCategory(resolvedLines),
    [resolvedLines],
  );

  if (isEdit && existingQ.isLoading) {
    return (
      <>
        <PageHeader eyebrow="Air / Sea / Road costing" title="Edit quotation" />
        <div className="panel">
          <Loading label="Loading quotation…" />
        </div>
      </>
    );
  }
  if (isEdit && existingQ.isError) {
    return (
      <>
        <PageHeader eyebrow="Air / Sea / Road costing" title="Edit quotation" />
        <div className="panel">
          <ErrorNote error={existingQ.error} />
        </div>
      </>
    );
  }
  if (!draft) return null;

  function set<K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  // Mode change: re-prefix an auto-generated reference so it tracks the mode
  // (AIR/SEA/RDX/CX) while keeping the same 6-digit sequence. Runs for any
  // quote that hasn't been won yet (accepted/completed already has a job
  // carrying this same shipment number — that one's left alone once live).
  // A hand-typed reference is always left untouched.
  function setMode(mode: QuoteDraft["mode"]) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, mode };
      const ref = d.reference.trim();
      if (
        !WON_QUOTE_STATUSES.includes(d.status) &&
        AUTO_REFERENCE.test(ref)
      ) {
        next.reference = referencePrefix(mode) + ref.slice(-6);
      }
      return next;
    });
  }

  function fxOfDraft(d: QuoteDraft): FxRates {
    return {
      usd: Number(d.fx_usd_zar) || 0,
      cny: Number(d.fx_cny_zar) || 0,
      eur: Number(d.fx_eur_zar) || 0,
      gbp: Number(d.fx_gbp_zar) || 0,
    };
  }

  /** Turn on EUR / GBP for this quote with the Settings default rate, if it
   *  isn't already set (rate 0 = currency not in use). No-op otherwise. */
  function addCurrency(cur: string) {
    if (cur === "EUR" && Number(draft?.fx_eur_zar) <= 0) {
      setFx("fx_eur_zar", String(settingsQ.data?.default_fx_eur_zar || "20.00"));
    }
    if (cur === "GBP" && Number(draft?.fx_gbp_zar) <= 0) {
      setFx("fx_gbp_zar", String(settingsQ.data?.default_fx_gbp_zar || "24.00"));
    }
  }

  async function getLiveRates() {
    setFxLoading(true);
    try {
      const r = await fetchZarRates();
      // Live (market) rates are not the buying rate: add a fixed buffer to
      // each one to cover currency movement between quoting and booking.
      const buffered = (cur: string) =>
        (r.rate(cur) + LIVE_RATE_BUFFER_ZAR).toFixed(4);
      setFx("fx_usd_zar", buffered("USD"));
      setFx("fx_cny_zar", buffered("CNY"));
      setFx("fx_eur_zar", buffered("EUR"));
      // GBP only when this quote uses it (keeps the rate row tidy).
      if (Number(draft?.fx_gbp_zar) > 0) setFx("fx_gbp_zar", buffered("GBP"));
      setFxAsOf(r.asOf);
      toast(`Live rates applied (+R${LIVE_RATE_BUFFER_ZAR.toFixed(2)} buffer each)`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not fetch live rates");
    } finally {
      setFxLoading(false);
    }
  }

  // FX rate change: recompute every line's sell.
  function setFx(
    key: "fx_usd_zar" | "fx_cny_zar" | "fx_eur_zar" | "fx_gbp_zar",
    value: string,
  ) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [key]: value };
      const fxNext = fxOfDraft(next);
      next.lines = d.lines.map((l) => ({
        ...l,
        sell: sellFromBuy(l.buy, l.margin, l.cur, fxNext),
      }));
      return next;
    });
  }

  function setPacking(index: number, field: keyof PackingItem, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const packing = d.packing.map((p, i) =>
        i === index ? ({ ...p, [field]: value } as PackingItem) : p,
      );
      return { ...d, packing };
    });
  }
  function addPacking() {
    setDraft((d) =>
      d ? { ...d, packing: [...d.packing, newPackingItem(d.packing.length)] } : d,
    );
  }
  function removePacking(index: number) {
    setDraft((d) =>
      d ? { ...d, packing: d.packing.filter((_, i) => i !== index) } : d,
    );
  }

  function setLine(index: number, field: keyof QuoteLine, value: string) {
    const patch: Partial<QuoteLine> = { [field]: value };
    // A fresh unit means the qty goes back to being derived.
    if (field === "unit") patch.qty_override = false;
    setLineFields(index, patch);
  }

  function setLineFields(index: number, patch: Partial<QuoteLine>) {
    setDraft((d) => {
      if (!d) return d;
      const fxRates = fxOfDraft(d);
      const lines = d.lines.map((l, i) => {
        if (i !== index) return l;
        const merged = { ...l, ...patch } as QuoteLine;
        // Sell-only lines (service fees + Customs VAT) hold a typed sell (R) —
        // never derive it from buy.
        const mergedCode = String(merged.code ?? "");
        const recompute =
          ("buy" in patch || "margin" in patch || "cur" in patch) &&
          !SERVICE_FEE_CODES.includes(mergedCode) &&
          mergedCode !== CUSTOMS_VAT_CODE &&
          mergedCode !== CUSTOMS_DUTY_CODE;
        if (recompute) {
          merged.sell = sellFromBuy(
            merged.buy,
            merged.margin,
            merged.cur,
            fxRates,
          );
        }
        return merged;
      });
      return { ...d, lines };
    });
  }

  function pickCode(index: number, code: string) {
    const item = catalogItem(code, draft?.mode);
    const patch: Partial<QuoteLine> = item
      ? {
          code,
          description: item.description,
          cur: item.cur,
          unit: item.unit,
          qty_override: false,
        }
      : { code, qty_override: false };
    // Default VAT % carried by the code (OF-07 / DIS-01 / CU-05 = 15).
    if (item?.vat_pct != null) patch.vat_pct = item.vat_pct;
    // Service fee: no buy, pre-fill a suggested Sell (R), then all editable.
    if (SERVICE_FEE_CODES.includes(code)) {
      patch.buy = 0;
      patch.margin = 0;
      patch.qty = 1;
      const others = resolvedLines.filter((_, i) => i !== index);
      const prefill = serviceFeePrefillZar(
        code,
        others,
        fx,
        draft?.commercial_value,
      );
      patch.sell = prefill > 0 ? Number(prefill.toFixed(2)) : "";
    }
    // Customs Duty: sell-only disbursement — type the amount into Sell (R).
    // Billed to the client at cost (no margin) and always zero-rated for VAT.
    if (code === CUSTOMS_DUTY_CODE) {
      patch.buy = 0;
      patch.margin = 0;
      patch.qty = 1;
      patch.vat_pct = 0;
    }
    setLineFields(index, patch);
  }

  function addLine(category: ChargeCategory) {
    setDraft((d) =>
      d ? { ...d, lines: [...d.lines, newLine(category, d.lines.length)] } : d,
    );
  }

  function addLineFromRate(rate: RateSheetItem) {
    setDraft((d) => {
      if (!d) return d;
      const line: QuoteLine = {
        position: d.lines.length,
        category: rate.category,
        code: rate.code ?? "",
        description: rate.description,
        cur: rate.cur,
        unit: rate.unit ?? "",
        qty: 1,
        buy: rate.buy,
        margin: rate.margin,
        vat_pct: 0,
        sell: 0,
      };
      return { ...d, lines: [...d.lines, line] };
    });
  }

  /** Replace the charge lines with the picked tier rate sheet (0119): each
   *  code's buy follows the linked partner rate sheet (weight breaks picked
   *  by the chargeable weight) plus the tier margin; sell-only codes take the
   *  sheet's Sell (R). A partner already picked on the quote wins over the
   *  sheet's — their rate sheet for the same mode + route is used. */
  async function loadTierRates() {
    if (!draft) return;
    const sheet = (tariffQ.data ?? []).find((s) => s.id === draft.tariff_sheet_id);
    if (!sheet) return;
    const hasLines = draft.lines.some((l) => l.code || String(l.description ?? "").trim());
    if (
      hasLines &&
      !window.confirm(
        `Replace the current charge lines with the ${rateTier(sheet.tier).label} "${sheet.route}" rates?`,
      )
    )
      return;
    setTierLoading(true);
    try {
      const partnerIds = Object.fromEntries(
        PARTNER_KINDS.map((k) => [k, draft[partnerIdKey(k)] || sheet[partnerIdKey(k)] || ""]),
      ) as Record<(typeof PARTNER_KINDS)[number], string>;
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
          theirs.find((s) => s.route.toLowerCase() === sheet.route.toLowerCase()) ??
          theirs[0] ??
          null;
      }
      const kg = packTotals.chargeable;
      const fxRates = fxOfDraft(draft);
      const lines: QuoteLine[] = [];
      for (const g of worksheetGroups(sheet.mode))
        for (const item of g.items) {
          const r = tierLine(sheet, item, partners, kg);
          if (r.sellOnly ? !(r.sell != null && r.sell > 0) : r.buy == null) continue;
          const base = {
            ...newLine(item.category, lines.length),
            code: item.code,
            description: item.description,
            unit: item.unit,
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
                  sell: sellFromBuy(r.buy as number, r.margin, r.cur, fxRates),
                },
          );
        }
      if (lines.length === 0) {
        error("That tier sheet has no rates yet — fill it in on Rates & Tariff.");
        return;
      }
      setDraft((d) =>
        d
          ? {
              ...d,
              lines,
              rate_tier: sheet.tier,
              agent_id: partnerIds.agent,
              transporter_id: partnerIds.transporter,
              clearing_agent_id: partnerIds.clearing_agent,
            }
          : d,
      );
      toast(
        `Loaded ${lines.length} line${lines.length === 1 ? "" : "s"} from ${rateTier(sheet.tier).label} · ${sheet.route}` +
          (kg > 0 ? "" : " — add the packing list, then load again to pick the right weight break"),
      );
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not load the tier rates");
    } finally {
      setTierLoading(false);
    }
  }

  /** Drag-reorder a charge line: drop `from` before/after `to`. The saved
      position follows the array order, so this is all it takes to persist. */
  function moveLine(from: number, to: number, after: boolean) {
    if (from === to) return;
    setDraft((d) => {
      if (!d) return d;
      const lines = [...d.lines];
      const [moved] = lines.splice(from, 1);
      let at = to > from ? to - 1 : to;
      if (after) at += 1;
      lines.splice(at, 0, moved);
      return { ...d, lines };
    });
  }

  function removeLine(index: number) {
    setDraft((d) =>
      d ? { ...d, lines: d.lines.filter((_, i) => i !== index) } : d,
    );
  }

  async function onSave() {
    if (!draft) return;
    if (!draft.client_id && !draft.lead_id) {
      error("Please select a customer or lead");
      return;
    }
    if (!draft.reference.trim()) {
      error("Reference is required");
      return;
    }
    try {
      const savedId = await saveQuote.mutateAsync(draft);
      // A duplicated quote takes today's date on its first save.
      await finalizeCopied.mutateAsync(savedId);
      toast("Quotation saved");
      navigate(`/quotes`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save quotation");
    }
  }

  const clients = clientsQ.data ?? [];
  const tierRoutes = (tariffQ.data ?? []).filter(
    (s) => s.tier === draft.rate_tier && s.mode === draft.mode,
  );
  const unpromotedLeads = (leadsQ.data ?? []).filter((l) => !l.promoted_client_id);
  const salesPeople = (profilesQ.data ?? []).filter(
    (p) => p.role === "admin" || p.role === "user",
  );
  const suppliers = suppliersQ.data ?? [];
  const agents = agentsQ.data ?? [];
  const transporters = transportersQ.data ?? [];
  const clearingAgents = clearingAgentsQ.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Air / Sea / Road costing"
        title={isEdit ? "Edit Quotation" : "Generate a Quotation"}
        actions={
          <>
            <button
              className="btn outline"
              onClick={() => navigate(-1)}
              disabled={saveQuote.isPending}
            >
              Cancel
            </button>
            {isEdit && draft.id && (
              <button
                className="btn outline"
                onClick={() =>
                  window.open(`/quotes/${draft.id}/print`, "_blank", "noopener")
                }
                title="Open the customer quotation document in a new tab"
              >
                Quotation Document
              </button>
            )}
            <button className="btn" onClick={onSave} disabled={saveQuote.isPending}>
              {saveQuote.isPending ? "Saving…" : "Save Quotation"}
            </button>
          </>
        }
      />

      <div className="panel">
        <div className="panel-head">
          <h2>Shipment Information</h2>
        </div>
        <div className="grid4">
          {/* Row 1 */}
          <div className="field">
            <label>Shipment No</label>
            <input
              value={draft.reference}
              readOnly
              title="System-generated shipment number — set by the transport mode"
              style={{ background: "var(--paper)", cursor: "not-allowed" }}
            />
          </div>
          <div className="field">
            <label>Mode</label>
            <select
              value={draft.mode}
              onChange={(e) => setMode(e.target.value as QuoteDraft["mode"])}
            >
              {QUOTE_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Incoterms</label>
            <select
              value={draft.incoterms}
              onChange={(e) => set("incoterms", e.target.value)}
            >
              <option value="">— incoterms —</option>
              {draft.incoterms &&
                !INCOTERM_CODES.includes(draft.incoterms) && (
                  <option value={draft.incoterms}>{draft.incoterms}</option>
                )}
              <optgroup label="Any mode (incl. air)">
                {INCOTERMS_ANY_MODE.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Sea / inland waterway">
                {INCOTERMS_SEA.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select
              value={draft.status}
              onChange={(e) =>
                set("status", e.target.value as QuoteDraft["status"])
              }
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2 */}
          <div className="field">
            <label>Customer/Importer</label>
            <select
              value={draft.client_id ? `c:${draft.client_id}` : draft.lead_id ? `l:${draft.lead_id}` : ""}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(":");
                const pickedLead = kind === "l" ? unpromotedLeads.find((l) => l.id === id) : null;
                // The customer's rate tier (Silver for leads / by default).
                const tier: RateTierId =
                  (kind === "c" ? clients.find((c) => c.id === id)?.rate_tier : null) ?? "silver";
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        client_id: kind === "c" ? id : "",
                        lead_id: kind === "l" ? id : "",
                        sales_person_id: pickedLead?.sales_person_id || d.sales_person_id,
                        rate_tier: tier,
                        tariff_sheet_id: tier === d.rate_tier ? d.tariff_sheet_id : "",
                      }
                    : d,
                );
              }}
            >
              <option value="">Select customer</option>
              {clients.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.company}
                </option>
              ))}
              {unpromotedLeads.length > 0 && (
                <optgroup label="Leads (not yet a customer)">
                  {unpromotedLeads.map((l) => (
                    <option key={l.id} value={`l:${l.id}`}>
                      {l.company}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {clients.length === 0 && unpromotedLeads.length === 0 && (
              <span className="hint">
                No customers or leads yet — add one on the Customers or Leads page
                first.
              </span>
            )}
            {draft.lead_id && (
              <span className="hint">
                Accepting this quote will automatically create a real customer
                record for this lead.
              </span>
            )}
          </div>
          <div className="field">
            <label>Reference</label>
            <input
              value={draft.customer_reference}
              onChange={(e) => set("customer_reference", e.target.value)}
              placeholder="Customer reference / PO"
            />
          </div>
          <div className="field">
            <label>Shipper/Exporter</label>
            <select
              value={draft.supplier_id}
              onChange={(e) => {
                if (e.target.value === "__add__") {
                  setAddingShipper(true);
                  return;
                }
                set("supplier_id", e.target.value);
              }}
            >
              <option value="__add__">+ Add Shipper</option>
              <option value="">Select shipper</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Consignee/Delivery Point</label>
            <select
              value={
                draft.consignee_id
                  ? `c:${draft.consignee_id}`
                  : draft.consignee_lead_id
                    ? `l:${draft.consignee_lead_id}`
                    : ""
              }
              onChange={(e) => {
                const [kind, id] = e.target.value.split(":");
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        consignee_id: kind === "c" ? id : "",
                        consignee_lead_id: kind === "l" ? id : "",
                      }
                    : d,
                );
              }}
            >
              <option value="">Same as Customer/Importer</option>
              {clients.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.company}
                </option>
              ))}
              {unpromotedLeads.length > 0 && (
                <optgroup label="Leads (not yet a customer)">
                  {unpromotedLeads.map((l) => (
                    <option key={l.id} value={`l:${l.id}`}>
                      {l.company}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="field">
            <label>Delivery terms</label>
            <input
              value={draft.delivery_terms}
              onChange={(e) => set("delivery_terms", e.target.value)}
            />
          </div>

          {/* Row 3 */}
          <div className="field">
            <label>Commercial Value</label>
            <div className="value-currency-row">
              <input
                type="number"
                step="any"
                value={draft.commercial_value}
                onChange={(e) => set("commercial_value", e.target.value)}
              />
              <select
                className="value-currency-select"
                value={draft.value_currency}
                onChange={(e) => set("value_currency", e.target.value)}
                title="Currency the Commercial Value / Insurance Amount were captured in"
              >
                {LINE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Insurance Amount</label>
            <div className="value-currency-row">
              <input
                type="number"
                readOnly
                tabIndex={-1}
                value={insuranceAmount(draft.commercial_value).toFixed(2)}
                title="0.50% of Commercial Value"
              />
              <span className="value-currency-badge">{draft.value_currency}</span>
            </div>
          </div>
          <div className="field">
            <label>Commodity</label>
            <select
              value={draft.commodity}
              onChange={(e) => set("commodity", e.target.value)}
            >
              {!COMMODITIES.includes(draft.commodity as Commodity) && (
                <option value={draft.commodity}>
                  {draft.commodity || "Select commodity"}
                </option>
              )}
              {COMMODITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Valid Until</label>
            <DateInput
              value={draft.valid_until}
              onChange={(v) => set("valid_until", v)}
            />
          </div>

          {/* Row 4 */}
          <datalist id="qb-locodes">
            {LOCODE_OPTIONS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <div className="field">
            <label>Origin/Port of Load</label>
            <input
              list="qb-locodes"
              value={draft.origin}
              onChange={(e) => set("origin", e.target.value)}
              placeholder="CNSHA — Shanghai, China"
            />
            <span className="hint">
              Pick a UN/LOCODE or type your own (start with the 5-char code).
            </span>
          </div>
          <div className="field">
            <label>Destination/Port of Discharge</label>
            <input
              list="qb-locodes"
              value={draft.destination}
              onChange={(e) => set("destination", e.target.value)}
              placeholder="ZADUR — Durban, South Africa"
            />
            <span className="hint">
              Pick a UN/LOCODE or type your own (start with the 5-char code).
            </span>
          </div>
          <div className="field">
            <label>ETD</label>
            <DateInput
              value={draft.etd}
              onChange={(v) => set("etd", v)}
            />
          </div>
          <div className="field">
            <label>ETA</label>
            <DateInput
              value={draft.eta}
              onChange={(v) => set("eta", v)}
            />
          </div>
          <div className="field">
            <label>Provisional Delivery Date</label>
            <DateInput
              value={draft.provisional_delivery_date}
              onChange={(v) => set("provisional_delivery_date", v)}
            />
          </div>

          {/* Mode-specific fields — only the selected mode's fields are shown
              (same split as the shipment documents; Road uses Sea for now).
              Values typed under another mode are kept, just hidden. */}
          {usesSeaLayout(draft.mode) ? (
            <>
            <div className="field">
              <label>{carrierLabel(draft.mode)}</label>
              <input
                value={draft.shipping_line}
                onChange={(e) => set("shipping_line", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Vessel Name</label>
              <input
                value={draft.vessel_name}
                onChange={(e) => set("vessel_name", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Voyage No</label>
              <input
                value={draft.voyage_no}
                onChange={(e) => set("voyage_no", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Container Number</label>
              <input
                value={draft.container_no}
                onChange={(e) => set("container_no", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Container Type</label>
              <input
                value={draft.container_type}
                onChange={(e) => set("container_type", e.target.value)}
                placeholder="e.g. 1x 20GP, 2x 40HC"
              />
            </div>
            <div className="field">
              <label>MBL No</label>
              <input
                value={draft.mbl_no}
                onChange={(e) => set("mbl_no", e.target.value)}
              />
            </div>
            <div className="field">
              <label>HBL No</label>
              <input
                value={draft.hbl_no}
                onChange={(e) => set("hbl_no", e.target.value)}
              />
            </div>
            </>
          ) : (
            <>
            <div className="field">
              <label>Agent/Airline Name (internal only)</label>
              <input
                value={draft.carrier_name}
                onChange={(e) => set("carrier_name", e.target.value)}
              />
              <span className="hint">Not shown on the customer quotation.</span>
            </div>
            <div className="field">
              <label>Flight No</label>
              <input
                value={draft.flight_no}
                onChange={(e) => set("flight_no", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Flight Date</label>
              <DateInput
                value={draft.flight_date}
                onChange={(v) => set("flight_date", v)}
              />
            </div>
            <div className="field">
              <label>Routing</label>
              <input
                value={draft.routing}
                onChange={(e) => set("routing", e.target.value)}
                placeholder="e.g. CAN – DXB – JNB"
              />
            </div>
            <div className="field">
              <label>Transit Time</label>
              <input
                value={draft.transit_time}
                onChange={(e) => set("transit_time", e.target.value)}
                placeholder="e.g. 3–5 days"
              />
            </div>
            <div className="field">
              <label>MAWB No</label>
              <input
                value={draft.mawb_no}
                onChange={(e) => set("mawb_no", e.target.value)}
              />
            </div>
            <div className="field">
              <label>HAWB No</label>
              <input
                value={draft.hawb_no}
                onChange={(e) => set("hawb_no", e.target.value)}
              />
            </div>
            </>
          )}

          {/* Tier rate sheets (0119) — admin-only, like Rates & Tariff */}
          {isAdmin && (
          <>
          <div className="field">
            <label>
              <TierDot tier={draft.rate_tier} />
              Rate tier
            </label>
            <select
              value={draft.rate_tier}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? { ...d, rate_tier: e.target.value as RateTierId, tariff_sheet_id: "" }
                    : d,
                )
              }
            >
              {RATE_TIERS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.margin}%)
                </option>
              ))}
            </select>
            <span className="hint">From the customer — change it for this quote if needed.</span>
          </div>
          <div className="field">
            <label>Trade route</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={draft.tariff_sheet_id}
                onChange={(e) => set("tariff_sheet_id", e.target.value)}
              >
                <option value="">
                  {tierRoutes.length
                    ? "— pick a trade route —"
                    : `No ${rateTier(draft.rate_tier).label} ${draft.mode} sheets yet`}
                </option>
                {tierRoutes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.route}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn outline"
                disabled={!tierRoutes.some((s) => s.id === draft.tariff_sheet_id) || tierLoading}
                onClick={loadTierRates}
              >
                {tierLoading ? "Loading…" : "Load rates"}
              </button>
            </div>
            <span className="hint">Fills the charge lines from the tier rate sheet.</span>
          </div>
          </>
          )}

          {/* Internal only / every mode */}
          <div className="field">
            <label>Agent (internal only)</label>
            <select
              value={draft.agent_id}
              onChange={(e) => set("agent_id", e.target.value)}
            >
              <option value="">Select agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company}
                </option>
              ))}
            </select>
            <span className="hint">Not shown on the customer quotation.</span>
          </div>
          <div className="field">
            <label>Clearing Agent (internal only)</label>
            <select
              value={draft.clearing_agent_id}
              onChange={(e) => set("clearing_agent_id", e.target.value)}
            >
              <option value="">Select clearing agent</option>
              {clearingAgents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
            <span className="hint">Not shown on the customer quotation.</span>
          </div>
          <div className="field">
            <label>Transporter (internal only)</label>
            <select
              value={draft.transporter_id}
              onChange={(e) => set("transporter_id", e.target.value)}
            >
              <option value="">Select transporter</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.company}
                </option>
              ))}
            </select>
            <span className="hint">Not shown on the customer quotation.</span>
          </div>
          <div className="field">
            <label>Sales Person</label>
            <select
              value={draft.sales_person_id}
              onChange={(e) => set("sales_person_id", e.target.value)}
            >
              <option value="">— unassigned —</option>
              {salesPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || "—"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Packing List Information</h2>
            <p>
              Dimensions in cm. Volume (KGS) = CBM × {vFactor}
              {vFactor === 1000 ? " (Sea LCL: 1 CBM = 1 000 kg)" : ""}. Chargeable
              weight = greater of total actual and total volume weight.
            </p>
          </div>
          <button className="btn small outline" onClick={addPacking}>
            + Add package
          </button>
        </div>

        <div className="table-wrap">
          <table className="packing-table">
            <colgroup>
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col className="pk-x" />
            </colgroup>
            <thead>
              <tr>
                <th>L (cm)</th>
                <th>W (cm)</th>
                <th>H (cm)</th>
                <th>Actual (KGS)</th>
                <th>Qty (CTNS)</th>
                <th>Cubic M (CBM)</th>
                <th>Volume (KGS)</th>
                <th>Total Cbm</th>
                <th>Total Act (KGS)</th>
                <th>Total Vol (KGS)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.packing.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted">
                    No packages. Click "Add package".
                  </td>
                </tr>
              ) : (
                draft.packing.map((p, i) => {
                  const r = packingRow(p, vFactor);
                  return (
                    <tr key={i}>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.length_cm ?? "")}
                          onChange={(e) => setPacking(i, "length_cm", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.width_cm ?? "")}
                          onChange={(e) => setPacking(i, "width_cm", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.height_cm ?? "")}
                          onChange={(e) => setPacking(i, "height_cm", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.actual_kg ?? "")}
                          onChange={(e) => setPacking(i, "actual_kg", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.qty_ctns ?? "")}
                          onChange={(e) => setPacking(i, "qty_ctns", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="any"
                          value={String(p.cbm ?? "")}
                          placeholder={(
                            ((Number(p.length_cm) || 0) *
                              (Number(p.width_cm) || 0) *
                              (Number(p.height_cm) || 0)) /
                            1_000_000
                          ).toFixed(2)}
                          title="Auto from L×W×H — type to override"
                          onChange={(e) => setPacking(i, "cbm", e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={r.volumeKg.toFixed(2)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={r.totalCbm.toFixed(2)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={r.totalActual.toFixed(2)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={r.totalVolume.toFixed(2)}
                        />
                      </td>
                      <td>
                        <button
                          className="btn ghost small"
                          onClick={() => removePacking(i)}
                          aria-label="Remove package"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {draft.packing.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>
                    Totals
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {packTotals.qty}
                  </td>
                  <td className="num" />
                  <td className="num" />
                  <td className="num" style={{ fontWeight: 700 }}>
                    {packTotals.totalCbm.toFixed(2)}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {packTotals.totalActual.toFixed(2)}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {packTotals.totalVolume.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="totals">
          <div className="t">
            <div className="label">Total Act (KGS)</div>
            <div className="val">{packTotals.totalActual.toFixed(2)}</div>
          </div>
          <div className="t">
            <div className="label">Volume (KGS)</div>
            <div className="val">{packTotals.totalVolume.toFixed(2)}</div>
          </div>
          <div className="t">
            <div className="label">Chg Vol (CBM)</div>
            <div className="val" style={{ color: "var(--green-dark)" }}>
              {packTotals.totalCbm.toFixed(2)}
            </div>
          </div>
          <div className="t">
            <div className="label">Chg Weight (KGS)</div>
            <div className="val" style={{ color: "var(--green-dark)" }}>
              {packTotals.chargeable.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Charges</h2>
            <p>Buy cost stays internal — sell price is what your customer sees</p>
          </div>
        </div>

        <div className="fx-row">
          <div>
            <label>USD → ZAR</label>
            <input
              type="number"
              step="0.01"
              value={draft.fx_usd_zar}
              onChange={(e) => setFx("fx_usd_zar", e.target.value)}
            />
          </div>
          <div>
            <label>CNY → ZAR</label>
            <input
              type="number"
              step="0.01"
              value={draft.fx_cny_zar}
              onChange={(e) => setFx("fx_cny_zar", e.target.value)}
            />
          </div>
          {Number(draft.fx_eur_zar) > 0 && (
            <div>
              <label>EUR → ZAR</label>
              <input
                type="number"
                step="0.01"
                value={draft.fx_eur_zar}
                onChange={(e) => setFx("fx_eur_zar", e.target.value)}
              />
            </div>
          )}
          {Number(draft.fx_gbp_zar) > 0 && (
            <div>
              <label>GBP → ZAR</label>
              <input
                type="number"
                step="0.01"
                value={draft.fx_gbp_zar}
                onChange={(e) => setFx("fx_gbp_zar", e.target.value)}
              />
            </div>
          )}
          {(Number(draft.fx_eur_zar) <= 0 || Number(draft.fx_gbp_zar) <= 0) && (
            <select
              className="fx-add-currency"
              value=""
              title="Add another quoting currency"
              onChange={(e) => addCurrency(e.target.value)}
            >
              <option value="">+ Add currency</option>
              {Number(draft.fx_eur_zar) <= 0 && <option value="EUR">EUR</option>}
              {Number(draft.fx_gbp_zar) <= 0 && <option value="GBP">GBP (UK)</option>}
            </select>
          )}
          <button
            type="button"
            className="btn small outline"
            onClick={getLiveRates}
            disabled={fxLoading}
          >
            {fxLoading ? "Fetching…" : "Get live rates"}
          </button>
          <span className="hint">
            Sell (R) = Buy × (1 + Margin%) × the rate for the line's currency.
            Line totals are in ZAR.
            {fxAsOf &&
              ` Live rates as at ${fxAsOf}, plus R${LIVE_RATE_BUFFER_ZAR.toFixed(2)} each for currency movement.`}
          </span>
        </div>

        {groups.map((g) => (
          <div className="charge-group" key={g.category}>
            <div className="charge-group-head">
              <h3>{g.category.toUpperCase()}</h3>
              <div style={{ display: "flex", gap: 8 }}>
                {isAdmin && (
                <button
                  className="btn small outline"
                  onClick={() => setRatePickerFor(g.category)}
                >
                  From Rates
                </button>
                )}
                <button
                  className="btn small outline"
                  onClick={() => addLine(g.category)}
                >
                  + Add line
                </button>
              </div>
            </div>

            {g.lines.length === 0 ? (
              <p className="hint" style={{ padding: "4px 0 10px" }}>
                No charges in this section.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="charge-table has-drag">
                  <thead>
                    <tr>
                      <th className="c-drag" />
                      <th className="c-code">Code</th>
                      <th>Description</th>
                      <th className="c-cur">Cur</th>
                      <th className="c-unit">Unit</th>
                      <th className="num">Qty</th>
                      <th className="num">Buy</th>
                      <th className="num">Margin (%)</th>
                      <th className="num">VAT (%)</th>
                      <th className="num">Sell</th>
                      <th className="num">Sell (R)</th>
                      <th className="num">Total Buy</th>
                      <th className="num">Total Sell</th>
                      <th className="num">Line total (R)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map(({ line: l, index: i }) => {
                      const autoQ = autoQty(l, draft.mode, packTotals);
                      const qtyDerived = autoQ != null && !l.qty_override;
                      // Sell-only lines — the figure is typed straight into
                      // Sell (R), with Buy / Margin / Sell / Total Buy
                      // dashed: service fees (IN-01 / FW-01 / DIS-01 / CU-05),
                      // Customs VAT (CU-02, whole amount is VAT) and Customs
                      // Duty (CU-03, a pass-through disbursement, zero-rated).
                      const code = String(l.code ?? "");
                      const isSellOnly =
                        SERVICE_FEE_CODES.includes(code) ||
                        code === CUSTOMS_VAT_CODE ||
                        code === CUSTOMS_DUTY_CODE;
                      const isCustomsDuty = code === CUSTOMS_DUTY_CODE;
                      return (
                      <tr
                        key={i}
                        className={
                          dragLine === i
                            ? "is-dragging"
                            : dropAt?.index === i
                              ? dropAt.after
                                ? "drop-after"
                                : "drop-before"
                              : undefined
                        }
                        onDragOver={(e) => {
                          // Only within the same section — a line's category
                          // decides which group it prints under.
                          if (
                            dragLine == null ||
                            draft.lines[dragLine]?.category !== l.category
                          )
                            return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const r = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          if (dropAt?.index !== i || dropAt.after !== after)
                            setDropAt({ index: i, after });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragLine != null && dropAt)
                            moveLine(dragLine, dropAt.index, dropAt.after);
                          setDragLine(null);
                          setDropAt(null);
                        }}
                      >
                        <td
                          className="c-drag"
                          draggable
                          title="Drag to move this line up or down"
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", String(i));
                            const row = e.currentTarget.parentElement;
                            if (row) e.dataTransfer.setDragImage(row, 12, 16);
                            setDragLine(i);
                          }}
                          onDragEnd={() => {
                            setDragLine(null);
                            setDropAt(null);
                          }}
                        >
                          ⠿
                        </td>
                        <td className="c-code">
                          <select
                            value={String(l.code ?? "")}
                            onChange={(e) => pickCode(i, e.target.value)}
                          >
                            <option value="">— code —</option>
                            {catalogForCategory(g.category, draft.mode).map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                            {l.code &&
                              !catalogForCategory(g.category, draft.mode).some(
                                (c) => c.code === l.code,
                              ) && <option value={l.code}>{l.code}</option>}
                          </select>
                        </td>
                        <td>
                          <input
                            value={String(l.description ?? "")}
                            onChange={(e) =>
                              setLine(i, "description", e.target.value)
                            }
                            placeholder="Charge description"
                            title={
                              catalogItem(String(l.code ?? ""), draft.mode)
                                ? "Pre-filled from the code — edit if you need to"
                                : undefined
                            }
                          />
                        </td>
                        <td className="c-cur">
                          <select
                            value={l.cur}
                            onChange={(e) => setLine(i, "cur", e.target.value)}
                          >
                            {LINE_CURRENCIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td className="c-unit">
                          <select
                            value={String(l.unit ?? "")}
                            onChange={(e) => setLine(i, "unit", e.target.value)}
                          >
                            <option value="">— unit —</option>
                            {CHARGE_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                            {l.unit &&
                              !CHARGE_UNITS.includes(String(l.unit)) && (
                                <option value={String(l.unit)}>
                                  {String(l.unit)}
                                </option>
                              )}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="any"
                            className={qtyDerived ? "qty-derived" : undefined}
                            value={
                              qtyDerived
                                ? (autoQ ?? 0).toFixed(2)
                                : String(draft.lines[i]?.qty ?? "")
                            }
                            onChange={(e) =>
                              setLineFields(i, {
                                qty: e.target.value,
                                qty_override: true,
                              })
                            }
                            title={
                              qtyDerived
                                ? "Auto from the Packing List for this unit — type to override"
                                : l.qty_override
                                  ? "Manually set — clear or change the unit to go back to auto"
                                  : undefined
                            }
                          />
                        </td>
                        <td className="num">
                          {isSellOnly ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value=""
                              placeholder="—"
                              title="Sell-only line — no buy cost, priced only in Sell (R)"
                            />
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={String(l.buy ?? "")}
                              onChange={(e) => setLine(i, "buy", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="num">
                          {isSellOnly ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value=""
                              placeholder="—"
                              title="Sell-only line — no markup, priced only in Sell (R)"
                            />
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={String(l.margin ?? "")}
                              onChange={(e) => setLine(i, "margin", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="num">
                          {isCustomsDuty ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value="0"
                              title="Customs Duty is always zero-rated for VAT"
                            />
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={String(l.vat_pct ?? "")}
                              onChange={(e) =>
                                setLine(i, "vat_pct", e.target.value)
                              }
                              title="VAT % on this line's ZAR total (0 = zero-rated)"
                            />
                          )}
                        </td>
                        <td className="num">
                          {isSellOnly ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value=""
                              placeholder="—"
                              title="Sell-only line — priced directly in Sell (R)"
                            />
                          ) : (
                            <input
                              type="number"
                              readOnly
                              value={sellInCur(l.buy, l.margin).toFixed(2)}
                              title={`Buy + margin, in ${l.cur} (before ZAR conversion)`}
                              tabIndex={-1}
                            />
                          )}
                        </td>
                        <td className="num">
                          {isSellOnly ? (
                            <input
                              type="number"
                              step="any"
                              value={String(draft.lines[i]?.sell ?? "")}
                              placeholder="0"
                              onChange={(e) =>
                                setLineFields(i, { sell: e.target.value })
                              }
                              title="Sell-only line — type the Sell (R) amount"
                            />
                          ) : (
                            <input
                              type="number"
                              readOnly
                              value={(Number(l.sell) || 0).toFixed(2)}
                              title="Sell, in the line's currency, before ZAR conversion"
                              tabIndex={-1}
                            />
                          )}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            readOnly
                            value={isSellOnly ? "" : lineBuyTotal(l).toFixed(2)}
                            placeholder={isSellOnly ? "—" : undefined}
                            title={
                              isSellOnly
                                ? "Sell-only line — no buy cost"
                                : `Qty × Buy in ${l.cur} — foreign purchase total`
                            }
                            tabIndex={-1}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            readOnly
                            value={isSellOnly ? "" : lineSellTotal(l).toFixed(2)}
                            placeholder={isSellOnly ? "—" : undefined}
                            title={
                              isSellOnly
                                ? "Sell-only line — priced directly in ZAR"
                                : `Qty × Sell in ${l.cur} — foreign sell total, before ZAR conversion`
                            }
                            tabIndex={-1}
                          />
                        </td>
                        <td
                          className="num"
                          style={{ textAlign: "right", fontWeight: 700 }}
                        >
                          {money(lineTotal(l))}
                        </td>
                        <td>
                          <button
                            className="btn ghost small"
                            onClick={() => removeLine(i)}
                            aria-label="Remove line"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {g.lines.length > 0 && (
              <div className="charge-group-subtotal">
                Section subtotal:&nbsp;<strong>{money(g.subtotal)}</strong>
                {g.vat > 0 && (
                  <>
                    &nbsp;·&nbsp;VAT:&nbsp;<strong>{money(g.vat)}</strong>
                    &nbsp;·&nbsp;Incl. VAT:&nbsp;<strong>{money(g.subtotalIncl)}</strong>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="sell-currency-row">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={!!draft.sell_currency}
              onChange={(e) =>
                set("sell_currency", e.target.checked ? "USD" : "")
              }
            />
            Quote &amp; invoice customer totals in a foreign currency
          </label>
          {draft.sell_currency && (
            <select
              value={draft.sell_currency}
              onChange={(e) => {
                set("sell_currency", e.target.value);
                addCurrency(e.target.value);
              }}
            >
              {LINE_CURRENCIES.filter((c) => c !== "ZAR").map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <span className="hint">
            Uses this quote's own {draft.sell_currency || "…"} → ZAR rate above.
            Internal cost / margin stay in ZAR.
          </span>
        </div>
        <div className="totals">
          <div className="t">
            <div className="label">Internal cost (ZAR)</div>
            <div className="val">{money(totals.cost)}</div>
          </div>
          <div className="t">
            <div className="label">Gross profit</div>
            <div className="val">{money(totals.gp)}</div>
          </div>
          <div className="t">
            <div className="label">Margin</div>
            <div className="val">{totals.margin.toFixed(1)}%</div>
          </div>
          <div className="t">
            <div className="label">Cost of Sales Ratio</div>
            <div
              className="val"
              style={{
                color:
                  costOfSalesRatio <= costOfSalesTarget
                    ? "var(--green-dark)"
                    : "var(--orange)",
              }}
              title={`Cost ÷ Customer total excl. VAT · target ≤ ${costOfSalesTarget}%`}
            >
              {costOfSalesRatio.toFixed(1)}%
            </div>
          </div>
          <div className="t">
            <div className="label">Customer total (excl. VAT)</div>
            <div className="val">
              {sellCur
                ? moneyCur(convertZar(totals.sell, sellCur, fx), sellCur)
                : money(totals.sell)}
            </div>
          </div>
          <div className="t">
            <div className="label">VAT</div>
            <div className="val">
              {sellCur
                ? moneyCur(convertZar(totals.vat, sellCur, fx), sellCur)
                : money(totals.vat)}
            </div>
          </div>
          <div className="t">
            <div className="label">Customer total (incl. VAT)</div>
            <div className="val" style={{ color: "var(--green-dark)" }}>
              {sellCur
                ? moneyCur(convertZar(totals.sellIncl, sellCur, fx), sellCur)
                : money(totals.sellIncl)}
            </div>
          </div>
        </div>
      </div>

      {ratePickerFor && (
        <RatePickerModal
          category={ratePickerFor}
          mode={draft.mode}
          rates={ratesQ.data ?? []}
          onPick={(rate) => {
            addLineFromRate(rate);
            setRatePickerFor(null);
          }}
          onClose={() => setRatePickerFor(null)}
        />
      )}

      {addingShipper && (
        <AddShipperModal
          busy={saveSupplier.isPending}
          onSave={async (company, contact, email, phone) => {
            try {
              const created = await saveSupplier.mutateAsync({
                values: { company, contact, email, phone },
              });
              set("supplier_id", created.id);
              setAddingShipper(false);
              toast("Shipper added");
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not add shipper");
            }
          }}
          onClose={() => setAddingShipper(false)}
        />
      )}
    </>
  );
}

function RatePickerModal({
  category,
  mode,
  rates,
  onPick,
  onClose,
}: {
  category: ChargeCategory;
  mode: QuoteDraft["mode"];
  rates: RateSheetItem[];
  onPick: (rate: RateSheetItem) => void;
  onClose: () => void;
}) {
  const matches = rates.filter(
    (r) => r.category === category && r.mode === mode,
  );
  return (
    <Modal title={`${category} — Rate list`} onClose={onClose} wide>
      <p className="hint" style={{ marginBottom: 10 }}>
        To price the whole quote from a tier, use Rate tier / Trade route → Load rates above.
      </p>
      {matches.length === 0 ? (
        <p className="muted">
          No {mode} rates in the rate list for this category.
        </p>
      ) : (
        <div className="stack-sm">
          {matches.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn ghost small"
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
              }}
              onClick={() => onPick(r)}
            >
              <span>
                {r.code ? `${r.code} - ` : ""}
                {r.description}
                {r.carrier ? ` (${r.carrier})` : ""}
                {(r.origin || r.destination) &&
                  ` — ${r.origin || "Any"} → ${r.destination || "Any"}`}
              </span>
              <span className="muted">
                {r.cur} {r.buy.toFixed(2)} · {r.margin}%
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Quick-create a shipper without leaving the builder — just enough to pick
 *  it on this quote; the full record (VAT no, address, etc.) can be filled
 *  in later from Suppliers. Saves to the same suppliers table that page
 *  reads, so the new shipper shows up there too. */
function AddShipperModal({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (
    company: string,
    contact: string | null,
    email: string | null,
    phone: string | null,
  ) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company.trim()) return;
    onSave(
      company.trim(),
      contact.trim() || null,
      email.trim() || null,
      phone.trim() || null,
    );
  }

  return (
    <Modal title="Add Shipper" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Company</label>
          <input
            autoFocus
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
          />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Contact Person</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <span className="hint">
          Just enough to pick it on this quote — add VAT no, address etc.
          later from Suppliers.
        </span>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="submit" className="btn" disabled={busy || !company.trim()}>
            {busy ? "Saving…" : "Add Shipper"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
