import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCan,
  useCompanySettings,
  useDocumentTypes,
  useJobs,
  useShipmentDocumentsForJobs,
  useUpdateCompanySettings,
} from "../../lib/hooks";
import { getShipmentDocumentUrl } from "../../lib/db";
import { DOCUMENT_TYPES_LIST } from "../../lib/docTemplates";
import { formatDate } from "../../lib/format";
import { isShipmentComplete, type Job } from "../../lib/types";

interface VaultRow {
  id: string;
  source: "generated" | "uploaded";
  title: string;
  type: string;
  job: Job;
  date: string;
  size: number | null;
  visible: boolean | null;
  slug?: string;
  storagePath?: string;
}

function bytesLabel(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Control Tower › Document Vault: every document in one list — the generated
 * paperwork for each active shipment (Delivery Release Order, Arrival
 * Notification, …) and every file uploaded to any shipment — each with View.
 * "Document titles" edits the titles the generated documents print (0140).
 */
export default function DocumentVaultTab() {
  const jobsQ = useJobs();
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const docsQ = useShipmentDocumentsForJobs(jobIds);
  const docTypes = useDocumentTypes();
  const can = useCan();
  const { error } = useToast();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "generated" | "uploaded">("all");
  const [type, setType] = useState("");
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const rows = useMemo<VaultRow[]>(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const generated: VaultRow[] = jobs
      .filter((j) => !isShipmentComplete(j))
      .flatMap((j) =>
        docTypes.map((d) => ({
          id: `gen:${j.id}:${d.slug}`,
          source: "generated" as const,
          title: d.title,
          type: d.title,
          job: j,
          date: j.created_at,
          size: null,
          visible: null,
          slug: d.slug,
        })),
      );
    const uploaded: VaultRow[] = (docsQ.data ?? []).flatMap((d) => {
      const j = byId.get(d.job_id);
      if (!j) return [];
      return [
        {
          id: `file:${d.id}`,
          source: "uploaded" as const,
          title: d.name,
          type: d.doc_type || "Other",
          job: j,
          date: d.created_at,
          size: d.size_bytes,
          visible: d.visible_to_client,
          storagePath: d.storage_path,
        },
      ];
    });
    return [...uploaded, ...generated];
  }, [jobs, docsQ.data, docTypes]);

  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows]);
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (source === "all" || r.source === source) &&
      (!type || r.type === type) &&
      (!q ||
        [r.title, r.type, r.job.reference, r.job.client?.company, r.job.po_no, r.job.awb_mbl, r.job.container_no]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );

  async function view(r: VaultRow) {
    if (r.source === "generated") {
      window.open(`/jobs/${r.job.id}/documents/${r.slug}/print`, "_blank", "noopener");
      return;
    }
    // Open the tab first (popup blockers), then point it at the signed URL.
    const tab = window.open("", "_blank");
    try {
      const url = await getShipmentDocumentUrl(r.storagePath!);
      if (tab) tab.location.href = url;
    } catch (e) {
      tab?.close();
      error(e instanceof Error ? e.message : "Could not open document");
    }
  }

  const columns: DataColumn<VaultRow>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 80,
      render: (r) => (
        <button
          className="btn outline btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            void view(r);
          }}
        >
          View
        </button>
      ),
    },
    { key: "doc", header: "Document", width: 260, render: (r) => <b>{r.title}</b>, sortValue: (r) => r.title },
    { key: "type", header: "Type", width: 170, render: (r) => r.type, sortValue: (r) => r.type },
    {
      key: "source",
      header: "Source",
      width: 110,
      render: (r) => (
        <span className={`badge ${r.source === "generated" ? "sent" : "open"}`}>
          {r.source === "generated" ? "Generated" : "Uploaded"}
        </span>
      ),
      sortValue: (r) => r.source,
    },
    { key: "shipment", header: "Shipment", width: 120, render: (r) => r.job.reference, sortValue: (r) => r.job.reference },
    { key: "client", header: "Customer", width: 190, render: (r) => r.job.client?.company ?? "—", sortValue: (r) => r.job.client?.company ?? "" },
    { key: "mode", header: "Mode", width: 150, render: (r) => r.job.mode, sortValue: (r) => r.job.mode },
    { key: "status", header: "Shipment status", width: 140, render: (r) => r.job.shipment_status || "—", defaultHidden: true },
    { key: "date", header: "Date", width: 100, render: (r) => formatDate(r.date), sortValue: (r) => r.date },
    { key: "size", header: "Size", width: 80, render: (r) => bytesLabel(r.size), sortValue: (r) => r.size ?? 0 },
    {
      key: "portal",
      header: "In portal",
      width: 90,
      render: (r) => (r.visible == null ? "—" : r.visible ? "Yes" : "No"),
    },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search document, shipment, customer…" />}
        filters={
          <>
            <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} style={{ width: "auto" }}>
              <option value="all">All documents</option>
              <option value="generated">Generated</option>
              <option value="uploaded">Uploaded</option>
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto" }}>
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </>
        }
        count={jobsQ.isLoading ? undefined : `${filtered.length} document${filtered.length === 1 ? "" : "s"}`}
        hint="Generated documents (for every active shipment) open ready to print or save as PDF; uploaded files open from the shipment's documents."
        onToolsSlot={setToolsSlot}
      >
        {can("settings") && (
          <button className="btn outline" onClick={() => setTitlesOpen(true)}>
            Document titles
          </button>
        )}
      </PageTools>
      <div className="panel">
        {jobsQ.isLoading || docsQ.isLoading ? (
          <Loading />
        ) : jobsQ.isError ? (
          <ErrorNote error={jobsQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>{rows.length === 0 ? "No documents yet." : "No documents match."}</EmptyState>
        ) : (
          <DataTable
            tableKey="document-vault"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => void view(r)}
          />
        )}
      </div>
      {titlesOpen && <DocTitlesModal onClose={() => setTitlesOpen(false)} />}
    </>
  );
}

/** Edits the title each generated document prints (company-wide, 0140). */
function DocTitlesModal({ onClose }: { onClose: () => void }) {
  const settingsQ = useCompanySettings();
  const update = useUpdateCompanySettings();
  const { toast, error } = useToast();
  const current = settingsQ.data?.doc_titles ?? {};

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const titles: Record<string, string> = {};
    for (const d of DOCUMENT_TYPES_LIST) {
      const v = String(f.get(d.slug) ?? "").trim();
      if (v && v !== d.title) titles[d.slug] = v;
    }
    update.mutate(
      { doc_titles: titles },
      {
        onSuccess: () => {
          toast("Document titles saved");
          onClose();
        },
        onError: (er) => error(er.message),
      },
    );
  }

  return (
    <Modal title="Document titles" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        The title printed at the top of each generated document (and used in the Vault, the shipment's Documents and Comms
        attachments). Leave a field empty to go back to the standard title.
      </p>
      <form onSubmit={submit}>
        {DOCUMENT_TYPES_LIST.map((d) => (
          <div className="field" key={d.slug}>
            <label>{d.title}</label>
            <input name={d.slug} defaultValue={current[d.slug] ?? d.title} placeholder={d.title} />
          </div>
        ))}
        <div className="modal-foot-row">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save titles"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
