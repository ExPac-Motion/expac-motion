import { useMemo, useState } from "react";
import { ErrorNote, Loading, PageHeader } from "../components/common";
import { useToast } from "../components/Toast";
import {
  useAddCustomsLineToQuote,
  useImportVatDuty,
  useQuotes,
  useSaveImportVatDuty,
} from "../lib/hooks";
import {
  DEFAULT_VAT_RATE_PCT,
  DEFAULT_VAT_UPLIFT_PCT,
  IMPORT_CURRENCIES,
  importDutyRow,
  importDutyTotals,
  newImportDutyLine,
} from "../lib/importDuty";
import { money } from "../lib/format";
import type {
  ImportDutyDraft,
  ImportDutyLine,
  ImportVatDuty,
} from "../lib/types";

function n2(v: number | string | null | undefined): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function blankDraft(quoteId: string): ImportDutyDraft {
  return {
    id: null,
    quote_id: quoteId,
    po_no: "",
    vat_uplift_pct: DEFAULT_VAT_UPLIFT_PCT,
    vat_rate_pct: DEFAULT_VAT_RATE_PCT,
    lines: [newImportDutyLine(0)],
  };
}

function draftFromRow(row: ImportVatDuty): ImportDutyDraft {
  return {
    id: row.id,
    quote_id: row.quote_id,
    po_no: row.po_no ?? "",
    vat_uplift_pct: row.vat_uplift_pct ?? DEFAULT_VAT_UPLIFT_PCT,
    vat_rate_pct: row.vat_rate_pct ?? DEFAULT_VAT_RATE_PCT,
    lines: (row.import_vat_duty_lines ?? []).map((l, i) => ({
      id: l.id,
      position: i,
      description: l.description ?? "",
      qty_pcs: l.qty_pcs ?? 0,
      unit_price: l.unit_price ?? 0,
      cur: l.cur ?? "USD",
      roe: l.roe ?? 0,
      duty_rate_pct: l.duty_rate_pct ?? 0,
    })),
  };
}

