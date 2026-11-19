// Motion AI: check what was read from a commercial invoice / packing list,
// then create the lead (or use a matching customer / lead) and a New Lead
// quote in one click.

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import PortCodeInput, { PortCodeList } from "./PortCodeInput";
import {
  createLeadAndQuote,
  findPartyMatches,
  formFromExtraction,
  notesFor,
  QUOTE_MODES,
  type DocParty,
  type DocQuoteExtraction,
  type DocQuoteForm,
  type PartyMatch,
} from "../lib/docQuote";
import { newPackingItem } from "../lib/tierQuote";
import { packingTotals, volumetricFactor } from "../lib/calc";
import { LINE_CURRENCIES, type PackingItem, type QuoteMode } from "../lib/types";

const PARTY_FIELDS: { key: keyof DocParty; label: string }[] = [
  { key: "company", label: "Company name" },
  { key: "contact", label: "Contact person" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "vat_no", label: "VAT number" },
  { key: "import_code", label: "Import / export code" },
];

export default function DocQuoteReview({
  extraction,
  onClose,
  onCreated,
}: {
  extraction: DocQuoteExtraction;
  onClose: () => void;
  onCreated: (r: { quote_id: string; reference: string; customer: string; newLead: boolean }) => void;
}) {
  const [f, setF] = useState<DocQuoteForm>(() => formFromExtraction(extraction));
  const [matches, setMatches] = useState<PartyMatch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DocQuoteForm>(k: K, v: DocQuoteForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setParty = (k: keyof DocParty, v: string) => setF((x) => ({ ...x, customer: { ...x.customer, [k]: v } }));

  // Look for this company among existing customers and leads (debounced).
  const company = f.customer.company ?? "";
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      findPartyMatches(company)
        .then((m) => {
          if (!live) return;
          setMatches(m);
          // An exact name match is picked for them; anything else stays "new lead".
          const key = (p: PartyMatch) => `${p.kind}:${p.id}` as DocQuoteForm["useExisting"];
          const exact = m.find((p) => p.company.trim().toLowerCase() === company.trim().toLowerCase());
          setF((x) => {
            const keep = m.some((p) => key(p) === x.useExisting) ? x.useExisting : "";
            return { ...x, useExisting: exact ? key(exact) : keep };
          });
        })
        .catch(() => live && setMatches([]));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [company]);

  function switchSide(side: "buyer" | "seller") {
    setF((x) => ({ ...x, customerSide: side, customer: { ...extraction[side] }, useExisting: "", notes: notesFor(extraction, side) }));
  }

  function setPack(i: number, k: keyof PackingItem, v: string) {
    setF((x) => ({ ...x, packing: x.packing.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));
  }

  const totals = useMemo(() => packingTotals(f.packing, volumetricFactor(f.mode)), [f.packing, f.mode]);

  async function create() {
    setError(null);
    setSaving(true);
    try {
      const r = await createLeadAndQuote(f);
      const m = matches.find((x) => `${x.kind}:${x.id}` === f.useExisting);
      onCreated({ quote_id: r.quote_id, reference: r.reference, customer: m?.company ?? f.customer.company ?? "", newLead: !f.useExisting });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const x = extraction;
  const docLabel = x.document_types.length ? x.document_types.join(" + ") : "Document";

  return (
    <Modal
      title="New lead and quote from document"
      onClose={onClose}
      wide
      footer={
        <div className="modal-foot-row">
          {error && <span className="warn">{error}</span>}
          <button className="btn outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn" onClick={create} disabled={saving || (!f.useExisting && !company.trim())}>
            {saving ? "Creating…" : f.useExisting ? "Create quote" : "Create lead + quote"}
          </button>
        </div>
      }
    >
      <div className="dq">
        <p className="muted dq-src">
          {docLabel} read by Motion AI from {x.sources.join(", ")}. Check the details: nothing is saved until you click Create.
        </p>
        {x.warnings.length > 0 && (
          <div className="dq-warn">
            <b>Check these:</b>
            <ul>
              {x.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <h4 className="dq-h">Customer</h4>
        <div className="dq-side">
          <label>
            <input type="radio" checked={f.customerSide === "buyer"} onChange={() => switchSide("buyer")} disabled={!x.buyer.company} /> Buyer / importer
            {x.buyer.company ? `: ${x.buyer.company}` : " (not on the document)"}
          </label>
          <label>
            <input type="radio" checked={f.customerSide === "seller"} onChange={() => switchSide("seller")} disabled={!x.seller.company} /> Seller / exporter
            {x.seller.company ? `: ${x.seller.company}` : " (not on the document)"}
          </label>
        </div>

        {matches.length > 0 && (
          <div className="field">
            <label>Already in Motion?</label>
            <select value={f.useExisting} onChange={(e) => set("useExisting", e.target.value as DocQuoteForm["useExisting"])}>
              <option value="">No, create a new lead</option>
              {matches.map((m) => (
                <option key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>
                  Use {m.kind === "client" ? "customer" : "lead"}: {m.company}
                  {m.email ? ` (${m.email})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {!f.useExisting && (
          <>
            <div className="grid3">
              {PARTY_FIELDS.map((p) => (
                <div className="field" key={p.key}>
                  <label>{p.label}</label>
                  <input value={f.customer[p.key] ?? ""} onChange={(e) => setParty(p.key, e.target.value)} />
                </div>
              ))}
            </div>
            <div className="field">
              <label>Address</label>
              <input value={f.customer.address ?? ""} onChange={(e) => setParty("address", e.target.value)} />
            </div>
          </>
        )}

        <h4 className="dq-h">Quote</h4>
        <PortCodeList />
        <div className="grid3">
          <div className="field">
            <label>Mode</label>
            <select value={f.mode} onChange={(e) => set("mode", e.target.value as QuoteMode)}>
              {QUOTE_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            {x.mode_hint === "unknown" && <span className="hint">Not on the document, a guess from the size and weight.</span>}
          </div>
          <div className="field">
            <label>Origin</label>
            <PortCodeInput value={f.origin} onChange={(v) => set("origin", v)} mode={f.mode} hint={x.origin ? `Document: ${x.origin}` : undefined} />
          </div>
          <div className="field">
            <label>Destination</label>
            <PortCodeInput
              value={f.destination}
              onChange={(v) => set("destination", v)}
              mode={f.mode}
              hint={x.destination ? `Document: ${x.destination}` : undefined}
            />
          </div>
          <div className="field">
            <label>Incoterm</label>
            <input value={f.incoterms} onChange={(e) => set("incoterms", e.target.value)} />
          </div>
          <div className="field">
            <label>Commodity</label>
            <input value={f.commodity} onChange={(e) => set("commodity", e.target.value)} />
          </div>
          <div className="field">
            <label>Customer reference</label>
            <input value={f.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} />
          </div>
          <div className="field">
            <label>Commercial value</label>
            <input inputMode="decimal" value={f.commercial_value} onChange={(e) => set("commercial_value", e.target.value)} />
          </div>
          <div className="field">
            <label>Value currency</label>
            <select value={f.value_currency} onChange={(e) => set("value_currency", e.target.value)}>
              {LINE_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {x.currency && !(LINE_CURRENCIES as string[]).includes(x.currency.toUpperCase()) && (
              <span className="hint">Invoice is in {x.currency}: convert before quoting.</span>
            )}
          </div>
        </div>

        <h4 className="dq-h">Packing</h4>
        <div className="dq-pack-wrap">
          <table className="dq-pack">
            <thead>
              <tr>
                <th>Qty</th>
                <th>L cm</th>
                <th>W cm</th>
                <th>H cm</th>
                <th>Kg each</th>
                <th>CBM each</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.packing.map((p, i) => (
                <tr key={i}>
                  {(["qty_ctns", "length_cm", "width_cm", "height_cm", "actual_kg", "cbm"] as const).map((k) => (
                    <td key={k}>
                      <input
                        inputMode="decimal"
                        value={p[k] == null ? "" : String(p[k])}
                        placeholder={k === "cbm" ? "auto" : ""}
                        onChange={(e) => setPack(i, k, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="link-btn"
                      title="Remove row"
                      onClick={() => set("packing", f.packing.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dq-pack-foot">
          <button className="link-btn" onClick={() => set("packing", [...f.packing, newPackingItem(f.packing.length)])}>
            + Add row
          </button>
          <span className="muted">
            {totals.qty} pkgs · {totals.totalActual.toFixed(1)} kg · {totals.totalCbm.toFixed(3)} m³ · chargeable {totals.chargeable.toFixed(1)} kg
            {x.gross_kg != null && Math.abs(x.gross_kg - totals.totalActual) > Math.max(1, x.gross_kg * 0.02)
              ? ` (document says ${x.gross_kg} kg gross)`
              : ""}
          </span>
        </div>

        {!f.useExisting && (
          <div className="field">
            <label>Notes on the lead</label>
            <textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        )}
        <p className="muted dq-src">
          The quote is saved as a New Lead quote with no charges yet: open it and use Load rates to price it.
        </p>
      </div>
    </Modal>
  );
}
