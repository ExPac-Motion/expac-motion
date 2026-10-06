import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common";
import WmsDashboard from "./wms/WmsDashboard";
import WmsReports from "./wms/WmsReports";
import WmsReceipts from "./wms/WmsReceipts";
import WmsMovements from "./wms/WmsMovements";
import WmsReleases from "./wms/WmsReleases";
import WmsInventory from "./wms/WmsInventory";
import WmsBilling from "./wms/WmsBilling";
import WmsCycleCount from "./wms/WmsCycleCount";
import WmsSettings from "./wms/WmsSettings";

type Tab =
  | "dashboard"
  | "reports"
  | "receipt"
  | "movements"
  | "release"
  | "inventory"
  | "billing"
  | "count"
  | "settings";

const COPY: Record<Tab, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Warehouse Management", title: "WMS Dashboard" },
  reports: { eyebrow: "Warehouse Management", title: "Reports" },
  receipt: { eyebrow: "Goods in", title: "Warehouse Receipt" },
  movements: { eyebrow: "Inside the warehouse", title: "Warehouse Movements" },
  release: { eyebrow: "Goods out", title: "Warehouse Release" },
  inventory: { eyebrow: "On hand", title: "Warehouse Inventory" },
  billing: { eyebrow: "Storage charges", title: "Warehouse Billing (Storage)" },
  count: { eyebrow: "Stock accuracy", title: "Cycle Count" },
  settings: { eyebrow: "Configuration", title: "WMS Settings" },
};

/** WMS (migration 0137), sub-nav lives in the shared top-nav (Layout.tsx), driven by ?tab=. */
export default function WmsPage() {
  const [params] = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && asked in COPY ? asked : "dashboard";
  const copy = COPY[tab];
  return (
    <>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} />
      {tab === "dashboard" && <WmsDashboard />}
      {tab === "reports" && <WmsReports />}
      {tab === "receipt" && <WmsReceipts />}
      {tab === "movements" && <WmsMovements />}
      {tab === "release" && <WmsReleases />}
      {tab === "inventory" && <WmsInventory />}
      {tab === "billing" && <WmsBilling />}
      {tab === "count" && <WmsCycleCount />}
      {tab === "settings" && <WmsSettings />}
    </>
  );
}
