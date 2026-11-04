// find_status_updates: active shipments whose status looks behind the
// dates and live tracking, with the status they probably should be.

import { compact, sastDate } from "../env.ts";
import { SHIPMENT_STATUSES } from "./actions.ts";
import type { ReadTool } from "./types.ts";

const rank = (s: string | null | undefined) => (s ? SHIPMENT_STATUSES.indexOf(s) : -1);
const DEPARTED = rank("Departed");
const ARRIVED = rank("Arrived");
const DELIVERED = rank("Delivered");

interface Row {
  id: string;
  reference: string;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  shipment_status: string | null;
  etd: string | null;
  eta: string | null;
  provisional_delivery_date: string | null;
  client: { company: string } | null;
}
interface Track {
  job_id: string;
  atd: string | null;
  pod_ata: string | null;
  status: string | null;
}

export const findStatusUpdates: ReadTool = {
  name: "find_status_updates",
  kind: "read",
  description:
    "Active shipments whose status looks out of date: departure date or tracked departure passed but not Departed, arrival date or tracked arrival passed but not Arrived, delivery date passed but not Delivered, or no status at all. Returns each with its current status, the suggested status and why. Use when the user wants to update statuses but has not said which shipment.",
  input_schema: {
    type: "object",
    properties: { limit: { type: "integer", description: "Max shipments, default 25." } },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const today = sastDate(0);
    const [jobsR, trackR] = await Promise.all([
      ctx.db
        .from("jobs")
        .select("id,reference,mode,origin,destination,shipment_status,etd,eta,provisional_delivery_date,client:clients(company)")
        .is("ops_completed_at", null)
        .neq("shipment_status", "Delivered")
        .limit(500),
      ctx.db.from("job_tracking").select("job_id,atd,pod_ata,status"),
    ]);
    if (jobsR.error) throw new Error(jobsR.error.message);
    // Shipments with no status are skipped by neq above; fetch them too.
    const { data: blank } = await ctx.db
      .from("jobs")
      .select("id,reference,mode,origin,destination,shipment_status,etd,eta,provisional_delivery_date,client:clients(company)")
      .is("ops_completed_at", null)
      .is("shipment_status", null)
      .limit(100);
    const tracks = new Map<string, Track>();
    for (const t of (trackR.data ?? []) as Track[]) tracks.set(t.job_id, t);

    const out: Record<string, unknown>[] = [];
    for (const j of [...((jobsR.data ?? []) as unknown as Row[]), ...((blank ?? []) as unknown as Row[])]) {
      const r = rank(j.shipment_status);
      const t = tracks.get(j.id);
      let suggest: string | null = null;
      let why = "";
      if (j.provisional_delivery_date && j.provisional_delivery_date < today && r >= ARRIVED && r < DELIVERED) {
        suggest = "Delivered";
        why = `planned delivery ${j.provisional_delivery_date} has passed`;
      } else if (t?.pod_ata && r < ARRIVED) {
        suggest = "Arrived";
        why = `tracking shows arrival on ${t.pod_ata.slice(0, 10)}`;
      } else if (j.eta && j.eta < today && r < ARRIVED) {
        suggest = "Arrived";
        why = `ETA ${j.eta} has passed (check it really arrived)`;
      } else if (t?.atd && r < DEPARTED) {
        suggest = "Departed";
        why = `tracking shows departure on ${t.atd.slice(0, 10)}`;
      } else if (j.etd && j.etd < today && r < DEPARTED) {
        suggest = "Departed";
        why = `ETD ${j.etd} has passed (check it really left)`;
      } else if (!j.shipment_status) {
        suggest = "Booked";
        why = "no status set yet";
      }
      if (suggest) {
        out.push({
          reference: j.reference,
          customer: j.client?.company,
          route: [j.origin, j.destination].filter(Boolean).join(" to "),
          mode: j.mode,
          current_status: j.shipment_status ?? "none",
          suggested_status: suggest,
          why,
        });
      }
    }
    const lim = Math.min(Math.max(Number(input.limit) || 25, 1), 60);
    return { today, count: out.length, shipments: compact(out.slice(0, lim)) };
  },
};
