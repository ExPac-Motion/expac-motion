// Rates & Tariff → Tier Rate Sheets (migration 0119). Platinum / Gold /
// Silver, one sheet per tier per mode + trade route. Each sheet is the Quote
// Builder's code worksheet: lines buy from a linked Agent / Transporter /
// Clearing Agent rate sheet (live — the partner's rate for the same code) or
// a manual buy, plus the tier margin unless a line overrides it. The Quote
// Builder loads a sheet by the customer's tier.
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { ErrorNote, Loading, PageHeader, PageTools } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useAgents,
  useClearingAgents,
  useDeleteTariffSheet,
  useJobs,
  usePartnerRateSheets,
  useQuotes,
  useSaveTariffSheet,
  useTariffSheets,
  useTransporters,
} from "../../lib/hooks";
import {
  QUOTE_MODES,
  RATE_TIERS,
  rateTier,
  type Contact,
  type PartnerKind,
  type PartnerRateSheet,
  type Quote,
  type RateTierId,
  type TariffBuySource,
  type TariffSheet,
  type TariffSheetDraft,
  type TariffSheetLine,
} from "../../lib/types";
import {
  ddmmyyyy,
  defaultTierLine,
  emptyTariffSheet,
  placeShort,
  routeName,
  tariffLinesFromQuote,
  partnerIdKey,
  PARTNER_KINDS,
  PARTNER_LABEL,
  partnerRate,
  sheetIdKey,
  tierLine,
  worksheetGroups,
  type PartnerSheets,
} from "../../lib/tariff";

