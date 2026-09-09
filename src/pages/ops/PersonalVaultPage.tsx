import { useMemo, useState, type FormEvent } from "react";
import {
  EmptyState,
  ErrorNote,
  Loading,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useAddVaultTodo,
  useDeleteVaultBudgetEntry,
  useDeleteVaultTodo,
  useSaveVaultBudgetEntry,
  useUpdateVaultTodo,
  useVaultBudget,
  useVaultTodos,
} from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import type { VaultBudgetDraft } from "../../lib/types";

const todayIso = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const emptyEntry = (): VaultBudgetDraft => ({
  kind: "expense",
  category: "",
  amount: "",
  occurred_on: todayIso(),
  note: "",
});

export default function PersonalVaultPage() {
  return (
    <div className="vault-grid">
      <PersonalBudget />
      <ExpressControl />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Personal Budget — income / expense tracker                         */
/* ------------------------------------------------------------------ */
function PersonalBudget() {
  const q = useVaultBudget();
  const save = useSaveVaultBudgetEntry();
  const del = useDeleteVaultBudgetEntry();
  const { toast, error } = useToast();

  const [form, setForm] = useState<VaultBudgetDraft>(emptyEntry());
  const [month, setMonth] = useState<string>(thisMonth());

  const set = <K extends keyof VaultBudgetDraft>(
    k: K,
    v: VaultBudgetDraft[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const rows = useMemo(() => {
    const all = q.data ?? [];
    return month ? all.filter((e) => e.occurred_on.startsWith(month)) : all;
  }, [q.data, month]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of rows) {
      if (e.kind === "income") income += Number(e.amount) || 0;
      else expense += Number(e.amount) || 0;
    }
    return { income, expense, balance: income - expense };
  }, [rows]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      error("Enter an amount");
      return;
    }
    try {
      await save.mutateAsync({ values: form });
      setForm({ ...emptyEntry(), kind: form.kind });
      toast("Added");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await del.mutateAsync(id);
      toast("Deleted");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not delete");
    }
  }

  return (
    <section className="panel">
      <div className="vault-head">
        <h3>Personal Budget</h3>
        <div className="vault-month">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          {month && (
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => setMonth("")}
            >
              All time
            </button>
          )}
        </div>
      </div>

      <div className="vault-totals">
        <div>
          <span className="k">Income</span>
          <b>{money(totals.income)}</b>
        </div>
        <div>
          <span className="k">Expenses</span>
          <b>{money(totals.expense)}</b>
        </div>
        <div>
          <span className="k">Balance</span>
          <b className={totals.balance < 0 ? "neg" : "pos"}>
            {money(totals.balance)}
          </b>
        </div>
      </div>

      <form className="vault-addrow" onSubmit={onAdd}>
        <select
          value={form.kind}
          onChange={(e) =>
            set("kind", e.target.value as VaultBudgetDraft["kind"])
          }
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          placeholder="Category"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
        />
        <input
          type="date"
          value={form.occurred_on}
          onChange={(e) => set("occurred_on", e.target.value)}
        />
        <input
          placeholder="Note (optional)"
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
        />
        <button type="submit" className="btn" disabled={save.isPending}>
          Add
        </button>
      </form>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorNote error={q.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          {month
            ? "No entries this month."
            : "No entries yet — add your first above."}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th className="n">Amount</th>
                <th>Note</th>
                <th className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDate(e.occurred_on)}</td>
                  <td>
                    <span className={`vault-tag ${e.kind}`}>{e.kind}</span>
                  </td>
                  <td>{e.category || "—"}</td>
                  <td className="n nowrap">
                    {e.kind === "expense" ? "−" : "+"}
                    {money(Number(e.amount))}
                  </td>
                  <td>{e.note || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={() => onDelete(e.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Express Control — personal quick-actions checklist                 */
/* ------------------------------------------------------------------ */
function ExpressControl() {
  const q = useVaultTodos();
  const add = useAddVaultTodo();
  const update = useUpdateVaultTodo();
  const del = useDeleteVaultTodo();
  const { toast, error } = useToast();
  const [title, setTitle] = useState("");

  const items = q.data ?? [];
  const openCount = items.filter((t) => !t.done).length;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await add.mutateAsync(t);
      setTitle("");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not add");
    }
  }

  async function toggle(id: string, done: boolean) {
    try {
      await update.mutateAsync({ id, patch: { done } });
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not update");
    }
  }

  async function remove(id: string) {
    try {
      await del.mutateAsync(id);
      toast("Removed");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  return (
    <section className="panel">
      <div className="vault-head">
        <h3>Express Control</h3>
        <span className="muted small">{openCount} open</span>
      </div>

      <form className="vault-addrow" onSubmit={onAdd}>
        <input
          placeholder="Add a quick action…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="btn" disabled={add.isPending}>
          Add
        </button>
      </form>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorNote error={q.error} />
      ) : items.length === 0 ? (
        <EmptyState>Nothing here yet.</EmptyState>
      ) : (
        <ul className="vault-todos">
          {items.map((t) => (
            <li key={t.id} className={t.done ? "done" : ""}>
              <label>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => toggle(t.id, e.target.checked)}
                />
                <span>{t.title}</span>
              </label>
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => remove(t.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
