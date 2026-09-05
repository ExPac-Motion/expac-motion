import { useMemo, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  RowActions,
  RowActionsHead,
} from "../components/common";
import { useToast } from "../components/Toast";
import {
  useDeleteRateSheetItem,
  useRateSheet,
  useSaveRateSheetItem,
} from "../lib/hooks";
import {
  CHARGE_CATEGORIES,
  LINE_CURRENCIES,
  QUOTE_MODES,
  type ChargeCategory,
  type LineCurrency,
  type QuoteMode,
  type RateSheetItem,
  type RateSheetPatch,
} from "../lib/types";

export default function RatesPage() {
  const { data, isLoading, isError, error } = useRateSheet();
  const save = useSaveRateSheetItem();
  const remove = useDeleteRateSheetItem();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState<RateSheetItem | "new" | null>(null);
  const [modeFilter, setModeFilter] = useState<QuoteMode | "All">("All");

  const rows = useMemo(() => {
    const list = data ?? [];
    return modeFilter === "All" ? list : list.filter((r) => r.mode === modeFilter);
  }, [data, modeFilter]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: RateSheetPatch = {
      mode: fd.get("mode") as QuoteMode,
      origin: String(fd.get("origin") || "").trim().toUpperCase() || null,
      destination: String(fd.get("destination") || "").trim().toUpperCase() || null,
      carrier: String(fd.get("carrier") || "").trim() || null,
      category: fd.get("category") as ChargeCategory,
      code: String(fd.get("code") || "").trim() || null,
      description: String(fd.get("description") || "").trim(),
      unit: String(fd.get("unit") || "").trim() || null,
      cur: fd.get("cur") as LineCurrency,
      buy: Number(fd.get("buy")) || 0,
      margin: Number(fd.get("margin")) || 0,
      notes: String(fd.get("notes") || "").trim() || null,
    };
    if (!patch.description) {
      toastError("Description is required");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        patch,
      });
      setEditing(null);
      toast("Saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(row: RateSheetItem) {
    if (!window.confirm(`Remove this rate for "${row.description}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Rate removed");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  async function onDuplicate(row: RateSheetItem) {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
    try {
      await save.mutateAsync({ patch: rest });
      toast("Rate duplicated");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not duplicate");
    }
  }

  const current = editing === "new" ? null : editing;

  return (
    <>
      <PageHeader
        eyebrow="Standard buy/sell rates"
        title="Rates & Tariff Sheet"
        actions={
          <button className="btn" onClick={() => setEditing("new")}>
            + Add rate
          </button>
        }
      />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{rows.length} rate{rows.length === 1 ? "" : "s"}</h2>
            <p>Pulled into the Quote Builder instead of typing from memory/Excel.</p>
          </div>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as QuoteMode | "All")}
            style={{ maxWidth: 220 }}
          >
            <option value="All">All modes</option>
            {QUOTE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No rates yet. Add your first one.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Mode</th>
                  <th>Lane</th>
                  <th>Carrier</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Unit</th>
                  <th>Buy</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <RowActions
                        onView={() => setEditing(r)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => onDelete(r)}
                        onDuplicate={() => onDuplicate(r)}
                      />
                    </td>
                    <td className="nowrap">{r.mode}</td>
                    <td className="nowrap">
                      {r.origin || "Any"} → {r.destination || "Any"}
                    </td>
                    <td>{r.carrier || "—"}</td>
                    <td className="nowrap">{r.category}</td>
                    <td>
                      {r.code ? `${r.code} - ` : ""}
                      {r.description}
                    </td>
                    <td>{r.unit || "—"}</td>
                    <td className="nowrap">
                      {r.cur} {r.buy.toFixed(2)}
                    </td>
                    <td>{r.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <Modal
          title={current ? "Edit rate" : "Add rate"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={onSubmit}>
            <div className="grid2">
              <div className="field">
                <label>Mode</label>
                <select name="mode" defaultValue={current?.mode ?? QUOTE_MODES[0]}>
                  {QUOTE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  name="category"
                  defaultValue={current?.category ?? CHARGE_CATEGORIES[0]}
                >
                  {CHARGE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Origin (LOCODE, blank = any)</label>
                <input name="origin" defaultValue={current?.origin ?? ""} />
              </div>
              <div className="field">
                <label>Destination (LOCODE, blank = any)</label>
                <input name="destination" defaultValue={current?.destination ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Carrier</label>
              <input name="carrier" defaultValue={current?.carrier ?? ""} />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Code</label>
                <input name="code" defaultValue={current?.code ?? ""} />
              </div>
              <div className="field">
                <label>Unit</label>
                <input name="unit" defaultValue={current?.unit ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input
                name="description"
                defaultValue={current?.description ?? ""}
                autoFocus
              />
            </div>
            <div className="grid3">
              <div className="field">
                <label>Currency</label>
                <select name="cur" defaultValue={current?.cur ?? "USD"}>
                  {LINE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Buy</label>
                <input
                  name="buy"
                  type="number"
                  step="0.01"
                  defaultValue={current?.buy ?? 0}
                />
              </div>
              <div className="field">
                <label>Margin %</label>
                <input
                  name="margin"
                  type="number"
                  step="0.01"
                  defaultValue={current?.margin ?? 0}
                />
              </div>
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea name="notes" rows={2} defaultValue={current?.notes ?? ""} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                className="btn outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
