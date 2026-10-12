// Settings › Sage Accounting (0156): connection status, Sync now, the
// customer links (Sage customer ↔ Motion customer) and the setup steps.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DataTable, { type DataColumn } from "../components/DataTable";
import { ErrorNote, Loading } from "../components/common";
import { useToast } from "../components/Toast";
import { formatDateTime, money } from "../lib/format";
import { useClients } from "../lib/hooks";
import {
  useSageAutoMatch,
  useSageCustomers,
  useSageState,
  useSyncSage,
  type SageCustomer,
} from "../lib/sage";

const SECRETS: [string, string][] = [
  ["SAGE_API_KEY", "The API key from the Sage Accounting API team"],
  ["SAGE_USERNAME", "The Sage login for Motion (email address)"],
  ["SAGE_PASSWORD", "That login's password"],
  ["SAGE_COMPANY_ID", "Optional, only when the login sees more than one company"],
];

export default function SageSettingsTab() {
  const { toast, error } = useToast();
  const stateQ = useSageState();
  const customersQ = useSageCustomers();
  const clientsQ = useClients();
  const sync = useSyncSage();
  const match = useSageAutoMatch();
  const [show, setShow] = useState<"all" | "unlinked">("unlinked");

  const bySage = useMemo(() => {
    const m = new Map<number, { id: string; company: string }>();
    for (const c of clientsQ.data ?? []) {
      const sid = (c as { sage_customer_id?: number | null }).sage_customer_id;
      if (sid) m.set(Number(sid), { id: c.id, company: c.company });
    }
    return m;
  }, [clientsQ.data]);

  function runSync() {
    sync.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          `Synced ${r.customers} Sage customers and ${r.invoices} invoices` +
            (r.matched ? `, ${r.matched} customer${r.matched === 1 ? "" : "s"} linked by name` : "") +
            (r.more ? ". More to fetch, it carries on with the next sync" : ""),
        ),
      onError: (e) => error(e.message),
    });
  }
  function runMatch() {
    match.mutate(undefined, {
      onSuccess: (n) => toast(n ? `Linked ${n} customer${n === 1 ? "" : "s"} by name` : "No new name matches"),
      onError: (e) => error(e.message),
    });
  }

  if (stateQ.isLoading) return <Loading />;
  if (stateQ.isError) return <ErrorNote error={stateQ.error} />;
  const s = stateQ.data;
  const customers = customersQ.data ?? [];
  const rows = show === "all" ? customers : customers.filter((c) => !bySage.has(c.sage_id));

  const columns: DataColumn<SageCustomer>[] = [
    { key: "name", header: "Sage customer", width: 260, sortValue: (c) => c.name, render: (c) => c.name },
    {
      key: "motion",
      header: "Motion customer",
      width: 260,
      sortValue: (c) => bySage.get(c.sage_id)?.company ?? "",
      render: (c) => {
        const m = bySage.get(c.sage_id);
        return m ? <Link to={`/clients/${m.id}?tab=account`}>{m.company}</Link> : <span className="hint">Not linked</span>;
      },
    },
    { key: "email", header: "Email", width: 220, sortValue: (c) => c.email ?? "", render: (c) => c.email ?? "" },
    {
      key: "balance",
      header: "Balance",
      width: 130,
      cellClass: "sage-num",
      sortValue: (c) => Number(c.balance) || 0,
      render: (c) => money(c.balance),
    },
  ];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, marginBottom: 12 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <h3 style={{ margin: "0 0 4px" }}>Sage Business Cloud Accounting</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Read-only. Invoices, payments and balances come in from Sage every 30 minutes and show on the customer record
            (Invoices &amp; Account) and on the Customer Portal (Invoices, dashboard). An invoice links to its shipment by the
            shipment number in its Reference, and fills in the shipment's Invoiced / Invoice No when blank.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <button type="button" className="btn outline" onClick={runMatch} disabled={match.isPending || customers.length === 0}>
            {match.isPending ? "Matching…" : "Link by name"}
          </button>
          <button type="button" className="btn" onClick={runSync} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <dl className="sage-state">
        <dt>Status</dt>
        <dd>
          {s?.last_error ? (
            <span className="badge inv-overdue">Error</span>
          ) : s?.last_ok_at ? (
            <span className="badge inv-paid">Connected</span>
          ) : (
            <span className="badge inv-due">Not connected yet</span>
          )}
          {s?.last_error && <span style={{ marginLeft: 8 }}>{s.last_error}</span>}
        </dd>
        <dt>Company</dt>
        <dd>{s?.company_name || (s?.company_id ? `#${s.company_id}` : "")}</dd>
        <dt>Last successful sync</dt>
        <dd>{s?.last_ok_at ? formatDateTime(s.last_ok_at) : "Never"}</dd>
        <dt>Synced</dt>
        <dd>
          {s?.customers ?? 0} Sage customers ({s?.linked_customers ?? 0} linked to Motion) · {s?.invoices ?? 0} invoices ·{" "}
          {s?.receipts ?? 0} receipts
        </dd>
      </dl>

      {!s?.last_ok_at && (
        <div className="panel" style={{ background: "var(--paper)", boxShadow: "none" }}>
          <h4 style={{ marginTop: 0 }}>Connect Sage</h4>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Ask the Sage Accounting API team (api@accounting.sageone.co.za) for an API key.</li>
            <li>In Sage, add a login for Motion (view-only if possible).</li>
            <li>
              In Cloudflare: Pages project › Settings › Variables and Secrets, add these as encrypted secrets, then redeploy:
              <ul style={{ margin: "4px 0" }}>
                {SECRETS.map(([k, v]) => (
                  <li key={k}>
                    <code>{k}</code>: {v}
                  </li>
                ))}
              </ul>
            </li>
            <li>Press Sync now. The first sync brings in the last two years of invoices.</li>
          </ol>
        </div>
      )}

      {customers.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 8px" }}>
            <h4 style={{ margin: 0 }}>Customer links</h4>
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
              <option value="unlinked">Not linked ({customers.filter((c) => !bySage.has(c.sage_id)).length})</option>
              <option value="all">All Sage customers ({customers.length})</option>
            </select>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            Link a customer on its record: Customers › the customer › Invoices &amp; Account.
          </p>
          <DataTable
            tableKey="sage-customers"
            className="table--compact"
            columns={columns}
            rows={rows}
            rowKey={(c) => String(c.sage_id)}
          />
        </>
      )}
    </>
  );
}
