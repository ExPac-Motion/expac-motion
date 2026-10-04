// Rates & Tariff → Rate list → Trade routes: every tier rate sheet (imported
// from quotes / shipments or added by hand) in one grid, with search,
// tier / mode filters, Bulk Edit (margin, validity, partners) and bulk
// delete. Open / Edit jumps to the sheet on the Tier Rate Sheets page.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  Popover,
  RowActions,
  RowActionsHead,
  SearchInput,
  useRowSelection,
  CanDelete,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useAgents,
  useClearingAgents,
  useDeleteTariffSheet,
  useDeleteTariffSheetsBulk,
  useDestinationAgents,
  useAllPartnerRateSheets,
  useTariffSheets,
  useTransporters,
  useUpdateTariffSheetsBulk,
} from "../../lib/hooks";
import {
  QUOTE_MODES,
  RATE_TIERS,
  rateTier,
  type Contact,
  type PartnerKind,
  type RateTierId,
  type TariffSheet,
  type TariffSheetDraft,
} from "../../lib/types";
import {
  ddmmyyyy,
  isSellOnlyCode,
  PARTNER_KINDS,
  PARTNER_LABEL,
  partnerIdKey,
  sheetIdKey,
} from "../../lib/tariff";

/** The "+ Add Filter" choices (empty = any). */
interface RouteFilters {
  route: string;
  origin: string;
  destination: string;
  agent: string;
  transporter: string;
  clearing_agent: string;
  destination_agent: string;
}
const NO_FILTERS: RouteFilters = {
  route: "",
  origin: "",
  destination: "",
  agent: "",
  transporter: "",
  clearing_agent: "",
  destination_agent: "",
};
/** "CNNSA — Nansha, China" / "CNNSA" / "China" -> "China" (known countries only). */
const ISO2_COUNTRY = new Map(LOCODES.map((l) => [l.code.slice(0, 2), l.country]));
const COUNTRIES = new Set(LOCODES.map((l) => l.country));
function countryOf(place: string | null | undefined): string | null {
  const t = (place ?? "").trim();
  if (!t) return null;
  if (COUNTRIES.has(t)) return t;
  const code = t.match(/^([A-Z]{2})[A-Z0-9]{3}\b/);
  if (code) return ISO2_COUNTRY.get(code[1]) ?? null;
  const tail = t.split(",").pop()?.trim();
  return tail && COUNTRIES.has(tail) ? tail : null;
}
/** A route's origin country: its first part ("China → …", "CNNSA → …"), else its origin field. */
const routeOrigin = (route: string, origin?: string | null) =>
  countryOf(route.split("→")[0]) ?? countryOf(origin);

