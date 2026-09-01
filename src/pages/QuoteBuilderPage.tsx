import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import {
  useClients,
  useQuote,
  useSaveQuote,
  useSuppliers,
} from "../lib/hooks";
import {
  autoQty,
  chargeTotals,
  groupByCategory,
  impliedMargin,
  insuranceAmount,
  INSURANCE_CODE,
  lineTotal,
  packingRow,
  packingTotals,
  resolveLine,
  sellFromBuy,
  sellInCur,
  VOLUMETRIC_FACTOR,
  type FxRates,
} from "../lib/calc";
import { catalogForCategory, catalogItem } from "../lib/chargeCatalog";
import { fetchLiveRates } from "../lib/fx";
import { money, newReference, todayPlusDays } from "../lib/format";
import {
  CHARGE_CATEGORIES,
  CHARGE_UNITS,
  COMMODITIES,
  INCOTERM_CODES,
  INCOTERMS_ANY_MODE,
  INCOTERMS_SEA,
  LINE_CURRENCIES,
  QUOTE_MODES,
  STATUS_LABEL,
  STATUS_ORDER,
  type ChargeCategory,
  type Commodity,
  type PackingItem,
  type Quote,
  type QuoteDraft,
  type QuoteLine,
} from "../lib/types";

function newPackingItem(position: number): PackingItem {
  return {
    position,
    length_cm: 0,
    width_cm: 0,
    height_cm: 0,
    actual_kg: 0,
    qty_ctns: 1,
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
    buy: 0,
    margin: 0,
    sell: 0,
  };
}

function blankDraft(): QuoteDraft {
  return {
    id: null,
    reference: newReference(),
    client_id: "",
    supplier_id: "",
    mode: "Air Freight (AIR)",
    commodity: "General Cargo",
    origin: "",
    destination: "",
    delivery_terms: "Door to Door",
    valid_until: todayPlusDays(14),
    status: "draft",
    commercial_value: "",
    insurance_amount: "",
    vessel_name: "",
    mbl_no: "",
    hbl_no: "",
    container_no: "",
    etd: "",
    eta: "",
    incoterms: "",
    mawb_no: "",
    hawb_no: "",
    flight_no: "",
    flight_date: "",
    carrier_name: "",
    fx_usd_zar: "18.50",
    fx_cny_zar: "2.60",
    packing: [newPackingItem(0)],
    lines: [newLine("International Freight Charges", 0)],
  };
}

function draftFromQuote(q: Quote): QuoteDraft {
  return {
    id: q.id,
    reference: q.reference,
    client_id: q.client_id ?? "",
    supplier_id: q.supplier_id ?? "",
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
    mbl_no: q.mbl_no ?? "",
    hbl_no: q.hbl_no ?? "",
    container_no: q.container_no ?? "",
    etd: q.etd ?? "",
    eta: q.eta ?? "",
    incoterms: q.incoterms ?? "",
    mawb_no: q.mawb_no ?? "",
    hawb_no: q.hawb_no ?? "",
    flight_no: q.flight_no ?? "",
    flight_date: q.flight_date ?? "",
    carrier_name: q.carrier_name ?? "",
    fx_usd_zar: q.fx_usd_zar != null ? String(q.fx_usd_zar) : "0",
    fx_cny_zar: q.fx_cny_zar != null ? String(q.fx_cny_zar) : "0",
    packing: (q.packing_list_items ?? []).map((p, i) => ({
      position: i,
      length_cm: p.length_cm ?? 0,
      width_cm: p.width_cm ?? 0,
      height_cm: p.height_cm ?? 0,
      actual_kg: p.actual_kg ?? 0,
      qty_ctns: p.qty_ctns ?? 0,
    })),
    lines: q.quote_lines.map((l, i) => {
      const fx: FxRates = {
        usd: Number(q.fx_usd_zar) || 0,
        cny: Number(q.fx_cny_zar) || 0,
      };
      const cur = (l.cur as QuoteLine["cur"]) ?? "USD";
      let buy = Number(l.buy) || 0;
      const storedSell = Number(l.sell) || 0;
      const rate = cur === "USD" ? fx.usd : cur === "CNY" ? fx.cny : 1;
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
      return {
        position: i,
        category: (l.category as ChargeCategory) ?? CHARGE_CATEGORIES[0],
        code: l.code ?? "",
        description: l.description ?? "",
        cur,
        unit,
        qty: l.qty ?? 0,
        buy,
        margin,
        sell: sellFromBuy(buy, margin, cur, fx),
      };
    }),
  };
}

