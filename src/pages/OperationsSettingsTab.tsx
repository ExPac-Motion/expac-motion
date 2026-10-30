// Settings › Operations (0205): the operations workspace. Container
// vessels with their MMSI (what vessel tracking follows on AIS, 0204) and
// airlines. Lists the vessels and airlines on Motion's shipments, plus any
// added by hand; grows as the operation does.
import { useMemo, useState } from "react";
import { ErrorNote, Loading } from "../components/common";
import { useToast } from "../components/Toast";
import { useJobs } from "../lib/hooks";
import {
  useAirlines,
  useDeleteAirline,
  useDeleteVessel,
  useSaveAirline,
  useSaveVessel,
  useVessels,
  type AirlineInput,
  type VesselInput,
} from "../lib/operations";
import { vesselSearchUrl } from "../lib/tracking";

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export default function OperationsSettingsTab() {
  const [section, setSection] = useState<"vessels" | "airlines">("vessels");
  return (
    <div className="ops-ws">
      <p className="muted" style={{ marginTop: 0 }}>
        The operations workspace: reference lists the shipments and tracking draw on. Vessels and airlines on Motion's
        shipments are listed automatically; add others as they come up.
      </p>
      <div className="ops-ws-tabs">
        <button className={`subnav-tab${section === "vessels" ? " active" : ""}`} onClick={() => setSection("vessels")}>
          Container vessels
        </button>
        <button className={`subnav-tab${section === "airlines" ? " active" : ""}`} onClick={() => setSection("airlines")}>
          Airlines
        </button>
      </div>
      {section === "vessels" ? <VesselsSection /> : <AirlinesSection />}
    </div>
  );
}

/* ---------- Vessels ---------- */
type VesselRow = { id?: string; values: VesselInput; shipments: number };

