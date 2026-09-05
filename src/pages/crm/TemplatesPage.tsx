import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteMailTemplate,
  useMailTemplates,
  useSaveMailTemplate,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { MailTemplate, MailTemplatePatch } from "../../lib/types";

/** Fills {{ contact.name }} / {{ contact.company }} with sample values for
 *  a quick preview — the real merge happens wherever a template is
 *  actually used to send mail (a later phase). */
function previewMerge(text: string): string {
  return text
    .replaceAll("{{ contact.name }}", "Jane Smith")
    .replaceAll("{{ contact.company }}", "Acme Imports");
}

export default function TemplatesPage() {
  const { data, isLoading, isError, error } = useMailTemplates();
  const save = useSaveMailTemplate();
  const remove = useDeleteMailTemplate();
  const { toast, error: toastError } = useToast();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MailTemplate | "new" | null>(null);
  const [viewing, setViewing] = useState<MailTemplate | null>(null);

  const rows = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q),
    );
  }, [data, search]);

  const current = editing === "new" ? null : editing;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const subject = String(fd.get("subject") || "").trim() || name;
    if (!name) {
      toastError("Template name is required");
      return;
    }
    const patch: MailTemplatePatch = {
      name,
      subject,
      body: String(fd.get("body") || ""),
    };
    try {
      await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        patch,
      });
      setEditing(null);
      toast("Saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(row: MailTemplate) {
    if (!window.confirm(`Remove template "${row.name}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Template removed");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not remove");
    }
  }

  async function onDuplicate(row: MailTemplate) {
    try {
      const created = await save.mutateAsync({
        patch: {
          name: `${row.name} (Copy)`,
          subject: row.subject,
          body: row.body,
        },
      });
      toast("Template duplicated");
      setEditing(created);
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not duplicate");
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{rows.length} template{rows.length === 1 ? "" : "s"}</h2>
            <p>
              Use {"{{ contact.name }}"} and {"{{ contact.company }}"} anywhere in
              the body — they're filled in per recipient wherever a template is
              used to send mail.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <button className="btn" onClick={() => setEditing("new")}>
              + New Template
            </button>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {(data ?? []).length === 0
              ? "No templates yet."
              : "No templates match your search."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Name</th>
                  <th>Subject</th>
                  <th>Last Edited</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <RowActions
                        onView={() => setViewing(t)}
                        onEdit={() => setEditing(t)}
                        onDelete={() => onDelete(t)}
                        onDuplicate={() => onDuplicate(t)}
                      />
                    </td>
                    <td>
                      <strong>{t.name}</strong>
                    </td>
                    <td>{t.subject}</td>
                    <td className="nowrap">{formatDate(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <Modal
          title={viewing.name}
          onClose={() => setViewing(null)}
          wide
          headerActions={
            <button
              className="btn outline"
              onClick={() => {
                setEditing(viewing);
                setViewing(null);
              }}
            >
              Edit
            </button>
          }
        >
          <div className="field">
            <label>Subject</label>
            <strong>{viewing.subject}</strong>
          </div>
          <div className="field">
            <label>Preview (sample recipient: Jane Smith, Acme Imports)</label>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 12,
                whiteSpace: "pre-line",
                background: "#faf9f5",
              }}
            >
              {previewMerge(viewing.body)}
            </div>
          </div>
        </Modal>
      )}

      {editing !== null && (
        <Modal
          title={current ? "Edit Template" : "New Template"}
          onClose={() => setEditing(null)}
          wide
        >
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Template Name</label>
              <input name="name" defaultValue={current?.name ?? ""} autoFocus />
            </div>
            <div className="field">
              <label>Subject (defaults to the template name if left blank)</label>
              <input name="subject" defaultValue={current?.subject ?? ""} />
            </div>
            <div className="field">
              <label>Body — use {"{{ contact.name }}"} / {"{{ contact.company }}"}</label>
              <textarea name="body" rows={12} defaultValue={current?.body ?? ""} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                className="btn outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
