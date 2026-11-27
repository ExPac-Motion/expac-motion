/**
 * Partner Portal › Bookings (0253): the partner sends ExPac one of their own
 * shipments to handle (usually at destination); the partner is ExPac's
 * customer and is billed. They follow each request (being priced →
 * quotation ready → accepted → shipment running), read ExPac's quotation
 * and accept or decline it.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, money } from "../../lib/format";
import { LOCODE_OPTIONS } from "../../lib/locodes";
import { portalTotals } from "../../lib/portal";
import { INCOTERMS_ANY_MODE, INCOTERMS_SEA, type QuoteMode } from "../../lib/types";
import {
  BOOKING_SERVICES,
  bookingStatus,
  useBookingDecision,
  usePartnerBookingLines,
  usePartnerBookings,
  useRequestBooking,
  type BookingPacking,
  type BookingRequest,
  type PartnerBooking,
} from "../../lib/partnerBookings";

const MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Air Freight (Consol)",
  "Sea Freight (LCL)",
  "Sea Freight (FCL)",
  "Courier Express (CX)",
  "Road Freight (RDX)",
];
const blankRow = (): BookingPacking => ({ qty_ctns: "1", qty_pcs: "", length_cm: "", width_cm: "", height_cm: "", actual_kg: "" });

/* ---------------- List ---------------- */

