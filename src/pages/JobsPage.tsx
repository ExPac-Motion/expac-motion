import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import { useJobs, useSetJobMilestone } from "../lib/hooks";
import { formatDateTime } from "../lib/format";
import { MILESTONES, type Job, type Milestone } from "../lib/types";

export default function JobsPage() {
  const { data: jobs, isLoading, isError, error } = useJobs();
  const setMilestone = useSetJobMilestone();
  const { toast, error: toastError } = useToast();

  async function advance(job: Job, milestone: Milestone) {
    if (job.milestone === milestone) return;
    try {
      await setMilestone.mutateAsync({ jobId: job.id, milestone });
      toast(`${job.reference} → ${milestone}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update milestone");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Post-acceptance tracking" title="Active Jobs" />

      <div className="panel">
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : (jobs ?? []).length === 0 ? (
          <EmptyState>
            No jobs yet. Accept a quote to create one automatically.
          </EmptyState>
        ) : (
          (jobs ?? []).map((j) => {
            const curIdx = MILESTONES.indexOf(j.milestone);
            const lastEvent = j.job_events?.[j.job_events.length - 1];
            return (
              <div
                key={j.id}
                style={{
                  padding: "16px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <strong>{j.reference}</strong>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      {j.client?.company ?? "—"} · {j.origin || "—"} →{" "}
                      {j.destination || "—"} · {j.mode}
                    </span>
                  </div>
                  {j.milestone === "Delivered" && (
                    <span className="badge accepted">Delivered</span>
                  )}
                </div>

                <div className="steps">
                  {MILESTONES.map((m, i) => {
                    const cls =
                      i < curIdx ? "done" : i === curIdx ? "current" : "";
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`step ${cls}`}
                        onClick={() => advance(j, m)}
                        disabled={setMilestone.isPending}
                        title={`Mark ${m}`}
                      >
                        <span className="line" />
                        <span className="dot">{i + 1}</span>
                        <small>{m}</small>
                      </button>
                    );
                  })}
                </div>

                {lastEvent && (
                  <div className="hint" style={{ marginTop: 4 }}>
                    Last update: {lastEvent.milestone} ·{" "}
                    {formatDateTime(lastEvent.created_at)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
