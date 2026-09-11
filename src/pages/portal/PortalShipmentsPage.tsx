import { useMemo } from "react";
import { Link } from "react-router-dom";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useMyJobs } from "../../lib/hooks";
import { formatDate, portCode } from "../../lib/format";
import type { ClientJob } from "../../lib/types";

export default function PortalShipmentsPage() {
  const jobsQ = useMyJobs();
  const jobs = jobsQ.data ?? [];

  const columns = useMemo<DataColumn<ClientJob>[]>(
    () => [
      {
        key: "reference",
        header: "Reference",
        width: 130,
        sortValue: (j) => j.reference,
        render: (j) => (
          <Link to={`/portal/shipments/${j.id}`}>
            <strong>{j.reference}</strong>
          </Link>
        ),
      },
      {
        key: "mode",
        header: "Mode",
        width: 150,
        sortValue: (j) => j.mode,
        render: (j) => j.mode,
      },
      {
        key: "lane",
        header: "Trade lane",
        width: 140,
        cellClass: "nowrap",
        sortValue: (j) => portCode(j.origin),
        render: (j) => `${portCode(j.origin)} → ${portCode(j.destination)}`,
      },
      {
        key: "carrier",
        header: "Carrier",
        width: 160,
        sortValue: (j) => j.carrier_name || j.shipping_line || "",
        render: (j) => j.carrier_name || j.shipping_line || "—",
      },
      {
        key: "status",
        header: "Status",
        width: 130,
        sortValue: (j) => j.shipment_status || j.milestone,
        render: (j) => j.shipment_status || j.milestone,
      },
      {
        key: "etd",
        header: "ETD",
        width: 110,
        sortValue: (j) => j.etd ?? "",
        render: (j) => formatDate(j.etd),
      },
      {
        key: "eta",
        header: "ETA",
        width: 110,
        sortValue: (j) => j.eta ?? "",
        render: (j) => formatDate(j.eta),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader eyebrow="Your account" title="Shipments" />
      <div className="panel">
        {jobsQ.isLoading ? (
          <Loading />
        ) : jobsQ.isError ? (
          <ErrorNote error={jobsQ.error} />
        ) : jobs.length === 0 ? (
          <EmptyState>No shipments yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-shipments"
            className="table--compact"
            columns={columns}
            rows={jobs}
            rowKey={(j) => j.id}
          />
        )}
      </div>
    </>
  );
}
