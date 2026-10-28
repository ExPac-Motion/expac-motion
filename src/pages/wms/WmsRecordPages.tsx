import { useNavigate, useParams } from "react-router-dom";
import { ErrorNote, Loading } from "../../components/common";
import { useWmsConsols, useWmsCounts, useWmsReceipts } from "../../lib/wms";
import { ReceiptEditModal, ReceiptViewModal } from "./WmsReceipts";
import { CountSheetModal } from "./WmsCycleCount";
import { ConsolEditModal } from "./WmsConsols";

/**
 * WMS records as full pages (same build as shipments / quotes / leads):
 * /wms/receipts/:id, /wms/receipts/:id/edit, /wms/counts/:id and
 * /wms/consols/:id. Each reuses its screen with page={true}; "New ..."
 * dialogs on the lists stay pop-ups.
 */

export function WmsReceiptPage({ edit }: { edit?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useWmsReceipts();
  if (q.isLoading) return <Loading />;
  const r = (q.data ?? []).find((x) => x.id === id);
  if (!r) return <ErrorNote error={new Error("Receipt not found")} />;
  return edit ? (
    <ReceiptEditModal
      page
      receipt={r}
      onClose={() => navigate(`/wms/receipts/${r.id}`)}
      onSaved={() => navigate(`/wms/receipts/${r.id}`)}
    />
  ) : (
    <ReceiptViewModal
      page
      receipt={r}
      onClose={() => navigate("/wms?tab=receipt")}
      onEdit={() => navigate(`/wms/receipts/${r.id}/edit`)}
    />
  );
}

export function WmsCountPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useWmsCounts();
  if (q.isLoading) return <Loading />;
  const c = (q.data ?? []).find((x) => x.id === id);
  if (!c) return <ErrorNote error={new Error("Cycle count not found")} />;
  return <CountSheetModal page count={c} onClose={() => navigate("/wms?tab=count")} />;
}

export function WmsConsolPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useWmsConsols();
  if (q.isLoading) return <Loading />;
  const c = (q.data ?? []).find((x) => x.id === id);
  if (!c) return <ErrorNote error={new Error("Consolidation not found")} />;
  return <ConsolEditModal page consol={c} mode={c.mode} onClose={() => navigate("/wms?tab=release")} />;
}
