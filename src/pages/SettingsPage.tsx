import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import MergeCodeMenu from "../components/MergeCodeMenu";
import RichTextEditor from "../components/RichTextEditor";
import { useToast } from "../components/Toast";
import {
  useCompanySettings,
  useJobs,
  useProfiles,
  useUpdateCompanySettings,
  useUpdateProfile,
  useUploadMailAsset,
} from "../lib/hooks";
import { SHIPMENT_MERGE_CODES } from "../lib/mailMerge";
import {
  DEFAULT_SHIPMENT_COMMS,
  renderShipmentEmail,
  SHIPMENT_MODE_KEYS,
  SHIPMENT_MODE_LABEL,
  shipmentCommsTemplate,
  shipmentModeKey,
} from "../lib/mailTemplates";
import type {
  CompanySettingsPatch,
  Job,
  Profile,
  ShipmentCommsConfig,
  ShipmentCommsTemplate,
  ShipmentModeKey,
  UserRole,
} from "../lib/types";
import { formatDate } from "../lib/format";

type Tab = "company" | "defaults" | "team" | "email" | "comms";

const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "Company Details" },
  { key: "defaults", label: "Quote Defaults" },
  { key: "team", label: "Team" },
  { key: "email", label: "Email" },
  { key: "comms", label: "Shipment Comms" },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "company";

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`subnav-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel">
        {tab === "company" && <CompanyTab />}
        {tab === "defaults" && <DefaultsTab />}
        {tab === "team" && <TeamTab />}
        {tab === "email" && <EmailTab />}
        {tab === "comms" && <ShipmentCommsTab />}
      </div>
    </>
  );
}

function CompanyTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      legal_name: String(fd.get("legal_name") || ""),
      reg_no: String(fd.get("reg_no") || ""),
      vat_no: String(fd.get("vat_no") || ""),
      tel: String(fd.get("tel") || ""),
      email: String(fd.get("email") || ""),
      postal_address: String(fd.get("postal_address") || ""),
      strapline: String(fd.get("strapline") || ""),
      blurb: String(fd.get("blurb") || ""),
      bank_details: String(fd.get("bank_details") || ""),
    };
    try {
      await update.mutateAsync(patch);
      toast("Company details saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Used on the printed quotation letterhead and email sign-off.
      </p>
      <div className="field">
        <label>Legal Name</label>
        <input name="legal_name" defaultValue={data.legal_name} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>Reg No</label>
          <input name="reg_no" defaultValue={data.reg_no} />
        </div>
        <div className="field">
          <label>VAT No</label>
          <input name="vat_no" defaultValue={data.vat_no} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Tel Number</label>
          <input name="tel" defaultValue={data.tel} />
        </div>
        <div className="field">
          <label>Email Address</label>
          <input name="email" type="email" defaultValue={data.email} />
        </div>
      </div>
      <div className="field">
        <label>Postal Address</label>
        <input name="postal_address" defaultValue={data.postal_address} />
      </div>
      <div className="field">
        <label>Strapline</label>
        <input name="strapline" defaultValue={data.strapline} />
      </div>
      <div className="field">
        <label>Quotation Footer Blurb</label>
        <textarea name="blurb" rows={5} defaultValue={data.blurb} />
      </div>
      <div className="field">
        <label>Banking Details (one line per field)</label>
        <textarea name="bank_details" rows={6} defaultValue={data.bank_details} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button type="submit" className="btn" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save Company Details"}
        </button>
      </div>
    </form>
  );
}

function DefaultsTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      default_fx_usd_zar: Number(fd.get("default_fx_usd_zar")) || 0,
      default_fx_cny_zar: Number(fd.get("default_fx_cny_zar")) || 0,
      default_vat_pct: Number(fd.get("default_vat_pct")) || 0,
      default_incoterm: String(fd.get("default_incoterm") || ""),
    };
    try {
      await update.mutateAsync(patch);
      toast("Defaults saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Seeded into every new quotation — still editable per quote.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Default FX Rate — USD/ZAR</label>
          <input
            name="default_fx_usd_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_usd_zar}
          />
        </div>
        <div className="field">
          <label>Default FX Rate — CNY/ZAR</label>
          <input
            name="default_fx_cny_zar"
            type="number"
            step="0.01"
            defaultValue={data.default_fx_cny_zar}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Default VAT %</label>
          <input
            name="default_vat_pct"
            type="number"
            step="0.01"
            defaultValue={data.default_vat_pct}
          />
        </div>
        <div className="field">
          <label>Default Incoterm</label>
          <input name="default_incoterm" defaultValue={data.default_incoterm} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button type="submit" className="btn" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save Defaults"}
        </button>
      </div>
    </form>
  );
}

function TeamTab() {
  const { data, isLoading, isError, error } = useProfiles();
  const update = useUpdateProfile();
  const { toast, error: toastError } = useToast();
  const [editingName, setEditingName] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (isError) return <ErrorNote error={error} />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState>No team members yet.</EmptyState>;

  async function onRole(p: Profile, role: UserRole) {
    try {
      await update.mutateAsync({ id: p.id, patch: { role } });
      toast(`${p.full_name || "Member"} is now ${role}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update role");
    }
  }

  async function onRename(p: Profile, full_name: string) {
    try {
      await update.mutateAsync({ id: p.id, patch: { full_name } });
      toast("Name updated");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update name");
    } finally {
      setEditingName(null);
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Team members are created by signing in — roles are informational for now
        (no feature is gated by role yet).
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {editingName === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.full_name ?? ""}
                      onBlur={(e) => onRename(p, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingName(null);
                      }}
                    />
                  ) : (
                    <button
                      className="btn ghost small"
                      onClick={() => setEditingName(p.id)}
                    >
                      {p.full_name || "—"}
                    </button>
                  )}
                </td>
                <td>
                  <select
                    value={p.role}
                    onChange={(e) => onRole(p, e.target.value as UserRole)}
                  >
                    <option value="admin">Admin</option>
                    <option value="user">Standard user</option>
                  </select>
                </td>
                <td className="nowrap">{formatDate(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EmailTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const uploadAsset = useUploadMailAsset();
  const { toast, error: toastError } = useToast();
  const [sig, setSig] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  const signature = sig ?? data.mail_signature_html;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      mail_sender_name: String(fd.get("mail_sender_name") || "").trim(),
      mail_reply_to: String(fd.get("mail_reply_to") || "").trim(),
      mail_signature_html: signature,
    };
    try {
      await update.mutateAsync(patch);
      toast("Email settings saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <p className="muted" style={{ marginTop: 0 }}>
          Applied to campaigns, follow-up emails and form notifications. The
          sending address stays the verified domain — only the display name
          and reply-to change.
        </p>
        <div className="grid2">
          <div className="field">
            <label>Sent-as name</label>
            <input name="mail_sender_name" defaultValue={data.mail_sender_name} />
          </div>
          <div className="field">
            <label>Reply-to address</label>
            <input
              name="mail_reply_to"
              type="email"
              defaultValue={data.mail_reply_to}
            />
          </div>
        </div>
        <div className="field">
          <label>Email signature</label>
          <RichTextEditor
            value={signature}
            onChange={setSig}
            onUploadImage={(file) => uploadAsset.mutateAsync(file)}
          />
          <span className="hint">
            Added to the bottom of every campaign and follow-up email.
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save Email Settings"}
          </button>
        </div>
      </form>

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />

      <div className="field">
        <label>Active provider</label>
        <div
          style={{
            border: "1px solid #e0e1dc",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <strong>Resend</strong>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Live — sends via the Resend API. Configured in Cloudflare Pages
            environment variables.
          </p>
        </div>
      </div>
    </>
  );
}

function ShipmentCommsTab() {
  const { data, isLoading, isError, error } = useCompanySettings();
  const jobsQ = useJobs();

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorNote error={error} />;

  return (
    <ShipmentCommsEditor
      config={data.shipment_comms ?? {}}
      jobs={jobsQ.data ?? []}
    />
  );
}

function ShipmentCommsEditor({
  config,
  jobs,
}: {
  config: ShipmentCommsConfig;
  jobs: Job[];
}) {
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  const [drafts, setDrafts] = useState<
    Record<ShipmentModeKey, ShipmentCommsTemplate>
  >(
    () =>
      Object.fromEntries(
        SHIPMENT_MODE_KEYS.map((k) => [k, shipmentCommsTemplate(k, config)]),
      ) as Record<ShipmentModeKey, ShipmentCommsTemplate>,
  );
  const [activeKey, setActiveKey] = useState<ShipmentModeKey>("sea");
  const [previewId, setPreviewId] = useState<string>("");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const draft = drafts[activeKey];
  const setDraft = (patch: Partial<ShipmentCommsTemplate>) =>
    setDrafts((d) => ({ ...d, [activeKey]: { ...d[activeKey], ...patch } }));

  const modeJobs = useMemo(
    () => jobs.filter((j) => shipmentModeKey(j.mode) === activeKey),
    [jobs, activeKey],
  );
  const previewJob =
    modeJobs.find((j) => j.id === previewId) ??
    modeJobs[0] ??
    jobs[0] ??
    null;
  const preview = previewJob
    ? renderShipmentEmail(previewJob, draft, "")
    : null;

  const dft = DEFAULT_SHIPMENT_COMMS[activeKey];
  const isDefault = draft.subject === dft.subject && draft.body === dft.body;

  async function onSave() {
    const next: ShipmentCommsConfig = {};
    for (const k of SHIPMENT_MODE_KEYS) {
      const base = DEFAULT_SHIPMENT_COMMS[k];
      const cur = drafts[k];
      if (cur.subject !== base.subject || cur.body !== base.body) {
        next[k] = { subject: cur.subject, body: cur.body };
      }
    }
    try {
      await update.mutateAsync({ shipment_comms: next });
      toast("Shipment comms templates saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The customer update email sent from a shipment's Comms panel. Each
        freight group has its own template — edit the wording and drop in{" "}
        <code>{"{{ shipment.number }}"}</code>-style codes. The preview renders a
        real shipment; missing values show blank.
      </p>

      <div
        style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}
      >
        {SHIPMENT_MODE_KEYS.map((k) => (
          <button
            key={k}
            className={`subnav-tab${activeKey === k ? " active" : ""}`}
            onClick={() => setActiveKey(k)}
          >
            {SHIPMENT_MODE_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="field">
        <div className="merge-code-row">
          <label>Subject</label>
          <MergeCodeMenu
            targetRef={subjectRef}
            onChange={(v) => setDraft({ subject: v })}
            codes={SHIPMENT_MERGE_CODES}
          />
        </div>
        <input
          ref={subjectRef}
          value={draft.subject}
          onChange={(e) => setDraft({ subject: e.target.value })}
        />
      </div>

      <div className="field">
        <div className="merge-code-row">
          <label>Email body — {SHIPMENT_MODE_LABEL[activeKey]}</label>
          <MergeCodeMenu
            targetRef={bodyRef}
            onChange={(v) => setDraft({ body: v })}
            codes={SHIPMENT_MERGE_CODES}
          />
        </div>
        <textarea
          ref={bodyRef}
          rows={20}
          value={draft.body}
          onChange={(e) => setDraft({ body: e.target.value })}
          style={{
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: "0.8rem",
          }}
        />
        <span className="hint">
          {isDefault ? (
            "Using the built-in default."
          ) : (
            <button
              type="button"
              className="link-btn"
              onClick={() => setDraft({ ...dft })}
            >
              Reset this template to the default
            </button>
          )}
        </span>
      </div>

      <div className="field">
        <label>Preview against shipment</label>
        <select
          value={previewJob?.id ?? ""}
          onChange={(e) => setPreviewId(e.target.value)}
        >
          {modeJobs.length === 0 && jobs.length > 0 && (
            <option value="">
              (no {SHIPMENT_MODE_LABEL[activeKey]} shipments yet — showing any)
            </option>
          )}
          {(modeJobs.length ? modeJobs : jobs).map((j) => (
            <option key={j.id} value={j.id}>
              {j.reference} — {j.client?.company ?? "—"}
            </option>
          ))}
        </select>
      </div>

      {preview ? (
        <div className="field">
          <label>Preview</label>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: 14,
              background: "var(--white)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              {preview.subject}
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                fontFamily:
                  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', sans-serif",
                fontSize: "11pt",
                lineHeight: 1.55,
              }}
            >
              {preview.text}
            </pre>
          </div>
        </div>
      ) : (
        <EmptyState>Add a shipment to see a preview.</EmptyState>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={onSave}
          disabled={update.isPending}
        >
          {update.isPending ? "Saving…" : "Save Shipment Comms"}
        </button>
      </div>
    </>
  );
}
