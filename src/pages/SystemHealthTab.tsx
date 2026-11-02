// Settings › System health (0207): each background job and the notification
// emails, OK or failing and why, plus the recent changes. Admins only.
import { useQueryClient } from "@tanstack/react-query";
import { ErrorNote, Loading } from "../components/common";
import { formatDateTime } from "../lib/format";
import { healthProblems, useSystemHealth, useSystemHealthLog } from "../lib/systemHealth";

export default function SystemHealthTab() {
  const qc = useQueryClient();
  const healthQ = useSystemHealth();
  const logQ = useSystemHealthLog();
  const rows = healthQ.data ?? [];
  const stale = healthProblems(rows).find((p) => p.key === "health-check");
  const lastCheck = rows.length ? Math.max(...rows.map((r) => Date.parse(r.checked_at))) : NaN;

  if (healthQ.isLoading) return <Loading />;
  if (healthQ.error) {
    return (
      <ErrorNote
        error={
          new Error(
            `System health isn't available: ${healthQ.error.message}. It needs migration 0207 in Supabase, and an Admin login.`,
          )
        }
      />
    );
  }

  return (
    <>
      <div className="health-head">
        <p className="muted" style={{ margin: 0 }}>
          Motion checks its background jobs and notification emails every 5 minutes. When one fails, Admins see a
          banner and an alert email goes to support@ (sent straight from the database, so it still arrives when the
          site is the problem).
          {Number.isFinite(lastCheck) && <> Last check {formatDateTime(new Date(lastCheck).toISOString())}.</>}
        </p>
        <button
          type="button"
          className="btn outline"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ["system_health"] });
            void qc.invalidateQueries({ queryKey: ["system_health_log"] });
          }}
        >
          Refresh
        </button>
      </div>

      {stale && <ErrorNote error={new Error(`Health check: ${stale.detail}.`)} />}

      {rows.length === 0 ? (
        <p className="hint">No checks yet. The first one runs within 5 minutes of applying migration 0207.</p>
      ) : (
        <table className="health-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Details</th>
              <th>Last OK</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.check_key}>
                <td>
                  <b>{r.label}</b>
                </td>
                <td>
                  <span className={`health-pill ${r.ok ? "ok" : "bad"}`}>{r.ok ? "OK" : "Failing"}</span>
                </td>
                <td>
                  {r.ok
                    ? r.detail ?? "Working"
                    : `${r.failing_since ? `Since ${formatDateTime(r.failing_since)}: ` : ""}${r.detail ?? ""}`}
                </td>
                <td>{r.last_ok_at ? formatDateTime(r.last_ok_at) : "None in the last 6 hours"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="health-sub">Recent changes</h3>
      {logQ.data?.length ? (
        <ul className="health-log">
          {logQ.data.map((e) => (
            <li key={e.id}>
              <span className={`health-pill ${e.ok ? "ok" : "bad"}`}>{e.ok ? "Recovered" : "Failed"}</span>
              <span className="muted">{formatDateTime(e.at)}</span>
              <span>
                <b>{e.label}</b>
                {!e.ok && e.detail ? `: ${e.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing has failed since the health check started.</p>
      )}

      <h3 className="health-sub">Alert emails</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Sent through Resend directly from Supabase. They need the Resend API key stored once in the Supabase vault
        (SQL editor): <code>select vault.create_secret('re_…', 'resend_api_key');</code> The address is
        <code> private.follow_up_config.alert_email</code> (support@expac.co.za by default).
      </p>
    </>
  );
}
