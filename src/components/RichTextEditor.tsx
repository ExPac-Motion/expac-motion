import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

const MERGE_TAGS = [
  { label: "Contact Name", value: "{{ contact.name }}" },
  { label: "Contact Company", value: "{{ contact.company }}" },
];

/** Body + bottom action bar — bold/italic/underline/lists, a link, inline
 *  images, merge-tag insertion, an unsubscribe-link insert, and a raw-HTML
 *  code view. Deliberately hand-rolled (execCommand) rather than a
 *  component library, to match the rest of this app's UI. `trailing`
 *  lets the caller append its own controls (e.g. Attachments/Save) onto
 *  the same bottom bar. */
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [codeView, setCodeView] = useState(false);
  const [codeText, setCodeText] = useState(value);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!codeView && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value, codeView]);

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

  function onPickTag(e: ChangeEvent<HTMLSelectElement>) {
    const tag = e.target.value;
    e.target.value = "";
    if (tag) insertHtml(tag);
  }

  function onPickUnsubscribe(e: ChangeEvent<HTMLSelectElement>) {
    const pick = e.target.value;
    e.target.value = "";
    if (pick) insertHtml('<a href="{{ unsubscribe_link }}">Unsubscribe</a>');
  }

  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await onUploadImage(file);
      insertHtml(`<img src="${url}" alt="" style="max-width:100%" />`);
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
        />
      )}
      <div className="rte-toolbar">
        <button type="button" title="Bold" onClick={() => exec("bold")}>
          <strong>B</strong>
        </button>
        <button type="button" title="Italic" onClick={() => exec("italic")}>
          <em>I</em>
        </button>
        <button type="button" title="Underline" onClick={() => exec("underline")}>
          <u>U</u>
        </button>
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
          title="Add an image"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "…" : "🖼"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPickImage}
        />
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
    </div>
  );
}
