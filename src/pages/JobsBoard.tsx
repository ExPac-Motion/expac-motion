import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import Modal from "../components/Modal";
import DataTable, { type DataColumn } from "../components/DataTable";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  RowActions,
  RowActionsHead,
  useRowSelection,
} from "../components/common";
import { useToast } from "../components/Toast";
import {
  useCreateJob,
  useDeleteJob,
  useDeleteShipmentDocument,
  useJobs,
  useSetJobMilestone,
  useShipmentDocuments,
  useUpdateJob,
  useUpdateJobsBulk,
  useUploadShipmentDocument,
} from "../lib/hooks";
import { getShipmentDocumentUrl } from "../lib/db";
import { formatDate, newReference, portCode } from "../lib/format";
import { LOCODES } from "../lib/locodes";
import {
  DELIVERED_STATUS,
  MILESTONE_BY_STATUS,
  SHIPMENT_STATUSES,
  shipmentStatusSlug,
  type Job,
  type JobPatch,
  type ShipmentDocument,
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

/* The Shipments board only edits four fields inline (notes + the three
   dates); everything else is read-only here and changed on the quotation.
   Each editable cell owns its draft so a background refetch never clobbers
   what's being typed. */
function JobTextCell({
  value,
  onCommit,
  placeholder,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== (value ?? "")) onCommit(v);
      }}
      placeholder={placeholder}
    />
  );
}
function JobDateCell({
  value,
  onCommit,
  title,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => void;
  title?: string;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input
      type="date"
      value={v}
      title={title}
      onChange={(e) => {
        setV(e.target.value);
        onCommit(e.target.value);
      }}
    />
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
  const bulkUpdate = useUpdateJobsBulk();
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
  const [bulkOpen, setBulkOpen] = useState(false);

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
  const sel = useRowSelection(jobs ?? [], rows);

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

  const jobCols = useMemo<DataColumn<Job>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 200,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (j) => (
          <RowActions
            selected={sel.isSelected(j.id)}
            onSelectToggle={() => sel.toggle(j.id)}
            onMail={() => openComms(j)}
            mailTitle="Messages / email the customer"
            onView={() => setViewing(j)}
            onEdit={() => setEditingJob(j)}
            onDelete={() => onDeleteJob(j)}
            onDuplicate={() => onDuplicateJob(j)}
          />
        ),
      },
      {
        key: "created",
        header: "Created On",
        width: 110,
        cellClass: "nowrap",
        sortValue: (j) => j.created_at,
        render: (j) => formatDate(j.created_at),
      },
      {
        key: "shipment",
        header: "Shipment",
        width: 135,
        cellClass: "nowrap",
        sortValue: (j) => j.reference,
        render: (j) =>
          j.quote_id ? (
            <Link className="job-ref" to={`/quotes/${j.quote_id}`}>
              {j.reference}
            </Link>
          ) : (
            <strong>{j.reference}</strong>
          ),
      },
      {
        key: "customer",
        header: "Customer",
        width: 220,
        sortValue: (j) => (j.client?.company ?? "").toLowerCase(),
        render: (j) => j.client?.company ?? "—",
      },
      {
        key: "shipper",
        header: "Shipper",
        width: 220,
        sortValue: (j) => (j.supplier?.company ?? "").toLowerCase(),
        render: (j) => j.supplier?.company ?? "—",
      },
      {
        key: "reference",
        header: "Reference",
        width: 150,
        sortValue: (j) => j.po_no ?? "",
        render: (j) => j.po_no || "—",
      },
      {
        key: "mode",
        header: "Mode",
        width: 130,
        cellClass: "nowrap",
        sortValue: (j) => j.mode,
        render: (j) => j.mode,
      },
      {
        key: "shipment_status",
        header: mode === "completed" ? "Shipment Status" : "Status",
        width: 170,
        sortValue: (j) =>
          SHIPMENT_STATUSES.indexOf(
            j.shipment_status as (typeof SHIPMENT_STATUSES)[number],
          ),
        render: (j) => (
          <select
            className={`job-status is-${shipmentStatusSlug(j.shipment_status)}`}
            value={j.shipment_status ?? ""}
            onChange={(e) => save(j.id, { shipment_status: e.target.value })}
          >
            <option value="">— set status —</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ),
      },
      {
        key: "notes",
        header: "Notes",
        width: 220,
        cellClass: "job-notes",
        sortValue: (j) => j.notes ?? "",
        render: (j) => (
          <JobTextCell
            value={j.notes}
            placeholder="Add an update…"
            onCommit={(v) => save(j.id, { notes: v })}
          />
        ),
      },
      {
        key: "awb_mbl",
        header: "AWB/MBL No",
        width: 150,
        sortValue: (j) => j.awb_mbl ?? "",
        render: (j) => j.awb_mbl || "—",
      },
      {
        key: "container_no",
        header: "Container No",
        width: 150,
        sortValue: (j) => j.container_no ?? "",
        render: (j) => j.container_no || "—",
      },
      {
        key: "shipping_line",
        header: "Carrier",
        width: 150,
        sortValue: (j) => j.shipping_line ?? "",
        render: (j) => j.shipping_line || "—",
      },
      {
        key: "carrier_name",
        header: "Agent/Airline",
        width: 160,
        sortValue: (j) => j.carrier_name ?? "",
        render: (j) => j.carrier_name || "—",
      },
      {
        key: "etd",
        header: "ETD",
        width: 120,
        sortValue: (j) => j.etd ?? "",
        render: (j) => (
          <JobDateCell value={j.etd} onCommit={(v) => save(j.id, { etd: v })} />
        ),
      },
      {
        key: "eta",
        header: "ETA",
        width: 120,
        sortValue: (j) => j.eta ?? "",
        render: (j) => (
          <JobDateCell value={j.eta} onCommit={(v) => save(j.id, { eta: v })} />
        ),
      },
      {
        key: "pdd",
        header: "PDD",
        width: 120,
        sortValue: (j) => j.provisional_delivery_date ?? "",
        render: (j) => (
          <JobDateCell
            value={j.provisional_delivery_date}
            title="Provisional delivery date"
            onCommit={(v) =>
              save(j.id, { provisional_delivery_date: v })
            }
          />
        ),
      },
      {
        key: "pol",
        header: "POL",
        width: 110,
        sortValue: (j) => codeOf(j.origin),
        render: (j) => codeOf(j.origin) || "—",
      },
      {
        key: "pod",
        header: "POD",
        width: 110,
        sortValue: (j) => codeOf(j.destination),
        render: (j) => codeOf(j.destination) || "—",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, mode],
  );

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
          <DataTable
            tableKey={`jobs-${mode}`}
            className="jobs-table"
            columns={jobCols}
            rows={rows}
            rowKey={(j) => j.id}
            toolbar={
              <button
                className="btn outline btn-sm"
                onClick={() => setBulkOpen(true)}
                disabled={sel.count === 0}
                title={
                  sel.count === 0
                    ? "Tick rows in the Actions column to bulk edit"
                    : undefined
                }
              >
                Bulk Edit{sel.count ? ` (${sel.count})` : ""}
              </button>
            }
          />
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

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} shipment${sel.count === 1 ? "" : "s"}`}
          count={sel.count}
          noun="shipment"
          busy={bulkUpdate.isPending}
          fields={[
            {
              key: "shipment_status",
              label: "Shipment Status",
              type: "select",
              allowClear: false,
              options: SHIPMENT_STATUSES.map((s) => ({ value: s, label: s })),
            },
            { key: "shipping_line", label: "Carrier", type: "text" },
            { key: "carrier_name", label: "Agent/Airline", type: "text" },
          ]}
          onApply={async (patch) => {
            const ids = sel.ids;
            const n = sel.count;
            const status = patch.shipment_status;
            try {
              await bulkUpdate.mutateAsync({
                ids,
                patch: patch as unknown as JobPatch,
              });
              if (typeof status === "string" && status) {
                const milestone = MILESTONE_BY_STATUS[status];
                if (milestone) {
                  for (const id of ids) {
                    setMilestone.mutate({
                      jobId: id,
                      milestone,
                      note: `Shipment Status set to "${status}"`,
                    });
                  }
                }
              }
              toast(
                status === DELIVERED_STATUS
                  ? `${n} shipment${n === 1 ? "" : "s"} delivered — moved to Completed Shipments`
                  : `Updated ${n} shipment${n === 1 ? "" : "s"}`,
              );
              sel.clear();
              setBulkOpen(false);
            } catch (e) {
              toastError(
                e instanceof Error ? e.message : "Could not update shipments",
              );
            }
          }}
          onClose={() => setBulkOpen(false)}
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
        <ViewField label="Reference" value={job.po_no || "—"} />
        <ViewField label={docLabel(job.mode)} value={job.awb_mbl || "—"} />
        <ViewField label="Container No" value={job.container_no || "—"} />
        <ViewField label="Carrier" value={job.shipping_line || "—"} />
        <ViewField label="Agent/Airline" value={job.carrier_name || "—"} />
        <ViewField label="POL" value={codeOf(job.origin) || "—"} />
        <ViewField label="POD" value={codeOf(job.destination) || "—"} />
        <ViewField label="ETD" value={formatDate(job.etd)} />
        <ViewField label="ETA" value={formatDate(job.eta)} />
        <ViewField
          label="PDD"
          value={formatDate(job.provisional_delivery_date)}
        />
        <ViewField label="Created On" value={formatDate(job.created_at)} />
      </div>
      <ViewField label="Notes" value={job.notes || "—"} />
      {job.quote_id && (
        <p style={{ marginTop: 8 }}>
          <Link to={`/quotes/${job.quote_id}`} onClick={onClose}>
            View originating quotation →
          </Link>
        </p>
      )}

      <DocumentsSection job={job} />
    </Modal>
  );
}

function bytesLabel(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsSection({ job }: { job: Job }) {
  const { data, isLoading } = useShipmentDocuments(job.id);
  const upload = useUploadShipmentDocument();
  const del = useDeleteShipmentDocument();
  const { toast, error: toastError } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await upload.mutateAsync({ jobId: job.id, file });
      toast("Document uploaded");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not upload");
    }
  }

  async function onDownload(doc: ShipmentDocument) {
    // Open the tab synchronously (still inside the click gesture) so the
    // browser doesn't block it as a popup once the signed URL is awaited.
    const tab = window.open("", "_blank", "noopener");
    try {
      const url = await getShipmentDocumentUrl(doc.storage_path);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (err) {
      tab?.close();
      toastError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  async function onDelete(doc: ShipmentDocument) {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    try {
      await del.mutateAsync(doc);
      toast("Document deleted");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid #e8e7e0", paddingTop: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <strong>Documents</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            className="btn outline small"
            to={`/jobs/${job.id}/documents/delivery-instruction/print`}
          >
            Delivery Instructions
          </Link>
          <button
            type="button"
            className="btn small"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? "Uploading…" : "+ Upload"}
          </button>
          <input
            ref={fileInput}
            type="file"
            style={{ display: "none" }}
            onChange={onPick}
          />
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : (data ?? []).length === 0 ? (
        <p className="muted small">No documents yet.</p>
      ) : (
        <div className="stack-sm">
          {(data ?? []).map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
              }}
            >
              <button
                className="btn ghost small"
                style={{ textAlign: "left" }}
                onClick={() => onDownload(doc)}
                title="Open / download"
              >
                {doc.name}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="muted small">
                  {bytesLabel(doc.size_bytes)} · {formatDate(doc.created_at)}
                </span>
                <button
                  className="row-icon-btn danger"
                  title="Delete"
                  onClick={() => onDelete(doc)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
        <datalist id="job-locodes">
          {LOCODES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.city}, {l.country}
            </option>
          ))}
        </datalist>
        <div className="grid2">
          <div className="field">
            <label>Reference</label>
            <input
              name="po_no"
              defaultValue={job.po_no ?? ""}
              placeholder="Customer ref / PO"
              autoFocus
            />
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
            <label>Carrier</label>
            <input name="shipping_line" defaultValue={job.shipping_line ?? ""} />
          </div>
          <div className="field">
            <label>Agent/Airline</label>
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
            <label>PDD</label>
            <input
              type="date"
              name="provisional_delivery_date"
              defaultValue={job.provisional_delivery_date ?? ""}
            />
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
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
