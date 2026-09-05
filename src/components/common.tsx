import type { MouseEvent, ReactNode } from "react";
import { STATUS_LABEL, type QuoteStatus } from "../lib/types";

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
 * Leading Actions cell for list tables: a reserved (currently inert) bulk-select
 * checkbox + View / Edit / Delete / Duplicate icon buttons. Every control stops
 * propagation since these rows are often themselves clickable (opens View).
 */
export function RowActions({
  onMail,
  mailTitle = "Send a message",
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  /** When set, a mail icon is shown first (after the checkbox). */
  onMail?: () => void;
  mailTitle?: string;
  onView: () => void;
  /** Omit for records that can't be edited or duplicated (e.g. a sent campaign). */
  onEdit?: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}) {
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="row-icons">
      <input type="checkbox" onClick={(e) => e.stopPropagation()} />
      {onMail && (
        <button className="row-icon-btn" title={mailTitle} onClick={stop(onMail)}>
          {ROW_ICON.mail}
        </button>
      )}
      <button className="row-icon-btn" title="View" onClick={stop(onView)}>
        {ROW_ICON.view}
      </button>
      {onEdit && (
        <button className="row-icon-btn" title="Edit" onClick={stop(onEdit)}>
          {ROW_ICON.edit}
        </button>
      )}
      <button
        className="row-icon-btn danger"
        title="Delete"
        onClick={stop(onDelete)}
      >
        {ROW_ICON.delete}
      </button>
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

/** Header cell to pair with RowActions: a select-all checkbox + "Actions" label. */
export function RowActionsHead() {
  return (
    <div className="row-icons row-icons-head">
      <input type="checkbox" />
      <span>Actions</span>
    </div>
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
  return (
    <div className="topbar">
      <div>
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
