import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Modal from "../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  RowActions,
  RowActionsHead,
} from "../components/common";
import { useToast } from "../components/Toast";
import {
  useCreateJob,
  useDeleteJob,
  useJobs,
  useSetJobMilestone,
  useUpdateJob,
} from "../lib/hooks";
import { formatDate, newReference, portCode } from "../lib/format";
import { LOCODES } from "../lib/locodes";
import {
  DELIVERED_STATUS,
  MILESTONE_BY_STATUS,
  SHIPMENT_STATUSES,
  shipmentStatusTone,
  type Job,
  type JobPatch,
} from "../lib/types";
import CommsRail from "./shipments/CommsRail";

/** "AWB" for air/courier, "MBL" for sea, "Ref" otherwise. */
function docLabel(mode: string): string {
  if (mode.startsWith("Air") || mode.startsWith("Courier")) return "AWB No";
  if (mode.startsWith("Sea")) return "MBL No";
  return "Ref No";
}

/** Port fields on a job hold just the UN/LOCODE (e.g. "ZADUR"), not the
 *  "CODE — City, Country" string used on the quote. */
function codeOf(s: string | null | undefined): string {
  if (!s || !s.trim()) return "";
  const c = portCode(s);
  return c === "—" ? "" : c;
}

function JobRow({
  job,
  onSave,
  onOpenComms,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  job: Job;
  onSave: (id: string, patch: JobPatch) => void;
  onOpenComms: (job: Job) => void;
  onView: (job: Job) => void;
  onEdit: (job: Job) => void;
  onDelete: (job: Job) => void;
  onDuplicate: (job: Job) => void;
}) {
  // Row owns its edit state; seeded once from the job. Each field saves to the
  // server on blur / change, so a refetch never has to clobber what's typed.
  const [row, setRow] = useState<JobPatch>({
    po_no: job.po_no ?? "",
    shipment_status: job.shipment_status ?? "",
    notes: job.notes ?? "",
    awb_mbl: job.awb_mbl ?? "",
    container_no: job.container_no ?? "",
    shipping_line: job.shipping_line ?? "",
    carrier_name: job.carrier_name ?? "",
    provisional_delivery_date: job.provisional_delivery_date ?? "",
    etd: job.etd ?? "",
    eta: job.eta ?? "",
    origin: codeOf(job.origin),
    destination: codeOf(job.destination),
  });

  function set<K extends keyof JobPatch>(key: K, value: JobPatch[K]) {
    setRow((r) => ({ ...r, [key]: value }));
  }
  function commit<K extends keyof JobPatch>(key: K, initial: string) {
    const next = (row[key] ?? "") as string;
    if (next !== (initial ?? "")) onSave(job.id, { [key]: next } as JobPatch);
  }
  // Port fields: normalise whatever was typed/picked to a bare code on blur.
  function commitPort(key: "origin" | "destination") {
    const code = codeOf(row[key] as string);
    set(key, code);
    if (code !== codeOf(job[key])) onSave(job.id, { [key]: code } as JobPatch);
  }

  return (
    <tr>
      <td>
        <RowActions
          onMail={() => onOpenComms(job)}
          mailTitle="Messages / email the customer"
          onView={() => onView(job)}
          onEdit={() => onEdit(job)}
          onDelete={() => onDelete(job)}
          onDuplicate={() => onDuplicate(job)}
        />
      </td>
      <td className="nowrap">{formatDate(job.created_at)}</td>
      <td className="nowrap">
        {job.quote_id ? (
          <Link className="job-ref" to={`/quotes/${job.quote_id}`}>
            {job.reference}
          </Link>
        ) : (
          <strong>{job.reference}</strong>
        )}
      </td>
      <td className="nowrap">{job.supplier?.company ?? "—"}</td>
      <td className="nowrap">{job.client?.company ?? "—"}</td>
      <td>
        <input
          value={row.po_no ?? ""}
          onChange={(e) => set("po_no", e.target.value)}
          onBlur={() => commit("po_no", job.po_no ?? "")}
          placeholder="—"
        />
      </td>
      <td className="nowrap">{job.mode}</td>
      <td>
        <select
          className={`job-status is-${shipmentStatusTone(row.shipment_status)}`}
          value={row.shipment_status ?? ""}
          onChange={(e) => {
            set("shipment_status", e.target.value);
            onSave(job.id, { shipment_status: e.target.value });
          }}
        >
          <option value="">— set status —</option>
          {SHIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="job-notes">
        <input
          value={row.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          onBlur={() => commit("notes", job.notes ?? "")}
          placeholder="Add an update…"
        />
      </td>
      <td>
        <input
          value={row.awb_mbl ?? ""}
          onChange={(e) => set("awb_mbl", e.target.value)}
          onBlur={() => commit("awb_mbl", job.awb_mbl ?? "")}
          placeholder={docLabel(job.mode)}
          title={docLabel(job.mode)}
        />
      </td>
      <td>
        <input
          value={row.container_no ?? ""}
          onChange={(e) => set("container_no", e.target.value)}
          onBlur={() => commit("container_no", job.container_no ?? "")}
          placeholder="Container"
        />
      </td>
      <td>
        <input
          value={row.shipping_line ?? ""}
          onChange={(e) => set("shipping_line", e.target.value)}
          onBlur={() => commit("shipping_line", job.shipping_line ?? "")}
          placeholder="Shipping line"
        />
      </td>
      <td>
        <input
          value={row.carrier_name ?? ""}
          onChange={(e) => set("carrier_name", e.target.value)}
          onBlur={() => commit("carrier_name", job.carrier_name ?? "")}
          placeholder="Carrier/Airline"
        />
      </td>
      <td>
        <input
          type="date"
          value={row.provisional_delivery_date ?? ""}
          onChange={(e) => {
            set("provisional_delivery_date", e.target.value);
            onSave(job.id, { provisional_delivery_date: e.target.value });
          }}
          title="Provisional delivery date"
        />
      </td>
      <td>
        <input
          type="date"
          value={row.etd ?? ""}
          onChange={(e) => {
            set("etd", e.target.value);
            onSave(job.id, { etd: e.target.value });
          }}
        />
      </td>
      <td>
        <input
          type="date"
          value={row.eta ?? ""}
          onChange={(e) => {
            set("eta", e.target.value);
            onSave(job.id, { eta: e.target.value });
          }}
        />
      </td>
      <td>
        <input
          list="job-locodes"
          value={row.origin ?? ""}
          onChange={(e) => set("origin", e.target.value)}
          onBlur={() => commitPort("origin")}
          placeholder="POL"
        />
      </td>
      <td>
        <input
          list="job-locodes"
          value={row.destination ?? ""}
          onChange={(e) => set("destination", e.target.value)}
          onBlur={() => commitPort("destination")}
          placeholder="POD"
        />
      </td>
    </tr>
  );
}

type BoardMode = "active" | "completed";
type ModeTab = "All" | "Air" | "Sea" | "Road" | "Courier";

const MODE_TABS: { key: ModeTab; label: string }[] = [
  { key: "All", label: "All Shipments" },
  { key: "Air", label: "Air Freight" },
  { key: "Courier", label: "Courier Express" },
  { key: "Sea", label: "Sea Freight" },
  { key: "Road", label: "Road Freight" },
];

/** A job's transport mode label starts with "Air (AIR)", "Sea (FCL)"… */
function matchesModeTab(mode: string, tab: ModeTab): boolean {
  return tab === "All" || (mode ?? "").startsWith(tab);
}

/** The mode filter is driven by the top nav's Shipments sub-links (?mode=). */
function modeTabFromParam(v: string | null): ModeTab {
  if (v === "air") return "Air";
  if (v === "sea") return "Sea";
  if (v === "road") return "Road";
  if (v === "courier") return "Courier";
  return "All";
}

const COPY: Record<
  BoardMode,
  {
    eyebrow: string;
    title: string;
    heading: string;
    sub: (n: number) => string;
    empty: string;
  }
> = {
  active: {
    eyebrow: "Post-acceptance tracking",
    title: "Active Shipments",
    heading: "All Shipments",
    sub: (n) => `${n} in progress · every field edits in place`,
    empty: "No active shipments. Accept a quote to create one automatically.",
  },
  completed: {
    eyebrow: "Closed out",
    title: "Completed Shipments",
    heading: "Delivered Shipments",
    sub: (n) => `${n} delivered`,
    empty:
      "No completed shipments yet. A shipment lands here the moment its Shipment Status is set to Delivered.",
  },
};

/**
 * One editable jobs board, shown twice: Active (everything not yet delivered)
 * and Completed (delivered). Both read the same `jobs` query, so flipping a
 * row's Shipment Status to / from "Delivered" moves it between the two views
 * on the next refetch.
 */
export default function JobsBoard({ mode }: { mode: BoardMode }) {
  const { data: jobs, isLoading, isError, error } = useJobs();
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();
  const createJob = useCreateJob();
  const setMilestone = useSetJobMilestone();
  const { toast, error: toastError } = useToast();
  const [params] = useSearchParams();
  const modeTab = modeTabFromParam(params.get("mode"));
  const [commsJob, setCommsJob] = useState<Job | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [viewing, setViewing] = useState<Job | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  function openComms(j: Job) {
    setCommsJob(j);
    setRailOpen(true);
  }

  async function onDeleteJob(j: Job) {
    if (!window.confirm(`Delete shipment ${j.reference}? This cannot be undone.`))
      return;
    try {
      await deleteJob.mutateAsync(j.id);
      toast("Shipment deleted");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete shipment");
    }
  }

  async function onDuplicateJob(j: Job) {
    try {
      const created = await createJob.mutateAsync({
        reference: newReference(j.mode),
        mode: j.mode,
        client_id: j.client_id,
        supplier_id: j.supplier_id,
        origin: j.origin,
        destination: j.destination,
        shipping_line: j.shipping_line,
        carrier_name: j.carrier_name,
      });
      toast("Shipment duplicated");
      setEditingJob(created);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not duplicate shipment");
    }
  }

  const stageRows = (jobs ?? []).filter((j) =>
    mode === "completed"
      ? j.shipment_status === DELIVERED_STATUS
      : j.shipment_status !== DELIVERED_STATUS,
  );
  const rows = stageRows.filter((j) => matchesModeTab(j.mode, modeTab));
  const modeLabel = MODE_TABS.find((t) => t.key === modeTab)?.label ?? "";

  function save(id: string, patch: JobPatch) {
    const toDone = patch.shipment_status === DELIVERED_STATUS;
    const fromDone =
      mode === "completed" &&
      patch.shipment_status !== undefined &&
      patch.shipment_status !== DELIVERED_STATUS;
    updateJob.mutate(
      { id, patch },
      {
        onSuccess: () =>
          toast(
            toDone
              ? "Shipment delivered — moved to Completed Shipments"
              : fromDone
                ? "Shipment reopened — moved to Active Shipments"
                : "Shipment updated",
          ),
        onError: (e) =>
          toastError(e instanceof Error ? e.message : "Could not save"),
      },
    );

    // Advance the milestone funnel (+ log a job_events row) whenever the
    // Shipment Status moves into a different stage — nothing else does this.
    if (patch.shipment_status) {
      const milestone = MILESTONE_BY_STATUS[patch.shipment_status];
      if (milestone) {
        setMilestone.mutate({
          jobId: id,
          milestone,
          note: `Shipment Status set to "${patch.shipment_status}"`,
        });
      }
    }
  }

  const copy = COPY[mode];

  return (
    <>
      <div className={railOpen ? "board-shift" : ""}>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} />

      <div className="panel jobs-panel">
        <div className="panel-head">
          <div>
            <h2>{copy.heading}</h2>
            <p>
              {copy.sub(rows.length)}
              {modeTab !== "All" ? ` · ${modeLabel} only` : ""}
            </p>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {modeTab !== "All" && stageRows.length > 0
              ? `No ${modeLabel} shipments in this view.`
              : copy.empty}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <datalist id="job-locodes">
              {LOCODES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.city}, {l.country}
                </option>
              ))}
            </datalist>
            <table className="table--compact jobs-table">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Created On</th>
                  <th>Shipment #</th>
                  <th>Shipper</th>
                  <th>Customer</th>
                  <th>PO #</th>
                  <th>Mode</th>
                  <th>Shipment Status</th>
                  <th>Additional Notes</th>
                  <th>AWB/MBL No</th>
                  <th>Container No</th>
                  <th>Shipping Line</th>
                  <th>Carrier/Airline</th>
                  <th>Prov. Delivery</th>
                  <th>ETD</th>
                  <th>ETA</th>
                  <th>POL</th>
                  <th>POD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onSave={save}
                    onOpenComms={openComms}
                    onView={setViewing}
                    onEdit={setEditingJob}
                    onDelete={onDeleteJob}
                    onDuplicate={onDuplicateJob}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      <CommsRail
        job={commsJob}
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
      />

      {viewing && (
        <JobViewModal
          job={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditingJob(viewing);
            setViewing(null);
          }}
        />
      )}

      {editingJob && (
        <JobEditModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSave={(patch) => {
            save(editingJob.id, patch);
            setEditingJob(null);
          }}
        />
      )}
    </>
  );
}

