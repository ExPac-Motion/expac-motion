import { useEffect, useRef, useState } from "react";

/** ISO "YYYY-MM-DD" -> "dd/mm/yyyy" ("" when blank/invalid). */
function isoToDmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "d/m/yyyy" (also - or . separators, 2-digit year = 20yy) -> ISO, or null. */
function dmyToIso(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Date field that always shows and accepts dd/mm/yyyy, whatever the
 * browser's locale (a native <input type="date"> follows the OS format, so
 * it can show mm/dd/yyyy). Values in and out stay ISO "YYYY-MM-DD", exactly
 * like a native date input. The calendar button opens the browser's picker.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue` + `name`,
 * read via FormData from a hidden input).
 */
export default function DateInput({
  value,
  defaultValue,
  onChange,
  name,
  className,
  title,
  disabled,
}: {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (iso: string) => void;
  name?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const controlled = value !== undefined;
  const [iso, setIso] = useState<string>((controlled ? value : defaultValue) ?? "");
  const [text, setText] = useState<string>(isoToDmy(iso));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!controlled) return;
    setIso(value ?? "");
    setText(isoToDmy(value));
  }, [controlled, value]);

  function commit(next: string) {
    setIso(next);
    setText(isoToDmy(next));
    if (next !== iso) onChange?.(next);
  }

  function commitText() {
    const t = text.trim();
    if (!t) return commit("");
    const parsed = dmyToIso(t);
    if (parsed) commit(parsed);
    else setText(isoToDmy(iso)); // invalid — revert to the last good date
  }

  function openPicker() {
    const el = nativeRef.current;
    if (!el || disabled) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }

  return (
    <span className="date-input">
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        className={className}
        title={title}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
          }
        }}
      />
      <button
        type="button"
        className="date-input-btn"
        tabIndex={-1}
        disabled={disabled}
        onClick={openPicker}
        aria-label="Open calendar"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="11.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        onChange={(e) => commit(e.target.value)}
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </span>
  );
}
