// One Motion AI action (0215): what the bot wants to do, its status, and
// Approve / Edit / Reject (awaiting approval) or Undo (done). Used in the
// chat panel and the Control Tower › Motion AI tab.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DateInput from "./DateInput";
import QuickMailModal from "./QuickMailModal";
import { buildAndSaveAiQuote, type AiQuoteInput } from "../lib/aiQuote";
import { formatDateTime } from "../lib/format";
import { AI_ACTION_LABEL, AI_STATUS_LABEL, decideAiAction, type AiAction } from "../lib/motionAi";
import { SHIPMENT_STATUSES } from "../lib/types";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default function MotionAiActionCard({
  action,
  onChange,
  compact,
}: {
  action: AiAction;
  onChange?: (a: AiAction) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const shown = action.edited_input ?? action.input;
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const navigate = useNavigate();
  const [mailOpen, setMailOpen] = useState(false);
  const isQuote = action.tool === "draft_quote";
  const isEmail = action.tool === "draft_email";
  const result = (action.result ?? {}) as Record<string, unknown>;

  /** Quote drafts are priced and saved here, with the Quote Builder's own
   *  Load rates code, then reported back. */
  async function approveQuote() {
    setBusy(true);
    setError(null);
    try {
      const saved = await buildAndSaveAiQuote(shown as unknown as AiQuoteInput);
      const a = await decideAiAction(action.id, "complete", { result: saved });
      onChange?.(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject" | "undo" | "complete", extra = {}) {
    setBusy(true);
    setError(null);
    try {
      const a = await decideAiAction(action.id, decision, extra);
      setMode("view");
      onChange?.(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setEdit(
      action.tool === "update_shipment_status"
        ? { status: str(shown.status), reason: str(shown.reason) }
        : { title: str(shown.title), body: str(shown.body), due_date: str(shown.due_date), priority: str(shown.priority) || "normal" },
    );
    setMode("edit");
  }

  const isTask = action.tool === "create_task" || action.tool === "create_note";
  const canEdit = isTask || action.tool === "update_shipment_status";

  return (
    <div className={`mai-card ${action.status}${compact ? " compact" : ""}`}>
      <div className="mai-card-top">
        <span className="mai-card-kind">{AI_ACTION_LABEL[action.tool] ?? action.tool}</span>
        <span className={`mai-pill ${action.status}`}>{AI_STATUS_LABEL[action.status]}</span>
      </div>
      <div className="mai-card-summary">{action.summary}</div>
      {isTask && str(shown.body) && mode === "view" && <div className="mai-card-body">{str(shown.body)}</div>}
      {isEmail && action.status === "pending" && (
        // Server-escaped paragraphs (drafts.ts toHtml), no other markup.
        <div className="mai-card-mail" dangerouslySetInnerHTML={{ __html: str(shown.body_html) }} />
      )}
      {isEmail && action.status === "pending" && !str(shown.to) && (
        <div className="mai-card-note bad">No email address on file: add one on the record first.</div>
      )}
      {isQuote && action.status === "executed" && str(result.quote_id) && (
        <div className="mai-card-actions">
          <button className="btn outline btn-sm" onClick={() => navigate(`/quotes/${str(result.quote_id)}/view`)}>
            Open {str(result.reference)}
          </button>
          <span className="mai-card-note">{Number(result.lines) || 0} priced lines, saved as New Lead</span>
        </div>
      )}
      {isEmail && action.status === "executed" && (
        <div className="mai-card-note">Sent to {str(result.to)} {formatDateTime(action.executed_at)}</div>
      )}
      {action.status === "rejected" && action.reject_reason && (
        <div className="mai-card-note">Reason: {action.reject_reason}</div>
      )}
      {action.error && <div className="mai-card-note bad">{action.error}</div>}
      {action.status === "executed" && action.level === "auto" && (
        <div className="mai-card-note">Done automatically {formatDateTime(action.executed_at)}</div>
      )}
      {action.status === "suggested" && <div className="mai-card-note">Suggest only: nothing was changed.</div>}

      {mode === "edit" && (
        <div className="mai-card-edit">
          {action.tool === "update_shipment_status" ? (
            <>
              <label>
                New status
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {SHIPMENT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <input type="text" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label>
                Title
                <input type="text" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </label>
              <label>
                Detail
                <textarea rows={2} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              </label>
              <div className="mai-card-row">
                <label>
                  Due date
                  <DateInput value={edit.due_date || null} onChange={(iso) => setEdit({ ...edit, due_date: iso })} />
                </label>
                {action.tool === "create_task" && (
                  <label>
                    Priority
                    <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {mode === "reject" && (
        <div className="mai-card-edit">
          <label>
            Why not? (optional, helps Motion AI learn)
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
        </div>
      )}

      {error && <div className="mai-card-note bad">{error}</div>}

      {action.status === "pending" && (
        <div className="mai-card-actions">
          {mode === "view" && (
            <>
              {isQuote ? (
                <button className="btn btn-sm" disabled={busy} onClick={approveQuote}>
                  {busy ? "Pricing…" : "Approve & save draft"}
                </button>
              ) : isEmail ? (
                <button className="btn btn-sm" disabled={busy || !str(shown.to)} onClick={() => setMailOpen(true)}>
                  Approve & send
                </button>
              ) : (
                <button className="btn btn-sm" disabled={busy} onClick={() => decide("approve")}>
                  Approve
                </button>
              )}
              {canEdit && (
                <button className="btn outline btn-sm" disabled={busy} onClick={startEdit}>
                  Edit
                </button>
              )}
              <button className="btn outline warn btn-sm" disabled={busy} onClick={() => setMode("reject")}>
                Reject
              </button>
            </>
          )}
          {mode === "edit" && (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => decide("approve", { edited_input: edit })}>
                Save & approve
              </button>
              <button className="link-btn" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </button>
            </>
          )}
          {mode === "reject" && (
            <>
              <button className="btn outline warn btn-sm" disabled={busy} onClick={() => decide("reject", { reason })}>
                Reject
              </button>
              <button className="link-btn" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {mailOpen && (
        <QuickMailModal
          to={str(shown.to)}
          company={str(shown.company_label)}
          name={str(shown.contact_label) || null}
          quote={str(shown.quote_id) && str(shown.reference) ? { id: str(shown.quote_id), reference: str(shown.reference) } : undefined}
          initialSubject={str(shown.subject)}
          initialBody={str(shown.body_html)}
          onSent={(info) => void decide("complete", { result: { message_id: info.id, to: info.to, subject: info.subject } })}
          onClose={() => setMailOpen(false)}
        />
      )}
      {action.status === "executed" && action.undo && (
        <div className="mai-card-actions">
          <button className="btn outline btn-sm" disabled={busy} onClick={() => decide("undo")}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
