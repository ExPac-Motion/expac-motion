import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import DateInput from "../../components/DateInput";
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
import { money } from "../../lib/format";
import type {
  VaultBudgetDraft,
  VaultBudgetEntry,
  VaultBudgetScope,
  VaultExpenseDraft,
} from "../../lib/types";
import VaultCalendar from "./VaultCalendar";
import VaultNotes from "./VaultNotes";

const todayIso = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
/** "2026-09" -> "2026-10" (rolls the year over at December). */
function nextMonthOf(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 1)); // mo is 0-based next month already
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** "2026-09" -> "September 2026". */
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
const CARRY_FORWARD_CATEGORY = "Balance Brought Forward";
/** Earliest month each side auto-carries FROM. Business starts fresh in
 *  October 2026 (filled by hand), so its first automatic copy is Oct -> Nov. */
const AUTO_CARRY_FIRST_SOURCE: Record<VaultBudgetScope, string> = {
  personal: "",
  business: "2026-10",
};

/** One side's (Personal or Business) lines in month `from` worth carrying
 *  into month `to`: skips the
 *  Balance Brought Forward line, zero-amount Expense Control transfers, and
 *  anything `to` already has (same type, category and amount). */
function monthCopyList(
  side: VaultBudgetEntry[],
  from: string,
  to: string,
): VaultBudgetEntry[] {
  const key = (e: VaultBudgetEntry) =>
    `${e.kind}|${(e.category ?? "").trim().toLowerCase()}|${Number(e.amount)}`;
  const existing = new Set(
    side.filter((e) => e.occurred_on.startsWith(to)).map(key),
  );
  return side
    .filter(
      (e) =>
        e.occurred_on.startsWith(from) &&
        e.category !== CARRY_FORWARD_CATEGORY &&
        Number(e.amount) > 0 &&
        !existing.has(key(e)),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

const emptyEntry = (): VaultBudgetDraft => ({
  kind: "expense",
  category: "",
  amount: "",
  amount_paid: "",
  occurred_on: todayIso(),
  note: "",
});

const asDraft = (e: VaultBudgetEntry): VaultBudgetDraft => ({
  kind: e.kind,
  category: e.category ?? "",
  amount: String(e.amount),
  amount_paid: String(e.amount_paid || ""),
  occurred_on: e.occurred_on,
  note: e.note ?? "",
});

/** "2026-09-15" → "15/09/2026" (dd/mm/yyyy everywhere in the system). */
function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
/** "15/09/2026" (also - or . separators, 2-digit year) → ISO, or null. */
function dmyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ||
    dt.getUTCMonth() + 1 !== Number(mo) ||
    dt.getUTCDate() !== Number(d)
    ? null
    : iso;
}

export default function PersonalVaultPage() {
  // One Personal/Business toggle drives every board together, so a
  // transfer posted from Expense Control always lands in the Budget view
  // you're already looking at, and Notes/Calendar/Expense Control all show
  // only that side's own entries. Budget and Expense Control also share one
  // month filter, so both show the same month's activity at a glance.
  const [scope, setScope] = useState<VaultBudgetScope>("personal");
  const [month, setMonth] = useState<string>(thisMonth());
  return (
    <>
      <div className="vault-grid">
        <PersonalBudget
          scope={scope}
          setScope={setScope}
          month={month}
          setMonth={setMonth}
        />
        <ExpenseControl
          scope={scope}
          setScope={setScope}
          month={month}
          setMonth={setMonth}
        />
      </div>
      <div className="vault-grid">
        <VaultNotes scope={scope} />
        <VaultCalendar scope={scope} />
      </div>
    </>
  );
}

const SCOPE_TITLE: Record<VaultBudgetScope, string> = {
  personal: "Personal Budget",
  business: "Business Budget",
};

/** The Personal/Business toggle shared by both boards. */
function ScopeToggle({
  scope,
  setScope,
}: {
  scope: VaultBudgetScope;
  setScope: (s: VaultBudgetScope) => void;
}) {
  return (
    <div className="chips" style={{ marginRight: 4 }}>
      {(["personal", "business"] as VaultBudgetScope[]).map((s) => (
        <button
          key={s}
          type="button"
          className={`chip${scope === s ? " on" : ""}`}
          onClick={() => setScope(s)}
        >
          {SCOPE_TITLE[s].replace(" Budget", "")}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Personal Budget — one income/expense ledger, toggled between a      */
/* Personal and a Business view (same table, filtered by `scope`).     */
/* ------------------------------------------------------------------ */
function PersonalBudget({
  scope,
  setScope,
  month,
  setMonth,
}: {
  scope: VaultBudgetScope;
  setScope: (s: VaultBudgetScope) => void;
  month: string;
  setMonth: (m: string) => void;
}) {
  const q = useVaultBudget();
  const save = useSaveVaultBudgetEntry();
  const del = useDeleteVaultBudgetEntry();
  const { toast, error } = useToast();

  const [form, setForm] = useState<VaultBudgetDraft>(emptyEntry());
  const [carrying, setCarrying] = useState(false);
  const [copying, setCopying] = useState(false);

  const set = <K extends keyof VaultBudgetDraft>(
    k: K,
    v: VaultBudgetDraft[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const rows = useMemo(() => {
    let out = (q.data ?? []).filter((e) => (e.scope ?? "personal") === scope);
    if (month) out = out.filter((e) => e.occurred_on.startsWith(month));
    // Income always leads, then expenses oldest-added first — so a newly
    // added expense lands at the bottom instead of jumping to the top.
    return [...out].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [q.data, month, scope]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let paid = 0;
    let due = 0;
    for (const e of rows) {
      if (e.kind === "income") {
        income += Number(e.amount) || 0;
      } else {
        const amt = Number(e.amount) || 0;
        const amtPaid = Number(e.amount_paid) || 0;
        expense += amt;
        paid += amtPaid;
        due += Math.max(0, amt - amtPaid);
      }
    }
    // Balance is what is left of the income after what has actually been
    // paid out (including Expense Control transfers). Over Budget is how much
    // more has been paid than was budgeted (negative = under budget).
    return {
      income,
      expense,
      paid,
      due,
      balance: income - paid,
      overBudget: paid - expense,
    };
  }, [rows]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      error("Enter an amount");
      return;
    }
    try {
      await save.mutateAsync({ values: { ...form, scope } });
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

  async function saveRow(id: string, values: VaultBudgetDraft) {
    try {
      await save.mutateAsync({ id, values });
      toast("Saved");
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function carryForward() {
    if (!month) return; // "All time" has no single "next month"
    const next = nextMonthOf(month);
    const already = (q.data ?? []).some(
      (e) =>
        (e.scope ?? "personal") === scope &&
        e.occurred_on.startsWith(next) &&
        e.category === CARRY_FORWARD_CATEGORY,
    );
    if (
      already &&
      !window.confirm(
        `${monthLabel(next)} already has a Balance Brought Forward entry. Add another one anyway?`,
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        `Carry ${money(totals.balance)} from ${monthLabel(month)} into ${monthLabel(next)} as an income entry?`,
      )
    )
      return;
    setCarrying(true);
    try {
      await save.mutateAsync({
        values: {
          kind: "income",
          category: CARRY_FORWARD_CATEGORY,
          amount: String(totals.balance),
          amount_paid: "",
          occurred_on: `${next}-01`,
          note: `Carried forward from ${monthLabel(month)}`,
          scope,
        },
      });
      toast("Carried forward");
      setMonth(next);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not carry forward");
    } finally {
      setCarrying(false);
    }
  }

  /** Insert copies of `list` into month `to` under `toScope` (same category,
   *  amount, note and day of month; Amount Paid starts at 0 again). */
  async function copyEntries(
    list: VaultBudgetEntry[],
    to: string,
    toScope: VaultBudgetScope,
  ) {
    const [ty, tm] = to.split("-").map(Number);
    const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    for (const e of list) {
      const day = Math.min(Number(e.occurred_on.slice(8, 10)) || 1, lastDay);
      await save.mutateAsync({
        values: {
          kind: e.kind,
          category: e.category ?? "",
          amount: String(e.amount),
          amount_paid: "",
          occurred_on: `${to}-${String(day).padStart(2, "0")}`,
          note: e.note ?? "",
          scope: toScope,
        },
      });
    }
  }

  // Personal and Business each start a new month with last month's
  // income/expense lines carried over automatically. Runs once the ledger
  // has loaded, only for a side whose current month has no lines of its own
  // yet, copying from that side's most recent earlier month that has any.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !q.data) return;
    autoRan.current = true;
    const cur = thisMonth();
    const all = q.data;
    const copyable = (e: VaultBudgetEntry) =>
      e.category !== CARRY_FORWARD_CATEGORY && Number(e.amount) > 0;
    (async () => {
      for (const s of ["personal", "business"] as VaultBudgetScope[]) {
        const side = all.filter((e) => (e.scope ?? "personal") === s);
        if (side.some((e) => e.occurred_on.startsWith(cur) && copyable(e))) continue;
        const from = side
          .map((e) => e.occurred_on.slice(0, 7))
          .filter((m) => m < cur)
          .sort()
          .pop();
        if (!from || from < AUTO_CARRY_FIRST_SOURCE[s]) continue;
        const list = monthCopyList(side, from, cur);
        if (list.length === 0) continue;
        try {
          await copyEntries(list, cur, s);
          toast(
            `${SCOPE_TITLE[s]}: carried ${list.length} entr${list.length === 1 ? "y" : "ies"} over from ${monthLabel(from)}`,
          );
        } catch (e2) {
          error(e2 instanceof Error ? e2.message : "Could not carry entries over");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  /** Manual version, for preparing next month ahead of time. */
  async function copyToNextMonth() {
    if (!month) return;
    const next = nextMonthOf(month);
    const side = (q.data ?? []).filter(
      (e) => (e.scope ?? "personal") === scope,
    );
    const toCopy = monthCopyList(side, month, next);
    if (toCopy.length === 0) {
      toast(`${monthLabel(next)} already has all of these entries`);
      return;
    }
    if (
      !window.confirm(
        `Copy ${toCopy.length} entr${toCopy.length === 1 ? "y" : "ies"} from ${monthLabel(month)} into ${monthLabel(next)}? Amount Paid starts at 0.`,
      )
    )
      return;
    setCopying(true);
    try {
      await copyEntries(toCopy, next, scope);
      toast(`Copied ${toCopy.length} to ${monthLabel(next)}`);
      setMonth(next);
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not copy");
    } finally {
      setCopying(false);
    }
  }

  return (
    <section className="panel">
      <div className="vault-head">
        <h3>{SCOPE_TITLE[scope]}</h3>
        <div className="vault-month">
          <ScopeToggle scope={scope} setScope={setScope} />
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
          {month && (
            <button
              type="button"
              className="btn outline btn-sm"
              onClick={carryForward}
              disabled={carrying}
              title={`Add ${monthLabel(nextMonthOf(month))}'s opening balance from this month's total`}
            >
              Carry Balance Forward →
            </button>
          )}
          {month && (
            <button
              type="button"
              className="btn outline btn-sm"
              onClick={copyToNextMonth}
              disabled={copying || rows.length === 0}
              title={`Copy this month's income and expenses into ${monthLabel(nextMonthOf(month))}`}
            >
              Copy to Next Month →
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
          <span className="k">Expenses Paid</span>
          <b className="pos">{money(totals.paid)}</b>
        </div>
        <div>
          <span className="k">Expenses Due</span>
          <b className={totals.due > 0 ? "neg" : "pos"}>{money(totals.due)}</b>
        </div>
        <div>
          <span className="k">Over Budget</span>
          <b className={totals.overBudget > 0 ? "neg" : "pos"}>
            {money(totals.overBudget)}
          </b>
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
        <DateInput
          value={form.occurred_on}
          onChange={(v) => set("occurred_on", v)}
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
                <th>Amount Due</th>
                <th>Amount Paid</th>
                <th>Note</th>
                <th className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <BudgetRow
                  key={e.id}
                  entry={e}
                  saving={save.isPending}
                  onSave={saveRow}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One editable Personal Budget row: change the date (dd/mm/yyyy),
 *  category, amount or note, then hit Save. */
function BudgetRow({
  entry,
  saving,
  onSave,
  onDelete,
}: {
  entry: VaultBudgetEntry;
  saving: boolean;
  onSave: (id: string, values: VaultBudgetDraft) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<VaultBudgetDraft>(asDraft(entry));
  const [dateText, setDateText] = useState(isoToDmy(entry.occurred_on));

  // discard local edits if the row is refetched with new values
  useEffect(() => {
    setDraft(asDraft(entry));
    setDateText(isoToDmy(entry.occurred_on));
  }, [entry]);

  const set = <K extends keyof VaultBudgetDraft>(
    k: K,
    v: VaultBudgetDraft[K],
  ) => setDraft((d) => ({ ...d, [k]: v }));

  const iso = dmyToIso(dateText);
  const dateBad = dateText.trim() !== "" && iso === null;
  const dirty =
    (iso ?? entry.occurred_on) !== entry.occurred_on ||
    draft.category !== (entry.category ?? "") ||
    (Number(draft.amount) || 0) !== Number(entry.amount) ||
    (Number(draft.amount_paid) || 0) !== Number(entry.amount_paid || 0) ||
    draft.note !== (entry.note ?? "");

  function submit() {
    if (!iso) return;
    onSave(entry.id, { ...draft, occurred_on: iso });
  }

  return (
    <tr className={dirty ? "vault-row-dirty" : undefined}>
      <td className="nowrap">
        <input
          className={`vault-inline${dateBad ? " vault-bad" : ""}`}
          value={dateText}
          placeholder="dd/mm/yyyy"
          onChange={(e) => setDateText(e.target.value)}
        />
      </td>
      <td>
        <span className={`vault-tag ${entry.kind}`}>{entry.kind}</span>
      </td>
      <td>
        <input
          className="vault-inline"
          placeholder="—"
          value={draft.category}
          onChange={(e) => set("category", e.target.value)}
        />
      </td>
      <td className="nowrap">
        <span className="vault-amt-wrap">
          <span className="vault-sign">
            {entry.kind === "expense" ? "−" : "+"}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            className="vault-inline vault-amt"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </span>
      </td>
      <td className="nowrap">
        <input
          type="number"
          step="0.01"
          min="0"
          className="vault-inline vault-amt"
          placeholder="0.00"
          value={draft.amount_paid}
          onChange={(e) => set("amount_paid", e.target.value)}
        />
      </td>
      <td>
        <input
          className="vault-inline"
          placeholder="—"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
        />
      </td>
      <td>
        <div className="vault-rowactions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!dirty || dateBad || saving}
            onClick={submit}
          >
            Save
          </button>
          <button
            type="button"
            className="btn ghost btn-sm"
            onClick={() => onDelete(entry.id)}
            title="Delete entry"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Expense Control — forecasted expenses + where they were transferred */
/* ------------------------------------------------------------------ */
const emptyExpense = (): VaultExpenseDraft => ({
  title: "",
  forecasted: "",
  transferred_to: "",
});

function ExpenseControl({
  scope,
  setScope,
  month,
  setMonth,
}: {
  scope: VaultBudgetScope;
  setScope: (s: VaultBudgetScope) => void;
  month: string;
  setMonth: (m: string) => void;
}) {
  const q = useVaultTodos();
  const add = useAddVaultTodo();
  const update = useUpdateVaultTodo();
  const del = useDeleteVaultTodo();
  const { toast, error } = useToast();
  const [form, setForm] = useState<VaultExpenseDraft>(emptyExpense());

  const set = <K extends keyof VaultExpenseDraft>(
    k: K,
    v: VaultExpenseDraft[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const items = useMemo(() => {
    let out = (q.data ?? []).filter((t) => (t.scope ?? "personal") === scope);
    // Dated by when each item was added — there's no separate date field
    // to edit, so this always reflects the month it was actually created in.
    if (month) out = out.filter((t) => t.created_at.startsWith(month));
    return out;
  }, [q.data, scope, month]);
  const openCount = items.filter((t) => !t.transferred_to).length;
  const forecastTotal = items.reduce((s, t) => s + (Number(t.forecasted) || 0), 0);
  /** Sum of every expense that's actually been moved (has a Transferred To)
   *  — the running balance sitting in the Expense Control account. */
  const transferredTotal = items.reduce(
    (s, t) => s + (t.transferred_to ? Number(t.forecasted) || 0 : 0),
    0,
  );

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      error("Name the expense");
      return;
    }
    try {
      await add.mutateAsync({
        title: form.title,
        forecasted: Number(form.forecasted) || 0,
        transferred_to: form.transferred_to,
        scope,
      });
      setForm(emptyExpense());
    } catch (e2) {
      error(e2 instanceof Error ? e2.message : "Could not add");
    }
  }

  async function setTransfer(id: string, transferred_to: string) {
    try {
      await update.mutateAsync({
        id,
        patch: { transferred_to: transferred_to.trim() || null },
      });
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
        <h3>Expense Control</h3>
        <div className="vault-month">
          <ScopeToggle scope={scope} setScope={setScope} />
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
          <span className="muted small">{openCount} open</span>
        </div>
      </div>

      <form className="vault-addrow" onSubmit={onAdd}>
        <input
          placeholder="Expense"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Forecasted (R)"
          value={form.forecasted}
          onChange={(e) => set("forecasted", e.target.value)}
        />
        <input
          placeholder="Transferred To"
          value={form.transferred_to}
          onChange={(e) => set("transferred_to", e.target.value)}
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
        <div className="table-wrap vault-noscroll">
          <table className="table--compact">
            <thead>
              <tr>
                <th>Expense</th>
                <th className="n">Forecasted (R)</th>
                <th>Transferred To</th>
                <th className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.title || "—"}</td>
                  <td className="n nowrap">{money(Number(t.forecasted))}</td>
                  <td>
                    <input
                      className="vault-inline"
                      placeholder="—"
                      defaultValue={t.transferred_to ?? ""}
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== t.transferred_to)
                          setTransfer(t.id, e.target.value);
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={() => remove(t.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="vault-foot">
                <td>Total</td>
                <td className="n nowrap">
                  <b>{money(forecastTotal)}</b>
                </td>
                <td colSpan={2} />
              </tr>
              <tr className="vault-foot">
                <td>Total Expense Control Account</td>
                <td className="n nowrap">
                  <b>{money(transferredTotal)}</b>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