export function PartnerBookingsList() {
  const q = usePartnerBookings();
  const [open, setOpen] = useState<PartnerBooking | null>(null);
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Your shipments, handled by ExPac"
        title="Bookings"
        actions={
          <Link to="/partner/bookings/new" className="btn">
            + Send us a shipment
          </Link>
        }
      />
      <p className="hint" style={{ marginTop: 0 }}>
        Hand ExPac your own shipments to handle: customs clearance, delivery to your consignee, warehousing. We price
        it, you accept our quotation here, and you follow the shipment live. ExPac invoices your company.
      </p>
      <div className="panel">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorNote error={q.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            No bookings yet. Use <b>Send us a shipment</b> to hand ExPac your next shipment.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="customs-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Mode</th>
                  <th>Route</th>
                  <th>Your ref</th>
                  <th>Sent</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const st = bookingStatus(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        <b>{b.reference}</b>
                      </td>
                      <td>{b.mode}</td>
                      <td>
                        {b.origin ?? "-"} to {b.destination ?? "-"}
                      </td>
                      <td>{b.customer_reference || "-"}</td>
                      <td>{formatDate(b.created_at)}</td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {b.job && (
                          <div className="hint">
                            {b.job.reference}
                            {b.job.shipment_status ? ` · ${b.job.shipment_status}` : ""}
                          </div>
                        )}
                      </td>
                      <td>
                        {b.status !== "open" && (
                          <button type="button" className={`btn small${b.status === "sent" ? "" : " outline"}`} onClick={() => setOpen(b)}>
                            {b.status === "sent" ? "View & accept" : "View quotation"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <QuotationModal b={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function QuotationModal({ b, onClose }: { b: PartnerBooking; onClose: () => void }) {
  const linesQ = usePartnerBookingLines(b.id);
  const decide = useBookingDecision();
  const { toast, error } = useToast();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const lines = linesQ.data ?? [];
  const t = portalTotals(lines);
  const canDecide = b.status === "sent";
  async function go(accept: boolean) {
    try {
      await decide.mutateAsync({ quoteId: b.id, accept, reason: accept ? undefined : reason.trim() });
      toast(accept ? "Quotation accepted, ExPac is on it" : "Quotation declined");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send your answer");
    }
  }
  return (
    <Modal title={`Quotation ${b.reference}`} onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        {b.mode} · {b.origin ?? "-"} to {b.destination ?? "-"}
        {b.valid_until ? ` · valid until ${formatDate(b.valid_until)}` : ""}
      </p>
      {linesQ.isLoading ? (
        <Loading />
      ) : linesQ.error ? (
        <ErrorNote error={linesQ.error} />
      ) : (
        <table className="customs-table">
          <thead>
            <tr>
              <th>Charge</th>
              <th>Qty</th>
              <th className="num">Rate</th>
              <th>VAT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.description}
                  <div className="hint">{l.category}</div>
                </td>
                <td>
                  {l.qty} {l.unit ?? ""}
                </td>
                <td className="num">
                  {l.cur} {Number(l.sell).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td>{Number(l.vat_pct) ? `${l.vat_pct}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pb-totals">
        <span>Excl. VAT {money(t.net)}</span>
        <span>VAT {money(t.vat)}</span>
        <b>Total {money(t.total)}</b>
      </div>
      <p className="hint">Totals in ZAR, as on ExPac&apos;s quotation.</p>
      {canDecide && !declining && (
        <div className="ps-actions">
          <button type="button" className="btn outline warn" onClick={() => setDeclining(true)}>
            Decline
          </button>
          <button type="button" className="btn" disabled={decide.isPending} onClick={() => go(true)}>
            Accept quotation
          </button>
        </div>
      )}
      {canDecide && declining && (
        <>
          <div className="field">
            <label>Why are you declining? (helps us quote better)</label>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <div className="ps-actions">
            <button type="button" className="btn outline" onClick={() => setDeclining(false)}>
              Back
            </button>
            <button type="button" className="btn warn" disabled={decide.isPending} onClick={() => go(false)}>
              Decline quotation
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------------- New booking ---------------- */

export function PartnerBookingNew() {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const req = useRequestBooking();
  const [mode, setMode] = useState<QuoteMode>("Air Freight (AIR)");
  const [services, setServices] = useState<string[]>(["Customs clearance", "Delivery to consignee"]);
  const [packing, setPacking] = useState<BookingPacking[]>([blankRow()]);
  const [ready, setReady] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const sea = mode.startsWith("Sea");
  const incoterms = sea ? [...INCOTERMS_ANY_MODE, ...INCOTERMS_SEA] : INCOTERMS_ANY_MODE;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "").trim();
    const r: BookingRequest = {
      mode,
      origin: g("origin"),
      destination: g("destination"),
      commodity: g("commodity"),
      incoterms: g("incoterms"),
      customer_reference: g("customer_reference"),
      ready_date: ready,
      etd,
      eta,
      master_bill: g("master_bill"),
      house_bill: g("house_bill"),
      consignee: [g("consignee_company"), g("consignee_address"), g("consignee_contact")].filter(Boolean).join("\n"),
      delivery: g("delivery"),
      notes: g("notes"),
      services,
      packing,
    };
    if (!r.origin || !r.destination) return error("Enter the origin and destination");
    if (!g("consignee_company")) return error("Enter the consignee (importer)");
    try {
      await req.mutateAsync(r);
      toast("Sent to ExPac, we'll come back with a quotation");
      navigate("/partner/bookings");
    } catch (er) {
      error(er instanceof Error ? er.message : "Could not send the booking");
    }
  }

  const setRow = (i: number, k: keyof BookingPacking, v: string) =>
    setPacking((rows) => rows.map((row, n) => (n === i ? { ...row, [k]: v } : row)));

  return (
    <>
      <PageHeader eyebrow="Bookings" title="Send ExPac a shipment" />
      <form className="pb-form" onSubmit={submit}>
        <datalist id="pb-locodes">
          {LOCODE_OPTIONS.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>

        <div className="panel">
          <div className="rfq-sec-head">Shipment</div>
          <div className="pb-modes">
            {MODES.map((m) => (
              <button key={m} type="button" className={mode === m ? "on" : undefined} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
          <div className="pb-grid">
            <div className="field">
              <label>Origin (port / airport)</label>
              <input name="origin" list="pb-locodes" required />
            </div>
            <div className="field">
              <label>Destination</label>
              <input name="destination" list="pb-locodes" required />
            </div>
            <div className="field">
              <label>Commodity</label>
              <input name="commodity" />
            </div>
            <div className="field">
              <label>Incoterms</label>
              <select name="incoterms" defaultValue="">
                <option value="">-</option>
                {incoterms.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code}, {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Your reference</label>
              <input name="customer_reference" />
            </div>
            <div className="field">
              <label>Cargo ready</label>
              <DateInput value={ready} onChange={setReady} />
            </div>
            <div className="field">
              <label>ETD</label>
              <DateInput value={etd} onChange={setEtd} />
            </div>
            <div className="field">
              <label>ETA</label>
              <DateInput value={eta} onChange={setEta} />
            </div>
            <div className="field">
              <label>{sea ? "MBL" : "MAWB"} (if booked)</label>
              <input name="master_bill" />
            </div>
            <div className="field">
              <label>{sea ? "HBL" : "HAWB"}</label>
              <input name="house_bill" />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="rfq-sec-head">What should ExPac do?</div>
          <div className="pb-services">
            {BOOKING_SERVICES.map((s) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={services.includes(s)}
                  onChange={(e) => setServices((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="rfq-sec-head">Consignee (importer)</div>
          <div className="pb-grid">
            <div className="field">
              <label>Company</label>
              <input name="consignee_company" required />
            </div>
            <div className="field">
              <label>Contact person, phone, email</label>
              <input name="consignee_contact" />
            </div>
            <div className="field wide">
              <label>Address</label>
              <textarea name="consignee_address" rows={2} />
            </div>
            <div className="field wide">
              <label>Deliver to (if different)</label>
              <textarea name="delivery" rows={2} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="rfq-sec-head">Cargo</div>
          <table className="customs-table pb-pack">
            <thead>
              <tr>
                <th>Cartons</th>
                <th>Pieces</th>
                <th>L (cm)</th>
                <th>W (cm)</th>
                <th>H (cm)</th>
                <th>Kg (each)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packing.map((row, i) => (
                <tr key={i}>
                  {(["qty_ctns", "qty_pcs", "length_cm", "width_cm", "height_cm", "actual_kg"] as const).map((k) => (
                    <td key={k}>
                      <input type="number" min="0" step="any" value={row[k]} onChange={(e) => setRow(i, k, e.target.value)} />
                    </td>
                  ))}
                  <td>
                    {packing.length > 1 && (
                      <button type="button" className="btn small ghost" onClick={() => setPacking((r) => r.filter((_, n) => n !== i))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small outline" onClick={() => setPacking((r) => [...r, blankRow()])}>
            + Add a line
          </button>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Anything else ExPac should know</label>
            <textarea name="notes" rows={3} />
          </div>
        </div>

        <div className="ps-actions">
          <Link to="/partner/bookings" className="btn outline">
            Cancel
          </Link>
          <button className="btn" disabled={req.isPending}>
            {req.isPending ? "Sending…" : "Send to ExPac"}
          </button>
        </div>
      </form>
    </>
  );
}
