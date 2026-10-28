// Shipments › Masters & Houses (0164 / 0165): every master shipment with
// its houses (one per supplier): cargo received at the warehouse against
// what was declared, documents per house, the house steps (cargo ready,
// house bill issued, loaded) and Request documents. Used by ops and the
// warehouse. WMS consols (co-loads across customers) stay under Warehouse.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DateInput from "../../components/DateInput";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useCustomerContacts } from "../../lib/customers";
import { createMessage, getCompanySettings } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { packingTotals, volumetricFactor } from "../../lib/calc";
import { sendMail, SUPPORT_BCC } from "../../lib/mail";
import { useWmsWarehouses } from "../../lib/wms";
import {
  HOUSE_STATUSES,
  HOUSE_STATUS_CLASS,
  autoHouseStatus,
  houseStatus,
  isReceivedStatus,
  useAssignReceiptHouse,
  useMastersBoard,
  useUpdateHouseSteps,
  type BoardDoc,
  type BoardHouse,
  type BoardReceipt,
} from "../../lib/houses";
import { statusLabel } from "../../lib/steps";

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");
const billOf = (mode: string) => (isAir(mode) ? "HAWB" : "HBL");
const docTypes = (mode: string) => ["Commercial Invoice", "Packing List", billOf(mode)];
const SHORT: Record<string, string> = { "Commercial Invoice": "CI", "Packing List": "PL", HBL: "HBL", HAWB: "HAWB" };
const f0 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
const f2 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 2 });
const f3 = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 3 });
const off = (a: number, b: number) => b > 0 && Math.abs(a - b) > 0.005;

type Filter = "open" | "docs" | "cargo" | "ready" | "all";
const FILTERS: [Filter, string][] = [
  ["open", "Open masters"],
  ["cargo", "Cargo not received"],
  ["docs", "Missing documents"],
  ["ready", "Ready to load"],
  ["all", "All, incl. delivered"],
];

interface HouseView {
  h: BoardHouse;
  receipts: BoardReceipt[];
  recv: { pieces: number; kg: number; cbm: number };
  have: string[];
  missing: string[];
  status: ReturnType<typeof houseStatus>;
  auto: ReturnType<typeof houseStatus>;
  /** Received here (a warehouse receipt) or marked received elsewhere. */
  received: boolean;
}

