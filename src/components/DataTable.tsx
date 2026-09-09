import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useSaveTablePrefs, useTablePrefs } from "../lib/hooks";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Default column width in px. */
  width?: number;
  minWidth?: number;
  cellClass?: string;
  /** Fixed columns (e.g. the row-actions cell) never move or resize and
   *  always render first. */
  fixed?: boolean;
}

interface Props<T> {
  /** Stable id used to store this table's per-user column layout. */
  tableKey: string;
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  /** Extra classes on the <table> (e.g. "table--compact"). */
  className?: string;
}

const DEFAULT_WIDTH = 150;

export default function DataTable<T>({
  tableKey,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClass,
  className,
}: Props<T>) {
  const prefsQ = useTablePrefs(tableKey);
  const savePrefs = useSaveTablePrefs(tableKey);

  const fixed = useMemo(() => columns.filter((c) => c.fixed), [columns]);
  const movableKeys = useMemo(
    () => columns.filter((c) => !c.fixed).map((c) => c.key),
    [columns],
  );
  const movableSig = movableKeys.join("|");
  const byKey = useMemo(
    () => new Map(columns.map((c) => [c.key, c])),
    [columns],
  );

  const [order, setOrder] = useState<string[]>(movableKeys);
  const [widths, setWidths] = useState<Record<string, number>>({});

  // keep the latest values reachable from window event handlers
  const orderRef = useRef(order);
  const widthsRef = useRef(widths);
  orderRef.current = order;
  widthsRef.current = widths;

  // hydrate from the saved layout (and re-merge when the column set changes)
  useEffect(() => {
    const saved = prefsQ.data;
    const savedOrder = (saved?.order ?? []).filter((k) =>
      movableKeys.includes(k),
    );
    setOrder([
      ...savedOrder,
      ...movableKeys.filter((k) => !savedOrder.includes(k)),
    ]);
    setWidths(saved?.widths ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsQ.data, movableSig]);

  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  function saveGrid() {
    savePrefs.mutate({ order: orderRef.current, widths: widthsRef.current });
    setDirty(false);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1500);
  }

  const orderedCols = useMemo(() => {
    const movable = order
      .map((k) => byKey.get(k))
      .filter((c): c is DataColumn<T> => !!c);
    return [...fixed, ...movable];
  }, [order, byKey, fixed]);

  const widthOf = (c: DataColumn<T>) =>
    widths[c.key] ?? c.width ?? DEFAULT_WIDTH;

  // The table is exactly as wide as the sum of its columns, so resizing one
  // column grows the table (and the wrapper scrolls) instead of the browser
  // redistributing width across every other column.
  const totalWidth = orderedCols.reduce((s, c) => s + widthOf(c), 0);

  /* ---- resize ---- */
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(
    null,
  );
  function onResizeMove(e: PointerEvent) {
    const r = resizeRef.current;
    if (!r) return;
    const min = byKey.get(r.key)?.minWidth ?? 60;
    const w = Math.max(min, Math.round(r.startW + (e.clientX - r.startX)));
    setWidths((prev) => ({ ...prev, [r.key]: w }));
  }
  function endResize() {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    if (resizeRef.current) {
      resizeRef.current = null;
      setDirty(true);
    }
  }
  function startResize(e: ReactPointerEvent, c: DataColumn<T>) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { key: c.key, startX: e.clientX, startW: widthOf(c) };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
  }

  /* ---- reorder ---- */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  function drop(targetKey: string) {
    const dk = dragKey;
    setDragKey(null);
    setOverKey(null);
    if (!dk || dk === targetKey) return;
    const next = order.filter((k) => k !== dk);
    next.splice(next.indexOf(targetKey), 0, dk);
    setOrder(next);
    setDirty(true);
  }

  function resetLayout() {
    setOrder(movableKeys);
    setWidths({});
    savePrefs.mutate({ order: movableKeys, widths: {} });
    setDirty(false);
  }

  return (
    <div className="dt-wrap">
      <div className="dt-tools">
        <button
          type="button"
          className={`btn btn-sm${dirty ? "" : " outline"}`}
          onClick={saveGrid}
          title="Save this column order and widths to your account"
        >
          {justSaved ? "Saved ✓" : "Save Grid"}
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={resetLayout}
          title="Restore the default column order and widths"
        >
          Reset columns
        </button>
      </div>
      <div className="table-wrap">
        <table
          className={`dt${className ? " " + className : ""}`}
          style={{ width: totalWidth }}
        >
          <colgroup>
            {orderedCols.map((c) => (
              <col key={c.key} style={{ width: widthOf(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c.key}
                  className={[
                    c.fixed ? "dt-fixed" : "dt-th",
                    dragKey === c.key ? "dt-drag" : "",
                    overKey === c.key ? "dt-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={!c.fixed}
                  onDragStart={(e) => {
                    if (c.fixed || resizeRef.current) {
                      e.preventDefault();
                      return;
                    }
                    // Firefox won't start a drag unless dataTransfer is set.
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c.key);
                    setDragKey(c.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragEnter={
                    c.fixed ? undefined : (e) => e.preventDefault()
                  }
                  onDragOver={
                    c.fixed
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (overKey !== c.key) setOverKey(c.key);
                        }
                  }
                  onDrop={
                    c.fixed
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          drop(c.key);
                        }
                  }
                >
                  <span className="dt-th-label">{c.header}</span>
                  {!c.fixed && (
                    <span
                      className="dt-rz"
                      onPointerDown={(e) => startResize(e, c)}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rc = [
                onRowClick ? "clickable" : "",
                rowClass?.(row) ?? "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <tr
                  key={rowKey(row)}
                  className={rc || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {orderedCols.map((c) => (
                    <td
                      key={c.key}
                      className={
                        [c.fixed ? "dt-cell-fixed" : "", c.cellClass ?? ""]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
