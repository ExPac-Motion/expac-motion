import { useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, Loading, PageTools, RowActions, RowActionsHead } from "../../components/common";
import { useToast } from "../../components/Toast";
import { money } from "../../lib/format";
import {
  BASIS_LABEL,
  LOCATION_KIND_LABEL,
  PERIOD_LABEL,
  locationLabel,
  qty,
  useWmsMutation,
  useWmsReceipts,
  useWmsMoves,
  wmsDb,
  stockByLocation,
  share,
  type LocationKind,
  type StorageBasis,
  type StoragePeriod,
  type WmsLocation,
  type WmsWarehouse,
} from "../../lib/wms";
import { useWmsLookups } from "./shared";

type ZoneRow = { key: string; warehouse_id: string; zone: string | null; bays: WmsLocation[] };
export type WmsSettingsView = "warehouses" | "zones" | "bays";

/** WMS > Settings: warehouses (with storage billing rates) and their zones / bays.
 *  Also Settings › Motion WMS, one `view` at a time (`embedded`: buttons sit
 *  in the section, not in the page header band). */
export default function WmsSettings({ view, embedded = false }: { view?: WmsSettingsView; embedded?: boolean } = {}) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const [editWh, setEditWh] = useState<WmsWarehouse | "new" | null>(null);
  const [editLoc, setEditLoc] = useState<WmsLocation | "new" | null>(null);
  const [whFilter, setWhFilter] = useState("");
  const saveWh = useWmsMutation((v: { id?: string; values: Parameters<typeof wmsDb.saveWarehouse>[1] }) =>
    wmsDb.saveWarehouse(v.id, v.values),
  );
  const delWh = useWmsMutation(wmsDb.deleteWarehouse);
  const saveLoc = useWmsMutation((v: { id?: string; values: Parameters<typeof wmsDb.saveLocation>[1] }) =>
    wmsDb.saveLocation(v.id, v.values),
  );
  const delLoc = useWmsMutation(wmsDb.deleteLocation);
  const renameZone = useWmsMutation(wmsDb.renameZone);
  const [editZone, setEditZone] = useState<ZoneRow | "new" | null>(null);

  // CBM on hand per bay, for the utilisation column.
  const cbmByLoc = new Map<string, number>();
  const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
  for (const s of stockByLocation(movesQ.data ?? [])) {
    const r = recById.get(s.receipt_id);
    if (!r || !s.location_id) continue;
    cbmByLoc.set(s.location_id, (cbmByLoc.get(s.location_id) ?? 0) + share(r, s.on_hand).cbm);
  }

  const whCols: DataColumn<WmsWarehouse>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (w) => (
        <RowActions
          onEdit={() => setEditWh(w)}
          onDelete={() => {
            if (!confirm(`Delete warehouse ${w.code}? Its bays go too. Receipts must be removed first.`)) return;
            delWh.mutate(w.id, { onError: (e) => error(e.message), onSuccess: () => toast("Warehouse deleted") });
          }}
        />
      ),
    },
    { key: "code", header: "Code", width: 90, render: (w) => <b>{w.code}</b>, sortValue: (w) => w.code },
    { key: "name", header: "Name", width: 220, render: (w) => w.name, sortValue: (w) => w.name },
    {
      key: "match",
      header: "Hub for",
      width: 160,
      render: (w) => (w.match_codes?.length ? `${w.match_side === "destination" ? "To" : "From"} ${w.match_codes.slice(0, 4).join(", ")}${w.match_codes.length > 4 ? " …" : ""}` : "—"),
    },
    {
      key: "bays",
      header: "Bays",
      width: 80,
      render: (w) => lk.locations.filter((l) => l.warehouse_id === w.id).length,
    },
    {
      key: "storage",
      header: "Storage rate",
      width: 200,
      render: (w) => `${money(w.storage_rate)} / ${BASIS_LABEL[w.storage_basis]} / ${PERIOD_LABEL[w.storage_period]}`,
    },
    { key: "free", header: "Free days", width: 90, render: (w) => w.free_days },
    { key: "min", header: "Minimum", width: 110, render: (w) => money(w.min_charge) },
    { key: "hin", header: "Handling in / CBM", width: 140, render: (w) => money(w.handling_in_rate) },
    { key: "hout", header: "Handling out / CBM", width: 140, render: (w) => money(w.handling_out_rate) },
    { key: "active", header: "Status", width: 90, render: (w) => (w.active ? "Active" : "Inactive") },
  ];

  const locRows = lk.locations.filter((l) => !whFilter || l.warehouse_id === whFilter);
  const locCols: DataColumn<WmsLocation>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (l) => (
        <RowActions
          onEdit={() => setEditLoc(l)}
          onDelete={() => {
            if (!confirm(`Delete bay ${locationLabel(l)}?`)) return;
            delLoc.mutate(l.id, { onError: (e) => error(e.message), onSuccess: () => toast("Bay deleted") });
          }}
        />
      ),
    },
    { key: "wh", header: "Warehouse", width: 100, render: (l) => lk.whCode(l.warehouse_id), sortValue: (l) => lk.whCode(l.warehouse_id) },
    { key: "zone", header: "Zone", width: 100, render: (l) => l.zone || "—", sortValue: (l) => l.zone ?? "" },
    { key: "code", header: "Bay / area", width: 110, render: (l) => <b>{l.code}</b>, sortValue: (l) => l.code },
    { key: "name", header: "Description", width: 200, render: (l) => l.name || "—" },
    { key: "kind", header: "Type", width: 130, render: (l) => LOCATION_KIND_LABEL[l.kind] },
    {
      key: "cap",
      header: "Capacity (CBM)",
      width: 120,
      render: (l) => (l.capacity_cbm != null ? qty(l.capacity_cbm) : "—"),
    },
    {
      key: "used",
      header: "In use",
      width: 150,
      render: (l) => {
        const used = cbmByLoc.get(l.id) ?? 0;
        if (!l.capacity_cbm) return used ? `${qty(used)} CBM` : "—";
        const pct = Math.round((used / Number(l.capacity_cbm)) * 100);
        return (
          <span className={pct >= 90 ? "wms-warn" : undefined}>
            {qty(used)} CBM ({pct}%)
          </span>
        );
      },
    },
    { key: "active", header: "Status", width: 90, render: (l) => (l.active ? "Active" : "Inactive") },
  ];

  // Zones: grouped from the bays (a zone is the `zone` on its bays).
  const zoneMap = new Map<string, ZoneRow>();
  for (const l of lk.locations) {
    if (whFilter && l.warehouse_id !== whFilter) continue;
    const k = `${l.warehouse_id}|${l.zone ?? ""}`;
    const z = zoneMap.get(k) ?? { key: k, warehouse_id: l.warehouse_id, zone: l.zone, bays: [] };
    z.bays.push(l);
    zoneMap.set(k, z);
  }
  const zoneRows = [...zoneMap.values()].sort(
    (a, b) => lk.whCode(a.warehouse_id).localeCompare(lk.whCode(b.warehouse_id)) || (a.zone ?? "~").localeCompare(b.zone ?? "~"),
  );
  const zoneCols: DataColumn<ZoneRow>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (z) => <RowActions onEdit={() => setEditZone(z)} />,
    },
    { key: "wh", header: "Warehouse", width: 110, render: (z) => lk.whCode(z.warehouse_id), sortValue: (z) => lk.whCode(z.warehouse_id) },
    { key: "zone", header: "Zone", width: 110, render: (z) => (z.zone ? <b>{z.zone}</b> : <span className="muted">No zone</span>), sortValue: (z) => z.zone ?? "" },
    { key: "bays", header: "Bays / areas", width: 110, render: (z) => z.bays.length, sortValue: (z) => z.bays.length },
    {
      key: "codes",
      header: "Codes",
      width: 260,
      render: (z) => {
        const c = z.bays.map((b) => b.code).sort();
        return c.slice(0, 8).join(", ") + (c.length > 8 ? " …" : "");
      },
    },
    {
      key: "cap",
      header: "Capacity (CBM)",
      width: 130,
      render: (z) => {
        const cap = z.bays.reduce((n, b) => n + Number(b.capacity_cbm ?? 0), 0);
        return cap ? qty(cap) : "—";
      },
    },
    {
      key: "used",
      header: "In use",
      width: 150,
      render: (z) => {
        const used = z.bays.reduce((n, b) => n + (cbmByLoc.get(b.id) ?? 0), 0);
        const cap = z.bays.reduce((n, b) => n + Number(b.capacity_cbm ?? 0), 0);
        if (!cap) return used ? `${qty(used)} CBM` : "—";
        const pct = Math.round((used / cap) * 100);
        return <span className={pct >= 90 ? "wms-warn" : undefined}>{qty(used)} CBM ({pct}%)</span>;
      },
    },
    { key: "active", header: "Active bays", width: 110, render: (z) => `${z.bays.filter((b) => b.active).length} of ${z.bays.length}` },
  ];

  function submitZone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const to = s("zone").toUpperCase() || null;
    if (editZone && editZone !== "new") {
      if ((editZone.zone ?? null) === to) return setEditZone(null);
      renameZone.mutate(
        { warehouse_id: editZone.warehouse_id, from: editZone.zone, to },
        {
          onSuccess: () => {
            toast(`Zone saved, ${editZone.bays.length} bay${editZone.bays.length === 1 ? "" : "s"} updated`);
            setEditZone(null);
          },
          onError: (e) => error(e.message),
        },
      );
      return;
    }
    // A new zone starts with its first bay / area.
    const values = {
      warehouse_id: s("warehouse_id"),
      zone: to,
      code: s("code").toUpperCase(),
      name: s("name") || null,
      kind: s("kind") as LocationKind,
      capacity_cbm: s("capacity_cbm") === "" ? null : Number(s("capacity_cbm")),
      active: true,
      notes: null,
    };
    if (!values.warehouse_id || !to || !values.code) return error("Warehouse, zone and first bay code are required");
    saveLoc.mutate(
      { values },
      {
        onSuccess: () => {
          toast("Zone added");
          setEditZone(null);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  function submitWh(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const values = {
      code: s("code").toUpperCase(),
      name: s("name"),
      address: s("address") || null,
      active: f.get("active") === "on",
      storage_basis: s("storage_basis") as StorageBasis,
      storage_period: s("storage_period") as StoragePeriod,
      storage_rate: Number(s("storage_rate")) || 0,
      free_days: Number(s("free_days")) || 0,
      min_charge: Number(s("min_charge")) || 0,
      handling_in_rate: Number(s("handling_in_rate")) || 0,
      handling_out_rate: Number(s("handling_out_rate")) || 0,
      notes: s("notes") || null,
      // Hub matching (0213); sent only once the columns exist (after 0213).
      ...(wh?.match_codes !== undefined || s("match_codes")
        ? {
            match_codes: s("match_codes")
              .toUpperCase()
              .split(/[\s,;]+/)
              .filter((c) => /^[A-Z]{2}([A-Z0-9]{3})?$/.test(c)),
            match_side: s("match_side") === "destination" ? ("destination" as const) : ("origin" as const),
          }
        : {}),
    };
    if (!values.code || !values.name) return error("Code and name are required");
    saveWh.mutate(
      { id: editWh && editWh !== "new" ? editWh.id : undefined, values },
      {
        onSuccess: () => {
          toast("Warehouse saved");
          setEditWh(null);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  function submitLoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const values = {
      warehouse_id: s("warehouse_id"),
      zone: s("zone").toUpperCase() || null,
      code: s("code").toUpperCase(),
      name: s("name") || null,
      kind: s("kind") as LocationKind,
      capacity_cbm: s("capacity_cbm") === "" ? null : Number(s("capacity_cbm")),
      active: f.get("active") === "on",
      notes: s("notes") || null,
    };
    if (!values.warehouse_id || !values.code) return error("Warehouse and bay code are required");
    saveLoc.mutate(
      { id: editLoc && editLoc !== "new" ? editLoc.id : undefined, values },
      {
        onSuccess: () => {
          toast("Bay saved");
          setEditLoc(null);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  const wh = editWh && editWh !== "new" ? editWh : null;
  const loc = editLoc && editLoc !== "new" ? editLoc : null;
  const zones = [...new Set(lk.locations.map((l) => l.zone).filter(Boolean))] as string[];

  const whPick = (
    <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} style={{ width: "auto" }}>
      <option value="">All warehouses</option>
      {lk.warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.code}, {w.name}
        </option>
      ))}
    </select>
  );
  const whTable =
    lk.warehouses.length === 0 ? (
      <EmptyState>No warehouses yet.</EmptyState>
    ) : (
      <DataTable tableKey="wms-warehouses" className="table--compact" columns={whCols} rows={lk.warehouses} rowKey={(w) => w.id} onRowClick={(w) => setEditWh(w)} />
    );
  const locTable =
    locRows.length === 0 ? (
      <EmptyState>No bays yet, add the zones and bays goods are stored in.</EmptyState>
    ) : (
      <DataTable tableKey="wms-locations" className="table--compact" columns={locCols} rows={locRows} rowKey={(l) => l.id} onRowClick={(l) => setEditLoc(l)} />
    );
  const noWh = lk.warehouses.length === 0;

  const zoneModal = editZone !== null && (
    <Modal
      title={editZone !== "new" ? `Edit zone ${editZone.zone ?? "(no zone)"}, ${lk.whCode(editZone.warehouse_id)}` : "Add zone"}
      onClose={() => setEditZone(null)}
    >
      <form onSubmit={submitZone}>
        {editZone !== "new" ? (
          <>
            <div className="field">
              <label>Zone</label>
              <input name="zone" defaultValue={editZone.zone ?? ""} placeholder="A" autoFocus />
              <span className="hint">
                Renames the zone on its {editZone.bays.length} bay{editZone.bays.length === 1 ? "" : "s"} /
                area{editZone.bays.length === 1 ? "" : "s"}. Leave blank to take them out of a zone.
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="grid2">
              <div className="field">
                <label>Warehouse</label>
                <select name="warehouse_id" defaultValue={whFilter || lk.warehouses[0]?.id}>
                  {lk.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code}, {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Zone</label>
                <input name="zone" placeholder="A" autoFocus />
              </div>
            </div>
            <h4 className="wms-subhead">First bay / area</h4>
            <div className="grid2">
              <div className="field">
                <label>Bay / area code</label>
                <input name="code" placeholder="B01" />
              </div>
              <div className="field">
                <label>Type</label>
                <select name="kind" defaultValue="bay">
                  {Object.entries(LOCATION_KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Description</label>
                <input name="name" placeholder="Racking row 1, ground level" />
              </div>
              <div className="field">
                <label>Capacity (CBM)</label>
                <input name="capacity_cbm" type="number" step="0.001" />
              </div>
            </div>
          </>
        )}
        <div className="modal-foot-row">
          <button type="button" className="btn outline" onClick={() => setEditZone(null)}>
            Cancel
          </button>
          <button className="btn" disabled={renameZone.isPending || saveLoc.isPending}>
            {renameZone.isPending || saveLoc.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );

  const modals = () => (
    <>
      {editWh !== null && (
        <Modal title={wh ? `Edit warehouse ${wh.code}` : "Add warehouse"} onClose={() => setEditWh(null)} wide>
          <form onSubmit={submitWh}>
            <div className="grid3">
              <div className="field">
                <label>Code</label>
                <input name="code" defaultValue={wh?.code ?? ""} placeholder="JNB" autoFocus />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Name</label>
                <input name="name" defaultValue={wh?.name ?? ""} placeholder="Johannesburg Warehouse" />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <textarea name="address" rows={2} defaultValue={wh?.address ?? ""} />
            </div>
            <h4 className="wms-subhead">Storage billing</h4>
            <div className="grid4">
              <div className="field">
                <label>Rate (R)</label>
                <input name="storage_rate" type="number" step="0.01" defaultValue={wh?.storage_rate ?? 0} />
              </div>
              <div className="field">
                <label>Per</label>
                <select name="storage_basis" defaultValue={wh?.storage_basis ?? "cbm"}>
                  {Object.entries(BASIS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Per period</label>
                <select name="storage_period" defaultValue={wh?.storage_period ?? "week"}>
                  {Object.entries(PERIOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Free days</label>
                <input name="free_days" type="number" min={0} defaultValue={wh?.free_days ?? 7} />
              </div>
            </div>
            <div className="grid3">
              <div className="field">
                <label>Minimum storage per receipt (R)</label>
                <input name="min_charge" type="number" step="0.01" defaultValue={wh?.min_charge ?? 0} />
              </div>
              <div className="field">
                <label>Handling in per CBM (R)</label>
                <input name="handling_in_rate" type="number" step="0.01" defaultValue={wh?.handling_in_rate ?? 0} />
              </div>
              <div className="field">
                <label>Handling out per CBM (R)</label>
                <input name="handling_out_rate" type="number" step="0.01" defaultValue={wh?.handling_out_rate ?? 0} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Hub for shipments by</label>
                <select name="match_side" defaultValue={wh?.match_side ?? "origin"}>
                  <option value="origin">Origin (overseas hub)</option>
                  <option value="destination">Destination (import hub)</option>
                </select>
              </div>
              <div className="field">
                <label>Match codes</label>
                <input name="match_codes" defaultValue={(wh?.match_codes ?? []).join(", ")} placeholder="CN or ZADUR, ZACPT" />
                <span className="hint">Countries (CN, HK, GB) or ports (ZADUR). A port beats a country.</span>
              </div>
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea name="notes" rows={2} defaultValue={wh?.notes ?? ""} />
            </div>
            <label className="check">
              <input type="checkbox" name="active" defaultChecked={wh?.active ?? true} /> Active
            </label>
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setEditWh(null)}>
                Cancel
              </button>
              <button className="btn" disabled={saveWh.isPending}>
                {saveWh.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editLoc !== null && (
        <Modal title={loc ? `Edit bay ${locationLabel(loc)}` : "Add bay"} onClose={() => setEditLoc(null)}>
          <form onSubmit={submitLoc}>
            <div className="field">
              <label>Warehouse</label>
              <select name="warehouse_id" defaultValue={loc?.warehouse_id ?? whFilter ?? lk.warehouses[0]?.id}>
                {lk.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}, {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Zone</label>
                <input name="zone" list="wms-zones" defaultValue={loc?.zone ?? ""} placeholder="A" />
                <datalist id="wms-zones">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>Bay / area code</label>
                <input name="code" defaultValue={loc?.code ?? ""} placeholder="B01" autoFocus />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input name="name" defaultValue={loc?.name ?? ""} placeholder="Racking row 1, ground level" />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Type</label>
                <select name="kind" defaultValue={loc?.kind ?? "bay"}>
                  {Object.entries(LOCATION_KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Capacity (CBM)</label>
                <input name="capacity_cbm" type="number" step="0.001" defaultValue={loc?.capacity_cbm ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea name="notes" rows={2} defaultValue={loc?.notes ?? ""} />
            </div>
            <label className="check">
              <input type="checkbox" name="active" defaultChecked={loc?.active ?? true} /> Active
            </label>
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setEditLoc(null)}>
                Cancel
              </button>
              <button className="btn" disabled={saveLoc.isPending}>
                {saveLoc.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );

  if (embedded) {
    const copy: Record<WmsSettingsView, string> = {
      warehouses: "Each warehouse carries its storage billing rates and the shipments it is the hub for.",
      zones: "Zones group the bays and areas inside a warehouse. Rename a zone here and every bay in it follows.",
      bays: "Where stock sits: Warehouse › Zone › Bay / area. Bonded, cold, DG, quarantine, yard and dock areas are bays of that type.",
    };
    const v = view ?? "warehouses";
    return (
      <div className="ops-ws">
        <p className="muted" style={{ marginTop: 0 }}>
          {copy[v]}
        </p>
        <div className="ops-ws-tools">
          {v !== "warehouses" && whPick}
          <span className="grow" />
          {v === "warehouses" && (
            <button className="btn" onClick={() => setEditWh("new")}>
              + Add warehouse
            </button>
          )}
          {v === "zones" && (
            <button className="btn" onClick={() => setEditZone("new")} disabled={noWh}>
              + Add zone
            </button>
          )}
          {v === "bays" && (
            <button className="btn" onClick={() => setEditLoc("new")} disabled={noWh}>
              + Add bay / area
            </button>
          )}
        </div>
        {lk.loading ? (
          <Loading />
        ) : v === "warehouses" ? (
          whTable
        ) : v === "zones" ? (
          zoneRows.length === 0 ? (
            <EmptyState>No zones yet, add one with its first bay.</EmptyState>
          ) : (
            <DataTable tableKey="wms-zones" className="table--compact" columns={zoneCols} rows={zoneRows} rowKey={(z) => z.key} onRowClick={(z) => setEditZone(z)} />
          )
        ) : (
          locTable
        )}
        {modals()}
        {zoneModal}
      </div>
    );
  }

  return (
    <>
      <PageTools
        hint="Warehouses carry their storage billing rates; each warehouse is split into zones and bays / areas."
        primary={
          <button className="btn" onClick={() => setEditLoc("new")} disabled={lk.warehouses.length === 0}>
            + Add bay
          </button>
        }
      >
        <button className="btn outline" onClick={() => setEditWh("new")}>
          + Add warehouse
        </button>
      </PageTools>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Warehouses</h2>
            <p>Storage is billed per {`CBM (W/M), pallet or kg`} per day / week / month after the free days.</p>
          </div>
        </div>
        {lk.loading ? (
          <Loading />
        ) : lk.warehouses.length === 0 ? (
          <EmptyState>No warehouses yet.</EmptyState>
        ) : (
          <DataTable tableKey="wms-warehouses" className="table--compact" columns={whCols} rows={lk.warehouses} rowKey={(w) => w.id} onRowClick={(w) => setEditWh(w)} />
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Zones &amp; bays</h2>
            <p>Where stock sits: Warehouse › Zone › Bay / area.</p>
          </div>
          <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">All warehouses</option>
            {lk.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}, {w.name}
              </option>
            ))}
          </select>
        </div>
        {locRows.length === 0 ? (
          <EmptyState>No bays yet, add the zones and bays goods are stored in.</EmptyState>
        ) : (
          <DataTable tableKey="wms-locations" className="table--compact" columns={locCols} rows={locRows} rowKey={(l) => l.id} onRowClick={(l) => setEditLoc(l)} />
        )}
      </div>

      {modals()}
    </>
  );
}
