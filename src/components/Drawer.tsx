import { useEffect, type ReactNode } from "react";

interface DrawerProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Optional row under the title, inside the fixed header. */
  belowTitle?: ReactNode;
}

/** Right-hand slide-in panel. Click the backdrop or press Esc to close. */
export default function Drawer({
  title,
  onClose,
  children,
  belowTitle,
}: DrawerProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {belowTitle && <div className="drawer-subhead">{belowTitle}</div>}
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
