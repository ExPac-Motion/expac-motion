import { useEffect, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Roomier dialog for dense content (e.g. the quotation detail view). */
  wide?: boolean;
  /** Buttons / badges shown on the title row, before the close ✕. */
  headerActions?: ReactNode;
  /** Row rendered directly under the title, inside the frozen header. */
  belowHeader?: ReactNode;
  /** Keep the title row (+ headerActions + belowHeader) pinned while the body scrolls. */
  stickyHeader?: boolean;
}

export default function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  headerActions,
  belowHeader,
  stickyHeader,
}: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cls = [
    "modal",
    wide ? "modal--wide" : "",
    stickyHeader ? "modal--stickyhead" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const head = (
    <>
      <div className="modal-head">
        <h3>{title}</h3>
        <div className="modal-head-actions">
          {headerActions}
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      {belowHeader}
    </>
  );

  const body = (
    <>
      {children}
      {footer && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          {footer}
        </div>
      )}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={cls} onClick={(e) => e.stopPropagation()}>
        {stickyHeader ? (
          <>
            <div className="modal-sticky">{head}</div>
            <div className="modal-body">{body}</div>
          </>
        ) : (
          <>
            {head}
            {body}
          </>
        )}
      </div>
    </div>
  );
}
