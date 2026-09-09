import { useMemo, useState } from "react";
import Modal from "../../components/Modal";
import RichTextEditor from "../../components/RichTextEditor";
import {
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  useAllCampaignRecipients,
  useDeleteMailCampaign,
  useLeadStatuses,
  useLeads,
  useMailCampaignRecipients,
  useMailCampaigns,
  useMailTemplates,
  useSendCampaign,
  useUploadMailAsset,
} from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import type {
  MailCampaign,
  MailCampaignStatus,
  MailRecipientStatus,
} from "../../lib/types";

function campaignTone(s: MailCampaignStatus): string {
  if (s === "failed") return "alert";
  if (s === "sent") return "done";
  if (s === "sending") return "mid";
  return "start";
}
function recipientTone(s: MailRecipientStatus): string {
  if (s === "failed" || s === "bounced") return "alert";
  if (s === "delivered" || s === "opened" || s === "clicked") return "done";
  if (s === "sent") return "mid";
  return "start";
}

interface Tracking {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
}
/** Cumulative funnel: an opened email also counts as sent + delivered. */
function funnel(statuses: MailRecipientStatus[]): Tracking {
  const t = { sent: 0, delivered: 0, opened: 0, clicked: 0 };
  for (const s of statuses) {
    if (s !== "pending" && s !== "failed") t.sent += 1;
    if (s === "delivered" || s === "opened" || s === "clicked") t.delivered += 1;
    if (s === "opened" || s === "clicked") t.opened += 1;
    if (s === "clicked") t.clicked += 1;
  }
  return t;
}

function TrackingCell({ t }: { t: Tracking | undefined }) {
  if (!t) return <span className="hint">—</span>;
  return (
    <div className="track-cell">
      <span>Sent <b>{t.sent}</b></span>
      <span>Delivered <b>{t.delivered}</b></span>
      <span>Opened <b>{t.opened}</b></span>
      <span>Clicked <b>{t.clicked}</b></span>
    </div>
  );
}

