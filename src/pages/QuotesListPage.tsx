import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "../components/common";
import QuoteDetailModal from "./QuoteDetailModal";
import { useQuotes } from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { money, portCode } from "../lib/format";
import { STATUS_LABEL, type QuoteStatus } from "../lib/types";

function isQuoteStatus(v: string | null): v is QuoteStatus {
  return v === "open" || v === "sent" || v === "accepted" || v === "lost";
}

export default function QuotesListPage() {
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError, error } = useQuotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const [params] = useSearchParams();
  const status = params.get("status");
  const filter: QuoteStatus | "all" = isQuoteStatus(status) ? status : "all";

  const rows = useMemo(() => {
    const list = quotes ?? [];
    return filter === "all" ? list : list.filter((q) => q.status === filter);
  }, [quotes, filter]);

  return (
    <>
      <PageHeader
        eyebrow="Pricing & costing"
        title="Quotations"
        actions={
          <button className="btn" onClick={() => navigate("/quotes/new")}>
            New Quotation
          </button>
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
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Shipper</th>
                  <th>Trade lane</th>
                  <th>Mode</th>
                  <th>Total Cost</th>
                  <th>Total Value</th>
                  <th>Margin</th>
                  <th>Total Profit</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => {
                  const t = chargeTotals(q.quote_lines, fxOf(q));
                  return (
                    <tr
                      key={q.id}
                      className="clickable"
                      onClick={() => setOpenId(q.id)}
                    >
                      <td>
                        <strong>{q.reference}</strong>
                      </td>
                      <td>{q.client?.company ?? "—"}</td>
                      <td>{q.supplier?.company ?? "—"}</td>
                      <td className="nowrap">
                        {portCode(q.origin)} → {portCode(q.destination)}
                      </td>
                      <td>{q.mode}</td>
                      <td>{money(t.cost)}</td>
                      <td>{money(t.sell)}</td>
                      <td>{t.margin.toFixed(1)}%</td>
                      <td>{money(t.gp)}</td>
                      <td>
                        <StatusBadge status={q.status} />
                      </td>
                      <td>›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && (
        <QuoteDetailModal quoteId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
