import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useToast } from "./Toast";
import { rewriteCopy, type RewriteAction, type RewriteTone } from "../lib/ai";

const MERGE_TAGS = [
  { label: "Contact Name", value: "{{ contact.name }}" },
  { label: "Contact Company", value: "{{ contact.company }}" },
];

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
  const aiRef = useRef<HTMLDivElement>(null);
  const [codeView, setCodeView] = useState(false);
  const [codeText, setCodeText] = useState(value);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const { error: toastError } = useToast();

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
