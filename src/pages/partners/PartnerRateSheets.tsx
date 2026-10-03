// Partner rate sheets (migration 0119): an Agent / Transporter / Clearing
// Agent's buy rates on the Quote Builder's code worksheet, one sheet per mode
// + trade route. Tier rate sheets on Rates & Tariff link to these and follow
// them live. Any code can carry weight breaks (AF-01 0-45KG ..., OR-01
// pick-up tiers), picked by the quote's chargeable weight.
import { useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { useToast } from "../../components/Toast";
import {
  useDeletePartnerRateSheet,
  usePartnerRateSheets,
  useSavePartnerRateSheet,
} from "../../lib/hooks";
import {
  LINE_CURRENCIES,
  QUOTE_MODES,
  type LineCurrency,
  type PartnerKind,
  type PartnerRateSheet,
  type PartnerRateSheetDraft,
  type PartnerSheetLine,
} from "../../lib/types";
import {
  CATEGORY_SOURCE,
  ddmmyyyy,
  PARTNER_LABEL,
  worksheetGroups,
} from "../../lib/tariff";

const fmt = (n: number) =>
  n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

const AIR_BREAKS = ["0-45KG", "0-100KG", "0-300KG", "0-500KG", "0-1000KG"];
const TIER_BREAKS = ["1-299KG", "300-499KG", "500-1000KG"];

function emptySheet(kind: PartnerKind, partnerId: string, mode: string): PartnerRateSheetDraft {
  return {
    partner_kind: kind,
    partner_id: partnerId,
    mode,
    route: "",
    origin: null,
    destination: null,
    valid_from: null,
    valid_until: null,
    notes: null,
    lines: {},
  };
}

/** Codes that carry a rate on the sheet. */
function filledCodes(s: Pick<PartnerRateSheet, "lines">): string[] {
  return Object.entries(s.lines)
    .filter(([, l]) => l.buy != null || (l.breaks ?? []).some((b) => b.rate != null))
    .map(([code]) => code);
}

export default function PartnerRateSheets({
  kind,
  partnerId,
  partnerName,
}: {
  kind: PartnerKind;
  partnerId: string;
  partnerName: string;
}) {
  const q = usePartnerRateSheets(kind, partnerId);
  const save = useSavePartnerRateSheet();
  const del = useDeletePartnerRateSheet();
  const { toast, error } = useToast();
  const all = q.data ?? [];
  const [tab, setTab] = useState<string>(QUOTE_MODES[0]);
  const shown = all.filter((s) => s.mode === tab);
  const [editing, setEditing] = useState<{ id?: string; draft: PartnerRateSheetDraft } | null>(
    null,
  );

  async function onDelete(s: PartnerRateSheet) {
    if (
      !window.confirm(
        `Delete the ${s.mode} rate sheet "${s.route}"? Tier rate sheets linked to it lose these rates.`,
      )
    )
      return;
    try {
      await del.mutateAsync(s.id);
      toast("Rate sheet deleted");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <section className="rs-wrap">
      <div className="rs-head">
        <h3>Rate Sheets</h3>
        <button
          type="button"
          className="btn"
          onClick={() => setEditing({ draft: emptySheet(kind, partnerId, tab) })}
        >
          + Add rate sheet
        </button>
      </div>
      <div className="rs-tabs" role="tablist">
        {QUOTE_MODES.map((m) => {
          const n = all.filter((s) => s.mode === m).length;
          return (
            <button
              key={m}
              type="button"
              className={`rs-tab${tab === m ? " on" : ""}`}
              onClick={() => setTab(m)}
            >
              {m}
              {n > 0 && <span className="rs-tab-n">{n}</span>}
            </button>
          );
        })}
      </div>
      {q.isError ? (
        <p className="hint">
          Rate sheets aren't available yet — run migration 0119 in Supabase.
        </p>
      ) : shown.length === 0 ? (
        <p className="hint">
          No {tab} rate sheets for {partnerName} yet. Add one per trade route, using the same
          charge codes as the Quote Builder.
        </p>
      ) : (
        shown.map((s) => (
          <SheetCard
            key={s.id}
            s={s}
            onEdit={() => {
              const { id, created_at: _c, updated_at: _u, ...draft } = s;
              void _c;
              void _u;
              setEditing({ id, draft });
            }}
            onDuplicate={() => {
              const { id: _i, created_at: _c, updated_at: _u, ...draft } = s;
              void _i;
              void _c;
              void _u;
              setEditing({ draft: { ...draft, route: `${s.route} (Copy)` } });
            }}
            onDelete={() => onDelete(s)}
          />
        ))
      )}

      {editing && (
        <PartnerSheetEditor
          kind={kind}
          initial={editing.draft}
          isNew={!editing.id}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            try {
              await save.mutateAsync({ id: editing.id, values });
              setTab(values.mode);
              setEditing(null);
              toast("Rate sheet saved");
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not save");
            }
          }}
        />
      )}
    </section>
  );
}

