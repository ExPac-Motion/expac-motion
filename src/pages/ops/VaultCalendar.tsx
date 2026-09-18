import { useMemo, useState } from "react";
import { Loading } from "../../components/common";
import { useVaultNotes } from "../../lib/hooks";
import { MONTHS, WEEKDAYS, monthMatrix, todayIso } from "../../lib/opsCalendar";
import type { VaultBudgetScope, VaultNote } from "../../lib/types";
import VaultNoteEditModal from "./VaultNoteEditModal";

const d10 = (s: string | null | undefined): string | null => (s ? s.slice(0, 10) : null);

export default function VaultCalendar({ scope }: { scope: VaultBudgetScope }) {
  const notesQ = useVaultNotes();

  const today = todayIso();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [daySel, setDaySel] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [edit, setEdit] = useState<VaultNote | null>(null);

  const notes = useMemo(
    () =>
      (notesQ.data ?? []).filter(
        (n) => d10(n.due_date) && (n.scope ?? "personal") === scope,
      ),
    [notesQ.data, scope],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, VaultNote[]>();
    for (const n of notes) {
      const date = d10(n.due_date)!;
      const list = m.get(date) ?? [];
      list.push(n);
      m.set(date, list);
    }
    return m;
  }, [notes]);

  const grid = useMemo(() => monthMatrix(cursor.y, cursor.m), [cursor.y, cursor.m]);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
    setDaySel(null);
  }

  const agenda = useMemo(
    () => notes.filter((n) => d10(n.due_date)! >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
    [notes, today],
  );

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>
        Calendar <span className="chip sm on">{scope === "personal" ? "Personal" : "Business"}</span>
      </h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Due dates from your private Notes above — nothing else feeds this.
      </p>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="btn outline small" onClick={() => shift(-1)}>
            ‹
          </button>
          <strong>
            {MONTHS[cursor.m]} {cursor.y}
          </strong>
          <button className="btn outline small" onClick={() => shift(1)}>
            ›
          </button>
          <button
            className="btn outline small"
            onClick={() => {
              setCursor({ y: now.getFullYear(), m: now.getMonth() });
              setDaySel(null);
            }}
          >
            Today
          </button>
        </div>
        <div className="chips">
          <button
            className={`chip${view === "month" ? " on" : ""}`}
            onClick={() => setView("month")}
          >
            Month
          </button>
          <button
            className={`chip${view === "agenda" ? " on" : ""}`}
            onClick={() => setView("agenda")}
          >
            Agenda
          </button>
        </div>
      </div>

      {notesQ.isLoading ? (
        <Loading />
      ) : view === "month" ? (
        <div className="cal-wrap">
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-dow">
                {w}
              </div>
            ))}
            {grid.flat().map((date) => {
              const inMonth = Number(date.slice(5, 7)) === cursor.m + 1;
              const evs = byDay.get(date) ?? [];
              return (
                <button
                  key={date}
                  className={`cal-cell${inMonth ? "" : " dim"}${
                    date === today ? " today" : ""
                  }${daySel === date ? " sel" : ""}`}
                  onClick={() => setDaySel(date)}
                >
                  <span className="cal-daynum">{Number(date.slice(8, 10))}</span>
                  {evs.slice(0, 3).map((n) => (
                    <span
                      key={n.id}
                      className={`cal-ev k-${n.kind === "note" ? "note" : "task"}`}
                      title={n.title}
                    >
                      {n.title}
                    </span>
                  ))}
                  {evs.length > 3 && (
                    <span className="cal-more">+{evs.length - 3} more</span>
                  )}
                </button>
              );
            })}
          </div>

          {daySel && (
            <div className="cal-daypanel">
              <div className="panel-head">
                <h3>{daySel}</h3>
                <button
                  className="btn small outline"
                  onClick={() => setAddDate(daySel)}
                >
                  + Item on this day
                </button>
              </div>
              {(byDay.get(daySel) ?? []).length === 0 ? (
                <p className="hint">Nothing scheduled.</p>
              ) : (
                <ul className="cal-daylist">
                  {(byDay.get(daySel) ?? []).map((n) => (
                    <li key={n.id} className="cal-daylist-task">
                      <div className="cal-daylist-task-top">
                        <span className={`cal-tag k-${n.kind === "note" ? "note" : "task"}`}>
                          {n.kind === "note" ? "Note" : "Task"}
                        </span>
                        <span className={`prio-dot ${n.priority}`} />
                        {n.kind === "task" && <span className="chip sm">{n.status}</span>}
                      </div>
                      <button className="cal-daylink" onClick={() => setEdit(n)}>
                        {n.title}
                      </button>
                      {n.body && (
                        <p className="hint" style={{ margin: "2px 0 0" }}>
                          {n.body}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="cal-agenda">
          {agenda.length === 0 ? (
            <p className="hint">Nothing coming up.</p>
          ) : (
            agenda.map((n) => (
              <div key={n.id} className="cal-agrow">
                <span className="cal-agdate">{d10(n.due_date)}</span>
                <span className={`cal-tag k-${n.kind === "note" ? "note" : "task"}`}>
                  {n.kind === "note" ? "Note" : "Task"}
                </span>
                <button className="cal-daylink" onClick={() => setEdit(n)}>
                  {n.title}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {addDate && (
        <VaultNoteEditModal
          note={null}
          scope={scope}
          defaults={{ due_date: addDate }}
          onClose={() => setAddDate(null)}
        />
      )}
      {edit && (
        <VaultNoteEditModal note={edit} scope={scope} onClose={() => setEdit(null)} />
      )}
    </div>
  );
}
