import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import {
  EmptyState,
  Loading,
  MailLink,
  Popover,
  useDeepLinkReturn,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useAcceptQuote,
  useClients,
  useDeleteOpportunity,
  useCreateOpportunity,
  useJobs,
  useLeads,
  useLeadStatuses,
  useOpportunities,
  useProfiles,
  useQuotes,
  useSetQuoteOpportunityValue,
  useUpdateOpportunity,
  useUpdateQuotesBulk,
} from "../../lib/hooks";
import { synthesizeQuoteOpportunities } from "../../lib/calc";
import { formatDate, money } from "../../lib/format";
import {
  OPPORTUNITY_STAGES,
  type LeadStatus,
  type Opportunity,
  type OpportunityPatch,
  type OpportunityStatus,
  type QuoteStatus,
} from "../../lib/types";

/**
 * Pipeline stage → quote status, for moving an auto-listed quotation card.
 * Every stage now maps 1:1 to a quote status.
 */
const STAGE_QUOTE_STATUS: Partial<Record<OpportunityStatus, QuoteStatus>> = {
  new_lead: "open",
  quote_sent: "sent",
  quote_accepted: "accepted",
  job_completed: "completed",
  not_proceeding: "lost",
};

/* ---------- board view options (persisted per browser) ---------- */

type OppSort = "value" | "created" | "company" | "close";
interface CardFields {
  leadStatus: boolean;
  contact: boolean;
  value: boolean;
  rep: boolean;
  links: boolean;
  notes: boolean;
  closeDate: boolean;
}
interface BoardOpts {
  sort: OppSort;
  stages: OpportunityStatus[];
  fields: CardFields;
  /** Auto-list every quotation as a card (in the stage matching its status). */
  showQuotes: boolean;
}
const DEFAULT_OPTS: BoardOpts = {
  sort: "value",
  stages: OPPORTUNITY_STAGES.map((s) => s.key),
  showQuotes: true,
  fields: {
    leadStatus: true,
    contact: true,
    value: true,
    rep: true,
    links: true,
    notes: false,
    closeDate: false,
  },
};
function loadOpts(): BoardOpts {
  try {
    const raw = localStorage.getItem("opps.opts");
    if (!raw) return DEFAULT_OPTS;
    const p = JSON.parse(raw) as Partial<BoardOpts>;
    return {
      sort: p.sort ?? DEFAULT_OPTS.sort,
      stages: Array.isArray(p.stages) ? p.stages : DEFAULT_OPTS.stages,
      showQuotes: p.showQuotes ?? DEFAULT_OPTS.showQuotes,
      fields: { ...DEFAULT_OPTS.fields, ...(p.fields ?? {}) },
    };
  } catch {
    return DEFAULT_OPTS;
  }
}
function saveOpts(o: BoardOpts) {
  try {
    localStorage.setItem("opps.opts", JSON.stringify(o));
  } catch {
    /* private mode */
  }
}
function readableText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1f2937" : "#fff";
}

const FIELD_LABELS: { key: keyof CardFields; label: string }[] = [
  { key: "leadStatus", label: "Lead status" },
  { key: "contact", label: "Contact" },
  { key: "value", label: "Value" },
  { key: "rep", label: "Sales person" },
  { key: "links", label: "Quote / shipment" },
  { key: "notes", label: "Notes" },
  { key: "closeDate", label: "Close date" },
];

const Icon = {
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  ),
};

/* One icon per pipeline stage, sat in front of the column heading. */
const STAGE_ICON: Record<OpportunityStatus, ReactNode> = {
  new_lead: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  ),
  quote_sent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  quote_accepted: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9v6M18 9v6" />
    </svg>
  ),
  job_completed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />
    </svg>
  ),
  not_proceeding: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </svg>
  ),
};

