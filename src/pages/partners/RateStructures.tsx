import { Fragment, useState } from "react";
import DateInput from "../../components/DateInput";
import Modal from "../../components/Modal";
import { ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeletePartnerRateStructure,
  usePartnerRateStructures,
  useSavePartnerRateStructure,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type {
  PartnerKind,
  PartnerRateStructure,
  PartnerRateStructureDraft,
  RateBlock,
} from "../../lib/types";
import { PARTNER_MODES } from "./PartnerCoverage";

const CURRENCIES = ["USD", "ZAR", "CNY", "EUR", "GBP"];

const uid = () => Math.random().toString(36).slice(2, 10);

/** Per-mode layout of a rate structure: what the freight rate is charged
 *  per, the default rate breaks, the usual origin charges, the
 *  collection/haulage tiers, and the wording of the block columns. One
 *  sheet design for every mode -- only these labels and defaults change. */
interface ModeTemplate {
  qty: string;
  /** Shorter wording for the editor's narrow break column. */
  qtyShort: string;
  per: string;
  breaks: string[];
  charges: { description: string; basis: string }[];
  chargesTitle: string;
  pickupTitle: string;
  pickupTier: string;
  pickup: string[];
  carrier: string;
  carrierPh: string;
  departFrom: string;
  departPh: string;
  routingPh: string;
  terms: string;
  commodityPh: string;
}

const AIR: ModeTemplate = {
  qty: "Chargeable Weight",
  qtyShort: "Weight",
  per: "KG",
  breaks: ["0-45KG", "0-100KG", "0-300KG", "0-500KG", "0-1000KG"],
  charges: [
    { description: "Export Clearance Fee Per Shipment", basis: "Per AWB" },
    { description: "Documentation Fee Per Shipment", basis: "Per AWB" },
    { description: "THC Fee", basis: "Per KG, min per AWB" },
    { description: "Airline Handling Fee Per Shipment", basis: "Per AWB" },
    { description: "Export Company (if applicable)", basis: "Per AWB" },
  ],
  chargesTitle: "Origin / Export Charges",
  pickupTitle: "Pick Up Fees",
  pickupTier: "Weight tier",
  pickup: ["1-299kg", "300-499kg", "500-1000kg"],
  carrier: "Airline",
  carrierPh: "e.g. EY, SQ, TK",
  departFrom: "Depart From",
  departPh: "e.g. HKG",
  routingPh: "e.g. HKG-AUH-JNB",
  terms: "EXW",
  commodityPh: "e.g. General Cargo Export and Fly Via Hong Kong (HKG)",
};

const MODE_TEMPLATES: Record<string, ModeTemplate> = {
  "Air Freight (AIR)": AIR,
  "Courier Express (CX)": {
    qty: "Weight Band",
    qtyShort: "Weight",
    per: "KG",
    breaks: ["0.5-5KG", "5-10KG", "10-21KG", "21-45KG", "45-100KG", "100KG+"],
    charges: [
      { description: "Fuel Surcharge", basis: "% of freight" },
      { description: "Export Clearance Fee", basis: "Per Shipment" },
      { description: "Documentation Fee", basis: "Per Shipment" },
      { description: "Remote Area Surcharge (if applicable)", basis: "Per Shipment" },
      { description: "Oversize / Non-stackable (if applicable)", basis: "Per Piece" },
    ],
    chargesTitle: "Surcharges & Fees",
    pickupTitle: "Collection Fees",
    pickupTier: "Weight tier",
    pickup: ["0-30kg", "30-70kg", "70kg+"],
    carrier: "Courier Service",
    carrierPh: "e.g. DHL Express, FedEx IP",
    departFrom: "Collection From",
    departPh: "e.g. Shenzhen",
    routingPh: "e.g. SZX-HKG-JNB",
    terms: "DAP",
    commodityPh: "e.g. Documents & Small Parcels Door to Door",
  },
  "Sea Freight (FCL)": {
    qty: "Container",
    qtyShort: "Container",
    per: "Container",
    breaks: ["20' GP", "40' GP", "40' HC", "40' RF"],
    charges: [
      { description: "Origin THC", basis: "Per Container" },
      { description: "Bill of Lading Fee", basis: "Per B/L" },
      { description: "Seal Fee", basis: "Per Container" },
      { description: "VGM Fee", basis: "Per Container" },
      { description: "Export Customs Clearance", basis: "Per Shipment" },
      { description: "Documentation Fee", basis: "Per Shipment" },
    ],
    chargesTitle: "Origin Charges",
    pickupTitle: "Inland Haulage",
    pickupTier: "Haulage",
    pickup: ["20' within 50km", "40' within 50km", "20' 50-150km", "40' 50-150km"],
    carrier: "Shipping Line",
    carrierPh: "e.g. MSC, Maersk, COSCO",
    departFrom: "Port of Loading",
    departPh: "e.g. CNSHA",
    routingPh: "e.g. Shanghai - Singapore - Durban",
    terms: "FOB",
    commodityPh: "e.g. General Cargo FCL Ex Shanghai to Durban",
  },
  "Sea Freight (LCL)": {
    qty: "Volume / Weight",
    qtyShort: "W/M",
    per: "W/M",
    breaks: ["Min 1 W/M", "1-5 W/M", "5-10 W/M", "10-15 W/M"],
    charges: [
      { description: "CFS Charges", basis: "Per W/M" },
      { description: "Origin THC", basis: "Per W/M" },
      { description: "Bill of Lading Fee", basis: "Per B/L" },
      { description: "Export Customs Clearance", basis: "Per Shipment" },
      { description: "Documentation Fee", basis: "Per Shipment" },
    ],
    chargesTitle: "Origin Charges",
    pickupTitle: "Pick Up Fees",
    pickupTier: "Volume tier",
    pickup: ["1-3 CBM", "3-6 CBM", "6-10 CBM"],
    carrier: "Consolidator / Line",
    carrierPh: "e.g. CFS operator or line",
    departFrom: "Port of Loading",
    departPh: "e.g. CNNGB",
    routingPh: "e.g. Ningbo - Durban direct",
    terms: "EXW",
    commodityPh: "e.g. General Cargo LCL Ex Ningbo (1 CBM = 1000 KG)",
  },
  "Road Freight (RDX)": {
    qty: "Vehicle / Load",
    qtyShort: "Vehicle",
    per: "Load",
    breaks: ["1 Ton", "4 Ton", "8 Ton", "14 Ton", "Superlink 34 Ton"],
    charges: [
      { description: "Border Clearance Fee", basis: "Per Border" },
      { description: "Waiting Time", basis: "Per Hour after free time" },
      { description: "Tolls", basis: "Per Load" },
      { description: "Fuel Surcharge", basis: "% of freight" },
      { description: "Tail-lift / Offloading (if applicable)", basis: "Per Load" },
    ],
    chargesTitle: "Additional Charges",
    pickupTitle: "Additional Stops",
    pickupTier: "Stop",
    pickup: ["Extra pick-up", "Extra drop-off"],
    carrier: "Transporter",
    carrierPh: "e.g. transporter name",
    departFrom: "Collection Point",
    departPh: "e.g. Johannesburg",
    routingPh: "e.g. JHB - Beitbridge - Harare",
    terms: "DAP",
    commodityPh: "e.g. General Cargo Full Load JHB to Harare",
  },
};

function templateFor(mode: string | null): ModeTemplate {
  return (mode && MODE_TEMPLATES[mode]) || AIR;
}

/** A fresh block laid out for the mode (breaks, usual charges, pick-up
 *  tiers) -- rates left blank. */
function newBlock(mode: string | null): RateBlock {
  const t = templateFor(mode);
  return {
    id: uid(),
    commodity: "",
    carrier: "",
    depart_from: "",
    routing: "",
    transit: "",
    terms: t.terms,
    notes: "",
    breaks: t.breaks.map((label) => ({ label, rate: null })),
    charges: t.charges.map((c) => ({ ...c, amount: null })),
    pickup: t.pickup.map((label) => ({ label, amount: null })),
  };
}

/** True while no block has any text or amount typed in beyond the template,
 *  so switching the mode can safely re-lay the blocks for the new mode. */
function blocksUntouched(blocks: RateBlock[]): boolean {
  return blocks.every(
    (b) =>
      !b.commodity &&
      !b.carrier &&
      !b.depart_from &&
      !b.routing &&
      !b.transit &&
      !b.notes &&
      b.breaks.every((x) => x.rate == null) &&
      b.charges.every((x) => x.amount == null) &&
      b.pickup.every((x) => x.amount == null),
  );
}

/** The rate types an agent's window is tabbed by. */
export const RATE_TABS: { mode: string; label: string }[] = [
  { mode: "Air Freight (AIR)", label: "Air Freight Rates" },
  { mode: "Sea Freight (FCL)", label: "FCL Rates" },
  { mode: "Sea Freight (LCL)", label: "LCL Rates" },
  { mode: "Courier Express (CX)", label: "Courier Rates" },
  { mode: "Road Freight (RDX)", label: "Road Freight Rates" },
];

export function emptyStructure(
  kind: PartnerKind,
  partnerId: string,
  mode: string,
): PartnerRateStructureDraft {
  return {
    partner_kind: kind,
    partner_id: partnerId,
    title: "",
    mode,
    origin: "",
    destination: "",
    currency: "USD",
    valid_from: null,
    valid_until: null,
    notes: "",
    blocks: [newBlock(mode)],
  };
}

const num = (v: number | null | undefined, cur: string) =>
  v == null
    ? "—"
    : `${cur} ${Number(v).toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      })}`;

/* ------------------------------------------------------------------ */
/* List + read-only sheet view, shown in the partner's view window.    */
/* ------------------------------------------------------------------ */

export default function RateStructures({
  kind,
  partnerId,
  partnerName,
}: {
  kind: PartnerKind;
  partnerId: string;
  partnerName: string;
}) {
  const q = usePartnerRateStructures(kind, partnerId);
  const save = useSavePartnerRateStructure();
  const del = useDeletePartnerRateStructure();
  const { toast, error } = useToast();
  const [tab, setTab] = useState(RATE_TABS[0].mode);
  const all = q.data ?? [];
  const known = new Set(RATE_TABS.map((t) => t.mode));
  // Structures saved under another mode (e.g. Customs Clearing) or none
  // show on an "Other" tab so nothing is hidden.
  const others = all.filter((x) => !x.mode || !known.has(x.mode));
  const shown = tab === "other" ? others : all.filter((x) => x.mode === tab);
  const tabLabel =
    tab === "other" ? "Other" : RATE_TABS.find((t) => t.mode === tab)?.label ?? "";
  const [editing, setEditing] = useState<
    { id?: string; draft: PartnerRateStructureDraft } | null
  >(null);

  async function onDuplicate(s: PartnerRateStructure) {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = s;
    void _id;
    void _c;
    void _u;
    setEditing({
      draft: {
        ...rest,
        title: `${s.title} (Copy)`,
        blocks: s.blocks.map((b) => ({ ...b, id: uid() })),
      },
    });
  }

  async function onDelete(s: PartnerRateStructure) {
    if (!window.confirm(`Delete the rate structure "${s.title}"?`)) return;
    try {
      await del.mutateAsync(s.id);
      toast("Rate structure deleted");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <section className="rs-wrap">
      <div className="rs-head">
        <h3>Rate Structures</h3>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setEditing({
              draft: emptyStructure(kind, partnerId, tab === "other" ? RATE_TABS[0].mode : tab),
            })
          }
        >
          + Add {tab === "other" ? "rate structure" : tabLabel.replace(/ Rates$/, " rates")}
        </button>
      </div>
      <div className="rs-tabs" role="tablist">
        {RATE_TABS.map((t) => {
          const n = all.filter((x) => x.mode === t.mode).length;
          return (
            <button
              key={t.mode}
              type="button"
              role="tab"
              aria-selected={tab === t.mode}
              className={`rs-tab${tab === t.mode ? " on" : ""}`}
              onClick={() => setTab(t.mode)}
            >
              {t.label}
              {n > 0 && <span className="rs-tab-n">{n}</span>}
            </button>
          );
        })}
        {others.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "other"}
            className={`rs-tab${tab === "other" ? " on" : ""}`}
            onClick={() => setTab("other")}
          >
            Other <span className="rs-tab-n">{others.length}</span>
          </button>
        )}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorNote error={q.error} />
      ) : shown.length === 0 ? (
        <p className="muted">
          No {tabLabel.toLowerCase()} for {partnerName} yet. Add one per trade
          lane (e.g. China → JNB).
        </p>
      ) : (
        shown.map((s) => (
          <RateStructureSheet
            key={s.id}
            s={s}
            onEdit={() => {
              const { id, created_at: _c, updated_at: _u, ...draft } = s;
              void _c;
              void _u;
              setEditing({ id, draft });
            }}
            onDuplicate={() => onDuplicate(s)}
            onDelete={() => onDelete(s)}
          />
        ))
      )}

      {editing && (
        <RateStructureEditor
          initial={editing.draft}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            try {
              await save.mutateAsync({ id: editing.id, values: draft });
              toast("Rate structure saved");
              setEditing(null);
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not save");
            }
          }}
        />
      )}
    </section>
  );
}

