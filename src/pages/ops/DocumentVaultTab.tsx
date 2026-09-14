import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Loading } from "../../components/common";
import { useJobs } from "../../lib/hooks";
import { DOCUMENT_TYPES_LIST } from "../../lib/docTemplates";
import type { Job } from "../../lib/types";

export default function DocumentVaultTab() {
  const jobsQ = useJobs();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Job | null>(null);

  const jobs = jobsQ.data ?? [];

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return jobs
      .filter(
        (j) =>
          j.reference.toLowerCase().includes(q) ||
          (j.client?.company ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [jobs, search]);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Document Vault</h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Generate operational shipment paperwork — shipment details, packing
        list and a sign-off block, ready to print or save as PDF.
      </p>

      <div className="field" style={{ maxWidth: 420 }}>
        <label>Find a shipment</label>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelected(null);
          }}
          placeholder="Search by reference or customer…"
        />
      </div>

      {jobsQ.isLoading && <Loading />}

      {search.trim() &&
        !selected &&
        (matches.length === 0 ? (
          <EmptyState>No shipments match "{search.trim()}".</EmptyState>
        ) : (
          <ul className="task-list" style={{ marginTop: 10 }}>
            {matches.map((j) => (
              <li key={j.id} className="task-row">
                <button className="task-title" onClick={() => setSelected(j)}>
                  {j.reference}
                  <span className="task-body">
                    {" "}
                    — {j.client?.company ?? "—"} · {j.mode}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {selected && (
        <>
          <div className="vault-head" style={{ marginTop: 18 }}>
            <h3 style={{ margin: 0 }}>
              {selected.reference}{" "}
              <span className="muted small">
                — {selected.client?.company ?? "—"}
              </span>
            </h3>
            <button
              className="btn ghost btn-sm"
              onClick={() => {
                setSelected(null);
                setSearch("");
              }}
            >
              Change shipment
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            {DOCUMENT_TYPES_LIST.map((d) => (
              <Link
                key={d.slug}
                className="btn outline"
                style={{ justifyContent: "center" }}
                to={`/jobs/${selected.id}/documents/${d.slug}/print`}
                target="_blank"
                rel="noopener"
              >
                {d.title}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
