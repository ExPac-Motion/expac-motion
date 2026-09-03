import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNote, Loading, PageHeader, StatusBadge } from "../components/common";
import QuoteDetailModal from "./QuoteDetailModal";
import { useJobs, useQuotes } from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { money, portCode } from "../lib/format";
import { STATUS_LABEL, STATUS_ORDER } from "../lib/types";

export default function DashboardPage() {
  const navigate = useNavigate();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const [openId, setOpenId] = useState<string | null>(null);

  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);

  const stats = useMemo(() => {
    const withTotals = quotes.map((q) => ({
      q,
      t: chargeTotals(q.quote_lines, fxOf(q)),
    }));
    const openValue = withTotals
      .filter((x) => x.q.status !== "accepted")
      .reduce((s, x) => s + x.t.sell, 0);
    const avgMargin =
      withTotals.length > 0
        ? withTotals.reduce((s, x) => s + x.t.margin, 0) / withTotals.length
        : 0;
    return {
      total: quotes.length,
      openValue,
      avgMargin,
      activeJobs: jobs.filter((j) => j.milestone !== "Delivered").length,
    };
  }, [quotes, jobs]);

  const pipeline = useMemo(() => {
    const rows = STATUS_ORDER.map((st) => {
      const qs = quotes.filter((q) => q.status === st);
      const val = qs.reduce(
        (s, q) => s + chargeTotals(q.quote_lines, fxOf(q)).sell,
        0,
      );
      return { st, count: qs.length, val };
    });
    const max = Math.max(1, ...rows.map((r) => r.val));
    return { rows, max };
  }, [quotes]);

  const recent = quotes.slice(0, 5);
  const loading = quotesQ.isLoading || jobsQ.isLoading;
  const errored = quotesQ.isError || jobsQ.isError;

  return (
    <>
      <PageHeader
        eyebrow="Excellence in Motion"
        title="Dashboard"
        actions={
          <button className="btn" onClick={() => navigate("/quotes/new")}>
            New Quotation
          </button>
        }
      />

      {loading ? (
        <div className="panel">
          <Loading label="Loading your data…" />
        </div>
      ) : errored ? (
        <div className="panel">
          <ErrorNote error={quotesQ.error ?? jobsQ.error} />
        </div>
      ) : (
        <>
          <div className="cards">
            <div className="card">
              <div className="label">Total quotes</div>
              <div className="value">{stats.total}</div>
            </div>
            <div className="card">
              <div className="label">Open quote value</div>
              <div className="value">{money(stats.openValue)}</div>
            </div>
            <div className="card">
              <div className="label">Average margin</div>
              <div className="value">{stats.avgMargin.toFixed(1)}%</div>
            </div>
            <div className="card">
              <div className="label">Active jobs</div>
              <div className="value">{stats.activeJobs}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Quotation Pipeline</h2>
                <p>Value by stage, from your actual saved quotes</p>
              </div>
            </div>
            <div
              className="grid3"
              style={{ gridTemplateColumns: "repeat(4,1fr)" }}
            >
              {pipeline.rows.map((p) => (
                <div key={p.st}>
                  <div className="hint">{STATUS_LABEL[p.st]}</div>
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 800,
                      fontSize: "1.3rem",
                      margin: "4px 0 8px",
                    }}
                  >
                    {money(p.val)}
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: "#eee",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${((p.val / pipeline.max) * 100).toFixed(0)}%`,
                        background: "var(--green)",
                      }}
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 4 }}>
                    {p.count} quote{p.count === 1 ? "" : "s"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Recent Quotations</h2>
                <p>Your five most recently created quotes</p>
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="empty">
                No quotations yet. Click "New Quotation" to create your first one.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Client</th>
                      <th>Supplier</th>
                      <th>Trade lane</th>
                      <th>Mode</th>
                      <th>Total Cost</th>
                      <th>Value</th>
                      <th>Margin</th>
                      <th>Total Profit</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((q) => {
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {openId && (
        <QuoteDetailModal quoteId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
