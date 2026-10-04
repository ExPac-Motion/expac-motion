// Inbox address book: a To / Cc field that suggests people as you type —
// everyone you've emailed or received mail from, plus CRM contacts
// (customers, leads, suppliers & agents). Matches the email, name or company
// of the address being typed (after the last comma); Enter / Tab / click
// picks it.
import { useMemo, useState, type KeyboardEvent } from "react";

export interface BookEntry {
  email: string;
  name: string | null;
  /** Company / CRM record, shown beside the name. */
  org: string | null;
}

export default function RecipientInput({
  value,
  onChange,
  book,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  book: BookEntry[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const cut = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
  const token = value.slice(cut + 1).trim().toLowerCase();
  const taken = useMemo(
    () => new Set(value.toLowerCase().split(/[,;\s]+/).filter(Boolean)),
    [value],
  );
  const matches = useMemo(() => {
    if (!token) return [];
    const starts = (s: string | null) => !!s && s.toLowerCase().split(/[\s@.]+/).some((w) => w.startsWith(token));
    return book
      .filter((b) => !taken.has(b.email) || b.email === token)
      .filter(
        (b) =>
          b.email.includes(token) ||
          (b.name ?? "").toLowerCase().includes(token) ||
          (b.org ?? "").toLowerCase().includes(token),
      )
      // Word-start matches first, then the rest.
      .sort((a, b) => Number(starts(b.email) || starts(b.name)) - Number(starts(a.email) || starts(a.name)))
      .slice(0, 8);
  }, [book, token, taken]);

  function pick(b: BookEntry) {
    const before = value.slice(0, cut + 1);
    onChange(`${before}${before ? " " : ""}${b.email}, `);
    setOpen(false);
    setHi(0);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[Math.min(hi, matches.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="rcpt">
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && matches.length > 0 && (
        <div className="rcpt-menu" role="listbox">
          {matches.map((b, i) => (
            <button
              key={b.email}
              type="button"
              role="option"
              aria-selected={i === hi}
              className={`rcpt-item${i === hi ? " on" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(b);
              }}
              onMouseEnter={() => setHi(i)}
            >
              <strong>{b.name || b.email}</strong>
              {b.name && <span className="muted"> &lt;{b.email}&gt;</span>}
              {b.org && b.org !== b.name && <span className="rcpt-org">{b.org}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
