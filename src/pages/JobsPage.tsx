import { useState } from "react";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import { useJobs, useUpdateJob } from "../lib/hooks";
import { formatDate, portCode } from "../lib/format";
import { LOCODES } from "../lib/locodes";
import {
  SHIPMENT_STATUSES,
  shipmentStatusTone,
  type Job,
  type JobPatch,
} from "../lib/types";

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
}: {
  job: Job;
  onSave: (id: string, patch: JobPatch) => void;
}) {
  // Row owns its edit state; seeded once from the job. Each field saves to the
  // server on blur / change, so a refetch never has to clobber what's typed.
  const [row, setRow] = useState<JobPatch>({
    po_no: job.po_no ?? "",
    shipment_status: job.shipment_status ?? "",
    notes: job.notes ?? "",
    awb_mbl: job.awb_mbl ?? "",
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
      <td className="nowrap">{formatDate(job.created_at)}</td>
      <td className="nowrap">
        <strong>{job.reference}</strong>
      </td>
      <td>{job.supplier?.company ?? "—"}</td>
      <td>{job.client?.company ?? "—"}</td>
      <td>
        <input
          value={row.po_no ?? ""}
          onChange={(e) => set("po_no", e.target.value)}
          onBlur={() => commit("po_no", job.po_no ?? "")}
          placeholder="—"
        />
      </td>
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

export default function JobsPage() {
  const { data: jobs, isLoading, isError, error } = useJobs();
  const updateJob = useUpdateJob();
  const { toast, error: toastError } = useToast();

  function save(id: string, patch: JobPatch) {
    updateJob.mutate(
      { id, patch },
      {
        onSuccess: () => toast("Job updated"),
        onError: (e) =>
          toastError(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }

  return (
    <>
      <PageHeader eyebrow="Post-acceptance tracking" title="Active Jobs" />

      <div className="panel jobs-panel">
        <div className="panel-head">
          <div>
            <h2>All jobs</h2>
            <p>{(jobs ?? []).length} total · every field edits in place</p>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : (jobs ?? []).length === 0 ? (
          <EmptyState>
            No jobs yet. Accept a quote to create one automatically.
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
                  <th>Created On</th>
                  <th>Job #</th>
                  <th>Supplier</th>
                  <th>Client</th>
                  <th>PO #</th>
                  <th>Shipment Status</th>
                  <th>Additional Notes</th>
                  <th>AWB/MBL No</th>
                  <th>ETD</th>
                  <th>ETA</th>
                  <th>POL</th>
                  <th>POD</th>
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((j) => (
                  <JobRow key={j.id} job={j} onSave={save} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
