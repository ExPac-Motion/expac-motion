import type { ReactNode } from "react";
import Modal from "./Modal";
import { PageHeader } from "./common";

/**
 * The same record view as a full page (its own address, header and Back
 * button) or as a pop-up. Record screens use the page; quick "New ..."
 * dialogs keep the pop-up. Takes Modal's props, plus the page's eyebrow.
 */
export default function PageOrModal({
  page,
  eyebrow,
  backLabel = "Back",
  title,
  onClose,
  headerActions,
  belowHeader,
  footer,
  wide,
  stickyHeader,
  children,
}: {
  page?: boolean;
  eyebrow?: string;
  backLabel?: string;
  title: string;
  onClose: () => void;
  headerActions?: ReactNode;
  belowHeader?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  stickyHeader?: boolean;
  children: ReactNode;
}) {
  if (!page) {
    return (
      <Modal
        title={title}
        onClose={onClose}
        headerActions={headerActions}
        belowHeader={belowHeader}
        footer={footer}
        wide={wide}
        stickyHeader={stickyHeader}
      >
        {children}
      </Modal>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow={eyebrow ?? ""}
        title={title}
        actions={
          <>
            <button className="btn outline" onClick={onClose}>
              ← {backLabel}
            </button>
            {headerActions}
          </>
        }
      />
      {belowHeader}
      <div className="panel ws-panel record-page">
        {children}
        {footer && <div className="record-page-foot">{footer}</div>}
      </div>
    </>
  );
}
