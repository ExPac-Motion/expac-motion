import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { COMPANY } from "../lib/company";
import { formatDate } from "../lib/format";
import { rfqFactRows, rfqUnitOptions } from "../lib/rfq";
import { packingRow, packingTotals, volumetricFactor } from "../lib/calc";
import { LINE_CURRENCIES, type PackingItem } from "../lib/types";
import { cleanAmount, getRfqPublic, submitRfqPublic, type RfqPublic } from "../lib/rfqDb";

interface Row {
  category: string;
  code: string;
  description: string;
  unit: string;
  cur: string;
  rate: string;
  min_charge: string;
  remarks: string;
  extra?: boolean;
}

const n2 = (v: number) => v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EXTRA = "Other charges";

/**
 * Public, no-login reply form for an agent asked for rates (/rfq/reply/:token,
 * migration 0241). Shows the shipment as on the RFQ document (no customer,
 * consignee or shipper) and takes a rate, currency, minimum and remark per
 * requested charge, plus any extra charges, validity and transit time.
 * Can be corrected and sent again until ExPac closes the request.
 */
export default function RfqReplyPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<RfqPublic | null | "missing">(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [validity, setValidity] = useState("");
  const [transit, setTransit] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<"received" | "declined" | null>(null);

  useEffect(() => {
    let live = true;
    (import.meta.env.DEV && token === "demo" ? import("./RfqDemoPage").then((m) => m.RFQ_PUBLIC_DEMO()) : getRfqPublic(token))
      .then((d) => {
        if (!live) return;
        if (!d) return setData("missing");
        setData(d);
        const prior = new Map(d.rates.map((r) => [r.code ? `${r.category}|${r.code}` : "", r]));
        const asked: Row[] = d.charges.map((c) => {
          const p = prior.get(`${c.category}|${c.code}`);
          return {
            category: c.category,
            code: c.code,
            description: c.description,
            unit: c.unit,
            cur: p?.cur || c.cur || "USD",
            rate: p?.rate != null ? String(p.rate) : "",
            min_charge: p?.min_charge != null ? String(p.min_charge) : "",
            remarks: p?.remarks ?? "",
          };
        });
        const askedKeys = new Set(d.charges.map((c) => `${c.category}|${c.code}`));
        const extras: Row[] = d.rates
          .filter((r) => !askedKeys.has(`${r.category}|${r.code}`))
          .map((r) => ({
            category: r.category || EXTRA,
            code: r.code,
            description: r.description,
            unit: r.unit,
            cur: r.cur,
            rate: r.rate != null ? String(r.rate) : "",
            min_charge: r.min_charge != null ? String(r.min_charge) : "",
            remarks: r.remarks ?? "",
            extra: true,
          }));
        setRows([...asked, ...extras]);
        setValidity(d.validity ?? "");
        setTransit(d.transit_time ?? "");
        setRemarks(d.remarks ?? "");
      })
      .catch(() => live && setData("missing"));
    return () => {
      live = false;
    };
  }, [token]);

  /** A blank extra charge, placed at the end of its section. */
  const addRow = (category: string) =>
    setRows((rs) => {
      const blank: Row = { category, code: "", description: "", unit: "", cur: "USD", rate: "", min_charge: "", remarks: "", extra: true };
      let at = -1;
      rs.forEach((r, j) => r.category === category && (at = j));
      return at < 0 ? [...rs, blank] : [...rs.slice(0, at + 1), blank, ...rs.slice(at + 1)];
    });

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(decline: boolean) {
    setErr("");
    if (decline && !window.confirm("Tell ExPac you can't quote this shipment?")) return;
    const rates = rows
      .map((r) => ({
        category: r.category,
        code: r.code,
        description: r.description.trim(),
        unit: r.unit,
        cur: r.cur,
        rate: cleanAmount(r.rate),
        min_charge: cleanAmount(r.min_charge),
        remarks: r.remarks.trim(),
      }))
      .filter((r) => r.rate || r.min_charge || r.remarks);
    if (!decline && rates.length === 0) return setErr("Please enter at least one rate.");
    if (!decline && rates.some((r) => !r.description)) return setErr("Please describe each extra charge you added.");
    setBusy(true);
    try {
      const res =
        import.meta.env.DEV && token === "demo"
          ? decline
            ? "declined"
            : "received"
          : await submitRfqPublic({ token, rates, validity, transit, remarks, decline });
      setDone(res === "declined" ? "declined" : "received");
      window.scrollTo(0, 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send, please try again.");
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="rfq-reply-brand">
      <img src={COMPANY.logoPrint} alt="ExPac" />
    </div>
  );

  if (data === null) {
    return (
      <div className="wf-page">
        <div className="wf-card">Loading…</div>
      </div>
    );
  }
  if (data === "missing") {
    return (
      <div className="wf-page">
        <div className="wf-card">
          {brand}
          <h1>Request not found</h1>
          <p className="sub">This link is not valid any more. Please contact ExPac for a new one.</p>
        </div>
      </div>
    );
  }
  const closed = data.status === "used" || data.status === "not_used";
  if (done || closed) {
    return (
      <div className="wf-page">
        <div className="wf-card wf-thanks">
          {brand}
          <h1>{closed ? "This request is closed" : done === "declined" ? "Thank you for letting us know" : "Thank you, rates received"}</h1>
          <p className="sub">
            {closed
              ? `ExPac has closed ${data.rfq_number}. Thank you for your time.`
              : `ExPac has your reply to ${data.rfq_number}. You can open this link again to correct it until the request is closed.`}
          </p>
          {done && !closed && (
            <button className="btn outline" onClick={() => setDone(null)}>
              Edit my reply
            </button>
          )}
        </div>
      </div>
    );
  }

  const packing = data.packing as unknown as PackingItem[];
  const pack = packingTotals(packing, volumetricFactor(data.mode));
  const vFactor = volumetricFactor(data.mode);
  // Same rows, same order as the RFQ PDF (src/lib/rfq.ts rfqFactRows).
  const facts = rfqFactRows({
    reference: data.reference ?? data.rfq_number.replace(/^RFQ-/, ""),
    rfqDate: data.rfq_date ?? null,
    replyBy: data.reply_by,
    mode: data.mode,
    origin: data.origin,
    destination: data.destination,
    incoterms: data.incoterms,
    deliveryTerms: data.delivery_terms ?? null,
    commodity: data.commodity,
    readyDate: data.ready_date,
    etd: data.etd,
    containerType: data.container_type,
    pickup: data.pickup,
    kind: data.partner_kind ?? "agent",
  });
  const sections = [...new Set(rows.map((r) => r.category))];

  return (
    <div className="wf-page">
      <div className="wf-card rfq-reply">
        {brand}
        <h1>Request for Quote {data.rfq_number}</h1>
        <p className="sub">
          {data.company ? `For ${data.company}. ` : ""}
          Please reply by <b>{formatDate(data.reply_by)}</b>.{" "}
          {data.status === "received" && "You have already replied, changes you send now replace your earlier reply."}
        </p>

        <div className="rfq-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <span className="k">{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        {data.notes && (
          <p className="rfq-notes">
            <b>Notes from ExPac:</b> {data.notes}
          </p>
        )}

        <div className="rfq-sec-head">Packing List Information</div>
        {packing.length > 0 ? (
          <>
            <div className="rfq-scroll">
              <table className="qs-pk rfq-pk">
                <thead>
                  <tr>
                    <th>L<br />(cm)</th>
                    <th>W<br />(cm)</th>
                    <th>H<br />(cm)</th>
                    <th>Act<br />(Kg)</th>
                    <th>Qty<br />(Pcs)</th>
                    <th>Qty<br />(Ctns)</th>
                    <th>CBM<br />(Ctn)</th>
                    <th>Volume<br />(Kg)</th>
                    <th>Ttl<br />(Cbm)</th>
                    <th>Ttl Act<br />(Kg)</th>
                    <th>Ttl Vol<br />(Kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {packing.map((p, i) => {
                    const r = packingRow(p, vFactor);
                    return (
                      <tr key={i}>
                        <td>{n2(Number(p.length_cm))}</td>
                        <td>{n2(Number(p.width_cm))}</td>
                        <td>{n2(Number(p.height_cm))}</td>
                        <td>{n2(Number(p.actual_kg))}</td>
                        <td>{n2(Number(p.qty_pcs))}</td>
                        <td>{n2(Number(p.qty_ctns))}</td>
                        <td>{n2(r.cbm)}</td>
                        <td>{n2(r.volumeKg)}</td>
                        <td>{n2(r.totalCbm)}</td>
                        <td>{n2(r.totalActual)}</td>
                        <td>{n2(r.totalVolume)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Totals</td>
                    <td>{n2(pack.pcs)}</td>
                    <td>{n2(pack.qty)}</td>
                    <td />
                    <td />
                    <td>{n2(pack.totalCbm)}</td>
                    <td>{n2(pack.totalActual)}</td>
                    <td>{n2(pack.totalVolume)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="rfq-pksum">
              <span>
                Total Act (KGS) <b>{n2(pack.totalActual)}</b>
              </span>
              <span>
                Volume (KGS) <b>{n2(pack.totalVolume)}</b>
              </span>
              <span>
                Chg Vol (CBM) <b>{n2(pack.totalCbm)}</b>
              </span>
              <span>
                Chg Weight (KGS) <b>{n2(pack.chargeable)}</b>
              </span>
            </div>
          </>
        ) : (
          <p className="hint">Packing list to follow.</p>
        )}

        <h2>Your rates</h2>
        <p className="hint">
          Rates excl. VAT. Pick the unit you charge per. Remove any charge that doesn't apply, or add one that's missing.
        </p>
        {sections.map((s) => (
          <div key={s} className="rfq-sec">
            <div className="rfq-sec-head">{s}</div>
            <div className="rfq-rate-head">
              <span>Charge</span>
              <span>Cur</span>
              <span>Rate</span>
              <span>Unit</span>
              <span>Min</span>
              <span>Remarks</span>
              <span />
            </div>
            {rows.map((r, i) =>
              r.category !== s ? null : (
                <div key={i} className="rfq-rate">
                  <span className="rfq-charge">
                    {r.extra ? (
                      <input
                        value={r.description}
                        onChange={(e) => set(i, { description: e.target.value })}
                        placeholder="Describe the charge"
                        aria-label="Charge description"
                      />
                    ) : (
                      <>
                        <b>{r.description}</b>
                        <span className="muted">{r.code}</span>
                      </>
                    )}
                  </span>
                  <select value={r.cur} onChange={(e) => set(i, { cur: e.target.value })} aria-label="Currency">
                    {LINE_CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <input inputMode="decimal" value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} aria-label="Rate" placeholder="Rate" />
                  <select value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} aria-label="Unit" title="Charged per">
                    {rfqUnitOptions(r.unit).map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    value={r.min_charge}
                    onChange={(e) => set(i, { min_charge: e.target.value })}
                    aria-label="Minimum charge"
                    placeholder="Min"
                  />
                  <input value={r.remarks} onChange={(e) => set(i, { remarks: e.target.value })} aria-label="Remarks" placeholder="Remarks" />
                  <button
                    type="button"
                    className="link-btn rfq-remove"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    title="Remove this charge"
                  >
                    Remove
                  </button>
                </div>
              ),
            )}
            <button type="button" className="btn outline rfq-sec-add" onClick={() => addRow(s)}>
              + Add a charge
            </button>
          </div>
        ))}
        {sections.length === 0 && (
          <button type="button" className="btn outline" onClick={() => addRow(EXTRA)}>
            + Add a charge
          </button>
        )}

        <div className="rfq-reply-grid">
          <div className="field">
            <label>Rate validity</label>
            <input value={validity} onChange={(e) => setValidity(e.target.value)} placeholder="e.g. valid until 30/11/2026" />
          </div>
          <div className="field">
            <label>Transit time / routing</label>
            <input value={transit} onChange={(e) => setTransit(e.target.value)} placeholder="e.g. 28 days via Singapore" />
          </div>
        </div>
        <div className="field">
          <label>Remarks</label>
          <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {err && <div className="wf-err">{err}</div>}
        <div className="rfq-reply-actions">
          <button type="button" className="btn outline" onClick={() => submit(true)} disabled={busy}>
            We can't quote
          </button>
          <button type="button" className="btn" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Sending…" : "Send rates to ExPac"}
          </button>
        </div>
        <p className="hint">Rates are treated as confidential between ExPac and your company.</p>
      </div>
    </div>
  );
}
