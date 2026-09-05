import { useMemo, useState } from "react";
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
  useDeleteWebForm,
  useSaveWebForm,
  useWebFormSubmissions,
  useWebForms,
} from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import {
  WEB_FORM_FIELD_MAPS,
  WEB_FORM_FIELD_TYPES,
  type WebForm,
  type WebFormField,
  type WebFormFieldType,
  type WebFormPatch,
} from "../../lib/types";

const SITE_URL = "https://expac-motion.pages.dev";

function newField(type: WebFormFieldType): WebFormField {
  const id = `f_${Math.random().toString(36).slice(2, 8)}`;
  const base: WebFormField = { id, type, label: "", required: false, mapTo: "none" };
  if (type === "text") return { ...base, label: "Full Name", mapTo: "contact" };
  if (type === "email")
    return { ...base, label: "Email Address", mapTo: "email", required: true };
  if (type === "phone") return { ...base, label: "Phone Number", mapTo: "phone" };
  if (type === "textarea") return { ...base, label: "Message", mapTo: "notes" };
  return { ...base, label: "Choose one", choices: ["Option 1", "Option 2"], mapTo: "notes" };
}

const STARTER_FIELDS: WebFormField[] = [
  { id: "f_name", type: "text", label: "Full Name", required: true, mapTo: "contact" },
  { id: "f_company", type: "text", label: "Company Name", required: false, mapTo: "company" },
  { id: "f_phone", type: "phone", label: "Phone Number", required: false, mapTo: "phone" },
  { id: "f_email", type: "email", label: "Email Address", required: true, mapTo: "email" },
  {
    id: "f_enquiry",
    type: "textarea",
    label: "Shipping Enquiry",
    required: false,
    mapTo: "notes",
  },
];

/* --------------------------------- editor --------------------------------- */

function FieldPreview({ f }: { f: WebFormField }) {
  return (
    <div className="field">
      <label>
        {f.label || "Untitled"}
        {f.required && <span className="wf-req"> *</span>}
      </label>
      {f.type === "textarea" ? (
        <textarea rows={3} placeholder={f.placeholder ?? ""} disabled />
      ) : f.type === "dropdown" ? (
        <select disabled>
          <option>Choose an option</option>
        </select>
      ) : (
        <input placeholder={f.placeholder ?? ""} disabled />
      )}
    </div>
  );
}