function CampaignDetailModal({
  campaign,
  onClose,
}: {
  campaign: MailCampaign;
  onClose: () => void;
}) {
  const { data, isLoading } = useMailCampaignRecipients(campaign.id);
  const recipients = data ?? [];

  const stats = useMemo(() => {
    const count = (s: MailRecipientStatus) =>
      (data ?? []).filter((r) => r.status === s).length;
    return {
      total: (data ?? []).length,
      sent: count("sent"),
      delivered: count("delivered"),
      opened: count("opened"),
      clicked: count("clicked"),
      bounced: count("bounced"),
      failed: count("failed"),
    };
  }, [data]);

  return (
    <Modal title={campaign.name} onClose={onClose} wide>
      <div className="field">
        <label>Subject</label>
        <strong>{campaign.subject}</strong>
      </div>
      <div className="field">
        <label>Status</label>
        <span className={`ms-tag tone-${campaignTone(campaign.status)}`}>
          {campaign.status}
        </span>
        {campaign.sent_at && (
          <span className="hint"> · sent {formatDateTime(campaign.sent_at)}</span>
        )}
      </div>
      <div className="field">
        <label>Recipients ({stats.total})</label>
        <div className="chips" style={{ marginBottom: 10 }}>
          <span className="tag">Sent {stats.sent}</span>
          <span className="tag">Delivered {stats.delivered}</span>
          <span className="tag">Opened {stats.opened}</span>
          <span className="tag">Clicked {stats.clicked}</span>
          {stats.bounced > 0 && (
            <span className="tag" style={{ background: "#fdecea", color: "#b3261e" }}>
              Bounced {stats.bounced}
            </span>
          )}
          {stats.failed > 0 && (
            <span className="tag" style={{ background: "#fdecea", color: "#b3261e" }}>
              Failed {stats.failed}
            </span>
          )}
        </div>
        {isLoading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>{r.lead?.company ?? "—"}</td>
                    <td>{r.email}</td>
                    <td>
                      <span className={`ms-tag tone-${recipientTone(r.status)}`}>
                        {r.status}
                      </span>
                      {r.error && <div className="hint">{r.error}</div>}
                    </td>
                    <td className="nowrap">
                      {r.sent_at ? formatDateTime(r.sent_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const { data: templates } = useMailTemplates();
  const { data: leads } = useLeads();
  const { data: statuses } = useLeadStatuses();
  const uploadAsset = useUploadMailAsset();
  const send = useSendCampaign();
  const { toast, error: toastError } = useToast();

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [statusIds, setStatusIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(
    null,
  );

  function onPickTemplate(id: string) {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) {
      setName(t.name);
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  // Every lead we're allowed to email — the pool the picker and Send draw from.
  const mailable = useMemo(
    () => (leads ?? []).filter((l) => l.email && !l.unsubscribed_at),
    [leads],
  );
  // …narrowed by the status chips and the search box (what's shown in the list).
  const eligibleLeads = useMemo(() => {
    let list = mailable;
    if (statusIds.size)
      list = list.filter(
        (l) => l.lead_status_id && statusIds.has(l.lead_status_id),
      );
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((l) =>
        [l.company, l.contact, l.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    return list;
  }, [mailable, statusIds, search]);

  const selectedCount = useMemo(
    () => mailable.filter((l) => selected.has(l.id)).length,
    [mailable, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStatus(id: string) {
    setStatusIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSend() {
    if (!name.trim()) return toastError("Campaign name is required");
    if (!subject.trim()) return toastError("Subject is required");
    if (selectedCount === 0) return toastError("Pick at least one recipient");

    const recipients = mailable
      .filter((l) => selected.has(l.id))
      .map((l) => ({
        leadId: l.id,
        email: l.email as string,
        name: l.contact || l.company,
        company: l.company,
      }));

    setProgress({ sent: 0, total: recipients.length });
    try {
      await send.mutateAsync({
        templateId: templateId || null,
        name: name.trim(),
        subject: subject.trim(),
        body,
        recipients,
        onProgress: (sent, total) => setProgress({ sent, total }),
      });
      toast("Campaign sent");
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not send campaign");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Modal title="New Campaign" onClose={onClose} wide>
      <div className="field">
        <label>Template</label>
        <select value={templateId} onChange={(e) => onPickTemplate(e.target.value)}>
          <option value="">Start from scratch</option>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Campaign Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label>Body</label>
        <RichTextEditor
          value={body}
          onChange={setBody}
          onUploadImage={(file) => uploadAsset.mutateAsync(file)}
        />
      </div>
      <div className="field">
        <label>
          Recipients ({selectedCount} selected) — Leads only, must have an email
          and not be unsubscribed
        </label>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            type="search"
            placeholder="Search name, company or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 220px", minWidth: 180 }}
          />
          <button
            type="button"
            className="btn outline btn-sm"
            onClick={() =>
              setSelected(
                (prev) =>
                  new Set([...prev, ...eligibleLeads.map((l) => l.id)]),
              )
            }
          >
            Select all shown ({eligibleLeads.length})
          </button>
          <button
            type="button"
            className="btn outline btn-sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
        {(statuses ?? []).length > 0 && (
          <div className="chips" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={`chip${statusIds.size === 0 ? " on" : ""}`}
              onClick={() => setStatusIds(new Set())}
            >
              All statuses
            </button>
            {(statuses ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip${statusIds.has(s.id) ? " on" : ""}`}
                onClick={() => toggleStatus(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="lead-picker">
          {eligibleLeads.length === 0 ? (
            <p className="hint">
              No eligible leads match the current status / search (recipients also
              need an email and must not be unsubscribed).
            </p>
          ) : (
            eligibleLeads.map((l) => (
              <label key={l.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.has(l.id)}
                  onChange={() => toggle(l.id)}
                />
                {l.company}
                {l.contact ? ` — ${l.contact}` : ""}{" "}
                <span className="hint">{l.email}</span>
              </label>
            ))
          )}
        </div>
      </div>
      {progress && (
        <div className="field">
          <label>
            Sending… {progress.sent} / {progress.total}
          </label>
          <progress value={progress.sent} max={progress.total} style={{ width: "100%" }} />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn outline" onClick={onClose} disabled={send.isPending}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onSend} disabled={send.isPending}>
          {send.isPending
            ? "Sending…"
            : `Send to ${selectedCount} recipient${selectedCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}

export default function CampaignsPage() {
  const { data, isLoading, isError, error } = useMailCampaigns();
  const recipientsQ = useAllCampaignRecipients();
  const remove = useDeleteMailCampaign();
  const { toast, error: toastError } = useToast();

  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<MailCampaign | null>(null);

  const rows = data ?? [];

  const trackingByCampaign = useMemo(() => {
    const grouped = new Map<string, MailRecipientStatus[]>();
    for (const r of recipientsQ.data ?? []) {
      const arr = grouped.get(r.campaign_id) ?? [];
      arr.push(r.status);
      grouped.set(r.campaign_id, arr);
    }
    const out = new Map<string, Tracking>();
    for (const [id, statuses] of grouped) out.set(id, funnel(statuses));
    return out;
  }, [recipientsQ.data]);

  async function onDelete(row: MailCampaign) {
    if (
      !window.confirm(
        `Delete campaign "${row.name}"? This only removes its record here — it does not unsend mail already delivered.`,
      )
    )
      return;
    try {
      await remove.mutateAsync(row.id);
      toast("Campaign deleted");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const columns = useMemo<DataColumn<MailCampaign>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 90,
        header: <RowActionsHead />,
        render: (c) => (
          <RowActions onView={() => setViewing(c)} onDelete={() => onDelete(c)} />
        ),
      },
      {
        key: "name",
        header: "Name",
        width: 220,
        sortValue: (c) => c.name.toLowerCase(),
        render: (c) => <strong className="row-name">{c.name}</strong>,
      },
      {
        key: "subject",
        header: "Subject",
        width: 280,
        sortValue: (c) => c.subject.toLowerCase(),
        render: (c) => c.subject,
      },
      {
        key: "status",
        header: "Status",
        width: 120,
        sortValue: (c) => c.status,
        render: (c) => (
          <span className={`ms-tag tone-${campaignTone(c.status)}`}>
            {c.status}
          </span>
        ),
      },
      {
        key: "tracking",
        header: "Tracking",
        width: 160,
        render: (c) => <TrackingCell t={trackingByCampaign.get(c.id)} />,
      },
      {
        key: "sent",
        header: "Sent",
        width: 160,
        cellClass: "nowrap",
        sortValue: (c) => c.sent_at ?? "",
        render: (c) => (c.sent_at ? formatDateTime(c.sent_at) : "—"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackingByCampaign],
  );

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{rows.length} campaign{rows.length === 1 ? "" : "s"}</h2>
            <p>
              Send a template to a chosen set of leads. Sends run immediately from
              this browser tab — there's no scheduler yet, so "on specific days"
              still means opening this page and clicking Send that day.
            </p>
          </div>
          <button className="btn" onClick={() => setCreating(true)}>
            + New Campaign
          </button>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No campaigns sent yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="mail-campaigns"
            className="table--compact"
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
          />
        )}
      </div>

      {creating && <NewCampaignModal onClose={() => setCreating(false)} />}
      {viewing && (
        <CampaignDetailModal campaign={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
