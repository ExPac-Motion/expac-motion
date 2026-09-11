import { useMemo, useState } from "react";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  SearchInput,
} from "../../components/common";
import { useMyRateSheet } from "../../lib/hooks";
import { money } from "../../lib/format";

/** Tariff Sheet — the internal rate sheet, sell price only (client_rate_sheet
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

  return (
    <>
      <PageHeader eyebrow="Your account" title="Tariff Sheet" />
      <div className="panel">
        {rates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search lane, carrier, description…"
            />
          </div>
        )}
        {ratesQ.isLoading ? (
          <Loading />
        ) : ratesQ.isError ? (
          <ErrorNote error={ratesQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>
            {rates.length === 0 ? "No rates published yet." : `No rates match "${search}".`}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th>Carrier</th>
                  <th>Description</th>
                  <th>Unit</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.mode}</td>
                    <td>{r.origin || "Any"}</td>
                    <td>{r.destination || "Any"}</td>
                    <td>{r.carrier || "—"}</td>
                    <td>{r.description}</td>
                    <td>{r.unit || "—"}</td>
                    <td>
                      <strong>
                        {r.cur === "ZAR" ? money(r.sell) : `${r.cur} ${r.sell.toFixed(2)}`}
                      </strong>
                    </td>
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
