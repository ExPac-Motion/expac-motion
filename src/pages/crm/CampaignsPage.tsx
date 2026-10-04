import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import MergeCodeMenu from "../../components/MergeCodeMenu";
import RichTextEditor from "../../components/RichTextEditor";
import DateInput from "../../components/DateInput";
import TimeInput from "../../components/TimeInput";
import { useQueryClient } from "@tanstack/react-query";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  useDeepLinkReturn,
  useRowSelection,
  CanDelete,
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
  useScheduleCampaign,
  useSendCampaign,
  useUpdateMailCampaign,
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
  if (s === "sending" || s === "scheduled") return "mid";
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
            <span className="tag" style={{ background: "var(--orange-tint)", color: "var(--orange-ink)" }}>
              Bounced {stats.bounced}
            </span>
          )}
          {stats.failed > 0 && (
            <span className="tag" style={{ background: "var(--orange-tint)", color: "var(--orange-ink)" }}>
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
  const schedule = useScheduleCampaign();
  const { toast, error: toastError } = useToast();
  const [when, setWhen] = useState<"now" | "later">("later");
  const [schedDate, setSchedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [schedTime, setSchedTime] = useState("08:00");
  const busy = send.isPending || schedule.isPending;

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const subjectRef = useRef<HTMLInputElement>(null);
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

    if (when === "later") {
      if (!schedDate || !schedTime) return toastError("Pick a date and time to send");
      const at = new Date(`${schedDate}T${schedTime}:00`);
      if (Number.isNaN(at.getTime())) return toastError("That date / time isn't valid");
      if (at.getTime() < Date.now() - 60_000)
        return toastError("That time has already passed — pick a later one");
      try {
        await schedule.mutateAsync({
          templateId: templateId || null,
          name: name.trim(),
          subject: subject.trim(),
          body,
          recipients,
          scheduledAt: at.toISOString(),
        });
        toast(`Campaign scheduled for ${formatDateTime(at.toISOString())}`);
        onClose();
      } catch (e) {
        toastError(e instanceof Error ? e.message : "Could not schedule campaign");
      }
      return;
    }

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
        <div className="merge-code-row">
          <label>Subject</label>
          <MergeCodeMenu targetRef={subjectRef} onChange={setSubject} />
        </div>
        <input
          ref={subjectRef}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
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
      <div className="field">
        <label>When</label>
        <div className="camp-when">
          <label className="check">
            <input
              type="radio"
              name="camp-when"
              checked={when === "later"}
              onChange={() => setWhen("later")}
            />
            Schedule
          </label>
          {when === "later" && (
            <>
              <DateInput value={schedDate} onChange={setSchedDate} />
              <TimeInput value={schedTime} onChange={setSchedTime} />
            </>
          )}
          <label className="check">
            <input
              type="radio"
              name="camp-when"
              checked={when === "now"}
              onChange={() => setWhen("now")}
            />
            Send now from this tab
          </label>
        </div>
        <span className="hint">
          {when === "later"
            ? "Sent by the server at that time — you can close the app. Change or cancel it any time before then."
            : "Keep this tab open until it finishes."}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn outline" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onSend} disabled={busy}>
          {send.isPending
            ? "Sending…"
            : schedule.isPending
              ? "Scheduling…"
              : when === "later"
                ? `Schedule for ${selectedCount} recipient${selectedCount === 1 ? "" : "s"}`
                : `Send to ${selectedCount} recipient${selectedCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}

function RescheduleModal({
  campaign,
  onClose,
}: {
  campaign: MailCampaign;
  onClose: () => void;
}) {
  const update = useUpdateMailCampaign();
  const { toast, error: toastError } = useToast();
  const start = new Date(campaign.scheduled_at ?? Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  const [date, setDate] = useState(
    `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  );
  const [time, setTime] = useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`);

  async function onSave() {
    const at = new Date(`${date}T${time}:00`);
    if (Number.isNaN(at.getTime())) return toastError("That date / time isn't valid");
    if (at.getTime() < Date.now() - 60_000)
      return toastError("That time has already passed — pick a later one");
    try {
      await update.mutateAsync({
        id: campaign.id,
        patch: { scheduled_at: at.toISOString() },
      });
      toast(`Rescheduled for ${formatDateTime(at.toISOString())}`);
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not reschedule");
    }
  }

  return (
    <Modal title={`Reschedule — ${campaign.name}`} onClose={onClose}>
      <div className="field">
        <label>Send at</label>
        <div className="camp-when">
          <DateInput value={date} onChange={setDate} />
          <TimeInput value={time} onChange={setTime} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

export default function CampaignsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, isLoading, isError, error } = useMailCampaigns();
  const recipientsQ = useAllCampaignRecipients();
  const remove = useDeleteMailCampaign();
  const updateCampaign = useUpdateMailCampaign();
  const qc = useQueryClient();
  const { toast, error: toastError } = useToast();

  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState<MailCampaign | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // While anything is scheduled / going out, refresh every 30s so the
  // status and tracking columns follow the server-side sender.
  const anyLive = (data ?? []).some(
    (c) => c.status === "scheduled" || c.status === "sending",
  );
  useEffect(() => {
    if (!anyLive) return;
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["mail_campaigns"] });
      qc.invalidateQueries({ queryKey: ["mail_campaign_recipients"] });
    }, 30_000);
    return () => window.clearInterval(t);
  }, [anyLive, qc]);

  async function onSendNow(c: MailCampaign) {
    if (!window.confirm(`Send "${c.name}" now instead of at its scheduled time?`)) return;
    try {
      await updateCampaign.mutateAsync({
        id: c.id,
        patch: { scheduled_at: new Date().toISOString() },
      });
      toast("Sending within the next minute");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function onCancelSchedule(c: MailCampaign) {
    if (!window.confirm(`Cancel the scheduled send of "${c.name}"? Nothing will go out.`)) return;
    try {
      await updateCampaign.mutateAsync({ id: c.id, patch: { status: "cancelled" } });
      toast("Scheduled send cancelled");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not cancel");
    }
  }
  const [viewing, setViewing] = useState<MailCampaign | null>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const sel = useRowSelection(rows);
  const { arm, closeAndReturn } = useDeepLinkReturn();

  // Deep-link from a Notification: navigate here with
  // { state: { openCampaignId } } to pop the existing detail modal open on a
  // specific campaign, same as clicking "View" on its row. Closing it then
  // returns to Notifications instead of stranding the user here.
  useEffect(() => {
    const openId = (location.state as { openCampaignId?: string } | null)
      ?.openCampaignId;
    if (!openId || rows.length === 0) return;
    const row = rows.find((r) => r.id === openId);
    if (row) {
      setViewing(row);
      arm();
      navigate(location.pathname + location.search, {
        replace: true,
        state: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, rows]);

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

  async function onBulkDelete() {
    const n = sel.count;
    if (
      !window.confirm(
        `Delete ${n} campaign${n === 1 ? "" : "s"}? This only removes the records here — mail already delivered stays delivered, and any scheduled ones won't go out.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      for (const id of sel.ids) await remove.mutateAsync(id);
      toast(`Deleted ${n} campaign${n === 1 ? "" : "s"}`);
      sel.clear();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBulkBusy(false);
    }
  }

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
        width: 130,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (c) => (
          <RowActions
            selected={sel.isSelected(c.id)}
            onSelectToggle={() => sel.toggle(c.id)}
            onView={() => setViewing(c)}
            onDelete={() => onDelete(c)}
          />
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
        key: "scheduled",
        header: "Scheduled",
        width: 250,
        cellClass: "nowrap",
        sortValue: (c) => c.scheduled_at ?? "",
        render: (c) =>
          c.status === "scheduled" && c.scheduled_at ? (
            <span className="camp-sched">
              {formatDateTime(c.scheduled_at)}
              <button className="link-btn" onClick={() => setRescheduling(c)}>
                Change
              </button>
              <button className="link-btn" onClick={() => onSendNow(c)}>
                Send now
              </button>
              <button className="link-btn" onClick={() => onCancelSchedule(c)}>
                Cancel
              </button>
            </span>
          ) : c.scheduled_at ? (
            formatDateTime(c.scheduled_at)
          ) : (
            "—"
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
    [trackingByCampaign, sel],
  );

  return (
    <>
      <PageTools
        count={isLoading ? undefined : `${rows.length} campaign${rows.length === 1 ? "" : "s"}`}
        hint="Send a template to a chosen set of leads — now, or scheduled for a date and time (sent by the server; the app doesn't need to be open)."
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setCreating(true)}>
            + New Campaign
          </button>
        }
      >
        <CanDelete>
        <button
          className="btn danger"
          onClick={onBulkDelete}
          disabled={sel.count === 0 || bulkBusy}
          title={sel.count === 0 ? "Tick rows in the Actions column to delete" : undefined}
        >
          Delete{sel.count ? ` (${sel.count})` : ""}
        </button>
        </CanDelete>
      </PageTools>

      <div className="panel">

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
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
          />
        )}
      </div>

      {creating && <NewCampaignModal onClose={() => setCreating(false)} />}
      {rescheduling && (
        <RescheduleModal
          campaign={rescheduling}
          onClose={() => setRescheduling(null)}
        />
      )}
      {viewing && (
        <CampaignDetailModal
          campaign={viewing}
          onClose={() => closeAndReturn(() => setViewing(null))}
        />
      )}
    </>
  );
}

