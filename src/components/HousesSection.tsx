// Shipment view › Houses (0164): a master shipment's houses, one per
// supplier (SEA160984-1, -2 ...), with specs, house bill no and totals
// checked against the quote.
import { useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { useCustomerShippers } from "../lib/customers";
import { useQuote } from "../lib/hooks";
import { packingTotals, volumetricFactor } from "../lib/calc";
import { houseTotals, useDeleteJobHouse, useJobHouses, useSaveJobHouse, type JobHouse, type JobHouseInput } from "../lib/houses";
import type { Job } from "../lib/types";

type Row = JobHouseInput & { id?: string; house_no?: string; position: number; dirty?: boolean };

const blank = (position: number): Row => ({
  position,
  supplier_id: null,
  pieces: 0,
  gross_kg: 0,
  volume_cbm: 0,
  commodity: null,
  commercial_value: null,
  value_currency: "USD",
  carrier_house_no: null,
  notes: null,
  dirty: true,
});
const fromHouse = (h: JobHouse): Row => ({ ...h });
const n = (v: string) => (v === "" ? 0 : Number(v));
const fmt = (v: number, dp: number) => v.toLocaleString("en-ZA", { maximumFractionDigits: dp });

export default function HousesSection({ job }: { job: Job }) {
  const { toast, error } = useToast();
  const housesQ = useJobHouses(job.id);
  const shippersQ = useCustomerShippers(job.client_id ?? undefined);
  const quoteQ = useQuote(job.quote_id ?? undefined);
  const save = useSaveJobHouse();
  const del = useDeleteJobHouse();
  const [rows, setRows] = useState<Row[]>([]);
  const air = job.mode.startsWith("Air") || job.mode.startsWith("Courier");
  const bill = air ? "HAWB" : "HBL";

  useEffect(() => {
    if (housesQ.data) setRows(housesQ.data.map(fromHouse));
  }, [housesQ.data]);

  const quoted = useMemo(() => {
    const items = quoteQ.data?.packing_list_items ?? [];
    return items.length ? packingTotals(items, volumetricFactor(job.mode)) : null;
  }, [quoteQ.data, job.mode]);
  const tot = houseTotals(rows);
  const dirty = rows.some((r) => r.dirty);
  const nextPos = Math.max(0, ...rows.map((r) => r.position)) + 1;

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, dirty: true } : r)));

  async function onSave() {
    try {
      for (const r of rows.filter((x) => x.dirty)) {
        const { id, position, house_no: _no, dirty: _d, ...input } = r;
        void _no;
        void _d;
        await save.mutateAsync({ jobId: job.id, id, position, input });
      }
      toast("Houses saved");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save the houses");
    }
  }
  function onRemove(i: number) {
    const r = rows[i];
    if (!r.id) return setRows((rs) => rs.filter((_, j) => j !== i));
    if (!window.confirm(`Remove ${r.house_no}? Its documents stay on the shipment (as master documents).`)) return;
    del.mutate({ id: r.id, jobId: job.id }, { onSuccess: () => toast("House removed"), onError: (e) => error(e.message) });
  }

  const shippers = shippersQ.data ?? [];
  const off = (a: number, b: number | undefined) => b != null && b > 0 && Math.abs(a - b) > 0.005;

  return (
    <div className="houses-sec">
      <div className="houses-head">
        <strong>Houses ({bill})</strong>
        <span className="hint">
          {rows.length === 0
            ? `One ${bill} per supplier on this master, numbered ${job.reference}-1, -2 ...`
            : `${rows.length} house${rows.length === 1 ? "" : "s"} on ${job.reference}`}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {(housesQ.data ?? []).length > 0 && (
            <>
              <a className="btn outline btn-sm" href={`/jobs/${job.id}/houses/print/house`} target="_blank" rel="noopener">
                Print {bill}s
              </a>
              <a className="btn outline btn-sm" href={`/jobs/${job.id}/houses/print/manifest`} target="_blank" rel="noopener">
                Print manifest
              </a>
            </>
          )}
          <button type="button" className="btn outline btn-sm" onClick={() => setRows((rs) => [...rs, blank(nextPos)])}>
            + Add house
          </button>
          {dirty && (
            <button type="button" className="btn btn-sm" onClick={() => void onSave()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save houses"}
            </button>
          )}
        </span>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="houses-table">
            <thead>
              <tr>
                <th>House No</th>
                <th>Supplier / Shipper</th>
                <th className="num">Pieces</th>
                <th className="num">Kg</th>
                <th className="num">CBM</th>
                <th>Commodity</th>
                <th className="num">Value</th>
                <th>Cur</th>
                <th>Carrier {bill} No</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`}>
                  <td className="nowrap">
                    <b>{r.house_no ?? `${job.reference}-${r.position}`}</b>
                  </td>
                  <td>
                    <select value={r.supplier_id ?? ""} onChange={(e) => set(i, { supplier_id: e.target.value || null })}>
                      <option value="">Pick the supplier…</option>
                      {shippers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.company}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="num" type="number" min={0} value={r.pieces || ""} onChange={(e) => set(i, { pieces: n(e.target.value) })} />
                  </td>
                  <td>
                    <input className="num" type="number" min={0} step="0.01" value={r.gross_kg || ""} onChange={(e) => set(i, { gross_kg: n(e.target.value) })} />
                  </td>
                  <td>
                    <input className="num" type="number" min={0} step="0.001" value={r.volume_cbm || ""} onChange={(e) => set(i, { volume_cbm: n(e.target.value) })} />
                  </td>
                  <td>
                    <input value={r.commodity ?? ""} onChange={(e) => set(i, { commodity: e.target.value || null })} />
                  </td>
                  <td>
                    <input
                      className="num"
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.commercial_value ?? ""}
                      onChange={(e) => set(i, { commercial_value: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <select value={r.value_currency ?? "USD"} onChange={(e) => set(i, { value_currency: e.target.value })}>
                      {["USD", "ZAR", "CNY", "EUR", "GBP"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={r.carrier_house_no ?? ""} onChange={(e) => set(i, { carrier_house_no: e.target.value || null })} />
                  </td>
                  <td>
                    <button type="button" className="sp-slot-x" aria-label="Remove house" onClick={() => onRemove(i)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>Master {job.reference}</b>
                  {quoted && <span className="hint"> · quoted {fmt(quoted.qty, 0)} pcs, {fmt(quoted.totalActual, 2)} kg, {fmt(quoted.totalCbm, 3)} CBM</span>}
                </td>
                <td className={`num${off(tot.pieces, quoted?.qty) ? " houses-off" : ""}`}>{fmt(tot.pieces, 0)}</td>
                <td className={`num${off(tot.kg, quoted?.totalActual) ? " houses-off" : ""}`}>{fmt(tot.kg, 2)}</td>
                <td className={`num${off(tot.cbm, quoted?.totalCbm) ? " houses-off" : ""}`}>{fmt(tot.cbm, 3)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {quoted && rows.length > 0 && (off(tot.cbm, quoted.totalCbm) || off(tot.kg, quoted.totalActual)) && (
        <p className="hint houses-off-note">The houses don't add up to the quoted cargo yet (orange totals).</p>
      )}
    </div>
  );
}
