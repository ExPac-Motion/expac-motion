import { useState, type FormEvent } from "react";
import DateInput from "../components/DateInput";
import { packingTotals, volumetricFactor } from "../lib/calc";
import { submitQuoteRequest } from "../lib/db";
import { LOCODE_OPTIONS } from "../lib/locodes";
import { INCOTERMS_ANY_MODE, INCOTERMS_SEA, type PublicWebForm, type QuoteMode } from "../lib/types";

/** Motion's own modes (as in the Quote Builder), plus "Not sure". The label
 *  is sent as-is; submit_quote_request() / web_form_quote_mode() (0174) turn
 *  it into the quote's mode, "Not sure" lands as Air for the team to change. */
const MODES: { label: string; sub: string; mode: QuoteMode | null }[] = [
  { label: "Air Freight (AIR)", sub: "Airport to airport or door", mode: "Air Freight (AIR)" },
  { label: "Air Freight (Consol)", sub: "Consolidated air, better rates", mode: "Air Freight (Consol)" },
  { label: "Sea Freight (LCL)", sub: "Less than a container", mode: "Sea Freight (LCL)" },
  { label: "Sea Freight (FCL)", sub: "Full container", mode: "Sea Freight (FCL)" },
  { label: "Courier Express (CX)", sub: "Small, urgent parcels", mode: "Courier Express (CX)" },
  { label: "Road Freight (RDX)", sub: "Cross-border & local", mode: "Road Freight (RDX)" },
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
  const modes = MODES;

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
  // "Send me portal access": the team invites them (Tip of the Day leads here).
  const [portalAccess, setPortalAccess] = useState(false);
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
          notes: [portalAccess ? "Would like access to the ExPac Motion portal." : "", extra.notes.trim()]
            .filter(Boolean)
            .join("\n"),
          portal_access: portalAccess,
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
        <FormTip
          onPortal={() => {
            setPortalAccess(true);
            document.getElementById("portal-access")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
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

      <label id="portal-access" className={`wq-check wq-portal${portalAccess ? " on" : ""}`}>
        <input type="checkbox" checked={portalAccess} onChange={(e) => setPortalAccess(e.target.checked)} />
        <span>
          <b>I'd like access to the ExPac Motion portal</b>
          <br />
          Request and accept quotes online, follow every shipment on a live map and chat with the ExPac team.
        </span>
      </label>

      {err && <div className="wf-err">{err}</div>}
      <button className="btn wf-submit" type="submit" disabled={busy}>
        {busy ? "Sending…" : form.submit_label}
      </button>
    </form>
  );
}

/* ---------- Tip of the Day (as on the portal dashboard, PortalTip) ---------- */

/** Links open Motion in a new tab: the form usually sits inside expac.co.za. */
const MOTION = typeof window !== "undefined" ? window.location.origin : "";
/** "#portal-access" scrolls to the form's portal tick box (section 7). */
const PORTAL_TIPS: { text: string; to?: string; link?: string }[] = [
  { text: "Become an ExPac customer and get the ExPac Motion portal: request and accept quotes online and follow every shipment in one place. Tick \"I'd like access to the portal\" below.", to: "#portal-access", link: "Request access" },
  { text: "On the ExPac Motion portal every shipment has a live route map, its flights or vessels and a Latest update, so you always know where your cargo is.", to: "#portal-access", link: "Request access" },
  { text: "Portal customers accept a quotation, or ask for a revision, in one click, and download the quotation PDF any time.", to: "#portal-access", link: "Request access" },
  { text: "Chat with the ExPac team on any shipment from the portal, the whole conversation stays with that shipment.", to: "#portal-access", link: "Request access" },
  { text: "Using our warehouse? On the portal you pre-advise goods, request releases and see your storage costs live.", to: "#portal-access", link: "Request access" },
  { text: "Repeat shipments? Portal customers request a new quote in under a minute, with their details already filled in.", to: "#portal-access", link: "Request access" },
  { text: "Already an ExPac customer? Sign in to the ExPac Motion portal to follow your shipments.", to: "/portal", link: "Sign in" },
];
const FORM_TIPS: { text: string; to?: string; link?: string }[] = [
  ...PORTAL_TIPS,
  { text: "Add your packing list, quantity, dimensions and weight per piece, for the most accurate price. The chargeable weight is worked out as you type." },
  { text: "Not sure which mode suits your cargo? Pick \"Not sure, please advise\" and we'll recommend the best option for your goods and timeline." },
  { text: "Air Freight (Consol) is consolidated air: your cargo shares space with other shipments for a better rate, usually a few days longer than direct air." },
  { text: "Shipping a full container? Choose Sea Freight (FCL) and add your container sizes, the packing list is optional." },
  { text: "Know your Incoterm, e.g. EXW or FOB? It tells us where our service starts, at your supplier's door or at the port." },
  { text: "Add your supplier as the Sender, we can arrange collection and coordinate directly with them." },
  { text: "ExPac handles the whole move: supplier collection, warehousing, air and sea freight, customs clearance and final-mile delivery." },
  { text: "Not sure about customs registration? Tell us in the form and our team will advise you on what's needed." },
  { text: "Track any ExPac shipment around the clock with your shipment number.", to: "/track", link: "Track a shipment" },
];

function FormTip({ onPortal }: { onPortal: () => void }) {
  const [offset, setOffset] = useState(0);
  const d = new Date();
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  // Each day opens on a portal tip (the aim: prospects ask for portal access),
  // the arrow then walks through all of them.
  const tip = FORM_TIPS[((day % PORTAL_TIPS.length) + offset) % FORM_TIPS.length];
  return (
    <div className="pt-tip wq-tip">
      <div className="pt-tip-head">
        <span aria-hidden>🎓</span>
        <b>Tip of the Day</b>
        <button type="button" className="pt-tip-next" onClick={() => setOffset((o) => o + 1)} title="Next tip" aria-label="Next tip">
          ›
        </button>
      </div>
      <p>
        {tip.text}
        {tip.to && (
          <>
            {" "}
            {tip.to === "#portal-access" ? (
              <a
                href="#portal-access"
                onClick={(e) => {
                  e.preventDefault();
                  onPortal();
                }}
              >
                {tip.link ?? "Show me"}
              </a>
            ) : (
              <a href={MOTION + tip.to} target="_blank" rel="noopener noreferrer">
                {tip.link ?? "Show me"}
              </a>
            )}
          </>
        )}
      </p>
    </div>
  );
}
