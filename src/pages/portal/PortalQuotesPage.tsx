import { useMemo } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "../../components/common";
import { useMyQuotes } from "../../lib/hooks";
import { formatDate, portCode } from "../../lib/format";
import type { ClientQuote } from "../../lib/types";

export default function PortalQuotesPage() {
  const quotesQ = useMyQuotes();
  const quotes = quotesQ.data ?? [];

  const columns = useMemo<DataColumn<ClientQuote>[]>(
    () => [
      {
        key: "reference",
        header: "Reference",
        width: 130,
        sortValue: (q) => q.reference,
        render: (q) => <strong>{q.reference}</strong>,
      },
      {
        key: "mode",
        header: "Mode",
        width: 150,
        sortValue: (q) => q.mode,
        render: (q) => q.mode,
      },
      {
        key: "lane",
        header: "Trade lane",
        width: 140,
        cellClass: "nowrap",
        sortValue: (q) => portCode(q.origin),
        render: (q) => `${portCode(q.origin)} → ${portCode(q.destination)}`,
      },
      {
        key: "commodity",
        header: "Commodity",
        width: 160,
        sortValue: (q) => q.commodity ?? "",
        render: (q) => q.commodity || "—",
      },
      {
        key: "status",
        header: "Status",
        width: 130,
        sortValue: (q) => q.status,
        render: (q) => <StatusBadge status={q.status} />,
      },
      {
        key: "valid_until",
        header: "Valid Until",
        width: 120,
        sortValue: (q) => q.valid_until ?? "",
        render: (q) => formatDate(q.valid_until),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader eyebrow="Your account" title="Quotations" />
      <div className="panel">
        {quotesQ.isLoading ? (
          <Loading />
        ) : quotesQ.isError ? (
          <ErrorNote error={quotesQ.error} />
        ) : quotes.length === 0 ? (
          <EmptyState>No quotations yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-quotes"
            className="table--compact"
            columns={columns}
            rows={quotes}
            rowKey={(q) => q.id}
          />
        )}
      </div>
    </>
  );
}
