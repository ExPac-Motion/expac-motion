import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { useToast } from "../../components/Toast";
import { useMyJobs } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import { usePortalItemActions, usePortalItems, usePortalQuotes, type PortalItem, type PortalItemInput } from "../../lib/portal";

type Tab = "task" | "note";
type Show = "open" | "done" | "all";
const STATUS: Record<PortalItem["status"], string> = { open: "Open", doing: "In progress", done: "Done" };

/**
 * Customer Portal › Tasks & Notes (0154). Private items are the customer's
 * own notebook (ExPac can't see them); shared ones live in Motion's Tasks &
 * Notes, so ExPac sees and works them, and ExPac can share its own with the
 * customer. Each can be linked to a shipment, a quotation or nothing.
 */
export default function PortalTasksPage() {
  const itemsQ = usePortalItems();
  const jobsQ = useMyJobs();
  const quotesQ = usePortalQuotes();
  const act = usePortalItemActions();
  const { toast, error } = useToast();
  const [tab, setTab] = useState<Tab>("task");
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PortalItem | "new" | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const jobRef = useMemo(() => new Map((jobsQ.data ?? []).map((j) => [j.id, j.reference])), [jobsQ.data]);
  const quoteRef = useMemo(() => new Map((quotesQ.data ?? []).map((q) => [q.id, q.reference])), [quotesQ.data]);
  const linkOf = (i: PortalItem) =>
    i.job_id ? i.job_reference ?? jobRef.get(i.job_id) ?? "Shipment" : i.quote_id ? i.quote_reference ?? quoteRef.get(i.quote_id) ?? "Quotation" : "";

  const all = itemsQ.data ?? [];
  const n = search.trim().toLowerCase();
  const rows = all.filter(
    (i) =>
      i.kind === tab &&
      (tab === "note" || show === "all" || (show === "done" ? i.status === "done" : i.status !== "done")) &&
      (!n || [i.title, i.body, linkOf(i)].join(" ").toLowerCase().includes(n)),
  );
  const openTasks = all.filter((i) => i.kind === "task" && i.status !== "done").length;

  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast(ok)).catch((e: Error) => error(e.message));

  const columns: DataColumn<PortalItem>[] = [
    {
      key: "title",
      header: tab === "task" ? "Task" : "Note",
      width: 320,
      render: (i) => (
        <span>
          <b>{i.title}</b>
          {i.body && i.body !== i.title ? <span className="hint"> · {i.body}</span> : null}
        </span>
      ),
      sortValue: (i) => i.title,
    },
    {
      key: "link",
      header: "Linked to",
      width: 140,
      render: (i) => (linkOf(i) ? <span className="ref-link">{linkOf(i)}</span> : "General"),
      sortValue: (i) => linkOf(i),
    },
    ...(tab === "task"
      ? ([
          { key: "due", header: "Due", width: 100, render: (i) => formatDate(i.due_date), sortValue: (i) => i.due_date ?? "" },
          {
            key: "status",
            header: "Status",
            width: 110,
            render: (i) => <span className={`badge ${i.status === "done" ? "accepted" : i.status === "doing" ? "sent" : "open"}`}>{STATUS[i.status]}</span>,
            sortValue: (i) => i.status,
          },
        ] as DataColumn<PortalItem>[])
      : []),
    {
      key: "who",
      header: "From",
      width: 90,
      render: (i) => (i.mine ? "You" : "ExPac"),
    },
    {
      key: "shared",
      header: "Visibility",
      width: 150,
      render: (i) => (i.shared ? "🔗 Shared with ExPac" : "🔒 Private"),
      sortValue: (i) => (i.shared ? 1 : 0),
    },
    { key: "created", header: "Added", width: 100, render: (i) => formatDate(i.created_at), sortValue: (i) => i.created_at },
    {
      key: "actions",
      header: "",
      width: 250,
      render: (i) =>
        i.mine ? (
          <span style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            {i.kind === "task" && (
              <button
                type="button"
                className="btn outline btn-sm"
                onClick={() => run(act.update.mutateAsync({ item: i, patch: { status: i.status === "done" ? "open" : "done" } }), i.status === "done" ? "Reopened" : "Marked done")}
              >
                {i.status === "done" ? "Reopen" : "Done"}
              </button>
            )}
            {i.shared ? (
              <button type="button" className="btn outline btn-sm" onClick={() => run(act.unshare.mutateAsync(i), "Made private, ExPac no longer sees it")}>
                Make private
              </button>
            ) : (
              <button type="button" className="btn outline btn-sm" onClick={() => run(act.share.mutateAsync(i), "Shared with ExPac")}>
                Share with ExPac
              </button>
            )}
            <button
              type="button"
              className="btn outline warn btn-sm"
              onClick={() => {
                if (confirm(`Delete this ${i.kind}?`)) void run(act.remove.mutateAsync(i), "Deleted");
              }}
            >
              Delete
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Tasks & Notes"
        actions={
          <button className="btn" onClick={() => setEditing("new")}>
            + New {tab === "task" ? "task" : "note"}
          </button>
        }
      />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder={tab === "task" ? "Search tasks…" : "Search notes…"} />}
        filters={
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="wms-seg">
              <button type="button" className={tab === "task" ? "active" : ""} onClick={() => setTab("task")}>
                ✅ Tasks{openTasks ? ` (${openTasks})` : ""}
              </button>
              <button type="button" className={tab === "note" ? "active" : ""} onClick={() => setTab("note")}>
                📝 Notes
              </button>
            </div>
            {tab === "task" && (
              <div className="wms-seg">
                {(["open", "done", "all"] as Show[]).map((x) => (
                  <button key={x} type="button" className={show === x ? "active" : ""} onClick={() => setShow(x)}>
                    {x === "open" ? "Open" : x === "done" ? "Done" : "All"}
                  </button>
                ))}
              </div>
            )}
          </span>
        }
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {itemsQ.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState>
            {tab === "task"
              ? "No tasks here. Add one for yourself, or share it with ExPac so the team picks it up."
              : "No notes yet. Keep them private, or share them with ExPac."}
          </EmptyState>
        ) : (
          <DataTable
            tableKey={`portal-${tab}s`}
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(i) => i.id}
            onRowClick={(i) => (i.mine ? setEditing(i) : undefined)}
          />
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        🔒 Private items are only seen by your company's portal logins. 🔗 Shared items go to the ExPac team, who see and action them in Motion.
      </p>
      {editing && (
        <ItemModal
          kind={tab}
          item={editing === "new" ? null : editing}
          jobs={(jobsQ.data ?? []).map((j) => ({ id: j.id, label: `${j.reference}, ${j.origin ?? ""} → ${j.destination ?? ""}` }))}
          quotes={(quotesQ.data ?? []).map((q) => ({ id: q.id, label: `${q.reference}, ${q.mode}` }))}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ItemModal({
  kind,
  item,
  jobs,
  quotes,
  onClose,
}: {
  kind: Tab;
  item: PortalItem | null;
  jobs: { id: string; label: string }[];
  quotes: { id: string; label: string }[];
  onClose: () => void;
}) {
  const act = usePortalItemActions();
  const { toast, error } = useToast();
  const k = item?.kind ?? kind;
  const [v, setV] = useState<PortalItemInput>({
    kind: k,
    title: item?.title ?? "",
    body: item?.body ?? "",
    due_date: item?.due_date ?? "",
    job_id: item?.job_id ?? "",
    quote_id: item?.quote_id ?? "",
    share: item ? item.shared : k === "task",
  });
  const link = v.job_id ? `j:${v.job_id}` : v.quote_id ? `q:${v.quote_id}` : "";
  const busy = act.add.isPending || act.update.isPending;

  async function save() {
    try {
      if (!item) {
        await act.add.mutateAsync(v);
        toast(v.share ? `${k === "task" ? "Task" : "Note"} shared with ExPac` : `Private ${k} saved`);
      } else {
        await act.update.mutateAsync({ item, patch: { title: v.title.trim() || item.title, body: v.body, due_date: v.due_date || null } });
        toast("Saved");
      }
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Modal title={item ? `Edit ${k}` : k === "task" ? "New task" : "New note"} onClose={onClose}>
      <div className="field">
        <label>{k === "task" ? "What needs doing?" : "Title"}</label>
        <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus />
      </div>
      <div className="field">
        <label>{k === "task" ? "Details" : "Note"}</label>
        <textarea rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>Linked to</label>
          <select
            value={link}
            disabled={!!item}
            onChange={(e) => {
              const x = e.target.value;
              setV({ ...v, job_id: x.startsWith("j:") ? x.slice(2) : "", quote_id: x.startsWith("q:") ? x.slice(2) : "" });
            }}
          >
            <option value="">General (no shipment or quotation)</option>
            {jobs.length > 0 && (
              <optgroup label="Shipments">
                {jobs.map((j) => (
                  <option key={j.id} value={`j:${j.id}`}>
                    {j.label}
                  </option>
                ))}
              </optgroup>
            )}
            {quotes.length > 0 && (
              <optgroup label="Quotations">
                {quotes.map((q) => (
                  <option key={q.id} value={`q:${q.id}`}>
                    {q.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {k === "task" && (
          <div className="field">
            <label>Due date</label>
            <DateInput value={v.due_date} onChange={(d) => setV({ ...v, due_date: d })} />
          </div>
        )}
      </div>
      {!item && (
        <label className="check">
          <input type="checkbox" checked={v.share} onChange={(e) => setV({ ...v, share: e.target.checked })} /> 🔗 Share with ExPac (the team sees
          and actions it in Motion). Untick to keep it 🔒 private.
        </label>
      )}
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
