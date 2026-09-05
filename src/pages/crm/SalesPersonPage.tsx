import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { useProfiles, useQuotes, useUpdateProfile } from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import { money } from "../../lib/format";
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
  const [editing, setEditing] = useState<Profile | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);

  const people = (profilesQ.data ?? []).filter((p) => p.role !== "client");

  const stats = useMemo(() => {
    const quotes = quotesQ.data ?? [];
    const map = new Map<string, { revenue: number; gp: number }>();
    for (const q of quotes) {
      if (q.status !== "accepted" || !isThisMonth(q.accepted_at) || !q.sales_person_id) {
        continue;
      }
      const t = chargeTotals(q.quote_lines, fxOf(q));
      const cur = map.get(q.sales_person_id) ?? { revenue: 0, gp: 0 };
      cur.revenue += t.sell;
      cur.gp += t.gp;
      map.set(q.sales_person_id, cur);
    }
    return map;
  }, [quotesQ.data]);

  const isLoading = profilesQ.isLoading || quotesQ.isLoading;
  const isError = profilesQ.isError || quotesQ.isError;

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
        <ErrorNote error={profilesQ.error ?? quotesQ.error} />
      ) : people.length === 0 ? (
        <EmptyState>No team members yet — add one in Settings.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th className="actions-col">
                  <RowActionsHead />
                </th>
                <th>Name</th>
                <th>Revenue (This Month)</th>
                <th>Revenue Target</th>
                <th>Gross Profit (This Month)</th>
                <th>GP Target</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const s = stats.get(p.id) ?? { revenue: 0, gp: 0 };
                return (
                  <tr key={p.id}>
                    <td>
                      <RowActions
                        onView={() => setViewing(p)}
                        onEdit={() => setEditing(p)}
                      />
                    </td>
                    <td>
                      <strong>{p.full_name || "—"}</strong>
                    </td>
                    <td>{money(s.revenue)}</td>
                    <td>
                      {p.sales_revenue_target > 0
                        ? money(p.sales_revenue_target)
                        : "—"}
                    </td>
                    <td>{money(s.gp)}</td>
                    <td>{p.sales_gp_target > 0 ? money(p.sales_gp_target) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
        </Modal>
      )}

      {editing && (
        <TargetsModal profile={editing} onClose={() => setEditing(null)} />
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
      sales_revenue_target: Number(fd.get("sales_revenue_target")) || 0,
      sales_gp_target: Number(fd.get("sales_gp_target")) || 0,
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
