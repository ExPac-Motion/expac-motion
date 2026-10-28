import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * DEV-ONLY sample data for the shipment workspace page:
 * /dev/shipment/demo-job (?tab=...). Registered only when
 * import.meta.env.DEV; anything that saves calls the real API and is
 * refused without a staff session.
 */
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const day = (d: number) => ago(d).slice(0, 10);
const ID = "demo-job";
const STEPS = ["Created", "Booked", "Collected", "Received", "Loaded", "Departed", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered"];

export function ShipmentWorkspaceSeed({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useState(() => {
    const seed = (key: unknown[], data: unknown) => {
      qc.setQueryDefaults(key, { staleTime: Infinity, retry: false, refetchInterval: false });
      qc.setQueryData(key, data);
    };
    seed(["my_profile"], { id: "u1", full_name: "Admin", role: "admin", client_id: null, portal_permissions: {} });
    seed(["my_permissions"], {});
    seed(["profiles"], [{ id: "u1", full_name: "Admin", role: "admin" }]);
    seed(["jobs"], [
      {
        id: ID, quote_id: "q-demo", reference: "SEA744180", client_id: "c1", supplier_id: "s1",
        origin: "USNYC", destination: "ZADUR", mode: "Sea Freight (LCL)", milestone: "Booked",
        po_no: "Fragile Collectibles", shipment_status: "Received", notes: "Customer wants delivery before month end.",
        ops_remarks: null, awb_mbl: null, container_no: null, container_type: "1x 20GP", shipping_line: "OOCL",
        vessel_name: null, provisional_delivery_date: day(-20), carrier_name: null, scac: null,
        etd: day(2), eta: day(-14), created_at: ago(5),
        client: { id: "c1", company: "Netina Beukes", contact: "Netina Beukes", email: "netina@example.co.za", phone: "+27 82 555 0101" },
        supplier: { id: "s1", company: "Stackery", contact: "Sam Lee", email: "sam@stackery.example", phone: null },
        job_events: [
          { id: "e1", job_id: ID, milestone: "Created", note: "Job created from accepted quote", created_at: ago(5), created_by: "u1" },
          { id: "e2", job_id: ID, milestone: "Booked", note: 'Shipment Status set to "Booked"', created_at: ago(4), created_by: "u1" },
          { id: "e3", job_id: ID, milestone: "Booked", note: "Revised ETA 08 Nov → 12 Nov: vessel delayed", created_at: ago(2), created_by: "u1" },
        ],
      },
    ]);
    seed(
      ["job_timeline", ID],
      STEPS.map((step, i) => ({
        id: "t" + i, job_id: ID, step, sort_order: i + 1, done: i <= 3 && step !== "Detained",
        planned_date: step === "Departed" ? day(2) : step === "Arrived" ? day(-14) : step === "Delivered" ? day(-20) : step === "Loaded" ? day(1) : null,
        actual_date: i <= 3 ? day(5 - i) : null, note: null, skipped: false, customer_visible: true, updated_at: ago(1),
      })),
    );
    seed(["shipment_documents", ID], [
      { id: "d1", job_id: ID, name: "CI-4471.pdf", storage_path: "x", kind: "document", doc_type: "Commercial Invoice", visible_to_client: true, size_bytes: 120000, created_by: "u1", created_at: ago(3) },
      { id: "d2", job_id: ID, name: "PL-4471.pdf", storage_path: "y", kind: "document", doc_type: "Packing List", visible_to_client: true, size_bytes: 80000, created_by: "u1", created_at: ago(3) },
    ]);
    seed(["ops_tasks"], [
      { id: "k1", kind: "task", title: "Request commercial invoice", body: null, status: "done", priority: "normal", due_date: null, job_id: ID, quote_id: null, client_id: "c1", lead_id: null, supplier_id: null, created_by: "u1", created_at: ago(5), updated_at: ago(3), done_at: ago(3), assigned_to: null },
      { id: "k2", kind: "task", title: "Book carrier", body: null, status: "open", priority: "high", due_date: day(-1), job_id: ID, quote_id: null, client_id: "c1", lead_id: null, supplier_id: null, created_by: "u1", created_at: ago(5), updated_at: ago(5), done_at: null, assigned_to: null },
      { id: "k3", kind: "task", title: "Send booking confirmation to customer", body: null, status: "open", priority: "normal", due_date: null, job_id: ID, quote_id: null, client_id: "c1", lead_id: null, supplier_id: null, created_by: "u1", created_at: ago(5), updated_at: ago(5), done_at: null, assigned_to: null },
    ]);
    seed(["quotes", "q-demo"], {
      id: "q-demo", reference: "SEA744180", commodity: "Collectible figurines", incoterms: "FOB",
      fx_usd_zar: 18.2, fx_cny_zar: 2.5, fx_eur_zar: 19.8, fx_gbp_zar: 23,
      quote_lines: [
        { id: "l1", position: 0, category: "International Freight Charges", code: "OF-06", description: "Ocean freight LCL", unit: "CBM", qty: 1.81, cur: "ZAR", buy: 2375, margin: 15, vat_pct: 0, sell: 2731.25 },
        { id: "l2", position: 1, category: "Customs Clearance, VAT and Duty Charges", code: "CC-01", description: "Customs clearance", unit: "Shipment", qty: 1, cur: "ZAR", buy: 1200, margin: 35, vat_pct: 15, sell: 1850 },
        { id: "l3", position: 2, category: "Destination Handling and Delivery Charges", code: "DL-01", description: "Delivery to Durban", unit: "Shipment", qty: 1, cur: "ZAR", buy: 950, margin: 34, vat_pct: 15, sell: 1450 },
      ],
      packing_list_items: [
        { id: "p1", position: 0, length_cm: 63.5, width_cm: 43.5, height_cm: 65.5, actual_kg: 16, qty_ctns: 10, qty_pcs: 120, cbm: null },
      ],
    });
    return null;
  });
  return <>{children}</>;
}
