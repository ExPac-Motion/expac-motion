// Settings › Motion AI knowledge (0219): what the bots read before
// answering, and the lessons they learned from the team's edits,
// rejections and "Not right" ratings, waiting for an admin's approval.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNote, Loading } from "../components/common";
import { formatDateTime } from "../lib/format";
import { useMyProfile } from "../lib/hooks";
import {
  AI_KNOWLEDGE_KIND_LABEL,
  deleteAiKnowledge,
  listAiKnowledge,
  saveAiKnowledge,
  setAiKnowledgeStatus,
  type AiKnowledge,
  type AiKnowledgeKind,
} from "../lib/motionAi";

const KINDS = Object.keys(AI_KNOWLEDGE_KIND_LABEL) as AiKnowledgeKind[];
const SCOPE_LABEL: Record<string, string> = {
  all: "All bots",
  ops: "Operations bot",
  sales: "Sales bot",
  support: "Support bot",
};

interface Draft {
  id?: string;
  kind: AiKnowledgeKind;
  scope: AiKnowledge["scope"];
  title: string;
  body: string;
  tags: string;
  status?: AiKnowledge["status"];
}
const EMPTY: Draft = { kind: "sop", scope: "all", title: "", body: "", tags: "" };

export default function MotionAiKnowledgeTab() {
  const qc = useQueryClient();
  const isAdmin = useMyProfile().data?.role === "admin";
  const q = useQuery({ queryKey: ["ai_knowledge"], queryFn: listAiKnowledge });
  const [view, setView] = useState<"learned" | "active" | "archived">("active");
  const [kind, setKind] = useState<"" | AiKnowledgeKind>("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const pending = all.filter((k) => k.status === "pending");
  const shown = useMemo(() => {
    const status = view === "learned" ? "pending" : view;
    const s = search.trim().toLowerCase();
    return all.filter(
      (k) =>
        k.status === status &&
        (!kind || k.kind === kind) &&
        (!s || `${k.title} ${k.body} ${k.tags.join(" ")}`.toLowerCase().includes(s)),
    );
  }, [all, view, kind, search]);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ["ai_knowledge"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function edit(k: AiKnowledge) {
    setDraft({ id: k.id, kind: k.kind, scope: k.scope, title: k.title, body: k.body, tags: k.tags.join(", "), status: k.status });
  }

  async function save(d: Draft, status?: AiKnowledge["status"]) {
    if (!d.title.trim() || !d.body.trim()) return setErr("A title and the text are required.");
    await run(async () => {
      await saveAiKnowledge({
        id: d.id,
        kind: d.kind,
        scope: d.scope,
        title: d.title,
        body: d.body,
        tags: d.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        status: status ?? d.status ?? "active",
      });
      setDraft(null);
    });
  }

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={new Error(`The knowledge base needs migration 0219: ${(q.error as Error).message}`)} />;

  return (
    <>
      <p className="muted">
        Motion AI reads the matching entries here before every answer. The tone guide is always included. Lessons it learns
        from your edits, rejections and "Not right" ratings wait under <b>Learned</b> until you approve them.
      </p>
      {!isAdmin && <p className="hint">Only an Admin can change the knowledge base.</p>}
      {err && <ErrorNote error={new Error(err)} />}

      <div className="mai-ovr-head">
        <div className="mai-card-actions">
          <button className={`btn btn-sm${view === "active" ? "" : " outline"}`} onClick={() => setView("active")}>
            Knowledge ({all.filter((k) => k.status === "active").length})
          </button>
          <button className={`btn btn-sm${view === "learned" ? "" : " outline"}`} onClick={() => setView("learned")}>
            Learned, to review ({pending.length})
          </button>
          <button className={`btn btn-sm${view === "archived" ? "" : " outline"}`} onClick={() => setView("archived")}>
            Archived
          </button>
        </div>
        <div className="mai-card-actions">
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value as "" | AiKnowledgeKind)}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {AI_KNOWLEDGE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button className="btn" onClick={() => setDraft({ ...EMPTY })}>
              + New entry
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div className="mai-card mai-kb-form">
          <div className="mai-card-row">
            <label>
              Kind
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AiKnowledgeKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {AI_KNOWLEDGE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Used by
              <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as AiKnowledge["scope"] })}>
                {Object.entries(SCOPE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mai-card-edit">
            <label>
              Title
              <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              Text (what the bot should know or do)
              <textarea rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </label>
            <label>
              Keywords (comma separated, help it find this)
              <input type="text" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            </label>
          </div>
          <div className="mai-card-actions">
            {draft.status === "pending" ? (
              <button className="btn btn-sm" onClick={() => save(draft, "active")}>
                Save & approve
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => save(draft)}>
                Save
              </button>
            )}
            <button className="link-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="hint">
          {view === "learned" ? "Nothing to review. New lessons appear here when the team edits, rejects or marks an answer Not right." : "No entries yet."}
        </p>
      ) : (
        <div className="mai-ovr-list">
          {shown.map((k) => (
            <div key={k.id} className={`mai-card ${k.status === "pending" ? "pending" : k.status === "archived" ? "undone" : "executed"}`}>
              <div className="mai-card-top">
                <span className="mai-card-kind">
                  {AI_KNOWLEDGE_KIND_LABEL[k.kind]} · {SCOPE_LABEL[k.scope]}
                </span>
                {k.source === "learned" && <span className="mai-pill pending">Learned</span>}
              </div>
              <div className="mai-card-summary">{k.title}</div>
              <div className="mai-card-body mai-kb-body">{k.body}</div>
              <div className="mai-ovr-meta">
                {k.source_note ? `${k.source_note} · ` : ""}
                {formatDateTime(k.updated_at)}
                {k.use_count ? ` · used ${k.use_count}×` : ""}
                {k.tags.length ? ` · ${k.tags.join(", ")}` : ""}
              </div>
              {isAdmin && (
                <div className="mai-card-actions">
                  {k.status === "pending" && (
                    <button className="btn btn-sm" onClick={() => run(() => setAiKnowledgeStatus(k.id, "active"))}>
                      Approve
                    </button>
                  )}
                  <button className="btn outline btn-sm" onClick={() => edit(k)}>
                    Edit
                  </button>
                  {k.status === "active" && (
                    <button className="btn outline warn btn-sm" onClick={() => run(() => setAiKnowledgeStatus(k.id, "archived"))}>
                      Archive
                    </button>
                  )}
                  {k.status === "archived" && (
                    <button className="btn outline btn-sm" onClick={() => run(() => setAiKnowledgeStatus(k.id, "active"))}>
                      Restore
                    </button>
                  )}
                  {k.status === "pending" && (
                    <button
                      className="btn outline warn btn-sm"
                      onClick={() => window.confirm("Discard this lesson?") && run(() => deleteAiKnowledge(k.id))}
                    >
                      Discard
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
