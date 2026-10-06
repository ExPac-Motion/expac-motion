import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { formatDate, money } from "../../lib/format";
import { portalQuoteStatus, portalTotals, usePortalLines, usePortalQuotes, type PortalQuote } from "../../lib/portal";

type Filter = "" | "Requested" | "Response available" | "Accepted" | "Closed";

/** Customer Portal › Quotations (v2): every quotation and request, with what
 *  needs the customer's answer up front; opens a quotation to accept / decline. */
export default function PortalQuotesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const quotesQ = usePortalQuotes();
  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const linesQ = usePortalLines(quotes.filter((q) => q.status !== "open").map((q) => q.id));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  // ?open=<id> (dashboard / search) jumps straight to that quotation.
  useEffect(() => {
    const id = params.get("open");
    if (id) navigate(`/portal/quotes/${id}`, { replace: true });
  }, [params, navigate]);

  const totals = useMemo(() => {
    const m = new Map<string, { net: number; vat: number; total: number }>();
    const by = new Map<string, typeof linesQ.data>();
    for (const l of linesQ.data ?? []) by.set(l.quote_id, [...(by.get(l.quote_id) ?? []), l]);
    for (const [id, ls] of by) m.set(id, portalTotals(ls ?? []));
    return m;
  }, [linesQ.data]);

  const label = (q: PortalQuote) => portalQuoteStatus(q).label;
  const group = (q: PortalQuote): Filter => {
    const l = label(q);
    if (l === "Requested" || l === "Being prepared") return "Requested";
    if (l === "Response available") return "Response available";
    if (l === "Accepted" || l === "Completed") return "Accepted";
    return "Closed";
  };
  const n = search.trim().toLowerCase();
  const rows = quotes.filter(
    (q) =>
      (!filter || group(q) === filter) &&
      (!n || [q.reference, q.customer_reference, q.origin, q.destination, q.commodity, q.mode].join(" ").toLowerCase().includes(n)),
  );
  const count = (f: Filter) => quotes.filter((q) => group(q) === f).length;

  const columns: DataColumn<PortalQuote>[] = [
    { key: "ref", header: "Quotation No", width: 130, render: (q) => <span className="ref-link">{q.reference}</span>, sortValue: (q) => q.reference },
    {
      key: "status",
      header: "Status",
      width: 160,
      render: (q) => {
        const s = portalQuoteStatus(q);
        return <span className={`badge ${s.cls}`}>{s.label}</span>;
      },
      sortValue: (q) => label(q),
    },
    { key: "yourref", header: "Ref", width: 120, render: (q) => q.customer_reference || "—" },
    { key: "mode", header: "Mode", width: 150, render: (q) => q.mode, sortValue: (q) => q.mode },
    { key: "origin", header: "Origin", width: 170, render: (q) => q.origin || "—", sortValue: (q) => q.origin ?? "" },
    { key: "dest", header: "Destination", width: 170, render: (q) => q.destination || "—", sortValue: (q) => q.destination ?? "" },
    { key: "commodity", header: "Commodity", width: 160, render: (q) => q.commodity || "—" },
    {
      key: "net",
      header: "TTL (excl. VAT)",
      width: 130,
      render: (q) => (totals.has(q.id) ? money(totals.get(q.id)?.net) : "—"),
      sortValue: (q) => totals.get(q.id)?.net ?? 0,
    },
    {
      key: "vat",
      header: "TTL (VAT)",
      width: 110,
      render: (q) => (totals.has(q.id) ? money(totals.get(q.id)?.vat) : "—"),
      sortValue: (q) => totals.get(q.id)?.vat ?? 0,
    },
    {
      key: "total",
      header: "TTL (incl. VAT)",
      width: 130,
      render: (q) => (totals.has(q.id) ? money(totals.get(q.id)?.total) : "—"),
      sortValue: (q) => totals.get(q.id)?.total ?? 0,
    },
    { key: "date", header: "Date", width: 100, render: (q) => formatDate(q.portal_requested_at ?? q.created_at), sortValue: (q) => q.created_at },
    { key: "valid", header: "Valid until", width: 110, render: (q) => formatDate(q.valid_until), sortValue: (q) => q.valid_until ?? "" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Quotations"
        actions={
          <button className="btn" onClick={() => navigate("/portal/quotes/new")}>
            + Request Quote
          </button>
        }
      />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search quotation, route, commodity…" />}
        filters={
          <div className="wms-seg">
            {(["", "Requested", "Response available", "Accepted", "Closed"] as Filter[]).map((f) => (
              <button key={f || "all"} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f || "All"} {f ? `(${count(f)})` : `(${quotes.length})`}
              </button>
            ))}
          </div>
        }
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {quotesQ.isLoading ? (
          <Loading />
        ) : quotesQ.isError ? (
          <ErrorNote error={quotesQ.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {quotes.length === 0 ? "No quotations yet, + Request Quote and ExPac will price it for you." : "No quotations match."}
          </EmptyState>
        ) : (
          <DataTable
            tableKey="portal-quotes-v2"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(q) => q.id}
            onRowClick={(q) => navigate(`/portal/quotes/${q.id}`)}
            rowClass={(q) => (label(q) === "Response available" ? "pt-row-attn" : undefined)}
          />
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Amounts in ZAR, including VAT where it applies.
      </p>
    </>
  );
}