export default function OpportunitiesTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const oppsQ = useOpportunities();
  const statusesQ = useLeadStatuses();
  const quotesQ = useQuotes();
  const leadsQ = useLeads();
  const profilesQ = useProfiles();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const del = useDeleteOpportunity();
  const { toast, error: toastError } = useToast();

  const [opts, setOpts] = useState<BoardOpts>(loadOpts);
  function patchOpts(next: BoardOpts) {
    setOpts(next);
    saveOpts(next);
  }

  const realOpps = useMemo(() => oppsQ.data ?? [], [oppsQ.data]);
  const { arm, closeAndReturn } = useDeepLinkReturn();

  // Deep-link from a Notification: navigate here with
  // { state: { openOpportunityId } } to pop the existing edit modal open on
  // a specific opportunity, same as clicking its card. Saving/cancelling it
  // then returns to Notifications instead of stranding the user here.
  useEffect(() => {
    const openId = (location.state as { openOpportunityId?: string } | null)
      ?.openOpportunityId;
    if (!openId || realOpps.length === 0) return;
    const opp = realOpps.find((o) => o.id === openId);
    if (opp) {
      setEditing(opp);
      arm();
      navigate(location.pathname + location.search, {
        replace: true,
        state: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, realOpps]);

  const leadStatusIdByLead = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const l of leadsQ.data ?? []) m.set(l.id, l.lead_status_id);
    return m;
  }, [leadsQ.data]);

  const profileById = useMemo(() => {
    const m = new Map<string, { id: string; full_name: string | null }>();
    for (const p of profilesQ.data ?? []) m.set(p.id, p);
    return m;
  }, [profilesQ.data]);

  // Every quotation is surfaced as a card in the stage matching its status,
  // unless a real opportunity already links that quote.
  const quoteOpps = useMemo<Opportunity[]>(() => {
    if (!opts.showQuotes) return [];
    return synthesizeQuoteOpportunities(
      quotesQ.data ?? [],
      oppsQ.data ?? [],
      profileById,
      leadStatusIdByLead,
    );
  }, [opts.showQuotes, oppsQ.data, quotesQ.data, profileById, leadStatusIdByLead]);

  const opps = useMemo(
    () => [...realOpps, ...quoteOpps],
    [realOpps, quoteOpps],
  );

  const statusById = useMemo(() => {
    const m = new Map<string, LeadStatus>();
    for (const s of statusesQ.data ?? []) m.set(s.id, s);
    return m;
  }, [statusesQ.data]);

  const sortRows = useMemo(() => {
    return (rows: Opportunity[]) => {
      const out = rows.slice();
      out.sort((a, b) => {
        if (opts.sort === "value") return b.value - a.value;
        if (opts.sort === "company")
          return (a.lead?.company ?? a.client?.company ?? "").localeCompare(
            b.lead?.company ?? b.client?.company ?? "",
          );
        if (opts.sort === "close")
          return (a.close_date ?? "9999").localeCompare(b.close_date ?? "9999");
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
      return out;
    };
  }, [opts.sort]);

  async function onDelete(o: Opportunity) {
    const name = o.lead?.company ?? o.client?.company ?? "this opportunity";
    if (!window.confirm(`Remove "${name}" from the pipeline?`)) return;
    try {
      await del.mutateAsync(o.id);
      toast("Opportunity removed");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not remove");
    }
  }

  if (oppsQ.isLoading) {
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  }

  const stages = OPPORTUNITY_STAGES.filter((s) => opts.stages.includes(s.key));

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Move a card to a new stage with its status dropdown.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Popover label="Options" size="md">
            {() => (
              <>
                <label className="ui-pop-row">
                  <span>Sort cards by</span>
                  <select
                    value={opts.sort}
                    onChange={(e) =>
                      patchOpts({ ...opts, sort: e.target.value as OppSort })
                    }
                  >
                    <option value="value">Value (high → low)</option>
                    <option value="created">Newest first</option>
                    <option value="company">Company (A–Z)</option>
                    <option value="close">Close date</option>
                  </select>
                </label>

                <div className="ui-pop-head">Sources</div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={opts.showQuotes}
                    onChange={(e) =>
                      patchOpts({ ...opts, showQuotes: e.target.checked })
                    }
                  />
                  List every quotation
                </label>

                <div className="ui-pop-head">Visible stages</div>
                {OPPORTUNITY_STAGES.map((s) => (
                  <label key={s.key} className="check">
                    <input
                      type="checkbox"
                      checked={opts.stages.includes(s.key)}
                      onChange={(e) =>
                        patchOpts({
                          ...opts,
                          stages: e.target.checked
                            ? [...opts.stages, s.key]
                            : opts.stages.filter((k) => k !== s.key),
                        })
                      }
                    />
                    {s.label}
                  </label>
                ))}

                <div className="ui-pop-head">Show on cards</div>
                {FIELD_LABELS.map((f) => (
                  <label key={f.key} className="check">
                    <input
                      type="checkbox"
                      checked={opts.fields[f.key]}
                      onChange={(e) =>
                        patchOpts({
                          ...opts,
                          fields: { ...opts.fields, [f.key]: e.target.checked },
                        })
                      }
                    />
                    {f.label}
                  </label>
                ))}
              </>
            )}
          </Popover>
          <button className="btn" onClick={() => setCreating(true)}>
            + New Opportunity
          </button>
        </div>
      </div>

      {opps.length === 0 ? (
        <div className="panel">
          <EmptyState>
            No opportunities yet. Add one here, or open a lead and click "+ Add
            Opportunity".
          </EmptyState>
        </div>
      ) : stages.length === 0 ? (
        <div className="panel">
          <EmptyState>All stages hidden — enable some in Options.</EmptyState>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${stages.length}, minmax(260px, 1fr))`,
            gap: 14,
            overflowX: "auto",
          }}
        >
          {stages.map((stage) => {
            const rows = sortRows(opps.filter((o) => o.status === stage.key));
            const total = rows.reduce((s, o) => s + o.value, 0);
            return (
              <div key={stage.key} className="panel" style={{ margin: 0 }}>
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span className="opp-col-head">
                      <span className="opp-col-icon">
                        {STAGE_ICON[stage.key]}
                      </span>
                      <strong style={{ fontSize: "0.85rem" }}>
                        {stage.label}
                      </strong>
                    </span>
                    <span className="muted small">{rows.length}</span>
                  </div>
                  <div className="small" style={{ fontWeight: 700 }}>
                    {money(total)}
                  </div>
                </div>

                <div className="stack-sm">
                  {rows.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      opportunity={o}
                      synthetic={String(o.id).startsWith("quote:")}
                      fields={opts.fields}
                      leadStatus={
                        o.lead?.lead_status_id
                          ? statusById.get(o.lead.lead_status_id) ?? null
                          : null
                      }
                      onEdit={() => setEditing(o)}
                      onDelete={() => onDelete(o)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <OpportunityModal onClose={() => setCreating(false)} />}
      {editing && (
        <OpportunityModal
          opportunity={editing}
          onClose={() => closeAndReturn(() => setEditing(null))}
        />
      )}
    </>
  );
}

function OpportunityCard({
  opportunity: o,
  synthetic,
  fields,
  leadStatus,
  onEdit,
  onDelete,
}: {
  opportunity: Opportunity;
  synthetic: boolean;
  fields: CardFields;
  leadStatus: LeadStatus | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateOpportunity();
  const updateQuote = useUpdateQuotesBulk();
  const acceptQuote = useAcceptQuote();
  const { toast, error: toastError } = useToast();
  const name = o.lead?.company ?? o.client?.company ?? "Untitled";
  const contact = o.lead?.contact ?? o.client?.contact;
  const email = o.lead?.email ?? o.client?.email;

  async function onStatusChange(status: OpportunityStatus) {
    const label = OPPORTUNITY_STAGES.find((s) => s.key === status)?.label;
    try {
      if (synthetic) {
        if (!o.quote?.id) return;
        // Moving a quotation card to "Quote Accepted" runs the real
        // Accept & create shipment flow — a shipment is created and shows up
        // under Active Shipments (and the lead is promoted to a customer).
        if (status === "quote_accepted") {
          if (o.quote.status === "accepted" || o.quote.status === "completed")
            return;
          await acceptQuote.mutateAsync(o.quote.id);
          toast("Shipment created — check Active Shipments");
          return;
        }
        // Other stages just re-stamp the quote's status; the board then
        // re-derives the card into its new column.
        const quoteStatus = STAGE_QUOTE_STATUS[status];
        if (!quoteStatus) {
          toastError("This stage can't be set from a quotation card.");
          return;
        }
        await updateQuote.mutateAsync({
          ids: [o.quote.id],
          patch: { status: quoteStatus },
        });
        toast("Quotation moved to " + label);
        return;
      }
      await update.mutateAsync({ id: o.id, patch: { status } });
      toast("Moved to " + label);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update");
    }
  }

  return (
    <div className="opp-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <strong className="opp-company">
          {name}
          {synthetic && (
            <span className="tag" style={{ marginLeft: 6 }}>
              quote
            </span>
          )}
        </strong>
        {synthetic ? (
          <Link
            className="row-icon-btn"
            title="Open quotation"
            to={`/quotes/${o.quote?.id}`}
          >
            {Icon.edit}
          </Link>
        ) : (
          <div style={{ display: "flex", gap: 2 }}>
            <button className="row-icon-btn" title="Edit" onClick={onEdit}>
              {Icon.edit}
            </button>
            <button
              className="row-icon-btn danger"
              title="Delete"
              onClick={onDelete}
            >
              {Icon.delete}
            </button>
          </div>
        )}
      </div>

      {fields.value && (
        <div
          className="opp-line"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span className="opp-line-label">Value:</span>
          {synthetic && o.quote?.id ? (
            <QuoteValueEditor
              quoteId={o.quote.id}
              manual={o.opportunity_value ?? null}
              computed={o.value}
            />
          ) : (
            <strong>{money(o.value)}</strong>
          )}
        </div>
      )}

      {fields.leadStatus && leadStatus && (
        <div className="opp-line">
          <span className="opp-line-label">Lead Status:</span>{" "}
          <span
            className="opp-status-badge"
            style={{
              background: leadStatus.color,
              color: readableText(leadStatus.color),
            }}
          >
            {leadStatus.name}
          </span>
        </div>
      )}

      {fields.contact && contact && (
        <div
          className="opp-line"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span className="opp-line-label">Contact:</span>
          <span>{contact}</span>
          {email && <MailLink email={email} />}
        </div>
      )}
      {fields.rep && o.sales_person?.full_name && (
        <div className="muted small">Rep: {o.sales_person.full_name}</div>
      )}
      {fields.links && o.quote && (
        <div className="muted small">
          Quote:{" "}
          <Link className="ref-link" to={`/quotes/${o.quote.id}`}>
            {o.quote.reference}
          </Link>
        </div>
      )}
      {fields.links && o.job && (
        <div className="muted small">Shipment: {o.job.reference}</div>
      )}
      {fields.closeDate && o.close_date && (
        <div className="muted small">Close: {formatDate(o.close_date)}</div>
      )}
      {fields.notes && o.notes && (
        <div className="muted small opp-card-notes">{o.notes}</div>
      )}

      <select
        value={o.status}
        disabled={
          update.isPending || updateQuote.isPending || acceptQuote.isPending
        }
        onChange={(e) => onStatusChange(e.target.value as OpportunityStatus)}
        title={
          synthetic
            ? "Moving this card re-stamps the quotation's status"
            : undefined
        }
        style={{ marginTop: 8, width: "100%", fontSize: "0.76rem" }}
      >
        {OPPORTUNITY_STAGES.map((s) => (
          <option
            key={s.key}
            value={s.key}
            disabled={synthetic && !STAGE_QUOTE_STATUS[s.key]}
          >
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * TEMP (0052): inline editor for a quotation card's opportunity value while the
 * old CRM is being migrated. Writes `quotes.opportunity_value` directly; blank
 * clears it and the card falls back to the computed quotation total.
 */
function QuoteValueEditor({
  quoteId,
  manual,
  computed,
}: {
  quoteId: string;
  manual: number | null;
  computed: number;
}) {
  const save = useSetQuoteOpportunityValue();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(manual != null ? String(manual) : "");

  // Re-sync if the stored value changes (another edit, a refetch).
  const [seenManual, setSeenManual] = useState(manual);
  if (seenManual !== manual) {
    setSeenManual(manual);
    setText(manual != null ? String(manual) : "");
  }

  async function commit() {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed !== "" && !Number.isFinite(Number(trimmed))) {
      setText(manual != null ? String(manual) : "");
      return;
    }
    const next = trimmed === "" ? null : Number(trimmed);
    if ((next ?? null) === (manual ?? null)) return;
    try {
      await save.mutateAsync({ id: quoteId, value: next });
      toast(next == null ? "Value cleared — using quotation total" : "Value saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save value");
      setText(manual != null ? String(manual) : "");
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      // Editing shows the raw editable number; at rest it shows the
      // formatted currency (a plain number input can't render "R"/commas).
      value={editing ? text : manual != null ? money(manual) : ""}
      placeholder={money(computed)}
      title="Manual opportunity value — leave blank to use the quotation total"
      disabled={save.isPending}
      onFocus={() => {
        setEditing(true);
        setText(manual != null ? String(manual) : "");
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{ width: 130, fontWeight: 700, fontSize: "0.8rem", padding: "2px 6px" }}
    />
  );
}

function OpportunityModal({
  opportunity,
  onClose,
}: {
  opportunity?: Opportunity;
  onClose: () => void;
}) {
  const clientsQ = useClients();
  const leadsQ = useLeads();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const profilesQ = useProfiles();
  const create = useCreateOpportunity();
  const update = useUpdateOpportunity();
  const { toast, error: toastError } = useToast();

  const [entity, setEntity] = useState(
    opportunity?.client_id
      ? `c:${opportunity.client_id}`
      : opportunity?.lead_id
        ? `l:${opportunity.lead_id}`
        : "",
  );

  const clients = clientsQ.data ?? [];
  const leads = leadsQ.data ?? [];
  const salesPeople = profilesQ.data ?? [];

  const [kind, entityId] = entity.split(":");
  const effectiveClientId =
    kind === "c" ? entityId : leads.find((l) => l.id === entityId)?.promoted_client_id;

  const linkableQuotes = useMemo(() => {
    const quotes = quotesQ.data ?? [];
    return quotes.filter(
      (q) =>
        (kind === "l" && q.lead_id === entityId) ||
        (effectiveClientId && q.client_id === effectiveClientId),
    );
  }, [quotesQ.data, kind, entityId, effectiveClientId]);

  const linkableJobs = useMemo(() => {
    const jobs = jobsQ.data ?? [];
    return jobs.filter((j) => effectiveClientId && j.client_id === effectiveClientId);
  }, [jobsQ.data, effectiveClientId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!entity) {
      toastError("Please select a lead or customer");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const [k, id] = entity.split(":");
    const patch: OpportunityPatch = {
      title: String(fd.get("title") || "").trim() || null,
      lead_id: k === "l" ? id : null,
      client_id: k === "c" ? id : null,
      status: fd.get("status") as OpportunityStatus,
      value: Number(fd.get("value")) || 0,
      close_date: String(fd.get("close_date") || "") || null,
      notes: String(fd.get("notes") || "").trim() || null,
      sales_person_id: String(fd.get("sales_person_id") || "") || null,
      quote_id: String(fd.get("quote_id") || "") || null,
      job_id: String(fd.get("job_id") || "") || null,
    };
    try {
      if (opportunity) {
        await update.mutateAsync({ id: opportunity.id, patch });
        toast("Opportunity updated");
      } else {
        await create.mutateAsync(patch);
        toast("Opportunity added");
      }
      onClose();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      title={opportunity ? "Edit Opportunity" : "New Opportunity"}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Lead or Customer</label>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Select…</option>
            {clients.map((c) => (
              <option key={c.id} value={`c:${c.id}`}>
                {c.company} (Customer)
              </option>
            ))}
            {leads.map((l) => (
              <option key={l.id} value={`l:${l.id}`}>
                {l.company} (Lead)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Title (optional)</label>
          <input
            name="title"
            placeholder="e.g. Air freight — China to SA"
            defaultValue={opportunity?.title ?? ""}
          />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Value (R)</label>
            <input
              name="value"
              type="number"
              step="0.01"
              defaultValue={opportunity?.value ?? 0}
            />
          </div>
          <div className="field">
            <label>Stage</label>
            <select name="status" defaultValue={opportunity?.status ?? "new_lead"}>
              {OPPORTUNITY_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Sales Person</label>
            <select
              name="sales_person_id"
              defaultValue={opportunity?.sales_person_id ?? ""}
            >
              <option value="">— unassigned —</option>
              {salesPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || "—"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Expected Close Date</label>
            <input
              name="close_date"
              type="date"
              defaultValue={opportunity?.close_date ?? ""}
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Link Quote</label>
            <select name="quote_id" defaultValue={opportunity?.quote_id ?? ""}>
              <option value="">— none —</option>
              {linkableQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.reference}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Link Shipment</label>
            <select name="job_id" defaultValue={opportunity?.job_id ?? ""}>
              <option value="">— none —</option>
              {linkableJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.reference}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={3} defaultValue={opportunity?.notes ?? ""} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
