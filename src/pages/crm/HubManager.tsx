// CRM › Media › Information Hub (0252): what the customer and partner
// portals show on their Information Hub. Upload a PDF or image (plus an
// optional cover), choose who sees it, publish / unpublish, reorder.
import { useRef, useState } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  AUDIENCE_LABEL,
  HUB_TAGS,
  uploadHubFile,
  useDeleteHubItem,
  useHubItems,
  useSaveHubItem,
  type HubAudience,
  type HubItem,
} from "../../lib/hub";

export default function HubManager() {
  const q = useHubItems();
  const save = useSaveHubItem();
  const del = useDeleteHubItem();
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<HubItem | "new" | null>(null);
  const items = q.data ?? [];

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="ph-head">
        <h3>Information Hub</h3>
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          + Add to Hub
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Manuals, presentations and marketing content on the customer and partner portals&apos; Information Hub. Pick who
        sees each item.
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <>
          <ErrorNote error={q.error} />
          <p className="hint">The Information Hub needs migration 0252 in Supabase.</p>
        </>
      ) : items.length === 0 ? (
        <EmptyState>Nothing on the Hub yet.</EmptyState>
      ) : (
        <table className="customs-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Title</th>
              <th>Type</th>
              <th>Who sees it</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id}>
                <td>{h.sort}</td>
                <td>
                  <a href={h.file_url} target="_blank" rel="noreferrer">
                    <b>{h.title}</b>
                  </a>
                  {h.description && <div className="hint">{h.description.slice(0, 90)}</div>}
                </td>
                <td>{h.tag}</td>
                <td>{AUDIENCE_LABEL[h.audience]}</td>
                <td>
                  <button
                    type="button"
                    className={`btn small outline${h.published ? "" : " warn"}`}
                    onClick={() =>
                      save.mutate(
                        { id: h.id, values: { published: !h.published } },
                        { onSuccess: () => toast(h.published ? "Hidden from the portals" : "Published"), onError: (e) => error(e.message) },
                      )
                    }
                  >
                    {h.published ? "Published" : "Hidden"}
                  </button>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="btn small outline" onClick={() => setEditing(h)}>
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    className="btn small ghost"
                    title="Remove from the Hub"
                    onClick={() => {
                      if (!window.confirm(`Remove "${h.title}" from the Information Hub?`)) return;
                      del.mutate(h.id, { onSuccess: () => toast("Removed"), onError: (e) => error(e.message) });
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <HubItemModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HubItemModal({ item, onClose }: { item: HubItem | null; onClose: () => void }) {
  const save = useSaveHubItem();
  const { toast, error } = useToast();
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [tag, setTag] = useState(item?.tag ?? "Marketing");
  const [audience, setAudience] = useState<HubAudience>(item?.audience ?? "partners");
  const [sort, setSort] = useState(String(item?.sort ?? 100));
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!title.trim()) return error("Give it a title");
    if (!item && !file) return error("Choose the file to publish");
    setBusy(true);
    try {
      const file_url = file ? await uploadHubFile(file) : item!.file_url;
      const cover_url = cover ? await uploadHubFile(cover) : (item?.cover_url ?? null);
      const isImage = file ? file.type.startsWith("image/") : item?.kind === "image";
      const meta = file
        ? `${isImage ? "Image" : (file.name.split(".").pop() ?? "File").toUpperCase()} · ${(file.size / 1024 / 1024).toFixed(1)} MB`
        : (item?.meta ?? null);
      await save.mutateAsync({
        id: item?.id,
        values: {
          title: title.trim(),
          description: description.trim() || null,
          tag,
          audience,
          sort: Number(sort) || 100,
          kind: isImage ? "image" : "file",
          file_url,
          cover_url,
          meta,
        },
      });
      toast(item ? "Hub item saved" : "Added to the Information Hub");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? "Edit Hub item" : "Add to the Information Hub"} onClose={onClose}>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="pi-form">
        <div className="field">
          <label>Type</label>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            {HUB_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Who sees it</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as HubAudience)}>
            {(Object.keys(AUDIENCE_LABEL) as HubAudience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Order (lower first)</label>
          <input type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>File (PDF or image)</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn outline" onClick={() => fileRef.current?.click()}>
            {file || item ? "Replace file" : "Choose file"}
          </button>
          <span className="hint">{file ? file.name : item ? "Current file kept" : "Up to 50 MB"}</span>
          <input ref={fileRef} type="file" hidden accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="field">
        <label>Cover image (optional, shown on the card)</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn outline" onClick={() => coverRef.current?.click()}>
            {cover || item?.cover_url ? "Replace cover" : "Choose cover"}
          </button>
          <span className="hint">{cover ? cover.name : item?.cover_url ? "Current cover kept" : "An image's own picture is used if blank"}</span>
          <input ref={coverRef} type="file" hidden accept="image/*" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : item ? "Save" : "Publish"}
        </button>
      </div>
    </Modal>
  );
}