function JobViewModal({
  job,
  onClose,
  onEdit,
}: {
  job: Job;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal
      title={job.reference}
      onClose={onClose}
      wide
      headerActions={
        <button className="btn outline" onClick={onEdit}>
          Edit
        </button>
      }
    >
      <div className="grid2">
        <ViewField label="Customer" value={job.client?.company ?? "—"} />
        <ViewField label="Shipper" value={job.supplier?.company ?? "—"} />
        <ViewField label="Mode" value={job.mode} />
        <ViewField label="Milestone" value={job.milestone} />
        <ViewField label="Shipment Status" value={job.shipment_status || "—"} />
        <ViewField label="PO #" value={job.po_no || "—"} />
        <ViewField label={docLabel(job.mode)} value={job.awb_mbl || "—"} />
        <ViewField label="Container No" value={job.container_no || "—"} />
        <ViewField label="Shipping Line" value={job.shipping_line || "—"} />
        <ViewField label="Carrier/Airline" value={job.carrier_name || "—"} />
        <ViewField label="POL" value={codeOf(job.origin) || "—"} />
        <ViewField label="POD" value={codeOf(job.destination) || "—"} />
        <ViewField label="ETD" value={formatDate(job.etd)} />
        <ViewField label="ETA" value={formatDate(job.eta)} />
        <ViewField
          label="Prov. Delivery"
          value={formatDate(job.provisional_delivery_date)}
        />
        <ViewField label="Created On" value={formatDate(job.created_at)} />
      </div>
      <ViewField label="Additional Notes" value={job.notes || "—"} />
      {job.quote_id && (
        <p style={{ marginTop: 8 }}>
          <Link to={`/quotes/${job.quote_id}`} onClick={onClose}>
            View originating quotation →
          </Link>
        </p>
      )}
    </Modal>
  );
}

