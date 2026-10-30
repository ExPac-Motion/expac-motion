import { useJobHouses, useSetDocumentHouse } from "../lib/houses";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import DateInput from "../components/DateInput";
import DataTable, { type DataColumn } from "../components/DataTable";
import TaskEditModal from "./ops/TaskEditModal";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  PageTools,
  RowActions,
  RowActionsHead,
  useDeepLinkReturn,
  useRowSelection,
  SearchInput,
} from "../components/common";
import { useToast } from "../components/Toast";
import {
  useCreateJob,
  useCreateQuoteForJob,
  useDeleteJob,
  useDuplicateJobQuote,
  useDeleteShipmentDocument,
  useJobs,
  useMarkJobMessagesRead,
  useOpsTasks,
  useSetJobMilestone,
  refreshShipmentData,
  useShipmentDocuments,
  useUnreadMessages,
  useEmailsSentToday,
  useUpdateJob,
  useUpdateJobsBulk,
  useUpdateShipmentDocument,
  useUploadShipmentDocument,
  useCan,
  useDocumentTypes,
} from "../lib/hooks";
import ConsolidateModal from "./wms/ConsolidateModal";
import PodModal from "../components/PodModal";
import ShipmentQuickUpdate from "../components/ShipmentQuickUpdate";
import { notifyText, stepLabel, timelineDb, timelineSteps } from "../lib/timeline";
import StatusDateModal, { type StatusDateInput } from "../components/StatusDateModal";
import { ALL_STEPS } from "../lib/steps";
import { saveShipmentPod } from "../lib/pod";
import { useQueryClient } from "@tanstack/react-query";
import { useWmsConsols } from "../lib/wms";
import { houseLabel, houseNo, masterLabel } from "./wms/WmsConsols";
import { consolModeFor } from "./wms/houseFromShipment";
import { getShipmentDocumentUrl } from "../lib/db";
import { DOCUMENT_TYPES_LIST, carrierLabel } from "../lib/docTemplates";
import { formatDate, newReference, portCode } from "../lib/format";
import { LOCODES } from "../lib/locodes";
import { trackableRef } from "../lib/tracking";
import {
  DELIVERED_STATUS,
  isShipmentComplete,
  DOCUMENT_TYPES,
  MILESTONE_BY_STATUS,
  SHIPMENT_STATUSES,
  shipmentStatusSlug,
  type Job,
  type JobPatch,
  type ShipmentDocument,
} from "../lib/types";
import CommsRail from "./shipments/CommsRail";

/** "AWB" for air/courier, "MBL" for sea, "Ref" otherwise. */
export function docLabel(mode: string): string {
  if (mode.startsWith("Air") || mode.startsWith("Courier")) return "AWB No";
  if (mode.startsWith("Sea")) return "MBL No";
  return "Ref No";
}

/** Port fields on a job hold just the UN/LOCODE (e.g. "ZADUR"), not the
 *  "CODE, City, Country" string used on the quote. */
