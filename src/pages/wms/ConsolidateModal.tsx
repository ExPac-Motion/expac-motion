import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useQuotes } from "../../lib/hooks";
import { portCode } from "../../lib/format";
import type { Job } from "../../lib/types";
import {
  CONSOL_MODE_LABEL,
  useWmsConsols,
  useWmsMutation,
  useWmsReceipts,
  wmsDb,
  type ConsolMode,
  type WmsConsolHouse,
} from "../../lib/wms";
import { blankConsol, consolNoticeDetail, houseLabel, masterLabel } from "./WmsConsols";
import { notifyWms } from "../../lib/wmsNotify";
import { consolModeFor, houseFromShipment, jobsOnMasters, shipmentFitsConsol } from "./houseFromShipment";
import { useWmsLookups } from "./shared";

/**
 * Active Shipments › Consolidate: the ticked shipments become houses (HAWB /
 * HBL) on a master (MAWB / MBL), an open one of the same mode or a new one,
 * then the master opens in WMS › Warehouse Release to finish its details.
 */
export default function ConsolidateModal({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const quotesQ = useQuotes();
  const receiptsQ = useWmsReceipts();
  const consolsQ = useWmsConsols();
  const firstMode = consolModeFor(jobs[0]?.mode);
  const [mode, setMode] = useState<ConsolMode>(firstMode ?? "air");
  const [target, setTarget] = useState<string>("new");
  const run = useWmsMutation(async (v: { target: string; houses: WmsConsolHouse[] }) => {
    if (v.target !== "new") {
      const c = (consolsQ.data ?? []).find((x) => x.id === v.target);
      await wmsDb.addHouses(v.target, v.houses, c?.houses.length ?? 0);
      return v.target;
    }
    const j = jobs[0];
    const base = blankConsol(mode);
    return wmsDb.saveConsol(
      undefined,
      mode === "air"
        ? { ...base, origin: portCode(j?.origin) || null, destination: portCode(j?.destination) || base.destination }
        : { ...base, port_of_loading: portCode(j?.origin) || null, port_of_discharge: portCode(j?.destination) || base.port_of_discharge },
      v.houses,
    );
  });

  const fits = jobs.filter((j) => shipmentFitsConsol(j.mode, mode));
  const misfits = jobs.filter((j) => !shipmentFitsConsol(j.mode, mode));
  const taken = jobsOnMasters((consolsQ.data ?? []).filter((c) => c.status !== "departed"));
  const already = fits.filter((j) => taken.has(j.id));
  const toAdd = fits.filter((j) => !taken.has(j.id));
  const open = (consolsQ.data ?? []).filter((c) => c.mode === mode && c.status !== "departed");
  const ML = masterLabel(mode);
  const HL = houseLabel(mode);

  function submit() {
    if (toAdd.length === 0) return error("None of the ticked shipments can go on this master");
    const startAt = target === "new" ? 0 : (open.find((c) => c.id === target)?.houses.length ?? 0);
    const houses = toAdd.map((j, i) =>
      houseFromShipment({
        job: j,
        quote: (quotesQ.data ?? []).find((q) => q.id === j.quote_id),
        consolMode: mode,
        receipts: receiptsQ.data ?? [],
        client: lk.client,
        supplier: lk.supplier,
        position: startAt + i,
      }),
    );
    run.mutate(
      { target, houses },
      {
        onSuccess: (id) => {
          toast(`${houses.length} ${HL}${houses.length === 1 ? "" : "s"} added`);
          void notifyWms("preparing", houses.flatMap((h) => h.receipt_ids), consolNoticeDetail({ ...blankConsol(mode), consol_no: null }, houses, lk.jobRef, "preparing"));
          onClose();
          navigate(`/wms?tab=release&consol=${id}`);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title={`Consolidate ${jobs.length} shipment${jobs.length === 1 ? "" : "s"}`} onClose={onClose}>
      <div className="grid2">
        <div className="field">
          <label>Type</label>
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as ConsolMode);
              setTarget("new");
            }}
          >
            {(Object.keys(CONSOL_MODE_LABEL) as ConsolMode[]).map((m) => (
              <option key={m} value={m}>
                {CONSOL_MODE_LABEL[m]} ({masterLabel(m)} + {houseLabel(m)}s)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Master ({ML})</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">+ New {ML}</option>
            {open.map((c) => (
              <option key={c.id} value={c.id}>
                {c.consol_no}
                {c.master_no ? `, ${ML} ${c.master_no}` : ""} ({c.houses.length} {HL}s)
              </option>
            ))}
          </select>
        </div>
      </div>
      <table className="table--compact wms-mini">
        <thead>
          <tr>
            <th>Shipment</th>
            <th>Customer</th>
            <th>Mode</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <b>{j.reference}</b>
              </td>
              <td>{j.client?.company ?? "—"}</td>
              <td>{j.mode}</td>
              <td>
                {misfits.includes(j) ? (
                  <span className="wms-warn">Not {mode === "air" ? "air" : "sea"}, skipped</span>
                ) : already.includes(j) ? (
                  <span className="wms-warn">Already on {taken.get(j.id)?.consol_no}, skipped</span>
                ) : (
                  <span className="hint">Becomes a {HL}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Each shipment's {HL} number (yours or the origin agent's), parties, commodity, pieces, kg and CBM come across, from its
        warehouse receipts when the goods are in store. Once on the master, its {ML} number fills in on the shipment.
      </p>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={run.isPending || toAdd.length === 0}>
          {run.isPending ? "Adding…" : `Add ${toAdd.length} to ${target === "new" ? `a new ${ML}` : "this master"}`}
        </button>
      </div>
    </Modal>
  );
}
