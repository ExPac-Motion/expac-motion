import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "../components/common";
import QuoteDetailModal from "./QuoteDetailModal";
import { useQuotes } from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { money } from "../lib/format";
import { STATUS_LABEL, STATUS_ORDER, type QuoteStatus } from "../lib/types";

export default function QuotesListPage() {
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError, error } = useQuotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuoteStatus | "all">("all");

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
            <h2>All quotations</h2>
            <p>{(quotes ?? []).length} total</p>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as QuoteStatus | "all")}
            >
              <option value="all">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
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
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Client</th>
                  <th>Trade lane</th>
                  <th>Mode</th>
                  <th>Value</th>
                  <th>Margin</th>
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
                      <td className="nowrap">
                        {q.origin || "—"} → {q.destination || "—"}
                      </td>
                      <td>{q.mode}</td>
                      <td>{money(t.sell)}</td>
                      <td>{t.margin.toFixed(1)}%</td>
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