const distinct = (vals: (string | null | undefined)[]) =>
  [...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
import { TierDot } from "./TierSheetsPage";
import { LOCODES } from "../../lib/locodes";

/** Codes on the sheet with a price of their own (manual buy or Sell (R)). */
function manualCount(s: TariffSheet): number {
  return Object.entries(s.lines).filter(([code, l]) =>
    isSellOnlyCode(code) ? (l.sell ?? 0) > 0 : l.source === "manual" && (l.buy ?? 0) > 0,
  ).length;
}
function linkedCount(s: TariffSheet): number {
  return [
    s.agent_sheet_id,
    s.destination_agent_sheet_id,
    s.transporter_sheet_id,
    s.clearing_agent_sheet_id,
  ].filter(Boolean).length;
}

export default function TradeRoutesList({ tabs }: { tabs: ReactNode }) {
  const q = useTariffSheets();
  const agents = useAgents().data ?? [];
  const transporters = useTransporters().data ?? [];
  const clearingAgents = useClearingAgents().data ?? [];
  const destinationAgents = useDestinationAgents().data ?? [];
  const bulkUpdate = useUpdateTariffSheetsBulk();
  const bulkDelete = useDeleteTariffSheetsBulk();
  const del = useDeleteTariffSheet();
  const { toast, error } = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<RateTierId | "All">("All");
  const [modeFilter, setModeFilter] = useState<string>("All");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filters, setFilters] = useState<RouteFilters>(NO_FILTERS);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const routeSheetsQ = useAllPartnerRateSheets(!!filters.route);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const name = (list: Contact[], id: string | null) =>
    (id && list.find((c) => c.id === id)?.company) || "";

  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((s) => {
      if (tierFilter !== "All" && s.tier !== tierFilter) return false;
      if (modeFilter !== "All" && s.mode !== modeFilter) return false;
      if (filters.route && s.route.toLowerCase() !== filters.route.toLowerCase()) return false;
      if (filters.origin && (s.origin ?? "").trim() !== filters.origin) return false;
      if (filters.destination && (s.destination ?? "").trim() !== filters.destination) return false;
      for (const k of PARTNER_KINDS) if (filters[k] && s[partnerIdKey(k)] !== filters[k]) return false;
      if (!needle) return true;
      return [
        s.route,
        s.origin,
        s.destination,
        s.mode,
        rateTier(s.tier).label,
        name(agents, s.agent_id),
        name(transporters, s.transporter_id),
        name(clearingAgents, s.clearing_agent_id),
        name(destinationAgents, s.destination_agent_id),
      ].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
    // name() reads the partner lists
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, tierFilter, modeFilter, filters, agents, transporters, clearingAgents, destinationAgents]);

  const partnerList: Record<PartnerKind, Contact[]> = {
    agent: agents,
    transporter: transporters,
    clearing_agent: clearingAgents,
    destination_agent: destinationAgents,
  };
  /** Every partner on the filtered trade route: linked on its tier sheets
   *  and / or with their own rate sheet for that route. */
  // The filtered route's origin country — partner sheets from that country
  // count as on this route even when their route is named differently.
  const originCountry = useMemo(() => {
    if (!filters.route) return null;
    const own = all.find((s) => s.route.toLowerCase() === filters.route.toLowerCase());
    return routeOrigin(filters.route, own?.origin);
  }, [filters.route, all]);
  const routePartners = useMemo(() => {
    if (!filters.route) return [];
    return PARTNER_KINDS.map((kind) => {
      const byId = new Map<string, { tiers: Set<string>; sheets: string[] }>();
      const entry = (id: string) => {
        if (!byId.has(id)) byId.set(id, { tiers: new Set(), sheets: [] });
        return byId.get(id)!;
      };
      for (const s of rows) {
        const id = s[partnerIdKey(kind)];
        if (id) entry(id).tiers.add(`${rateTier(s.tier).label} · ${s.mode}`);
      }
      for (const ps of routeSheetsQ.data ?? []) {
        if (ps.partner_kind !== kind) continue;
        // Same route name, or the same origin country (route or origin port).
        const same = ps.route.trim().toLowerCase() === filters.route.trim().toLowerCase();
        const byCountry =
          !same && !!originCountry && routeOrigin(ps.route, ps.origin) === originCountry;
        if (!same && !byCountry) continue;
        entry(ps.partner_id).sheets.push(
          `${ps.route} · ${ps.mode}${ps.incoterm ? ` (${ps.incoterm})` : ""}${ps.valid_until ? ` · until ${ddmmyyyy(ps.valid_until)}` : ""}`,
        );
      }
      return {
        kind,
        partners: [...byId.entries()].map(([id, v]) => ({
          id,
          name: name(partnerList[kind], id) || "Unknown partner",
          tiers: [...v.tiers],
          sheets: v.sheets,
        })),
      };
    });
    // name() reads the partner lists
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.route, originCountry, rows, routeSheetsQ.data, agents, transporters, clearingAgents, destinationAgents]);

  const sel = useRowSelection(all, rows);
  const open = (s: TariffSheet) => navigate(`/rates?sheet=${s.id}`);
  const today = new Date().toISOString().slice(0, 10);

  async function onDelete(s: TariffSheet) {
    if (!window.confirm(`Delete the ${rateTier(s.tier).label} sheet "${s.route}" (${s.mode})?`))
      return;
    try {
      await del.mutateAsync(s.id);
      toast("Tier sheet deleted");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function onBulkDelete() {
    const n = sel.count;
    if (!window.confirm(`Delete ${n} tier sheet${n === 1 ? "" : "s"}? This can't be undone.`))
      return;
    try {
      await bulkDelete.mutateAsync(sel.ids);
      sel.clear();
      toast(`Deleted ${n} tier sheet${n === 1 ? "" : "s"}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  /** Inline partner pick on a row — saves straight away; the partner's own
   *  rate sheet is linked when the tier sheet is next opened. */
  function partnerSelect(s: TariffSheet, kind: PartnerKind, list: Contact[]) {
    const idKey = partnerIdKey(kind);
    return (
      <select
        value={s[idKey] ?? ""}
        style={{ width: "100%", padding: "4px 6px" }}
        onClick={(e) => e.stopPropagation()}
        onChange={async (e) => {
          try {
            await bulkUpdate.mutateAsync({
              ids: [s.id],
              patch: { [idKey]: e.target.value || null, [sheetIdKey(kind)]: null },
            });
            toast("Saved");
          } catch (err) {
            error(err instanceof Error ? err.message : "Could not save");
          }
        }}
      >
        <option value="">—</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.company}
          </option>
        ))}
      </select>
    );
  }

  const columns = useMemo<DataColumn<TariffSheet>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 150,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (s) => (
          <RowActions
            selected={sel.isSelected(s.id)}
            onSelectToggle={() => sel.toggle(s.id)}
            onView={() => open(s)}
            onEdit={() => open(s)}
            onDelete={() => onDelete(s)}
          />
        ),
      },
      {
        key: "tier",
        header: "Tier",
        width: 110,
        sortValue: (s) => RATE_TIERS.findIndex((t) => t.id === s.tier),
        render: (s) => (
          <span>
            <TierDot tier={s.tier} />
            {rateTier(s.tier).label}
          </span>
        ),
      },
      { key: "mode", header: "Mode", width: 170, sortValue: (s) => s.mode, render: (s) => s.mode },
      {
        key: "route",
        header: "Trade Route",
        width: 200,
        sortValue: (s) => s.route,
        render: (s) => <strong>{s.route}</strong>,
      },
      {
        key: "origin",
        header: "Origin",
        width: 180,
        sortValue: (s) => s.origin ?? "",
        render: (s) => s.origin || "—",
      },
      {
        key: "destination",
        header: "Destination",
        width: 180,
        sortValue: (s) => s.destination ?? "",
        render: (s) => s.destination || "—",
      },
      {
        key: "margin",
        header: "Margin %",
        width: 100,
        sortValue: (s) => s.margin,
        render: (s) => `${s.margin}%`,
      },
      {
        key: "agent",
        header: "Agent",
        width: 180,
        sortValue: (s) => name(agents, s.agent_id),
        render: (s) => partnerSelect(s, "agent", agents),
      },
      {
        key: "transporter",
        header: "Transporter",
        width: 170,
        sortValue: (s) => name(transporters, s.transporter_id),
        render: (s) => partnerSelect(s, "transporter", transporters),
      },
      {
        key: "clearing",
        header: "Clearing Agent",
        width: 170,
        sortValue: (s) => name(clearingAgents, s.clearing_agent_id),
        render: (s) => partnerSelect(s, "clearing_agent", clearingAgents),
      },
      {
        key: "destination_agent",
        header: "Destination Agent",
        width: 170,
        sortValue: (s) => name(destinationAgents, s.destination_agent_id),
        render: (s) => partnerSelect(s, "destination_agent", destinationAgents),
      },
      {
        key: "linked",
        header: "Partner Sheets",
        label: "Partner sheets linked",
        width: 120,
        sortValue: linkedCount,
        render: (s) => `${linkedCount(s)} / 4`,
      },
      {
        key: "manual",
        header: "Own Rates",
        label: "Codes with their own (manual) rate",
        width: 100,
        sortValue: manualCount,
        render: (s) => manualCount(s) || "—",
      },
      {
        key: "valid_until",
        header: "Valid Until",
        width: 120,
        sortValue: (s) => s.valid_until ?? "",
        render: (s) =>
          s.valid_until ? (
            <span className={s.valid_until < today ? "rs-expired" : undefined}>
              {ddmmyyyy(s.valid_until)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "updated",
        header: "Updated",
        width: 110,
        sortValue: (s) => s.updated_at,
        render: (s) => ddmmyyyy(s.updated_at),
      },
      {
        key: "notes",
        header: "Notes",
        width: 220,
        defaultHidden: true,
        render: (s) => s.notes || "—",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, agents, transporters, clearingAgents, destinationAgents, today],
  );

  const partnerOptions = (list: Contact[]) =>
    list.map((c) => ({ value: c.id, label: c.company }));

  return (
    <>
      <PageTools
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search route, port, partner…"
          />
        }
        filters={
          <>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as RateTierId | "All")}
              style={{ maxWidth: 150 }}
            >
              <option value="All">All tiers</option>
              {RATE_TIERS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              style={{ maxWidth: 200 }}
            >
              <option value="All">All modes</option>
              {QUOTE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Popover label="+ Add Filter" badge={activeFilters}>
              {() => (
                <>
                  <label className="ui-pop-row">
                    <span>Trade route</span>
                    <select
                      value={filters.route}
                      onChange={(e) => setFilters({ ...filters, route: e.target.value })}
                    >
                      <option value="">Any</option>
                      {distinct(all.map((s) => s.route)).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ui-pop-row">
                    <span>Origin</span>
                    <select
                      value={filters.origin}
                      onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
                    >
                      <option value="">Any</option>
                      {distinct(all.map((s) => s.origin)).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ui-pop-row">
                    <span>Destination</span>
                    <select
                      value={filters.destination}
                      onChange={(e) => setFilters({ ...filters, destination: e.target.value })}
                    >
                      <option value="">Any</option>
                      {distinct(all.map((s) => s.destination)).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  {PARTNER_KINDS.map((k) => (
                    <label className="ui-pop-row" key={k}>
                      <span>{PARTNER_LABEL[k]}</span>
                      <select
                        value={filters[k]}
                        onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
                      >
                        <option value="">Any</option>
                        {partnerList[k].map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.company}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {activeFilters > 0 && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setFilters(NO_FILTERS)}
                    >
                      Clear filters
                    </button>
                  )}
                </>
              )}
            </Popover>
          </>
        }
        count={q.isLoading ? undefined : `${rows.length} trade route sheet${rows.length === 1 ? "" : "s"}`}
        hint="Every tier rate sheet — one per tier per mode + trade route. Open one to edit its rates."
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => navigate("/rates")}>
            Tier rate sheets
          </button>
        }
      >
        <button
          className="btn outline bulk"
          onClick={() => setBulkOpen(true)}
          disabled={sel.count === 0}
          title={sel.count === 0 ? "Tick rows in the Actions column to bulk edit" : undefined}
        >
          Bulk Edit{sel.count ? ` (${sel.count})` : ""}
        </button>
        <CanDelete>
        <button
          className="btn outline"
          onClick={onBulkDelete}
          disabled={sel.count === 0 || bulkDelete.isPending}
        >
          Delete{sel.count ? ` (${sel.count})` : ""}
        </button>
        </CanDelete>
      </PageTools>

      <div className="panel">
        {tabs}
        {filters.route && (
          <div className="route-partners">
            <div className="route-partners-head">
              <strong>
                Partners on {filters.route}
                {originCountry && (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {" "}
                    · incl. partner rate sheets from {originCountry}
                  </span>
                )}
              </strong>
              <button type="button" className="btn ghost small" onClick={() => setFilters({ ...filters, route: "" })}>
                ✕ Clear route
              </button>
            </div>
            <div className="route-partners-grid">
              {routePartners.map((g) => (
                <div key={g.kind}>
                  <div className="hint">{PARTNER_LABEL[g.kind]}s</div>
                  {g.partners.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    g.partners.map((p) => (
                      <div key={p.id} className="route-partner">
                        <strong>{p.name}</strong>
                        {p.tiers.length > 0 && <span>Tier sheets: {p.tiers.join(", ")}</span>}
                        {p.sheets.length > 0 && <span>Own rate sheet: {p.sheets.join(", ")}</span>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {all.length === 0
              ? "No trade routes yet — use Import routes on the Tier Rate Sheets page."
              : "No trade routes match these filters."}
          </EmptyState>
        ) : (
          <DataTable
            tableKey="tariff-sheets"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            onRowClick={open}
          />
        )}
      </div>

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} tier sheet${sel.count === 1 ? "" : "s"}`}
          count={sel.count}
          noun="tier sheet"
          busy={bulkUpdate.isPending}
          fields={[
            { key: "margin", label: "Tier margin %", type: "number", allowClear: false },
            { key: "valid_from", label: "Valid from", type: "date" },
            { key: "valid_until", label: "Valid until", type: "date" },
            { key: "agent_id", label: "Agent", type: "select", options: partnerOptions(agents) },
            {
              key: "transporter_id",
              label: "Transporter",
              type: "select",
              options: partnerOptions(transporters),
            },
            {
              key: "clearing_agent_id",
              label: "Clearing Agent",
              type: "select",
              options: partnerOptions(clearingAgents),
            },
            {
              key: "destination_agent_id",
              label: "Destination Agent",
              type: "select",
              options: partnerOptions(destinationAgents),
            },
          ]}
          onApply={async (raw) => {
            const patch = { ...raw } as Partial<TariffSheetDraft>;
            // A new partner needs its own rate sheet picked on each tier sheet.
            if ("agent_id" in raw) patch.agent_sheet_id = null;
            if ("transporter_id" in raw) patch.transporter_sheet_id = null;
            if ("clearing_agent_id" in raw) patch.clearing_agent_sheet_id = null;
            if ("destination_agent_id" in raw) patch.destination_agent_sheet_id = null;
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({ ids: sel.ids, patch });
              toast(`Updated ${n} tier sheet${n === 1 ? "" : "s"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not update");
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}