export function codeOf(s: string | null | undefined): string {
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
/** Days from today (local) to a YYYY-MM-DD date; negative once it's passed. */
function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** ETA is 5 days or less away, or already passed (arrived). */
function etaIsDue(eta: string | null | undefined): boolean {
  const n = daysUntil(eta);
  return n !== null && n <= 5;
}

/** Statuses at which clearance is done, nothing left to lodge before arrival. */
const CLEARED_STATUSES = new Set(["Released", "On-Delivery", "Delivered"]);

/**
 * ETA urgency on the Active board. "risk": ETA due (≤5 days / passed) with
 * work still outstanding, an open task, or not yet cleared (status before
 * Released). "due": ETA due but nothing outstanding. These are the shipments
 * where a pending clearance or delivery lodgement starts costing money.
 */
function etaUrgency(j: Job, hasOpenTask: boolean): "risk" | "due" | null {
  if (!etaIsDue(j.eta)) return null;
  const outstanding =
    hasOpenTask || !CLEARED_STATUSES.has(j.shipment_status ?? "");
  return outstanding ? "risk" : "due";
}

function JobDateCell({
  value,
  onCommit,
  title,
  className,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => void;
  title?: string;
  className?: string;
}) {
  return (
    <DateInput
      value={value ?? ""}
      className={className}
      title={title}
      onChange={onCommit}
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

/** One mode per family (sea, air, courier, road) for naming the steps. */
const MODE_SAMPLES = ["Sea Freight (LCL)", "Air Freight (AIR)", "Courier Express (CX)", "Road Freight (RDX)"];

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
  const navigate = useNavigate();
  const location = useLocation();
  const { data: jobs, isLoading, isError, error } = useJobs();
  const updateJob = useUpdateJob();
  const bulkUpdate = useUpdateJobsBulk();
  const deleteJob = useDeleteJob();
  const createJob = useCreateJob();
  const duplicateJobQuote = useDuplicateJobQuote();
  const setMilestone = useSetJobMilestone();
  const { toast, error: toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const modeTab = modeTabFromParam(params.get("mode"));
  // Status filter and search are part of the address (?status=, ?q=), so
  // opening a shipment and going Back returns to the same filtered list.
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  const [commsJob, setCommsJob] = useState<Job | null>(null);
  // Scroll position per view (board + tab + filter + search), restored on
  // Back. The list scrolls inside its own box (.table-wrap, up and across),
  // so that box is remembered as well as the page. Saved as you scroll:
  // on leaving, the grid is already gone from the page.
  const scrollKey = `jobs-scroll:${mode}:${location.search}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRestored = useRef(false);
  const gridBox = () => panelRef.current?.querySelector<HTMLElement>(".table-wrap") ?? null;
  useEffect(() => {
    if (!jobs || scrollRestored.current) return;
    scrollRestored.current = true;
    let saved: { x?: number; y?: number; page?: number } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(scrollKey) || "{}");
    } catch {
      /* storage blocked */
    }
    requestAnimationFrame(() => {
      if (saved.page) window.scrollTo(0, saved.page);
      const box = gridBox();
      if (box) box.scrollTo(saved.x ?? 0, saved.y ?? 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
  useEffect(() => {
    const panel = panelRef.current;
    let frame = 0;
    const remember = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = gridBox();
        try {
          sessionStorage.setItem(
            scrollKey,
            JSON.stringify({ x: box?.scrollLeft ?? 0, y: box?.scrollTop ?? 0, page: window.scrollY }),
          );
        } catch {
          /* storage blocked */
        }
      });
    };
    // Scroll doesn't bubble: listen in the capture phase for the grid box.
    panel?.addEventListener("scroll", remember, true);
    window.addEventListener("scroll", remember);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      panel?.removeEventListener("scroll", remember, true);
      window.removeEventListener("scroll", remember);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);
  // Pre-filled message for the rail's next email (Notify customer).
  const [commsRemarks, setCommsRemarks] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [quickJob, setQuickJob] = useState<Job | null>(null);
  const [taskingJob, setTaskingJob] = useState<Job | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [consolidating, setConsolidating] = useState<Job[] | null>(null);
  // Proof of delivery (0151): asked for when a shipment is set to Delivered.
  const [podJob, setPodJob] = useState<Job | null>(null);
  // Status picked in the grid, waiting for its date (StatusDateModal).
  const [statusJob, setStatusJob] = useState<{ job: Job; status: string } | null>(null);
  const qc = useQueryClient();
  const canWms = useCan()("warehouse");
  const unreadMessagesQ = useUnreadMessages();
  const unreadJobIds = useMemo(
    () => new Set((unreadMessagesQ.data ?? []).map((m) => m.job_id)),
    [unreadMessagesQ.data],
  );
  const markRead = useMarkJobMessagesRead();
  // Daily Shipment Comms: shipments with no email to the customer since
  // midnight get an orange envelope (Active Shipments only).
  const sentTodayQ = useEmailsSentToday();
  const mailedToday = useMemo(() => {
    const domain = (e: string) => e.trim().toLowerCase().split("@")[1] ?? "";
    const byJob = new Map<string, string[]>();
    for (const m of sentTodayQ.data ?? [])
      byJob.set(m.job_id, [...(byJob.get(m.job_id) ?? []), ...(m.to_emails ?? []), ...(m.cc_emails ?? [])]);
    const set = new Set<string>();
    for (const j of jobs ?? []) {
      const to = byJob.get(j.id);
      if (!to || to.length === 0) continue;
      const ce = (j.client?.email ?? "").trim().toLowerCase();
      // To the customer (their address or company domain); no customer email = any.
      if (!ce || to.some((e) => e.trim().toLowerCase() === ce || domain(e) === domain(ce))) set.add(j.id);
    }
    return set;
  }, [sentTodayQ.data, jobs]);
  const tasksQ = useOpsTasks();
  const openTaskJobIds = useMemo(
    () =>
      new Set(
        (tasksQ.data ?? [])
          .filter((t) => t.kind === "task" && t.status !== "done" && t.job_id)
          .map((t) => t.job_id as string),
      ),
    [tasksQ.data],
  );

  const { closeAndReturn } = useDeepLinkReturn();
  const search = params.get("q") ?? "";
  const setSearch = (v: string) => setParam("q", v);
  const statusPick = params.get("status") ?? "";
  const setStatusPick = (v: string) => setParam("status", v);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  // The record filter (At risk, chips from Control Tower) is in the address
  // too (?f=), so Back keeps it.
  type RecordFilter = "nostatus" | "notracking" | "atrisk" | "uninvoiced";
  const recordFilter = (params.get("f") as RecordFilter | null) || null;
  const setRecordFilter = (v: RecordFilter | null) => setParam("f", v ?? "");

  function openComms(j: Job, remarks = "") {
    setCommsJob(j);
    setCommsRemarks(remarks);
    setRailOpen(true);
    if (unreadJobIds.has(j.id)) markRead.mutate(j.id);
  }

  // Deep-link from a Notification: navigate here with
  // { state: { openJobId, openComms? } } to pop the shipment's view modal
  // (or its Comms rail for a message notification) open directly, instead
  // of landing on the board and having to search for it. Closing whichever
  // one opened then returns to Notifications instead of stranding the user
  // on the board.
  useEffect(() => {
    const state = location.state as
      | { openJobId?: string; openComms?: boolean }
      | null;
    if (!state?.openJobId || !jobs?.length) return;
    // Old links (openJobId) now open the shipment's workspace page.
    navigate(`/jobs/${state.openJobId}${state.openComms ? "?comms=1" : ""}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, jobs]);

  // Deep-link from a Control Tower chip: navigate here with
  // { state: { filter: "nostatus" | "notracking" } } to land pre-filtered to
  // just the shipments that chip counted, instead of the full board.
  useEffect(() => {
    const state = location.state as
      | { filter?: "nostatus" | "notracking" | "uninvoiced" }
      | null;
    if (!state?.filter) return;
    const next = new URLSearchParams(location.search);
    next.set("f", state.filter);
    navigate(`${location.pathname}?${next}`, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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
      // With a quote: copy the quote too and open the copy in the Quote
      // Builder, the new shipment is created linked to it.
      if (j.quote_id) {
        const newQuoteId = await duplicateJobQuote.mutateAsync(j);
        if (newQuoteId) {
          toast("Shipment duplicated with its quote");
          navigate(`/quotes/${newQuoteId}`);
          return;
        }
      }
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
      navigate(`/jobs/${created.id}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not duplicate shipment");
    }
  }

  // Active until Admin marks it Ops Complete (0199); Delivered alone stays here.
  const stageRows = (jobs ?? []).filter((j) => (mode === "completed") === isShipmentComplete(j));
  // Quick search: shipment no., customer, shipper, PO / reference, AWB/MBL,
  // container, vessel, carrier, ports, notes.
  const q = search.trim().toLowerCase();
  // Status dropdown (header band): one Shipment Status, "" = all.
  const statusCounts = new Map<string, number>();
  for (const j of stageRows.filter((x) => matchesModeTab(x.mode, modeTab))) {
    const k = j.shipment_status || "__none";
    statusCounts.set(k, (statusCounts.get(k) ?? 0) + 1);
  }
  // Every timeline status by its full name, in timeline order. On All
  // Shipments a step named differently per mode is listed once per name
  // (Received at CFS / Received at airline / Received at hub ...) and
  // filters just those shipments. Plus any older status still on a
  // shipment here (e.g. In Transit) so it can be found.
  const tabRows = stageRows.filter((x) => matchesModeTab(x.mode, modeTab));
  const statusOpts: { value: string; label: string; test: (j: Job) => boolean }[] = [];
  const stepList = modeTab === "All" ? ALL_STEPS : timelineSteps(modeTab);
  for (const st of stepList) {
    if (modeTab !== "All") {
      statusOpts.push({ value: st, label: stepLabel(st, modeTab), test: (j) => j.shipment_status === st });
      continue;
    }
    const labels = [...new Set(MODE_SAMPLES.filter((m) => timelineSteps(m).includes(st)).map((m) => stepLabel(st, m)))];
    if (labels.length === 1) {
      statusOpts.push({ value: st, label: labels[0], test: (j) => j.shipment_status === st });
    } else {
      for (const l of labels)
        statusOpts.push({
          value: `${st}::${l}`,
          label: l,
          test: (j) => j.shipment_status === st && stepLabel(st, j.mode) === l,
        });
    }
  }
  for (const k of statusCounts.keys())
    if (k !== "__none" && !stepList.includes(k))
      statusOpts.push({ value: k, label: k, test: (j) => j.shipment_status === k });
  const pickOpt = statusOpts.find((o) => o.value === statusPick);
  const modeRows = stageRows
    .filter((j) =>
      !statusPick ||
      (statusPick === "__none" ? !j.shipment_status : pickOpt ? pickOpt.test(j) : j.shipment_status === statusPick),
    )
    .filter((j) => matchesModeTab(j.mode, modeTab))
    .filter(
      (j) =>
        !q ||
        [
          j.reference,
          j.client?.company,
          j.supplier?.company,
          j.po_no,
          j.awb_mbl,
          j.container_no,
          j.vessel_name,
          j.carrier_name,
          j.origin,
          j.destination,
          j.notes,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
    );
  const rows =
    recordFilter === "nostatus"
      ? modeRows.filter((j) => !j.shipment_status || j.shipment_status === "Booked")
      : recordFilter === "notracking"
        ? modeRows.filter((j) => !trackableRef(j))
        : recordFilter === "uninvoiced"
          ? modeRows.filter((j) => !j.invoiced_at)
          : recordFilter === "atrisk"
          ? modeRows.filter((j) => etaUrgency(j, openTaskJobIds.has(j.id)) === "risk")
          : modeRows;
  const atRiskCount =
    mode === "active"
      ? modeRows.filter((j) => etaUrgency(j, openTaskJobIds.has(j.id)) === "risk")
          .length
      : 0;
  const modeLabel = MODE_TABS.find((t) => t.key === modeTab)?.label ?? "";
  const sel = useRowSelection(jobs ?? [], rows);

  function save(id: string, patch: JobPatch) {
    const toDone = patch.shipment_status === DELIVERED_STATUS;
    if (toDone) {
      const j = (jobs ?? []).find((x) => x.id === id);
      if (j && !j.pod_signed_by && !j.pod_delivered_at) setPodJob(j);
    }
    updateJob.mutate(
      { id, patch },
      {
        onSuccess: () =>
          toast(
            toDone
              ? "Shipment delivered. It stays on Active Shipments until Admin marks it Ops Complete"
              : "Shipment updated",
          ),
        onError: (e) =>
          toastError(e instanceof Error ? e.message : "Could not save"),
      },
    );

    // Advance the milestone funnel (+ log a job_events row) whenever the
    // Shipment Status moves into a different stage, nothing else does this.
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

  /** Status picked on the board, with its date from the pop-up: save the
   *  status, then put the date (and note) on that timeline step. */
  async function saveStatus(j: Job, status: string, input: StatusDateInput) {
    try {
      await updateJob.mutateAsync({ id: j.id, patch: { shipment_status: status } });
      const step = (await timelineDb.steps(j.id)).find((s) => s.step === status);
      if (step && (step.actual_date !== input.date || input.note)) {
        await timelineDb.set({
          stepId: step.id,
          patch: { actual_date: input.date, ...(input.note ? { note: input.note } : {}) },
        });
      }
      const milestone = MILESTONE_BY_STATUS[status];
      if (milestone) {
        setMilestone.mutate({ jobId: j.id, milestone, note: `Shipment Status set to "${status}"` });
      }
      refreshShipmentData(qc);
      if (status === DELIVERED_STATUS) {
        toast("Shipment delivered. It stays on Active Shipments until Admin marks it Ops Complete");
        if (!j.pod_signed_by && !j.pod_delivered_at) setPodJob(j);
      } else {
        toast(`${j.reference} moved to ${stepLabel(status, j.mode)}`);
      }
      if (input.email) openComms(j, notifyText(j.mode, { step: status, date: input.date }));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
      throw e;
    }
  }

  const copy = COPY[mode];

  const jobCols = useMemo<DataColumn<Job>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 220,
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
            mailUnread={unreadJobIds.has(j.id)}
            mailDue={mode === "active" && !sentTodayQ.isLoading && !mailedToday.has(j.id)}
            onTask={() => setTaskingJob(j)}
            taskTitle="Create a task for this shipment"
            taskOpen={openTaskJobIds.has(j.id)}
            onView={() => navigate(`/jobs/${j.id}`)}
            viewTitle="Open the shipment"
            onEdit={() => setQuickJob(j)}
            editTitle="Quick update: move it on, dates, missing details"
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
            <Link className="job-ref" to={`/quotes/${j.quote_id}/view`}>
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
            onChange={(e) =>
              e.target.value
                ? setStatusJob({ job: j, status: e.target.value })
                : save(j.id, { shipment_status: "" })
            }
          >
            <option value="">— set status —</option>
            {/* This mode's timeline steps (0196); an older status outside
                the list (e.g. In Transit) stays selectable as it is. */}
            {j.shipment_status && !timelineSteps(j.mode).includes(j.shipment_status) && (
              <option value={j.shipment_status}>{j.shipment_status}</option>
            )}
            {timelineSteps(j.mode).map((s) => (
              <option key={s} value={s}>
                {stepLabel(s, j.mode)}
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
        header: "Shipping Line",
        width: 150,
        sortValue: (j) => j.shipping_line ?? "",
        render: (j) => j.shipping_line || "—",
      },
      {
        key: "carrier_name",
        header: "Airline",
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
        render: (j) => {
          // Active board only: flag shipments arriving within 5 days or
          // already past their ETA.
          const level =
            mode === "active" ? etaUrgency(j, openTaskJobIds.has(j.id)) : null;
          const n = daysUntil(j.eta);
          const when =
            n === null
              ? ""
              : n < 0
                ? `ETA passed ${-n} day${n === -1 ? "" : "s"} ago`
                : n === 0
                  ? "Arriving today"
                  : `Arriving in ${n} day${n === 1 ? "" : "s"}`;
          return (
            <JobDateCell
              value={j.eta}
              className={
                level === "risk"
                  ? "job-eta is-risk"
                  : level === "due"
                    ? "job-eta is-due"
                    : undefined
              }
              title={
                level === "risk"
                  ? `${when}, work outstanding (open task or not yet cleared)`
                  : level === "due"
                    ? `${when}, nothing outstanding`
                    : undefined
              }
              onCommit={(v) => save(j.id, { eta: v })}
            />
          );
        },
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
        key: "invoiced_at",
        header: "Invoiced",
        width: 120,
        sortValue: (j) => j.invoiced_at ?? "",
        render: (j) => (
          <JobDateCell
            value={j.invoiced_at}
            title="Date invoiced, blank = not yet invoiced"
            onCommit={(v) => save(j.id, { invoiced_at: v })}
          />
        ),
      },
      {
        key: "invoice_no",
        header: "Invoice No",
        width: 120,
        sortValue: (j) => j.invoice_no ?? "",
        render: (j) => (
          <JobTextCell
            value={j.invoice_no}
            placeholder="—"
            onCommit={(v) => save(j.id, { invoice_no: v })}
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
    [sel, mode, modeTab, unreadJobIds, openTaskJobIds, mailedToday, sentTodayQ.isLoading],
  );

  return (
    <>
      <div className={railOpen ? "board-shift" : ""}>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} />

      <PageTools
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search shipment no., customer, shipper, PO…"
          />
        }
        filters={
          <>
          <select
            value={statusPick}
            onChange={(e) => setStatusPick(e.target.value)}
            aria-label="Filter by status"
            title="Show only shipments with this status"
            className={statusPick ? "status-pick-on" : undefined}
            style={{ width: "auto" }}
          >
            <option value="">All statuses ({stageRows.filter((x) => matchesModeTab(x.mode, modeTab)).length})</option>
            {statusOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({tabRows.filter(o.test).length})
              </option>
            ))}
            {mode !== "completed" && <option value="__none">No status ({statusCounts.get("__none") ?? 0})</option>}
          </select>
          {recordFilter && (
            <span className="topbar-filter">
              Filtered to{" "}
              <strong>
                {recordFilter === "nostatus"
                  ? "shipments without status"
                  : recordFilter === "uninvoiced"
                    ? "shipments not yet invoiced"
                    : recordFilter === "atrisk"
                      ? "at-risk shipments (ETA ≤5 days, work outstanding)"
                      : "shipments without a tracking no."}
              </strong>{" "}
              ·{" "}
              <button className="link-btn" onClick={() => setRecordFilter(null)}>
                clear
              </button>
            </span>
          )}
          </>
        }
        count={
          isLoading
            ? undefined
            : `${copy.sub(rows.length).split(" · ")[0]}${modeTab !== "All" ? ` · ${modeLabel}` : ""}`
        }
        onToolsSlot={setToolsSlot}
      >
        {mode === "active" && (
          <button
            className={`btn ${recordFilter === "atrisk" ? "at-risk-on" : "outline warn"}`}
            onClick={() =>
              setRecordFilter(recordFilter === "atrisk" ? null : "atrisk")
            }
            title="ETA within 5 days (or passed) with an open task or not yet cleared"
          >
            At risk ({atRiskCount})
          </button>
        )}
        <button
          className="btn outline bulk"
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
        {canWms && mode === "active" && (
          <button
            className="btn outline"
            onClick={() => setConsolidating((jobs ?? []).filter((j) => sel.isSelected(j.id)))}
            disabled={sel.count === 0}
            title={
              sel.count === 0
                ? "Tick air or sea shipments to put them as houses (HAWB / HBL) on a master (MAWB / MBL)"
                : "Put the ticked shipments on a master (MAWB / MBL)"
            }
          >
            Consolidate{sel.count ? ` (${sel.count})` : ""}
          </button>
        )}
      </PageTools>

      <div className="panel jobs-panel" ref={panelRef}>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {q
              ? `No shipments match "${search.trim()}".`
              : statusPick
              ? `No shipments with status ${statusPick === "__none" ? "not set" : `"${pickOpt?.label ?? statusPick}"`} in this view.`
              : recordFilter
              ? "Nothing matches that filter, every shipment in this view has one."
              : modeTab !== "All" && stageRows.length > 0
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
            toolsPortal={toolsSlot}
          />
        )}
      </div>
      </div>

      <CommsRail
        job={(jobs ?? []).find((x) => x.id === commsJob?.id) ?? commsJob}
        open={railOpen}
        initialRemarks={commsRemarks}
        onToggle={() =>
          railOpen
            ? closeAndReturn(() => setRailOpen(false))
            : setRailOpen(true)
        }
      />

      {quickJob && (
        <ShipmentQuickUpdate
          job={(jobs ?? []).find((x) => x.id === quickJob.id) ?? quickJob}
          onClose={() => closeAndReturn(() => setQuickJob(null))}
          onDelivered={() => {
            const j = (jobs ?? []).find((x) => x.id === quickJob.id) ?? quickJob;
            if (!j.pod_signed_by && !j.pod_delivered_at) setPodJob(j);
          }}
          onEmail={(m) => openComms((jobs ?? []).find((x) => x.id === quickJob.id) ?? quickJob, m)}
        />
      )}

      {taskingJob && (
        <TaskEditModal
          key={taskingJob.id}
          task={null}
          defaults={{
            job_id: taskingJob.id,
            client_id: taskingJob.client_id,
            title: `Follow up: ${taskingJob.reference}`,
          }}
          onClose={() => setTaskingJob(null)}
        />
      )}

      {podJob && <ShipmentPodModal job={podJob} onClose={() => setPodJob(null)} />}

      {statusJob && (
        <StatusDateModal
          job={statusJob.job}
          status={statusJob.status}
          onClose={() => setStatusJob(null)}
          onSave={(input) => saveStatus(statusJob.job, statusJob.status, input)}
        />
      )}
      {consolidating && (
        <ConsolidateModal
          jobs={consolidating}
          onClose={() => {
            setConsolidating(null);
            sel.clear();
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
            { key: "invoiced_at", label: "Invoiced (date)", type: "date" },
            {
              key: "shipment_status",
              label: "Shipment Status",
              type: "select",
              allowClear: false,
              // On a mode tab: that mode's timeline steps; All: every status.
              options:
                modeTab === "All"
                  ? SHIPMENT_STATUSES.map((s) => ({ value: s, label: s }))
                  : timelineSteps(modeTab).map((s) => ({ value: s, label: stepLabel(s, modeTab) })),
            },
            {
              key: "shipping_line",
              label: "Shipping Line",
              type: "text",
            },
            { key: "carrier_name", label: "Airline", type: "text" },
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
                  ? `${n} shipment${n === 1 ? "" : "s"} delivered, they stay active until Ops Complete`
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

/** For a shipment with no quote (e.g. duplicated before Duplicate copied
 *  quotes): builds a quote from the shipment's fields, links it, and opens it
 *  in the Quote Builder so its details can be completed. */
export function CreateQuoteForJob({ job, onDone }: { job: Job; onDone: () => void }) {
  const navigate = useNavigate();
  const createQuote = useCreateQuoteForJob();
  const { toast, error: toastError } = useToast();
  return (
    <p style={{ marginTop: 8 }}>
      <span className="hint">This shipment has no quotation. </span>
      <button
        type="button"
        className="btn small outline"
        disabled={createQuote.isPending}
        onClick={async () => {
          try {
            const quoteId = await createQuote.mutateAsync(job);
            toast("Quotation created and linked");
            onDone();
            navigate(`/quotes/${quoteId}`);
          } catch (e) {
            toastError(e instanceof Error ? e.message : "Could not create quotation");
          }
        }}
      >
        {createQuote.isPending ? "Creating…" : "Create quotation"}
      </button>
    </p>
  );
}

/** Which master (MAWB / MBL) this shipment travels on, as a house, or a
 *  button to put it on one (WMS consolidations, 0139). */
export function ConsolSection({ job }: { job: Job }) {
  const can = useCan();
  const navigate = useNavigate();
  const consolsQ = useWmsConsols();
  const [adding, setAdding] = useState(false);
  const mode = consolModeFor(job.mode);
  if (!can("warehouse") || !mode) return null;
  const on = (consolsQ.data ?? []).flatMap((c) =>
    c.houses.map((h, i) => ({ c, h, i })).filter(({ h }) => h.job_id === job.id),
  );
  return (
    <div className="job-consol">
      <span className="k">Master / consolidation</span>
      {on.length ? (
        on.map(({ c, h, i }) => (
          <button
            key={c.id}
            type="button"
            className="link-btn"
            onClick={() => navigate(`/wms/consols/${c.id}`)}
          >
            {houseLabel(c.mode)} {houseNo(c, h, i)} on {c.consol_no}
            {c.master_no ? `, ${masterLabel(c.mode)} ${c.master_no}` : ""} ({c.status})
          </button>
        ))
      ) : (
        <>
          <span className="hint">Ships on its own house document</span>
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
            Add to a master ({masterLabel(mode)})
          </button>
        </>
      )}
      {adding && <ConsolidateModal jobs={[job]} onClose={() => setAdding(false)} />}
    </div>
  );
}

function bytesLabel(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsSection({ job }: { job: Job }) {
  const { data, isLoading } = useShipmentDocuments(job.id);
  const upload = useUploadShipmentDocument();
  const updateDoc = useUpdateShipmentDocument();
  const del = useDeleteShipmentDocument();
  const { toast, error: toastError } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>(DOCUMENT_TYPES[0]);
  const [visibleToClient, setVisibleToClient] = useState(false);
  const docTypes = useDocumentTypes();
  const [printDoc, setPrintDoc] = useState<string>(DOCUMENT_TYPES_LIST[0].slug);
  // Master shipments (0164): a document can belong to one house.
  const housesQ = useJobHouses(job.id);
  const houses = housesQ.data ?? [];
  const setDocHouse = useSetDocumentHouse();
  const [forHouse, setForHouse] = useState<string>("");

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const doc = await upload.mutateAsync({ jobId: job.id, file, docType, visibleToClient });
      if (forHouse && doc?.id) await setDocHouse.mutateAsync({ docId: doc.id, jobId: job.id, houseId: forHouse });
      toast("Document uploaded");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not upload");
    }
  }

  async function onToggleVisible(doc: ShipmentDocument) {
    try {
      await updateDoc.mutateAsync({
        id: doc.id,
        jobId: job.id,
        patch: { visible_to_client: !doc.visible_to_client },
      });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not update");
    }
  }

  async function onDownload(doc: ShipmentDocument) {
    // Open the tab synchronously (still inside the click gesture) so the
    // browser doesn't block it as a popup once the signed URL is awaited.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
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
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <strong>Documents</strong>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={printDoc}
            onChange={(e) => setPrintDoc(e.target.value)}
            title="Document to print"
            style={{ width: "auto" }}
          >
            {docTypes.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.title}
              </option>
            ))}
          </select>
          <Link
            className="btn outline small"
            to={`/jobs/${job.id}/documents/${printDoc}/print`}
            target="_blank"
            rel="noopener"
          >
            Print
          </Link>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            title="Document type"
            style={{ width: "auto" }}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {houses.length > 0 && (
            <select value={forHouse} onChange={(e) => setForHouse(e.target.value)} title="Which house this document is for" style={{ width: "auto" }}>
              <option value="">Master {job.reference}</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.house_no}
                </option>
              ))}
            </select>
          )}
          <label
            className="check small"
            style={{ whiteSpace: "nowrap" }}
            title="Show this document in the customer's portal"
          >
            <input
              type="checkbox"
              checked={visibleToClient}
              onChange={(e) => setVisibleToClient(e.target.checked)}
            />
            Visible to customer
          </label>
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
                {doc.doc_type && (
                  <span className="muted small"> · {doc.doc_type}</span>
                )}
                {doc.from_client && <span className="badge sent" style={{ marginLeft: 6 }}>From customer</span>}
              </button>
              {houses.length > 0 && (
                <select
                  className="doc-house-tag"
                  value={doc.house_id ?? ""}
                  onChange={(e) => setDocHouse.mutate({ docId: doc.id, jobId: job.id, houseId: e.target.value || null })}
                  title="Which house this document is for"
                  style={{ width: "auto" }}
                >
                  <option value="">Master</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.house_no}
                    </option>
                  ))}
                </select>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="muted small">
                  {bytesLabel(doc.size_bytes)} · {formatDate(doc.created_at)}
                </span>
                <button
                  type="button"
                  className={`btn outline small${doc.visible_to_client ? " on" : ""}`}
                  title="Toggle visibility in the customer's portal"
                  onClick={() => onToggleVisible(doc)}
                >
                  {doc.visible_to_client ? "Visible to customer" : "Staff only"}
                </button>
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

/** Route & transport / Parties / References, each card editable in place.
 *  Shared by the View window and the shipment workspace page. */
export function ShipmentCards({
  job,
  onEmail,
  onLeave,
}: {
  job: Job;
  /** Opens the shipment's Comms rail (email is logged there). */
  onEmail: () => void;
  /** Called before following a link away (e.g. to the quotation). */
  onLeave?: () => void;
}) {
  const air = job.mode.startsWith("Air") || job.mode.startsWith("Courier");
  const sea = job.mode.startsWith("Sea");
  const [editCard, setEditCard] = useState<"route" | "refs" | null>(null);
  const onClose = () => onLeave?.();
  return (
        <div className="jv-cards">
          <div className="jv-card">
            <h4>
              Route &amp; transport
              {editCard !== "route" && (
                <button type="button" className="jv-edit" onClick={() => setEditCard("route")} title="Edit route & transport">
                  ✎
                </button>
              )}
            </h4>
            {editCard === "route" ? (
              <JvRouteEdit job={job} air={air} sea={sea} onDone={() => setEditCard(null)} />
            ) : (
              <>
                <div className="jv-route">
                  <b>{codeOf(job.origin) || "—"}</b>
                  <span aria-hidden>→</span>
                  <b>{codeOf(job.destination) || "—"}</b>
                </div>
                <JvField label="Mode" value={job.mode} />
                <JvField label={docLabel(job.mode)} value={job.awb_mbl} onAdd={() => setEditCard("route")} />
                {sea && (
                  <JvField
                    label="Container"
                    value={[job.container_no, job.container_type].filter(Boolean).join(" · ")}
                    onAdd={() => setEditCard("route")}
                  />
                )}
                {air ? (
                  <>
                    <JvField label="Airline" value={job.carrier_name} onAdd={() => setEditCard("route")} />
                    {job.shipping_line && <JvField label={carrierLabel(job.mode)} value={job.shipping_line} />}
                  </>
                ) : (
                  <JvField label={carrierLabel(job.mode)} value={job.shipping_line} onAdd={() => setEditCard("route")} />
                )}
                {sea && <JvField label="Vessel" value={job.vessel_name} onAdd={() => setEditCard("route")} />}
              </>
            )}
          </div>
          <div className="jv-card">
            <h4>Parties</h4>
            <JvParty label="Customer" p={job.client} onEmail={onEmail} />
            <JvParty label="Shipper" p={job.supplier} />
          </div>
          <div className="jv-card">
            <h4>
              References
              {editCard !== "refs" && (
                <button type="button" className="jv-edit" onClick={() => setEditCard("refs")} title="Edit references & notes">
                  ✎
                </button>
              )}
            </h4>
            {editCard === "refs" ? (
              <JvRefsEdit job={job} onDone={() => setEditCard(null)} />
            ) : (
              <>
                <JvField label="Our reference" value={job.reference} />
                <JvField label="Customer ref / PO" value={job.po_no} onAdd={() => setEditCard("refs")} />
                <JvField
                  label="Quotation"
                  value={
                    job.quote_id ? (
                      <Link to={`/quotes/${job.quote_id}/view`} onClick={onClose}>
                        View quotation →
                      </Link>
                    ) : null
                  }
                />
                <JvField label="Created" value={formatDate(job.created_at)} />
                {job.invoice_no && (
                  <JvField
                    label="Invoice"
                    value={job.invoice_no + (job.invoiced_at ? " · " + formatDate(job.invoiced_at) : "")}
                  />
                )}
              </>
            )}
          </div>
        </div>
  );
}

/** Route & transport card in edit mode (replaces the old Edit window). */
function JvRouteEdit({ job, air, sea, onDone }: { job: Job; air: boolean; sea: boolean; onDone: () => void }) {
  const updateJob = useUpdateJob();
  const { toast, error: toastError } = useToast();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    const patch: JobPatch = {
      origin: codeOf(v("origin")),
      destination: codeOf(v("destination")),
      awb_mbl: v("awb_mbl"),
      shipping_line: v("shipping_line"),
    };
    if (air) patch.carrier_name = v("carrier_name");
    if (sea) {
      patch.container_no = v("container_no");
      patch.container_type = v("container_type");
      patch.vessel_name = v("vessel_name");
    }
    updateJob.mutate(
      { id: job.id, patch },
      {
        onSuccess: () => {
          toast("Route & transport saved");
          onDone();
        },
        onError: (err) => toastError(err instanceof Error ? err.message : "Could not save"),
      },
    );
  }
  return (
    <form className="jv-form" onSubmit={onSubmit}>
      <datalist id="jv-locodes">
        {LOCODES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.city}, {l.country}
          </option>
        ))}
      </datalist>
      <div className="jv-form-2">
        <label>
          POL
          <input name="origin" list="jv-locodes" defaultValue={codeOf(job.origin)} autoFocus />
        </label>
        <label>
          POD
          <input name="destination" list="jv-locodes" defaultValue={codeOf(job.destination)} />
        </label>
      </div>
      <label>
        {docLabel(job.mode)}
        <input name="awb_mbl" defaultValue={job.awb_mbl ?? ""} />
      </label>
      {sea && (
        <div className="jv-form-2">
          <label>
            Container No
            <input name="container_no" defaultValue={job.container_no ?? ""} />
          </label>
          <label>
            Container Type
            <input name="container_type" defaultValue={job.container_type ?? ""} placeholder="1x 20GP" />
          </label>
        </div>
      )}
      {air && (
        <label>
          Airline
          <input name="carrier_name" defaultValue={job.carrier_name ?? ""} />
        </label>
      )}
      <label>
        {carrierLabel(job.mode)}
        <input name="shipping_line" defaultValue={job.shipping_line ?? ""} />
      </label>
      {sea && (
        <label>
          Vessel
          <input name="vessel_name" defaultValue={job.vessel_name ?? ""} />
        </label>
      )}
      <div className="jv-form-foot">
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn small" disabled={updateJob.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

/** References card in edit mode: customer ref / PO, notes, remarks. */
function JvRefsEdit({ job, onDone }: { job: Job; onDone: () => void }) {
  const updateJob = useUpdateJob();
  const { toast, error: toastError } = useToast();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    updateJob.mutate(
      { id: job.id, patch: { po_no: v("po_no"), notes: v("notes"), ops_remarks: v("ops_remarks") } },
      {
        onSuccess: () => {
          toast("References saved");
          onDone();
        },
        onError: (err) => toastError(err instanceof Error ? err.message : "Could not save"),
      },
    );
  }
  return (
    <form className="jv-form" onSubmit={onSubmit}>
      <label>
        Customer ref / PO
        <input name="po_no" defaultValue={job.po_no ?? ""} autoFocus />
      </label>
      <label>
        Notes
        <textarea name="notes" rows={2} defaultValue={job.notes ?? ""} />
      </label>
      <label>
        Remarks <span className="muted">(Document Vault documents only)</span>
        <textarea name="ops_remarks" rows={2} defaultValue={job.ops_remarks ?? ""} />
      </label>
      <div className="jv-form-foot">
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn small" disabled={updateJob.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

/** One line on a shipment View card; empty shows "+ add" (edits the card). */
function JvField({ label, value, onAdd }: { label: string; value: ReactNode; onAdd?: () => void }) {
  const empty = value == null || value === "";
  return (
    <div className="jv-field">
      <span className="k">{label}</span>
      {empty ? (
        onAdd ? (
          <button type="button" className="jv-add" onClick={onAdd}>
            + add
          </button>
        ) : (
          <span className="muted">—</span>
        )
      ) : (
        <span className="v">{value}</span>
      )}
    </div>
  );
}

/** Customer / shipper with contact, phone and email. */
function JvParty({
  label,
  p,
  onEmail,
}: {
  label: string;
  p: { company: string; contact?: string | null; email?: string | null; phone?: string | null; company_phone?: string | null } | null | undefined;
  onEmail?: () => void;
}) {
  if (!p) return <JvField label={label} value={null} />;
  const phone = p.phone || p.company_phone;
  return (
    <div className="jv-party">
      <span className="k">{label}</span>
      <b>{p.company}</b>
      {p.contact && <span>{p.contact}</span>}
      <span className="jv-contact">
        {phone && <a href={`tel:${phone.replace(/[^+d]/g, "")}`}>📞 {phone}</a>}
        {p.email &&
          (onEmail ? (
            <button type="button" className="link-btn" onClick={() => onEmail()} title="Email from the shipment's Comms (logged)">
              ✉ {p.email}
            </button>
          ) : (
            <a href={`mailto:${p.email}`}>✉ {p.email}</a>
          ))}
      </span>
    </div>
  );
}

/** Proof of delivery upload for a shipment (0151). */
export function ShipmentPodModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <PodModal
      title={"Proof of delivery, " + job.reference}
      intro="Delivered. Upload the signed POD now, or later from the shipment's View."
      customerEmail={job.client?.email}
      onClose={onClose}
      onSave={async (pod) => {
        const r = await saveShipmentPod(job, pod);
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["shipment_documents"] });
        return r;
      }}
    />
  );
}

/** Shipment view: POD status + upload (0151). */
export function PodSection({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const has = !!(job.pod_signed_by || job.pod_delivered_at);
  return (
    <div className="job-consol">
      <span className="k">Proof of delivery</span>
      {has ? (
        <span>
          ✓ Delivered {formatDate(job.pod_delivered_at)}
          {job.pod_signed_by ? ", signed for by " + job.pod_signed_by : ""} (in Documents below)
        </span>
      ) : (
        <span className="hint">Not uploaded yet</span>
      )}
      <button type="button" className="btn outline btn-sm" onClick={() => setOpen(true)}>
        {has ? "Replace POD" : "Upload POD"}
      </button>
      {open && <ShipmentPodModal job={job} onClose={() => setOpen(false)} />}
    </div>
  );
}
