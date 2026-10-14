import { useState, type FormEvent } from "react";
import DateInput from "../components/DateInput";
import { packingTotals, volumetricFactor } from "../lib/calc";
import { submitQuoteRequest } from "../lib/db";
import { LOCODE_OPTIONS } from "../lib/locodes";
import { INCOTERMS_ANY_MODE, INCOTERMS_SEA, type PublicWebForm, type QuoteMode } from "../lib/types";

/** What the visitor picks -> the Quote Builder mode it becomes (the same
 *  mapping submit_quote_request() / web_form_quote_mode() apply, 0174). */
const MODES: { label: string; sub: string; mode: QuoteMode | null; contactOnly?: true }[] = [
  { label: "Priority Air Freight", sub: "Fastest, direct flights", mode: "Air Freight (AIR)" },
  { label: "Consolidated Air Freight", sub: "Air, better rates", mode: "Air Freight (AIR)" },
  { label: "Ocean LCL", sub: "Less than a container", mode: "Sea Freight (LCL)" },
  { label: "Ocean FCL", sub: "Full container", mode: "Sea Freight (FCL)" },
  { label: "Courier Express", sub: "Small, urgent parcels", mode: "Courier Express (CX)", contactOnly: true },
  { label: "Road Freight", sub: "Cross-border & local", mode: "Road Freight (RDX)", contactOnly: true },
  { label: "Not sure, please advise", sub: "We'll recommend the best option", mode: null },
];
const CONTAINERS = ["20GP", "40GP", "40HC", "45HC", "20RF", "40RF"];

interface Row {
  qty_ctns: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  actual_kg: string;
}
interface Party {
  company: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
}
const blankRow = (): Row => ({ qty_ctns: "1", length_cm: "", width_cm: "", height_cm: "", actual_kg: "" });
const blankParty = (): Party => ({ company: "", contact: "", phone: "", email: "", address: "" });

/**
 * Website quote request (a web form of kind "quote_request", 0174): the
 * inputs the Quote Builder needs, mode, route, incoterms, ready date, sender,
 * receiver and a real packing list with live CBM / chargeable weight, so a
 * submission lands in Quotations as a New Lead quote that only needs
 * charges. Shown at /forms/<id>, also inside the expac.co.za lane pages.
 */
