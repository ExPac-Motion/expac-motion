import { useNavigate } from "react-router-dom";

/**
 * The one "← Back" control used everywhere (page headers, record pages,
 * print toolbars). Teal outline secondary button. With no onClick it goes
 * one step back in history.
 *   size "md"      = .btn (default; same size as the CTAs beside it)
 *   size "sm"      = .btn-sm (next to other small controls)
 *   size "compact" = the small pill above a page title (PageHeader)
 */
export default function BackButton({
  label = "Back",
  onClick,
  size = "md",
  disabled,
  className,
}: {
  label?: string;
  onClick?: () => void;
  size?: "md" | "sm" | "compact";
  disabled?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const cls = [
    "btn outline back-btn",
    size === "sm" && "btn-sm",
    size === "compact" && "back-btn-compact",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick ?? (() => navigate(-1))}
      disabled={disabled}
    >
      <span className="back-btn-arrow" aria-hidden="true">
        ←
      </span>
      {label}
    </button>
  );
}
