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

  // Grand total (VAT is 0 until the per-line VAT field is added).
  let exclusive = 0;
  groups.forEach((g) =>
    g.lines.forEach((x) => {
      exclusive += lineTotal(x.line);
    }),
  );
  const discountTotal = 0;
  const vatTotal = 0;
  const subTotal = exclusive + vatTotal;
  const grand = subTotal - discountTotal;

  // Quote-stage fields only. Booking details (ETD/ETA, MAWB/HAWB/flight,
  // vessel/MBL/HBL/container, carrier, status) don't exist yet on a quotation.
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
  ];

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
        {/* company header */}
        <div className="qs-companyhead">
          <div className="name">{COMPANY.headerName}</div>
          <div className="lines">{COMPANY.headerLine1}</div>
          <div className="lines">{COMPANY.headerLine2}</div>
        </div>

        {/* QUOTATION + meta on the left, logo on the right */}
        <div className="qs-head">
          <div className="qs-metacol">
            <h1>QUOTATION</h1>
            <div className="qs-meta">
              <b>Document Number</b>
              <span>{q.reference}</span>
              <b>Date</b>
              <span>{formatDate(q.created_at)}</span>
              <b>Due (or) Validity Date</b>
              <span>{formatDate(q.valid_until)}</span>
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
                const wm =
                  e.currentTarget.nextElementSibling as HTMLElement | null;
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

        {/* client (TO) on the left, port codes on the right */}
        <div className="qs-head">
          <div className="qs-client">
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
        </div>

        {/* shipment information */}
        <div className="qs-bar qs-bar--tight">Shipment Information</div>
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
            <div className="qs-pkcaption">
              Dimensions in cm · weights in KGS · volume in CBM
            </div>
            <table className="qs-pk">
              <colgroup>
                {Array.from({ length: 9 }).map((_, i) => (
                  <col key={i} style={{ width: "10.33%" }} />
                ))}
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>L (cm)</th>
                  <th>W (cm)</th>
                  <th>H (cm)</th>
                  <th>Actual</th>
                  <th>Qty</th>
                  <th>CBM</th>
                  <th>Volume</th>
                  <th>Tot CBM</th>
                  <th>Tot Act</th>
                  <th>Tot Vol</th>
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
          <colgroup>
            <col style={{ width: "36%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
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
                      Subtotal
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
              <b>Total Discount:</b>
              <span>{money(discountTotal)}</span>
            </div>
            <div className="row">
              <b>Total Exclusive:</b>
              <span>{money(exclusive)}</span>
            </div>
            <div className="row">
              <b>Total VAT:</b>
              <span>{money(vatTotal)}</span>
            </div>
            <div className="row">
              <b>Sub Total:</b>
              <span>{money(subTotal)}</span>
            </div>
            <div className="row grand">
              <span>Grand Total:</span>
              <span>{money(grand)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