export default function QuoteRequestPublicForm({
  form,
  utm,
  onDone,
}: {
  form: PublicWebForm;
  utm: Record<string, string>;
  onDone: () => void;
}) {
  const lane = form.lane_origin_country || "";
  const modes = MODES.filter((m) => !(lane && m.contactOnly));

  const [me, setMe] = useState({ name: "", company: "", email: "", phone: "" });
  const [modeLabel, setModeLabel] = useState(modes[modes.length - 1].label);
  const [route, setRoute] = useState({
    origin: "",
    destination: "",
    incoterms: "",
    ready_date: "",
    commodity: "",
    value: "",
    value_currency: "USD",
  });
  const [extra, setExtra] = useState({ customs_registered: "Not sure", referral: "", notes: "", website: "" });
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [containers, setContainers] = useState<{ count: string; size: string }[]>([{ count: "1", size: "40HC" }]);
  const [sender, setSender] = useState<Party>(blankParty());
  const [receiver, setReceiver] = useState<Party>(blankParty());
  const [receiverIsMe, setReceiverIsMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const mode = modes.find((m) => m.label === modeLabel)?.mode ?? "Air Freight (AIR)";
  const sea = mode.startsWith("Sea");
  const fcl = mode === "Sea Freight (FCL)";
  const pack = packingTotals(
    rows.map((p, i) => ({ position: i, ...p })),
    volumetricFactor(mode),
  );
  const incoterms = sea || modeLabel.startsWith("Not sure") ? [...INCOTERMS_ANY_MODE, ...INCOTERMS_SEA] : INCOTERMS_ANY_MODE;

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const need = (ok: unknown, msg: string) => {
      if (!ok) throw new Error(msg);
    };
    try {
      need(me.name.trim(), "Please enter your name.");
      need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(me.email.trim()), "Please enter a valid email address.");
      need(me.phone.trim(), "Please enter a phone number.");
      need(route.origin.trim(), lane ? `Where in ${lane} is the cargo collected?` : "Where is the cargo coming from?");
      need(route.destination.trim(), "Where is the cargo going?");
      need(route.commodity.trim(), "What are you shipping? (commodity)");
      need(fcl || pack.qty > 0, "Add at least one cargo line (quantity and weight).");
    } catch (er) {
      setErr((er as Error).message);
      return;
    }
    const containerText = fcl
      ? containers
          .filter((c) => Number(c.count) > 0)
          .map((c) => `${c.count} x ${c.size}`)
          .join(", ")
      : "";
    const recv: Party = receiverIsMe
      ? { company: me.company, contact: me.name, phone: me.phone, email: me.email, address: receiver.address }
      : receiver;
    setErr("");
    setBusy(true);
    try {
      const res = await submitQuoteRequest(
        form.id,
        {
          ...me,
          mode: modeLabel,
          ...route,
          customs_registered: extra.customs_registered,
          referral: extra.referral,
          notes: extra.notes,
          website: extra.website,
          containers: containerText,
          sender,
          receiver: recv,
          packing: rows.filter((r) => Number(r.qty_ctns) > 0),
        },
        form.track_url_params ? utm : {},
      );
      if (res.ok) onDone();
      else setErr(res.error || "Something went wrong, please try again.");
    } catch {
      setErr("Could not send right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const party = (p: Party, set: (p: Party) => void, who: string) => (
    <div className="wq-grid">
      <div className="field">
        <label>Company</label>
        <input value={p.company} onChange={(e) => set({ ...p, company: e.target.value })} />
      </div>
      <div className="field">
        <label>Contact person</label>
        <input value={p.contact} onChange={(e) => set({ ...p, contact: e.target.value })} />
      </div>
      <div className="field">
        <label>Phone</label>
        <input type="tel" value={p.phone} onChange={(e) => set({ ...p, phone: e.target.value })} />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={p.email} onChange={(e) => set({ ...p, email: e.target.value })} />
      </div>
      <div className="field wq-span">
        <label>{who} address</label>
        <textarea rows={2} value={p.address} onChange={(e) => set({ ...p, address: e.target.value })} />
      </div>
    </div>
  );

  return (
    <form className="wf-card wq-card" onSubmit={onSubmit} noValidate>
      <h1>{form.heading}</h1>
      {form.subtitle && <p className="sub">{form.subtitle}</p>}

      {/* Honeypot: hidden from people, bots fill it in (dropped server-side). */}
      <input
        className="wq-hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="website"
        value={extra.website}
        onChange={(e) => setExtra({ ...extra, website: e.target.value })}
      />

      <h3 className="wq-h">1. Your details</h3>
      <div className="wq-grid">
        <div className="field">
          <label>
            Name <span className="wf-req">*</span>
          </label>
          <input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} autoComplete="name" />
        </div>
        <div className="field">
          <label>Company</label>
          <input value={me.company} onChange={(e) => setMe({ ...me, company: e.target.value })} autoComplete="organization" />
        </div>
        <div className="field">
          <label>
            Email <span className="wf-req">*</span>
          </label>
          <input type="email" value={me.email} onChange={(e) => setMe({ ...me, email: e.target.value })} autoComplete="email" />
        </div>
        <div className="field">
          <label>
            Phone <span className="wf-req">*</span>
          </label>
          <input type="tel" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} autoComplete="tel" />
        </div>
        <div className="field">
          <label>Are you customs registered?</label>
          <select value={extra.customs_registered} onChange={(e) => setExtra({ ...extra, customs_registered: e.target.value })}>
            {["Not sure", "Yes", "No"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Referral code</label>
          <input value={extra.referral} onChange={(e) => setExtra({ ...extra, referral: e.target.value })} />
        </div>
      </div>

      <h3 className="wq-h">2. How should it move?</h3>
      <div className="wq-modes">
        {modes.map((m) => (
          <button
            key={m.label}
            type="button"
            className={`pt-mode${modeLabel === m.label ? " on" : ""}`}
            onClick={() => setModeLabel(m.label)}
          >
            <b>{m.label}</b>
            <span>{m.sub}</span>
          </button>
        ))}
      </div>

      <h3 className="wq-h">3. Route &amp; terms</h3>
      <datalist id="wq-locodes">
        {LOCODE_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="wq-grid">
        <div className="field">
          <label>
            {lane ? `Origin in ${lane}` : "From (origin)"} <span className="wf-req">*</span>
          </label>
          <input
            list={lane ? undefined : "wq-locodes"}
            value={route.origin}
            onChange={(e) => setRoute({ ...route, origin: e.target.value })}
            placeholder={lane ? "City, port or airport" : "City, port or airport"}
          />
        </div>
        <div className="field">
          <label>
            {lane ? "Destination in South Africa" : "To (destination)"} <span className="wf-req">*</span>
          </label>
          <input
            list="wq-locodes"
            value={route.destination}
            onChange={(e) => setRoute({ ...route, destination: e.target.value })}
            placeholder="e.g. Johannesburg"
          />
        </div>
        <div className="field">
          <label>Incoterm</label>
          <select value={route.incoterms} onChange={(e) => setRoute({ ...route, incoterms: e.target.value })}>
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
          <DateInput value={route.ready_date} onChange={(v) => setRoute({ ...route, ready_date: v })} />
        </div>
        <div className="field wq-span">
          <label>
            What are you shipping? <span className="wf-req">*</span>
          </label>
          <input
            value={route.commodity}
            onChange={(e) => setRoute({ ...route, commodity: e.target.value })}
            placeholder="e.g. LED lighting fittings"
          />
        </div>
        <div className="field">
          <label>Goods value (for insurance / duties)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={route.value_currency}
              onChange={(e) => setRoute({ ...route, value_currency: e.target.value })}
              style={{ width: 84 }}
            >
              {["USD", "ZAR", "EUR", "GBP", "CNY"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input type="number" step="any" min={0} value={route.value} onChange={(e) => setRoute({ ...route, value: e.target.value })} />
          </div>
        </div>
      </div>

      <h3 className="wq-h">4. Cargo</h3>
      {fcl && (
        <div className="wq-containers">
          {containers.map((c, i) => (
            <div key={i} className="wq-container">
              <input
                type="number"
                min={1}
                value={c.count}
                onChange={(e) => setContainers((cs) => cs.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))}
                aria-label="Number of containers"
              />
              <span>x</span>
              <select
                value={c.size}
                onChange={(e) => setContainers((cs) => cs.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}
                aria-label="Container size"
              >
                {CONTAINERS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              {containers.length > 1 && (
                <button type="button" className="row-icon-btn danger" title="Remove" onClick={() => setContainers((cs) => cs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn outline btn-sm" onClick={() => setContainers((cs) => [...cs, { count: "1", size: "20GP" }])}>
            + Container size
          </button>
          <p className="hint">Packing list below is optional for full containers.</p>
        </div>
      )}
      <div className="wq-pkg-wrap">
        <table className="table--compact wq-pkg">
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
            {rows.map((p, i) => (
              <tr key={i}>
                {(["qty_ctns", "length_cm", "width_cm", "height_cm", "actual_kg"] as const).map((k) => (
                  <td key={k}>
                    <input type="number" step="any" min={0} value={p[k]} onChange={(e) => setRow(i, { [k]: e.target.value })} />
                  </td>
                ))}
                <td>
                  {rows.length > 1 && (
                    <button type="button" className="row-icon-btn danger" title="Remove line" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wq-pkg-foot">
        <button type="button" className="btn outline btn-sm" onClick={() => setRows((rs) => [...rs, blankRow()])}>
          + Add line
        </button>
        <span>
          {pack.qty} pcs · {pack.totalActual.toFixed(1)} kg · {pack.totalCbm.toFixed(3)} CBM · chargeable{" "}
          <b>{sea ? `${Math.max(pack.totalCbm, pack.totalActual / 1000).toFixed(2)} W/M` : `${pack.chargeable.toFixed(1)} kg`}</b>
        </span>
      </div>

      <h3 className="wq-h">5. Sender (supplier, collect from)</h3>
      {party(sender, setSender, "Collection")}

      <h3 className="wq-h">6. Receiver (consignee, deliver to)</h3>
      <label className="wq-check">
        <input type="checkbox" checked={receiverIsMe} onChange={(e) => setReceiverIsMe(e.target.checked)} /> The receiver is me / my
        company
      </label>
      {receiverIsMe ? (
        <div className="field">
          <label>Delivery address</label>
          <textarea rows={2} value={receiver.address} onChange={(e) => setReceiver({ ...receiver, address: e.target.value })} />
        </div>
      ) : (
        party(receiver, setReceiver, "Delivery")
      )}

      <h3 className="wq-h">7. Anything else?</h3>
      <div className="field">
        <textarea
          rows={3}
          value={extra.notes}
          onChange={(e) => setExtra({ ...extra, notes: e.target.value })}
          placeholder="e.g. hazardous goods, stackable, clearance and delivery needed"
        />
      </div>

      {err && <div className="wf-err">{err}</div>}
      <button className="btn wf-submit" type="submit" disabled={busy}>
        {busy ? "Sending…" : form.submit_label}
      </button>
    </form>
  );
}
