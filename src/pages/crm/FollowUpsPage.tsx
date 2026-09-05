import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteFollowUpRule,
  useFollowUpLog,
  useFollowUpRules,
  useMailTemplates,
  useRunDueFollowUps,
  useSaveFollowUpRule,
} from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import {
  FOLLOW_UP_TRIGGERS,
  type FollowUpLogEntry,
  type FollowUpRule,
  type FollowUpTrigger,
} from "../../lib/types";

function triggerLabel(t: FollowUpTrigger): string {
  return FOLLOW_UP_TRIGGERS.find((x) => x.key === t)?.label ?? t;
}
function logTone(s: FollowUpLogEntry["status"]): string {
  if (s === "failed") return "alert";
  if (s === "skipped") return "start";
  return "mid";
}

function RuleModal({
  rule,
  onClose,
}: {
  rule: FollowUpRule | "new";
  onClose: () => void;
}) {
  const current = rule === "new" ? null : rule;
  const { data: templates } = useMailTemplates();
  const save = useSaveFollowUpRule();
  const { toast, error: toastError } = useToast();

  const [trigger, setTrigger] = useState<FollowUpTrigger>(
    current?.trigger ?? "quote_quiet",
  );
  const hint = FOLLOW_UP_TRIGGERS.find((x) => x.key === trigger)?.hint ?? "";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const delay_days = Number(fd.get("delay_days") || 0);
    const template_id = String(fd.get("template_id") || "") || null;
    if (!name) return toastError("Rule name is required");
    if (!template_id) return toastError("Pick a template");
    try {
      await save.mutateAsync({
        id: current?.id,
        patch: {
          name,
          trigger,
          delay_days: Math.max(0, Math.round(delay_days)),
          template_id,
          active: fd.get("active") === "on",
        },
      });
      toast("Saved");
      onClose();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <Modal title={current ? "Edit Rule" : "New Rule"} onClose={onClose} wide>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Rule Name</label>
          <input name="name" defaultValue={current?.name ?? ""} autoFocus />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Trigger</label>
            <select
              name="trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as FollowUpTrigger)}
            >
              {FOLLOW_UP_TRIGGERS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="hint">{hint}</span>
          </div>
          <div className="field">
            <label>After how many days</label>
            <input
              name="delay_days"
              type="number"
              min={0}
              defaultValue={current?.delay_days ?? 3}
            />
          </div>
        </div>
        <div className="field">
          <label>Template to send</label>
          <select name="template_id" defaultValue={current?.template_id ?? ""}>
            <option value="">Pick a template…</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={current?.active ?? true}
          />
          Active
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function FollowUpsPage() {
  const rulesQ = useFollowUpRules();
  const logQ = useFollowUpLog();
  const { data: templates } = useMailTemplates();
  const remove = useDeleteFollowUpRule();
  const runNow = useRunDueFollowUps();
  const { toast, error: toastError } = useToast();

  const [editing, setEditing] = useState<FollowUpRule | "new" | null>(null);

  const templateName = useMemo(() => {
    const m = new Map((templates ?? []).map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [templates]);

  const rules = rulesQ.data ?? [];
  const log = logQ.data ?? [];

  async function onDelete(row: FollowUpRule) {
    if (!window.confirm(`Delete rule "${row.name}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Rule deleted");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function onRunNow() {
    try {
      const n = await runNow.mutateAsync();
      toast(n === 0 ? "Nothing due right now" : `${n} follow-up${n === 1 ? "" : "s"} dispatched`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not run");
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{rules.length} rule{rules.length === 1 ? "" : "s"}</h2>
            <p>
              A background job checks these hourly and emails the chosen template
              once per matching quote / lead / recipient / shipment. Run it by
              hand any time with the button.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn outline"
              onClick={onRunNow}
              disabled={runNow.isPending}
            >
              {runNow.isPending ? "Running…" : "Run due follow-ups now"}
            </button>
            <button className="btn" onClick={() => setEditing("new")}>
              + New Rule
            </button>
          </div>
        </div>

        {rulesQ.isLoading ? (
          <Loading />
        ) : rulesQ.isError ? (
          <ErrorNote error={rulesQ.error} />
        ) : rules.length === 0 ? (
          <EmptyState>No follow-up rules yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>After</th>
                  <th>Template</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <RowActions
                        onView={() => setEditing(r)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => onDelete(r)}
                      />
                    </td>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{triggerLabel(r.trigger)}</td>
                    <td className="nowrap">{r.delay_days}d</td>
                    <td>{templateName(r.template_id)}</td>
                    <td>
                      {r.active ? (
                        <span className="ms-tag tone-done">on</span>
                      ) : (
                        <span className="ms-tag tone-start">off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p>The last {log.length} follow-ups this workflow dispatched.</p>
          </div>
        </div>
        {logQ.isLoading ? (
          <Loading />
        ) : log.length === 0 ? (
          <EmptyState>Nothing sent yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Rule</th>
                  <th>Trigger</th>
                  <th>To</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatDateTime(e.created_at)}</td>
                    <td>{e.rule?.name ?? "—"}</td>
                    <td>{triggerLabel(e.trigger)}</td>
                    <td>{e.email}</td>
                    <td>
                      <span className={`ms-tag tone-${logTone(e.status)}`}>
                        {e.status}
                      </span>
                      {e.error && <div className="hint">{e.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <RuleModal
          key={editing === "new" ? "new" : editing.id}
          rule={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
