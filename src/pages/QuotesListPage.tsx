import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  RowActions,
  RowActionsHead,
  StatusBadge,
  useRowSelection,
} from "../components/common";
import { useToast } from "../components/Toast";
import DataTable, { type DataColumn } from "../components/DataTable";
import QuoteDetailModal from "./QuoteDetailModal";
import {
  useDeleteQuote,
  useProfiles,
  useQuotes,
  useSaveQuote,
  useUpdateQuotesBulk,
} from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { money, newReference, portCode, todayPlusDays } from "../lib/format";
import { STATUS_LABEL, type Quote, type QuoteDraft, type QuoteStatus } from "../lib/types";

function isQuoteStatus(v: string | null): v is QuoteStatus {
  return (
    v === "open" ||
    v === "sent" ||
    v === "accepted" ||
    v === "completed" ||
    v === "lost"
  );
}

/** Everything but booking-specific fields (vessel/flight/MBL/HBL/dates), which
 * reset since a duplicate is a new shipment even on the same trade lane. */
function draftFromQuote(q: Quote): QuoteDraft {
  return {
    id: null,
    reference: newReference(q.mode),
    customer_reference: "",
    client_id: q.client_id ?? "",
    lead_id: "",
    sales_person_id: q.sales_person_id ?? "",
    supplier_id: q.supplier_id ?? "",
    agent_id: q.agent_id ?? "",
    transporter_id: q.transporter_id ?? "",
    clearing_agent_id: q.clearing_agent_id ?? "",
    mode: q.mode,
    commodity: q.commodity ?? "",
    origin: q.origin ?? "",
    destination: q.destination ?? "",
    delivery_terms: q.delivery_terms ?? "",
    valid_until: todayPlusDays(14),
    status: "open",
    commercial_value: q.commercial_value != null ? String(q.commercial_value) : "",
    insurance_amount: q.insurance_amount != null ? String(q.insurance_amount) : "",
    vessel_name: "",
    mbl_no: "",
    hbl_no: "",
    container_no: "",
    etd: "",
    eta: "",
    incoterms: q.incoterms ?? "",
    mawb_no: "",
    hawb_no: "",
    flight_no: "",
    flight_date: "",
    carrier_name: "",
    shipping_line: q.shipping_line ?? "",
    fx_usd_zar: String(q.fx_usd_zar ?? ""),
    fx_cny_zar: String(q.fx_cny_zar ?? ""),
    packing: q.packing_list_items ?? [],
    lines: q.quote_lines ?? [],
  };
}

export default function QuotesListPage() {
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError, error } = useQuotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const del = useDeleteQuote();
  const save = useSaveQuote();
  const bulkUpdate = useUpdateQuotesBulk();
  const profilesQ = useProfiles();
  const salesPeople = profilesQ.data ?? [];
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
      const newId = await save.mutateAsync(draftFromQuote(q));
      toast("Quote duplicated");
      navigate(`/quotes/${newId}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not duplicate quote");
    }
  }

  const rows = useMemo(() => {
    const list = quotes ?? [];
    return filter === "all" ? list : list.filter((q) => q.status === filter);
  }, [quotes, filter]);

  const sel = useRowSelection(quotes ?? [], rows);

  const totalsByQuote = useMemo(() => {
    const m = new Map<string, ReturnType<typeof chargeTotals>>();
    for (const q of rows) m.set(q.id, chargeTotals(q.quote_lines, fxOf(q)));
    return m;
  }, [rows]);

  const columns = useMemo<DataColumn<Quote>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 118,
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
            onView={() => setOpenId(q.id)}
            onEdit={() => navigate(`/quotes/${q.id}`)}
            onDelete={() => onDelete(q)}
            onDuplicate={() => onDuplicate(q)}
          />
        ),
      },
      {
        key: "shipment",
        header: "Shipment",
        width: 135,
        render: (q) => <span className="ref-link">{q.reference}</span>,
      },
      {
        key: "customer",
        header: "Customer",
        width: 240,
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
        width: 220,
        render: (q) => q.supplier?.company ?? "—",
      },
      {
        key: "reference",
        header: "Reference",
        width: 150,
        render: (q) => q.customer_reference || "—",
      },
      {
        key: "lane",
        header: "Trade lane",
        width: 150,
        cellClass: "nowrap",
        render: (q) => `${portCode(q.origin)} → ${portCode(q.destination)}`,
      },
      { key: "mode", header: "Mode", width: 130, render: (q) => q.mode },
      {
        key: "cost",
        header: "Total Cost",
        width: 115,
        render: (q) => money(totalsByQuote.get(q.id)?.cost ?? 0),
      },
      {
        key: "value",
        header: "Total Value",
        width: 115,
        render: (q) => money(totalsByQuote.get(q.id)?.sell ?? 0),
      },
      {
        key: "margin",
        header: "Margin",
        width: 95,
        render: (q) => `${(totalsByQuote.get(q.id)?.margin ?? 0).toFixed(1)}%`,
      },
      {
        key: "profit",
        header: "Total Profit",
        width: 115,
        render: (q) => money(totalsByQuote.get(q.id)?.gp ?? 0),
      },
      {
        key: "status",
        header: "Status",
        width: 140,
        render: (q) => <StatusBadge status={q.status} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, totalsByQuote, navigate],
  );

  return (
    <>
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
            <p>{rows.length} total</p>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {(quotes ?? []).length === 0
              ? 'No quotations yet. Click "New Quotation" to build your first one.'
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
          />
        )}
      </div>

      {openId && (
        <QuoteDetailModal quoteId={openId} onClose={() => setOpenId(null)} />
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