function JobEditModal({
  job,
  onClose,
  onSave,
}: {
  job: Job;
  onClose: () => void;
  onSave: (patch: JobPatch) => void;
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSave({
      po_no: String(fd.get("po_no") || ""),
      shipment_status: String(fd.get("shipment_status") || ""),
      notes: String(fd.get("notes") || ""),
      awb_mbl: String(fd.get("awb_mbl") || ""),
      container_no: String(fd.get("container_no") || ""),
      shipping_line: String(fd.get("shipping_line") || ""),
      carrier_name: String(fd.get("carrier_name") || ""),
      provisional_delivery_date: String(fd.get("provisional_delivery_date") || ""),
      etd: String(fd.get("etd") || ""),
      eta: String(fd.get("eta") || ""),
      origin: codeOf(String(fd.get("origin") || "")),
      destination: codeOf(String(fd.get("destination") || "")),
    });
  }

  return (
    <Modal title={`Edit ${job.reference}`} onClose={onClose} wide>
      <form onSubmit={onSubmit}>
        <div className="grid2">
          <div className="field">
            <label>PO #</label>
            <input name="po_no" defaultValue={job.po_no ?? ""} autoFocus />
          </div>
          <div className="field">
            <label>Shipment Status</label>
            <select name="shipment_status" defaultValue={job.shipment_status ?? ""}>
              <option value="">— set status —</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>{docLabel(job.mode)}</label>
            <input name="awb_mbl" defaultValue={job.awb_mbl ?? ""} />
          </div>
          <div className="field">
            <label>Container No</label>
            <input name="container_no" defaultValue={job.container_no ?? ""} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Shipping Line</label>
            <input name="shipping_line" defaultValue={job.shipping_line ?? ""} />
          </div>
          <div className="field">
            <label>Carrier/Airline</label>
            <input name="carrier_name" defaultValue={job.carrier_name ?? ""} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>POL</label>
            <input
              name="origin"
              list="job-locodes"
              defaultValue={codeOf(job.origin)}
            />
          </div>
          <div className="field">
            <label>POD</label>
            <input
              name="destination"
              list="job-locodes"
              defaultValue={codeOf(job.destination)}
            />
          </div>
        </div>
        <div className="grid3">
          <div className="field">
            <label>ETD</label>
            <input type="date" name="etd" defaultValue={job.etd ?? ""} />
          </div>
          <div className="field">
            <label>ETA</label>
            <input type="date" name="eta" defaultValue={job.eta ?? ""} />
          </div>
          <div className="field">
            <label>Prov. Delivery</label>
            <input
              type="date"
              name="provisional_delivery_date"
              defaultValue={job.provisional_delivery_date ?? ""}
            />
          </div>
        </div>
        <div className="field">
          <label>Additional Notes</label>
          <textarea name="notes" rows={2} defaultValue={job.notes ?? ""} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ViewField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
