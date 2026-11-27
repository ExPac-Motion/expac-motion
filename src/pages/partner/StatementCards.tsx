// The partner's statement per currency (0251): outstanding total, a
// paid-vs-invoiced meter and ageing as one bar with a legend. Used on the
// partner portal's Invoices page and the vendor record's Invoices tab.
import { money, STATEMENT_BUCKETS, type CurrencyStatement } from "../../lib/partnerInvoices";

export default function StatementCards({ statement }: { statement: CurrencyStatement[] }) {
  if (statement.length === 0) return null;
  return (
    <div className="pi-statement">
        {statement.map((s) => {
          const paidPct = s.invoiced > 0 ? Math.min(100, (s.paid / s.invoiced) * 100) : 0;
          return (
            <div key={s.currency} className="panel pi-cur pi-stmt">
              <div className="pi-stmt-label">Outstanding · {s.currency}</div>
              <div className="pi-stmt-total">{money(s.currency, s.outstanding)}</div>
              <div className="pi-stmt-paid">
                <div className="pi-stmt-meter">
                  <span style={{ width: `${paidPct}%` }} />
                </div>
                <div className="pi-stmt-figs">
                  <span>
                    Invoiced <b>{money(s.currency, s.invoiced)}</b>
                  </span>
                  <span>
                    Paid <b>{money(s.currency, s.paid)}</b>
                  </span>
                </div>
              </div>
              {s.outstanding > 0 && (
                <div className="pi-stmt-age">
                  <div className="pi-stmt-bar">
                    {STATEMENT_BUCKETS.map((b, i) =>
                      s.ageing[i] > 0 ? (
                        <span
                          key={b.label}
                          className={`b${i}`}
                          style={{ width: `${(s.ageing[i] / s.outstanding) * 100}%` }}
                          title={`${b.label}: ${money(s.currency, s.ageing[i])}`}
                        />
                      ) : null,
                    )}
                  </div>
                  <ul className="pi-stmt-legend">
                    {STATEMENT_BUCKETS.map((b, i) => (
                      <li key={b.label} className={s.ageing[i] > 0 ? undefined : "zero"}>
                        <i className={`b${i}`} />
                        <span>{b.label}</span>
                        <b>{s.ageing[i] ? money(s.currency, s.ageing[i]) : "–"}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
