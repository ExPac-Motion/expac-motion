import { useNavigate, useParams } from "react-router-dom";
import { ErrorNote, Loading, useBackTo } from "../../components/common";
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
  const goBack = useBackTo("/wms?tab=receipt");
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
      onClose={goBack}
      onEdit={() => navigate(`/wms/receipts/${r.id}/edit`)}
    />
  );
}

export function WmsCountPage() {
  const { id } = useParams();
  const q = useWmsCounts();
  const goBack = useBackTo("/wms?tab=count");
  if (q.isLoading) return <Loading />;
  const c = (q.data ?? []).find((x) => x.id === id);
  if (!c) return <ErrorNote error={new Error("Cycle count not found")} />;
  return <CountSheetModal page count={c} onClose={goBack} />;
}

export function WmsConsolPage() {
  const { id } = useParams();
  const q = useWmsConsols();
  const goBack = useBackTo("/wms?tab=release");
  if (q.isLoading) return <Loading />;
  const c = (q.data ?? []).find((x) => x.id === id);
  if (!c) return <ErrorNote error={new Error("Consolidation not found")} />;
  return <ConsolEditModal page consol={c} mode={c.mode} onClose={goBack} />;
}
