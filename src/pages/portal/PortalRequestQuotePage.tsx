import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/common";
import DateInput from "../../components/DateInput";
import { useToast } from "../../components/Toast";
import { LOCODE_OPTIONS } from "../../lib/locodes";
import { packingTotals, volumetricFactor } from "../../lib/calc";
import { INCOTERMS_ANY_MODE, INCOTERMS_SEA, type QuoteMode } from "../../lib/types";
import { useRequestQuote, type QuoteRequest, type QuoteRequestPacking } from "../../lib/portal";
import { PortalIcon } from "./PortalLayout";

const MODES: { mode: QuoteMode; label: string; sub: string; icon: string }[] = [
  { mode: "Air Freight (AIR)", label: "Air Freight", sub: "Airport to airport or door", icon: "plane" },
  { mode: "Sea Freight (LCL)", label: "Sea Freight LCL", sub: "Less than a container", icon: "ship" },
  { mode: "Sea Freight (FCL)", label: "Sea Freight FCL", sub: "Full container", icon: "ship" },
  { mode: "Courier Express (CX)", label: "Courier Express", sub: "Small, urgent parcels", icon: "items" },
  { mode: "Road Freight (RDX)", label: "Road Freight", sub: "Cross-border & local", icon: "shipments" },
];

const blankRow = (): QuoteRequestPacking => ({ qty_ctns: "1", length_cm: "", width_cm: "", height_cm: "", actual_kg: "" });

/**
 * Customer Portal › Request a Quote: the basics of a shipment. Submitting
 * creates a quotation request that lands in ExPac's Quotations as a New Lead,
 * ExPac completes it, adds the charges and sends it back here to accept.
 */
