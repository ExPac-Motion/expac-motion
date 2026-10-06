import { useCompanySettings } from "../../lib/hooks";
import { COMPANY } from "../../lib/company";
import { formatDate } from "../../lib/format";
import {
  CONSOL_MODE_LABEL,
  qty,
  share,
  stockByLocation,
  useWmsMoves,
  useWmsReceipts,
  type WmsConsol,
  type WmsConsolHouse,
} from "../../lib/wms";
import { consolTotals, houseLabel, houseNo, masterLabel } from "./WmsConsols";
import { Grid, LetterSheet, TERMS } from "./WmsPrintPage";
import { useWmsLookups } from "./shared";

function containerLines(c: WmsConsol, h: WmsConsolHouse): string {
  const list = (c.containers ?? []).filter((k) => !h.container_no || k.container_no === h.container_no);
  return list.map((k) => [k.container_no, k.type, k.seal_no ? `SEAL ${k.seal_no}` : null].filter(Boolean).join(" / ")).join("\n");
}

/** House Bill of Lading (LCL groupage / FCL consolidation), same box style as the air waybill. */
export function HblSheet({ consol: c, house: h, index }: { consol: WmsConsol; house: WmsConsolHouse; index: number }) {
  const { data: settings } = useCompanySettings();
  const issuer = settings
    ? [settings.legal_name, settings.postal_address, `Tel: ${settings.tel}`, settings.email].filter(Boolean).join("\n")
    : [COMPANY.headerName, COMPANY.headerLine2, COMPANY.headerEmail].join("\n");
  const pp = c.charges_code === "PP";
  return (
    <div className="awb-sheet" data-ready={settings ? "1" : undefined}>
      <div className="awb">
        <div className="awb-row">
          <div className="awb-half">
            <div className="awb-cell awb-party">
              <div className="lbl">Shipper / Exporter</div>
              <div className="val pre">{h.shipper || ""}</div>
            </div>
            <div className="awb-cell awb-party">
              <div className="lbl">Consignee</div>
              <div className="val pre">{h.consignee || ""}</div>
            </div>
            <div className="awb-cell awb-party">
              <div className="lbl">Notify Party</div>
              <div className="val pre">{h.accounting_info || ""}</div>
            </div>
          </div>
          <div className="awb-half">
            <div className="awb-row" style={{ borderTop: 0 }}>
              <div className="awb-cell grow">
                <div className="lbl">B/L No.</div>
                <div className="val big hl">{houseNo(c, h, index)}</div>
              </div>
              <div className="awb-cell grow">
                <div className="lbl">Shipment Reference</div>
                <div className="val big">{c.consol_no}</div>
              </div>
            </div>
            <div className="awb-cell">
              <div className="awb-strong" style={{ fontSize: "15pt", textAlign: "center", margin: "2mm 0" }}>
                BILL OF LADING
              </div>
              <div className="lbl center">
                {c.mode === "fcl" ? "FCL consolidation" : "LCL groupage"}, for combined transport or port to port shipment
              </div>
            </div>
            <div className="awb-cell" style={{ display: "flex", gap: "3mm", alignItems: "flex-start" }}>
              <img
                src={COMPANY.logoPrint}
                alt="ExPac"
                style={{ height: "14mm" }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <div className="val pre strong">{issuer}</div>
            </div>
            <div className="awb-cell grow" style={{ flex: "1 1 auto" }}>
              <div className="lbl">For release of cargo please apply to</div>
              <div className="val pre">{c.place_of_delivery ? `${c.place_of_delivery}\n` : ""}{settings?.legal_name ?? COMPANY.headerName}</div>
              <div className="lbl" style={{ marginTop: "2mm" }}>
                MBL No.
              </div>
              <div className="val">{c.master_no || "-"}</div>
            </div>
          </div>
        </div>

        <div className="awb-row">
          <Box label="Pre-carriage by" value="" />
          <Box label="Place of Receipt" value={c.place_of_receipt} />
          <Box label="Vessel" value={c.vessel} big />
          <Box label="Voyage No." value={c.voyage_no} big />
        </div>
        <div className="awb-row">
          <Box label="Port of Loading" value={c.port_of_loading} big />
          <Box label="Port of Discharge" value={c.port_of_discharge} big />
          <Box label="Place of Delivery" value={c.place_of_delivery} />
          <Box label="Freight Payable at" value={pp ? c.port_of_loading : c.port_of_discharge} />
        </div>

        <table className="awb-goods hbl-goods">
          <thead>
            <tr>
              <th>Container / Seal No., Marks &amp; Numbers</th>
              <th>No. &amp; Kind of Packages</th>
              <th>Description of Goods</th>
              <th>Gross Weight (KG)</th>
              <th>Measurement (CBM)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pre">
                {containerLines(c, h)}
                {h.marks ? `\n\n${h.marks}` : ""}
              </td>
              <td>
                {h.pieces} {h.package_type || "PACKAGES"}
              </td>
              <td className="pre">
                {c.mode === "fcl" ? "SHIPPER'S LOAD, STOW AND COUNT\nSAID TO CONTAIN:\n" : "SAID TO CONTAIN:\n"}
                {h.nature_of_goods || ""}
                {"\n\n"}
                {pp ? "FREIGHT PREPAID" : "FREIGHT COLLECT"}
              </td>
              <td>{Number(h.gross_kg).toFixed(2)}</td>
              <td>{Number(h.volume_cbm).toFixed(3)}</td>
            </tr>
          </tbody>
        </table>

        <div className="awb-row">
          <div className="awb-cell grow2">
            <div className="lbl">Remarks</div>
            <div className="val">{c.handling_info || ""}</div>
          </div>
          <Box label="Shipped on Board" value={c.etd ? formatDate(c.etd) : ""} />
          <Box label="No. of Original B/Ls" value="THREE (3)" />
        </div>
        <div className="awb-row">
          <div className="awb-cell grow2 lbl">
            Received by the carrier in apparent good order and condition unless otherwise noted, the total number of containers or
            packages stated above for carriage from the place of receipt or port of loading to the port of discharge or place of
            delivery. One original Bill of Lading, duly endorsed, must be surrendered in exchange for the goods or delivery order. In
            witness whereof the number of original Bills of Lading stated above have been signed, one of which being accomplished the
            others to stand void.
          </div>
          <div className="awb-cell grow">
            <div className="lbl">Place and Date of Issue</div>
            <div className="val">
              {[c.executed_place, c.executed_on ? formatDate(c.executed_on) : null].filter(Boolean).join(", ")}
            </div>
            <div className="awb-signed">{c.signed_by || settings?.legal_name || COMPANY.headerName}</div>
            <div className="lbl center">Signed as agent for the carrier</div>
          </div>
        </div>
        <div className="awb-terms">{TERMS}</div>
      </div>
    </div>
  );
}

function Box({ label, value, big }: { label: string; value: string | null | undefined; big?: boolean }) {
  return (
    <div className="awb-cell grow">
      <div className="lbl">{label}</div>
      <div className={`val${big ? " big" : ""}`}>{value || ""}</div>
    </div>
  );
}

/** Sea cargo manifest (landscape): master details, then one line per HBL. */
export function SeaManifestSheet({ consol: c }: { consol: WmsConsol }) {
  const t = consolTotals(c.houses);
  return (
    <div className="awb-sheet awb-landscape" data-ready="1">
      <div className="mf-title">EXPAC FORWARDING</div>
      <div className="mf-sub">
        <span>{CONSOL_MODE_LABEL[c.mode]}</span>
        <b>Cargo Manifest</b>
        <span />
      </div>
      <table className="mf">
        <colgroup>
          {["10%", "13%", "10%", "7%", "16%", "7%", "6%", "15%", "16%"].map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={2}>
              <div className="lbl">Vessel / Voyage</div>
              <div className="val">{[c.vessel, c.voyage_no].filter(Boolean).join(" / ") || "-"}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Port of Loading</div>
              <div className="val">{c.port_of_loading || "-"}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Port of Discharge</div>
              <div className="val">{c.port_of_discharge || "-"}</div>
            </td>
            <td colSpan={1}>
              <div className="lbl">ETD</div>
              <div className="val">{c.etd ? formatDate(c.etd) : "-"}</div>
            </td>
            <td colSpan={2}>
              <div className="lbl">MBL No. / Shipping Line</div>
              <div className="val hl">
                {c.master_no || "-"}
                {c.carrier ? ` / ${c.carrier}` : ""}
              </div>
            </td>
          </tr>
          <tr>
            <td colSpan={4}>
              <div className="lbl">Containers</div>
              <div className="val">
                {(c.containers ?? []).map((k) => [k.container_no, k.type, k.seal_no ? `seal ${k.seal_no}` : null].filter(Boolean).join(" ")).join(" · ") || "-"}
              </div>
            </td>
            <td colSpan={2}>
              <div className="lbl">Consolidator</div>
              <div className="val">{c.co_loader || c.agent_name || "EXPAC FORWARDING"}</div>
            </td>
            <td colSpan={3}>
              <div className="lbl">Totals</div>
              <div className="val">
                {c.houses.length} HBL · {t.pieces} pkgs · {t.gross.toFixed(2)} kg · {t.cbm.toFixed(3)} CBM
              </div>
            </td>
          </tr>
          <tr className="mf-head">
            <th>HBL No.</th>
            <th>Container / Marks</th>
            <th>Pkgs</th>
            <th>Weight (KG)</th>
            <th>Description of Goods</th>
            <th>CBM</th>
            <th>Freight</th>
            <th>Shipper</th>
            <th>Consignee / Notify</th>
          </tr>
          {c.houses.map((h, i) => (
            <tr key={i} className="mf-line">
              <td className="hl">{houseNo(c, h, i)}</td>
              <td className="pre">
                {h.container_no || ""}
                {h.marks ? `\n${h.marks}` : ""}
              </td>
              <td>
                {h.pieces} {h.package_type || ""}
              </td>
              <td>{Number(h.gross_kg).toFixed(2)}</td>
              <td className="pre">{h.nature_of_goods || ""}</td>
              <td>{Number(h.volume_cbm).toFixed(3)}</td>
              <td>{c.charges_code === "PP" ? "Prepaid" : "Collect"}</td>
              <td className="pre">{h.shipper || ""}</td>
              <td className="pre">
                {h.consignee || ""}
                {h.accounting_info ? `\n\n${h.accounting_info}` : ""}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={9} className="awb-terms">
              {TERMS}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Load plan for the warehouse floor: every receipt on the consolidation,
 *  which bay it's in now and how much is on hand, pick, stuff, tick. */
export function LoadPlanSheet({ consol: c }: { consol: WmsConsol }) {
  const lk = useWmsLookups();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
  const stock = stockByLocation(movesQ.data ?? []);
  const HL = houseLabel(c.mode);
  const lines = c.houses.flatMap((h, i) =>
    h.receipt_ids.flatMap((rid) => {
      const r = recById.get(rid);
      const at = stock.filter((s) => s.receipt_id === rid);
      if (!r) return [];
      if (at.length === 0)
        return [{ key: `${i}-${rid}`, house: houseNo(c, h, i), container: h.container_no, r, bay: "Released", pcs: 0, kg: 0, cbm: 0 }];
      return at.map((s) => {
        const sh = share(r, s.on_hand);
        return { key: `${i}-${rid}-${s.location_id}`, house: houseNo(c, h, i), container: h.container_no, r, bay: lk.locName(s.location_id), pcs: s.on_hand, kg: sh.kg, cbm: sh.cbm };
      });
    }),
  );
  const tot = lines.reduce((t, l) => ({ pcs: t.pcs + l.pcs, kg: t.kg + l.kg, cbm: t.cbm + l.cbm }), { pcs: 0, kg: 0, cbm: 0 });
  const sea = c.mode !== "air";
  return (
    <LetterSheet title="Load Plan">
      <div className="qs-bar">{CONSOL_MODE_LABEL[c.mode]}</div>
      <Grid
        cols={4}
        rows={[
          ["Consol No", c.consol_no],
          [`${masterLabel(c.mode)} No`, c.master_no || "—"],
          sea ? ["Vessel / Voyage", [c.vessel, c.voyage_no].filter(Boolean).join(" / ") || "—"] : ["Flight", c.flight_no || "—"],
          sea ? ["ETD", formatDate(c.etd)] : ["Flight Date", formatDate(c.flight_date)],
          sea ? ["POL → POD", `${c.port_of_loading || "—"} → ${c.port_of_discharge || "—"}`] : ["Route", `${c.origin || "—"} → ${c.destination || "—"}`],
          [
            "Containers",
            (c.containers ?? []).map((k) => [k.container_no, k.type, k.seal_no ? `seal ${k.seal_no}` : null].filter(Boolean).join(" ")).join("\n") || "—",
          ],
          ["Warehouse", lk.warehouse(c.warehouse_id)?.name ?? "—"],
          ["Houses", String(c.houses.length)],
        ]}
      />
      <div className="qs-bar">Goods to load</div>
      <table className="qs-pk wms-doc-table">
        <thead>
          <tr>
            <th>{HL}</th>
            {sea && <th>Container</th>}
            <th>Receipt</th>
            <th>Customer</th>
            <th>Description</th>
            <th>Zone / Bay</th>
            <th>Pieces</th>
            <th>KG</th>
            <th>CBM</th>
            <th>Loaded ✓</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td>{l.house}</td>
              {sea && <td>{l.container || "—"}</td>}
              <td>{l.r.receipt_no}</td>
              <td>{lk.clientName(l.r.client_id)}</td>
              <td>{l.r.description || "—"}</td>
              <td>{l.bay}</td>
              <td>{l.pcs}</td>
              <td>{qty(l.kg)}</td>
              <td>{qty(l.cbm, 3)}</td>
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={sea ? 6 : 5}>Totals</td>
            <td>{tot.pcs}</td>
            <td>{qty(tot.kg)}</td>
            <td>{qty(tot.cbm, 3)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="qs-bar">Sign-off</div>
      <div className="qs-sig">
        <div className="qs-sig-field">
          <label>Loaded By</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Checked By</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Seal No / Vehicle</label>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Date</label>
          <div className="line" />
        </div>
      </div>
    </LetterSheet>
  );
}
