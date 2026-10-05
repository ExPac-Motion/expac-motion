import { useMemo } from "react";
import { useClients, useJobs, useProfiles, useSuppliers } from "../../lib/hooks";
import {
  locationLabel,
  RECEIPT_STATUS_LABEL,
  useWmsLocations,
  useWmsWarehouses,
  type ReceiptStatus,
  type WmsLocation,
} from "../../lib/wms";

/** Name lookups every WMS screen needs (customers, shipments, bays…). */
export function useWmsLookups() {
  const clientsQ = useClients();
  const suppliersQ = useSuppliers();
  const jobsQ = useJobs();
  const profilesQ = useProfiles();
  const whQ = useWmsWarehouses();
  const locQ = useWmsLocations();
  return useMemo(() => {
    const clients = clientsQ.data ?? [];
    const suppliers = suppliersQ.data ?? [];
    const jobs = jobsQ.data ?? [];
    const warehouses = whQ.data ?? [];
    const locations = locQ.data ?? [];
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const supplierById = new Map(suppliers.map((c) => [c.id, c]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const whById = new Map(warehouses.map((w) => [w.id, w]));
    const locById = new Map(locations.map((l) => [l.id, l]));
    const profileById = new Map((profilesQ.data ?? []).map((p) => [p.id, p]));
    return {
      clients,
      suppliers,
      jobs,
      warehouses,
      locations,
      clientName: (id: string | null | undefined) => (id ? clientById.get(id)?.company ?? "—" : "—"),
      client: (id: string | null | undefined) => (id ? clientById.get(id) : undefined),
      supplier: (id: string | null | undefined) => (id ? supplierById.get(id) : undefined),
      jobRef: (id: string | null | undefined) => (id ? jobById.get(id)?.reference ?? "—" : "—"),
      job: (id: string | null | undefined) => (id ? jobById.get(id) : undefined),
      warehouse: (id: string | null | undefined) => (id ? whById.get(id) : undefined),
      whCode: (id: string | null | undefined) => (id ? whById.get(id)?.code ?? "—" : "—"),
      location: (id: string | null | undefined) => (id ? locById.get(id) : undefined),
      locName: (id: string | null | undefined) => locationLabel(id ? locById.get(id) : null),
      person: (id: string | null | undefined) =>
        id ? profileById.get(id)?.full_name ?? "—" : "—",
      loading: whQ.isLoading || locQ.isLoading || clientsQ.isLoading,
    };
  }, [clientsQ.data, suppliersQ.data, jobsQ.data, profilesQ.data, whQ.data, locQ.data, whQ.isLoading, locQ.isLoading, clientsQ.isLoading]);
}

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const cls = status === "released" ? "completed" : status === "part_released" ? "sent" : "open";
  return <span className={`badge ${cls}`}>{RECEIPT_STATUS_LABEL[status]}</span>;
}

/** Bays of one warehouse grouped by zone, as <option>s / <optgroup>s. */
export function LocationOptions({
  locations,
  warehouseId,
  includeInactive,
}: {
  locations: WmsLocation[];
  warehouseId: string | null | undefined;
  includeInactive?: boolean;
}) {
  const list = locations.filter(
    (l) => l.warehouse_id === warehouseId && (includeInactive || l.active),
  );
  const zones = [...new Set(list.map((l) => l.zone ?? ""))].sort();
  return (
    <>
      {zones.map((z) => {
        const opts = list
          .filter((l) => (l.zone ?? "") === z)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {locationLabel(l)}
              {l.name ? ` — ${l.name}` : ""}
            </option>
          ));
        return z ? (
          <optgroup key={z} label={`Zone ${z}`}>
            {opts}
          </optgroup>
        ) : (
          opts
        );
      })}
    </>
  );
}

/** <select> value helpers: "" ↔ null. */
export const orNull = (v: string) => (v === "" ? null : v);

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" | "orange" | "teal" }) {
  return (
    <div className={`card wms-kpi${tone ? ` ${tone}` : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="wms-kpi-sub">{sub}</div>}
    </div>
  );
}
