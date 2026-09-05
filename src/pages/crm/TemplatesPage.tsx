import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Modal from "../../components/Modal";
import RichTextEditor from "../../components/RichTextEditor";
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
  useUploadMailAsset,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type {
  MailTemplate,
  MailTemplateAttachment,
  MailTemplatePatch,
} from "../../lib/types";

/** Fills {{ contact.name }} / {{ contact.company }} / the unsubscribe
 *  link with sample values for a quick preview — the real merge happens
 *  wherever a template is actually used to send mail (a later phase). */
function previewMerge(html: string): string {
  return html
    .replaceAll("{{ contact.name }}", "Jane Smith")
    .replaceAll("{{ contact.company }}", "Acme Imports")
    .replaceAll("{{ unsubscribe_link }}", "#");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: MailTemplateAttachment[];
  onRemove?: (url: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-list">
      {attachments.map((a) =>
        onRemove ? (
          <span key={a.url} className="attach-chip">
            📎 {a.name}{" "}
            <span style={{ color: "var(--muted)" }}>{formatBytes(a.size)}</span>
            <button type="button" title="Remove attachment" onClick={() => onRemove(a.url)}>
              ×
            </button>
          </span>
        ) : (
          <a key={a.url} className="attach-chip" href={a.url} target="_blank" rel="noreferrer">
            📎 {a.name}{" "}
            <span style={{ color: "var(--muted)" }}>{formatBytes(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

/** Fresh-mounted per template (keyed by id/"new" in the parent) so its
 *  body/attachments state initializes directly from props with no effect. */
function TemplateEditForm({
  template,
  onCancel,
  onSave,
  saving,
}: {
  template: MailTemplate | null;
  onCancel: () => void;
  onSave: (patch: MailTemplatePatch) => void;
  saving: boolean;
}) {
  const uploadAsset = useUploadMailAsset();
  const { error: toastError } = useToast();
  const [bodyHtml, setBodyHtml] = useState(template?.body ?? "");
  const [attachments, setAttachments] = useState<MailTemplateAttachment[]>(
    template?.attachments ?? [],
  );
  const [attaching, setAttaching] = useState(false);

  async function onAttachFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttaching(true);
    try {
      const asset = await uploadAsset.mutateAsync(file);
      setAttachments((prev) => [...prev, asset]);
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not attach file");
    } finally {
      setAttaching(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const subject = String(fd.get("subject") || "").trim() || name;
    if (!name) {
      toastError("Template name is required");
      return;
    }
    onSave({ name, subject, body: bodyHtml, attachments });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Template Name</label>
        <input name="name" defaultValue={template?.name ?? ""} autoFocus />
      </div>
      <div className="field">
        <label>Subject (defaults to the template name if left blank)</label>
        <input name="subject" defaultValue={template?.subject ?? ""} />
      </div>
      <div className="field">
        <label>Body</label>
        <RichTextEditor
          value={bodyHtml}
          onChange={setBodyHtml}
          onUploadImage={(file) => uploadAsset.mutateAsync(file)}
          trailing={
            <>
              <span className="rte-label">Attachments</span>
              <AttachmentList
                attachments={attachments}
                onRemove={(url) =>
                  setAttachments((prev) => prev.filter((a) => a.url !== url))
                }
              />
              <label className="btn outline btn-sm">
                {attaching ? "Uploading…" : "📎 Attach a file"}
                <input type="file" hidden disabled={attaching} onChange={onAttachFile} />
              </label>
              <span className="rte-sep" />
              <button type="button" className="btn outline btn-sm" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        />
      </div>
    </form>
  );
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

  async function onSave(patch: MailTemplatePatch) {
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
          attachments: row.attachments,
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
                background: "#faf9f5",
              }}
              dangerouslySetInnerHTML={{ __html: previewMerge(viewing.body) }}
            />
          </div>
          {viewing.attachments.length > 0 && (
            <div className="field">
              <label>Attachments</label>
              <AttachmentList attachments={viewing.attachments} />
            </div>
          )}
        </Modal>
      )}

      {editing !== null && (
        <Modal
          title={current ? "Edit Template" : "New Template"}
          onClose={() => setEditing(null)}
          wide
        >
          <TemplateEditForm
            key={current?.id ?? "new"}
            template={current}
            onCancel={() => setEditing(null)}
            onSave={onSave}
            saving={save.isPending}
          />
        </Modal>
      )}
    </>
  );
}