function VesselsSection() {
  const vesselsQ = useVessels();
  const jobsQ = useJobs();
  const [missingOnly, setMissingOnly] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo<VesselRow[]>(() => {
    const active = (jobsQ.data ?? []).filter((j) => (j.mode ?? "").startsWith("Sea") && !j.ops_completed_at);
    const count = new Map<string, number>();
    const lineOf = new Map<string, string>();
    for (const j of active) {
      const k = key(j.vessel_name);
      if (!k) continue;
      count.set(k, (count.get(k) ?? 0) + 1);
      if (j.shipping_line && !lineOf.has(k)) lineOf.set(k, j.shipping_line);
    }
    const out: VesselRow[] = (vesselsQ.data ?? []).map((v) => ({
      id: v.id,
      values: { name: v.name, mmsi: v.mmsi, imo: v.imo, shipping_line: v.shipping_line, notes: v.notes },
      shipments: count.get(key(v.name)) ?? 0,
    }));
    const listed = new Set(out.map((r) => key(r.values.name)));
    // Vessels on shipments not listed yet: shown to be completed.
    for (const j of active) {
      const k = key(j.vessel_name);
      if (!k || listed.has(k)) continue;
      listed.add(k);
      out.push({
        values: { name: (j.vessel_name ?? "").trim(), mmsi: null, imo: null, shipping_line: lineOf.get(k) ?? null, notes: null },
        shipments: count.get(k) ?? 0,
      });
    }
    const term = key(q);
    return out
      .filter((r) => !missingOnly || !r.values.mmsi)
      .filter((r) => !term || [r.values.name, r.values.shipping_line, r.values.mmsi, r.values.imo].some((v) => key(v).includes(term)))
      .sort((a, b) => b.shipments - a.shipments || a.values.name.localeCompare(b.values.name));
  }, [vesselsQ.data, jobsQ.data, missingOnly, q]);

  if (vesselsQ.isLoading || jobsQ.isLoading) return <Loading />;
  if (vesselsQ.isError) return <ErrorNote error={vesselsQ.error} />;
  const missing = rows.filter((r) => !r.values.mmsi && r.shipments > 0).length;

  return (
    <>
      <div className="ops-ws-tools">
        <input placeholder="Search vessel, line, MMSI or IMO" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="ops-ws-check">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Missing MMSI only
        </label>
        <span className="hint grow">
          {missing > 0 ? `${missing} vessel${missing === 1 ? "" : "s"} on active shipments without an MMSI` : "Every vessel on an active shipment has its MMSI ✓"}
        </span>
        <button className="btn small" onClick={() => setAdding(true)} disabled={adding}>
          + Add vessel
        </button>
      </div>
      <p className="hint">
        The MMSI (9 digits) is what live vessel tracking follows. Saving one fills it in on every active shipment on that
        ship. Find it on VesselFinder (the 🔎 link searches the vessel name).
      </p>
      <div className="table-wrap">
        <table className="ops-ws-table">
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Vessel</th>
              <th style={{ width: "16%" }}>Shipping line</th>
              <th style={{ width: "13%" }}>MMSI</th>
              <th style={{ width: "11%" }}>IMO</th>
              <th>Notes</th>
              <th style={{ width: 80 }}>Active shipments</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <VesselEditRow
                row={{ values: { name: "", mmsi: null, imo: null, shipping_line: null, notes: null }, shipments: 0 }}
                onDone={() => setAdding(false)}
              />
            )}
            {rows.map((r) => (
              <VesselEditRow key={r.id ?? `new:${r.values.name}`} row={r} />
            ))}
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={7} className="muted">
                  No vessels {missingOnly ? "missing an MMSI" : "yet"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VesselEditRow({ row, onDone }: { row: VesselRow; onDone?: () => void }) {
  const { toast, error } = useToast();
  const save = useSaveVessel();
  const del = useDeleteVessel();
  const [v, setV] = useState<VesselInput>(row.values);
  const set = (k: keyof VesselInput, val: string) => setV((x) => ({ ...x, [k]: val }));
  const dirty = !row.id || (Object.keys(v) as (keyof VesselInput)[]).some((k) => (v[k] ?? "") !== (row.values[k] ?? ""));
  const mmsiBad = !!v.mmsi && !/^\d{9}$/.test(v.mmsi);

  function onSave() {
    save.mutate(
      { id: row.id, values: v },
      {
        onSuccess: () => {
          toast(v.mmsi ? `${v.name} saved, its shipments are tracked from the next check` : `${v.name} saved`);
          onDone?.();
        },
        onError: (e) => error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }
  function onDelete() {
    if (!row.id || !window.confirm(`Remove ${row.values.name} from the list? Shipments keep their MMSI.`)) return;
    del.mutate(row.id, { onError: (e) => error(e instanceof Error ? e.message : "Could not delete") });
  }

  return (
    <tr className={!row.id ? "ops-ws-unlisted" : undefined}>
      <td>
        <input value={v.name} placeholder="Vessel name" onChange={(e) => set("name", e.target.value)} />
      </td>
      <td>
        <input value={v.shipping_line ?? ""} onChange={(e) => set("shipping_line", e.target.value)} />
      </td>
      <td>
        <input
          inputMode="numeric"
          className={mmsiBad ? "ops-ws-bad" : !v.mmsi ? "ops-ws-need" : undefined}
          value={v.mmsi ?? ""}
          placeholder="9 digits"
          onChange={(e) => set("mmsi", e.target.value.replace(/\D/g, "").slice(0, 9))}
        />
      </td>
      <td>
        <input value={v.imo ?? ""} onChange={(e) => set("imo", e.target.value.replace(/\D/g, "").slice(0, 7))} />
      </td>
      <td>
        <input value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </td>
      <td className="num">{row.shipments || "—"}</td>
      <td className="ops-ws-actions">
        <a
          className="btn ghost small"
          href={v.imo ? `https://www.vesselfinder.com/vessels/details/${v.imo}` : vesselSearchUrl(v.name)}
          target="_blank"
          rel="noreferrer"
          title="Find on VesselFinder"
        >
          🔎
        </a>
        {dirty && (
          <button className="btn small" onClick={onSave} disabled={save.isPending || mmsiBad || !v.name.trim()}>
            {row.id ? "Save" : "Add"}
          </button>
        )}
        {onDone && (
          <button className="btn ghost small" onClick={onDone}>
            ✕
          </button>
        )}
        {row.id && !dirty && (
          <button className="btn ghost small" onClick={onDelete} title="Remove from the list">
            🗑
          </button>
        )}
      </td>
    </tr>
  );
}

/* ---------- Airlines ---------- */
type AirlineRow = { id?: string; values: AirlineInput; shipments: number };

function AirlinesSection() {
  const airlinesQ = useAirlines();
  const jobsQ = useJobs();
  const [adding, setAdding] = useState(false);

  const rows = useMemo<AirlineRow[]>(() => {
    const air = (jobsQ.data ?? []).filter(
      (j) => ((j.mode ?? "").startsWith("Air") || (j.mode ?? "").startsWith("Courier")) && !j.ops_completed_at,
    );
    const count = new Map<string, number>();
    for (const j of air) {
      const k = key(j.carrier_name);
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
    const out: AirlineRow[] = (airlinesQ.data ?? []).map((a) => ({
      id: a.id,
      values: { name: a.name, iata: a.iata, awb_prefix: a.awb_prefix, notes: a.notes },
      shipments: count.get(key(a.name)) ?? 0,
    }));
    const listed = new Set(out.map((r) => key(r.values.name)));
    for (const j of air) {
      const k = key(j.carrier_name);
      if (!k || listed.has(k)) continue;
      listed.add(k);
      out.push({ values: { name: (j.carrier_name ?? "").trim(), iata: null, awb_prefix: null, notes: null }, shipments: count.get(k) ?? 0 });
    }
    return out.sort((a, b) => b.shipments - a.shipments || a.values.name.localeCompare(b.values.name));
  }, [airlinesQ.data, jobsQ.data]);

  if (airlinesQ.isLoading || jobsQ.isLoading) return <Loading />;
  if (airlinesQ.isError) return <ErrorNote error={airlinesQ.error} />;

  return (
    <>
      <div className="ops-ws-tools">
        <span className="hint grow">Airlines on active air / courier shipments are listed automatically.</span>
        <button className="btn small" onClick={() => setAdding(true)} disabled={adding}>
          + Add airline
        </button>
      </div>
      <div className="table-wrap">
        <table className="ops-ws-table">
          <thead>
            <tr>
              <th style={{ width: "28%" }}>Airline</th>
              <th style={{ width: "10%" }}>IATA code</th>
              <th style={{ width: "12%" }}>AWB prefix</th>
              <th>Notes</th>
              <th style={{ width: 80 }}>Active shipments</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <AirlineEditRow
                row={{ values: { name: "", iata: null, awb_prefix: null, notes: null }, shipments: 0 }}
                onDone={() => setAdding(false)}
              />
            )}
            {rows.map((r) => (
              <AirlineEditRow key={r.id ?? `new:${r.values.name}`} row={r} />
            ))}
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={6} className="muted">
                  No airlines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AirlineEditRow({ row, onDone }: { row: AirlineRow; onDone?: () => void }) {
  const { toast, error } = useToast();
  const save = useSaveAirline();
  const del = useDeleteAirline();
  const [v, setV] = useState<AirlineInput>(row.values);
  const set = (k: keyof AirlineInput, val: string) => setV((x) => ({ ...x, [k]: val }));
  const dirty = !row.id || (Object.keys(v) as (keyof AirlineInput)[]).some((k) => (v[k] ?? "") !== (row.values[k] ?? ""));

  function onSave() {
    save.mutate(
      { id: row.id, values: v },
      {
        onSuccess: () => {
          toast(`${v.name} saved`);
          onDone?.();
        },
        onError: (e) => error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }
  function onDelete() {
    if (!row.id || !window.confirm(`Remove ${row.values.name} from the list?`)) return;
    del.mutate(row.id, { onError: (e) => error(e instanceof Error ? e.message : "Could not delete") });
  }

  return (
    <tr className={!row.id ? "ops-ws-unlisted" : undefined}>
      <td>
        <input value={v.name} placeholder="Airline name" onChange={(e) => set("name", e.target.value)} />
      </td>
      <td>
        <input value={v.iata ?? ""} placeholder="e.g. EK" onChange={(e) => set("iata", e.target.value.slice(0, 3))} />
      </td>
      <td>
        <input
          inputMode="numeric"
          value={v.awb_prefix ?? ""}
          placeholder="e.g. 176"
          onChange={(e) => set("awb_prefix", e.target.value.replace(/\D/g, "").slice(0, 3))}
        />
      </td>
      <td>
        <input value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </td>
      <td className="num">{row.shipments || "—"}</td>
      <td className="ops-ws-actions">
        {dirty && (
          <button className="btn small" onClick={onSave} disabled={save.isPending || !v.name.trim()}>
            {row.id ? "Save" : "Add"}
          </button>
        )}
        {onDone && (
          <button className="btn ghost small" onClick={onDone}>
            ✕
          </button>
        )}
        {row.id && !dirty && (
          <button className="btn ghost small" onClick={onDelete} title="Remove from the list">
            🗑
          </button>
        )}
      </td>
    </tr>
  );
}
