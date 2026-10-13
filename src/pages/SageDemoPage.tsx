import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SageSettingsTab from "./SageSettingsTab";
import SageAccountTab from "./clients/SageAccountTab";
import CustomerMessagesTab from "./crm/CustomerMessagesTab";
import MastersPage from "./shipments/MastersPage";
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
    seed(["my_jobs"], JOBS.map((j, i) => ({ ...j, quote_id: j.id === "job-2" ? "q-2" : null, shipment_status: j.id === "job-2" ? "In Transit" : null, eta: j.id === "job-2" ? day(9) : null, client_id: CLIENT, milestone: "In Transit", created_at: day(-60 + i * 7), etd: day(-50 + i * 7), origin: i % 2 ? "CNSZX, Shenzhen, China" : "CNNGB, Ningbo, China", supplier_company: i % 2 ? "Brilliant Rays Wheels Trading Co. Ltd" : "Shenzhen Bright Lighting Co." })));
    seed(["my_documents_all"], []);
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const CHAT = [
      { id: "g1", client_id: CLIENT, direction: "in", body: "Hi, can you send us your latest LCL rates from Ningbo to Durban?", sender_name: "Mr. Gilbert", sender_email: "gilbert@demoimports.co.za", created_at: ago(180), read_at: ago(170) },
      { id: "g2", client_id: CLIENT, direction: "out", body: "Morning Mr. Gilbert, the updated tariff is on your portal under Tariff Sheet. Shout if you need a quote.", sender_name: "Elvis Mondlana", sender_email: null, created_at: ago(160), read_at: null },
      { id: "g3", client_id: CLIENT, direction: "in", body: "Thanks! Also, who do we speak to about our account statement?", sender_name: "Mr. Gilbert", sender_email: "gilbert@demoimports.co.za", created_at: ago(12), read_at: null },
    ];
    seed(["my_general_chat"], CHAT);
    seed(["client_chat", CLIENT], CHAT);
    seed(["client_chat"], [
      ...CHAT.slice().reverse().map((m) => ({ ...m, clients: { company: "Demo Imports (Pty) Ltd", email: "accounts@demoimports.co.za" } })),
      { id: "g9", client_id: "c-2", direction: "in", body: "Please update our delivery address for future shipments.", sender_name: "Thandi", sender_email: "thandi@highveld.co.za", created_at: ago(60 * 26), read_at: ago(60 * 25), clients: { company: "Highveld Outdoor Gear", email: "finance@highveld.co.za" } },
    ]);
    seed(["client_chat", "c-2"], []);
    // Portal shipment page (/dev/portal/shipments/job-2)
    seed(["my_job_events", "job-2"], [
      { id: "e1", job_id: "job-2", milestone: "Booked", created_at: ago(60 * 24 * 20) },
      { id: "e2", job_id: "job-2", milestone: "In Transit", created_at: ago(60 * 24 * 12) },
    ]);
    seed(["my_job_tracking"], []);
    seed(["my_tracking_events", "job-2"], []);
    seed(["my_documents", "job-2"], [
      { id: "d1", job_id: "job-2", name: "Commercial Invoice CI-2087.pdf", storage_path: "x", doc_type: "Commercial Invoice", house_id: "h1", created_at: ago(60 * 24 * 18) },
      { id: "d2", job_id: "job-2", name: "House Bill of Lading.pdf", storage_path: "y", doc_type: "Bill of Lading", created_at: ago(60 * 24 * 11) },
    ]);
    seed(["my_messages", "job-2"], []);
    seed(["my_status_history", "job-2"], [
      { status: "Booked", changed_at: ago(60 * 24 * 20) },
      { status: "Collected", changed_at: ago(60 * 24 * 17) },
      { status: "Received", changed_at: ago(60 * 24 * 15) },
      { status: "Loaded", changed_at: ago(60 * 24 * 13) },
      { status: "Departed", changed_at: ago(60 * 24 * 12) },
      { status: "In Transit", changed_at: ago(60 * 24 * 11) },
    ]);
    {
      const job = { id: "job-m", reference: "SEA160984", mode: "Sea Freight (LCL)", milestone: "Booked", shipment_status: "Booked", etd: day(6), eta: day(34), awb_mbl: "MEDUNB123456", container_no: null, quote_id: "q-m", client_id: CLIENT, client: { id: CLIENT, company: "Connell Investment Holdings", email: "gilbert@connell.co.za" } };
      const base = { job_id: "job-m", commodity: null, commercial_value: null, value_currency: "USD", notes: null, cargo_ready_date: null, hbl_issued_at: null, loaded_at: null, job };
      seed(["job_houses", "board"], {
        houses: [
          { ...base, id: "mh1", position: 1, house_no: "SEA160984-1", supplier_id: "s1", supplier: { id: "s1", company: "Brilliant Rays Wheels Trading Co. Ltd", email: "steven@brilliantrays.cn", contact: "Steven" }, pieces: 4, gross_kg: 180, volume_cbm: 0.6, carrier_house_no: "NGB2410331", cargo_ready_date: day(-2) },
          { ...base, id: "mh2", position: 2, house_no: "SEA160984-2", supplier_id: "s2", supplier: { id: "s2", company: "Shenzhen Grepow Battery Co Ltd", email: null, contact: null }, pieces: 2, gross_kg: 95, volume_cbm: 0.4, carrier_house_no: null },
        ],
        receipts: [{ id: "r1", receipt_no: "WR000214", house_id: "mh1", job_id: "job-m", pieces: 4, gross_kg: 182, volume_cbm: 0.62, received_at: ago(60 * 24) }, { id: "r2", receipt_no: "WR000219", house_id: null, job_id: "job-m", pieces: 2, gross_kg: 95, volume_cbm: 0.4, received_at: ago(60 * 5) }],
        docs: [
          { id: "x1", house_id: "mh1", doc_type: "Commercial Invoice" },
          { id: "x2", house_id: "mh1", doc_type: "Packing List" },
        ],
        quoted: [{ quote_id: "q-m", position: 0, length_cm: 100, width_cm: 100, height_cm: 100, actual_kg: 275, qty_ctns: 1, cbm: 1 }],
      });
    }
    seed(["my_job_houses", "job-2"], [
      { id: "h1", job_id: "job-2", position: 1, house_no: "EXP-S2087-1", supplier_company: "Shenzhen Bright Lighting Co.", pieces: 2, gross_kg: 280, volume_cbm: 0.6, commodity: "LED panels", commercial_value: 7400, value_currency: "USD", carrier_house_no: "NGB2410331" },
      { id: "h2", job_id: "job-2", position: 2, house_no: "EXP-S2087-2", supplier_company: "Ningbo Ocean Tools", pieces: 1, gross_kg: 140, volume_cbm: 0.4, commodity: "Hand tools", commercial_value: 5100, value_currency: "USD", carrier_house_no: null },
    ]);
    seed(["portal", "quotes"], [
      { id: "q-2", reference: "EXP-S2087", client_id: CLIENT, mode: "Sea Freight (LCL)", commodity: "General Cargo", origin: "CNNGB, Ningbo, China", destination: "ZADUR, Durban, South Africa", delivery_terms: "Door to Door", incoterms: "FOB", commercial_value: 12500, value_currency: "USD", insurance_amount: 0, status: "accepted", accepted_at: ago(60 * 24 * 21), customer_reference: "PO-5521", consignee_company: "Demo Imports (Pty) Ltd", revision_no: 1, created_at: ago(60 * 24 * 25) },
    ]);
    seed(["portal", "lines", ["q-2"]], [
      { id: "l1", quote_id: "q-2", position: 0, category: "International Freight Charges", code: "OF-06", description: "Ocean Freight (LCL-DDP)", unit: "W/M", qty: 1, cur: "ZAR", vat_pct: 0, sell: 18500 },
      { id: "l2", quote_id: "q-2", position: 1, category: "Destination Handling and Delivery Charges", code: "TR-01", description: "Transfer & Cartage Fee", unit: "AWB", qty: 1, cur: "ZAR", vat_pct: 15, sell: 3200 },
    ]);
    seed(["portal", "packing", "q-2"], [
      { position: 0, length_cm: 120, width_cm: 100, height_cm: 110, actual_kg: 420, qty_ctns: 3, cbm: null },
    ]);
    seed(["my_suppliers"], [
      { id: "s-1", company: "Brilliant Rays Wheels Trading Co. Ltd", contact: "Steven", email: null, phone: "+86-13258156783", address: "No. 18 Industrial Rd\nNingbo, Zhejiang", vat_no: null, editable: true },
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

export function CustomerMessagesDemo() {
  return (
    <div className="main">
      <SageDemoSeed>
        <h1 style={{ marginTop: 0 }}>Customer Messages</h1>
        <CustomerMessagesTab />
      </SageDemoSeed>
    </div>
  );
}

export function MastersDemo() {
  return (
    <div className="main">
      <SageDemoSeed>
        <MastersPage />
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
