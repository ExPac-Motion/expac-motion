import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "../../components/common";
import { useMyJobs, useMyQuotes } from "../../lib/hooks";
import { formatDate, portCode } from "../../lib/format";
import { DELIVERED_STATUS } from "../../lib/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel portal-stat">
      <div className="portal-stat-value">{value}</div>
      <div className="portal-stat-label">{label}</div>
    </div>
  );
}

export default function PortalDashboardPage() {
  const jobsQ = useMyJobs();
  const quotesQ = useMyQuotes();
  const jobs = jobsQ.data ?? [];
  const quotes = quotesQ.data ?? [];
  const active = jobs.filter((j) => j.shipment_status !== DELIVERED_STATUS);

  return (
    <>
      <PageHeader eyebrow="Your account" title="Dashboard" />

      <div className="portal-stats">
        <Stat label="Active Shipments" value={active.length} />
        <Stat label="Total Shipments" value={jobs.length} />
        <Stat label="Sea Freight" value={jobs.filter((j) => j.mode.startsWith("Sea")).length} />
        <Stat label="Air Freight" value={jobs.filter((j) => j.mode.startsWith("Air")).length} />
        <Stat label="Active Quotations" value={quotes.length} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent Shipments</h2>
            <p>{jobs.length} total</p>
          </div>
          <Link className="btn outline btn-sm" to="/portal/shipments">
            View all
          </Link>
        </div>
        {jobsQ.isLoading ? (
          <Loading />
        ) : jobsQ.isError ? (
          <ErrorNote error={jobsQ.error} />
        ) : jobs.length === 0 ? (
          <EmptyState>No shipments yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Mode</th>
                  <th>Trade lane</th>
                  <th>Status</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 5).map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`/portal/shipments/${j.id}`}>
                        <strong>{j.reference}</strong>
                      </Link>
                    </td>
                    <td>{j.mode}</td>
                    <td className="nowrap">
                      {portCode(j.origin)} → {portCode(j.destination)}
                    </td>
                    <td>{j.shipment_status || j.milestone}</td>
                    <td>{formatDate(j.eta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent Quotations</h2>
            <p>{quotes.length} total</p>
          </div>
          <Link className="btn outline btn-sm" to="/portal/quotes">
            View all
          </Link>
        </div>
        {quotesQ.isLoading ? (
          <Loading />
        ) : quotesQ.isError ? (
          <ErrorNote error={quotesQ.error} />
        ) : quotes.length === 0 ? (
          <EmptyState>No quotations yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Mode</th>
                  <th>Trade lane</th>
                  <th>Status</th>
                  <th>Valid Until</th>
                </tr>
              </thead>
              <tbody>
                {quotes.slice(0, 5).map((q) => (
                  <tr key={q.id}>
                    <td>
                      <strong>{q.reference}</strong>
                    </td>
                    <td>{q.mode}</td>
                    <td className="nowrap">
                      {portCode(q.origin)} → {portCode(q.destination)}
                    </td>
                    <td>
                      <StatusBadge status={q.status} />
                    </td>
                    <td>{formatDate(q.valid_until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
