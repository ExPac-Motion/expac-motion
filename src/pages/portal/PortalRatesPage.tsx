import { useMemo, useState } from "react";
import { modeEmoji } from "./PortalLayout";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  PageTools,
  SearchInput,
} from "../../components/common";
import { useMyRateSheet } from "../../lib/hooks";
import { money } from "../../lib/format";

/** Tariff Sheet, the internal rate sheet, sell price only (client_rate_sheet
 *  in 0071 collapses buy/margin into `sell` before this ever reaches the
 *  portal). */
export default function PortalRatesPage() {
  const ratesQ = useMyRateSheet();
  const [search, setSearch] = useState("");
  const rates = ratesQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((r) =>
      [r.mode, r.origin, r.destination, r.carrier, r.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesQ.data, search]);

  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const columns = useMemo<DataColumn<(typeof rates)[number]>[]>(
    () => [
      { key: "mode", header: "Mode", width: 160, sortValue: (r) => r.mode, render: (r) => `${modeEmoji(r.mode)} ${r.mode}` },
      { key: "origin", header: "Origin", width: 110, sortValue: (r) => r.origin ?? "", render: (r) => r.origin || "Any" },
      { key: "destination", header: "Destination", width: 110, sortValue: (r) => r.destination ?? "", render: (r) => r.destination || "Any" },
      { key: "carrier", header: "Carrier", width: 150, sortValue: (r) => r.carrier ?? "", render: (r) => r.carrier || "—" },
      { key: "description", header: "Description", width: 280, sortValue: (r) => r.description, render: (r) => r.description },
      { key: "unit", header: "Unit", width: 120, sortValue: (r) => r.unit ?? "", render: (r) => r.unit || "—" },
      {
        key: "rate",
        header: "Rate",
        width: 130,
        sortValue: (r) => r.sell,
        render: (r) => (
          <strong>{r.cur === "ZAR" ? money(r.sell) : `${r.cur} ${r.sell.toFixed(2)}`}</strong>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader eyebrow="Your account" title="Tariff Sheet" />
      <PageTools
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search lane, carrier, description…"
          />
        }
        count={
          ratesQ.isLoading
            ? undefined
            : `${filtered.length}${filtered.length !== rates.length ? ` of ${rates.length}` : ""} rate${rates.length === 1 ? "" : "s"}`
        }
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {ratesQ.isLoading ? (
          <Loading />
        ) : ratesQ.isError ? (
          <ErrorNote error={ratesQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>
            {rates.length === 0 ? "No rates published yet." : `No rates match "${search}".`}
          </EmptyState>
        ) : (
          <DataTable
            tableKey="portal-rates"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
          />
        )}
      </div>
    </>
  );
}
