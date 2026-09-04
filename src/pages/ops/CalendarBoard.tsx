import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loading } from "../../components/common";
import {
  useJobTracking,
  useJobs,
  useOpsTasks,
  useQuotes,
} from "../../lib/hooks";
import {
  buildCalendarEvents,
  CAL_KIND_LABEL,
  CAL_SOURCES,
  MONTHS,
  WEEKDAYS,
  monthMatrix,
  todayIso,
  type CalEvent,
  type CalSource,
} from "../../lib/opsCalendar";
import TaskEditModal from "./TaskEditModal";

export default function CalendarBoard() {
  const navigate = useNavigate();
  const jobsQ = useJobs();
  const tasksQ = useOpsTasks();
  const quotesQ = useQuotes();
  const trackQ = useJobTracking();

  const today = todayIso();
  const now = new Date();
  const [cursor, setCursor] = useState({
    y: now.getFullYear(),
    m: now.getMonth(),
  });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [sources, setSources] = useState<Set<CalSource>>(
    new Set<CalSource>(["jobs", "tasks", "quotes", "tracking"]),
  );
  const [daySel, setDaySel] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  const loading =
    jobsQ.isLoading || tasksQ.isLoading || quotesQ.isLoading || trackQ.isLoading;

  const events = useMemo(
    () =>
      buildCalendarEvents({
        jobs: jobsQ.data ?? [],
        tasks: tasksQ.data ?? [],
        quotes: quotesQ.data ?? [],
        trackings: trackQ.data ?? [],
        sources,
      }),
    [jobsQ.data, tasksQ.data, quotesQ.data, trackQ.data, sources],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [events]);

  const grid = useMemo(
    () => monthMatrix(cursor.y, cursor.m),
    [cursor.y, cursor.m],
  );

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
    setDaySel(null);
  }
  function toggleSource(s: CalSource) {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const agenda = useMemo(
    () => events.filter((e) => e.date >= today),
    [events, today],
  );

  return (
    <>
      <div className="panel">
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
          <div className="chips">
            {CAL_SOURCES.map((s) => (
              <button
                key={s.key}
                className={`chip${sources.has(s.key) ? " on" : ""}`}
                onClick={() => toggleSource(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
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
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className={`cal-ev k-${e.kind}`} title={e.label}>
                        {e.label}
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
                    + Task on this day
                  </button>
                </div>
                {(byDay.get(daySel) ?? []).length === 0 ? (
                  <p className="hint">Nothing scheduled.</p>
                ) : (
                  <ul className="cal-daylist">
                    {(byDay.get(daySel) ?? []).map((e) => (
                      <li key={e.id}>
                        <span className={`cal-tag k-${e.kind}`}>
                          {CAL_KIND_LABEL[e.kind]}
                        </span>
                        <button
                          className="cal-daylink"
                          onClick={() => navigate(e.href)}
                        >
                          {e.label}
                          <span className="hint"> · {e.sub}</span>
                        </button>
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
              agenda.map((e) => (
                <div key={e.id} className="cal-agrow">
                  <span className="cal-agdate">{e.date}</span>
                  <span className={`cal-tag k-${e.kind}`}>
                    {CAL_KIND_LABEL[e.kind]}
                  </span>
                  <button
                    className="cal-daylink"
                    onClick={() => navigate(e.href)}
                  >
                    {e.label}
                    <span className="hint"> · {e.sub}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {addDate && (
        <TaskEditModal
          task={null}
          defaults={{ due_date: addDate }}
          onClose={() => setAddDate(null)}
        />
      )}
    </>
  );
}
