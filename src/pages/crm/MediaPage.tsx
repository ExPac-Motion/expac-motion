import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageTools } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCreateMediaFolder,
  useDeleteMediaAsset,
  useDeleteMediaFolder,
  useMediaAssets,
  useMediaFolders,
  useMoveMediaAsset,
  useRenameMediaAsset,
  useRenameMediaFolder,
  useUploadMediaAsset,
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { MediaAsset } from "../../lib/types";

const ALL = "All media";
const DEFAULT_FOLDER = "General";

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------- rename modal ------------------------------ */

function RenameModal({
  asset,
  onClose,
  onSave,
  saving,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (name) onSave(name);
  }
  return (
    <Modal title="Rename image" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Display name</label>
          <input name="name" defaultValue={asset.name} autoFocus />
          <span className="hint">
            Only the label in this gallery changes — the image URL stays the same.
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- page --------------------------------- */

export default function MediaPage() {
  const { data, isLoading, isError, error } = useMediaAssets();
  const foldersQ = useMediaFolders();
  const upload = useUploadMediaAsset();
  const remove = useDeleteMediaAsset();
  const rename = useRenameMediaAsset();
  const move = useMoveMediaAsset();
  const createFolder = useCreateMediaFolder();
  const renameFolder = useRenameMediaFolder();
  const deleteFolder = useDeleteMediaFolder();
  const { toast, error: toastError } = useToast();
  // Customer portal "What's new" (portal_announcements, 0092): an image posted from here.
  const annQ = useAnnouncements();
  const createAnn = useCreateAnnouncement();
  const updateAnn = useUpdateAnnouncement();
  const deleteAnn = useDeleteAnnouncement();
  const [posting, setPosting] = useState<MediaAsset | null>(null);
  const onPortal = useMemo(() => new Set((annQ.data ?? []).map((x) => x.image_url)), [annQ.data]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<string>(ALL);
  const [renaming, setRenaming] = useState<MediaAsset | null>(null);
  const [viewingImage, setViewingImage] = useState<MediaAsset | null>(null);
  const [copied, setCopied] = useState<string>("");
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("media.view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  function pickView(v: "grid" | "list") {
    setView(v);
    try {
      localStorage.setItem("media.view", v);
    } catch {
      /* private mode — non-fatal */
    }
  }

  const assets = useMemo(() => data ?? [], [data]);
  const savedFolders = useMemo(() => foldersQ.data ?? [], [foldersQ.data]);

  const folders = useMemo(() => {
    const set = new Set<string>([DEFAULT_FOLDER, ...savedFolders.map((f) => f.name)]);
    for (const a of assets) set.add(a.folder || DEFAULT_FOLDER);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets, savedFolders]);

  const countFor = (name: string) =>
    assets.filter((a) => (a.folder || DEFAULT_FOLDER) === name).length;

  const shown =
    folder === ALL
      ? assets
      : assets.filter((a) => (a.folder || DEFAULT_FOLDER) === folder);

  const uploadFolder = folder === ALL ? DEFAULT_FOLDER : folder;

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    let ok = 0;
    for (const file of files) {
      try {
        await upload.mutateAsync({ file, folder: uploadFolder });
        ok += 1;
      } catch (err) {
        toastError(err instanceof Error ? err.message : `Could not upload ${file.name}`);
      }
    }
    if (ok > 0) toast(`Uploaded ${ok} image${ok === 1 ? "" : "s"} to ${uploadFolder}`);
  }

  async function onNewFolder() {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    try {
      if (!folders.includes(name)) await createFolder.mutateAsync(name);
      setFolder(name);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not create folder");
    }
  }

  async function onRenameFolder(name: string) {
    if (name === DEFAULT_FOLDER) return;
    const next = window.prompt("Rename folder to…", name)?.trim();
    if (!next || next === name) return;
    try {
      await renameFolder.mutateAsync({ oldName: name, newName: next });
      if (folder === name) setFolder(next);
      toast(`Folder renamed to "${next}"`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not rename folder");
    }
  }

  async function onDeleteFolder(name: string) {
    if (name === DEFAULT_FOLDER) return;
    const inFolder = assets.filter(
      (a) => (a.folder || DEFAULT_FOLDER) === name,
    );
    const msg = inFolder.length
      ? `Delete folder "${name}"? Its ${inFolder.length} image${
          inFolder.length === 1 ? "" : "s"
        } will be moved to ${DEFAULT_FOLDER}.`
      : `Delete empty folder "${name}"?`;
    if (!window.confirm(msg)) return;
    try {
      for (const a of inFolder) {
        await move.mutateAsync({ id: a.id, folder: DEFAULT_FOLDER });
      }
      await deleteFolder.mutateAsync(name);
      setFolder(ALL);
      toast(
        inFolder.length
          ? `Folder deleted — ${inFolder.length} image${
              inFolder.length === 1 ? "" : "s"
            } moved to ${DEFAULT_FOLDER}`
          : "Folder deleted",
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not delete folder");
    }
  }

  async function onDelete(a: MediaAsset) {
    if (!window.confirm(`Delete "${a.name}"? This removes the image file too.`)) return;
    try {
      await remove.mutateAsync(a.id);
      toast("Image deleted");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function onCopy(a: MediaAsset) {
    try {
      await navigator.clipboard.writeText(a.url);
      setCopied(a.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toastError("Couldn't copy the URL");
    }
  }

  async function onRename(name: string) {
    if (!renaming) return;
    try {
      await rename.mutateAsync({ id: renaming.id, name });
      setRenaming(null);
      toast("Renamed");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  async function onMove(a: MediaAsset, dest: string) {
    if ((a.folder || DEFAULT_FOLDER) === dest) return;
    try {
      await move.mutateAsync({ id: a.id, folder: dest });
      toast(`Moved to ${dest}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not move");
    }
  }

  async function onMoveToNewFolder(a: MediaAsset) {
    const name = window.prompt("Move to a new folder named…")?.trim();
    if (!name) return;
    try {
      if (!folders.includes(name)) await createFolder.mutateAsync(name);
      await onMove(a, name);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not create folder");
    }
  }

  return (
    <div className="media-wrap">
      <PageTools
        count={
          isLoading
            ? undefined
            : `${shown.length} image${shown.length === 1 ? "" : "s"} · ${folder === ALL ? "All media" : folder}`
        }
        hint={`Reusable images for campaigns and templates. Uploads land in ${uploadFolder}.`}
        primary={
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
        }
      >
        <div className="media-viewtoggle" role="group" aria-label="View">
          <button
            type="button"
            className={`chip${view === "grid" ? " on" : ""}`}
            onClick={() => pickView("grid")}
            title="Grid view"
          >
            Grid
          </button>
          <button
            type="button"
            className={`chip${view === "list" ? " on" : ""}`}
            onClick={() => pickView("list")}
            title="List view"
          >
            List
          </button>
        </div>
      </PageTools>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onFiles}
      />
      <aside className="media-rail panel">
        <div className="media-rail-head">Folders</div>
        <button
          className={`media-folder${folder === ALL ? " active" : ""}`}
          onClick={() => setFolder(ALL)}
        >
          <span>{ALL}</span>
          <span className="media-folder-count">{assets.length}</span>
        </button>
        {folders.map((f) => (
          <button
            key={f}
            className={`media-folder${folder === f ? " active" : ""}`}
            onClick={() => setFolder(f)}
          >
            <span>{f}</span>
            <span className="media-folder-count">{countFor(f)}</span>
            {f !== DEFAULT_FOLDER && (
              <>
                <span
                  className="media-folder-edit"
                  role="button"
                  tabIndex={-1}
                  title={`Rename folder "${f}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameFolder(f);
                  }}
                >
                  ✎
                </span>
                <span
                  className="media-folder-del"
                  role="button"
                  tabIndex={-1}
                  title={`Delete folder "${f}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFolder(f);
                  }}
                >
                  ✕
                </span>
              </>
            )}
          </button>
        ))}
        <button className="btn outline btn-sm media-newfolder" onClick={onNewFolder}>
          + New folder
        </button>
        <div className="media-rail-head" style={{ marginTop: 18 }}>
          Customer portal — What's new
        </div>
        {(annQ.data ?? []).length === 0 ? (
          <p className="hint" style={{ margin: "4px 8px" }}>
            Nothing posted. Use "Post to portal" on an image.
          </p>
        ) : (
          (annQ.data ?? []).map((x) => (
            <div key={x.id} className="media-ann">
              <span className={x.published ? "on" : undefined} title={x.published ? "Showing on the portal" : "Hidden"}>
                {x.title}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => updateAnn.mutate({ id: x.id, patch: { published: !x.published } }, { onError: (e) => toastError(e.message) })}
              >
                {x.published ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  if (confirm("Remove " + x.title + " from the portal?")) deleteAnn.mutate(x.id, { onError: (e) => toastError(e.message) });
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </aside>

      <section className="media-main panel">

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : shown.length === 0 ? (
          <EmptyState>
            {assets.length === 0
              ? "No images yet — upload one to get started."
              : "This folder is empty. Upload an image or pick another folder."}
          </EmptyState>
        ) : (
          <div className={`media-grid${view === "list" ? " is-list" : ""}`}>
            {shown.map((a) => (
              <figure key={a.id} className="media-card">
                <button
                  type="button"
                  className="media-thumb"
                  onClick={() => setViewingImage(a)}
                  title="View full size"
                >
                  <img src={a.url} alt={a.name} loading="lazy" />
                </button>
                <figcaption>
                  <span className="media-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="media-meta">
                    {a.folder}
                    {a.size_bytes != null ? ` · ${formatBytes(a.size_bytes)}` : ""} ·{" "}
                    {formatDate(a.created_at)}
                  </span>
                  <div className="media-actions">
                    <select
                      className="media-move"
                      title="Move to folder"
                      value={a.folder || DEFAULT_FOLDER}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new") onMoveToNewFolder(a);
                        else onMove(a, v);
                      }}
                      disabled={move.isPending}
                    >
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {(a.folder || DEFAULT_FOLDER) === f ? `📁 ${f}` : `Move to ${f}`}
                        </option>
                      ))}
                      <option value="__new">＋ New folder…</option>
                    </select>
                    <button className="btn ghost small" onClick={() => onCopy(a)}>
                      {copied === a.id ? "Copied" : "Copy URL"}
                    </button>
                    <button className="btn ghost small" onClick={() => setRenaming(a)}>
                      Rename
                    </button>
                    <button className="btn ghost small" onClick={() => setPosting(a)} title="Show this image on the customer portal dashboard (What's new)">
                      {onPortal.has(a.url) ? "On portal ✓" : "Post to portal"}
                    </button>
                    <button
                      className="btn ghost small danger"
                      onClick={() => onDelete(a)}
                    >
                      Delete
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {posting && (
        <Modal title="Post to the customer portal" onClose={() => setPosting(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const title = String(fd.get("title") ?? "").trim();
              if (!title) return toastError("Give it a title");
              createAnn.mutate(
                { title, body: String(fd.get("body") ?? ""), image_url: posting.url },
                {
                  onSuccess: () => {
                    toast("Posted — it shows on every customer's portal dashboard");
                    setPosting(null);
                  },
                  onError: (er) => toastError(er.message),
                },
              );
            }}
          >
            <img src={posting.url} alt={posting.name} style={{ width: "100%", borderRadius: 8, maxHeight: 240, objectFit: "cover" }} />
            <div className="field">
              <label>Title</label>
              <input name="title" defaultValue={posting.name.replace(/\.[a-z0-9]+$/i, "")} autoFocus />
            </div>
            <div className="field">
              <label>What's new (short text)</label>
              <textarea name="body" rows={3} placeholder="e.g. New weekly LCL consolidation Shanghai → Durban" />
            </div>
            <div className="modal-foot-row">
              <button type="button" className="btn outline" onClick={() => setPosting(null)}>
                Cancel
              </button>
              <button className="btn" disabled={createAnn.isPending}>
                {createAnn.isPending ? "Posting…" : "Post to portal"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {renaming && (
        <RenameModal
          asset={renaming}
          onClose={() => setRenaming(null)}
          onSave={onRename}
          saving={rename.isPending}
        />
      )}

      {viewingImage && (
        <Modal
          title={viewingImage.name}
          onClose={() => setViewingImage(null)}
          wide
        >
          <img
            src={viewingImage.url}
            alt={viewingImage.name}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "75vh",
              margin: "0 auto",
              borderRadius: 8,
            }}
          />
        </Modal>
      )}
    </div>
  );
}
