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
import QuickMailModal from "../components/QuickMailModal";
import QuoteDetailModal from "./QuoteDetailModal";
import {
  useDeleteQuote,
  useProfiles,
  useQuotes,
  useSaveQuote,
  useUpdateQuotesBulk,
} from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import {
  formatDate,
  money,
  newReference,
  portCode,
  todayPlusDays,
  usd,
} from "../lib/format";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  type Quote,
  type QuoteDraft,
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
  const [mailing, setMailing] = useState<Quote | null>(null);
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

  const spName = (id: string | null) =>
    salesPeople.find((p) => p.id === id)?.full_name || "—";

  const columns = useMemo<DataColumn<Quote>[]>(() => {
    const dash = (v: string | null | undefined) => v || "—";
    const t = (q: Quote) => totalsByQuote.get(q.id);
    return [
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
        render: (q) => (
          <RowActions
            selected={sel.isSelected(q.id)}
            onSelectToggle={() => sel.toggle(q.id)}
            onMail={() => setMailing(q)}
            mailTitle="Email the customer"
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
        width: 140,
        sortValue: (q) => STATUS_ORDER.indexOf(q.status),
        render: (q) => <StatusBadge status={q.status} />,
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
        header: "Commercial Value ($)",
        label: "Commercial Value",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => Number(q.commercial_value) || 0,
        render: (q) => usd(q.commercial_value),
      },
      {
        key: "insurance_amount",
        header: "Insurance Amount ($)",
        label: "Insurance Amount",
        width: 140,
        defaultHidden: true,
        sortValue: (q) => Number(q.insurance_amount) || 0,
        render: (q) => usd(q.insurance_amount),
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
  }, [sel, totalsByQuote, navigate, salesPeople]);

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

      {mailing && (
        <QuickMailModal
          to={mailing.client?.email ?? mailing.lead?.email ?? null}
          company={mailing.client?.company ?? mailing.lead?.company ?? "customer"}
          name={mailing.lead?.contact ?? null}
          onClose={() => setMailing(null)}
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
