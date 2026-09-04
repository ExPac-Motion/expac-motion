import { useEffect, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Roomier dialog for dense content (e.g. the quotation detail view). */
  wide?: boolean;
}

export default function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={wide ? "modal modal--wide" : "modal"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
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
      </div>
    </div>
  );
}
