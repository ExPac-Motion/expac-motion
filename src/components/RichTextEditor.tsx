import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useToast } from "./Toast";
import { rewriteCopy, type RewriteAction, type RewriteTone } from "../lib/ai";
import { useMediaAssets, useRecordMediaAsset } from "../lib/hooks";

const MERGE_TAGS = [
  { label: "Contact Name", value: "{{ contact.name }}" },
  { label: "Contact Company", value: "{{ contact.company }}" },
];

/** Email-safe families. Value is the full stack applied to the selection. */
const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
];

const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "14px" },
  { label: "Medium", value: "16px" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "28px" },
];

const DEFAULT_FOLDER = "General";

const AI_ACTIONS: {
  label: string;
  action: RewriteAction;
  tone?: RewriteTone;
}[] = [
  { label: "Improve writing", action: "improve" },
  { label: "Make shorter", action: "shorten" },
  { label: "Warmer tone", action: "tone", tone: "warmer" },
  { label: "More formal", action: "tone", tone: "formal" },
  { label: "More casual", action: "tone", tone: "casual" },
];

/** `mail-assets` storage path out of a public/CDN URL, for recording an
 *  editor-uploaded image into the reusable Media gallery. */
function storagePathFromUrl(url: string): string | null {
  const m = url.match(/\/mail-assets\/(.+?)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Body + bottom action bar — bold/italic/underline/lists, a link, inline
 *  images (via the shared Media gallery), merge-tag insertion, an
 *  unsubscribe-link insert, and a raw-HTML code view. Deliberately
 *  hand-rolled (execCommand) rather than a component library, to match
 *  the rest of this app's UI. `trailing` lets the caller append its own
 *  controls (e.g. Attachments/Save) onto the same bottom bar.
 *
 *  `onUploadImage` is the raw file→storage upload used by the gallery's
 *  "Upload new" option; the uploaded image is also recorded as a reusable
 *  `media_assets` row so it shows up in the Media tab. */
export default function RichTextEditor({
  value,
  onChange,
  onUploadImage,
  trailing,
}: {
  value: string;
  onChange: (html: string) => void;
  onUploadImage: (file: File) => Promise<{ url: string }>;
  trailing?: ReactNode;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<HTMLDivElement>(null);
  // Last non-collapsed selection inside the editor. A toolbar <select> steals
  // focus when opened, so font/size handlers restore this before execCommand.
  const lastRangeRef = useRef<Range | null>(null);
  const [codeView, setCodeView] = useState(false);
  const [codeText, setCodeText] = useState(value);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // "" = all folders; a folder name also becomes the target for "Upload new".
  const [galleryFolder, setGalleryFolder] = useState("");
  const { error: toastError } = useToast();

  const mediaAssets = useMediaAssets();
  const recordMedia = useRecordMediaAsset();

  const assets = useMemo(() => mediaAssets.data ?? [], [mediaAssets.data]);
  const folders = useMemo(() => {
    const set = new Set<string>([DEFAULT_FOLDER]);
    for (const a of assets) set.add(a.folder || DEFAULT_FOLDER);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets]);
  const galleryShown =
    galleryFolder === "" ? assets : assets.filter((a) => (a.folder || DEFAULT_FOLDER) === galleryFolder);

  useEffect(() => {
    if (!codeView && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value, codeView]);

  useEffect(() => {
    if (!aiOpen) return;
    function onDocDown(e: MouseEvent) {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) {
        setAiOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [aiOpen]);

  function emit() {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function exec(cmd: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }

  function addLink() {
    const url = window.prompt("Link URL (e.g. https://expac.co.za)");
    if (!url) return;
    exec("createLink", url);
  }

  /** Inserts via Range/Selection rather than execCommand("insertHTML") --
   *  the latter bleeds the editor's own inherited computed style (e.g.
   *  font-size) into inline attributes on the inserted nodes in Chromium. */
  function insertHtml(html: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const range = sel!.getRangeAt(0);
    range.deleteContents();
    const template = document.createElement("template");
    template.innerHTML = html;
    const frag = template.content;
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel!.removeAllRanges();
      sel!.addRange(range);
    }
    emit();
  }

  function insertImage(url: string) {
    insertHtml(`<img src="${url}" alt="" style="max-width:100%" />`);
  }

  function onPickTag(e: ChangeEvent<HTMLSelectElement>) {
    const tag = e.target.value;
    e.target.value = "";
    if (tag) insertHtml(tag);
  }

  /** Remember the live selection while the caret is in the editor. */
  function rememberSelection() {
    const sel = window.getSelection();
    const editor = editorRef.current;
    if (
      sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      editor &&
      editor.contains(sel.anchorNode) &&
      editor.contains(sel.focusNode)
    ) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  /** Put the caret back where it was before a toolbar <select> took focus;
   *  with nothing previously selected, target the whole body so a font/size
   *  pick applies to the entire signature. */
  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (lastRangeRef.current) {
      sel.addRange(lastRangeRef.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(editor);
      sel.addRange(r);
    }
  }

  /** Apply a font family to the selection as an inline style span. */
  function onPickFont(e: ChangeEvent<HTMLSelectElement>) {
    const family = e.target.value;
    e.target.value = "";
    if (!family) return;
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("fontName", false, family);
    document.execCommand("styleWithCSS", false, "false");
    emit();
  }

  /** Apply a font size (px) to the selection. execCommand("fontSize") only
   *  takes 1-7, so tag the run with a sentinel then rewrite it to px. */
  function onPickSize(e: ChangeEvent<HTMLSelectElement>) {
    const size = e.target.value;
    e.target.value = "";
    const editor = editorRef.current;
    if (!size || !editor) return;
    restoreSelection();
    document.execCommand("fontSize", false, "7");
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute("size");
      (f as HTMLElement).style.fontSize = size;
    });
    emit();
  }

  function onPickUnsubscribe(e: ChangeEvent<HTMLSelectElement>) {
    const pick = e.target.value;
    e.target.value = "";
    if (pick) insertHtml('<a href="{{ unsubscribe_link }}">Unsubscribe</a>');
  }

  /** "Upload new" inside the gallery: raw upload via the caller's uploader,
   *  then record it as a reusable media_assets row (best-effort) and insert. */
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await onUploadImage(file);
      const path = storagePathFromUrl(url);
      if (path) {
        try {
          await recordMedia.mutateAsync({
            folder: galleryFolder || DEFAULT_FOLDER,
            name: file.name,
            url,
            storage_path: path,
            size_bytes: file.size,
            mime: file.type || null,
          });
        } catch {
          /* the gallery record is a convenience; the image still inserts */
        }
      }
      insertImage(url);
      setGalleryOpen(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not upload image");
    } finally {
      setUploading(false);
    }
  }

  function toggleCodeView() {
    if (!codeView) {
      setCodeText(editorRef.current?.innerHTML ?? value);
      setCodeView(true);
    } else {
      onChange(codeText);
      setCodeView(false);
    }
  }

  /** Rewrites the current selection if there is one, otherwise the whole body. */
  async function runAi(action: RewriteAction, tone?: RewriteTone) {
    setAiOpen(false);
    const editor = editorRef.current;
    if (!editor) return;

    const sel = window.getSelection();
    const hasSelection =
      !!sel &&
      !sel.isCollapsed &&
      sel.rangeCount > 0 &&
      editor.contains(sel.anchorNode) &&
      editor.contains(sel.focusNode);

    let savedRange: Range | null = null;
    let text: string;
    if (hasSelection) {
      savedRange = sel!.getRangeAt(0).cloneRange();
      const holder = document.createElement("div");
      holder.appendChild(savedRange.cloneContents());
      text = holder.innerHTML;
    } else {
      text = editor.innerHTML;
    }
    if (!text.trim()) {
      toastError("Nothing to rewrite yet");
      return;
    }

    setAiBusy(true);
    try {
      const { text: rewritten } = await rewriteCopy({ action, tone, text });
      if (hasSelection && savedRange) {
        sel!.removeAllRanges();
        sel!.addRange(savedRange);
        insertHtml(rewritten);
      } else {
        editor.innerHTML = rewritten;
        emit();
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "AI rewrite failed");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="rte">
      {codeView ? (
        <textarea
          className="rte-code"
          rows={12}
          value={codeText}
          onChange={(e) => setCodeText(e.target.value)}
        />
      ) : (
        <div
          ref={editorRef}
          className="rte-body"
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onMouseUp={rememberSelection}
          onKeyUp={rememberSelection}
        />
      )}
      <div className="rte-toolbar">
        <div className="rte-ai" ref={aiRef}>
          <button
            type="button"
            title="AI rewrite"
            className={aiOpen ? "active" : ""}
            disabled={aiBusy || codeView}
            onClick={() => setAiOpen((v) => !v)}
          >
            {aiBusy ? "AI…" : "AI"}
          </button>
          {aiOpen && (
            <div className="rte-ai-menu">
              {AI_ACTIONS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => runAi(a.action, a.tone)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="rte-sep" />
        <button type="button" title="Bold" onClick={() => exec("bold")}>
          <strong>B</strong>
        </button>
        <button type="button" title="Italic" onClick={() => exec("italic")}>
          <em>I</em>
        </button>
        <button type="button" title="Underline" onClick={() => exec("underline")}>
          <u>U</u>
        </button>
        <select
          className="rte-font-select"
          title="Font"
          defaultValue=""
          disabled={codeView}
          onChange={onPickFont}
        >
          <option value="" disabled>
            Font
          </option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="rte-font-select"
          title="Text size"
          defaultValue=""
          disabled={codeView}
          onChange={onPickSize}
        >
          <option value="" disabled>
            Size
          </option>
          {FONT_SIZES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" title="Bullet list" onClick={() => exec("insertUnorderedList")}>
          •≡
        </button>
        <button type="button" title="Numbered list" onClick={() => exec("insertOrderedList")}>
          1≡
        </button>
        <button type="button" title="Add link" onClick={addLink}>
          🔗
        </button>
        <button
          type="button"
          title="Insert image from gallery"
          onClick={() => setGalleryOpen(true)}
          disabled={uploading || codeView}
        >
          {uploading ? "…" : "🖼"}
        </button>
        <select
          className="rte-icon-select"
          title="Insert template tag"
          defaultValue=""
          onChange={onPickTag}
        >
          <option value="" disabled>
            {"{ }"}
          </option>
          {MERGE_TAGS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="View/edit raw HTML"
          className={codeView ? "active" : ""}
          onClick={toggleCodeView}
        >
          {"<>"}
        </button>
        <span className="rte-sep" />
        <span className="rte-label">Unsubscribe Link</span>
        <select defaultValue="" onChange={onPickUnsubscribe}>
          <option value="" disabled>
            Default Unsubscribe Link
          </option>
          <option value="insert">Insert Unsubscribe Link</option>
        </select>
        {trailing && (
          <>
            <span className="rte-sep" />
            {trailing}
          </>
        )}
      </div>

      {galleryOpen && (
        <div
          className="rte-gallery-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setGalleryOpen(false);
          }}
        >
          <div className="rte-gallery" role="dialog" aria-label="Media gallery">
            <div className="rte-gallery-head">
              <strong>Insert an image</strong>
              <select
                value={galleryFolder}
                onChange={(e) => setGalleryFolder(e.target.value)}
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <label className="btn outline btn-sm">
                {uploading ? "Uploading…" : "Upload new"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={uploading}
                  onChange={onPickImage}
                />
              </label>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setGalleryOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="rte-gallery-body">
              {mediaAssets.isLoading ? (
                <p className="muted">Loading…</p>
              ) : galleryShown.length === 0 ? (
                <p className="muted">
                  No images{galleryFolder ? " in this folder" : ""} yet. Use
                  “Upload new”, or add images in the Media tab.
                </p>
              ) : (
                <div className="rte-gallery-grid">
                  {galleryShown.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="rte-gallery-item"
                      title={a.name}
                      onClick={() => {
                        insertImage(a.url);
                        setGalleryOpen(false);
                      }}
                    >
                      <img src={a.url} alt={a.name} loading="lazy" />
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
