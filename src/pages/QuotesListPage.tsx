import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  RowActions,
  RowActionsHead,
  useRowSelection,
  SearchInput,
} from "../components/common";
import { useToast } from "../components/Toast";
import DataTable, { type DataColumn } from "../components/DataTable";
import QuoteDetailModal from "./QuoteDetailModal";
import QuoteCommsRail from "./quotes/QuoteCommsRail";
import TaskEditModal from "./ops/TaskEditModal";
import {
  useAcceptQuote,
  useDeleteQuote,
  useMarkQuoteMessagesRead,
  useOpsTasks,
  useProfiles,
  useQuotes,
  useSaveQuote,
  useSetQuoteNotes,
  useUnreadQuoteMessages,
  useUpdateQuotesBulk,
} from "../lib/hooks";
import { duplicateQuoteDraft } from "../lib/quoteDraft";
import { chargeTotals, fxOf } from "../lib/calc";
import {
  currencyAmount,
  formatDate,
  money,
  portCode,
} from "../lib/format";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  type Quote,
  type QuoteStatus,
} from "../lib/types";

function isQuoteStatus(v: string | null): v is QuoteStatus {
  return (
    v === "open" ||
    v === "sent" ||
    v === "accepted" ||
    v === "completed" ||
    v === "lost"
  );
}

/** Inline status dropdown for the Quotations list — lets a status change
 * happen right from the row instead of opening the quote to edit it.
 * Moving to "accepted" runs the real accept_quote flow (creates the
 * shipment, promotes a linked lead) rather than just stamping the field,
 * unless the quote is already won (completed), matching the Opportunities
 * board's card dropdown. */
