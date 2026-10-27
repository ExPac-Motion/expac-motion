/** ExPac addresses offered as one-click Cc wherever an email is written. */
const EXPAC_DEPARTMENTS: [string, string][] = [
  ["Admin", "admin@expac.co.za"],
  ["Operations", "operations@expac.co.za"],
  ["Gilbert", "gilbert@expac.co.za"],
];

const addressList = (list: string) =>
  list
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
const hasAddress = (list: string, email: string) => addressList(list).some((e) => e.toLowerCase() === email);
/** Adds the address to a comma-separated list, or takes it out if it's there. */
const toggleAddress = (list: string, email: string) =>
  hasAddress(list, email)
    ? addressList(list)
        .filter((e) => e.toLowerCase() !== email)
        .join(", ")
    : [...addressList(list), email].join(", ");

/** "+ Admin  + Operations  + Gilbert" chips under a Cc field (a comma-separated list). */
export default function ExpacCcPicks({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="inbox-dept-picks">
      <span className="muted">ExPac:</span>
      {EXPAC_DEPARTMENTS.map(([label, email]) => {
        const on = hasAddress(value, email);
        return (
          <button
            key={email}
            type="button"
            className={`inbox-dept${on ? " on" : ""}`}
            onClick={() => onChange(toggleAddress(value, email))}
            title={on ? `Remove ${email} from Cc` : `Copy in ${email}`}
          >
            {on ? "✓ " : "+ "}
            {label}
          </button>
        );
      })}
    </div>
  );
}
