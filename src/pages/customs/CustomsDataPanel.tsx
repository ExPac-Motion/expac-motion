/**
 * Customs data read from the documents by Motion AI (0232): shown, checked
 * and corrected by ExPac, read-only for the clearing agent. Exports as CSV.
 */
import { useState } from "react";
import { EXTRACTION_FIELDS, downloadExtractionCsv, type CustomsExtraction, type CustomsLine } from "../../lib/customs";

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustomsDataPanel({
  reference,
  value,
  editable,
  onSave,
  saving,
}: {
  reference: string;
  value: CustomsExtraction;
  editable?: boolean;
  onSave?: (v: CustomsExtraction) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<CustomsExtraction | null>(null);
  const v = draft ?? value;
  const editing = !!draft;
  const lines = v.lines ?? [];
  const lineTotal = lines.reduce((s, l) => s + (l.value ?? 0), 0);
  const setField = (k: keyof CustomsExtraction, raw: string, numeric?: boolean) =>
    setDraft({ ...v, [k]: raw.trim() === "" ? null : numeric ? Number(raw.replace(/[ ,]/g, "")) || null : raw });
  const setLine = (i: number, k: keyof CustomsLine, raw: string, numeric?: boolean) =>
    setDraft({
      ...v,
      lines: lines.map((l, j) =>
        j === i ? { ...l, [k]: raw.trim() === "" ? null : numeric ? Number(raw.replace(/[ ,]/g, "")) || null : raw } : l,
      ),
    });

  return (
    <div className="customs-data">
      {v.warnings?.length > 0 && (
        <ul className="customs-data-warn">
          {v.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <dl className="customs-data-facts">
        {EXTRACTION_FIELDS.map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>
              {editing ? (
                <input
                  value={(v[f.key] as string | number | null) ?? ""}
                  onChange={(e) => setField(f.key, e.target.value, f.num)}
                  inputMode={f.num ? "decimal" : undefined}
                />
              ) : f.num && ["invoice_total", "freight", "insurance"].includes(f.key) ? (
                money(v[f.key] as number | null)
              ) : (
                ((v[f.key] as string | number | null) ?? "—")
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt>Containers</dt>
          <dd>{(v.container_nos ?? []).join(", ") || "—"}</dd>
        </div>
      </dl>
      <div className="table-wrap">
        <table className="customs-lines">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>HS code</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Value</th>
              <th>Origin</th>
              <th>Net kg</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {(
                  [
                    ["description", false],
                    ["hs_code", false],
                    ["qty", true],
                    ["unit", false],
                    ["unit_price", true],
                    ["value", true],
                    ["origin", false],
                    ["net_kg", true],
                  ] as [keyof CustomsLine, boolean][]
                ).map(([k, numeric]) => (
                  <td key={k} className={k === "hs_code" ? "customs-hs" : undefined}>
                    {editing ? (
                      <input value={(l[k] as string | number | null) ?? ""} onChange={(e) => setLine(i, k, e.target.value, numeric)} />
                    ) : k === "unit_price" || k === "value" ? (
                      money(l[k] as number | null)
                    ) : (
                      ((l[k] as string | number | null) ?? "—")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {lines.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={6}>Lines total</td>
                <td>{money(lineTotal)}</td>
                <td colSpan={2} className={v.invoice_total != null && Math.abs(lineTotal - v.invoice_total) > 0.5 ? "customs-late" : undefined}>
                  {v.invoice_total != null && Math.abs(lineTotal - v.invoice_total) > 0.5 ? `Invoice says ${money(v.invoice_total)}` : ""}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="hint">
        HS codes not printed on the invoice are Motion AI's suggestions, for the clearing agent to confirm.
        {v.sources?.length ? ` Read from: ${v.sources.join(", ")}.` : ""}
      </p>
      <div className="customs-actions">
        <button type="button" className="btn ghost small" onClick={() => downloadExtractionCsv(reference, v)}>
          Download CSV
        </button>
        {editable && !editing && (
          <button type="button" className="btn ghost small" onClick={() => setDraft(structuredClone(value))}>
            Edit
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              className="btn small"
              disabled={saving}
              onClick={() => {
                onSave?.(v);
                setDraft(null);
              }}
            >
              Save changes
            </button>
            <button type="button" className="btn ghost small" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
