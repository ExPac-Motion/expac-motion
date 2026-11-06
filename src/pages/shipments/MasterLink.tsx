// Direct / Master / House (migration 0223): put shipments of one customer as
// houses on a master shipment, from Active Shipments (ticked rows) or the
// shipment page. The house number (HBL161005-1 / HAWB161005-1) and the
// master's booking details come from the database.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useCan, useJobs } from "../../lib/hooks";
import { portCode } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { useWmsConsols, useWmsMutation } from "../../lib/wms";
import { blankConsol } from "../wms/WmsConsols";
import { consolModeFor } from "../wms/houseFromShipment";
import { KIND_LABEL, canConsol, kindOf, sameFamily, useSetClearance, useSetKind, useSetMaster } from "../../lib/masters";
import type { Job } from "../../lib/types";

/** Tick shipments of one customer, pick the master (an existing one, or one
 *  of them becomes it); every other ticked shipment becomes its house. */
export function AddToMasterModal({
  jobs,
  onClose,
  onWmsConsol,
}: {
  jobs: Job[];
  onClose: () => void;
  /** Opens the Motion WMS co-load (several customers on one MBL) instead. */
  onWmsConsol?: () => void;
}) {
  const { toast, error } = useToast();
  const allQ = useJobs();
  const run = useSetMaster();
  const clients = [...new Set(jobs.map((j) => j.client_id))];
  const oneClient = clients.length === 1 && !!clients[0];
  const modes = jobs.filter((j) => !canConsol(j.mode));
  const families = new Set(jobs.filter((j) => canConsol(j.mode)).map((j) => (j.mode.startsWith("Air") ? "air" : "sea")));
  const ticked = new Set(jobs.map((j) => j.id));

  // Candidates: the customer's masters, then its other direct shipments (of the
  // same transport family), ticked ones included (one of them can become it).
  const candidates = useMemo(() => {
    if (!oneClient || families.size !== 1) return { masters: [] as Job[], others: [] as Job[] };
    const fam = jobs.find((j) => canConsol(j.mode))!.mode;
    const mine = (allQ.data ?? []).filter(
      (j) => j.client_id === clients[0] && !j.ops_completed_at && sameFamily(j.mode, fam) && kindOf(j) !== "house",
    );
    return {
      masters: mine.filter((j) => kindOf(j) === "master"),
      others: mine.filter((j) => kindOf(j) === "direct"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allQ.data, jobs]);

  const firstMaster = candidates.masters.find((m) => !ticked.has(m.id))?.id ?? candidates.masters[0]?.id ?? jobs[0]?.id ?? "";
  const [masterId, setMasterId] = useState(firstMaster);
  const pick = masterId || firstMaster;
  const master = [...candidates.masters, ...candidates.others].find((j) => j.id === pick);
  const houses = jobs.filter((j) => j.id !== pick && kindOf(j) !== "master" && j.master_job_id !== pick);
  const skipped = jobs.filter((j) => j.id !== pick && (kindOf(j) === "master" || j.master_job_id === pick));
  const moving = houses.filter((j) => j.master_job_id && j.master_job_id !== pick);

  const problem = !oneClient
    ? "Houses go on a master of the same customer: tick shipments of one customer."
    : modes.length
      ? `${modes.map((j) => j.reference).join(", ")}: only sea and air shipments carry house bills.`
      : families.size > 1
        ? "Air and sea can't share a master: tick only air or only sea shipments."
        : null;

  function submit() {
    if (problem || !master) return;
    if (houses.length === 0) return error("Pick a master and at least one other shipment to put on it");
    run.mutate(
      { jobIds: houses.map((h) => h.id), masterId: master.id, makeMaster: kindOf(master) === "direct" ? master.id : undefined },
      {
        onSuccess: () => {
          toast(`${houses.length} house${houses.length === 1 ? "" : "s"} on ${master.reference}`);
          onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title="Add to a master" onClose={onClose}>
      {problem ? (
        <p className="ms-note warn">{problem}</p>
      ) : (
        <>
          <div className="field">
            <label>Master shipment</label>
            <select value={pick} onChange={(e) => setMasterId(e.target.value)}>
              {candidates.masters.length > 0 && (
                <optgroup label="Masters">
                  {candidates.masters.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.reference}, {j.mode}
                      {j.po_no ? `, ${j.po_no}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Make this shipment the master">
                {candidates.others.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.reference}, {j.mode}
                    {j.po_no ? `, ${j.po_no}` : ""}
                    {ticked.has(j.id) ? " (ticked)" : ""}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="hint">
              The master keeps its number and is what {jobs[0]?.client?.company ?? "the customer"} is billed on. Its vessel,
              voyage, container, MBL / MAWB and ETD / ETA flow to its houses.
            </span>
          </div>
          <table className="table--compact wms-mini">
            <thead>
              <tr>
                <th>Becomes a house</th>
                <th>Mode</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {houses.map((j) => (
                <tr key={j.id}>
                  <td>
                    <b>{j.reference}</b>
                    {j.po_no ? <span className="hint"> {j.po_no}</span> : null}
                  </td>
                  <td>{j.mode}</td>
                  <td>{j.master_job_id ? `${j.house_no ?? "House"}, moves to ${master?.reference ?? "this master"}` : KIND_LABEL[kindOf(j)]}</td>
                </tr>
              ))}
              {houses.length === 0 && (
                <tr>
                  <td colSpan={3} className="hint">
                    No other ticked shipment to put on {master?.reference ?? "the master"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {skipped.length > 0 && (
            <p className="hint">
              Left as they are: {skipped.map((j) => j.reference).join(", ")} (already on this master, or a master itself).
            </p>
          )}
          {moving.length > 0 && <p className="hint">Moving a house to another master gives it a new house number.</p>}
        </>
      )}
      <div className="modal-foot-row">
        {onWmsConsol && (
          <button type="button" className="link-btn" style={{ marginRight: "auto" }} onClick={onWmsConsol} title="Several customers on one MBL / MAWB, in Motion WMS">
            Warehouse co-load (several customers) instead
          </button>
        )}
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        {!problem && (
          <button className="btn" onClick={submit} disabled={run.isPending || houses.length === 0}>
            {run.isPending ? "Saving…" : `Add ${houses.length || ""} to ${master?.reference ?? "master"}`}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Shipment page: Direct / Master / House, the master or houses, and the
 *  buttons to change it. */
export function MasterSection({ job }: { job: Job }) {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const allQ = useJobs();
  const setMasterM = useSetMaster();
  const setKindM = useSetKind();
  const clearance = useSetClearance();
  const [adding, setAdding] = useState(false);
  if (!canConsol(job.mode) || job.shipment_kind === undefined) return null;
  const kind = kindOf(job);
  const all = allQ.data ?? [];
  const master = job.master_job_id ? all.find((j) => j.id === job.master_job_id) : undefined;
  const houses = all.filter((j) => j.master_job_id === job.id).sort((a, b) => (a.house_position ?? 0) - (b.house_position ?? 0));
  const others = all.filter(
    (j) =>
      j.id !== job.id &&
      j.client_id === job.client_id &&
      !j.ops_completed_at &&
      sameFamily(j.mode, job.mode) &&
      (kind === "master" ? kindOf(j) === "direct" : kindOf(j) !== "house"),
  );
  const off = (id: string, ref: string) =>
    setMasterM.mutate(
      { jobIds: [id], masterId: null },
      { onSuccess: () => toast(`${ref} is a direct shipment again`), onError: (e) => error(e.message) },
    );

  return (
    <div className="job-consol">
      <span className="k">Shipment type</span>
      <b>{KIND_LABEL[kind]}</b>
      {kind === "house" && (
        <>
          <span>
            {job.house_no} on{" "}
            <button type="button" className="link-btn" onClick={() => master && navigate(`/jobs/${master.id}`)}>
              {master?.reference ?? "its master"}
            </button>
          </span>
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
            Move to another master
          </button>
          <button type="button" className="btn outline btn-sm" onClick={() => off(job.id, job.reference)} disabled={setMasterM.isPending}>
            Take off master
          </button>
        </>
      )}
      {kind === "master" && (
        <>
          <span className="hint">
            {houses.length ? `${houses.length} house${houses.length === 1 ? "" : "s"}:` : "No houses yet"}
          </span>
          {houses.map((h) => (
            <button key={h.id} type="button" className="link-btn" onClick={() => navigate(`/jobs/${h.id}`)} title={h.reference}>
              {h.house_no}
            </button>
          ))}
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)} disabled={others.length === 0} title={others.length ? undefined : "No other open direct shipment for this customer"}>
            + Add houses
          </button>
          <MasterConsolLink job={job} />
          {job.clearance_basis !== undefined && (
            <select
              className="ms-clear-pick"
              value={job.clearance_basis ?? ""}
              disabled={clearance.isPending}
              title="Cleared once for the whole consol, or each house on its own documents"
              onChange={(e) =>
                clearance.mutate(
                  { jobId: job.id, basis: (e.target.value || null) as "master" | "house" | null },
                  { onSuccess: () => toast("Clearance saved"), onError: (er) => error(er.message) },
                )
              }
            >
              <option value="">Clearance: not set</option>
              <option value="master">Cleared per master</option>
              <option value="house">Cleared per house</option>
            </select>
          )}
          {houses.length === 0 && (
            <button
              type="button"
              className="btn outline btn-sm"
              onClick={() => setKindM.mutate({ jobId: job.id, kind: "direct" }, { onError: (e) => error(e.message) })}
            >
              Back to direct
            </button>
          )}
        </>
      )}
      {kind === "direct" && (
        <>
          <button
            type="button"
            className="btn outline btn-sm"
            onClick={() => setKindM.mutate({ jobId: job.id, kind: "master" }, { onSuccess: () => toast(`${job.reference} is a master`), onError: (e) => error(e.message) })}
          >
            Make master
          </button>
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)} disabled={others.length === 0} title={others.length ? undefined : "No other open shipment for this customer"}>
            Add to a master
          </button>
        </>
      )}
      {adding && <PickModal job={job} kind={kind} options={others} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** From the shipment page: a master picks its houses; a direct shipment or a
 *  house picks its master. */
function PickModal({ job, kind, options, onClose }: { job: Job; kind: "direct" | "master" | "house"; options: Job[]; onClose: () => void }) {
  const { toast, error } = useToast();
  const run = useSetMaster();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [masterId, setMasterId] = useState(options.find((o) => kindOf(o) === "master")?.id ?? options[0]?.id ?? "");
  const asMaster = kind === "master";
  const target = options.find((o) => o.id === masterId);

  function submit() {
    if (asMaster) {
      if (picked.size === 0) return error("Tick the shipments to add as houses");
      run.mutate(
        { jobIds: [...picked], masterId: job.id },
        { onSuccess: () => (toast(`${picked.size} house${picked.size === 1 ? "" : "s"} added`), onClose()), onError: (e) => error(e.message) },
      );
    } else {
      if (!target) return error("Pick the master");
      run.mutate(
        { jobIds: [job.id], masterId: target.id, makeMaster: kindOf(target) === "direct" ? target.id : undefined },
        { onSuccess: () => (toast(`${job.reference} is a house on ${target.reference}`), onClose()), onError: (e) => error(e.message) },
      );
    }
  }

  return (
    <Modal title={asMaster ? `Add houses to ${job.reference}` : `Put ${job.reference} on a master`} onClose={onClose}>
      {asMaster ? (
        <div className="ms-pick-list">
          {options.map((o) => (
            <label key={o.id} className="check">
              <input
                type="checkbox"
                checked={picked.has(o.id)}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(o.id)) n.delete(o.id);
                    else n.add(o.id);
                    return n;
                  })
                }
              />{" "}
              <b>{o.reference}</b> {o.mode}
              {o.supplier?.company ? `, ${o.supplier.company}` : ""}
              {o.po_no ? `, ${o.po_no}` : ""}
            </label>
          ))}
        </div>
      ) : (
        <div className="field">
          <label>Master shipment</label>
          <select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            {options.some((o) => kindOf(o) === "master") && (
              <optgroup label="Masters">
                {options
                  .filter((o) => kindOf(o) === "master" && o.id !== job.master_job_id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.reference}, {o.mode}
                      {o.po_no ? `, ${o.po_no}` : ""}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Make this shipment the master">
              {options
                .filter((o) => kindOf(o) === "direct")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.reference}, {o.mode}
                    {o.po_no ? `, ${o.po_no}` : ""}
                  </option>
                ))}
            </optgroup>
          </select>
          <span className="hint">Its house number comes from the master (HBL / HAWB + master number + house).</span>
        </div>
      )}
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={run.isPending}>
          {run.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/** A master's Motion WMS consolidation (0225): open it, or create it from the
 *  master (its MBL / MAWB, carrier, vessel / flight, ports, dates); the
 *  database puts the master's house shipments on it and keeps both in step. */
export function MasterConsolLink({ job }: { job: Pick<Job, "id" | "reference" | "mode" | "awb_mbl" | "origin" | "destination" | "carrier_name" | "shipping_line" | "vessel_name" | "voyage_no" | "etd" | "eta"> }) {
  const can = useCan();
  const navigate = useNavigate();
  const { error } = useToast();
  const consolsQ = useWmsConsols();
  const create = useWmsMutation(async () => {
    const mode = consolModeFor(job.mode);
    if (!mode) throw new Error("Only air and sea shipments go on a warehouse consol");
    const air = mode === "air";
    const base = blankConsol(mode);
    const { data, error: e } = await supabase
      .from("wms_consols")
      .insert({
        ...base,
        job_id: job.id,
        master_no: job.awb_mbl || null,
        carrier: job.carrier_name || job.shipping_line || null,
        ...(air
          ? { origin: portCode(job.origin) || null, destination: portCode(job.destination) || base.destination, flight_date: job.etd || null }
          : {
              port_of_loading: portCode(job.origin) || null,
              port_of_discharge: portCode(job.destination) || base.port_of_discharge,
              vessel: job.vessel_name || null,
              voyage_no: job.voyage_no || null,
              etd: job.etd || null,
            }),
        eta: job.eta || null,
      })
      .select("id")
      .single();
    if (e) throw new Error(e.message);
    return (data as { id: string }).id;
  });
  if (!can("warehouse") || !consolModeFor(job.mode)) return null;
  const linked = (consolsQ.data ?? []).filter((c) => c.job_id === job.id);
  if (linked.length) {
    return (
      <>
        {linked.map((c) => (
          <button key={c.id} type="button" className="link-btn" onClick={() => navigate(`/wms/consols/${c.id}`)} title="The master's warehouse consolidation (MAWB / MBL, house bills, manifest)">
            Warehouse consol {c.consol_no} ({c.houses.length} house{c.houses.length === 1 ? "" : "s"}, {c.status})
          </button>
        ))}
      </>
    );
  }
  return (
    <button
      type="button"
      className="btn outline btn-sm"
      disabled={create.isPending || consolsQ.isLoading}
      title="Create the Motion WMS consolidation for this master: its houses go on it, and the MBL / MAWB, vessel and dates stay in step"
      onClick={() =>
        create.mutate(undefined, {
          onSuccess: (id) => navigate(`/wms/consols/${id}`),
          onError: (e) => error(e.message),
        })
      }
    >
      {create.isPending ? "Creating…" : "Create warehouse consol"}
    </button>
  );
}
