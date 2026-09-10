import { type ChangeEvent, type RefObject } from "react";
import { MERGE_CODES, type MergeCode } from "../lib/mailMerge";

interface Props {
  /** The input / textarea the picked code is inserted into, at the caret. */
  targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Controlled fields: receives the full new value after insertion.
   *  Omit for uncontrolled (FormData) fields — the DOM value is set directly. */
  onChange?: (value: string) => void;
  /** Code list to offer — defaults to the generic set. */
  codes?: MergeCode[];
  title?: string;
}

/** A compact "{ }" dropdown that drops a merge code (e.g. {{ shipment.number }})
 *  into a plain text field. Mirrors the tag picker inside RichTextEditor, for
 *  fields that aren't rich-text (subject lines, the Comms remarks box). */
export default function MergeCodeMenu({
  targetRef,
  onChange,
  codes = MERGE_CODES,
  title = "Insert a merge code",
}: Props) {
  function pick(e: ChangeEvent<HTMLSelectElement>) {
    const token = e.target.value;
    e.target.value = "";
    const el = targetRef.current;
    if (!token || !el) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);

    if (onChange) onChange(next);
    else el.value = next;

    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <select
      className="merge-code-menu"
      title={title}
      defaultValue=""
      onChange={pick}
    >
      <option value="" disabled>
        {"{ } code"}
      </option>
      {codes.map((c) => (
        <option key={c.token} value={c.token}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
