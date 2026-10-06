import { useId, useState, type KeyboardEvent } from "react";
import { LOCODE_OPTIONS, LOCODES } from "../../lib/locodes";
import { QUOTE_MODES } from "../../lib/types";

/** Services a partner can handle: the quoting modes plus clearing-side work. */
export const PARTNER_MODES: string[] = [
  ...QUOTE_MODES,
  "Customs Clearing",
  "Warehousing",
];

/** Every country in the UN/LOCODE list, for the Countries picker. */
export const COUNTRY_OPTIONS: string[] = [
  ...new Set(LOCODES.map((l) => l.country)),
].sort((a, b) => a.localeCompare(b));

export interface Coverage {
  modes: string[];
  countries: string[];
  ports: string[];
  coverage_notes: string;
}

export function coverageOf(c: {
  modes?: string[] | null;
  countries?: string[] | null;
  ports?: string[] | null;
  coverage_notes?: string | null;
} | null): Coverage {
  return {
    modes: c?.modes ?? [],
    countries: c?.countries ?? [],
    ports: c?.ports ?? [],
    coverage_notes: c?.coverage_notes ?? "",
  };
}

/** "CNCAN, Guangzhou, China" -> "CNCAN" (ports are stored as codes). */
const portCode = (v: string) => v.trim().split(/\s+[—-]\s+/)[0].toUpperCase();

/** Free-entry list of chips with suggestions (Enter or comma adds). */
function ChipListInput({
  value,
  onChange,
  options,
  placeholder,
  normalize = (v) => v.trim(),
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder: string;
  normalize?: (v: string) => string;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  function add(raw: string) {
    const v = normalize(raw);
    if (v && !value.includes(v)) onChange([...value, v]);
    setText("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }
  return (
    <div className="cov-chipinput">
      {value.map((v) => (
        <span key={v} className="cov-chip">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(value.filter((x) => x !== v))}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        list={listId}
        value={text}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          // Picking a datalist suggestion fires a change with the full
          // option text -- add it straight away.
          const v = e.target.value;
          if (options.includes(v)) add(v);
          else setText(v);
        }}
        onKeyDown={onKey}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}

/** Coverage fields for the partner edit form (controlled). */
export function CoverageEditor({
  value,
  onChange,
}: {
  value: Coverage;
  onChange: (v: Coverage) => void;
}) {
  const set = <K extends keyof Coverage>(k: K, v: Coverage[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <fieldset className="cov-fieldset">
      <legend>Coverage</legend>
      <div className="field">
        <label>Services / modes handled</label>
        <div className="chips">
          {PARTNER_MODES.map((m) => {
            const on = value.modes.includes(m);
            return (
              <button
                key={m}
                type="button"
                className={`chip${on ? " on" : ""}`}
                onClick={() =>
                  set(
                    "modes",
                    on ? value.modes.filter((x) => x !== m) : [...value.modes, m],
                  )
                }
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Countries serviced</label>
          <ChipListInput
            value={value.countries}
            onChange={(v) => set("countries", v)}
            options={COUNTRY_OPTIONS}
            placeholder="e.g. China, Hong Kong"
          />
        </div>
        <div className="field">
          <label>Ports / airports</label>
          <ChipListInput
            value={value.ports}
            onChange={(v) => set("ports", v)}
            options={LOCODE_OPTIONS}
            placeholder="e.g. CNCAN, CNPVG, HKHKG"
            normalize={portCode}
          />
        </div>
      </div>
      <div className="field">
        <label>Coverage notes</label>
        <textarea
          rows={2}
          value={value.coverage_notes}
          placeholder="Trade lanes, specialities (e.g. DG / batteries), cut-offs…"
          onChange={(e) => set("coverage_notes", e.target.value)}
        />
      </div>
    </fieldset>
  );
}

/** Read-only coverage summary for the partner view window. */
export function CoverageView({ value }: { value: Coverage }) {
  const empty =
    !value.modes.length &&
    !value.countries.length &&
    !value.ports.length &&
    !value.coverage_notes;
  return (
    <section className="cov-view">
      <h3>Coverage</h3>
      {empty ? (
        <p className="muted">
          No coverage set yet, Edit to add the modes, countries and ports this
          partner handles.
        </p>
      ) : (
        <div className="cov-grid">
          <div>
            <div className="hint">Services / modes</div>
            <ChipRow items={value.modes} />
          </div>
          <div>
            <div className="hint">Countries</div>
            <ChipRow items={value.countries} />
          </div>
          <div>
            <div className="hint">Ports / airports</div>
            <ChipRow items={value.ports} />
          </div>
          {value.coverage_notes && (
            <div className="cov-notes">
              <div className="hint">Notes</div>
              <p>{value.coverage_notes}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ChipRow({ items }: { items: string[] }) {
  if (!items.length) return <span className="muted">—</span>;
  return (
    <div className="cov-chiprow">
      {items.map((i) => (
        <span key={i} className="cov-chip static">
          {i}
        </span>
      ))}
    </div>
  );
}
