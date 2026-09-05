import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteMediaAsset,
  useMediaAssets,
  useRenameMediaAsset,
  useUploadMediaAsset,
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
  const upload = useUploadMediaAsset();
  const remove = useDeleteMediaAsset();
  const rename = useRenameMediaAsset();
  const { toast, error: toastError } = useToast();

  const fileRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<string>(ALL);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<MediaAsset | null>(null);
  const [copied, setCopied] = useState<string>("");

  const assets = useMemo(() => data ?? [], [data]);

  const folders = useMemo(() => {
    const set = new Set<string>([DEFAULT_FOLDER, ...extraFolders]);
    for (const a of assets) set.add(a.folder || DEFAULT_FOLDER);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets, extraFolders]);

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

  function onNewFolder() {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    if (!folders.includes(name)) setExtraFolders((f) => [...f, name]);
    setFolder(name);
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

  return (
    <div className="media-wrap">
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
          </button>
        ))}
        <button className="btn outline btn-sm media-newfolder" onClick={onNewFolder}>
          + New folder
        </button>
      </aside>

      <section className="media-main panel">
        <div className="panel-head">
          <div>
            <h2>{folder === ALL ? "All media" : folder}</h2>
            <p>
              Reusable images for campaigns and templates. Uploads land in{" "}
              <strong>{uploadFolder}</strong>.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onFiles}
          />
        </div>

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
          <div className="media-grid">
            {shown.map((a) => (
              <figure key={a.id} className="media-card">
                <div className="media-thumb">
                  <img src={a.url} alt={a.name} loading="lazy" />
                </div>
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
                    <button className="btn ghost small" onClick={() => onCopy(a)}>
                      {copied === a.id ? "Copied" : "Copy URL"}
                    </button>
                    <button className="btn ghost small" onClick={() => setRenaming(a)}>
                      Rename
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

      {renaming && (
        <RenameModal
          asset={renaming}
          onClose={() => setRenaming(null)}
          onSave={onRename}
          saving={rename.isPending}
        />
      )}
    </div>
  );
}
