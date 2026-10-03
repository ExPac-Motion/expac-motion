import { useState } from "react";
import {
  LINE_CURRENCIES,
  type ChargeCategory,
  type LineCurrency,
  type PartnerKind,
  type PartnerRateStructure,
  type QuoteLine,
  type QuoteMode,
  type RateBlock,
} from "../../lib/types";

/** A partner picked on the quote, with its saved rate structures. */
export interface QuotePartnerRates {
  kind: PartnerKind;
  /** "Agent", "Transporter", "Clearing Agent" */
  role: string;
  company: string;
  structures: PartnerRateStructure[];
}

export type PickedLine = Pick<
  QuoteLine,
  "category" | "code" | "description" | "cur" | "unit" | "qty" | "buy" | "margin"
>;

const MARGIN_KEY = "partnerRateMargin";

function loadMargin(): number {
  try {
    const v = Number(localStorage.getItem(MARGIN_KEY));
    return Number.isFinite(v) && v > 0 ? v : 15;
  } catch {
    return 15;
  }
}

/** "0-45KG" -> [0, 45]; "+45KG" / "45+" / ">45" / "Min 100 KGS" -> [45|100, ∞]. */
export function breakRange(label: string): [number, number] | null {
  const nums = (label.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) =>
    Number(n.replace(",", ".")),
  );
  if (nums.length === 0) return null;
  if (nums.length >= 2) return [nums[0], nums[1]];
  return [nums[0], Infinity];
}

/** Index of the break / tier that applies to `kg` (closed ranges first,
 *  then the highest open-ended "+N" whose floor it clears). */
export function matchingIndex(labels: string[], kg: number): number {
  if (!(kg > 0)) return -1;
  let best = -1;
  let bestLo = -Infinity;
  labels.forEach((l, i) => {
    const r = breakRange(l);
    if (!r) return;
    const [lo, hi] = r;
    if (hi !== Infinity) {
      if (kg >= lo && kg <= hi && lo >= bestLo) {
        best = i;
        bestLo = lo;
      }
    } else if (kg >= lo && lo >= bestLo) {
      best = i;
      bestLo = lo;
    }
  });
  return best;
}

/** Free-text charge basis ("Per AWB", "0.13 USD/KG, min…") -> a quote unit. */
function unitFromBasis(basis: string): string {
  const b = basis.toUpperCase();
  if (/\bKG/.test(b)) return "KGS";
  if (/\bCBM\b|W\/M/.test(b)) return "CBM";
  if (/HAWB/.test(b)) return "HAWB";
  if (/MAWB/.test(b)) return "MAWB";
  if (/AWB/.test(b)) return "AWB";
  if (/B\/L|\bBL\b|HBL/.test(b)) return "B/L";
  if (/CONTAINER|CTNR|\bCNTR/.test(b)) return "P/CTNR";
  return "";
}

const asCur = (c: string): LineCurrency =>
  (LINE_CURRENCIES as string[]).includes(c) ? (c as LineCurrency) : "USD";

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");

/**
 * Partner rate structures (Agents / Transporters / Clearing Agents, migration
 * 0114) offered inside the Quote Builder's "From Rate Sheet" picker. Rows are
 * one-click: a weight break becomes a per-KG freight line (qty follows the
 * packing list's chargeable weight), a charge or pick-up tier becomes a flat
 * line. The break / tier that fits the current chargeable weight is marked.
 */