function FormEditor({
  form,
  onBack,
}: {
  form: WebForm;
  onBack: () => void;
}) {
  const save = useSaveWebForm();
  const { toast, error: toastError } = useToast();
  const [tab, setTab] = useState<"builder" | "settings" | "share">("builder");
  const [draft, setDraft] = useState<WebForm>(form);
  const [selected, setSelected] = useState<string | null>(
    form.fields[0]?.id ?? null,
  );
  const [copied, setCopied] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(form);
  const set = <K extends keyof WebForm>(k: K, v: WebForm[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  function patchField(id: string, patch: Partial<WebFormField>) {
    set(
      "fields",
      draft.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  }
  function addField(type: WebFormFieldType) {
    const f = newField(type);
    set("fields", [...draft.fields, f]);
    setSelected(f.id);
  }
  function removeField(id: string) {
    set("fields", draft.fields.filter((f) => f.id !== id));
    if (selected === id) setSelected(null);
  }
  function moveField(id: string, dir: -1 | 1) {
    const i = draft.fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= draft.fields.length) return;
    const next = [...draft.fields];
    [next[i], next[j]] = [next[j], next[i]];
    set("fields", next);
  }

  async function onSave() {
    const patch: WebFormPatch = {
      name: draft.name,
      heading: draft.heading,
      subtitle: draft.subtitle,
      fields: draft.fields,
      submit_label: draft.submit_label,
      thankyou_title: draft.thankyou_title,
      thankyou_body: draft.thankyou_body,
      notify_email: draft.notify_email,
      track_url_params: draft.track_url_params,
      active: draft.active,
    };
    try {
      const updated = await save.mutateAsync({ id: draft.id, patch });
      setDraft(updated);
      toast("Form saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    }
  }

  function back() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onBack();
  }

  const sel = draft.fields.find((f) => f.id === selected) ?? null;
  const hostedUrl = `${SITE_URL}/forms/${draft.id}`;
  const embedCode = `<iframe src="${hostedUrl}?embed=1" style="width:100%;max-width:640px;height:820px;border:0" title="${draft.name}"></iframe>`;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toastError("Couldn't copy");
    }
  }

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn outline btn-sm" onClick={back}>
            ← Forms
          </button>
          <input
            className="wf-name-input"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
          {dirty && <span className="tag">Unsaved</span>}
        </div>
        <button className="btn" onClick={onSave} disabled={save.isPending || !dirty}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="wf-tabs">
        {(["builder", "settings", "share"] as const).map((t) => (
          <button
            key={t}
            className={`wf-tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "builder" && (
        <div className="wf-builder">
          <div className="panel wf-preview">
            <h2>{draft.heading || "Contact Us"}</h2>
            {draft.subtitle && <p className="muted">{draft.subtitle}</p>}
            {draft.fields.map((f) => (
              <button
                key={f.id}
                className={`wf-fieldwrap${selected === f.id ? " sel" : ""}`}
                onClick={() => {
                  setSelected(f.id);
                  setTab("builder");
                }}
              >
                <FieldPreview f={f} />
              </button>
            ))}
            <div className="btn wf-submit" aria-hidden>
              {draft.submit_label || "Submit"}
            </div>
            <div className="wf-thanks-preview">
              <strong>{draft.thankyou_title}</strong>
              <span>{draft.thankyou_body}</span>
            </div>
          </div>

          <div className="panel wf-inspect">
            {sel ? (
              <>
                <div className="field">
                  <label>Field type</label>
                  <select
                    value={sel.type}
                    onChange={(e) =>
                      patchField(sel.id, {
                        type: e.target.value as WebFormFieldType,
                        choices:
                          e.target.value === "dropdown"
                            ? sel.choices ?? ["Option 1", "Option 2"]
                            : undefined,
                      })
                    }
                  >
                    {WEB_FORM_FIELD_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Label</label>
                  <input
                    value={sel.label}
                    onChange={(e) => patchField(sel.id, { label: e.target.value })}
                  />
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={sel.required}
                    onChange={(e) =>
                      patchField(sel.id, { required: e.target.checked })
                    }
                  />
                  Required
                </label>
                <div className="field">
                  <label>Placeholder</label>
                  <input
                    value={sel.placeholder ?? ""}
                    onChange={(e) =>
                      patchField(sel.id, { placeholder: e.target.value })
                    }
                  />
                </div>
                {sel.type === "dropdown" && (
                  <div className="field">
                    <label>Choices (one per line)</label>
                    <textarea
                      rows={4}
                      value={(sel.choices ?? []).join("\n")}
                      onChange={(e) =>
                        patchField(sel.id, {
                          choices: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                )}
                <div className="field">
                  <label>Map to Lead field</label>
                  <select
                    value={sel.mapTo}
                    onChange={(e) =>
                      patchField(sel.id, {
                        mapTo: e.target.value as WebFormField["mapTo"],
                      })
                    }
                  >
                    {WEB_FORM_FIELD_MAPS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Where this answer lands on the new Lead record.
                  </span>
                </div>
                <div className="wf-field-actions">
                  <button
                    className="btn outline btn-sm"
                    onClick={() => moveField(sel.id, -1)}
                  >
                    ↑ Up
                  </button>
                  <button
                    className="btn outline btn-sm"
                    onClick={() => moveField(sel.id, 1)}
                  >
                    ↓ Down
                  </button>
                  <button
                    className="btn outline btn-sm"
                    onClick={() => removeField(sel.id)}
                  >
                    Delete field
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Select a field on the left to edit it.</p>
            )}

            <hr className="wf-hr" />
            <div className="field">
              <label>Add a field</label>
              <div className="wf-add-row">
                {WEB_FORM_FIELD_TYPES.map((t) => (
                  <button
                    key={t.type}
                    className="btn outline btn-sm"
                    onClick={() => addField(t.type)}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>

            <hr className="wf-hr" />
            <div className="field">
              <label>Form heading</label>
              <input
                value={draft.heading}
                onChange={(e) => set("heading", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Sub-heading</label>
              <input
                value={draft.subtitle}
                onChange={(e) => set("subtitle", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Submit button label</label>
              <input
                value={draft.submit_label}
                onChange={(e) => set("submit_label", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Thank-you title</label>
              <input
                value={draft.thankyou_title}
                onChange={(e) => set("thankyou_title", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Thank-you message</label>
              <textarea
                rows={2}
                value={draft.thankyou_body}
                onChange={(e) => set("thankyou_body", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <div className="field">
            <label>Email notification for form submissions (optional)</label>
            <input
              type="email"
              placeholder="sales@expac.co.za"
              value={draft.notify_email ?? ""}
              onChange={(e) => set("notify_email", e.target.value || null)}
            />
            <span className="hint">
              Emailed on every submission via the same sender the campaigns use.
            </span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.track_url_params}
              onChange={(e) => set("track_url_params", e.target.checked)}
            />
            Track URL parameters (utm_campaign, utm_medium, gclid, …) on the
            submission
          </label>
          <hr className="wf-hr" />
          <label className="check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            Form is live (accepting submissions)
          </label>
        </div>
      )}

      {tab === "share" && (
        <div className="panel" style={{ maxWidth: 680 }}>
          {dirty && (
            <div className="wf-err" style={{ background: "#fdf6e3", color: "#8a6d00" }}>
              You have unsaved changes — Save first so the shared form matches.
            </div>
          )}
          <div className="field">
            <label>Share link</label>
            <div className="wf-copy-row">
              <input readOnly value={hostedUrl} />
              <button
                className="btn outline btn-sm"
                onClick={() => copy(hostedUrl, "link")}
              >
                {copied === "link" ? "Copied" : "Copy"}
              </button>
            </div>
            <span className="hint">Send this to anyone, or link it from your site.</span>
          </div>
          <div className="field">
            <label>Embed code</label>
            <textarea readOnly rows={3} value={embedCode} />
            <div className="wf-copy-row" style={{ marginTop: 6 }}>
              <button
                className="btn outline btn-sm"
                onClick={() => copy(embedCode, "embed")}
              >
                {copied === "embed" ? "Copied" : "Copy code"}
              </button>
            </div>
            <span className="hint">
              Paste this into your website's contact page.
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------- list + tab ------------------------------- */

function SubmissionsModal({
  form,
  onClose,
}: {
  form: WebForm;
  onClose: () => void;
}) {
  const { data, isLoading } = useWebFormSubmissions(form.id);
  const rows = data ?? [];
  return (
    <Modal title={`${form.name} — submissions`} onClose={onClose} wide>
      {isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No submissions yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th>When</th>
                <th>Answers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{formatDateTime(s.created_at)}</td>
                  <td>
                    {Object.entries(s.data).map(([k, v]) => (
                      <div key={k} className="hint">
                        {v}
                      </div>
                    ))}
                    {Object.keys(s.utm).length > 0 && (
                      <div className="hint" style={{ color: "var(--green-dark)" }}>
                        {Object.entries(s.utm)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function FormsPage() {
  const { data, isLoading, isError, error } = useWebForms();
  const save = useSaveWebForm();
  const remove = useDeleteWebForm();
  const { toast, error: toastError } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [submissionsFor, setSubmissionsFor] = useState<WebForm | null>(null);

  const forms = useMemo(() => data ?? [], [data]);
  const editing = useMemo(
    () => forms.find((f) => f.id === editingId) ?? null,
    [forms, editingId],
  );

  async function onNew() {
    try {
      const created = await save.mutateAsync({
        patch: {
          name: "Contact Us",
          heading: "Contact Us",
          subtitle: "Our support team will be in touch shortly.",
          fields: STARTER_FIELDS,
        },
      });
      setEditingId(created.id);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not create");
    }
  }

  async function onDelete(row: WebForm) {
    if (!window.confirm(`Delete form "${row.name}"? Submissions are kept.`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Form deleted");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function onDuplicate(row: WebForm) {
    try {
      const created = await save.mutateAsync({
        patch: {
          name: `${row.name} (Copy)`,
          heading: row.heading,
          subtitle: row.subtitle,
          fields: row.fields,
          submit_label: row.submit_label,
          thankyou_title: row.thankyou_title,
          thankyou_body: row.thankyou_body,
          track_url_params: row.track_url_params,
        },
      });
      toast("Form duplicated");
      setEditingId(created.id);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not duplicate");
    }
  }

  if (editing) {
    return <FormEditor form={editing} onBack={() => setEditingId(null)} />;
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{forms.length} form{forms.length === 1 ? "" : "s"}</h2>
            <p>
              Build a contact form, embed it on your website. A submission
              creates a Lead and raises a task so the team sees the new sign-up.
            </p>
          </div>
          <button className="btn" onClick={onNew} disabled={save.isPending}>
            + New Form
          </button>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : forms.length === 0 ? (
          <EmptyState>No forms yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Name</th>
                  <th>Fields</th>
                  <th>Live</th>
                  <th>Submissions</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <RowActions
                        onEdit={() => setEditingId(f.id)}
                        onDelete={() => onDelete(f)}
                        onDuplicate={() => onDuplicate(f)}
                      />
                    </td>
                    <td>
                      <strong>{f.name}</strong>
                    </td>
                    <td>{f.fields.length}</td>
                    <td>
                      {f.active ? (
                        <span className="ms-tag tone-done">live</span>
                      ) : (
                        <span className="ms-tag tone-start">off</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn ghost small"
                        onClick={() => setSubmissionsFor(f)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {submissionsFor && (
        <SubmissionsModal
          form={submissionsFor}
          onClose={() => setSubmissionsFor(null)}
        />
      )}
    </>
  );
}
