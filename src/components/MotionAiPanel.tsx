// Motion AI chat: a top-bar button that opens a side panel (0214), with
// approval cards for the bot's actions (0215). Admin-only to start
// (permission "motion_ai").

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AI_TOOL_LABEL,
  archiveAiConversation,
  listAiConversations,
  listAiActions,
  listAiMessages,
  sendAiMessage,
  rateAiMessage,
  type AiAction,
} from "../lib/motionAi";
import MotionAiActionCard from "./MotionAiActionCard";

const SPARK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);

const STARTERS = [
  "Give me today's briefing",
  "Which shipments arrive in the next 5 days?",
  "Which quotes need a follow-up?",
  "Show overdue tasks",
];

export interface Turn {
  key: string;
  role: "user" | "assistant" | "action";
  text: string;
  action?: AiAction;
  at?: string;
  /** A saved message (real id), so it can be rated. */
  saved?: boolean;
}

/** **bold**, `- ` bullets, `# ` headings and line breaks; everything else is
 *  plain text (no HTML from the model is ever rendered). */
function renderInline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`ul${out.length}`}>{bullets}</ul>);
    bullets = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (b) {
      bullets.push(<li key={i}>{renderInline(b[1])}</li>);
      return;
    }
    flush();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(<p key={i} className="mai-h">{renderInline(h[1])}</p>);
    else if (line.trim()) out.push(<p key={i}>{renderInline(line)}</p>);
  });
  flush();
  return <>{out}</>;
}

export default function MotionAiButton() {
  const [open, setOpen] = useState(false);
  // "Ask Motion AI" elsewhere (e.g. an Inbox email) opens the panel with a question started.
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? "";
      setAsk((a) => ({ text, n: (a?.n ?? 0) + 1 }));
      setOpen(true);
    };
    window.addEventListener("motion-ai:ask", onAsk);
    return () => window.removeEventListener("motion-ai:ask", onAsk);
  }, []);
  return (
    <>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        title="Motion AI"
        aria-label="Motion AI"
        onClick={() => setOpen((o) => !o)}
      >
        {SPARK}
      </button>
      {open && <MotionAiPanel onClose={() => setOpen(false)} ask={ask} />}
    </>
  );
}

/** Where the main dark nav bar ends, so the panel opens under it. */
function navBottom(): number {
  const nav = document.querySelector(".topbar-nav");
  return nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
}

