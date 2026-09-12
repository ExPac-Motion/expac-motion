import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
  useRowSelection,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  useLeads,
  useProfiles,
  useQuotes,
  useUpdateProfile,
  useUpdateProfilesBulk,
} from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import { money } from "../../lib/format";
import { WON_QUOTE_STATUSES } from "../../lib/types";
import type { Profile, ProfilePatch } from "../../lib/types";

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function SalesPersonPage() {
  const profilesQ = useProfiles();
  const quotesQ = useQuotes();
  const leadsQ = useLeads();
  const bulkUpdate = useUpdateProfilesBulk();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const people = useMemo(
    () => (profilesQ.data ?? []).filter((p) => p.role !== "client"),
    [profilesQ.data],
  );
  const sel = useRowSelection(people);

  const stats = useMemo(() => {
    const quotes = quotesQ.data ?? [];
    const map = new Map<string, { sales: number; revenue: number; gp: number }>();
    for (const q of quotes) {
      if (
        !WON_QUOTE_STATUSES.includes(q.status) ||
        !isThisMonth(q.accepted_at) ||
        !q.sales_person_id
      ) {
        continue;
      }
      const t = chargeTotals(q.quote_lines, fxOf(q));
      const cur = map.get(q.sales_person_id) ?? { sales: 0, revenue: 0, gp: 0 };
      // Total Sales = the same Grand Total (incl. VAT) formula the printable
      // quotation uses; Revenue stays the excl.-VAT figure alongside it.
      cur.sales += t.sellIncl;
      cur.revenue += t.sell;
      cur.gp += t.gp;
      map.set(q.sales_person_id, cur);
    }
    return map;
  }, [quotesQ.data]);

  const leadStats = useMemo(() => {
    const leads = leadsQ.data ?? [];
    const map = new Map<string, { total: number; converted: number }>();
    for (const l of leads) {
      if (!l.sales_person_id) continue;
      const cur = map.get(l.sales_person_id) ?? { total: 0, converted: 0 };
      cur.total += 1;
      if (l.promoted_at) cur.converted += 1;
      map.set(l.sales_person_id, cur);
    }
    return map;
  }, [leadsQ.data]);

  const isLoading = profilesQ.isLoading || quotesQ.isLoading || leadsQ.isLoading;
  const isError = profilesQ.isError || quotesQ.isError || leadsQ.isError;

  const st = (id: string) => stats.get(id) ?? { sales: 0, revenue: 0, gp: 0 };
  const leadConvRate = (id: string) => {
    const l = leadStats.get(id);
    return l && l.total > 0 ? (l.converted / l.total) * 100 : null;
  };
  const columns = useMemo<DataColumn<Profile>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 110,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (p) => (
          <RowActions
            selected={sel.isSelected(p.id)}
            onSelectToggle={() => sel.toggle(p.id)}
            onView={() => setViewing(p)}
            onEdit={() => setEditing(p)}
          />
        ),
      },
      {
        key: "name",
        header: "Name",
        width: 200,
        sortValue: (p) => (p.full_name ?? "").toLowerCase(),
        render: (p) => (
          <strong className="row-name">{p.full_name || "—"}</strong>
        ),
      },
      {
        key: "sales",
        header: "Total Sales",
        width: 150,
        sortValue: (p) => st(p.id).sales,
        render: (p) => money(st(p.id).sales),
      },
      {
        key: "sales_target",
        header: "Sales Target",
        width: 140,
        sortValue: (p) => p.sales_target,
        render: (p) => (p.sales_target > 0 ? money(p.sales_target) : "—"),
      },
      {
        key: "revenue",
        header: "Total Revenue",
        width: 150,
        sortValue: (p) => st(p.id).revenue,
        render: (p) => money(st(p.id).revenue),
      },
      {
        key: "revenue_target",
        header: "Revenue Target",
        width: 150,
        sortValue: (p) => p.sales_revenue_target,
        render: (p) =>
          p.sales_revenue_target > 0 ? money(p.sales_revenue_target) : "—",
      },
      {
        key: "gp",
        header: "Gross Profit",
        width: 150,
        sortValue: (p) => st(p.id).gp,
        render: (p) => money(st(p.id).gp),
      },
      {
        key: "gp_target",
        header: "GP Target",
        width: 130,
        sortValue: (p) => p.sales_gp_target,
        render: (p) =>
          p.sales_gp_target > 0 ? money(p.sales_gp_target) : "—",
      },
      {
        key: "leads_target",
        header: "Leads Target",
        width: 130,
        sortValue: (p) => p.leads_target,
        render: (p) => (p.leads_target > 0 ? p.leads_target : "—"),
      },
      {
        key: "leads_to_customer",
        header: "Leads to Customer",
        width: 150,
        sortValue: (p) => leadConvRate(p.id) ?? -1,
        render: (p) => {
          const pct = leadConvRate(p.id);
          return pct === null ? "—" : `${pct.toFixed(0)}%`;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, stats, leadStats],
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Sales Person</h2>
          <p>
            This calendar month's revenue &amp; gross profit, attributed to the
            salesperson on each accepted quote.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote error={profilesQ.error ?? quotesQ.error ?? leadsQ.error} />
      ) : people.length === 0 ? (
        <EmptyState>No team members yet — add one in Settings.</EmptyState>
      ) : (
        <DataTable
          tableKey="sales-person"
          className="table--compact"
          columns={columns}
          rows={people}
          rowKey={(p) => p.id}
          toolbar={
            <button
              className="btn outline btn-sm"
              onClick={() => setBulkOpen(true)}
              disabled={sel.count === 0}
              title={
                sel.count === 0
                  ? "Tick rows in the Actions column to bulk edit"
                  : undefined
              }
            >
              Bulk Edit{sel.count ? ` (${sel.count})` : ""}
            </button>
          }
        />
      )}

      {viewing && (
        <Modal
          title={`${viewing.full_name || "Team member"} — Targets`}
          onClose={() => setViewing(null)}
          headerActions={
            <button
              className="btn outline"
              onClick={() => {
                setEditing(viewing);
                setViewing(null);
              }}
            >
              Edit
            </button>
          }
        >
          <div className="field">
            <label>Sales Target</label>
            <strong>
              {viewing.sales_target > 0 ? money(viewing.sales_target) : "Not set"}
            </strong>
          </div>
          <div className="field">
            <label>Revenue Target</label>
            <strong>
              {viewing.sales_revenue_target > 0
                ? money(viewing.sales_revenue_target)
                : "Not set"}
            </strong>
          </div>
          <div className="field">
            <label>Gross Profit Target</label>
            <strong>
              {viewing.sales_gp_target > 0 ? money(viewing.sales_gp_target) : "Not set"}
            </strong>
          </div>
          <div className="field">
            <label>Leads Target</label>
            <strong>
              {viewing.leads_target > 0 ? viewing.leads_target : "Not set"}
            </strong>
          </div>
        </Modal>
      )}

      {editing && (
        <TargetsModal profile={editing} onClose={() => setEditing(null)} />
      )}

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} team member${
            sel.count === 1 ? "" : "s"
          }`}
          count={sel.count}
          noun="team member"
          busy={bulkUpdate.isPending}
          fields={[
            {
              key: "sales_target",
              label: "Sales Target (R)",
              type: "number",
              allowClear: false,
            },
            {
              key: "sales_revenue_target",
              label: "Revenue Target (R)",
              type: "number",
              allowClear: false,
            },
            {
              key: "sales_gp_target",
              label: "GP Target (R)",
              type: "number",
              allowClear: false,
            },
            {
              key: "leads_target",
              label: "Leads Target",
              type: "number",
              allowClear: false,
            },
          ]}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as ProfilePatch,
              });
              toast(`Updated ${n} team member${n === 1 ? "" : "s"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e2) {
              toastError(e2 instanceof Error ? e2.message : "Could not update");
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

function TargetsModal({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const update = useUpdateProfile();
  const { toast, error: toastError } = useToast();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: ProfilePatch = {
      sales_target: Number(fd.get("sales_target")) || 0,
      sales_revenue_target: Number(fd.get("sales_revenue_target")) || 0,
      sales_gp_target: Number(fd.get("sales_gp_target")) || 0,
      leads_target: Number(fd.get("leads_target")) || 0,
    };
    try {
      await update.mutateAsync({ id: profile.id, patch });
      toast("Targets saved");
      onClose();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <Modal title={`${profile.full_name || "Team member"} — Targets`} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Sales Target (R)</label>
          <input
            name="sales_target"
            type="number"
            step="0.01"
            defaultValue={profile.sales_target}
          />
        </div>
        <div className="field">
          <label>Revenue Target (R)</label>
          <input
            name="sales_revenue_target"
            type="number"
            step="0.01"
            defaultValue={profile.sales_revenue_target}
          />
        </div>
        <div className="field">
          <label>Gross Profit Target (R)</label>
          <input
            name="sales_gp_target"
            type="number"
            step="0.01"
            defaultValue={profile.sales_gp_target}
          />
        </div>
        <div className="field">
          <label>Leads Target</label>
          <input
            name="leads_target"
            type="number"
            defaultValue={profile.leads_target}
          />
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
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