export default function MastersPage() {
  const boardQ = useMastersBoard();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [mode, setMode] = useState<"all" | "sea" | "air">("all");
  const [asking, setAsking] = useState<HouseView | null>(null);

  const masters = useMemo(() => {
    const d = boardQ.data;
    if (!d) return [];
    const byJob = new Map<string, BoardHouse[]>();
    for (const h of d.houses) if (h.job) byJob.set(h.job.id, [...(byJob.get(h.job.id) ?? []), h]);
    return [...byJob.values()].map((houses) => {
      const job = houses[0].job!;
      const types = docTypes(job.mode);
      const views: HouseView[] = houses.map((h) => {
        const receipts = d.receipts.filter((r) => r.house_id === h.id);
        const recv = receipts.reduce(
          (t, r) => ({ pieces: t.pieces + Number(r.pieces || 0), kg: t.kg + Number(r.gross_kg || 0), cbm: t.cbm + Number(r.volume_cbm || 0) }),
          { pieces: 0, kg: 0, cbm: 0 },
        );
        const docs: BoardDoc[] = d.docs.filter((x) => x.house_id === h.id);
        const have = types.filter((t) => docs.some((x) => x.doc_type === t));
        const missing = types.filter((t) => !have.includes(t));
        const status = houseStatus(h, receipts.length > 0, missing.length === 0);
        return {
          h,
          receipts,
          recv,
          have,
          missing,
          status,
          auto: autoHouseStatus(h, receipts.length > 0, missing.length === 0),
          received: receipts.length > 0 || isReceivedStatus(status),
        };
      });
      const items = d.quoted.filter((q) => q.quote_id === job.quote_id);
      const quoted = items.length ? packingTotals(items as never, volumetricFactor(job.mode)) : null;
      const declared = views.reduce(
        (t, v) => ({ pieces: t.pieces + Number(v.h.pieces || 0), kg: t.kg + Number(v.h.gross_kg || 0), cbm: t.cbm + Number(v.h.volume_cbm || 0) }),
        { pieces: 0, kg: 0, cbm: 0 },
      );
      const unassigned = d.receipts.filter((r) => r.job_id === job.id && !r.house_id);
      return { job, views, quoted, declared, unassigned };
    });
  }, [boardQ.data]);

  const n = search.trim().toLowerCase();
  const shown = masters.filter(({ job, views }) => {
    const delivered = job.milestone === "Delivered";
    if (filter !== "all" && delivered) return false;
    if (mode === "air" && !isAir(job.mode)) return false;
    if (mode === "sea" && isAir(job.mode)) return false;
    if (filter === "cargo" && !views.some((v) => !v.received)) return false;
    if (filter === "docs" && !views.some((v) => v.missing.length > 0)) return false;
    if (filter === "ready" && !views.every((v) => v.received && v.missing.length === 0 && !v.h.loaded_at)) return false;
    if (!n) return true;
    return [job.reference, job.client?.company, job.awb_mbl, job.container_no, ...views.flatMap((v) => [v.h.house_no, v.h.supplier?.company, v.h.carrier_house_no])]
      .join(" ")
      .toLowerCase()
      .includes(n);
  });

  return (
    <>
      <PageHeader eyebrow="Shipments" title="Masters & Houses" />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search shipment, house, customer, supplier, MBL…" />}
        filters={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
              {FILTERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <div className="wms-seg">
              {(["all", "sea", "air"] as const).map((m) => (
                <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  {m === "all" ? "All" : m === "sea" ? "Sea" : "Air"}
                </button>
              ))}
            </div>
          </>
        }
        count={boardQ.isLoading ? undefined : `${shown.length} master${shown.length === 1 ? "" : "s"}`}
        hint="Master shipments split into houses, one per supplier (add houses on the shipment's View). Warehouse consols (co-loads) stay under Warehouse."
      />

      {boardQ.isLoading ? (
        <div className="panel">
          <Loading />
        </div>
      ) : boardQ.isError ? (
        <div className="panel">
          <ErrorNote error={boardQ.error} />
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState>
            {masters.length === 0
              ? "No master shipments yet. Open a shipment's View and use + Add house to split it by supplier."
              : "No masters match."}
          </EmptyState>
        </div>
      ) : (
        shown.map(({ job, views, quoted, declared, unassigned }) => {
          const types = docTypes(job.mode);
          const received = views.filter((v) => v.received).length;
          const docsHave = views.reduce((s, v) => s + v.have.length, 0);
          const issued = views.filter((v) => v.h.hbl_issued_at).length;
          const loaded = views.filter((v) => v.h.loaded_at).length;
          const qCbm = quoted?.totalCbm ?? 0;
          const qKg = quoted?.totalActual ?? 0;
          return (
            <div key={job.id} className="panel ms-master">
              <div className="ms-master-head">
                <button type="button" className="ms-ref" onClick={() => navigate(`/jobs/${job.id}?tab=cargo`)} title="Open the shipment">
                  {job.reference}
                </button>
                <span className="ms-cust">{job.client?.company ?? "Customer"}</span>
                <span className="ms-meta">
                  {job.mode}
                  {job.awb_mbl ? ` · ${isAir(job.mode) ? "MAWB" : "MBL"} ${job.awb_mbl}` : ""}
                  {job.container_no ? ` · ${job.container_no}` : ""}
                  {job.etd ? ` · ETD ${formatDate(job.etd)}` : ""}
                  {job.eta ? ` · ETA ${formatDate(job.eta)}` : ""}
                </span>
                <span className="ms-status">{statusLabel(job.shipment_status, job.mode) || job.milestone}</span>
                <a className="link-btn" href={`/jobs/${job.id}/houses/print/house`} target="_blank" rel="noopener">
                  Print all {billOf(job.mode)}s
                </a>
                <a className="link-btn" href={`/jobs/${job.id}/houses/print/manifest`} target="_blank" rel="noopener">
                  Manifest
                </a>
              </div>
              <div className="ms-rollup">
                <span>
                  <b>{views.length}</b> houses
                </span>
                <span className={received < views.length ? "warn" : "ok"}>
                  <b>
                    {received}/{views.length}
                  </b>{" "}
                  cargo received
                </span>
                <span className={docsHave < views.length * types.length ? "warn" : "ok"}>
                  <b>
                    {docsHave}/{views.length * types.length}
                  </b>{" "}
                  documents
                </span>
                <span>
                  <b>
                    {issued}/{views.length}
                  </b>{" "}
                  {billOf(job.mode)} issued
                </span>
                <span>
                  <b>
                    {loaded}/{views.length}
                  </b>{" "}
                  loaded
                </span>
                <span className={`ms-tot${quoted && (off(declared.cbm, qCbm) || off(declared.kg, qKg)) ? " warn" : ""}`}>
                  Declared {f0(declared.pieces)} pcs · {f2(declared.kg)} kg · {f3(declared.cbm)} CBM
                  {quoted ? ` (quoted ${f2(qKg)} kg · ${f3(qCbm)} CBM)` : ""}
                </span>
              </div>
              {unassigned.length > 0 && <UnassignedReceipts receipts={unassigned} views={views} reference={job.reference} />}
              <div className="table-wrap">
                <table className="ms-houses">
                  <colgroup>
                    <col style={{ width: 120 }} />
                    <col style={{ width: 230 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 190 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 126 }} />
                    <col style={{ width: 126 }} />
                    <col style={{ width: 126 }} />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 205 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>House No</th>
                      <th>Supplier</th>
                      <th>Declared cargo</th>
                      <th>Received at</th>
                      <th>Documents</th>
                      <th>Cargo ready</th>
                      <th>{billOf(job.mode)} issued</th>
                      <th>Loaded</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {views.map((v) => (
                      <HouseRow key={v.h.id} v={v} types={types} onAsk={() => setAsking(v)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
      {asking && <RequestDocsModal v={asking} onClose={() => setAsking(null)} />}
    </>
  );
}

/** Warehouse receipts on the master that aren't on a house yet: assign them. */
function UnassignedReceipts({ receipts, views, reference }: { receipts: BoardReceipt[]; views: HouseView[]; reference: string }) {
  const { toast, error } = useToast();
  const assign = useAssignReceiptHouse();
  return (
    <div className="ms-unassigned">
      <b>
        {receipts.length} warehouse receipt{receipts.length === 1 ? "" : "s"} on {reference} not on a house yet
      </b>
      {receipts.map((r) => (
        <span key={r.id} className="ms-unassigned-item">
          {r.receipt_no} · {f0(Number(r.pieces))} pcs · {f2(Number(r.gross_kg))} kg · {f3(Number(r.volume_cbm))} CBM
          <select
            value=""
            onChange={(e) =>
              e.target.value &&
              assign.mutate(
                { receiptId: r.id, houseId: e.target.value },
                {
                  onSuccess: () => toast(`${r.receipt_no} put on ${views.find((v) => v.h.id === e.target.value)?.h.house_no ?? "the house"}`),
                  onError: (er) => error(er.message),
                },
              )
            }
          >
            <option value="">Assign to house…</option>
            {views.map((v) => (
              <option key={v.h.id} value={v.h.id}>
                {v.h.house_no}
                {v.h.supplier?.company ? ` (${v.h.supplier.company})` : ""}
              </option>
            ))}
          </select>
        </span>
      ))}
    </div>
  );
}

/** Pieces / kg / CBM, one line each, so the columns line up. */
function CargoFigures({ pieces, kg, cbm }: { pieces: number; kg: number; cbm: number }) {
  return (
    <div className="ms-fig">
      <span>
        <b>{f0(pieces)}</b> pcs
      </span>
      <span>
        <b>{f2(kg)}</b> kg
      </span>
      <span>
        <b>{f3(cbm)}</b> CBM
      </span>
    </div>
  );
}

/** Where cargo marked Received (without a Motion receipt) was received:
 *  one of the warehouses (Motion WMS › Warehouses) or Other. */
function ReceivedAt({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const whQ = useWmsWarehouses();
  const names = (whQ.data ?? []).filter((w) => w.active).map((w) => w.name);
  const isOther = !!value && !names.includes(value);
  const [other, setOther] = useState(isOther);
  return (
    <div className="ms-where">
      <select
        value={other ? "__other" : value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__other") return setOther(true);
          setOther(false);
          onChange(v || null);
        }}
      >
        <option value="">Pick the warehouse…</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {other && (
        <input
          defaultValue={isOther ? value ?? "" : ""}
          placeholder="Where? e.g. supplier's warehouse"
          autoFocus={!isOther}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (value ?? null)) onChange(v);
          }}
        />
      )}
    </div>
  );
}

function HouseRow({ v, types, onAsk }: { v: HouseView; types: string[]; onAsk: () => void }) {
  const { error } = useToast();
  const upd = useUpdateHouseSteps();
  const { h, receipts, recv, have, missing, status } = v;
  const step = (patch: Parameters<typeof upd.mutate>[0]["patch"]) =>
    upd.mutate({ id: h.id, patch }, { onError: (e) => error(e.message) });
  const diff = receipts.length > 0 && (recv.pieces !== Number(h.pieces) || off(recv.kg, Number(h.gross_kg)) || off(recv.cbm, Number(h.volume_cbm)));
  return (
    <tr>
      <td className="nowrap">
        <b>{h.house_no}</b>
        {h.carrier_house_no && <div className="hint">{h.carrier_house_no}</div>}
      </td>
      <td>{h.supplier?.company ?? <span className="hint">Not set</span>}</td>
      <td>
        <CargoFigures pieces={Number(h.pieces)} kg={Number(h.gross_kg)} cbm={Number(h.volume_cbm)} />
      </td>
      <td className={diff ? "ms-diff" : undefined}>
        {receipts.length > 0 ? (
          <>
            <CargoFigures pieces={recv.pieces} kg={recv.kg} cbm={recv.cbm} />
            <div className="hint">{receipts.map((r) => r.receipt_no).join(", ")}</div>
          </>
        ) : v.received ? (
          <ReceivedAt value={h.received_note} onChange={(val) => step({ received_note: val })} />
        ) : (
          <span className="hint">Not received</span>
        )}
      </td>
      <td className="nowrap">
        {types.map((t) => (
          <span key={t} className={`ms-doc${have.includes(t) ? " on" : ""}`} title={`${t}: ${have.includes(t) ? "on file" : "missing"}`}>
            {have.includes(t) ? "✓" : "·"} {SHORT[t] ?? t}
          </span>
        ))}
      </td>
      <td>
        <DateInput value={h.cargo_ready_date} onChange={(d) => step({ cargo_ready_date: d || null })} />
      </td>
      <td>
        <DateInput value={h.hbl_issued_at} onChange={(d) => step({ hbl_issued_at: d || null })} />
      </td>
      <td>
        <DateInput value={h.loaded_at} onChange={(d) => step({ loaded_at: d || null })} />
      </td>
      <td className="nowrap">
        <select
          className={`ms-status-pick badge ${HOUSE_STATUS_CLASS[status]}`}
          value={h.status ?? ""}
          title={h.status ? "Set by the team, pick Auto to follow the receipts, documents and dates again" : "Worked out automatically, pick a status to set it"}
          onChange={(e) => {
            const s = (e.target.value || null) as typeof h.status;
            step({ status: s, status_at: s ? new Date().toISOString() : null });
          }}
        >
          <option value="">Auto: {v.auto}</option>
          {HOUSE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="nowrap">
        <span style={{ display: "inline-flex", gap: 6 }}>
          <a className="btn outline btn-sm" href={`/jobs/${h.job_id}/houses/print/house?h=${h.id}`} target="_blank" rel="noopener" title="Print this house bill">
            Print
          </a>
          {missing.length > 0 && (
            <button type="button" className="btn outline btn-sm" onClick={onAsk}>
              Request documents
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

/** Ask for a house's missing documents: the team picks who (customer
 *  contacts and / or the supplier) each time; logged on the shipment. */
function RequestDocsModal({ v, onClose }: { v: HouseView; onClose: () => void }) {
  const { toast, error } = useToast();
  const job = v.h.job!;
  const contactsQ = useCustomerContacts(job.client_id ?? undefined);
  const people = useMemo(() => {
    const out: { label: string; email: string; customer: boolean }[] = [];
    const seen = new Set<string>();
    const add = (label: string, email: string | null | undefined, customer: boolean) => {
      const e = (email ?? "").trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ label, email: e, customer });
    };
    add(`Customer · ${job.client?.company ?? ""}`, job.client?.email, true);
    for (const c of contactsQ.data ?? []) add(`Customer · ${c.name}`, c.email, true);
    add(`Supplier · ${v.h.supplier?.company ?? ""}${v.h.supplier?.contact ? ` (${v.h.supplier.contact})` : ""}`, v.h.supplier?.email, false);
    return out;
  }, [job.client, contactsQ.data, v.h.supplier]);
  const [to, setTo] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [want, setWant] = useState<Set<string>>(new Set(v.missing));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const recipients = [...to, ...extra.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /@/.test(x))];
  const toCustomer = people.some((p) => p.customer && to.has(p.email));
  const list = [...want];
  const subject = `Documents needed: ${v.h.house_no}${v.h.supplier?.company ? ` (${v.h.supplier.company})` : ""}`;
  const portal = `${window.location.origin}/portal/shipments/${job.id}#house-${v.h.id}`;
  const text =
    `Good day,\n\nFor shipment ${job.reference}, house ${v.h.house_no}${v.h.supplier?.company ? ` from ${v.h.supplier.company}` : ""}, we still need:\n` +
    list.map((d) => `  - ${d}`).join("\n") +
    (note.trim() ? `\n\n${note.trim()}` : "") +
    (toCustomer ? `\n\nYou can upload them on your ExPac portal: ${portal}` : "") +
    `\n\nOr reply to this email with the documents attached.\n\nKind regards,\nExPac Forwarding`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${esc(text)
    .replace(/\n/g, "<br>")
    .replace(esc(portal), `<a href="${portal}">${esc(portal)}</a>`)}</div>`;

  async function onSend() {
    if (recipients.length === 0) return error("Pick who to ask");
    if (list.length === 0) return error("Tick at least one document");
    setBusy(true);
    try {
      const settings = await getCompanySettings().catch(() => null);
      const { id } = await sendMail({
        jobId: job.id,
        to: recipients,
        bcc: SUPPORT_BCC,
        subject,
        html,
        text,
        fromName: settings?.mail_sender_name || undefined,
        replyTo: settings?.mail_reply_to || undefined,
      });
      await createMessage({
        job_id: job.id,
        kind: "email",
        direction: "out",
        to_emails: recipients,
        cc_emails: [],
        subject,
        body: text,
        status: "sent",
        provider_id: id,
        sent_at: new Date().toISOString(),
      });
      toast(`Request sent to ${recipients.join(", ")}`);
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, value: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    fn(n);
  };

  return (
    <Modal title={`Request documents · ${v.h.house_no}`} onClose={onClose}>
      <div className="field">
        <label>Send to</label>
        {people.length === 0 && <p className="hint">No email on file for the customer or the supplier, type one below.</p>}
        {people.map((p) => (
          <label key={p.email} className="check">
            <input type="checkbox" checked={to.has(p.email)} onChange={() => toggle(to, p.email, setTo)} /> {p.label}{" "}
            <span className="hint">{p.email}</span>
          </label>
        ))}
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Other email(s), comma separated" style={{ marginTop: 6 }} />
      </div>
      <div className="field">
        <label>Documents needed</label>
        {docTypes(job.mode).map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={want.has(d)} onChange={() => toggle(want, d, setWant)} /> {d}
            {!v.missing.includes(d) && <span className="hint"> (already on file)</span>}
          </label>
        ))}
      </div>
      <div className="field">
        <label>Note (optional)</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. please send before the cut-off on Friday" />
      </div>
      <div className="field">
        <label>Email preview</label>
        <pre className="ms-preview">{`Subject: ${subject}\n\n${text}`}</pre>
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy || recipients.length === 0 || list.length === 0} onClick={() => void onSend()}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
    </Modal>
  );
}
