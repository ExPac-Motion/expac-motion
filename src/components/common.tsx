import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { STATUS_LABEL, type QuoteStatus } from "../lib/types";
import Modal from "./Modal";

/** Rounded search field with a magnifier icon, for list pages. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** A small button that toggles a click-away popover menu. Used for the
 *  Leads / Opportunities "Filter / Sort / Columns / Options" controls. */
export function Popover({
  label,
  badge,
  size = "sm",
  children,
}: {
  label: string;
  badge?: number;
  /** "md" matches a normal .btn (e.g. sitting next to "+ New …"). */
  size?: "sm" | "md";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="ui-pop" ref={ref}>
      <button
        type="button"
        className={`btn outline${size === "sm" ? " btn-sm" : ""}${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {badge ? <span className="ui-pop-badge">{badge}</span> : null}
      </button>
      {open && <div className="ui-pop-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const ROW_ICON = {
  view: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  ),
  duplicate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  ),
};

/**
 * Leading Actions cell for list tables: a bulk-select checkbox + View / Edit /
 * Delete / Duplicate icon buttons. Every control stops propagation since these
 * rows are often themselves clickable (opens View).
 *
 * Pass `onSelectToggle` (paired with a `useRowSelection` head) to make the
 * checkbox live; omit it and the checkbox stays inert (pages not yet wired for
 * bulk actions).
 */
export function RowActions({
  selected,
  onSelectToggle,
  onMail,
  mailTitle = "Send a message",
  mailUnread = false,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  /** Controlled bulk-select state — only when `onSelectToggle` is also given. */
  selected?: boolean;
  onSelectToggle?: () => void;
  /** When set, a mail icon is shown first (after the checkbox). */
  onMail?: () => void;
  mailTitle?: string;
  /** Badges the mail icon — an unread customer reply is waiting. */
  mailUnread?: boolean;
  /** Each icon is omitted when its handler isn't passed (e.g. config lists
   *  that are view + edit only, or a sent campaign that can't be edited). */
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="row-icons">
      {onSelectToggle ? (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onSelectToggle}
          onClick={(e) => e.stopPropagation()}
          title="Select row"
        />
      ) : (
        <input type="checkbox" onClick={(e) => e.stopPropagation()} />
      )}
      {onMail && (
        <button
          className={`row-icon-btn${mailUnread ? " has-unread" : ""}`}
          title={mailUnread ? `${mailTitle} — new reply` : mailTitle}
          onClick={stop(onMail)}
        >
          {ROW_ICON.mail}
          {mailUnread && <span className="row-icon-dot" />}
        </button>
      )}
      {onView && (
        <button className="row-icon-btn" title="View" onClick={stop(onView)}>
          {ROW_ICON.view}
        </button>
      )}
      {onEdit && (
        <button className="row-icon-btn" title="Edit" onClick={stop(onEdit)}>
          {ROW_ICON.edit}
        </button>
      )}
      {onDelete && (
        <button
          className="row-icon-btn danger"
          title="Delete"
          onClick={stop(onDelete)}
        >
          {ROW_ICON.delete}
        </button>
      )}
      {onDuplicate && (
        <button
          className="row-icon-btn"
          title="Duplicate"
          onClick={stop(onDuplicate)}
        >
          {ROW_ICON.duplicate}
        </button>
      )}
    </div>
  );
}

/** Header cell to pair with RowActions: a select-all checkbox + "Actions" label.
 *  Pass `onToggle` (from `useRowSelection`) to make the checkbox live. */
export function RowActionsHead({
  checked,
  indeterminate,
  onToggle,
}: {
  checked?: boolean;
  indeterminate?: boolean;
  onToggle?: () => void;
} = {}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <div className="row-icons row-icons-head">
      {onToggle ? (
        <input
          ref={ref}
          type="checkbox"
          checked={!!checked}
          onChange={onToggle}
          title="Select all"
        />
      ) : (
        <input type="checkbox" />
      )}
      <span>Actions</span>
    </div>
  );
}

/* ---------- bulk selection + bulk edit ---------- */

/**
 * Bulk-select state for a list table. Pass the full row list; optionally pass
 * the on-screen subset (after filters) as `visibleRows` so "select all" only
 * touches what's visible while selections survive a filter change. Rows that
 * leave the list entirely (deleted / refetched away) drop out of the count on
 * their own — the raw id set is filtered against the live rows on every read.
 */
export function useRowSelection<T extends { id: string }>(
  allRows: T[],
  visibleRows: T[] = allRows,
) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const liveIds = useMemo(
    () => new Set(allRows.map((r) => r.id)),
    [allRows],
  );
  const effective = useMemo(
    () => [...selected].filter((id) => liveIds.has(id)),
    [selected, liveIds],
  );
  const effectiveSet = useMemo(() => new Set(effective), [effective]);
  const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyOn =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      visibleIds.forEach((id) => {
        if (everyOn) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const allChecked =
    visibleIds.length > 0 && visibleIds.every((id) => effectiveSet.has(id));
  const someChecked = visibleIds.some((id) => effectiveSet.has(id));

  return {
    ids: effective,
    count: effective.length,
    isSelected: (id: string) => effectiveSet.has(id),
    toggle,
    toggleAll,
    clear,
    allChecked,
    someChecked,
  };
}

export type BulkField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "toggle";
  /** Options for `type: "select"`. */
  options?: { value: string; label: string }[];
  /** Labels for `type: "toggle"` (defaults Yes / No). */
  onLabel?: string;
  offLabel?: string;
  placeholder?: string;
  /** `false` removes the "— clear —" choice, so the field can only be set,
   *  not blanked (use for NOT NULL columns like a quote's status). */
  allowClear?: boolean;
};

/**
 * Generic "change these fields on every selected row" dialog. Each field has a
 * tick that enables its input; only ticked fields end up in the patch, so
 * untouched columns are left exactly as they were.
 */
export function BulkEditModal({
  title,
  count,
  noun = "row",
  fields,
  busy,
  onApply,
  onClose,
}: {
  title: string;
  count: number;
  noun?: string;
  fields: BulkField[];
  busy?: boolean;
  onApply: (patch: Record<string, string | number | boolean | null>) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [val, setVal] = useState<Record<string, string>>({});
  const anyOn = fields.some((f) => on[f.key]);

  const fallback = (f: BulkField) =>
    f.type === "toggle"
      ? "true"
      : f.type === "select" && f.allowClear === false
        ? f.options?.[0]?.value ?? ""
        : "";

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const patch: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      if (!on[f.key]) continue;
      const raw = (val[f.key] ?? fallback(f)).trim();
      if (f.type === "toggle") {
        patch[f.key] = raw === "true";
      } else if (raw === "") {
        if (f.allowClear === false) continue;
        patch[f.key] = null;
      } else if (f.type === "number") {
        patch[f.key] = Number(raw);
      } else {
        patch[f.key] = raw;
      }
    }
    if (Object.keys(patch).length === 0) return;
    onApply(patch);
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="hint" style={{ marginTop: 0 }}>
          Changes apply to <strong>{count}</strong> selected{" "}
          {count === 1 ? noun : `${noun}s`}. Tick a field to change it — anything
          left unticked stays as it is.
        </p>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label className="check" style={{ margin: "10px 0 0" }}>
              <input
                type="checkbox"
                checked={!!on[f.key]}
                onChange={(e) =>
                  setOn((p) => ({ ...p, [f.key]: e.target.checked }))
                }
              />
              {f.label}
            </label>
            {on[f.key] &&
              (f.type === "select" ? (
                <select
                  value={val[f.key] ?? fallback(f)}
                  onChange={(e) =>
                    setVal((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                >
                  {f.allowClear !== false && <option value="">— clear —</option>}
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "toggle" ? (
                <select
                  value={val[f.key] ?? "true"}
                  onChange={(e) =>
                    setVal((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                >
                  <option value="true">{f.onLabel ?? "Yes"}</option>
                  <option value="false">{f.offLabel ?? "No"}</option>
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={val[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setVal((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                />
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={val[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setVal((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                />
              ))}
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            className="btn outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy || !anyOn}>
            {busy ? "Applying…" : `Apply to ${count}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Small inline mail icon next to an email address — opens a mailto: link. */
export function MailLink({ email }: { email: string }) {
  return (
    <a
      className="mail-inline"
      href={`mailto:${email}`}
      title={`Email ${email}`}
      onClick={(e) => e.stopPropagation()}
    >
      {ROW_ICON.mail}
    </a>
  );
}

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  // BrowserRouter stamps history.state.idx with this tab's position in its
  // own in-app navigation stack (0 on first load) -- lets every page offer a
  // "Back" that returns to wherever the user actually came from (e.g. a
  // notification's deep link) without showing one when there's nowhere to
  // go back to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <div className="topbar">
      <div>
        {canGoBack && (
          <button
            type="button"
            className="link-btn page-back-btn"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
        )}
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="row-actions">{actions}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Could not load data";
  return (
    <div className="empty" style={{ color: "#b3261e" }}>
      {msg}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