export default function PortalRequestQuotePage() {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const request = useRequestQuote();
  const [r, setR] = useState<QuoteRequest>({
    mode: "Air Freight (AIR)",
    origin: "",
    destination: "",
    commodity: "",
    incoterms: "",
    customer_reference: "",
    commercial_value: "",
    value_currency: "USD",
    ready_date: "",
    pickup: "",
    delivery: "",
    notes: "",
    packing: [blankRow()],
  });
  const set = <K extends keyof QuoteRequest>(k: K, v: QuoteRequest[K]) => setR((p) => ({ ...p, [k]: v }));
  const setRow = (i: number, patch: Partial<QuoteRequestPacking>) =>
    set(
      "packing",
      r.packing.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );
  const sea = r.mode.startsWith("Sea");
  const fcl = r.mode === "Sea Freight (FCL)";
  const pack = packingTotals(
    r.packing.map((p, i) => ({ position: i, ...p })),
    volumetricFactor(r.mode),
  );
  const incoterms = sea ? [...INCOTERMS_ANY_MODE, ...INCOTERMS_SEA] : INCOTERMS_ANY_MODE;
  const needsPickup = ["EXW", "FCA"].includes(r.incoterms);
  const needsDelivery = ["DAP", "DPU", "DDP"].includes(r.incoterms) || !r.incoterms;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!r.origin.trim() || !r.destination.trim()) return error("Where is it coming from and going to?");
    if (!r.commodity.trim()) return error("What are you shipping? (commodity)");
    if (!fcl && pack.qty <= 0) return error("Add at least one cargo line (quantity and weight)");
    request.mutate(r, {
      onSuccess: (id) => {
        toast("Quote requested, the ExPac team is on it");
        navigate(`/portal/quotes/${id}`);
      },
      onError: (er) => error(er.message),
    });
  }

  return (
    <>
      <PageHeader eyebrow="Quotations" title="Request a Quote" />
      <form onSubmit={submit} className="pt-rq">
        <div className="panel">
          <h3 className="pt-h3" style={{ marginTop: 0 }}>
            1. How should it move?
          </h3>
          <div className="pt-modes">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className={`pt-mode${r.mode === m.mode ? " on" : ""}`}
                onClick={() => set("mode", m.mode)}
              >
                <PortalIcon name={m.icon} />
                <b>{m.label}</b>
                <span>{m.sub}</span>
              </button>
            ))}
          </div>

          <h3 className="pt-h3">2. Route &amp; terms</h3>
          <datalist id="pt-locodes">
            {LOCODE_OPTIONS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <div className="grid4">
            <div className="field">
              <label>From (origin)</label>
              <input list="pt-locodes" value={r.origin} onChange={(e) => set("origin", e.target.value)} placeholder="City, port or airport" />
            </div>
            <div className="field">
              <label>To (destination)</label>
              <input list="pt-locodes" value={r.destination} onChange={(e) => set("destination", e.target.value)} placeholder="ZAJNB, Johannesburg" />
            </div>
            <div className="field">
              <label>Incoterms</label>
              <select value={r.incoterms} onChange={(e) => set("incoterms", e.target.value)}>
                <option value="">Not sure</option>
                {incoterms.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code}, {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cargo ready date</label>
              <DateInput value={r.ready_date} onChange={(v) => set("ready_date", v)} />
            </div>
          </div>
          <div className="grid4">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Commodity (what are you shipping?)</label>
              <input value={r.commodity} onChange={(e) => set("commodity", e.target.value)} placeholder="e.g. LED lighting fittings" />
            </div>
            <div className="field">
              <label>Your reference / PO</label>
              <input value={r.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} />
            </div>
            <div className="field">
              <label>Goods value (for insurance / duties)</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={r.value_currency} onChange={(e) => set("value_currency", e.target.value)} style={{ width: 84 }}>
                  {["USD", "ZAR", "EUR", "GBP", "CNY"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <input type="number" step="any" value={r.commercial_value} onChange={(e) => set("commercial_value", e.target.value)} />
              </div>
            </div>
          </div>

          <h3 className="pt-h3">3. Cargo {fcl && <span className="hint">(optional for full containers, add container sizes in the notes)</span>}</h3>
          <table className="table--compact wms-pkg">
            <thead>
              <tr>
                <th>Qty</th>
                <th>Length (cm)</th>
                <th>Width (cm)</th>
                <th>Height (cm)</th>
                <th>Weight each (kg)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.packing.map((p, i) => (
                <tr key={i}>
                  {(["qty_ctns", "length_cm", "width_cm", "height_cm", "actual_kg"] as const).map((k) => (
                    <td key={k}>
                      <input type="number" step="any" min={0} value={p[k]} onChange={(e) => setRow(i, { [k]: e.target.value })} />
                    </td>
                  ))}
                  <td>
                    {r.packing.length > 1 && (
                      <button type="button" className="row-icon-btn danger" title="Remove" onClick={() => set("packing", r.packing.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="wms-pkg-foot">
            <button type="button" className="btn outline btn-sm" onClick={() => set("packing", [...r.packing, blankRow()])}>
              + Add line
            </button>
            <span className="pt-pack-sum">
              {pack.qty} pcs · {pack.totalActual.toFixed(1)} kg · {pack.totalCbm.toFixed(3)} CBM · chargeable{" "}
              <b>{sea ? `${Math.max(pack.totalCbm, pack.totalActual / 1000).toFixed(2)} W/M` : `${pack.chargeable.toFixed(1)} kg`}</b>
            </span>
          </div>

          <h3 className="pt-h3">4. Collection, delivery &amp; notes</h3>
          <div className="grid3">
            <div className="field">
              <label>Collect from {needsPickup ? "" : "(if we collect)"}</label>
              <textarea rows={3} value={r.pickup} onChange={(e) => set("pickup", e.target.value)} placeholder="Supplier name and address" />
            </div>
            <div className="field">
              <label>Deliver to {needsDelivery ? "" : "(if we deliver)"}</label>
              <textarea rows={3} value={r.delivery} onChange={(e) => set("delivery", e.target.value)} placeholder="Delivery address" />
            </div>
            <div className="field">
              <label>Anything else?</label>
              <textarea
                rows={3}
                value={r.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder={fcl ? "e.g. 2 × 40HC, hazardous, clearance needed" : "e.g. hazardous, stackable, clearance needed"}
              />
            </div>
          </div>
        </div>
        <div className="pt-rq-foot">
          <span className="hint">The ExPac team prices your request and sends the quotation back here for you to accept.</span>
          <button type="button" className="btn outline" onClick={() => navigate("/portal/quotes")}>
            Cancel
          </button>
          <button className="btn" disabled={request.isPending}>
            {request.isPending ? "Sending…" : "Request a Quote"}
          </button>
        </div>
      </form>
    </>
  );
}
