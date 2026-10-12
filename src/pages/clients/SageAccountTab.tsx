// Customers › <customer> › Invoices & Account (0156): which Sage customer
// this is, its balance, outstanding / overdue / ageing and its invoices.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { AccountSummary, InvoiceTable, StatementButton } from "../../components/SageAccount";
import { useToast } from "../../components/Toast";
import { formatDateTime, money } from "../../lib/format";
import { useJobs } from "../../lib/hooks";
import {
  useCustomerInvoices,
  useLinkSageCustomer,
  useSageCustomers,
  useSageState,
} from "../../lib/sage";
import type { CustomerRecord } from "../../lib/customers";

export default function SageAccountTab({ client }: { client: CustomerRecord }) {
  const { toast, error } = useToast();
  const stateQ = useSageState();
  const customersQ = useSageCustomers();
  const invQ = useCustomerInvoices(client.id);
  const jobsQ = useJobs();
  const link = useLinkSageCustomer();
  const linkedId = client.sage_customer_id ?? null;
  const [pick, setPick] = useState<string>("");

  const sageCustomers = customersQ.data ?? [];
  const linked = sageCustomers.find((c) => c.sage_id === linkedId) ?? null;
  const shipments = useMemo(
    () => new Map((jobsQ.data ?? []).map((j) => [j.id, j.reference])),
    [jobsQ.data],
  );

  function save(sageId: number | null) {
    link.mutate(
      { clientId: client.id, sageId },
      {
        onSuccess: () => {
          toast(sageId ? "Linked to Sage" : "Unlinked from Sage");
          setPick("");
        },
        onError: (e) => error(e.message),
      },
    );
  }

  if (stateQ.isLoading || customersQ.isLoading) return <div className="panel"><Loading /></div>;
  if (stateQ.isError) return <div className="panel"><ErrorNote error={stateQ.error} /></div>;
  const state = stateQ.data;
  if (!state?.last_ok_at && sageCustomers.length === 0) {
    return (
      <div className="panel cr-section">
        <div className="cr-section-head">
          <h3>Invoices &amp; Account</h3>
        </div>
        <p className="hint">
          Sage Accounting hasn't synced yet. Connect it under{" "}
          <Link to="/settings?tab=sage">Settings › Sage Accounting</Link>, then link this customer to its Sage customer here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="panel cr-section">
        <div className="cr-section-head">
          <h3>Sage customer</h3>
          {linked && <StatementButton clientId={client.id} />}
        </div>
        <div className="cr-grid">
          <label className="cr-field" style={{ gridColumn: "span 2" }}>
            <span>Linked Sage customer</span>
            <select
              value={pick || (linkedId ? String(linkedId) : "")}
              onChange={(e) => setPick(e.target.value)}
              disabled={link.isPending}
            >
              <option value="">Not linked</option>
              {linkedId && !linked && <option value={String(linkedId)}>Sage customer #{linkedId}</option>}
              {sageCustomers.map((c) => (
                <option key={c.sage_id} value={String(c.sage_id)}>
                  {c.name}
                  {c.balance ? `, balance ${money(c.balance)}` : ""}
                  {c.active === false ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <button
              type="button"
              className="btn"
              disabled={link.isPending || pick === "" || pick === String(linkedId ?? "")}
              onClick={() => save(Number(pick))}
            >
              {link.isPending ? "Saving…" : "Link"}
            </button>
            {linkedId && (
              <button type="button" className="btn outline" disabled={link.isPending} onClick={() => save(null)}>
                Unlink
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          {linked
            ? `${linked.name} in Sage${linked.email ? ` · ${linked.email}` : ""}${linked.tax_reference ? ` · VAT ${linked.tax_reference}` : ""}. `
            : "Pick this customer's account in Sage. Customers with exactly the same name link by themselves on each sync. "}
          Invoices link to a shipment by the shipment number in the invoice's Reference.
          {state?.last_ok_at ? ` Last synced ${formatDateTime(state.last_ok_at)}.` : ""}
        </p>
      </div>

      {linkedId && (
        <div className="panel cr-section">
          <div className="cr-section-head">
            <h3>Invoices</h3>
          </div>
          {invQ.isLoading ? (
            <Loading />
          ) : invQ.isError ? (
            <ErrorNote error={invQ.error} />
          ) : (
            <>
              <AccountSummary invoices={invQ.data ?? []} balance={linked?.balance} />
              {(invQ.data ?? []).length === 0 ? (
                <EmptyState>No invoices from Sage for this customer yet.</EmptyState>
              ) : (
                <InvoiceTable
                  invoices={invQ.data ?? []}
                  tableKey="customer-sage-invoices"
                  shipments={shipments}
                  shipmentLink={(id) => ({ to: "/jobs", state: { openJobId: id } })}
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
