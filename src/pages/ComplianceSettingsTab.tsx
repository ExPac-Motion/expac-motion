// Settings › Compliance (0255): the legal documents partners accept in the
// partner portal. Each kind has versions; drafts are edited here and
// published when ready. A published version is frozen. Publishing a new
// version asks every partner to accept again.
import { useState } from "react";
import Modal from "../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../components/common";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { PARTNER_LABEL } from "../lib/tariff";
import {
  ALL_PARTNER_KINDS,
  COMPLIANCE_KINDS,
  COMPLIANCE_LABEL,
  legalHtml,
  useComplianceDocuments,
  useDeleteComplianceDraft,
  usePublishComplianceDocument,
  useSaveComplianceDocument,
  type ComplianceDocument,
  type ComplianceKind,
} from "../lib/compliance";

type Draft = Pick<ComplianceDocument, "kind" | "version" | "title" | "summary" | "body" | "required_for" | "blocks_portal"> & {
  id?: string;
};

function Editor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const save = useSaveComplianceDocument();
  const { toast, error } = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [preview, setPreview] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function onSave() {
    try {
      await save.mutateAsync(d);
      toast("Draft saved");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Modal
      wide
      title={`${COMPLIANCE_LABEL[d.kind]}, version ${d.version} (draft)`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn outline" onClick={() => setPreview((v) => !v)}>
            {preview ? "Edit text" : "Preview"}
          </button>
          <button type="button" className="btn" disabled={save.isPending || !d.title.trim()} onClick={onSave}>
            {save.isPending ? "Saving…" : "Save draft"}
          </button>
        </>
      }
    >
      <div className="pb-grid">
        <div className="field">
          <label>Title</label>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Short description (shown to partners)</label>
          <input value={d.summary ?? ""} onChange={(e) => set("summary", e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Who must accept it</label>
        <div className="pc-kinds">
          {ALL_PARTNER_KINDS.map((k) => (
            <label key={k} className="pc-agree">
              <input
                type="checkbox"
                checked={d.required_for.includes(k)}
                onChange={(e) =>
                  set("required_for", e.target.checked ? [...d.required_for, k] : d.required_for.filter((x) => x !== k))
                }
              />
              <span>{PARTNER_LABEL[k]}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="pc-agree">
        <input type="checkbox" checked={d.blocks_portal} onChange={(e) => set("blocks_portal", e.target.checked)} />
        <span>
          <b>Required before the partner sees shipments</b> (their portal shows nothing about customers or shipments
          until they accept it)
        </span>
      </label>
      {preview ? (
        <div className="pc-doc pc-doc-preview" dangerouslySetInnerHTML={{ __html: legalHtml(d.body) }} />
      ) : (
        <div className="field">
          <label>Text: start a line with "## " for a heading; leave a blank line between paragraphs</label>
          <textarea className="pc-editor" value={d.body} onChange={(e) => set("body", e.target.value)} rows={22} />
        </div>
      )}
    </Modal>
  );
}

export default function ComplianceSettingsTab() {
  const q = useComplianceDocuments();
  const publish = usePublishComplianceDocument();
  const remove = useDeleteComplianceDraft();
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<ComplianceDocument | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <div className="panel">
        <ErrorNote error={q.error} />
        <p className="hint">Compliance documents need migration 0255 in Supabase.</p>
      </div>
    );

  const rows = q.data ?? [];

  async function onPublish(d: ComplianceDocument) {
    const replaces = rows.some((r) => r.kind === d.kind && r.published_at);
    const msg = replaces
      ? `Publish ${d.title} version ${d.version}? Every partner will be asked to accept it again.${d.blocks_portal ? " Their shipments are hidden until they do." : ""}`
      : `Publish ${d.title} version ${d.version}? Partners will be asked to accept it.${d.blocks_portal ? " Their shipments are hidden until they do." : ""}`;
    if (!window.confirm(msg)) return;
    try {
      await publish.mutateAsync(d.id);
      toast(`${d.title} v${d.version} published`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not publish");
    }
  }

  function newVersion(kind: ComplianceKind) {
    const latest = rows.filter((r) => r.kind === kind).sort((a, b) => b.version - a.version)[0];
    setEditing({
      kind,
      version: (latest?.version ?? 0) + 1,
      title: latest?.title ?? COMPLIANCE_LABEL[kind],
      summary: latest?.summary ?? "",
      body: latest?.body ?? "",
      required_for: latest?.required_for ?? ALL_PARTNER_KINDS,
      blocks_portal: latest?.blocks_portal ?? kind === "nda",
    });
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Partner compliance documents</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        The documents partners accept on the partner portal (click-to-accept with name, title and typed signature).
        Edit a draft, then publish it. A published version can't be changed: create a new version, and every partner is
        asked to accept it again. See who accepted what on each partner's record › Compliance.
      </p>
      {COMPLIANCE_KINDS.map((kind) => {
        const versions = rows.filter((r) => r.kind === kind);
        const current = versions.find((v) => v.published_at);
        const hasDraft = versions.some((v) => !v.published_at);
        return (
          <div key={kind} className="pc-admin-kind">
            <div className="pc-admin-head">
              <div>
                <b>{COMPLIANCE_LABEL[kind]}</b>
                <span className="hint">
                  {current ? ` · live: version ${current.version}, published ${formatDate(current.published_at)}` : " · not published"}
                </span>
              </div>
              {!hasDraft && (
                <button type="button" className="btn outline small" onClick={() => newVersion(kind)}>
                  {versions.length ? "New version" : "Create"}
                </button>
              )}
            </div>
            {versions.length === 0 ? (
              <EmptyState>No document yet.</EmptyState>
            ) : (
              <table className="customs-table">
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td style={{ width: 60 }}>v{v.version}</td>
                      <td>
                        {v.title}
                        {v.blocks_portal && <span className="pc-req">Required</span>}
                        {v.body.startsWith("DRAFT") && <span className="pc-req is-warn">Draft text: legal review</span>}
                      </td>
                      <td>
                        {v.published_at ? (
                          v.id === current?.id ? (
                            <span className="pc-pill is-ok">Live</span>
                          ) : (
                            <span className="hint">Replaced</span>
                          )
                        ) : (
                          <span className="pc-pill is-due">Draft</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {v.published_at ? (
                          <button type="button" className="btn outline small" onClick={() => setViewing(v)}>
                            View
                          </button>
                        ) : (
                          <>
                            <button type="button" className="btn outline small" onClick={() => setEditing(v)}>
                              Edit
                            </button>{" "}
                            <button
                              type="button"
                              className="btn outline small"
                              onClick={async () => {
                                if (!window.confirm(`Delete draft version ${v.version}?`)) return;
                                try {
                                  await remove.mutateAsync(v.id);
                                } catch (e) {
                                  error(e instanceof Error ? e.message : "Could not delete");
                                }
                              }}
                            >
                              Delete
                            </button>{" "}
                            <button type="button" className="btn small" onClick={() => onPublish(v)} disabled={publish.isPending}>
                              Publish
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {editing && <Editor draft={editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <Modal wide title={`${viewing.title}, version ${viewing.version}`} onClose={() => setViewing(null)}>
          <div className="pc-doc pc-doc-preview" dangerouslySetInnerHTML={{ __html: legalHtml(viewing.body) }} />
        </Modal>
      )}
    </div>
  );
}