export function MotionAiPanel({
  onClose,
  initialTurns,
  ask,
}: {
  onClose: () => void;
  initialTurns?: Turn[];
  /** A question started elsewhere: put in the box (not sent), ready to finish. */
  ask?: { text: string; n: number } | null;
}) {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>(initialTurns ?? []);
  const [top, setTop] = useState(navBottom);
  useEffect(() => {
    const onResize = () => setTop(navBottom());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [draft, setDraft] = useState(ask?.text ?? "");
  // A new "Ask Motion AI" while the panel is open: the question goes in the box.
  const askN = ask?.n;
  useEffect(() => {
    if (!askN || !ask) return;
    setDraft(ask.text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askN]);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const convQ = useQuery({ queryKey: ["ai_conversations"], queryFn: listAiConversations });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, tool]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
    };
  }, [onClose]);

  async function openConversation(id: string) {
    if (busy) return;
    setError(null);
    if (!id) {
      setConversationId(null);
      setTurns([]);
      return;
    }
    setConversationId(id);
    try {
      setTurns(await loadTurns(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** The saved turns of a chat (real message ids, for thumbs up / down). */
  async function loadTurns(id: string): Promise<Turn[]> {
    const [rows, actions] = await Promise.all([listAiMessages(id), listAiActions({ conversationId: id })]);
    return [
      ...rows.map((m) => ({ key: m.id, role: m.role, text: m.text, at: m.created_at, saved: true })),
      ...actions.map((a) => ({ key: a.id, role: "action" as const, text: "", action: a, at: a.created_at })),
    ].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setDraft("");
    setBusy(true);
    const replyKey = `a${Date.now()}`;
    setTurns((t) => [...t, { key: `u${Date.now()}`, role: "user", text: message }, { key: replyKey, role: "assistant", text: "" }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let convId = conversationId;
    try {
      await sendAiMessage(
        { message, conversationId },
        (e) => {
          if (e.type === "conversation") {
            convId = e.id;
            setConversationId(e.id);
          }
          else if (e.type === "text") {
            setTool(null);
            setTurns((t) => t.map((x) => (x.key === replyKey ? { ...x, text: x.text + e.delta } : x)));
          } else if (e.type === "tool") setTool(e.phase === "start" ? e.name : null);
          else if (e.type === "action") {
            // The card goes just above the bot's reply about it.
            setTurns((t) => {
              const i = t.findIndex((x) => x.key === replyKey);
              const card: Turn = { key: e.action.id, role: "action", text: "", action: e.action };
              return i < 0 ? [...t, card] : [...t.slice(0, i), card, ...t.slice(i)];
            });
            qc.invalidateQueries({ queryKey: ["ai_actions"] });
          }
          else if (e.type === "error") setError(e.message);
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTool(null);
      setTurns((t) => t.filter((x) => !(x.key === replyKey && !x.text)));
      qc.invalidateQueries({ queryKey: ["ai_conversations"] });
      inputRef.current?.focus();
      // Swap in the saved turns, so the reply can be rated.
      if (convId) {
        loadTurns(convId)
          .then((saved) => saved.length && setTurns(saved))
          .catch(() => undefined);
      }
    }
  }

  async function archiveCurrent() {
    if (!conversationId || busy) return;
    await archiveAiConversation(conversationId);
    setConversationId(null);
    setTurns([]);
    qc.invalidateQueries({ queryKey: ["ai_conversations"] });
  }

  const convs = convQ.data ?? [];

  return (
    <aside
      className="mai-panel"
      role="dialog"
      aria-label="Motion AI"
      style={{ "--mai-top": `${top}px` } as CSSProperties}
    >
      <div className="mai-head">
        <span className="mai-title">{SPARK} Motion AI</span>
        <select
          className="mai-pick"
          value={conversationId ?? ""}
          onChange={(e) => openConversation(e.target.value)}
          disabled={busy}
          aria-label="Earlier chats"
        >
          <option value="">New chat</option>
          {conversationId && !convs.some((c) => c.id === conversationId) && <option value={conversationId}>This chat</option>}
          {convs.some((c) => c.source === "chat") && (
            <optgroup label="My chats">
              {convs
                .filter((c) => c.source === "chat")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.title || "Chat").slice(0, 48)}
                  </option>
                ))}
            </optgroup>
          )}
          {convs.some((c) => c.source !== "chat") && (
            <optgroup label="Briefings and automatic runs">
              {convs
                .filter((c) => c.source !== "chat")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.title || "Run").slice(0, 48)}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        {conversationId && convs.find((c) => c.id === conversationId)?.source !== "schedule" &&
          convs.find((c) => c.id === conversationId)?.source !== "trigger" && (
          <button className="link-btn" onClick={archiveCurrent} disabled={busy} title="Remove this chat from the list">
            Archive
          </button>
        )}
        <button className="mai-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="mai-body">
        {turns.length === 0 && (
          <div className="mai-empty">
            <p>Ask about shipments, quotes, customers, tasks or rates.</p>
            <div className="mai-starters">
              {STARTERS.map((s) => (
                <button key={s} className="btn outline btn-sm" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) =>
          t.role === "action" && t.action ? (
            <MotionAiActionCard
              key={t.key}
              action={t.action}
              onChange={(a) => {
                setTurns((all) => all.map((x) => (x.key === t.key ? { ...x, action: a } : x)));
                qc.invalidateQueries({ queryKey: ["ai_actions"] });
              }}
            />
          ) : (
            <div key={t.key} className={`mai-msg ${t.role}`}>
              {t.role === "assistant" ? <RichText text={t.text} /> : t.text}
              {t.role === "assistant" && t.saved && <RateAnswer messageId={t.key} />}
            </div>
          ),
        )}
        {busy && (
          <div className="mai-working">{tool ? `${AI_TOOL_LABEL[tool] ?? "Looking it up"}…` : "Thinking…"}</div>
        )}
        {error && <div className="mai-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <form
        className="mai-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={2}
          placeholder="Ask Motion AI…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn outline" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </aside>
  );
}

/** Thumbs up / down on an answer (0219). A thumbs down with a note becomes
 *  a learned correction, pending an admin's approval. */
function RateAnswer({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"idle" | "down" | "sent">("idle");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function rate(r: "thumbs_up" | "thumbs_down", n?: string) {
    setErr(null);
    try {
      await rateAiMessage(messageId, r, n);
      setState("sent");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  if (state === "sent") return <div className="mai-rate muted">Thanks, noted.</div>;
  return (
    <div className="mai-rate">
      {state === "idle" ? (
        <>
          <button className="link-btn" title="Good answer" onClick={() => rate("thumbs_up")}>
            Helpful
          </button>
          <button className="link-btn" title="Not right" onClick={() => setState("down")}>
            Not right
          </button>
        </>
      ) : (
        <>
          <input type="text" placeholder="What should it have said?" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <button className="btn outline btn-sm" onClick={() => rate("thumbs_down", note)}>
            Send
          </button>
        </>
      )}
      {err && <span className="mai-card-note bad">{err}</span>}
    </div>
  );
}
