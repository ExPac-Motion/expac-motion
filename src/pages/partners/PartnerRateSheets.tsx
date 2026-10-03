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
  usePartnerSheetHistory,
  useSavePartnerRateSheet,
} from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import {
  CHARGE_UNITS,
  LINE_CURRENCIES,
  QUOTE_MODES,
  type LineCurrency,
  type PartnerKind,
  type PartnerRateSheet,
  type PartnerRateSheetChange,
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
  canDelete = true,
  showHistory = false,
}: {
  kind: PartnerKind;
  partnerId: string;
  partnerName: string;
  /** Partner-portal logins can add and edit, never delete (0121). */
  canDelete?: boolean;
  /** Admin: each sheet's change history (partner_rate_sheet_history). */
  showHistory?: boolean;
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
            onDelete={canDelete ? () => onDelete(s) : undefined}
            showHistory={showHistory}
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
  showHistory,
}: {
  s: PartnerRateSheet;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
  showHistory?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
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
          {showHistory && (
            <button
              type="button"
              className="btn small outline"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              {historyOpen ? "Hide history" : "History"}
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn small outline" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      {historyOpen && <SheetHistory sheetId={s.id} />}
      {groups.length === 0 ? (
        <p className="hint">No rates filled in yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="charge-table tier-table">
            <colgroup>
              <col style={{ width: "15%" }} />
              <col style={{ width: "40%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c-code">Code</th>
                <th>Description</th>
                <th className="c-cur">Cur</th>
                <th className="c-unit">Unit</th>
                <th className="num">Rate</th>
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
                      <td className="c-unit">{l.unit || item.unit || "—"}</td>
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
                        <td className="c-unit">{l.unit || item.unit || "—"}</td>
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

/** Readable list of what one saved change did to a sheet's rates. */
function describeChange(c: PartnerRateSheetChange): string[] {
  if (c.action === "insert") return ["Sheet created"];
  if (c.action === "delete") return ["Sheet deleted"];
  const o = c.old_row;
  const n = c.new_row;
  if (!o || !n) return [];
  const out: string[] = [];
  const v = (x: number | null | undefined) => (x == null ? "—" : fmt(Number(x)));
  for (const code of new Set([...Object.keys(o.lines ?? {}), ...Object.keys(n.lines ?? {})])) {
    const a = o.lines?.[code];
    const b = n.lines?.[code];
    const labels = new Set([
      ...(a?.breaks ?? []).map((x) => x.label),
      ...(b?.breaks ?? []).map((x) => x.label),
    ]);
    if (labels.size > 0) {
      for (const label of labels) {
        const ra = a?.breaks?.find((x) => x.label === label)?.rate;
        const rb = b?.breaks?.find((x) => x.label === label)?.rate;
        if (ra !== rb) out.push(`${code} ${label}: ${v(ra)} → ${v(rb)}`);
      }
    } else if ((a?.buy ?? null) !== (b?.buy ?? null)) {
      out.push(`${code}: ${v(a?.buy)} → ${v(b?.buy)}`);
    }
    if (a && b && a.cur !== b.cur) out.push(`${code} currency: ${a.cur} → ${b.cur}`);
  }
  if (o.route !== n.route) out.push(`Route: ${o.route} → ${n.route}`);
  if (o.valid_until !== n.valid_until)
    out.push(`Valid until: ${ddmmyyyy(o.valid_until) || "—"} → ${ddmmyyyy(n.valid_until) || "—"}`);
  if (o.valid_from !== n.valid_from)
    out.push(`Valid from: ${ddmmyyyy(o.valid_from) || "—"} → ${ddmmyyyy(n.valid_from) || "—"}`);
  return out.length ? out : ["Saved — no rate changes"];
}

function SheetHistory({ sheetId }: { sheetId: string }) {
  const q = usePartnerSheetHistory(sheetId);
  if (q.isLoading) return <p className="hint">Loading history…</p>;
  if (q.isError) return <p className="hint">History needs migration 0121.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="hint">No changes recorded yet.</p>;
  return (
    <div className="table-wrap" style={{ marginBottom: 10 }}>
      <table className="charge-table">
        <thead>
          <tr>
            <th>When</th>
            <th>By</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{formatDateTime(c.changed_at)}</td>
              <td>{c.changed_by_email || "—"}</td>
              <td style={{ whiteSpace: "normal" }}>{describeChange(c).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // Only this partner's own sections (agent: freight + ex-works, transporter:
  // destination, clearing agent: customs), ExPac's codes for the mode.
  const groupsFor = (mode: string) =>
    worksheetGroups(mode, { sellOnly: false }).filter((g) => CATEGORY_SOURCE[g.category] === kind);
  const groups = groupsFor(d.mode);
  const allCodes = (mode: string) => groupsFor(mode).flatMap((g) => g.items.map((i) => i.code));
  // The sheet's lines, like a quote: a new sheet starts with every code, an
  // existing one with the codes it has; + Add line / ✕ change that.
  const [rows, setRows] = useState<string[]>(() => {
    const valid = allCodes(initial.mode);
    const have = valid.filter((c) => c in initial.lines);
    return isNew || have.length === 0 ? valid : have;
  });

  const line = (code: string, cur: LineCurrency): PartnerSheetLine =>
    d.lines[code] ?? { buy: null, cur };
  const setLine = (code: string, cur: LineCurrency, p: Partial<PartnerSheetLine>) =>
    setD((x) => ({ ...x, lines: { ...x.lines, [code]: { ...line(code, cur), ...p } } }));

  function changeMode(mode: string) {
    setD({ ...d, mode });
    const valid = allCodes(mode);
    const keep = rows.filter((c) => valid.includes(c));
    setRows(keep.length ? keep : valid);
  }
  function addRow(category: string) {
    const next = groups.find((g) => g.category === category)?.items.find((i) => !rows.includes(i.code));
    if (next) setRows([...rows, next.code]);
  }
  function changeRow(from: string, to: string) {
    setRows(rows.map((c) => (c === from ? to : c)));
    setD((x) => {
      const lines = { ...x.lines };
      delete lines[from];
      return { ...x, lines };
    });
  }
  function removeRow(code: string) {
    setRows(rows.filter((c) => c !== code));
    setD((x) => {
      const lines = { ...x.lines };
      delete lines[code];
      return { ...x, lines };
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.route.trim()) return;
    // Only the sheet's lines, and only real rates (blank codes / breaks dropped).
    const lines: Record<string, PartnerSheetLine> = {};
    for (const code of rows) {
      const l = d.lines[code];
      if (!l) continue;
      const breaks = (l.breaks ?? []).filter((b) => b.label.trim() && b.rate != null);
      const unit = l.unit ? { unit: l.unit } : {};
      if (breaks.length > 0) lines[code] = { buy: null, cur: l.cur, breaks, ...unit };
      else if (l.buy != null) lines[code] = { buy: l.buy, cur: l.cur, ...unit };
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
            <select value={d.mode} onChange={(e) => changeMode(e.target.value)}>
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

        {groups.length === 0 && (
          <p className="hint">ExPac has no {PARTNER_LABEL[kind].toLowerCase()} charges for {d.mode}.</p>
        )}
        {groups.map((g) => {
          const codes = g.items.filter((i) => rows.includes(i.code));
          const canAdd = g.items.some((i) => !rows.includes(i.code));
          return (
            <div className="charge-group" key={g.category}>
              <div className="charge-group-head">
                <h3>{g.category.toUpperCase()}</h3>
                <button
                  type="button"
                  className="btn small outline"
                  disabled={!canAdd}
                  title={canAdd ? undefined : "Every code for this section is already on the sheet"}
                  onClick={() => addRow(g.category)}
                >
                  + Add line
                </button>
              </div>
              {codes.length === 0 ? (
                <p className="hint" style={{ padding: "4px 0 10px" }}>
                  No charges in this section.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="charge-table tier-table">
                    <colgroup>
                      <col style={{ width: "13.7%" }} />
                      <col style={{ width: "27.4%" }} />
                      <col style={{ width: "13.7%" }} />
                      <col style={{ width: "13.7%" }} />
                      <col style={{ width: "13.7%" }} />
                      <col style={{ width: "13.8%" }} />
                      <col style={{ width: "4%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Description</th>
                        <th>Cur</th>
                        <th>Unit</th>
                        <th className="num">Rate</th>
                        <th />
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {codes.flatMap((item) => {
                        const l = line(item.code, item.cur);
                        const breaks = l.breaks;
                        const unit = l.unit ?? item.unit;
                        const out = [
                          <tr key={item.code}>
                            <td>
                              <select
                                value={item.code}
                                onChange={(e) => changeRow(item.code, e.target.value)}
                                title={item.description}
                              >
                                {g.items.map((c) => {
                                  const taken = c.code !== item.code && rows.includes(c.code);
                                  return (
                                    <option key={c.code} value={c.code} disabled={taken}>
                                      {c.code}
                                      {taken ? " · on sheet" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </td>
                            <td title={item.description}>{item.description}</td>
                            <td>
                              <select
                                value={l.cur}
                                onChange={(e) =>
                                  setLine(item.code, item.cur, {
                                    cur: e.target.value as LineCurrency,
                                  })
                                }
                              >
                                {LINE_CURRENCIES.map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={unit}
                                onChange={(e) =>
                                  setLine(item.code, item.cur, {
                                    unit: e.target.value === item.unit ? undefined : e.target.value,
                                  })
                                }
                              >
                                <option value="">— unit —</option>
                                {CHARGE_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                                {unit && !CHARGE_UNITS.includes(unit) && (
                                  <option value={unit}>{unit}</option>
                                )}
                              </select>
                            </td>
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
                                    setLine(item.code, item.cur, {
                                      buy: numOrNull(e.target.value),
                                    })
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
                                      : (unit === "KGS" ? AIR_BREAKS : TIER_BREAKS).map(
                                          (label) => ({ label, rate: null }),
                                        ),
                                  })
                                }
                              >
                                {breaks ? "Flat rate" : "Weight breaks"}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="row-icon-btn"
                                title="Remove this line"
                                onClick={() => removeRow(item.code)}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>,
                        ];
                        if (breaks) {
                          breaks.forEach((b, i) =>
                            out.push(
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
                                <td>{l.cur}</td>
                                <td>{unit || "—"}</td>
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
                                  {i === breaks.length - 1 && (
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
                                  )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="row-icon-btn"
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
                        }
                        return out;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        <p className="hint">
          Only ExPac's charge codes for your services are listed — add the lines you charge, ✕ the ones
          you don't. Weight breaks are picked by the quote's chargeable weight — 35 kg uses 0-45KG.
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
