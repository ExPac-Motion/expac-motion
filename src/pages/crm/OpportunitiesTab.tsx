import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import { EmptyState, Loading, MailLink } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useClients,
  useDeleteOpportunity,
  useCreateOpportunity,
  useJobs,
  useLeads,
  useOpportunities,
  useProfiles,
  useQuotes,
  useUpdateOpportunity,
} from "../../lib/hooks";
import { money } from "../../lib/format";
import {
  OPPORTUNITY_STAGES,
  type Opportunity,
  type OpportunityPatch,
  type OpportunityStatus,
} from "../../lib/types";

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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const del = useDeleteOpportunity();
  const { toast, error: toastError } = useToast();

  const opps = oppsQ.data ?? [];

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

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Move a card to a new stage with its status dropdown.
        </p>
        <button className="btn" onClick={() => setCreating(true)}>
          + New Opportunity
        </button>
      </div>

      {opps.length === 0 ? (
        <div className="panel">
          <EmptyState>
            No opportunities yet. Add one here, or open a lead and click "+ Add
            Opportunity".
          </EmptyState>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${OPPORTUNITY_STAGES.length}, minmax(260px, 1fr))`,
            gap: 14,
            overflowX: "auto",
          }}
        >
          {OPPORTUNITY_STAGES.map((stage) => {
            const rows = opps.filter((o) => o.status === stage.key);
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
  onEdit,
  onDelete,
}: {
  opportunity: Opportunity;
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
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 10,
        background: "var(--white)",
      }}
    >
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
      <div style={{ fontWeight: 700, margin: "4px 0" }}>{money(o.value)}</div>
      {contact && (
        <div className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {contact}
          {email && <MailLink email={email} />}
        </div>
      )}
      {o.sales_person?.full_name && (
        <div className="muted small">Rep: {o.sales_person.full_name}</div>
      )}
      {o.quote && (
        <div className="muted small">
          Quote:{" "}
          <Link to={`/quotes/${o.quote.id}`}>{o.quote.reference}</Link>
        </div>
      )}
      {o.job && (
        <div className="muted small">Shipment: {o.job.reference}</div>
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