export default function PartnerRatePicker({
  category,
  mode,
  chargeableKg,
  partners,
  onAdd,
}: {
  category: ChargeCategory;
  mode: QuoteMode;
  chargeableKg: number;
  partners: QuotePartnerRates[];
  onAdd: (lines: PickedLine[]) => void;
}) {
  const [margin, setMargin] = useState(loadMargin);
  const [showAllModes, setShowAllModes] = useState(false);

  function changeMargin(v: number) {
    setMargin(v);
    try {
      localStorage.setItem(MARGIN_KEY, String(v));
    } catch {
      /* per-viewer convenience only */
    }
  }

  const withRates = partners.filter((p) => p.structures.length > 0);
  if (partners.length === 0) {
    return (
      <p className="muted">
        Pick an Agent, Transporter or Clearing Agent on this quote to use their
        rate structures here.
      </p>
    );
  }
  if (withRates.length === 0) {
    return (
      <p className="muted">
        {partners.map((p) => p.company).join(", ")}{" "}
        {partners.length === 1 ? "has" : "have"} no rate structures saved yet —
        add them on the partner's record.
      </p>
    );
  }

  const freightLine = (
    s: PartnerRateStructure,
    b: RateBlock,
    label: string,
    rate: number,
  ): PickedLine => ({
    category,
    code: isAir(mode) && category === "International Freight Charges" ? "AF-01" : "",
    description: [
      `${b.commodity || s.title} freight ${label}`.trim(),
      b.carrier ? `(${b.carrier})` : "",
    ]
      .filter(Boolean)
      .join(" "),
    cur: asCur(s.currency),
    unit: "KGS",
    qty: 1,
    buy: rate,
    margin,
  });
  const flatLine = (
    s: PartnerRateStructure,
    description: string,
    amount: number,
    unit: string,
  ): PickedLine => ({
    category,
    code: "",
    description,
    cur: asCur(s.currency),
    unit,
    qty: 1,
    buy: amount,
    margin,
  });

  return (
    <div className="prp">
      <div className="prp-bar">
        <label className="prp-margin">
          Margin on added lines
          <input
            type="number"
            min={0}
            step={1}
            value={margin}
            onChange={(e) => changeMargin(Number(e.target.value) || 0)}
          />
          %
        </label>
        <span className="muted small">
          Chargeable weight: <strong>{chargeableKg ? `${chargeableKg} kg` : "—"}</strong>
        </span>
        <label className="check small">
          <input
            type="checkbox"
            checked={showAllModes}
            onChange={(e) => setShowAllModes(e.target.checked)}
          />
          Show other modes
        </label>
      </div>

      {withRates.map((p) => {
        const structures = p.structures.filter(
          (s) => showAllModes || !s.mode || s.mode === mode,
        );
        return (
          <div key={`${p.kind}-${p.company}`} className="prp-partner">
            <div className="prp-partner-head">
              {p.role}: <strong>{p.company}</strong>
            </div>
            {structures.length === 0 && (
              <p className="muted small">
                No {mode} structure — tick "Show other modes" to see the rest.
              </p>
            )}
            {structures.map((s) => (
              <div key={s.id} className="prp-structure">
                <div className="prp-structure-head">
                  <strong>{s.title}</strong>
                  <span className="muted small">
                    {[s.mode, [s.origin, s.destination].filter(Boolean).join(" → "), s.currency]
                      .filter(Boolean)
                      .join(" · ")}
                    {s.valid_until ? ` · valid to ${s.valid_until.split("-").reverse().join("/")}` : ""}
                  </span>
                </div>
                {s.blocks.map((b) => {
                  const breaks = b.breaks.filter((x) => x.rate != null);
                  const charges = b.charges.filter((x) => x.amount != null);
                  const pickup = b.pickup.filter((x) => x.amount != null);
                  const bi = matchingIndex(breaks.map((x) => x.label), chargeableKg);
                  const pi = matchingIndex(pickup.map((x) => x.label), chargeableKg);
                  return (
                    <div key={b.id} className="prp-block">
                      <div className="muted small">
                        {[b.commodity, b.carrier, b.routing, b.transit && `${b.transit} transit`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {breaks.length > 0 && (
                        <div className="prp-group">
                          <span className="prp-group-label">Freight per kg</span>
                          {breaks.map((x, i) => (
                            <button
                              key={i}
                              type="button"
                              className={`chip${i === bi ? " on" : ""}`}
                              title={i === bi ? "Matches the chargeable weight" : undefined}
                              onClick={() => onAdd([freightLine(s, b, x.label, x.rate as number)])}
                            >
                              {x.label} · {s.currency} {x.rate}
                            </button>
                          ))}
                        </div>
                      )}
                      {charges.length > 0 && (
                        <div className="prp-group">
                          <span className="prp-group-label">Charges</span>
                          {charges.map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              className="chip"
                              title={c.basis}
                              onClick={() =>
                                onAdd([
                                  flatLine(s, c.description, c.amount as number, unitFromBasis(c.basis)),
                                ])
                              }
                            >
                              {c.description} · {s.currency} {c.amount}
                            </button>
                          ))}
                          {charges.length > 1 && (
                            <button
                              type="button"
                              className="btn ghost btn-sm"
                              onClick={() =>
                                onAdd(
                                  charges.map((c) =>
                                    flatLine(s, c.description, c.amount as number, unitFromBasis(c.basis)),
                                  ),
                                )
                              }
                            >
                              + Add all {charges.length}
                            </button>
                          )}
                        </div>
                      )}
                      {pickup.length > 0 && (
                        <div className="prp-group">
                          <span className="prp-group-label">Pick-up</span>
                          {pickup.map((t, i) => (
                            <button
                              key={i}
                              type="button"
                              className={`chip${i === pi ? " on" : ""}`}
                              title={i === pi ? "Matches the chargeable weight" : undefined}
                              onClick={() =>
                                onAdd([flatLine(s, `Pick-up ${t.label}`, t.amount as number, "")])
                              }
                            >
                              {t.label} · {s.currency} {t.amount}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