const fmt = (n: number) =>
  n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIER_DOT: Record<RateTierId, string> = {
  platinum: "var(--night)",
  gold: "var(--amber)",
  silver: "var(--muted)",
};
export function TierDot({ tier }: { tier: RateTierId }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 999,
        background: TIER_DOT[tier],
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function toDraft(s: TariffSheet): TariffSheetDraft {
  const { id: _i, created_at: _c, updated_at: _u, ...d } = s;
  void _i;
  void _c;
  void _u;
  return d;
}

export default function TierSheetsPage() {
  const q = useTariffSheets();
  const save = useSaveTariffSheet();
  const { toast, error } = useToast();
  const [tier, setTier] = useState<RateTierId>("silver");
  const [mode, setMode] = useState<string>(QUOTE_MODES[0]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<TariffSheetDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const dirty = useRef(false);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const routes = all.filter((s) => s.tier === tier && s.mode === mode);
  const sheet = routes.find((s) => s.id === pickedId) ?? routes[0] ?? null;

  function guard(fn: () => void) {
    if (dirty.current && !window.confirm("Discard the unsaved changes on this sheet?")) return;
    dirty.current = false;
    fn();
  }
  // Moving tier / mode keeps the same trade route open when it exists there.
  function go(nextTier: RateTierId, nextMode: string) {
    guard(() => {
      const same = all.find(
        (s) =>
          s.tier === nextTier &&
          s.mode === nextMode &&
          sheet &&
          s.route.toLowerCase() === sheet.route.toLowerCase(),
      );
      setTier(nextTier);
      setMode(nextMode);
      setPickedId(same?.id ?? null);
    });
  }

  /** Create a trade route on one or all tiers — blank, or copied from a
   *  sheet (Duplicate). Each tier gets its own default margin. */
  async function createRoute(
    v: { route: string; origin: string; destination: string; allTiers: boolean },
    from?: TariffSheetDraft,
  ) {
    try {
      const tiers = v.allTiers ? RATE_TIERS.map((t) => t.id) : [tier];
      let openId: string | null = null;
      for (const t of tiers) {
        const exists = all.some(
          (s) => s.tier === t && s.mode === mode && s.route.toLowerCase() === v.route.toLowerCase(),
        );
        if (exists) continue;
        const base = from ? { ...from, tier: t } : emptyTariffSheet(t, mode);
        const saved = await save.mutateAsync({
          values: {
            ...base,
            margin: from && t === from.tier ? from.margin : rateTier(t).margin,
            route: v.route,
            origin: v.origin || null,
            destination: v.destination || null,
          },
        });
        if (t === tier) openId = saved.id;
      }
      setCreating(false);
      setDuplicating(null);
      if (openId) setPickedId(openId);
      toast(from ? "Trade route duplicated" : "Trade route added");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add the trade route");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Platinum · Gold · Silver" title="Rates & Tariff" />
      <PageTools
        count={q.isLoading ? undefined : `${all.length} tier sheet${all.length === 1 ? "" : "s"}`}
        hint="One rate sheet per tier per trade route. Buy rates follow the linked agent / transporter / clearing agent rate sheets; the Quote Builder loads the customer's tier."
        primary={
          <button className="btn" onClick={() => guard(() => setCreating(true))}>
            + New trade route
          </button>
        }
      >
        <button
          className="btn outline"
          onClick={() => guard(() => setImporting(true))}
          title="Create tier sheets for the trade routes on your quotes and shipments"
        >
          Import routes
        </button>
        <Link className="btn outline" to="/rates/list">
          Rate list
        </Link>
      </PageTools>

      <div className="panel">
        <div className="rs-tabs" role="tablist">
          {RATE_TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rs-tab${tier === t.id ? " on" : ""}`}
              onClick={() => go(t.id, mode)}
              title={t.note}
            >
              <TierDot tier={t.id} />
              {t.label} · {t.margin}%
            </button>
          ))}
        </div>
        <div className="rs-tabs" role="tablist">
          {QUOTE_MODES.map((m) => {
            const n = all.filter((s) => s.tier === tier && s.mode === m).length;
            return (
              <button
                key={m}
                type="button"
                className={`rs-tab${mode === m ? " on" : ""}`}
                onClick={() => go(tier, m)}
              >
                {m}
                {n > 0 && <span className="rs-tab-n">{n}</span>}
              </button>
            );
          })}
        </div>

        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <>
            <ErrorNote error={q.error} />
            <p className="hint">Tier rate sheets need migration 0119 in Supabase.</p>
          </>
        ) : !sheet ? (
          <p className="hint">
            No {rateTier(tier).label} {mode} trade routes yet — click <strong>+ New trade route</strong>.
          </p>
        ) : (
          <SheetEditor
            key={`${sheet.id}|${sheet.updated_at}`}
            sheet={sheet}
            all={all}
            routes={routes}
            onPick={(id) => guard(() => setPickedId(id))}
            onDirty={(v) => (dirty.current = v)}
            onDuplicate={(draft) => guard(() => setDuplicating(draft))}
          />
        )}
      </div>

      {creating && (
        <NewRouteModal
          tier={tier}
          mode={mode}
          busy={save.isPending}
          onClose={() => setCreating(false)}
          onSave={(v) => createRoute(v)}
        />
      )}
      {duplicating && (
        <NewRouteModal
          tier={tier}
          mode={mode}
          duplicateOf={duplicating}
          busy={save.isPending}
          onClose={() => setDuplicating(null)}
          onSave={(v) => createRoute(v, duplicating)}
        />
      )}
      {importing && (
        <ImportRoutesModal
          existing={all}
          onClose={() => setImporting(false)}
          onDone={(n, firstMode) => {
            setImporting(false);
            if (firstMode) {
              setMode(firstMode);
              setPickedId(null);
            }
            toast(`Created ${n} tier sheet${n === 1 ? "" : "s"}`);
          }}
        />
      )}
    </>
  );
}

function SheetEditor({
  sheet,
  all,
  routes,
  onPick,
  onDirty,
  onDuplicate,
}: {
  sheet: TariffSheet;
  all: TariffSheet[];
  routes: TariffSheet[];
  onPick: (id: string) => void;
  onDirty: (dirty: boolean) => void;
  onDuplicate: (draft: TariffSheetDraft) => void;
}) {
  const save = useSaveTariffSheet();
  const del = useDeleteTariffSheet();
  const { toast, error } = useToast();
  const [d, setDraft] = useState<TariffSheetDraft>(() => toDraft(sheet));
  const [isDirty, setIsDirty] = useState(false);
  const setD = (next: TariffSheetDraft) => {
    setDraft(next);
    setIsDirty(true);
    onDirty(true);
  };

  const agents = useAgents().data ?? [];
  const transporters = useTransporters().data ?? [];
  const clearingAgents = useClearingAgents().data ?? [];
  const partnerList: Record<PartnerKind, Contact[]> = {
    agent: agents,
    transporter: transporters,
    clearing_agent: clearingAgents,
  };
  const agentSheets = usePartnerRateSheets("agent", d.agent_id).data ?? [];
  const transporterSheets = usePartnerRateSheets("transporter", d.transporter_id).data ?? [];
  const clearingSheets = usePartnerRateSheets("clearing_agent", d.clearing_agent_id).data ?? [];
  const sheetsOf: Record<PartnerKind, PartnerRateSheet[]> = {
    agent: agentSheets,
    transporter: transporterSheets,
    clearing_agent: clearingSheets,
  };
  const linked: PartnerSheets = {
    agent: agentSheets.find((s) => s.id === d.agent_sheet_id) ?? null,
    transporter: transporterSheets.find((s) => s.id === d.transporter_sheet_id) ?? null,
    clearing_agent: clearingSheets.find((s) => s.id === d.clearing_agent_sheet_id) ?? null,
  };

  const line = (code: string, fallback: TariffSheetLine) => d.lines[code] ?? fallback;
  const setLine = (code: string, fallback: TariffSheetLine, p: Partial<TariffSheetLine>) =>
    setD({ ...d, lines: { ...d.lines, [code]: { ...line(code, fallback), ...p } } });

  async function onSave() {
    try {
      await save.mutateAsync({ id: sheet.id, values: { ...d, route: d.route.trim() || sheet.route } });
      onDirty(false);
      setIsDirty(false);
      toast("Tier sheet saved");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete the ${rateTier(d.tier).label} sheet "${sheet.route}"?`)) return;
    try {
      onDirty(false);
      await del.mutateAsync(sheet.id);
      toast("Tier sheet deleted");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  /** Copy this route (partners, lines, dates) to the tiers that don't have it
   *  yet, each with its own default margin. */
  async function copyToOtherTiers() {
    const missing = RATE_TIERS.filter(
      (t) =>
        t.id !== d.tier &&
        !all.some(
          (s) => s.tier === t.id && s.mode === d.mode && s.route.toLowerCase() === d.route.toLowerCase(),
        ),
    );
    if (missing.length === 0) {
      toast("Every tier already has this trade route");
      return;
    }
    try {
      for (const t of missing)
        await save.mutateAsync({ values: { ...d, tier: t.id, margin: t.margin } });
      toast(`Copied to ${missing.map((t) => t.label).join(" and ")}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not copy");
    }
  }

  function pickPartner(kind: PartnerKind, partnerId: string) {
    setD({
      ...d,
      [partnerIdKey(kind)]: partnerId || null,
      // Their rate sheet is linked just below once their sheets load.
      [sheetIdKey(kind)]: null,
    });
  }
  // Once a newly picked partner's sheets load, link the one for this route.
  for (const kind of PARTNER_KINDS) {
    const pid = d[partnerIdKey(kind)];
    const list = sheetsOf[kind].filter((s) => s.mode === d.mode);
    if (pid && !d[sheetIdKey(kind)] && list.length > 0 && list[0].partner_id === pid) {
      const match =
        list.find((s) => s.route.toLowerCase() === d.route.toLowerCase()) ?? list[0];
      setD({ ...d, [sheetIdKey(kind)]: match.id });
    }
  }

  const groups = worksheetGroups(d.mode);
  const t = rateTier(d.tier);

  return (
    <>
      <div className="grid4" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Trade route</label>
          <select value={sheet.id} onChange={(e) => onPick(e.target.value)}>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.route}
              </option>
            ))}
          </select>
          <span className="hint">Each trade route has its own sheet on every tier.</span>
        </div>
        <div className="field">
          <label>Route name</label>
          <input value={d.route} onChange={(e) => setD({ ...d, route: e.target.value })} />
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
          <label>Tier margin (%)</label>
          <input
            type="number"
            step="0.5"
            value={d.margin}
            onChange={(e) => setD({ ...d, margin: Number(e.target.value) || 0 })}
          />
          <span className="hint">
            {t.label} default {t.margin}% on every buy price.
          </span>
        </div>
        <div className="field">
          <label>Valid from</label>
          <DateInput value={d.valid_from} onChange={(v) => setD({ ...d, valid_from: v || null })} />
        </div>
        <div className="field">
          <label>Valid until</label>
          <DateInput value={d.valid_until} onChange={(v) => setD({ ...d, valid_until: v || null })} />
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className="btn outline" onClick={onDelete}>
              Delete
            </button>
            <button
              type="button"
              className="btn outline"
              onClick={() => onDuplicate(d)}
              title="Copy this sheet to a new trade route"
            >
              Duplicate
            </button>
            <button
              type="button"
              className="btn outline"
              onClick={copyToOtherTiers}
              disabled={isDirty || save.isPending}
              title={isDirty ? "Save first" : "Create this route on the other tiers"}
            >
              Copy to other tiers
            </button>
            <button
              type="button"
              className="btn"
              onClick={onSave}
              disabled={!isDirty || save.isPending}
            >
              {save.isPending ? "Saving…" : isDirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>
      </div>

      <h3 style={{ margin: "4px 0 8px" }}>LINKED PARTNERS</h3>
      <div className="grid3" style={{ marginBottom: 18 }}>
        {PARTNER_KINDS.map((kind) => {
          const pid = d[partnerIdKey(kind)] ?? "";
          const list = sheetsOf[kind].filter((s) => s.mode === d.mode);
          return (
            <div className="field" key={kind}>
              <label>{PARTNER_LABEL[kind]}</label>
              <select value={pid} onChange={(e) => pickPartner(kind, e.target.value)}>
                <option value="">— none —</option>
                {partnerList[kind].map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.company}
                  </option>
                ))}
              </select>
              {pid && (
                <select
                  style={{ marginTop: 6 }}
                  value={d[sheetIdKey(kind)] ?? ""}
                  onChange={(e) => setD({ ...d, [sheetIdKey(kind)]: e.target.value || null })}
                >
                  <option value="">
                    {list.length ? "— pick their rate sheet —" : `No ${d.mode} rate sheets yet`}
                  </option>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.route}
                    </option>
                  ))}
                </select>
              )}
              <span className="hint">
                {pid
                  ? "Buy rates set to this partner follow this rate sheet live."
                  : "Pick a partner to buy these charges from."}
              </span>
            </div>
          );
        })}
      </div>

      {groups.map((g) => (
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
                  <th>Buy from</th>
                  <th className="num">Buy</th>
                  <th className="num">Margin (%)</th>
                  <th className="num">Sell</th>
                </tr>
              </thead>
              <tbody>
                {g.items.flatMap((item) => {
                  const fallback = defaultTierLine(item);
                  const l = line(item.code, fallback);
                  const r = tierLine(d, item, linked, 0);
                  const partnerSheet =
                    l.source !== "manual" ? linked[l.source as PartnerKind] : null;
                  const pLine = partnerSheet?.lines[item.code];
                  const breaks = (pLine?.breaks ?? []).filter((b) => b.rate != null);
                  const missingTitle =
                    l.source === "manual"
                      ? undefined
                      : !d[partnerIdKey(l.source as PartnerKind)]
                        ? `Pick a ${PARTNER_LABEL[l.source as PartnerKind].toLowerCase()} above`
                        : !partnerSheet
                          ? "Pick the partner's rate sheet above"
                          : "No rate for this code on the partner's sheet";
                  const rows = [
                    <tr key={item.code}>
                      <td className="c-code">{item.code}</td>
                      <td>{item.description}</td>
                      <td className="c-cur">{r.cur}</td>
                      <td className="c-unit">{item.unit || "—"}</td>
                      <td>
                        {r.sellOnly ? (
                          <span className="hint">Sell only (R)</span>
                        ) : (
                          <select
                            value={l.source}
                            onChange={(e) =>
                              setLine(item.code, fallback, {
                                source: e.target.value as TariffBuySource,
                              })
                            }
                          >
                            {PARTNER_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {PARTNER_LABEL[k]}
                              </option>
                            ))}
                            <option value="manual">Manual</option>
                          </select>
                        )}
                      </td>
                      <td className="num">
                        {r.sellOnly ? (
                          "—"
                        ) : l.source === "manual" ? (
                          <input
                            type="number"
                            step="0.01"
                            value={l.buy ?? ""}
                            placeholder="—"
                            onChange={(e) =>
                              setLine(item.code, fallback, {
                                buy: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                        ) : breaks.length > 0 ? (
                          <span className="hint">By weight ↓</span>
                        ) : r.buy != null ? (
                          <span title={`Live from ${partnerSheet?.route ?? "partner"}`}>
                            {fmt(r.buy)}
                          </span>
                        ) : (
                          <span className="hint" title={missingTitle}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {r.sellOnly ? (
                          "—"
                        ) : (
                          <input
                            type="number"
                            step="0.5"
                            value={r.margin}
                            title={l.margin == null ? "Tier margin" : "Changed on this line"}
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : Number(e.target.value);
                              setLine(item.code, fallback, {
                                margin: v == null || v === d.margin ? null : v,
                              });
                            }}
                          />
                        )}
                      </td>
                      <td className="num">
                        {r.sellOnly ? (
                          <input
                            type="number"
                            step="0.01"
                            value={l.sell ?? ""}
                            placeholder="—"
                            onChange={(e) =>
                              setLine(item.code, fallback, {
                                sell: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                        ) : breaks.length > 0 ? (
                          ""
                        ) : r.sell != null ? (
                          fmt(r.sell)
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>,
                  ];
                  breaks.forEach((b, i) => {
                    const buy = partnerRate({ ...pLine!, breaks: [b] }, 0)!.buy;
                    rows.push(
                      <tr key={`${item.code}-${i}`}>
                        <td />
                        <td className="hint">↳ {b.label}</td>
                        <td className="c-cur">{r.cur}</td>
                        <td className="c-unit">{item.unit || "—"}</td>
                        <td className="hint">{partnerSheet?.route}</td>
                        <td className="num">{fmt(buy)}</td>
                        <td className="num">{r.margin}</td>
                        <td className="num">{fmt(buy * (1 + r.margin / 100))}</td>
                      </tr>,
                    );
                  });
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="hint">
        Buy rates from a partner are read-only here and follow that partner's rate sheet as it
        changes. Set a line to Manual to type your own buy. Margin uses the tier margin unless you
        change it on a line. Sell-only codes take a Sell (R). Codes left blank aren't loaded onto
        quotes.
      </p>
    </>
  );
}

function NewRouteModal({
  tier,
  mode,
  duplicateOf,
  busy,
  onClose,
  onSave,
}: {
  tier: RateTierId;
  mode: string;
  /** Duplicate: copy this sheet's partners + lines onto the new route. */
  duplicateOf?: TariffSheetDraft;
  busy: boolean;
  onClose: () => void;
  onSave: (v: { route: string; origin: string; destination: string; allTiers: boolean }) => void;
}) {
  const [route, setRoute] = useState(duplicateOf ? `${duplicateOf.route} (Copy)` : "");
  const [origin, setOrigin] = useState(duplicateOf?.origin ?? "");
  const [destination, setDestination] = useState(duplicateOf?.destination ?? "");
  const [allTiers, setAllTiers] = useState(true);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!route.trim()) return;
    onSave({ route: route.trim(), origin: origin.trim(), destination: destination.trim(), allTiers });
  }
  return (
    <Modal
      title={duplicateOf ? `Duplicate "${duplicateOf.route}"` : `New ${mode} trade route`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {duplicateOf && (
          <p className="hint" style={{ marginTop: 0 }}>
            Copies the linked partners and every line's buy source, buy, margin and sell onto a
            new trade route.
          </p>
        )}
        <div className="field">
          <label>Trade route</label>
          <input
            autoFocus
            required
            placeholder="e.g. China → JNB"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
          />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Origin</label>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </div>
          <div className="field">
            <label>Destination</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={allTiers} onChange={(e) => setAllTiers(e.target.checked)} />
          Create it on all three tiers (Platinum 10%, Gold 15%, Silver 18%)
        </label>
        {!allTiers && (
          <p className="hint">Only the {rateTier(tier).label} sheet will be created.</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy || !route.trim()}>
            {busy ? "Creating…" : duplicateOf ? "Duplicate" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface FoundRoute {
  key: string;
  mode: string;
  route: string;
  origin: string;
  destination: string;
  quotes: number;
  shipments: number;
  last: string;
  /** Most recent quotation on the route with buy rates — seeds the sheet. */
  latest: Quote | null;
  /** Tiers that already have this route. */
  have: RateTierId[];
}

/** Every mode + origin → destination on the quotations and shipments, to
 *  create tier sheets for in one go (all three tiers). Each new sheet takes
 *  the latest quote's agent / transporter / clearing agent and its coded
 *  buy rates as manual buys — switch lines to a partner once their rate
 *  sheets are in. */
function ImportRoutesModal({
  existing,
  onClose,
  onDone,
}: {
  existing: TariffSheet[];
  onClose: () => void;
  onDone: (created: number, firstMode: string | null) => void;
}) {
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const save = useSaveTariffSheet();
  const { error } = useToast();
  const [progress, setProgress] = useState<string | null>(null);

  const found = useMemo<FoundRoute[]>(() => {
    const map = new Map<string, FoundRoute>();
    const quotesById = new Map((quotesQ.data ?? []).map((q) => [q.id, q]));
    const touch = (
      mode: string,
      origin: string | null,
      destination: string | null,
      when: string,
    ): FoundRoute | null => {
      if (!placeShort(origin) && !placeShort(destination)) return null;
      const route = routeName(origin, destination);
      const key = `${mode}|${route.toLowerCase()}`;
      let f = map.get(key);
      if (!f) {
        f = {
          key,
          mode,
          route,
          origin: origin ?? "",
          destination: destination ?? "",
          quotes: 0,
          shipments: 0,
          last: when,
          latest: null,
          have: RATE_TIERS.filter((t) =>
            existing.some(
              (s) =>
                s.tier === t.id && s.mode === mode && s.route.toLowerCase() === route.toLowerCase(),
            ),
          ).map((t) => t.id),
        };
        map.set(key, f);
      }
      if (when > f.last) f.last = when;
      return f;
    };
    // Newest first, so the first quote with rates on a route is its latest.
    for (const q of quotesQ.data ?? []) {
      const f = touch(q.mode, q.origin, q.destination, q.created_at);
      if (!f) continue;
      f.quotes += 1;
      if (!f.latest && (q.quote_lines ?? []).some((l) => Number(l.buy) > 0)) f.latest = q;
    }
    for (const j of jobsQ.data ?? []) {
      const q = j.quote_id ? quotesById.get(j.quote_id) : undefined;
      const f = touch(
        j.mode,
        j.origin ?? q?.origin ?? null,
        j.destination ?? q?.destination ?? null,
        j.created_at,
      );
      if (f) f.shipments += 1;
    }
    return [...map.values()].sort(
      (a, b) =>
        b.shipments + b.quotes - (a.shipments + a.quotes) || a.route.localeCompare(b.route),
    );
  }, [quotesQ.data, jobsQ.data, existing]);

  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selectable = found.filter((f) => f.have.length < RATE_TIERS.length);
  const sel = picked ?? new Set(selectable.map((f) => f.key));
  const chosen = selectable.filter((f) => sel.has(f.key));
  const toggle = (key: string) => {
    const next = new Set(sel);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  async function run() {
    const todo = chosen.flatMap((f) =>
      RATE_TIERS.filter((t) => !f.have.includes(t.id)).map((t) => ({ f, t })),
    );
    let n = 0;
    try {
      for (const { f, t } of todo) {
        setProgress(`Creating ${n + 1} of ${todo.length}…`);
        const q = f.latest;
        await save.mutateAsync({
          values: {
            ...emptyTariffSheet(t.id, f.mode),
            route: f.route,
            origin: f.origin || null,
            destination: f.destination || null,
            agent_id: q?.agent_id ?? null,
            transporter_id: q?.transporter_id ?? null,
            clearing_agent_id: q?.clearing_agent_id ?? null,
            lines: q ? tariffLinesFromQuote(q) : emptyTariffSheet(t.id, f.mode).lines,
            notes: q ? `Seeded from quotation ${q.reference}` : null,
          },
        });
        n += 1;
      }
      onDone(n, chosen[0]?.mode ?? null);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not create the tier sheets");
      setProgress(null);
    }
  }

  const loading = quotesQ.isLoading || jobsQ.isLoading;
  return (
    <Modal title="Import trade routes from quotes & shipments" onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Every mode + origin → destination on your quotations and shipments. Ticked routes get a
        sheet on all three tiers (Platinum 10%, Gold 15%, Silver 18%), pre-filled from the route's
        latest quotation: its agent, transporter and clearing agent, and its buy rates as manual
        buys.
      </p>
      {loading ? (
        <Loading />
      ) : found.length === 0 ? (
        <p className="hint">No quotes or shipments with an origin / destination yet.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: "55vh", overflow: "auto" }}>
          <table className="charge-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectable.length > 0 && chosen.length === selectable.length}
                    onChange={(e) =>
                      setPicked(new Set(e.target.checked ? selectable.map((f) => f.key) : []))
                    }
                    title="Select all"
                  />
                </th>
                <th>Mode</th>
                <th>Trade route</th>
                <th className="num">Quotes</th>
                <th className="num">Shipments</th>
                <th>Last</th>
                <th>Seeded from</th>
              </tr>
            </thead>
            <tbody>
              {found.map((f) => {
                const done = f.have.length === RATE_TIERS.length;
                return (
                  <tr key={f.key}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={done}
                        checked={!done && sel.has(f.key)}
                        onChange={() => toggle(f.key)}
                      />
                    </td>
                    <td>{f.mode}</td>
                    <td>
                      <strong>{f.route}</strong>
                      {done && <span className="hint"> · already set up</span>}
                      {!done && f.have.length > 0 && (
                        <span className="hint"> · adds the missing tiers</span>
                      )}
                    </td>
                    <td className="num">{f.quotes}</td>
                    <td className="num">{f.shipments}</td>
                    <td>{ddmmyyyy(f.last)}</td>
                    <td>
                      {f.latest ? f.latest.reference : <span className="hint">blank sheet</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
        }}
      >
        {progress && <span className="hint">{progress}</span>}
        <button type="button" className="btn outline" onClick={onClose} disabled={!!progress}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={run}
          disabled={!!progress || loading || chosen.length === 0}
        >
          Create tier sheets ({chosen.length} route{chosen.length === 1 ? "" : "s"})
        </button>
      </div>
    </Modal>
  );
}