export default function QuoteBuilderPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { toast, error } = useToast();

  const clientsQ = useClients();
  const suppliersQ = useSuppliers();
  const existingQ = useQuote(id);
  const saveQuote = useSaveQuote();

  const [draft, setDraft] = useState<QuoteDraft | null>(isEdit ? null : blankDraft());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxAsOf, setFxAsOf] = useState("");

  // Adjust state when the loaded quote arrives (React-sanctioned set-state-in-render).
  if (isEdit && existingQ.data && loadedFor !== existingQ.data.id) {
    setLoadedFor(existingQ.data.id);
    setDraft(draftFromQuote(existingQ.data));
  }

  const fx = useMemo(
    () => ({
      usd: Number(draft?.fx_usd_zar) || 0,
      cny: Number(draft?.fx_cny_zar) || 0,
    }),
    [draft?.fx_usd_zar, draft?.fx_cny_zar],
  );
  const packTotals = useMemo(
    () => packingTotals(draft?.packing ?? []),
    [draft?.packing],
  );
  // Lines with code/unit-driven values resolved (KGS qty -> chargeable weight, IN-01 -> insurance).
  const resolvedLines = useMemo(
    () =>
      (draft?.lines ?? []).map((l) =>
        resolveLine(l, {
          mode: draft?.mode ?? "Air Freight (AIR)",
          fx,
          pack: packTotals,
          commercialValue: draft?.commercial_value ?? "",
        }),
      ),
    [draft?.lines, draft?.mode, fx, packTotals, draft?.commercial_value],
  );
  const totals = useMemo(
    () => chargeTotals(resolvedLines, fx),
    [resolvedLines, fx],
  );
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

  function fxOfDraft(d: QuoteDraft): FxRates {
    return { usd: Number(d.fx_usd_zar) || 0, cny: Number(d.fx_cny_zar) || 0 };
  }

  async function getLiveRates() {
    setFxLoading(true);
    try {
      const r = await fetchLiveRates();
      setFx("fx_usd_zar", r.usdZar.toFixed(4));
      setFx("fx_cny_zar", r.cnyZar.toFixed(4));
      setFxAsOf(r.asOf);
      toast("Live rates applied");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not fetch live rates");
    } finally {
      setFxLoading(false);
    }
  }

  // FX rate change: recompute every line's sell.
  function setFx(key: "fx_usd_zar" | "fx_cny_zar", value: string) {
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
    setLineFields(index, { [field]: value });
  }

  function setLineFields(index: number, patch: Partial<QuoteLine>) {
    setDraft((d) => {
      if (!d) return d;
      const fxRates = fxOfDraft(d);
      const recompute =
        "buy" in patch || "margin" in patch || "cur" in patch;
      const lines = d.lines.map((l, i) => {
        if (i !== index) return l;
        const merged = { ...l, ...patch } as QuoteLine;
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
    setLineFields(
      index,
      item
        ? { code, description: item.description, cur: item.cur, unit: item.unit }
        : { code },
    );
  }

  function addLine(category: ChargeCategory) {
    setDraft((d) =>
      d ? { ...d, lines: [...d.lines, newLine(category, d.lines.length)] } : d,
    );
  }

  function removeLine(index: number) {
    setDraft((d) =>
      d ? { ...d, lines: d.lines.filter((_, i) => i !== index) } : d,
    );
  }

  async function onSave() {
    if (!draft) return;
    if (!draft.client_id) {
      error("Please select a client");
      return;
    }
    if (!draft.reference.trim()) {
      error("Reference is required");
      return;
    }
    try {
      await saveQuote.mutateAsync(draft);
      toast("Quotation saved");
      navigate(`/quotes`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save quotation");
    }
  }

  const clients = clientsQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];

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
          <div className="field">
            <label>Client/Importer</label>
            <select
              value={draft.client_id}
              onChange={(e) => set("client_id", e.target.value)}
            >
              <option value="">Select client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <span className="hint">
                No clients yet — add one on the Clients page first.
              </span>
            )}
          </div>
          <div className="field">
            <label>Supplier/Exporter</label>
            <select
              value={draft.supplier_id}
              onChange={(e) => set("supplier_id", e.target.value)}
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Reference</label>
            <input
              value={draft.reference}
              onChange={(e) => set("reference", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Valid Until</label>
            <input
              type="date"
              value={draft.valid_until}
              onChange={(e) => set("valid_until", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Commercial Value ($)</label>
            <input
              type="number"
              step="any"
              value={draft.commercial_value}
              onChange={(e) => set("commercial_value", e.target.value)}
            />
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
            <label>Insurance Amount ($)</label>
            <input
              type="number"
              readOnly
              tabIndex={-1}
              value={insuranceAmount(draft.commercial_value).toFixed(2)}
              title="0.50% of Commercial Value"
            />
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
            <label>Mode</label>
            <select
              value={draft.mode}
              onChange={(e) => set("mode", e.target.value as QuoteDraft["mode"])}
            >
              {QUOTE_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Delivery terms</label>
            <input
              value={draft.delivery_terms}
              onChange={(e) => set("delivery_terms", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Origin/Port of Load</label>
            <input
              value={draft.origin}
              onChange={(e) => set("origin", e.target.value)}
              placeholder="CNSNZ — Shenzhen, China"
            />
            <span className="hint">Start with the UN/LOCODE (e.g. CNSNZ).</span>
          </div>
          <div className="field">
            <label>Destination/Port of Discharge</label>
            <input
              value={draft.destination}
              onChange={(e) => set("destination", e.target.value)}
              placeholder="ZAJNB — Johannesburg, South Africa"
            />
            <span className="hint">Start with the UN/LOCODE (e.g. ZAJNB).</span>
          </div>
          <div className="field">
            <label>Vessel Name</label>
            <input
              value={draft.vessel_name}
              onChange={(e) => set("vessel_name", e.target.value)}
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
          <div className="field">
            <label>Container Number</label>
            <input
              value={draft.container_no}
              onChange={(e) => set("container_no", e.target.value)}
            />
          </div>
          <div className="field">
            <label>ETD</label>
            <input
              type="date"
              value={draft.etd}
              onChange={(e) => set("etd", e.target.value)}
            />
          </div>
          <div className="field">
            <label>ETA</label>
            <input
              type="date"
              value={draft.eta}
              onChange={(e) => set("eta", e.target.value)}
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
          <div className="field">
            <label>Flight No</label>
            <input
              value={draft.flight_no}
              onChange={(e) => set("flight_no", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Flight Date</label>
            <input
              type="date"
              value={draft.flight_date}
              onChange={(e) => set("flight_date", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Carrier/Airline Name</label>
            <input
              value={draft.carrier_name}
              onChange={(e) => set("carrier_name", e.target.value)}
            />
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
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Packing List Information</h2>
            <p>
              Dimensions in cm. Volume (KGS) = CBM × {VOLUMETRIC_FACTOR}.
              Chargeable weight = greater of total actual and total volume weight.
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
                  const r = packingRow(p);
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
                          readOnly
                          tabIndex={-1}
                          value={r.cbm.toFixed(2)}
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
            <div className="label">Total Actual Weight (KGS)</div>
            <div className="val">{packTotals.totalActual.toFixed(2)}</div>
          </div>
          <div className="t">
            <div className="label">Volume Weight (KGS)</div>
            <div className="val">{packTotals.totalVolume.toFixed(2)}</div>
          </div>
          <div className="t">
            <div className="label">Chargeable Volume (CBM)</div>
            <div className="val" style={{ color: "var(--green-dark)" }}>
              {packTotals.totalCbm.toFixed(2)}
            </div>
          </div>
          <div className="t">
            <div className="label">Chargeable Weight (KGS)</div>
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
            <p>Buy cost stays internal — sell price is what your client sees</p>
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
            {fxAsOf && ` Live rates as at ${fxAsOf}.`}
          </span>
        </div>

        {groups.map((g) => (
          <div className="charge-group" key={g.category}>
            <div className="charge-group-head">
              <h3>{g.category.toUpperCase()}</h3>
              <button
                className="btn small outline"
                onClick={() => addLine(g.category)}
              >
                + Add line
              </button>
            </div>

            {g.lines.length === 0 ? (
              <p className="hint" style={{ padding: "4px 0 10px" }}>
                No charges in this section.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="charge-table">
                  <thead>
                    <tr>
                      <th className="c-code">Code</th>
                      <th>Description</th>
                      <th className="c-cur">Cur</th>
                      <th className="c-unit">Unit</th>
                      <th className="num">Qty</th>
                      <th className="num">Buy ($)</th>
                      <th className="num">Margin (%)</th>
                      <th className="num">Sell ($)</th>
                      <th className="num">Sell (R)</th>
                      <th className="num">Line total (R)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map(({ line: l, index: i }) => (
                      <tr key={i}>
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
                            readOnly={Boolean(
                              catalogItem(String(l.code ?? ""), draft.mode),
                            )}
                            title={
                              catalogItem(String(l.code ?? ""), draft.mode)
                                ? "Set by the selected code"
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
                          {autoQty(l, draft.mode, packTotals) != null ||
                          l.code === INSURANCE_CODE ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value={(Number(l.qty) || 0).toFixed(2)}
                              title={
                                l.code === INSURANCE_CODE
                                  ? "Insurance line — quantity is 1"
                                  : "Quantity set from the Packing List for this unit"
                              }
                            />
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={String(draft.lines[i]?.qty ?? "")}
                              onChange={(e) => setLine(i, "qty", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="num">
                          {l.code === INSURANCE_CODE ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value={(Number(l.buy) || 0).toFixed(2)}
                              title="0.50% of Commercial Value ($)"
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
                          {l.code === INSURANCE_CODE ? (
                            <input
                              type="number"
                              readOnly
                              tabIndex={-1}
                              value="0"
                              title="No markup on insurance"
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
                          <input
                            type="number"
                            readOnly
                            value={sellInCur(l.buy, l.margin).toFixed(2)}
                            title={`Buy + margin, in ${l.cur} (before ZAR conversion)`}
                            tabIndex={-1}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            readOnly
                            value={(Number(l.sell) || 0).toFixed(2)}
                            title="Sell ($) converted at the currency rate"
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {g.lines.length > 0 && (
              <div className="charge-group-subtotal">
                Section subtotal:&nbsp;<strong>{money(g.subtotal)}</strong>
              </div>
            )}
          </div>
        ))}

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
            <div className="label">Client total</div>
            <div className="val" style={{ color: "var(--green-dark)" }}>
              {money(totals.sell)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
