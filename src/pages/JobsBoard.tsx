import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import { useJobs, useUpdateJob } from "../lib/hooks";
import { formatDate, portCode } from "../lib/format";
import { LOCODES } from "../lib/locodes";
import {
  DELIVERED_STATUS,
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
}: {
  job: Job;
  onSave: (id: string, patch: JobPatch) => void;
  onOpenComms: (job: Job) => void;
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
        <button
          className="btn ghost small icon-only"
          onClick={() => onOpenComms(job)}
          title="Messages / email the customer"
          aria-label="Messages"
        >
          ✉
        </button>
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
type ModeTab = "All" | "Air" | "Sea" | "Road";

const MODE_TABS: { key: ModeTab; label: string }[] = [
  { key: "All", label: "All Shipments" },
  { key: "Air", label: "Air Freight" },
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
  const { toast, error: toastError } = useToast();
  const [params] = useSearchParams();
  const modeTab = modeTabFromParam(params.get("mode"));
  const [commsJob, setCommsJob] = useState<Job | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  function openComms(j: Job) {
    setCommsJob(j);
    setRailOpen(true);
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
                  <th />
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
    </>
  );
}
