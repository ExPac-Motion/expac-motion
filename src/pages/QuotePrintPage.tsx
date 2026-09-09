/* ============================================================================
 * LOCKED LAYOUT — the customer quotation is signed off (ExPac, 2026-09-09) and
 * must render identically for every quote. Do NOT change this file, <QuoteSheet>,
 * or the `.qs-*` rules in src/index.css — layout, spacing, pagination, fonts,
 * colours — without an explicit, specific instruction from the user describing
 * the exact change. Preview any sanctioned change at /quotes/demo/print (DEV)
 * against a short and a long quote before committing.
 * ==========================================================================*/
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useClients, useCompanySettings, useQuote } from "../lib/hooks";
import {
  fxOf,
  groupByCategory,
  isVatOnlyLine,
  lineNet,
  lineTotalIncl,
  lineVat,
  lineVatPct,
  packingRow,
  packingTotals,
  resolveLines,
  volumetricFactor,
  type CategoryGroup,
  type PackingTotals,
} from "../lib/calc";
import { formatDate, money, portCode, usd } from "../lib/format";
import { COMPANY } from "../lib/company";
import type { PackingItem } from "../lib/types";

function n2(v: number | string | null | undefined): string {
  return (Number(v) || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const PK_CAPTION = "Dimensions in cm · weights in KGS · volume in CBM";

// A4 printable area with the @page 8mm top/bottom margins removed, in CSS px
// (1mm = 96/25.4 px). The header + footer repeat on every page; whatever is
// left is the budget for flowing rows.
const PX_PER_MM = 96 / 25.4;
const PAGE_BODY_PX = (297 - 16) * PX_PER_MM;

export interface CompanyBlock {
  logoPrint: string;
  headerName: string;
  headerLine1: string;
  headerEmail: string;
  headerLine2: string;
  strapline: string;
  blurb: string;
  bank: string[];
}

export interface QuoteSheetData {
  company: CompanyBlock;
  customerName: string;
  clientRows: [string, string][];
  shipment: [string, string][];
  reference: string;
  mode: string;
  createdAt: string | null;
  validUntil: string | null;
  origin: string | null;
  destination: string | null;
  packingRows: PackingItem[];
  vFactor: number;
  pack: PackingTotals;
  groups: CategoryGroup[];
}

type Section = {
  kind: "packing" | "charges";
  barLabel: string;
  tableClass: string;
  colgroup: ReactElement;
  head: ReactElement;
  rows: { key: string; node: (mk?: string) => ReactElement }[];
  tail: ReactElement | null;
  tailFoot: ReactElement | null;
};

type Block =
  | { t: "start"; s: Section }
  | { t: "row"; s: Section; i: number }
  | { t: "tail"; s: Section };

/* ------------------------------------------------------------------ */
/* The paginated sheet — pure presentation, no data fetching.          */
/* ------------------------------------------------------------------ */
export function QuoteSheet({ data }: { data: QuoteSheetData }) {
  const {
    company,
    customerName,
    clientRows,
    shipment,
    reference,
    mode,
    createdAt,
    validUntil,
    origin,
    destination,
    packingRows,
    vFactor,
    pack,
    groups,
  } = data;

  let exclusive = 0;
  let vatTotal = 0;
  groups.forEach((g) =>
    g.lines.forEach((x) => {
      exclusive += lineNet(x.line);
      vatTotal += lineVat(x.line);
    }),
  );
  const discountTotal = 0;
  const subTotal = exclusive + vatTotal;
  const grand = subTotal - discountTotal;

  const Header = ({ page, total }: { page: number; total: number }) => (
    <div className="qs-pagehead">
      <div className="qs-companyhead">
        <img
          className="logo"
          src={company.logoPrint}
          alt="ExPac"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <div className="qs-companyhead-text">
          <div className="name">QUOTATION - {company.headerName}</div>
          <div className="lines">{company.headerLine1}</div>
          <div className="lines">
            {company.headerEmail}&nbsp; &middot; &nbsp;{company.headerLine2}
          </div>
        </div>
      </div>

      <div className="qs-head">
        <div className="qs-client">
          <div className="qs-fromto">TO</div>
          <div className="qs-cbar">{customerName}</div>
          <div className="qs-pgrid">
            {clientRows.map(([k, v]) => (
              <Fragment key={k}>
                <b>{k}:</b>
                <span>{v}</span>
              </Fragment>
            ))}
          </div>
        </div>
        <div className="qs-routecol">
          <div className="qs-routebox">
            <div>
              <div className="qs-routelbl">FROM</div>
              <div className="qs-port">{portCode(origin)}</div>
            </div>
            <svg className="arrow" viewBox="0 0 40 28" aria-hidden="true">
              <path fill="currentColor" d="M0 9h22V0l18 14-18 14v-9H0z" />
            </svg>
            <div>
              <div className="qs-routelbl">TO</div>
              <div className="qs-port">{portCode(destination)}</div>
            </div>
          </div>
          <div className="qs-meta">
            <b>Document Number:</b>
            <span>{reference}</span>
            <b>Shipping Mode:</b>
            <span>{mode}</span>
            <b>Date:</b>
            <span>{formatDate(createdAt)}</span>
            <b>Due (or) Validity Date:</b>
            <span>{formatDate(validUntil)}</span>
            <b>Page:</b>
            <span>
              {page} of {total}
            </span>
          </div>
        </div>
      </div>

      <div className="qs-bar">Shipment Information</div>
      <div className="qs-info">
        {shipment.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const Footer = () => (
    <div className="qs-foot">
      <div className="bank">
        <h4>Banking Details</h4>
        {company.bank.map((b) => (
          <div key={b}>{b}</div>
        ))}
      </div>
      <div>
        <h4>{company.strapline}</h4>
        <p style={{ margin: 0, fontSize: "10.5px", whiteSpace: "pre-line" }}>
          {company.blurb}
        </p>
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
  );

  const pkColgroup = (
    <colgroup>
      {Array.from({ length: 9 }).map((_, i) => (
        <col key={i} style={{ width: "10.33%" }} />
      ))}
      <col style={{ width: "7%" }} />
    </colgroup>
  );
  const chColgroup = (
    <colgroup>
      <col style={{ width: "36%" }} />
      <col style={{ width: "9%" }} />
      <col style={{ width: "9%" }} />
      <col style={{ width: "12%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "13%" }} />
    </colgroup>
  );

  const sections: Section[] = [];

  if (packingRows.length > 0) {
    sections.push({
      kind: "packing",
      barLabel: "Packing List Information",
      tableClass: "qs-pk",
      colgroup: pkColgroup,
      head: (
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
      ),
      rows: packingRows.map((p, i) => {
        const r = packingRow(p, vFactor);
        return {
          key: String(p.id ?? i),
          node: (mk?: string) => (
            <tr data-mk={mk}>
              <td>{n2(p.length_cm)}</td>
              <td>{n2(p.width_cm)}</td>
              <td>{n2(p.height_cm)}</td>
              <td>{n2(p.actual_kg)}</td>
              <td>{n2(p.qty_ctns)}</td>
              <td>{n2(r.cbm)}</td>
              <td>{n2(r.volumeKg)}</td>
              <td>{n2(r.totalCbm)}</td>
              <td>{n2(r.totalActual)}</td>
              <td>{n2(r.totalVolume)}</td>
            </tr>
          ),
        };
      }),
      tailFoot: (
        <tr>
          <td colSpan={4}>Totals</td>
          <td>{n2(pack.qty)}</td>
          <td />
          <td />
          <td>{n2(pack.totalCbm)}</td>
          <td>{n2(pack.totalActual)}</td>
          <td>{n2(pack.totalVolume)}</td>
        </tr>
      ),
      tail: (
        <div className="qs-pksum">
          <div>
            <span className="k">Total Act (KGS)</span> <b>{n2(pack.totalActual)}</b>
          </div>
          <div>
            <span className="k">Volume (KGS)</span> <b>{n2(pack.totalVolume)}</b>
          </div>
          <div>
            <span className="k">Chg Vol (CBM)</span>{" "}
            <b className="hl">{n2(pack.totalCbm)}</b>
          </div>
          <div>
            <span className="k">Chg Weight (KGS)</span>{" "}
            <b className="hl">{n2(pack.chargeable)}</b>
          </div>
        </div>
      ),
    });
  }

  if (groups.length > 0) {
    const chRows: Section["rows"] = [];
    groups.forEach((g) => {
      let gEx = 0;
      let gIncl = 0;
      g.lines.forEach(({ line: l }) => {
        gEx += lineNet(l);
        gIncl += lineTotalIncl(l);
      });
      chRows.push({
        key: `grp:${g.category}`,
        node: (mk?: string) => (
          <tr className="group" data-mk={mk}>
            <td colSpan={7}>{g.category}</td>
          </tr>
        ),
      });
      g.lines.forEach(({ line: l }, i) => {
        const ex = lineNet(l);
        const incl = lineTotalIncl(l);
        chRows.push({
          key: `ln:${g.category}:${i}`,
          node: (mk?: string) => (
            <tr data-mk={mk}>
              <td>
                {l.code ? `${l.code} - ` : ""}
                {l.description || "—"}
              </td>
              <td>{l.unit || "—"}</td>
              <td className="n">{n2(l.qty)}</td>
              <td className="n">{money(isVatOnlyLine(l) ? 0 : l.sell)}</td>
              <td className="n">{n2(lineVatPct(l))}%</td>
              <td className="n">{money(ex)}</td>
              <td className="n">{money(incl)}</td>
            </tr>
          ),
        });
      });
      chRows.push({
        key: `sub:${g.category}`,
        node: (mk?: string) => (
          <tr className="sub" data-mk={mk}>
            <td className="n" colSpan={5}>
              Subtotal
            </td>
            <td className="n">{money(gEx)}</td>
            <td className="n">{money(gIncl)}</td>
          </tr>
        ),
      });
    });
    sections.push({
      kind: "charges",
      barLabel: "Charges",
      tableClass: "qs-charges",
      colgroup: chColgroup,
      head: (
        <tr>
          <th>Service Description</th>
          <th>Unit</th>
          <th className="n">Qty</th>
          <th className="n">Excl. Price</th>
          <th className="n">VAT %</th>
          <th className="n">Excl. Total</th>
          <th className="n">Incl. Total</th>
        </tr>
      ),
      rows: chRows,
      tail: null,
      tailFoot: null,
    });
  }

  // ---- measure, then distribute the sections' rows across pages ---------
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Block[][]>([]);
  const sig =
    reference +
    "|" +
    company.headerName +
    "|" +
    packingRows.length +
    "|" +
    groups.map((g) => g.lines.length).join(",");
  const [vw, setVw] = useState(
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  // bumped when something that affects measured heights settles late (the logo
  // image finishing load, or the browser about to print)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeprint", bump);
    const imgs = Array.from(measureRef.current?.querySelectorAll("img") ?? []);
    imgs.forEach((img) => img.addEventListener("load", bump));
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeprint", bump);
      imgs.forEach((img) => img.removeEventListener("load", bump));
    };
  }, []);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const h = (sel: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect().height : 0;
    };
    const headH = h('[data-mk="head"]');
    const footH = h('[data-mk="foot"]');
    // leave a safety gutter (the 44px gap above the footer + slack so print
    // rounding / per-OS font metrics never spill a near-blank extra page)
    const budget = Math.max(160, PAGE_BODY_PX - headH - footH - 74);

    const out: Block[][] = [[]];
    let used = 0;
    const push = (b: Block, height: number) => {
      out[out.length - 1].push(b);
      used += height;
    };
    const newPage = () => {
      out.push([]);
      used = 0;
    };

    sections.forEach((s) => {
      const startH = h(`[data-mk="${s.kind}:start"]`);
      const tailH = s.tail ? h(`[data-mk="${s.kind}:tail"]`) : 0;
      if (used > 0 && used + startH + 1 > budget) newPage();
      push({ t: "start", s }, startH);

      s.rows.forEach((r, i) => {
        const rowH = h(`[data-mk="${s.kind}:row:${i}"]`) || 16;
        const isLast = i === s.rows.length - 1;
        // keep a category header with at least its first line; keep the last
        // row with the section's totals block
        const nextH =
          r.key.startsWith("grp:") && i + 1 < s.rows.length
            ? h(`[data-mk="${s.kind}:row:${i + 1}"]`) || 16
            : 0;
        const need = rowH + nextH + (isLast ? tailH : 0);
        if (used + need > budget) {
          newPage();
          push({ t: "start", s }, startH);
        }
        push({ t: "row", s, i }, rowH);
      });

      if (s.tail) push({ t: "tail", s }, tailH);
    });

    setPages(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [`${sig}|${vw}|${tick}`]);

  const total = Math.max(1, pages.length);

  const renderPageBody = (blocks: Block[], pageIdx: number) => {
    const out: ReactElement[] = [];
    let i = 0;
    let seg = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.t !== "start") {
        i++;
        continue;
      }
      const s = b.s;
      i++;
      const rowNodes: ReactElement[] = [];
      let hasTail = false;
      while (i < blocks.length && blocks[i].t !== "start") {
        const nb = blocks[i];
        if (nb.t === "row")
          rowNodes.push(
            <Fragment key={s.rows[nb.i].key}>{s.rows[nb.i].node()}</Fragment>,
          );
        if (nb.t === "tail") hasTail = true;
        i++;
      }
      out.push(
        <div key={`${pageIdx}:${seg++}`} className="qs-section">
          <div className="qs-bar">{s.barLabel}</div>
          {s.kind === "packing" && (
            <div className="qs-pkcaption">{PK_CAPTION}</div>
          )}
          <table className={s.tableClass}>
            {s.colgroup}
            <thead>{s.head}</thead>
            <tbody>{rowNodes}</tbody>
            {hasTail && s.tailFoot && <tfoot>{s.tailFoot}</tfoot>}
          </table>
          {hasTail && s.tail}
        </div>,
      );
    }
    return out;
  };

  return (
    <>
      <div className="qs-pageset">
        {(pages.length ? pages : [[]]).map((blocks, pi) => (
          <div className="qs-page" key={pi}>
            <Header page={pi + 1} total={total} />
            <div className="qs-page-body">{renderPageBody(blocks, pi)}</div>
            <Footer />
          </div>
        ))}
      </div>

      {/* off-screen measuring copy — every row in real tables */}
      <div className="qs-measure qs-page" ref={measureRef} aria-hidden="true">
        <div data-mk="head">
          <Header page={1} total={9} />
        </div>
        <div data-mk="foot">
          <Footer />
        </div>
        {sections.map((s) => (
          <div key={s.kind}>
            <div data-mk={`${s.kind}:start`} className="qs-section">
              <div className="qs-bar">{s.barLabel}</div>
              {s.kind === "packing" && (
                <div className="qs-pkcaption">{PK_CAPTION}</div>
              )}
              <table className={s.tableClass}>
                {s.colgroup}
                <thead>{s.head}</thead>
              </table>
            </div>
            <table className={s.tableClass}>
              {s.colgroup}
              <tbody>
                {s.rows.map((r, i) => (
                  <Fragment key={r.key}>{r.node(`${s.kind}:row:${i}`)}</Fragment>
                ))}
              </tbody>
            </table>
            {s.tail && (
              <div data-mk={`${s.kind}:tail`} className="qs-section">
                {s.tailFoot && (
                  <table className={s.tableClass}>
                    {s.colgroup}
                    <tfoot>{s.tailFoot}</tfoot>
                  </table>
                )}
                {s.tail}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Route component — fetches the quote and feeds <QuoteSheet>.         */
/* ------------------------------------------------------------------ */
export default function QuotePrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: q, isLoading, isError, error } = useQuote(id);
  const { data: clients } = useClients();
  const { data: settings } = useCompanySettings();

  useEffect(() => {
    const previous = document.title;
    if (q?.reference) document.title = q.reference;
    return () => {
      document.title = previous;
    };
  }, [q?.reference]);

  const fx = useMemo(() => (q ? fxOf(q) : { usd: 0, cny: 0 }), [q]);
  const vFactor = volumetricFactor(q?.mode);
  const pack = useMemo(
    () => packingTotals(q?.packing_list_items ?? [], vFactor),
    [q?.packing_list_items, vFactor],
  );
  const groups = useMemo(() => {
    if (!q) return [];
    const resolved = resolveLines(q.quote_lines, {
      mode: q.mode,
      fx,
      pack,
      commercialValue: q.commercial_value ?? "",
    });
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
  const party = clientRec ?? q.lead ?? null;
  const company: CompanyBlock = settings
    ? {
        logoPrint: COMPANY.logoPrint,
        headerName: settings.legal_name,
        headerLine1: `Reg No: ${settings.reg_no}  ·  Vat No: ${settings.vat_no}  ·  Tel: ${settings.tel}`,
        headerEmail: `Email: ${settings.email}`,
        headerLine2: settings.postal_address,
        strapline: settings.strapline,
        blurb: settings.blurb,
        bank: settings.bank_details.split("\n").filter(Boolean),
      }
    : COMPANY;

  const data: QuoteSheetData = {
    company,
    customerName: q.client?.company ?? q.lead?.company ?? "CUSTOMER",
    clientRows: [
      ["Contact Person", party?.contact || "—"],
      ["Customer VAT No", party?.vat_no || "TBC"],
      ["Tel Number", party?.phone || "—"],
      ["Email Address", party?.email || "—"],
      ["Address", party?.address || "To Be Confirmed"],
    ],
    shipment: [
      ["Customer / Importer", q.client?.company ?? q.lead?.company ?? "—"],
      ["Shipper / Exporter", q.supplier?.company ?? "—"],
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
    ],
    reference: q.reference,
    mode: q.mode,
    createdAt: q.created_at,
    validUntil: q.valid_until,
    origin: q.origin,
    destination: q.destination,
    packingRows: q.packing_list_items ?? [],
    vFactor,
    pack,
    groups,
  };

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
        Customer quotation. Sell prices are in ZAR — internal buy cost, margin and
        FX are not shown. VAT is charged per line at the rate set on the quotation.
      </div>
      <QuoteSheet data={data} />
    </div>
  );
}
