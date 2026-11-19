// Origin / Destination box: the UN/LOCODE list as you type, and when an
// address, city or airport name is typed or pasted, the nearest seaport /
// airport for the quote's mode, one click to use it.

import { useMemo } from "react";
import { LOCODE_OPTIONS } from "../lib/locodes";
import { portKindForMode, suggestPort } from "../lib/nearestPort";

/** One shared <datalist> per page is enough; render it once with this id. */
export const PORT_LIST_ID = "port-locodes";
export function PortCodeList() {
  return (
    <datalist id={PORT_LIST_ID}>
      {LOCODE_OPTIONS.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}

export default function PortCodeInput({
  value,
  onChange,
  mode,
  placeholder,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The quote's mode: air / courier suggest airports, sea suggests seaports. */
  mode: string;
  placeholder?: string;
  /** Shown when there is no suggestion. */
  hint?: string;
}) {
  const kind = portKindForMode(mode);
  const s = useMemo(() => suggestPort(value, kind), [value, kind]);
  return (
    <>
      <input list={PORT_LIST_ID} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {s ? (
        <span className="hint port-suggest">
          {s.reason[0].toUpperCase() + s.reason.slice(1)}: <b>{s.label}</b>{" "}
          <button type="button" className="link-btn" onClick={() => onChange(s.label)}>
            Use
          </button>
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </>
  );
}
