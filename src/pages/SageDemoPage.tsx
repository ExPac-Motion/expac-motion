import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SageSettingsTab from "./SageSettingsTab";
import SageAccountTab from "./clients/SageAccountTab";
import type { CustomerRecord } from "../lib/customers";
import type { CustomerInvoice, SageCustomer, SageState } from "../lib/sage";

/**
 * DEV-ONLY preview of the Sage Accounting screens (0156) with fabricated
 * data, so they can be checked before Sage is connected:
 *   /dev/portal/invoices   Customer Portal › Invoices (and /dev/portal dashboard donut)
 *   /dev/sage-settings     Settings › Sage Accounting
 *   /dev/sage-customer     Customers › <customer> › Invoices & Account
 * Routes are only registered when import.meta.env.DEV, they can't reach prod.
 */

const CLIENT = "00000000-0000-4000-8000-000000000001";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const JOBS = [
  { id: "job-1", reference: "EXP-A1042", mode: "Air Freight (AIR)" },
  { id: "job-2", reference: "EXP-S2087", mode: "Sea Freight (LCL)" },
  { id: "job-3", reference: "EXP-A1051", mode: "Air Freight (AIR)" },
  { id: "job-4", reference: "EXP-S2093", mode: "Sea Freight (FCL)" },
  { id: "job-5", reference: "EXP-A1063", mode: "Courier Express (CX)" },
  { id: "job-6", reference: "EXP-S2101", mode: "Sea Freight (LCL)" },
];

function inv(
  n: number,
  job: string | null,
  dateOffset: number,
  total: number,
  due: number,
  ref?: string,
): CustomerInvoice {
  return {
    sage_id: 9000 + n,
    sage_customer_id: 501,
    client_id: CLIENT,
    job_id: job,
    document_number: `INV${String(4400 + n).padStart(6, "0")}`,
    reference: ref ?? JOBS.find((j) => j.id === job)?.reference ?? null,
    invoice_date: day(dateOffset),
    due_date: day(dateOffset + 30),
    exclusive: Math.round((total / 1.15) * 100) / 100,
    tax: Math.round((total - total / 1.15) * 100) / 100,
    total,
    amount_due: due,
    paid: due <= 0,
    status: due <= 0 ? "Paid" : "Unpaid",
    synced_at: new Date().toISOString(),
  };
}

const INVOICES: CustomerInvoice[] = [
  inv(12, "job-6", -3, 18_420.5, 18_420.5),
  inv(11, "job-5", -12, 4_315.0, 4_315.0),
  inv(10, "job-4", -38, 96_880.0, 46_880.0),
  inv(9, "job-3", -45, 12_765.25, 12_765.25),
  inv(8, "job-2", -58, 34_210.0, 34_210.0),
  inv(7, "job-1", -75, 22_940.8, 22_940.8),
  inv(6, null, -90, 3_450.0, 0, "Storage Aug"),
  inv(5, null, -120, 28_330.0, 0, "EXP-S1990"),
  inv(4, null, -150, 15_102.4, 0, "EXP-A0977"),
];

const SAGE_CUSTOMERS: SageCustomer[] = [
  { sage_id: 501, name: "Demo Imports (Pty) Ltd", email: "accounts@demoimports.co.za", tax_reference: "4123456789", balance: 139_531.55, credit_limit: 250_000, active: true, synced_at: new Date().toISOString() },
  { sage_id: 502, name: "Highveld Outdoor Gear", email: "finance@highveld.co.za", tax_reference: null, balance: 8_740, credit_limit: null, active: true, synced_at: new Date().toISOString() },
  { sage_id: 503, name: "Cape Coast Trading CC", email: null, tax_reference: "4987654321", balance: 0, credit_limit: null, active: true, synced_at: new Date().toISOString() },
  { sage_id: 504, name: "Old Account Holdings", email: null, tax_reference: null, balance: 0, credit_limit: null, active: false, synced_at: new Date().toISOString() },
];

const STATE: SageState = {
  company_id: 123456,
  company_name: "ExPac (Pty) Ltd",
  last_sync_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  last_ok_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  last_error: null,
  customers: SAGE_CUSTOMERS.length,
  invoices: 214,
  receipts: 187,
  linked_customers: 2,
};

const DEMO_CLIENT = {
  id: CLIENT,
  company: "Demo Imports (Pty) Ltd",
  sage_customer_id: 501,
} as unknown as CustomerRecord;

/** Fills the query cache with the sample data (and keeps it from refetching). */
export function SageDemoSeed({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useState(() => {
    const seed = (key: unknown[], data: unknown) => {
      qc.setQueryDefaults(key, { staleTime: Infinity, retry: false });
      qc.setQueryData(key, data);
    };
    seed(["customer_invoices", "mine"], INVOICES);
    seed(["customer_invoices", CLIENT], INVOICES);
    seed(["my_sage_account"], { balance: 139_531.55, synced_at: STATE.last_ok_at });
    seed(["sage_state"], STATE);
    seed(["sage_customers"], SAGE_CUSTOMERS);
    seed(["clients"], [
      { id: CLIENT, company: "Demo Imports (Pty) Ltd", sage_customer_id: 501 },
      { id: "c-2", company: "Highveld Outdoor Gear", sage_customer_id: 502 },
    ]);
    seed(["jobs"], JOBS);
    seed(["my_jobs"], JOBS.map((j, i) => ({ ...j, client_id: CLIENT, milestone: "In Transit", shipment_status: null, created_at: day(-60 + i * 7), etd: day(-50 + i * 7), origin: i % 2 ? "CNSZX, Shenzhen, China" : "CNNGB, Ningbo, China", supplier_company: i % 2 ? "Brilliant Rays Wheels Trading Co. Ltd" : "Shenzhen Bright Lighting Co." })));
    seed(["my_documents_all"], []);
    seed(["my_suppliers"], [
      { id: "s-1", company: "Brilliant Rays Wheels Trading Co. Ltd", contact: "Steven", email: null, phone: "+86-13258156783" },
      { id: "s-2", company: "Shenzhen Bright Lighting Co.", contact: "Lily Chen", email: "lily@brightlighting.cn", phone: "+86 755 8888 1234" },
      { id: "s-3", company: "Ningbo Ocean Tools", contact: null, email: "export@oceantools.com", phone: null },
    ]);
    return true;
  });
  return <>{children}</>;
}

export function SageSettingsDemo() {
  return (
    <div className="main">
      <SageDemoSeed>
        <div className="panel">
          <SageSettingsTab />
        </div>
      </SageDemoSeed>
    </div>
  );
}

export function SageCustomerDemo() {
  return (
    <div className="main">
      <SageDemoSeed>
        <h1 style={{ marginTop: 0 }}>Demo Imports (Pty) Ltd › Invoices &amp; Account</h1>
        <SageAccountTab client={DEMO_CLIENT} />
      </SageDemoSeed>
    </div>
  );
}
