import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "../../components/common";
import { useMyJobs, useMyQuotes } from "../../lib/hooks";
import { formatDate, portCode } from "../../lib/format";

export default function PortalDashboardPage() {
  const jobsQ = useMyJobs();
  const quotesQ = useMyQuotes();

  return (
    <>
      <PageHeader eyebrow="Your account" title="My Shipments" />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Active & Past Shipments</h2>
            <p>{(jobsQ.data ?? []).length} total</p>
          </div>
        </div>
        {jobsQ.isLoading ? (
          <Loading />
        ) : jobsQ.isError ? (
          <ErrorNote error={jobsQ.error} />
        ) : (jobsQ.data ?? []).length === 0 ? (
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
                {(jobsQ.data ?? []).map((j) => (
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
            <h2>Quotations</h2>
            <p>{(quotesQ.data ?? []).length} total</p>
          </div>
        </div>
        {quotesQ.isLoading ? (
          <Loading />
        ) : quotesQ.isError ? (
          <ErrorNote error={quotesQ.error} />
        ) : (quotesQ.data ?? []).length === 0 ? (
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
                {(quotesQ.data ?? []).map((q) => (
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