export default function ImportVatDutyPage() {
  const { toast, error } = useToast();
  const quotesQ = useQuotes();
  const save = useSaveImportVatDuty();
  const pushLine = useAddCustomsLineToQuote();

  const [quoteId, setQuoteId] = useState("");
  const [draft, setDraft] = useState<ImportDutyDraft | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const ivdQ = useImportVatDuty(quoteId || undefined);

  // Build the draft once the worksheet (or its absence) has loaded for a quote.
  if (quoteId && !ivdQ.isLoading && loadedFor !== quoteId) {
    setLoadedFor(quoteId);
    setDraft(ivdQ.data ? draftFromRow(ivdQ.data) : blankDraft(quoteId));
    setDirty(false);
  }
  if (!quoteId && draft) {
    setDraft(null);
    setLoadedFor(null);
  }

  const totals = useMemo(
    () =>
      draft
        ? importDutyTotals(draft)
        : { foreignAmount: 0, localAmount: 0, ttlDuty: 0, ttlImportVat: 0 },
    [draft],
  );

  const quotes = quotesQ.data ?? [];
  const selectedQuote = quotes.find((q) => q.id === quoteId);

  function edit(mut: (d: ImportDutyDraft) => ImportDutyDraft) {
    setDraft((d) => (d ? mut(d) : d));
    setDirty(true);
  }
  function setField<K extends keyof ImportDutyDraft>(
    key: K,
    value: ImportDutyDraft[K],
  ) {
    edit((d) => ({ ...d, [key]: value }));
  }
  function setLine(index: number, field: keyof ImportDutyLine, value: string) {
    edit((d) => ({
      ...d,
      lines: d.lines.map((l, i) =>
        i === index ? ({ ...l, [field]: value } as ImportDutyLine) : l,
      ),
    }));
  }
  function addLine() {
    edit((d) => ({
      ...d,
      lines: [...d.lines, newImportDutyLine(d.lines.length)],
    }));
  }
  function removeLine(index: number) {
    edit((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
  }

  async function onSave(): Promise<boolean> {
    if (!draft) return false;
    try {
      const id = await save.mutateAsync(draft);
      setDraft({ ...draft, id });
      setDirty(false);
      toast("Import VAT / Duty saved");
      return true;
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
      return false;
    }
  }

  async function push(code: "CU-02" | "CU-03", amount: number, label: string) {
    if (!draft) return;
    if (dirty || !draft.id) {
      const ok = await onSave();
      if (!ok) return;
    }
    try {
      await pushLine.mutateAsync({ quoteId: draft.quote_id, code, amount });
      toast(`${label} pushed to ${selectedQuote?.reference ?? "the quote"}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update the quote");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Customs costing"
        title="Import VAT / Duty Output"
        actions={
          <button
            className="btn"
            onClick={onSave}
            disabled={!draft || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        }
      />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Commercial Invoice</h2>
            <p>
              Pick the quotation this shipment belongs to, then capture the
              supplier's commercial invoice. VAT and duty are worked out per line
              on the SARS added-tax-value basis.
            </p>
          </div>
        </div>
        <div className="grid4">
          <div className="field">
            <label>Job Number (quotation)</label>
            <select
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
            >
              <option value="">Select a quotation</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.reference}
                  {q.client?.company ? ` — ${q.client.company}` : ""}
                </option>
              ))}
            </select>
            {quotes.length === 0 && (
              <span className="hint">No quotations yet.</span>
            )}
          </div>
          <div className="field">
            <label>PO# Number</label>
            <input
              value={draft?.po_no ?? ""}
              onChange={(e) => setField("po_no", e.target.value)}
              disabled={!draft}
            />
          </div>
          <div className="field">
            <label>VAT uplift (%)</label>
            <input
              type="number"
              step="any"
              value={draft ? String(draft.vat_uplift_pct) : ""}
              onChange={(e) => setField("vat_uplift_pct", e.target.value)}
              disabled={!draft}
              title="Statutory uplift on the customs value (SARS: 10%)"
            />
          </div>
          <div className="field">
            <label>Import VAT rate (%)</label>
            <input
              type="number"
              step="any"
              value={draft ? String(draft.vat_rate_pct) : ""}
              onChange={(e) => setField("vat_rate_pct", e.target.value)}
              disabled={!draft}
              title="SARS: 15%"
            />
          </div>
        </div>
      </div>

      {quoteId && ivdQ.isLoading ? (
        <div className="panel">
          <Loading label="Loading worksheet…" />
        </div>
      ) : quoteId && ivdQ.isError ? (
        <div className="panel">
          <ErrorNote error={ivdQ.error} />
        </div>
      ) : !draft ? (
        <div className="panel">
          <div className="empty">Select a quotation to start.</div>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Invoice lines</h2>
                <p>
                  Foreign amount = Qty × Unit price. Local amount = Foreign ×
                  ROE. Customs value = Local + {n2(draft.vat_uplift_pct)}%. Duty =
                  Customs value × Duty rate. Taxable value = Customs value + Duty.
                  Import VAT = Taxable value × {n2(draft.vat_rate_pct)}%.
                </p>
              </div>
              <button className="btn small outline" onClick={addLine}>
                + Add line
              </button>
            </div>

            <div className="table-wrap">
              <table className="charge-table">
                <thead>
                  <tr>
                    <th>Product Description</th>
                    <th className="num">Qty pcs</th>
                    <th className="num">Unit price</th>
                    <th className="c-cur">Cur</th>
                    <th className="num">ROE</th>
                    <th className="num">Foreign amount</th>
                    <th className="num">Local amount</th>
                    <th className="num">Customs markup</th>
                    <th className="num">Customs value</th>
                    <th className="num">Duty rate (%)</th>
                    <th className="num">Ttl duty</th>
                    <th className="num">Taxable value</th>
                    <th className="num">Ttl import VAT</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l, i) => {
                    const row = importDutyRow(
                      l,
                      draft.vat_uplift_pct,
                      draft.vat_rate_pct,
                    );
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            value={String(l.description ?? "")}
                            onChange={(e) =>
                              setLine(i, "description", e.target.value)
                            }
                            placeholder="Product description"
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="any"
                            value={String(l.qty_pcs ?? "")}
                            onChange={(e) =>
                              setLine(i, "qty_pcs", e.target.value)
                            }
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="any"
                            value={String(l.unit_price ?? "")}
                            onChange={(e) =>
                              setLine(i, "unit_price", e.target.value)
                            }
                          />
                        </td>
                        <td className="c-cur">
                          <select
                            value={l.cur}
                            onChange={(e) => setLine(i, "cur", e.target.value)}
                          >
                            {IMPORT_CURRENCIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                            {l.cur && !IMPORT_CURRENCIES.includes(l.cur) && (
                              <option value={l.cur}>{l.cur}</option>
                            )}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="any"
                            value={String(l.roe ?? "")}
                            onChange={(e) => setLine(i, "roe", e.target.value)}
                          />
                        </td>
                        <td className="num">
                          {l.cur} {n2(row.foreignAmount)}
                        </td>
                        <td className="num">{money(row.localAmount)}</td>
                        <td className="num">{money(row.customsMarkup)}</td>
                        <td className="num">{money(row.customsValue)}</td>
                        <td className="num">
                          <input
                            type="number"
                            step="any"
                            value={String(l.duty_rate_pct ?? "")}
                            onChange={(e) =>
                              setLine(i, "duty_rate_pct", e.target.value)
                            }
                          />
                        </td>
                        <td className="num">{money(row.ttlDuty)}</td>
                        <td className="num">{money(row.taxableValue)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {money(row.ttlImportVat)}
                        </td>
                        <td>
                          <button
                            className="btn ghost small"
                            onClick={() => removeLine(i)}
                            aria-label="Remove line"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>
                      Totals
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {n2(totals.foreignAmount)}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(totals.localAmount)}
                    </td>
                    <td className="num" colSpan={3} />
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(totals.ttlDuty)}
                    </td>
                    <td className="num" />
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(totals.ttlImportVat)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="totals">
              <div className="t">
                <div className="label">Total Import VAT</div>
                <div className="val" style={{ color: "var(--green-dark)" }}>
                  {money(totals.ttlImportVat)}
                </div>
              </div>
              <div className="t">
                <div className="label">Total Duty</div>
                <div className="val" style={{ color: "var(--green-dark)" }}>
                  {money(totals.ttlDuty)}
                </div>
              </div>
            </div>
            <div
              className="row-actions"
              style={{ marginTop: 14, flexWrap: "wrap" }}
            >
              <button
                className="btn"
                onClick={() =>
                  push("CU-02", totals.ttlImportVat, "Customs VAT")
                }
                disabled={
                  !draft || save.isPending || pushLine.isPending ||
                  totals.ttlImportVat <= 0
                }
              >
                Add VAT to Quote Builder
              </button>
              <button
                className="btn"
                onClick={() => push("CU-03", totals.ttlDuty, "Customs Duty")}
                disabled={
                  !draft || save.isPending || pushLine.isPending ||
                  totals.ttlDuty <= 0
                }
              >
                Add Duty to Quote Builder
              </button>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Pushing writes (or overwrites) the <strong>CU-02 Customs VAT</strong>{" "}
              and <strong>CU-03 Customs Duty</strong> charge lines on{" "}
              {selectedQuote?.reference ?? "the quotation"} as ZAR lines. The
              worksheet is saved first so it can be reopened here and amended.
            </p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Design Remarks</h2>
            </div>
            <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                Job Number is taken from the quotation builder. Once VAT / duties
                are calculated they are pushed to that specific quote.
              </li>
              <li>
                After pushing, the worksheet is saved under the Job Number here
                for later editing or amendment.
              </li>
            </ul>
          </div>
        </>
      )}
    </>
  );
}