function SheetCard({
  s,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  s: PartnerRateSheet;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const codes = new Set(filledCodes(s));
  const expired = !!s.valid_until && s.valid_until < new Date().toISOString().slice(0, 10);
  const groups = worksheetGroups(s.mode, { sellOnly: false })
    .map((g) => ({ ...g, items: g.items.filter((i) => codes.has(i.code)) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="rs-card">
      <div className="rs-card-head">
        <div>
          <h4>{s.route}</h4>
          <div className="rs-meta">
            {(s.origin || s.destination) && (
              <span>
                {s.origin || "Any"} → {s.destination || "Any"}
              </span>
            )}
            {s.valid_from && <span>From {ddmmyyyy(s.valid_from)}</span>}
            {s.valid_until && (
              <span className={expired ? "rs-expired" : undefined}>
                {expired ? "Expired" : "Valid until"} {ddmmyyyy(s.valid_until)}
              </span>
            )}
            <span>Updated {ddmmyyyy(s.updated_at)}</span>
          </div>
        </div>
        <div className="rs-actions">
          <button type="button" className="btn small outline" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn small outline" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn small outline" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="hint">No rates filled in yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="charge-table">
            <thead>
              <tr>
                <th className="c-code">Code</th>
                <th>Description</th>
                <th className="c-cur">Cur</th>
                <th className="c-unit">Unit</th>
                <th className="num">Buy</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((g) =>
                g.items.flatMap((item) => {
                  const l = s.lines[item.code];
                  const breaks = (l.breaks ?? []).filter((b) => b.rate != null);
                  return [
                    <tr key={item.code}>
                      <td className="c-code">{item.code}</td>
                      <td>{item.description}</td>
                      <td className="c-cur">{l.cur}</td>
                      <td className="c-unit">{item.unit || "—"}</td>
                      <td className="num">
                        {breaks.length > 0 ? (
                          <span className="hint">By weight ↓</span>
                        ) : (
                          fmt(Number(l.buy))
                        )}
                      </td>
                    </tr>,
                    ...breaks.map((b, i) => (
                      <tr key={`${item.code}-${i}`}>
                        <td />
                        <td className="hint">↳ {b.label}</td>
                        <td className="c-cur">{l.cur}</td>
                        <td className="c-unit">{item.unit || "—"}</td>
                        <td className="num">{fmt(Number(b.rate))}</td>
                      </tr>
                    )),
                  ];
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
      {s.notes && <p className="rs-notes">{s.notes}</p>}
    </div>
  );
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function PartnerSheetEditor({
  kind,
  initial,
  isNew,
  saving,
  onClose,
  onSave,
}: {
  kind: PartnerKind;
  initial: PartnerRateSheetDraft;
  isNew: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (values: PartnerRateSheetDraft) => void;
}) {
  const [d, setD] = useState<PartnerRateSheetDraft>(initial);
  const [allSections, setAllSections] = useState(false);
  const groups = worksheetGroups(d.mode, { sellOnly: false });
  const filled = new Set(filledCodes(d));
  const shownGroups = allSections
    ? groups
    : groups.filter(
        (g) =>
          CATEGORY_SOURCE[g.category] === kind || g.items.some((i) => filled.has(i.code)),
      );

  const line = (code: string, cur: LineCurrency): PartnerSheetLine =>
    d.lines[code] ?? { buy: null, cur };
  const setLine = (code: string, cur: LineCurrency, p: Partial<PartnerSheetLine>) =>
    setD((x) => ({ ...x, lines: { ...x.lines, [code]: { ...line(code, cur), ...p } } }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.route.trim()) return;
    // Drop empty codes / breaks so the sheet only stores real rates.
    const lines: Record<string, PartnerSheetLine> = {};
    for (const [code, l] of Object.entries(d.lines)) {
      const breaks = (l.breaks ?? []).filter((b) => b.label.trim() && b.rate != null);
      if (breaks.length > 0) lines[code] = { buy: null, cur: l.cur, breaks };
      else if (l.buy != null) lines[code] = { buy: l.buy, cur: l.cur };
    }
    onSave({ ...d, route: d.route.trim(), lines });
  }

  return (
    <Modal
      title={`${isNew ? "Add" : "Edit"} ${PARTNER_LABEL[kind]} rate sheet`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="grid4">
          <div className="field">
            <label>Mode</label>
            <select value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value })}>
              {QUOTE_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Trade route</label>
            <input
              required
              autoFocus
              placeholder="e.g. China → JNB"
              value={d.route}
              onChange={(e) => setD({ ...d, route: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Origin</label>
            <input
              value={d.origin ?? ""}
              onChange={(e) => setD({ ...d, origin: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>Destination</label>
            <input
              value={d.destination ?? ""}
              onChange={(e) => setD({ ...d, destination: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>Valid from</label>
            <DateInput value={d.valid_from} onChange={(v) => setD({ ...d, valid_from: v || null })} />
          </div>
          <div className="field">
            <label>Valid until</label>
            <DateInput
              value={d.valid_until}
              onChange={(v) => setD({ ...d, valid_until: v || null })}
            />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Notes</label>
            <input
              value={d.notes ?? ""}
              onChange={(e) => setD({ ...d, notes: e.target.value || null })}
            />
          </div>
        </div>

        <label className="check small" style={{ margin: "12px 0 4px" }}>
          <input
            type="checkbox"
            checked={allSections}
            onChange={(e) => setAllSections(e.target.checked)}
          />
          Show every section (not just {PARTNER_LABEL[kind].toLowerCase()} charges)
        </label>

        {shownGroups.map((g) => (
          <div className="charge-group" key={g.category}>
            <div className="charge-group-head">
              <h3>{g.category.toUpperCase()}</h3>
            </div>
            <div className="table-wrap">
              <table className="charge-table">
                <thead>
                  <tr>
                    <th className="c-code">Code</th>
                    <th>Description</th>
                    <th className="c-cur">Cur</th>
                    <th className="c-unit">Unit</th>
                    <th className="num">Buy</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.items.flatMap((item) => {
                    const l = line(item.code, item.cur);
                    const breaks = l.breaks;
                    const rows = [
                      <tr key={item.code}>
                        <td className="c-code">{item.code}</td>
                        <td>{item.description}</td>
                        <td className="c-cur">
                          <select
                            value={l.cur}
                            onChange={(e) =>
                              setLine(item.code, item.cur, { cur: e.target.value as LineCurrency })
                            }
                          >
                            {LINE_CURRENCIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td className="c-unit">{item.unit || "—"}</td>
                        <td className="num">
                          {breaks ? (
                            <span className="hint">By weight ↓</span>
                          ) : (
                            <input
                              type="number"
                              step="0.001"
                              value={l.buy ?? ""}
                              placeholder="—"
                              onChange={(e) =>
                                setLine(item.code, item.cur, { buy: numOrNull(e.target.value) })
                              }
                            />
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn small ghost"
                            title={
                              breaks
                                ? "Back to one flat rate"
                                : "Rates by chargeable weight (e.g. 0-45KG, 0-100KG)"
                            }
                            onClick={() =>
                              setLine(item.code, item.cur, {
                                breaks: breaks
                                  ? undefined
                                  : (item.unit === "KGS" ? AIR_BREAKS : TIER_BREAKS).map(
                                      (label) => ({ label, rate: null }),
                                    ),
                              })
                            }
                          >
                            {breaks ? "Flat rate" : "Weight breaks"}
                          </button>
                        </td>
                      </tr>,
                    ];
                    if (breaks) {
                      breaks.forEach((b, i) =>
                        rows.push(
                          <tr key={`${item.code}-${i}`}>
                            <td />
                            <td>
                              <input
                                value={b.label}
                                placeholder="e.g. 0-45KG"
                                onChange={(e) =>
                                  setLine(item.code, item.cur, {
                                    breaks: breaks.map((x, j) =>
                                      j === i ? { ...x, label: e.target.value } : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td className="c-cur">{l.cur}</td>
                            <td className="c-unit">{item.unit || "—"}</td>
                            <td className="num">
                              <input
                                type="number"
                                step="0.001"
                                value={b.rate ?? ""}
                                placeholder="—"
                                onChange={(e) =>
                                  setLine(item.code, item.cur, {
                                    breaks: breaks.map((x, j) =>
                                      j === i ? { ...x, rate: numOrNull(e.target.value) } : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn small ghost"
                                title="Remove this break"
                                onClick={() =>
                                  setLine(item.code, item.cur, {
                                    breaks: breaks.filter((_, j) => j !== i),
                                  })
                                }
                              >
                                ✕
                              </button>
                            </td>
                          </tr>,
                        ),
                      );
                      rows.push(
                        <tr key={`${item.code}-add`}>
                          <td />
                          <td colSpan={5}>
                            <button
                              type="button"
                              className="btn small ghost"
                              onClick={() =>
                                setLine(item.code, item.cur, {
                                  breaks: [...breaks, { label: "", rate: null }],
                                })
                              }
                            >
                              + Add break
                            </button>
                          </td>
                        </tr>,
                      );
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="hint">
          Leave a code blank if this partner doesn't charge it. Weight breaks are picked by the
          quote's chargeable weight — 35 kg uses 0-45KG.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving || !d.route.trim()}>
            {saving ? "Saving…" : "Save rate sheet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
