import { Fragment, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useClients, useQuote } from "../lib/hooks";
import {
  fxOf,
  groupByCategory,
  lineTotal,
  packingRow,
  packingTotals,
  resolveLine,
} from "../lib/calc";
import { formatDate, money, portCode, usd } from "../lib/format";
import { COMPANY } from "../lib/company";
import type { QuoteMode } from "../lib/types";

const AIR_MODES: QuoteMode[] = ["Air Freight (AIR)", "Courier Express (CX)"];
const SEA_MODES: QuoteMode[] = ["Sea Freight (FCL)", "Sea Freight (LCL)"];

function n2(v: number | string | null | undefined): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function QuotePrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: q, isLoading, isError, error } = useQuote(id);
  const { data: clients } = useClients();

  const fx = useMemo(() => (q ? fxOf(q) : { usd: 0, cny: 0 }), [q]);
  const pack = useMemo(
    () => packingTotals(q?.packing_list_items ?? []),
    [q?.packing_list_items],
  );
  const groups = useMemo(() => {
    if (!q) return [];
    const resolved = q.quote_lines.map((l) =>
      resolveLine(l, {
        mode: q.mode,
        fx,
        pack,
        commercialValue: q.commercial_value ?? "",
      }),
    );
    return groupByCategory(resolved).filter((g) => g.lines.length > 0);
  }, [q, fx, pack]);

  if (isLoading) return <div className="center-note">Loading quotation…</div>;
  if (isError || !q)
    return (
      <div className="center-note">
        {error instanceof Error ? error.message : "Quotation not found"}
      </div>
    );

  const clientRec = clients?.find((c) => c.id === q.client_id);
  const isAir = AIR_MODES.includes(q.mode);
  const isSea = SEA_MODES.includes(q.mode);

  // Grand total (VAT is 0 until the per-line VAT field is added).
  let exclusive = 0;
  groups.forEach((g) =>
    g.lines.forEach((x) => {
      exclusive += lineTotal(x.line);
    }),
  );
  const vatTotal = 0;
  const grand = exclusive + vatTotal;

  const shipment: [string, string][] = [
    ["Client / Importer", q.client?.company ?? "—"],
    ["Supplier / Exporter", q.supplier?.company ?? "—"],
    ["Reference", q.reference],
    ["Mode", q.mode],
    ["Commodity", q.commodity || "—"],
    ["Incoterms", q.incoterms || "—"],
    ["Delivery Terms", q.delivery_terms || "—"],
    ["Valid Until", formatDate(q.valid_until)],
    ["Origin / Port of Load", q.origin || "—"],
    ["Destination / Port of Discharge", q.destination || "—"],
    ["Commercial Value ($)", usd(q.commercial_value)],
    ["Insurance Amount ($)", usd(q.insurance_amount)],
    ["ETD", formatDate(q.etd)],
    ["ETA", formatDate(q.eta)],
  ];
  if (isSea) {
    shipment.push(
      ["Vessel Name", q.vessel_name || "—"],
      ["MBL No", q.mbl_no || "—"],
      ["HBL No", q.hbl_no || "—"],
      ["Container Number", q.container_no || "—"],
    );
  }
  if (isAir) {
    shipment.push(
      ["MAWB No", q.mawb_no || "—"],
      ["HAWB No", q.hawb_no || "—"],
      ["Flight No", q.flight_no || "—"],
      ["Flight Date", formatDate(q.flight_date)],
      ["Carrier / Airline Name", q.carrier_name || "—"],
    );
  }
  if (!isAir && !isSea) {
    shipment.push(["Carrier Name", q.carrier_name || "—"]);
  }
  shipment.push(["Status", q.status]);

  const clientRows: [string, string][] = [
    ["Contact Person", clientRec?.contact || "—"],
    ["Customer VAT No", "TBC"],
    ["Tel Number", clientRec?.phone || "—"],
    ["Email Address", clientRec?.email || "—"],
    ["Address", "To Be Confirmed"],
  ];

  const packingRows = q.packing_list_items ?? [];

  return (
    <div className="qs-wrap">
      <div className="qs-toolbar">
        <button className="btn outline" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className="qs-note">
        Client quotation. Sell prices are in ZAR — internal buy cost, margin and
        FX are not shown. VAT is 0 until the per-line VAT field is added.
      </div>

      <div className="qs-sheet">
        {/* top */}
        <div className="qs-top">
          <div className="qs-metacol">
            <h1>QUOTATION</h1>
            <div className="qs-meta">
              <b>Document Number</b>
              <span>{q.reference}</span>
              <b>Date</b>
              <span>{formatDate(q.created_at)}</span>
              <b>Due (or) Validity Date</b>
              <span>{formatDate(q.valid_until)}</span>
              <b>Status</b>
              <span>{q.status}</span>
              <b>Page</b>
              <span>1</span>
            </div>
          </div>
          <div className="qs-logo">
            <img
              src={COMPANY.logoPrint}
              alt="ExPac"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const wm = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (wm) wm.style.display = "block";
              }}
            />
            <span style={{ display: "none" }}>
              Ex<span className="dark">P</span>ac &raquo;
              <small>FORWARDING</small>
            </span>
          </div>
        </div>

        <hr className="rule" />

        {/* route */}
        <div className="qs-route">
          <div className="qs-routebox">
            <div>
              <div className="qs-routelbl">FROM</div>
              <div className="qs-port">{portCode(q.origin)}</div>
            </div>
            <div className="arrow">➜</div>
            <div>
              <div className="qs-routelbl">TO</div>
              <div className="qs-port">{portCode(q.destination)}</div>
            </div>
          </div>
          <div className="qs-terms">
            <b>Inco-Term &amp; Service:</b>
            <span>
              {(q.incoterms || "—")}
              {" // "}
              {q.delivery_terms || q.mode}
            </span>
            <b>Estimate Departure (ETD):</b>
            <span>{formatDate(q.etd)}</span>
            <b>Estimate Arrival (ETA):</b>
            <span>{formatDate(q.eta)}</span>
          </div>
        </div>

        <hr className="rule" />

        {/* parties */}
        <div className="qs-parties">
          <div>
            <div className="qs-fromto">FROM</div>
            <div className="qs-cbar">{COMPANY.legalName}</div>
            <div className="qs-pgrid">
              {COMPANY.from.map(([k, v]) => (
                <Fragment key={k}>
                  <b>{k}:</b>
                  <span>{v}</span>
                </Fragment>
              ))}
            </div>
          </div>
          <div>
            <div className="qs-fromto">TO</div>
            <div className="qs-cbar">{q.client?.company ?? "CLIENT"}</div>
            <div className="qs-pgrid">
              {clientRows.map(([k, v]) => (
                <Fragment key={k}>
                  <b>{k}:</b>
                  <span>{v}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* shipment information */}
        <div className="qs-bar">Shipment Information</div>
        <div className="qs-info">
          {shipment.map(([k, v]) => (
            <div key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>

        {/* packing list */}
        <div className="qs-bar">Packing List Information</div>
        {packingRows.length === 0 ? (
          <p className="muted" style={{ fontSize: 10 }}>
            No packing list captured.
          </p>
        ) : (
          <>
            <table className="qs-pk">
              <thead>
                <tr>
                  <th>L (cm)</th>
                  <th>W (cm)</th>
                  <th>H (cm)</th>
                  <th>Actual (KGS)</th>
                  <th>Qty (CTNS)</th>
                  <th>Cubic M (CBM)</th>
                  <th>Volume (KGS)</th>
                  <th>Total Cbm</th>
                  <th>Total Act (KGS)</th>
                  <th>Total Vol (KGS)</th>
                </tr>
              </thead>
              <tbody>
                {packingRows.map((p, i) => {
                  const r = packingRow(p);
                  return (
                    <tr key={p.id ?? i}>
                      <td>{Number(p.length_cm) || 0}</td>
                      <td>{Number(p.width_cm) || 0}</td>
                      <td>{Number(p.height_cm) || 0}</td>
                      <td>{n2(p.actual_kg)}</td>
                      <td>{Number(p.qty_ctns) || 0}</td>
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
                  <td>{pack.qty}</td>
                  <td />
                  <td />
                  <td>{n2(pack.totalCbm)}</td>
                  <td>{n2(pack.totalActual)}</td>
                  <td>{n2(pack.totalVolume)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="qs-pksum">
              <div>
                <span className="k">Total Actual Weight (KGS)</span>{" "}
                <b>{n2(pack.totalActual)}</b>
              </div>
              <div>
                <span className="k">Volume Weight (KGS)</span>{" "}
                <b>{n2(pack.totalVolume)}</b>
              </div>
              <div>
                <span className="k">Chargeable Volume (CBM)</span>{" "}
                <b className="hl">{n2(pack.totalCbm)}</b>
              </div>
              <div>
                <span className="k">Chargeable Weight (KGS)</span>{" "}
                <b className="hl">{n2(pack.chargeable)}</b>
              </div>
            </div>
          </>
        )}

        {/* charges */}
        <div className="qs-bar">Charges</div>
        <table className="qs-charges">
          <thead>
            <tr>
              <th>Service Description</th>
              <th>Unit</th>
              <th className="n">Qty</th>
              <th className="n">Excl. Price</th>
              <th className="n">VAT %</th>
              <th className="n">Excl. Total</th>
              <th className="n">Incl. Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              let gEx = 0;
              const rows = g.lines.map(({ line: l }, i) => {
                const ex = lineTotal(l);
                gEx += ex;
                return (
                  <tr key={i}>
                    <td>
                      {l.code ? `${l.code} - ` : ""}
                      {l.description || "—"}
                    </td>
                    <td>{l.unit || "—"}</td>
                    <td className="n">{n2(l.qty)}</td>
                    <td className="n">{money(l.sell)}</td>
                    <td className="n">0.00%</td>
                    <td className="n">{money(ex)}</td>
                    <td className="n">{money(ex)}</td>
                  </tr>
                );
              });
              return (
                <Fragment key={g.category}>
                  <tr className="group">
                    <td colSpan={7}>{g.category}</td>
                  </tr>
                  {rows}
                  <tr className="sub">
                    <td className="n" colSpan={5}>
                      {g.category} subtotal
                    </td>
                    <td className="n">{money(gEx)}</td>
                    <td className="n">{money(gEx)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* footer */}
        <div className="qs-foot">
          <div className="bank">
            <h4>Banking Details</h4>
            {COMPANY.bank.map((b) => (
              <div key={b}>{b}</div>
            ))}
          </div>
          <div>
            <h4>{COMPANY.strapline}</h4>
            <p style={{ margin: 0, fontSize: "9.5px" }}>{COMPANY.blurb}</p>
          </div>
          <div className="qs-totals">
            <div className="row">
              <b>Total Exclusive</b>
              <span>{money(exclusive)}</span>
            </div>
            <div className="row">
              <b>Total VAT</b>
              <span>{money(vatTotal)}</span>
            </div>
            <div className="row">
              <b>Sub Total</b>
              <span>{money(grand)}</span>
            </div>
            <div className="row grand">
              <span>Grand Total</span>
              <span>{money(grand)}</span>
            </div>
          </div>
        </div>

        <div className="qs-links">
          <div>
            <div className="qs-green">See our Terms &amp; Conditions</div>
            <div className="qs-green">See our Company Portfolio</div>
            <div className="qs-green">{COMPANY.tagline}</div>
          </div>
          <div>
            <div>
              <span className="qs-green">Payment Reference</span> &nbsp; Use
              Invoice Number
            </div>
            <div>
              <span className="qs-green">Live Tracking</span> &nbsp; Track with
              Document Number
            </div>
          </div>
          <div className="qs-balance">
            <div style={{ fontWeight: 800, letterSpacing: ".06em" }}>
              BALANCE DUE
            </div>
            <div className="amt">{money(grand)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
