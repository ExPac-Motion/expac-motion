import { useEffect, useState } from "react";

/** "HH:MM" or "HH:MM:SS" (Postgres time) -> "HH:MM" ("" when blank/invalid). */
export function hhmm(v: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(v ?? "");
  return m ? `${m[1]}:${m[2]}` : "";
}

/** Lenient 24-hour parse: "9", "930", "0930", "9:30", "9.30", "14h30",
 *  "2pm", "2:15 pm" -> "HH:MM", or null when it isn't a valid time. */
function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Time field that always shows and accepts 24-hour HH:MM (a native
 * <input type="time"> follows the OS and can show 12-hour AM/PM). Value in
 * and out is "HH:MM" ("" when blank). Invalid entries revert.
 */
export default function TimeInput({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (hhmm: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(hhmm(value));
  useEffect(() => setText(hhmm(value)), [value]);

  function commit() {
    const t = text.trim();
    if (!t) {
      setText("");
      if (hhmm(value)) onChange("");
      return;
    }
    const parsed = parseTime(t);
    if (!parsed) return setText(hhmm(value)); // invalid — revert
    setText(parsed);
    if (parsed !== hhmm(value)) onChange(parsed);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      className={className}
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