export function RateStructureSheet({
  s,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  s: PartnerRateStructure;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const basis = templateFor(s.mode);
  const expired = s.valid_until && s.valid_until < new Date().toISOString().slice(0, 10);
  return (
    <div className="rs-card">
      <div className="rs-card-head">
        <div>
          <h4>{s.title}</h4>
          <div className="rs-meta">
            {s.mode && <span className="cov-chip static">{s.mode}</span>}
            {(s.origin || s.destination) && (
              <span>
                {s.origin || "—"} → {s.destination || "—"}
              </span>
            )}
            <span>Rates in {s.currency}</span>
            {(s.valid_from || s.valid_until) && (
              <span className={expired ? "rs-expired" : undefined}>
                Valid {s.valid_from ? formatDate(s.valid_from) : "—"} to{" "}
                {s.valid_until ? formatDate(s.valid_until) : "further notice"}
                {expired ? " · expired" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="rs-actions">
          <button type="button" className="btn outline btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn outline btn-sm" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn ghost btn-sm" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="rs-table">
          <colgroup>
            <col style={{ width: "19%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "3%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Commodity</th>
              <th>{basis.qty}</th>
              <th className="num">Freight [{s.currency}/{basis.per}]</th>
              <th>{basis.chargesTitle}</th>
              <th className="num">Rate [{s.currency}]</th>
              <th>{basis.pickupTitle}</th>
              <th>{basis.carrier}</th>
              <th>{basis.departFrom}</th>
              <th>Routing</th>
              <th>Transit</th>
              <th>Terms</th>
            </tr>
          </thead>
          <tbody>
            {s.blocks.map((b) => {
              const n = Math.max(b.breaks.length, b.charges.length, 1);
              return (
                <Fragment key={b.id}>
                  {Array.from({ length: n }, (_, i) => {
                    const br = b.breaks[i];
                    const ch = b.charges[i];
                    return (
                      <tr key={i} className={i === 0 ? "rs-block-start" : undefined}>
                        {i === 0 && (
                          <td rowSpan={n} className="rs-commodity">
                            <strong>{b.commodity || "—"}</strong>
                            {b.notes && <div className="hint">{b.notes}</div>}
                          </td>
                        )}
                        <td>{br?.label ?? ""}</td>
                        <td className="num">{br ? num(br.rate, s.currency) : ""}</td>
                        <td>
                          {ch?.description ?? ""}
                          {ch?.basis && <span className="hint"> · {ch.basis}</span>}
                        </td>
                        <td className="num">{ch ? num(ch.amount, s.currency) : ""}</td>
                        {i === 0 && (
                          <>
                            <td rowSpan={n}>
                              {b.pickup.length
                                ? b.pickup.map((p, j) => (
                                    <div key={j}>
                                      {p.label}: {num(p.amount, s.currency)}
                                    </div>
                                  ))
                                : "—"}
                            </td>
                            <td rowSpan={n}>{b.carrier || "—"}</td>
                            <td rowSpan={n}>{b.depart_from || "—"}</td>
                            <td rowSpan={n}>{b.routing || "—"}</td>
                            <td rowSpan={n}>{b.transit || "—"}</td>
                            <td rowSpan={n}>{b.terms || "—"}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {s.notes && <p className="rs-notes">{s.notes}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function RateStructureEditor({
  initial,
  saving,
  onClose,
  onSave,
}: {
  initial: PartnerRateStructureDraft;
  saving: boolean;
  onClose: () => void;
  onSave: (d: PartnerRateStructureDraft) => void;
}) {
  const [d, setD] = useState<PartnerRateStructureDraft>(initial);
  const { error } = useToast();
  const basis = templateFor(d.mode);
  const set = <K extends keyof PartnerRateStructureDraft>(
    k: K,
    v: PartnerRateStructureDraft[K],
  ) => setD((p) => ({ ...p, [k]: v }));
  const setBlock = (i: number, patch: Partial<RateBlock>) =>
    setD((p) => ({
      ...p,
      blocks: p.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));
  const moveBlock = (i: number, dir: -1 | 1) =>
    setD((p) => {
      const blocks = [...p.blocks];
      const j = i + dir;
      if (j < 0 || j >= blocks.length) return p;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...p, blocks };
    });

  function submit() {
    if (!d.title.trim()) {
      error("Give the rate structure a title");
      return;
    }
    onSave({
      ...d,
      title: d.title.trim(),
      origin: d.origin?.trim() || null,
      destination: d.destination?.trim() || null,
      notes: d.notes?.trim() || null,
    });
  }

  const numIn = (v: number | null, on: (n: number | null) => void) => (
    <input
      type="number"
      step="0.001"
      min="0"
      className="rs-num"
      value={v ?? ""}
      onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))}
    />
  );

  return (
    <Modal
      title={initial.title ? `Edit rate structure` : "New rate structure"}
      onClose={onClose}
      wide
      stickyHeader
      headerActions={
        <button type="button" className="btn" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="rs-form-grid">
        <div className="field rs-span2">
          <label>Title</label>
          <input
            value={d.title}
            autoFocus
            placeholder="e.g. China & Hong Kong → JNB"
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Mode</label>
          <select
            value={d.mode ?? ""}
            onChange={(e) => {
              const mode = e.target.value || null;
              // Nothing typed into the blocks yet: re-lay them for the new
              // mode (its breaks, charges and tiers). Otherwise keep them.
              setD((p) =>
                blocksUntouched(p.blocks)
                  ? { ...p, mode, blocks: p.blocks.map(() => newBlock(mode)) }
                  : { ...p, mode },
              );
            }}
          >
            <option value="">—</option>
            {PARTNER_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={d.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Origin</label>
          <input
            value={d.origin ?? ""}
            placeholder="e.g. China (SZX, CAN, PVG, PEK) / Hong Kong"
            onChange={(e) => set("origin", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Destination</label>
          <input
            value={d.destination ?? ""}
            placeholder="e.g. JNB / DUR / CPT"
            onChange={(e) => set("destination", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Valid from</label>
          <DateInput value={d.valid_from ?? ""} onChange={(v) => set("valid_from", v || null)} />
        </div>
        <div className="field">
          <label>Valid until</label>
          <DateInput value={d.valid_until ?? ""} onChange={(v) => set("valid_until", v || null)} />
        </div>
      </div>

      {d.blocks.map((b, i) => (
        <div key={b.id} className="rs-block">
          <div className="rs-block-head">
            <strong>Block {i + 1}</strong>
            <div className="rs-actions">
              <button type="button" className="btn ghost btn-sm" onClick={() => moveBlock(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => moveBlock(i, 1)}
                disabled={i === d.blocks.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn outline btn-sm"
                onClick={() =>
                  setD((p) => ({
                    ...p,
                    blocks: [
                      ...p.blocks.slice(0, i + 1),
                      { ...structuredClone(b), id: uid(), commodity: `${b.commodity} (Copy)` },
                      ...p.blocks.slice(i + 1),
                    ],
                  }))
                }
              >
                Duplicate block
              </button>
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() =>
                  window.confirm("Remove this block?") &&
                  setD((p) => ({ ...p, blocks: p.blocks.filter((_, j) => j !== i) }))
                }
              >
                Remove
              </button>
            </div>
          </div>

          <div className="rs-form-grid">
            <div className="field rs-span2">
              <label>Commodity / service</label>
              <input
                value={b.commodity}
                placeholder={basis.commodityPh}
                onChange={(e) => setBlock(i, { commodity: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{basis.carrier}</label>
              <input value={b.carrier} placeholder={basis.carrierPh} onChange={(e) => setBlock(i, { carrier: e.target.value })} />
            </div>
            <div className="field">
              <label>{basis.departFrom}</label>
              <input value={b.depart_from} placeholder={basis.departPh} onChange={(e) => setBlock(i, { depart_from: e.target.value })} />
            </div>
            <div className="field">
              <label>Routing</label>
              <input value={b.routing} placeholder={basis.routingPh} onChange={(e) => setBlock(i, { routing: e.target.value })} />
            </div>
            <div className="field">
              <label>Transit time</label>
              <input value={b.transit} placeholder="e.g. 5-7 days from pickup" onChange={(e) => setBlock(i, { transit: e.target.value })} />
            </div>
            <div className="field">
              <label>Terms</label>
              <input value={b.terms} placeholder="e.g. EXW" onChange={(e) => setBlock(i, { terms: e.target.value })} />
            </div>
            <div className="field">
              <label>Block notes</label>
              <input value={b.notes} placeholder="e.g. MSDS / UN38.3 required" onChange={(e) => setBlock(i, { notes: e.target.value })} />
            </div>
          </div>

          <div className="rs-subgrid">
            <div>
              <div className="rs-subhead">
                Freight rates [{d.currency}/{basis.per}]
              </div>
              <table className="rs-edit">
                <colgroup>
                  <col className="rs-c-fixed" />
                  <col className="rs-c-fixed" />
                  <col className="rs-c-x" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{basis.qtyShort}</th>
                    <th>Rate</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.breaks.map((br, j) => (
                    <tr key={j}>
                      <td>
                        <input
                          value={br.label}
                          placeholder="e.g. 0-45KG"
                          onChange={(e) =>
                            setBlock(i, {
                              breaks: b.breaks.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)),
                            })
                          }
                        />
                      </td>
                      <td>
                        {numIn(br.rate, (rate) =>
                          setBlock(i, { breaks: b.breaks.map((x, k) => (k === j ? { ...x, rate } : x)) }),
                        )}
                      </td>
                      <td>
                        <RemoveBtn onClick={() => setBlock(i, { breaks: b.breaks.filter((_, k) => k !== j) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <AddRowBtn onClick={() => setBlock(i, { breaks: [...b.breaks, { label: "", rate: null }] })} />
            </div>

            <div>
              <div className="rs-subhead">
                {basis.chargesTitle} [{d.currency}]
              </div>
              <table className="rs-edit">
                <colgroup>
                  <col />
                  <col className="rs-c-fixed" />
                  <col />
                  <col className="rs-c-x" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Rate</th>
                    <th>Basis</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.charges.map((ch, j) => (
                    <tr key={j}>
                      <td>
                        <input
                          value={ch.description}
                          onChange={(e) =>
                            setBlock(i, {
                              charges: b.charges.map((x, k) =>
                                k === j ? { ...x, description: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        {numIn(ch.amount, (amount) =>
                          setBlock(i, { charges: b.charges.map((x, k) => (k === j ? { ...x, amount } : x)) }),
                        )}
                      </td>
                      <td>
                        <input
                          value={ch.basis}
                          placeholder="Per AWB"
                          onChange={(e) =>
                            setBlock(i, {
                              charges: b.charges.map((x, k) => (k === j ? { ...x, basis: e.target.value } : x)),
                            })
                          }
                        />
                      </td>
                      <td>
                        <RemoveBtn onClick={() => setBlock(i, { charges: b.charges.filter((_, k) => k !== j) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <AddRowBtn
                onClick={() => setBlock(i, { charges: [...b.charges, { description: "", amount: null, basis: "" }] })}
              />
            </div>

            <div>
              <div className="rs-subhead">{basis.pickupTitle} [{d.currency}]</div>
              <table className="rs-edit">
                <colgroup>
                  <col className="rs-c-fixed" />
                  <col className="rs-c-fixed" />
                  <col className="rs-c-x" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{basis.pickupTier}</th>
                    <th>Rate</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.pickup.map((p, j) => (
                    <tr key={j}>
                      <td>
                        <input
                          value={p.label}
                          placeholder="e.g. 1-299kg"
                          onChange={(e) =>
                            setBlock(i, {
                              pickup: b.pickup.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)),
                            })
                          }
                        />
                      </td>
                      <td>
                        {numIn(p.amount, (amount) =>
                          setBlock(i, { pickup: b.pickup.map((x, k) => (k === j ? { ...x, amount } : x)) }),
                        )}
                      </td>
                      <td>
                        <RemoveBtn onClick={() => setBlock(i, { pickup: b.pickup.filter((_, k) => k !== j) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <AddRowBtn onClick={() => setBlock(i, { pickup: [...b.pickup, { label: "", amount: null }] })} />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn outline"
        onClick={() =>
          setD((p) => {
            // Start from the last block's charges / pick-up tiers / break
            // labels (they're usually the same across blocks), rates blank.
            const last = p.blocks[p.blocks.length - 1];
            const fresh = last
              ? {
                  ...structuredClone(last),
                  id: uid(),
                  commodity: "",
                  carrier: "",
                  depart_from: "",
                  routing: "",
                  transit: "",
                  notes: "",
                  breaks: last.breaks.map((x) => ({ ...x, rate: null })),
                }
              : newBlock(p.mode);
            return { ...p, blocks: [...p.blocks, fresh] };
          })
        }
      >
        + Add block
      </button>

      <div className="field" style={{ marginTop: 16 }}>
        <label>Notes / terms</label>
        <textarea
          rows={3}
          value={d.notes ?? ""}
          placeholder="Validity notes, exchange-rate conditions, surcharges…"
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function AddRowBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn ghost btn-sm rs-addrow" onClick={onClick}>
      + Add row
    </button>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn ghost btn-sm" onClick={onClick} aria-label="Remove row">
      ✕
    </button>
  );
}
