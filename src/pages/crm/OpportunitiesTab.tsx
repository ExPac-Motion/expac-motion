import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import { EmptyState, Loading, MailLink, Popover } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useClients,
  useDeleteOpportunity,
  useCreateOpportunity,
  useJobs,
  useLeads,
  useLeadStatuses,
  useOpportunities,
  useProfiles,
  useQuotes,
  useUpdateOpportunity,
} from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import {
  OPPORTUNITY_STAGES,
  type LeadStatus,
  type Opportunity,
  type OpportunityPatch,
  type OpportunityStatus,
} from "../../lib/types";

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
}
const DEFAULT_OPTS: BoardOpts = {
  sort: "value",
  stages: OPPORTUNITY_STAGES.map((s) => s.key),
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

export default function OpportunitiesTab() {
  const oppsQ = useOpportunities();
  const statusesQ = useLeadStatuses();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const del = useDeleteOpportunity();
  const { toast, error: toastError } = useToast();

  const [opts, setOpts] = useState<BoardOpts>(loadOpts);
  function patchOpts(next: BoardOpts) {
    setOpts(next);
    saveOpts(next);
  }

  const opps = oppsQ.data ?? [];
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
                    }}
                  >
                    <strong style={{ fontSize: "0.85rem" }}>{stage.label}</strong>
                    <span className="muted small">{rows.length}</span>
                  </div>
                  <div className="muted small">{money(total)}</div>
                </div>

                <div className="stack-sm">
                  {rows.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      opportunity={o}
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
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function OpportunityCard({
  opportunity: o,
  fields,
  leadStatus,
  onEdit,
  onDelete,
}: {
  opportunity: Opportunity;
  fields: CardFields;
  leadStatus: LeadStatus | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateOpportunity();
  const { toast, error: toastError } = useToast();
  const name = o.lead?.company ?? o.client?.company ?? "Untitled";
  const contact = o.lead?.contact ?? o.client?.contact;
  const email = o.lead?.email ?? o.client?.email;

  async function onStatusChange(status: OpportunityStatus) {
    try {
      await update.mutateAsync({ id: o.id, patch: { status } });
      toast("Moved to " + OPPORTUNITY_STAGES.find((s) => s.key === status)?.label);
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
        }}
      >
        <strong style={{ fontSize: "0.85rem" }}>{o.title || name}</strong>
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
      </div>
      {o.title && <div className="muted small">{name}</div>}

      {fields.leadStatus && leadStatus && (
        <span
          className="opp-status-badge"
          style={{
            background: leadStatus.color,
            color: readableText(leadStatus.color),
          }}
        >
          {leadStatus.name}
        </span>
      )}

      {fields.value && (
        <div style={{ fontWeight: 700, margin: "4px 0" }}>{money(o.value)}</div>
      )}
      {fields.contact && contact && (
        <div
          className="muted small"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          {contact}
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
        onChange={(e) => onStatusChange(e.target.value as OpportunityStatus)}
        style={{ marginTop: 8, width: "100%", fontSize: "0.76rem" }}
      >
        {OPPORTUNITY_STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
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