function QuoteStatusSelect({ quote }: { quote: Quote }) {
  const bulkUpdate = useUpdateQuotesBulk();
  const acceptQuote = useAcceptQuote();
  const { toast, error: toastError } = useToast();
  const busy = bulkUpdate.isPending || acceptQuote.isPending;

  async function onChange(next: QuoteStatus) {
    if (next === quote.status) return;
    try {
      if (next === "accepted" && quote.status !== "completed") {
        await acceptQuote.mutateAsync(quote.id);
        toast("Shipment created — check Active Shipments");
        return;
      }
      await bulkUpdate.mutateAsync({ ids: [quote.id], patch: { status: next } });
      toast(`Status changed to ${STATUS_LABEL[next]}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update status");
    }
  }

  return (
    <select
      className={`badge badge-select ${quote.status}`}
      value={quote.status}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as QuoteStatus)}
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/* Owns its own draft so a background refetch never clobbers what's being
   typed; commits on blur. Same pattern as the Active Shipments Notes cell. */
function QuoteNotesCell({ quote }: { quote: Quote }) {
  const setNotes = useSetQuoteNotes();
  const { error: toastError } = useToast();
  const [v, setV] = useState(quote.notes ?? "");
  useEffect(() => setV(quote.notes ?? ""), [quote.notes]);
  return (
    <input
      value={v}
      placeholder="Add an update…"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v === (quote.notes ?? "")) return;
        setNotes.mutate(
          { id: quote.id, notes: v },
          {
            onError: (e) =>
              toastError(e instanceof Error ? e.message : "Could not save notes"),
          },
        );
      }}
    />
  );
}

export default function QuotesListPage() {
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError, error } = useQuotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const [commsQuote, setCommsQuote] = useState<Quote | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [taskingQuote, setTaskingQuote] = useState<Quote | null>(null);
  const del = useDeleteQuote();
  const save = useSaveQuote();
  const bulkUpdate = useUpdateQuotesBulk();
  const profilesQ = useProfiles();
  const tasksQ = useOpsTasks();
  const unreadMessagesQ = useUnreadQuoteMessages();
  const unreadQuoteIds = useMemo(
    () => new Set((unreadMessagesQ.data ?? []).map((m) => m.quote_id)),
    [unreadMessagesQ.data],
  );
  const markRead = useMarkQuoteMessagesRead();

  function openQuoteComms(q: Quote) {
    setCommsQuote(q);
    setRailOpen(true);
    if (unreadQuoteIds.has(q.id)) markRead.mutate(q.id);
  }
  const openTaskQuoteIds = useMemo(
    () =>
      new Set(
        (tasksQ.data ?? [])
          .filter((t) => t.kind === "task" && t.status !== "done" && t.quote_id)
          .map((t) => t.quote_id as string),
      ),
    [tasksQ.data],
  );
  const salesPeople = (profilesQ.data ?? []).filter(
    (p) => p.role === "admin" || p.role === "user",
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const { toast, error: toastError } = useToast();
  const [params] = useSearchParams();
  const status = params.get("status");
  const filter: QuoteStatus | "all" = isQuoteStatus(status) ? status : "all";

  async function onDelete(q: Quote) {
    if (!window.confirm(`Delete ${q.reference}? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(q.id);
      toast("Quote deleted");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function onDuplicate(q: Quote) {
    try {
      const newId = await save.mutateAsync(duplicateQuoteDraft(q));
      toast("Quote duplicated");
      navigate(`/quotes/${newId}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not duplicate quote");
    }
  }

  // Quick search: quote/shipment no., customer or lead, shipper, customer
  // reference, commodity, ports, vessel, container.
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const list = quotes ?? [];
    const byStatus = filter === "all" ? list : list.filter((q) => q.status === filter);
    const term = search.trim().toLowerCase();
    if (!term) return byStatus;
    return byStatus.filter((q) =>
      [
        q.reference,
        q.client?.company,
        q.lead?.company,
        q.supplier?.company,
        q.customer_reference,
        q.commodity,
        q.origin,
        q.destination,
        q.vessel_name,
        q.container_no,
      ].some((v) => v && String(v).toLowerCase().includes(term)),
    );
  }, [quotes, filter, search]);

  const sel = useRowSelection(quotes ?? [], rows);

  const totalsByQuote = useMemo(() => {
    const m = new Map<string, ReturnType<typeof chargeTotals>>();
    for (const q of rows) m.set(q.id, chargeTotals(q.quote_lines, fxOf(q)));
    return m;
  }, [rows]);

  const spName = (id: string | null) =>
    salesPeople.find((p) => p.id === id)?.full_name || "—";

  const columns = useMemo<DataColumn<Quote>[]>(() => {
    const dash = (v: string | null | undefined) => v || "—";
    const t = (q: Quote) => totalsByQuote.get(q.id);
    return [
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
        render: (q) => (
          <RowActions
            selected={sel.isSelected(q.id)}
            onSelectToggle={() => sel.toggle(q.id)}
            onMail={() => openQuoteComms(q)}
            mailTitle="Messages / email the customer"
            mailUnread={unreadQuoteIds.has(q.id)}
            onTask={() => setTaskingQuote(q)}
            taskTitle="Create a task for this quote"
            taskOpen={openTaskQuoteIds.has(q.id)}
            onView={() => setOpenId(q.id)}
            onEdit={() => navigate(`/quotes/${q.id}`)}
            onDelete={() => onDelete(q)}
            onDuplicate={() => onDuplicate(q)}
          />
        ),
      },
      // --- shown by default ---
      {
        key: "created",
        header: "Created",
        width: 110,
        cellClass: "nowrap",
        sortValue: (q) => q.created_at,
        render: (q) => formatDate(q.created_at),
      },
      {
        key: "shipment",
        header: "Shipment",
        width: 135,
        sortValue: (q) => q.reference,
        render: (q) => <span className="ref-link">{q.reference}</span>,
      },
      {
        key: "customer",
        header: "Customer",
        width: 240,
        sortValue: (q) =>
          (q.client?.company ?? q.lead?.company ?? "").toLowerCase(),
        render: (q) => (
          <>
            {q.client?.company ?? q.lead?.company ?? "—"}
            {!q.client && q.lead && <span className="tag">lead</span>}
          </>
        ),
      },
      {
        key: "shipper",
        header: "Shipper",
        label: "Shipper/Exporter",
        width: 220,
        sortValue: (q) => (q.supplier?.company ?? "").toLowerCase(),
        render: (q) => q.supplier?.company ?? "—",
      },
      {
        key: "reference",
        header: "Reference",
        width: 150,
        sortValue: (q) => q.customer_reference ?? "",
        render: (q) => q.customer_reference || "—",
      },
      {
        key: "lane",
        header: "Trade lane",
        width: 150,
        cellClass: "nowrap",
        sortValue: (q) => `${portCode(q.origin)} → ${portCode(q.destination)}`,
        render: (q) => `${portCode(q.origin)} → ${portCode(q.destination)}`,
      },
      {
        key: "mode",
        header: "Mode",
        width: 130,
        sortValue: (q) => q.mode,
        render: (q) => q.mode,
      },
      {
        key: "cost",
        header: "Total Cost",
        width: 115,
        sortValue: (q) => t(q)?.cost ?? 0,
        render: (q) => money(t(q)?.cost ?? 0),
      },
      {
        key: "value",
        header: "Total Value",
        width: 115,
        sortValue: (q) => t(q)?.sell ?? 0,
        render: (q) => money(t(q)?.sell ?? 0),
      },
      {
        key: "margin",
        header: "Margin",
        width: 95,
        sortValue: (q) => t(q)?.margin ?? 0,
        render: (q) => `${(t(q)?.margin ?? 0).toFixed(1)}%`,
      },
      {
        key: "profit",
        header: "Total Profit",
        width: 115,
        sortValue: (q) => t(q)?.gp ?? 0,
        render: (q) => money(t(q)?.gp ?? 0),
      },
      {
        key: "status",
        header: "Status",
        width: 160,
        sortValue: (q) => STATUS_ORDER.indexOf(q.status),
        render: (q) => <QuoteStatusSelect quote={q} />,
      },
      {
        key: "notes",
        header: "Notes",
        width: 220,
        cellClass: "quote-notes",
        sortValue: (q) => q.notes ?? "",
        render: (q) => <QuoteNotesCell quote={q} />,
      },
      // --- available via "Table settings" (hidden by default) ---
      {
        key: "incoterms",
        header: "Incoterms",
        width: 110,
        defaultHidden: true,
        sortValue: (q) => q.incoterms ?? "",
        render: (q) => dash(q.incoterms),
      },
      {
        key: "delivery_terms",
        header: "Delivery terms",
        width: 150,
        defaultHidden: true,
        sortValue: (q) => q.delivery_terms ?? "",
        render: (q) => dash(q.delivery_terms),
      },
      {
        key: "commercial_value",
        header: "Commercial Value",
        label: "Commercial Value",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => Number(q.commercial_value) || 0,
        render: (q) => currencyAmount(q.commercial_value, q.value_currency),
      },
      {
        key: "insurance_amount",
        header: "Insurance Amount",
        label: "Insurance Amount",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => Number(q.insurance_amount) || 0,
        render: (q) => currencyAmount(q.insurance_amount, q.value_currency),
      },
      {
        key: "commodity",
        header: "Commodity",
        width: 150,
        defaultHidden: true,
        sortValue: (q) => q.commodity ?? "",
        render: (q) => dash(q.commodity),
      },
      {
        key: "valid_until",
        header: "Valid Until",
        width: 120,
        defaultHidden: true,
        sortValue: (q) => q.valid_until ?? "",
        render: (q) => formatDate(q.valid_until),
      },
      {
        key: "origin",
        header: "Origin/Port of Load",
        label: "Origin / Port of Load",
        width: 200,
        defaultHidden: true,
        sortValue: (q) => q.origin ?? "",
        render: (q) => dash(q.origin),
      },
      {
        key: "destination",
        header: "Destination/Port of Discharge",
        label: "Destination / Port of Discharge",
        width: 220,
        defaultHidden: true,
        sortValue: (q) => q.destination ?? "",
        render: (q) => dash(q.destination),
      },
      {
        key: "etd",
        header: "ETD",
        width: 110,
        defaultHidden: true,
        sortValue: (q) => q.etd ?? "",
        render: (q) => formatDate(q.etd),
      },
      {
        key: "eta",
        header: "ETA",
        width: 110,
        defaultHidden: true,
        sortValue: (q) => q.eta ?? "",
        render: (q) => formatDate(q.eta),
      },
      {
        key: "vessel_name",
        header: "Vessel Name",
        width: 160,
        defaultHidden: true,
        sortValue: (q) => q.vessel_name ?? "",
        render: (q) => dash(q.vessel_name),
      },
      {
        key: "container_no",
        header: "Container Number",
        width: 150,
        defaultHidden: true,
        sortValue: (q) => q.container_no ?? "",
        render: (q) => dash(q.container_no),
      },
      {
        key: "mbl_no",
        header: "MBL No",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => q.mbl_no ?? "",
        render: (q) => dash(q.mbl_no),
      },
      {
        key: "hbl_no",
        header: "HBL No",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => q.hbl_no ?? "",
        render: (q) => dash(q.hbl_no),
      },
      {
        key: "mawb_no",
        header: "MAWB No",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => q.mawb_no ?? "",
        render: (q) => dash(q.mawb_no),
      },
      {
        key: "hawb_no",
        header: "HAWB No",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => q.hawb_no ?? "",
        render: (q) => dash(q.hawb_no),
      },
      {
        key: "flight_no",
        header: "Flight No",
        width: 120,
        defaultHidden: true,
        sortValue: (q) => q.flight_no ?? "",
        render: (q) => dash(q.flight_no),
      },
      {
        key: "flight_date",
        header: "Flight Date",
        width: 120,
        defaultHidden: true,
        sortValue: (q) => q.flight_date ?? "",
        render: (q) => formatDate(q.flight_date),
      },
      {
        key: "shipping_line",
        header: "Carrier",
        width: 150,
        defaultHidden: true,
        sortValue: (q) => q.shipping_line ?? "",
        render: (q) => dash(q.shipping_line),
      },
      {
        key: "carrier_name",
        header: "Agent/Airline Name",
        label: "Agent/Airline Name (internal)",
        width: 170,
        defaultHidden: true,
        sortValue: (q) => q.carrier_name ?? "",
        render: (q) => dash(q.carrier_name),
      },
      {
        key: "agent",
        header: "Agent",
        label: "Agent (internal)",
        width: 170,
        defaultHidden: true,
        sortValue: (q) => (q.agent?.company ?? "").toLowerCase(),
        render: (q) => q.agent?.company ?? "—",
      },
      {
        key: "clearing_agent",
        header: "Clearing Agent",
        label: "Clearing Agent (internal)",
        width: 180,
        defaultHidden: true,
        sortValue: (q) => (q.clearing_agent?.company ?? "").toLowerCase(),
        render: (q) => q.clearing_agent?.company ?? "—",
      },
      {
        key: "transporter",
        header: "Transporter",
        label: "Transporter (internal)",
        width: 170,
        defaultHidden: true,
        sortValue: (q) => (q.transporter?.company ?? "").toLowerCase(),
        render: (q) => q.transporter?.company ?? "—",
      },
      {
        key: "sales_person",
        header: "Sales Person",
        width: 160,
        defaultHidden: true,
        sortValue: (q) => spName(q.sales_person_id).toLowerCase(),
        render: (q) => spName(q.sales_person_id),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, totalsByQuote, navigate, salesPeople, openTaskQuoteIds, unreadQuoteIds]);

  return (
    <>
      <div className={railOpen ? "board-shift" : ""}>
      <PageHeader
        eyebrow="Pricing & costing"
        title="Quotations"
        actions={
          <>
            <button
              className="btn outline"
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
            <button className="btn" onClick={() => navigate("/quotes/new")}>
              New Quotation
            </button>
          </>
        }
      />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{filter === "all" ? "All Quotes" : `${STATUS_LABEL[filter]} Quotes`}</h2>
            <p>
              {rows.length} total
              {search.trim() ? ` · matching "${search.trim()}"` : ""}
            </p>
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search quote no., customer, shipper, reference…"
          />
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {(quotes ?? []).length === 0
              ? 'No quotations yet. Click "New Quotation" to build your first one.'
              : search.trim()
                ? `No quotes match "${search.trim()}".`
                : "No quotes match this filter."}
          </EmptyState>
        ) : (
          <DataTable
            tableKey="quotes"
            className="table--compact quotes-table"
            columns={columns}
            rows={rows}
            rowKey={(q) => q.id}
            onRowClick={(q) => setOpenId(q.id)}
            headerTools="row"
          />
        )}
      </div>
      </div>

      <QuoteCommsRail
        quote={commsQuote}
        open={railOpen}
        onToggle={() => setRailOpen((v) => !v)}
      />

      {openId && (
        <QuoteDetailModal quoteId={openId} onClose={() => setOpenId(null)} />
      )}

      {taskingQuote && (
        <TaskEditModal
          key={taskingQuote.id}
          task={null}
          defaults={{
            quote_id: taskingQuote.id,
            client_id: taskingQuote.client_id,
            title: `Follow up: ${taskingQuote.reference}`,
          }}
          onClose={() => setTaskingQuote(null)}
        />
      )}

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} quote${sel.count === 1 ? "" : "s"}`}
          count={sel.count}
          noun="quote"
          busy={bulkUpdate.isPending}
          fields={[
            {
              key: "status",
              label: "Status",
              type: "select",
              allowClear: false,
              options: (
                ["open", "sent", "accepted", "completed", "lost"] as QuoteStatus[]
              ).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            },
            {
              key: "sales_person_id",
              label: "Sales Person",
              type: "select",
              options: salesPeople.map((p) => ({
                value: p.id,
                label: p.full_name || "—",
              })),
            },
          ]}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as {
                  status?: string;
                  sales_person_id?: string | null;
                },
              });
              toast(`Updated ${n} quote${n === 1 ? "" : "s"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e) {
              toastError(
                e instanceof Error ? e.message : "Could not update quotes",
              );
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}
