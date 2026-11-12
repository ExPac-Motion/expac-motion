import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime, money } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { LINE_CURRENCIES, type Quote } from "../../lib/types";
import { rfqKindLabel, rfqReplyTotalZar, rfqReplyUrl } from "../../lib/rfq";
import {
  RFQ_STATUS_LABEL,
  cleanAmount,
  deleteRfq,
  rfqDisplayStatus,
  saveRfqReplyByStaff,
  setRfqRecipientStatus,
  useQuoteRfqs,
  useRfqMutation,
  type Rfq,
  type RfqRate,
  type RfqRecipient,
} from "../../lib/rfqDb";

const TONE: Record<string, string> = {
  awaiting: "mid",
  overdue: "alert",
  received: "done",
  used: "done",
  not_used: "start",
  declined: "start",
};

const fmtRate = (r: Pick<RfqRate, "cur" | "rate" | "min_charge">) =>
  [
    r.rate != null ? `${r.cur} ${Number(r.rate).toLocaleString("en-ZA", { maximumFractionDigits: 4 })}` : null,
    r.min_charge != null ? `min ${Number(r.min_charge).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "-";

/** What the RFQ side of a quote needs doing (Next actions + tab badge). */
export function rfqPending(rfqs: Rfq[] | undefined) {
  let awaiting = 0;
  let toPick = 0;
  let nextReply: string | null = null;
  for (const f of rfqs ?? []) {
    const used = f.quote_rfq_recipients.some((r) => r.status === "used");
    for (const r of f.quote_rfq_recipients) {
      if (r.status === "awaiting") {
        awaiting += 1;
        if (f.reply_by && (!nextReply || f.reply_by < nextReply)) nextReply = f.reply_by;
      }
      if (r.status === "received" && !used) toPick += 1;
    }
  }
  return { awaiting, toPick, nextReply };
}

/**
 * Quote page › Agent rates: every Req for Quote on this quotation, each
 * agent's status, their rates side by side, and "Use these rates", which
 * opens the Quote Builder with that reply loaded as buy lines.
 */
export default function QuoteRfqPanel({ quote, onNew }: { quote: Quote; onNew: () => void }) {
  const rfqsQ = useQuoteRfqs(quote.id);
  if (rfqsQ.isLoading) return <Loading />;
  if (rfqsQ.isError) {
    const msg = rfqsQ.error instanceof Error ? rfqsQ.error.message : "";
    if (/quote_rfq|relation|schema cache/i.test(msg))
      return <p className="hint">Agent rates need migration 0241 to be run in Supabase.</p>;
    return <ErrorNote error={rfqsQ.error} />;
  }
  const rfqs = rfqsQ.data ?? [];
  return (
    <div className="rfq-panel">
      <div className="ws-sec-head">
        <h3>Agent rates</h3>
        <button className="btn small" onClick={onNew}>
          New Req for Quote
        </button>
      </div>
      {rfqs.length === 0 ? (
        <EmptyState>
          No requests yet. Use Req for Quote to send this shipment to one or more agents; their rates come back here.
        </EmptyState>
      ) : (
        rfqs.map((f) => <RfqBlock key={f.id} rfq={f} quote={quote} />)
      )}
    </div>
  );
}

function RfqBlock({ rfq, quote }: { rfq: Rfq; quote: Quote }) {
  const navigate = useNavigate();
  const { toast, error: toastError } = useToast();
  const canDelete = useCan()("delete");
  const setStatus = useRfqMutation((a: { id: string; status: RfqRecipient["status"] }) => setRfqRecipientStatus(a.id, a.status), quote.id);
  const del = useRfqMutation((id: string) => deleteRfq(id), quote.id);
  const [entering, setEntering] = useState<RfqRecipient | null>(null);
  const [using, setUsing] = useState<RfqRecipient | null>(null);

  const recips = rfq.quote_rfq_recipients;
  const replied = recips.filter((r) => r.quote_rfq_rates.length > 0 && r.status !== "declined");
  const totals = new Map(replied.map((r) => [r.id, rfqReplyTotalZar(r.quote_rfq_rates, quote)]));
  const cheapest = replied.length > 1 ? [...totals.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] : undefined;

  // Compare grid: every requested charge, plus any extra the agents added.
  const rowKeys: { key: string; label: string; code: string }[] = [];
  const seen = new Set<string>();
  for (const c of rfq.charges) {
    const key = `${c.category}|${c.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      rowKeys.push({ key, label: c.description, code: c.code });
    }
  }
  for (const r of replied)
    for (const x of r.quote_rfq_rates) {
      const key = `${x.category}|${x.code || x.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        rowKeys.push({ key, label: x.description, code: x.code });
      }
    }
  const rateFor = (r: RfqRecipient, key: string) =>
    r.quote_rfq_rates.find((x) => `${x.category}|${x.code || x.description}` === key);

  async function copyLink(r: RfqRecipient) {
    try {
      await navigator.clipboard.writeText(rfqReplyUrl(r.token));
      toast("Reply link copied");
    } catch {
      toastError("Could not copy, the link is " + rfqReplyUrl(r.token));
    }
  }

  return (
    <div className="panel ws-panel rfq-block">
      <div className="rfq-block-head">
        <div>
          <b>
            {rfqKindLabel(rfq.partner_kind)} RFQ · sent {formatDate(rfq.created_at)}
          </b>
          <span className="muted">
            {" "}
            · reply by {formatDate(rfq.reply_by)} · {recips.length} asked, {replied.length} replied
          </span>
          {rfq.notes && <div className="muted">Notes: {rfq.notes}</div>}
        </div>
        {canDelete && (
          <button
            className="link-btn"
            onClick={() => {
              if (window.confirm("Delete this request and every reply on it? Agents' links stop working.")) del.mutate(rfq.id);
            }}
          >
            Delete
          </button>
        )}
      </div>

      <div className="rfq-scroll">
      <table className="rfq-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Replied</th>
            <th>Validity</th>
            <th>Transit</th>
            <th className="n">Est. buy (ZAR)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {recips.map((r) => {
            const st = rfqDisplayStatus(r, rfq.reply_by);
            const total = totals.get(r.id);
            return (
              <tr key={r.id}>
                <td>
                  <b>{r.company || r.email}</b>
                  {r.company && <div className="muted">{r.email}</div>}
                </td>
                <td>
                  <span className={`ms-tag tone-${TONE[st]}`}>{RFQ_STATUS_LABEL[st]}</span>
                </td>
                <td>
                  {r.responded_at ? formatDateTime(r.responded_at) : "-"}
                  {r.responded_via && <div className="muted">{r.responded_via === "link" ? "via reply link" : "keyed in"}</div>}
                </td>
                <td>{r.validity || "-"}</td>
                <td>{r.transit_time || "-"}</td>
                <td className="n">
                  {total != null ? money(total) : "-"}
                  {cheapest === r.id && <div className="rfq-best">Lowest</div>}
                </td>
                <td className="rfq-acts">
                  {(r.status === "received" || r.status === "used" || r.status === "not_used") && r.quote_rfq_rates.length > 0 && (
                    <button className="btn small" onClick={() => setUsing(r)}>
                      Use these rates
                    </button>
                  )}
                  <button className="btn ghost small" onClick={() => setEntering(r)}>
                    {r.quote_rfq_rates.length ? "Edit rates" : "Enter rates"}
                  </button>
                  {r.status === "awaiting" && (
                    <>
                      <button className="btn ghost small" onClick={() => copyLink(r)}>
                        Copy link
                      </button>
                      <button className="btn ghost small" onClick={() => setStatus.mutate({ id: r.id, status: "declined" })}>
                        Declined
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {replied.length > 0 && (
        <details className="rfq-compare" open={replied.length > 1}>
          <summary>Compare rates ({replied.length})</summary>
          <div className="rfq-compare-scroll">
            <table className="rfq-table">
              <thead>
                <tr>
                  <th>Charge</th>
                  {replied.map((r) => (
                    <th key={r.id}>{r.company || r.email}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowKeys.map((k) => (
                  <tr key={k.key}>
                    <td>
                      {k.label}
                      {k.code && <span className="muted"> {k.code}</span>}
                    </td>
                    {replied.map((r) => {
                      const x = rateFor(r, k.key);
                      return (
                        <td key={r.id} title={x?.remarks ?? undefined}>
                          {x ? fmtRate(x) : "-"}
                          {x?.remarks && <div className="muted">{x.remarks}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="rfq-total">
                  <td>Est. buy total (ZAR, at the quote's rates of exchange)</td>
                  {replied.map((r) => (
                    <td key={r.id}>{money(totals.get(r.id) ?? 0)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      )}

      {entering && <StaffEntryModal rfq={rfq} recipient={entering} quoteId={quote.id} onClose={() => setEntering(null)} />}
      {using && (
        <UseRatesModal
          recipient={using}
          quote={quote}
          onClose={() => setUsing(null)}
          onGo={() => navigate(`/quotes/${quote.id}?rfqReply=${using.id}`)}
        />
      )}
    </div>
  );
}

/** Staff key in an agent's emailed reply (or correct one). */
function StaffEntryModal({ rfq, recipient, quoteId, onClose }: { rfq: Rfq; recipient: RfqRecipient; quoteId: string; onClose: () => void }) {
  const { toast, error: toastError } = useToast();
  const save = useRfqMutation(saveRfqReplyByStaff, quoteId);
  const prior = new Map(recipient.quote_rfq_rates.map((r) => [`${r.category}|${r.code}`, r]));
  const asked = new Set(rfq.charges.map((c) => `${c.category}|${c.code}`));
  const [rows, setRows] = useState(() => [
    ...rfq.charges.map((c) => {
      const p = prior.get(`${c.category}|${c.code}`);
      return {
        category: c.category as string,
        code: c.code,
        description: c.description,
        unit: c.unit,
        cur: p?.cur ?? c.cur,
        rate: p?.rate != null ? String(p.rate) : "",
        min: p?.min_charge != null ? String(p.min_charge) : "",
        remarks: p?.remarks ?? "",
      };
    }),
    ...recipient.quote_rfq_rates
      .filter((r) => !asked.has(`${r.category}|${r.code}`))
      .map((r) => ({
        category: r.category,
        code: r.code,
        description: r.description,
        unit: r.unit,
        cur: r.cur,
        rate: r.rate != null ? String(r.rate) : "",
        min: r.min_charge != null ? String(r.min_charge) : "",
        remarks: r.remarks ?? "",
      })),
  ]);
  const [validity, setValidity] = useState(recipient.validity ?? "");
  const [transit, setTransit] = useState(recipient.transit_time ?? "");
  const [remarks, setRemarks] = useState(recipient.remarks ?? "");
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onSave(declined: boolean) {
    const rates: RfqRate[] = rows.map((r, i) => ({
      position: i,
      category: r.category,
      code: r.code,
      description: r.description,
      unit: r.unit,
      cur: r.cur,
      rate: cleanAmount(r.rate) ? Number(cleanAmount(r.rate)) : null,
      min_charge: cleanAmount(r.min) ? Number(cleanAmount(r.min)) : null,
      remarks: r.remarks,
    }));
    if (!declined && !rates.some((r) => r.rate != null || r.min_charge != null)) return toastError("Enter at least one rate");
    try {
      await save.mutateAsync({ recipientId: recipient.id, rates, validity, transit, remarks, declined });
      toast(declined ? "Marked as declined" : "Rates saved");
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Modal title={`Rates from ${recipient.company || recipient.email}`} onClose={onClose} wide>
      <table className="rfq-table rfq-entry">
        <thead>
          <tr>
            <th>Charge</th>
            <th>Cur</th>
            <th>Rate</th>
            <th>Min</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {r.description}
                <span className="muted">
                  {" "}
                  {r.code}
                  {r.unit ? ` · ${r.unit}` : ""}
                </span>
              </td>
              <td>
                <select value={r.cur} onChange={(e) => set(i, { cur: e.target.value })}>
                  {LINE_CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td>
                <input inputMode="decimal" value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} />
              </td>
              <td>
                <input inputMode="decimal" value={r.min} onChange={(e) => set(i, { min: e.target.value })} />
              </td>
              <td>
                <input value={r.remarks} onChange={(e) => set(i, { remarks: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid2">
        <div className="field">
          <label>Rate validity</label>
          <input value={validity} onChange={(e) => setValidity(e.target.value)} />
        </div>
        <div className="field">
          <label>Transit time / routing</label>
          <input value={transit} onChange={(e) => setTransit(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Remarks</label>
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn outline" onClick={() => onSave(true)} disabled={save.isPending}>
          Agent can't quote
        </button>
        <button className="btn outline" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
        <button className="btn" onClick={() => onSave(false)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save rates"}
        </button>
      </div>
    </Modal>
  );
}

/** Confirm before loading a reply into the quote: which lines change. */
function UseRatesModal({ recipient, quote, onClose, onGo }: { recipient: RfqRecipient; quote: Quote; onClose: () => void; onGo: () => void }) {
  const existing = new Set(quote.quote_lines.filter((l) => l.code).map((l) => `${l.category}|${l.code}`));
  const rates = recipient.quote_rfq_rates.filter((r) => r.rate != null || r.min_charge != null);
  return (
    <Modal title={`Use ${recipient.company || recipient.email}'s rates`} onClose={onClose}>
      <p>
        Opens the Quote Builder with these rates as buy lines at the quote's tier margin. Lines with the same code are
        replaced, all other lines stay. Check the figures, then Save; this reply is then marked Used and the others Not used.
      </p>
      <ul className="rfq-changes">
        {rates.map((r, i) => (
          <li key={i}>
            <span className={`ms-tag tone-${existing.has(`${r.category}|${r.code}`) ? "mid" : "done"}`}>
              {existing.has(`${r.category}|${r.code}`) ? "Replace" : "Add"}
            </span>{" "}
            {r.code && <b>{r.code} </b>}
            {r.description} · {fmtRate(r)}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={onGo}>
          Open in Quote Builder
        </button>
      </div>
    </Modal>
  );
}
