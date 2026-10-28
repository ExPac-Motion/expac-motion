import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorNote, Loading, PageHeader, StatusBadge, useBackTo } from "../../components/common";
import { useToast } from "../../components/Toast";
import { LeadMailHistory } from "../../components/MailHistory";
import { formatDate, money, readableText } from "../../lib/format";
import {
  useLeadContacts,
  useLeadSources,
  useLeadStatuses,
  useLeads,
  useOpsTasks,
  useProfiles,
  useQuotes,
  useSaveLead,
} from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import type { Lead, LeadPatch } from "../../lib/types";
import { RecordTasks } from "../shipments/ShipmentWorkspacePage";
import { LeadEditModal, QuickMailModal, linkify, useLeadPortalInvite } from "./LeadsPage";

/**
 * Lead page (/crm/leads/:id): one page per prospect, same build as the
 * shipment and quote pages. Summary strip with status and sales person
 * changed in place, next actions, cards that edit in place, and tabs for
 * Quotes, Mail history and Tasks. Replaces the lead View pop-up.
 */

const TABS = ["overview", "quotes", "mail", "tasks"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", quotes: "Quotes", mail: "Mail history", tasks: "Tasks" };

export default function LeadWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast, error: toastError } = useToast();
  const leadsQ = useLeads();
  const statusesQ = useLeadStatuses();
  const profilesQ = useProfiles();
  const contactsQ = useLeadContacts(id);
  const quotesQ = useQuotes();
  const tasksQ = useOpsTasks();
  const save = useSaveLead();
  const { inviting, invite } = useLeadPortalInvite();
  const [mailing, setMailing] = useState(false);
  const goBack = useBackTo("/crm?tab=leads");
  const [editingContacts, setEditingContacts] = useState(false);

  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const lead = (leadsQ.data ?? []).find((l) => l.id === id) ?? null;
  const quotes = useMemo(
    () =>
      (quotesQ.data ?? []).filter(
        (q) => q.lead_id === id || (!!lead?.promoted_client_id && q.client_id === lead.promoted_client_id),
      ),
    [quotesQ.data, id, lead?.promoted_client_id],
  );
  const tasks = useMemo(
    () => (tasksQ.data ?? []).filter((t) => t.lead_id === id && t.kind === "task"),
    [tasksQ.data, id],
  );
  const openTasks = tasks.filter((t) => t.status !== "done");

  if (leadsQ.isLoading) return <Loading />;
  if (!lead) return <ErrorNote error={new Error("Lead not found")} />;

  const statuses = statusesQ.data ?? [];
  const status = statuses.find((s) => s.id === lead.lead_status_id) ?? null;
  const staff = (profilesQ.data ?? []).filter((p) => p.role === "admin" || p.role === "user");
  const contacts = contactsQ.data ?? [];
  const openQuotes = quotes.filter((q) => q.status === "open" || q.status === "sent");
  const pipeline = openQuotes.reduce((n, q) => n + chargeTotals(q.quote_lines, fxOf(q)).sellIncl, 0);
  const wantsPortal = !lead.promoted_client_id && (lead.notes ?? "").includes("Would like access to the ExPac Motion portal.");

  function patch(p: LeadPatch, msg = "Lead saved") {
    save.mutate(
      { id: lead!.id, patch: p },
      {
        onSuccess: () => toast(msg),
        onError: (e) => toastError(e instanceof Error ? e.message : "Could not save"),
      },
    );
  }
  const newQuote = () => navigate("/quotes/new", { state: { prefill: { leadId: lead.id } } });

  const actions: { key: string; text: string; cta: string; go: () => void }[] = [];
  if (wantsPortal)
    actions.push({ key: "portal", text: "Asked for portal access on the website", cta: "Invite", go: () => void invite(lead) });
  if (!lead.email) actions.push({ key: "email", text: "No email address yet", cta: "Add", go: () => setTab("overview") });
  if (!lead.lead_status_id) actions.push({ key: "status", text: "No status set", cta: "Set above", go: () => window.scrollTo({ top: 0, behavior: "smooth" }) });
  if (quotes.length === 0) actions.push({ key: "quote", text: "No quote yet", cta: "New quote", go: newQuote });
  for (const q of quotes.filter((x) => x.status === "open" && x.quote_lines.length > 0))
    actions.push({ key: q.id, text: `${q.reference} is priced, send it`, cta: "Open", go: () => navigate(`/quotes/${q.id}/view`) });
  for (const tk of openTasks.slice(0, 5))
    actions.push({ key: tk.id, text: tk.title + (tk.due_date ? ` · due ${formatDate(tk.due_date)}` : ""), cta: "Tasks", go: () => setTab("tasks") });

  return (
    <>
      <PageHeader
        eyebrow="Leads"
        title={lead.company}
        actions={
          <>
            <button className="btn outline" onClick={goBack}>
              ← Leads
            </button>
            <button className="btn outline" onClick={() => setMailing(true)} disabled={!lead.email}>
              Send email
            </button>
            <button className="btn outline" onClick={newQuote}>
              + New quote
            </button>
            {lead.promoted_client_id ? (
              <Link className="btn" to={`/clients/${lead.promoted_client_id}`}>
                Open customer record
              </Link>
            ) : (
              <button
                className={wantsPortal ? "btn" : "btn outline"}
                onClick={() => void invite(lead)}
                disabled={inviting || !lead.email}
                title={lead.email ? "Makes this lead a customer (its quotes move with it) and emails a portal invite" : "Add an email address first"}
              >
                {inviting ? "Inviting…" : "Make customer & invite to portal"}
              </button>
            )}
          </>
        }
      />

      <div className="ws-head panel">
        <div className="ws-title">
          {status && (
            <span className="ws-status" style={{ background: status.color, color: readableText(status.color) }}>
              {status.name}
            </span>
          )}
          {lead.promoted_client_id && <span className="tag">promoted to customer {formatDate(lead.promoted_at)}</span>}
          <span className="ws-route">{[lead.contact, lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact details yet"}</span>
          <span className="ws-customer">Since {formatDate(lead.created_at)}</span>
        </div>
        <div className="ws-tiles">
          <label className="ws-tile">
            <span className="k">Status</span>
            <select
              className="ws-tile-select"
              value={lead.lead_status_id ?? ""}
              onChange={(e) => patch({ lead_status_id: e.target.value || null }, "Status updated")}
            >
              <option value="">— none —</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ws-tile">
            <span className="k">Sales person</span>
            <select
              className="ws-tile-select"
              value={lead.sales_person_id ?? ""}
              onChange={(e) => patch({ sales_person_id: e.target.value || null }, "Sales person updated")}
            >
              <option value="">— unassigned —</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <button className="ws-tile" onClick={() => setTab("quotes")}>
            <span className="k">Quotes</span>
            <b>{quotes.length}</b>
            <span className="muted">{openQuotes.length ? `${openQuotes.length} open · ${money(pipeline)}` : "none open"}</span>
          </button>
          <button className="ws-tile" onClick={() => setTab("tasks")}>
            <span className="k">Open tasks</span>
            <b>{openTasks.length}</b>
            <span className="muted">{tasks.length - openTasks.length} done</span>
          </button>
        </div>
      </div>

      <nav className="ws-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "tasks" && openTasks.length > 0 && <span className="ws-count">{openTasks.length}</span>}
            {t === "quotes" && quotes.length > 0 && <span className="ws-count">{quotes.length}</span>}
          </button>
        ))}
      </nav>

      <div className="ws-body">
        {tab === "overview" && (
          <div className="ws-overview">
            <div className="ws-actions panel">
              <div className="ws-sec-head">
                <h3>Next actions</h3>
                <span className="ws-pill">{actions.length} pending</span>
              </div>
              {actions.length === 0 ? (
                <p className="muted">Nothing pending. ✓</p>
              ) : (
                <ul>
                  {actions.map((a) => (
                    <li key={a.key}>
                      <span className="ws-bullet" />
                      <span className="grow">{a.text}</span>
                      <button className="btn ghost small" onClick={a.go}>
                        {a.cta} →
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <LeadCard
              title="Contact"
              lead={lead}
              fields={[
                ["contact", "Primary contact"],
                ["email", "Email"],
                ["phone", "Mobile phone"],
              ]}
              onSave={patch}
              extra={
                <div className="ws-contacts">
                  {contacts.map((c) => (
                    <div key={c.id} className="jv-field">
                      <span className="k">{c.role || "Contact"}</span>
                      <span className="v">{[c.name, c.email, c.phone].filter(Boolean).join(" · ")}</span>
                    </div>
                  ))}
                  <button className="link-btn" onClick={() => setEditingContacts(true)}>
                    {contacts.length ? "Edit additional contacts" : "+ Add more contacts"}
                  </button>
                </div>
              }
            />
            <div className="ws-wide jv-cards">
              <LeadCard
                title="Company"
                lead={lead}
                fields={[
                  ["company", "Company"],
                  ["company_phone", "Company phone"],
                  ["website", "Website"],
                  ["address", "Address", true],
                ]}
                onSave={patch}
              />
              <LeadCard
                title="Registration"
                lead={lead}
                fields={[
                  ["vat_no", "VAT No"],
                  ["import_code", "Import code"],
                  ["source", "Source"],
                ]}
                onSave={patch}
                sources
              />
              <LeadCard
                title="Notes"
                lead={lead}
                fields={[
                  ["description", "Description", true],
                  ["notes", "Notes", true],
                ]}
                onSave={patch}
              />
            </div>
          </div>
        )}

        {tab === "quotes" && (
          <div className="panel ws-panel">
            <div className="ws-sec-head">
              <h3>Quotes</h3>
              <button className="btn small" onClick={newQuote}>
                + New quote
              </button>
            </div>
            {quotes.length === 0 ? (
              <p className="muted">No quotes for this lead yet.</p>
            ) : (
              <table className="table--compact ws-money-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Total incl. VAT</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} className="clickable" onClick={() => navigate(`/quotes/${q.id}/view`)}>
                      <td>
                        <span className="ref-link">{q.reference}</span>
                      </td>
                      <td>
                        {q.origin || "—"} → {q.destination || "—"}
                      </td>
                      <td>
                        <StatusBadge status={q.status} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {q.quote_lines.length ? money(chargeTotals(q.quote_lines, fxOf(q)).sellIncl) : "Not priced"}
                      </td>
                      <td>{formatDate(q.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "mail" && (
          <div className="panel ws-panel">
            <LeadMailHistory leadId={lead.id} email={lead.email} />
          </div>
        )}

        {tab === "tasks" && (
          <RecordTasks tasks={tasks} defaults={{ lead_id: lead.id, title: "" }} empty="No tasks for this lead." />
        )}
      </div>

      {mailing && <QuickMailModal lead={lead} onClose={() => setMailing(false)} />}
      {editingContacts && <LeadEditModal key={lead.id} lead={lead} onClose={() => setEditingContacts(false)} />}
    </>
  );
}

type FieldKey = "company" | "contact" | "email" | "phone" | "company_phone" | "website" | "address" | "vat_no" | "import_code" | "source" | "description" | "notes";

/** A lead card that edits in place (✎), "+ add" on empty fields. */
function LeadCard({
  title,
  lead,
  fields,
  onSave,
  extra,
  sources,
}: {
  title: string;
  lead: Lead;
  fields: [FieldKey, string, boolean?][];
  onSave: (p: LeadPatch) => void;
  extra?: ReactNode;
  sources?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const sourcesQ = useLeadSources();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p: Record<string, string | null> = {};
    for (const [k] of fields) {
      const v = String(fd.get(k) ?? "").trim();
      if (k === "company" && !v) continue; // company can't be blank
      p[k] = v || null;
    }
    onSave(p as LeadPatch);
    setEditing(false);
  }
  return (
    <div className="jv-card panel">
      <h4>
        {title}
        {!editing && (
          <button type="button" className="jv-edit" onClick={() => setEditing(true)} title={`Edit ${title.toLowerCase()}`}>
            ✎
          </button>
        )}
      </h4>
      {editing ? (
        <form className="jv-form" onSubmit={onSubmit}>
          {fields.map(([k, label, long]) => (
            <label key={k}>
              {label}
              {long ? (
                <textarea name={k} rows={3} defaultValue={lead[k] ?? ""} />
              ) : k === "source" && sources ? (
                <select name={k} defaultValue={lead.source ?? ""}>
                  <option value="">—</option>
                  {lead.source && !(sourcesQ.data ?? []).some((s) => s.name === lead.source) && <option value={lead.source}>{lead.source}</option>}
                  {(sourcesQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input name={k} type={k === "email" ? "email" : "text"} defaultValue={lead[k] ?? ""} />
              )}
            </label>
          ))}
          <div className="jv-form-foot">
            <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn small">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          {fields.map(([k, label, long]) => {
            const v = lead[k];
            return long ? (
              <div key={k} className="jv-long">
                <span className="k">{label}</span>
                {v ? <p>{linkify(v)}</p> : <button className="jv-add" onClick={() => setEditing(true)}>+ add</button>}
              </div>
            ) : (
              <div key={k} className="jv-field">
                <span className="k">{label}</span>
                {v ? (
                  <span className="v">
                    {k === "email" ? <a href={`mailto:${v}`}>{v}</a> : k === "phone" || k === "company_phone" ? <a href={`tel:${v.replace(/[^+\d]/g, "")}`}>{v}</a> : k === "website" ? <a href={v.startsWith("http") ? v : `https://${v}`} target="_blank" rel="noopener noreferrer">{v}</a> : v}
                  </span>
                ) : (
                  <button type="button" className="jv-add" onClick={() => setEditing(true)}>
                    + add
                  </button>
                )}
              </div>
            );
          })}
          {extra}
        </>
      )}
    </div>
  );
}
