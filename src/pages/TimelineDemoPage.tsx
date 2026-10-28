import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ShipmentTimeline from "../components/ShipmentTimeline";
import ShipmentQuickUpdate from "../components/ShipmentQuickUpdate";
import type { Job } from "../lib/types";
import type { TimelineStep } from "../lib/timeline";

/**
 * DEV-ONLY: the shipment timeline (0196) with sample steps, so the layout
 * can be checked without a login or the migration. /dev/timeline
 * (?mode=air|road|fcl). Saving calls the real RPC, which refuses without
 * a staff session. Registered only when import.meta.env.DEV.
 */
const MODES: Record<string, { mode: string; steps: string[] }> = {
  lcl: {
    mode: "Sea Freight (LCL)",
    steps: ["Created", "Booked", "Collected", "Received", "Loaded", "Departed", "In Transit", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered"],
  },
  fcl: {
    mode: "Sea Freight (FCL)",
    steps: ["Created", "Booked", "Collected", "Loaded", "Departed", "In Transit", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered"],
  },
  air: {
    mode: "Air Freight (AIR)",
    steps: ["Created", "Booked", "Collected", "Received", "Departed", "In Transit", "Arrived", "Customs", "Detained", "Released", "On-Delivery", "Delivered"],
  },
  road: {
    mode: "Road Freight (RDX)",
    steps: ["Created", "Booked", "Collected", "Departed", "In Transit", "Arrived", "Customs", "Detained", "Released", "On-Delivery", "Delivered"],
  },
};
const DATES: Record<string, [string | null, string | null]> = {
  Created: [null, "2026-10-20"],
  Booked: [null, "2026-10-21"],
  Collected: ["2026-10-24", "2026-10-24"],
  Received: [null, null],
  Departed: ["2026-11-01", null],
  Arrived: ["2027-01-02", null],
  Delivered: ["2027-01-08", null],
};

export default function TimelineDemoPage() {
  const qc = useQueryClient();
  const key = new URLSearchParams(window.location.search).get("mode") ?? "lcl";
  const m = MODES[key] ?? MODES.lcl;
  useState(() => {
    const steps: TimelineStep[] = m.steps.map((step, i) => ({
      id: "s" + i,
      job_id: "demo",
      step,
      sort_order: i + 1,
      done: i <= 3 && step !== "Detained",
      planned_date: DATES[step]?.[0] ?? null,
      actual_date: i <= 3 ? (DATES[step]?.[1] ?? null) : null,
      note: step === "Collected" ? "Collected from supplier, 2 pallets" : null,
      skipped: false,
      customer_visible: step !== "Unloaded",
      updated_at: new Date().toISOString(),
    }));
    qc.setQueryDefaults(["job_timeline", "demo"], { staleTime: Infinity, retry: false });
    qc.setQueryData(["job_timeline", "demo"], steps);
    return null;
  });
  const [quick, setQuick] = useState(false);
  const job = {
    id: "demo", reference: "SEA744180", mode: m.mode, milestone: "Booked", shipment_status: "Received",
    etd: "2026-11-01", eta: "2027-01-02", provisional_delivery_date: "2027-01-08",
    awb_mbl: null, container_no: null, container_type: "1x 20GP", shipping_line: "OOCL", vessel_name: null, carrier_name: null,
    client: { id: "c1", company: "Netina Beukes" },
  } as unknown as Job;
  return (
    <div className="main" style={{ maxWidth: 1100, margin: "24px auto" }}>
      <p className="muted">
        DEV demo, sample data. ?mode=lcl | fcl | air | road{" "}
        <button className="btn small" onClick={() => setQuick(true)}>
          Open Quick update
        </button>
      </p>
      {quick && <ShipmentQuickUpdate job={job} onClose={() => setQuick(false)} onDelivered={() => {}} onEmail={() => {}} />}
      <ShipmentTimeline job={{ id: "demo", mode: m.mode, reference: "SEA744180" }} />
    </div>
  );
}
