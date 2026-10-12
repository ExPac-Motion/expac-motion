// Sales CRM › Customer Messages (0158): the customers' General portal chats
// (not about a shipment), newest conversation first, with unread counts.
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ClientChatThread from "../../components/ClientChatThread";
import { EmptyState, ErrorNote, Loading, PageTools, SearchInput } from "../../components/common";
import { formatDateTime } from "../../lib/format";
import { useClients } from "../../lib/hooks";
import { useClientChats } from "../../lib/clientChat";

export default function CustomerMessagesTab() {
  const chatsQ = useClientChats();
  const clientsQ = useClients();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(
    () => (location.state as { openClientId?: string } | null)?.openClientId ?? null,
  );

  const conversations = useMemo(() => {
    const m = new Map<
      string,
      { clientId: string; company: string; email: string | null; last: string; preview: string; lastIn: boolean; unread: number }
    >();
    for (const r of chatsQ.data ?? []) {
      const c = m.get(r.client_id);
      if (!c) {
        m.set(r.client_id, {
          clientId: r.client_id,
          company: r.clients?.company ?? "Customer",
          email: r.clients?.email ?? null,
          last: r.created_at,
          preview: r.body,
          lastIn: r.direction === "in",
          unread: r.direction === "in" && !r.read_at ? 1 : 0,
        });
      } else if (r.direction === "in" && !r.read_at) {
        c.unread += 1;
      }
    }
    return [...m.values()];
  }, [chatsQ.data]);

  const n = search.trim().toLowerCase();
  const shown = n ? conversations.filter((c) => c.company.toLowerCase().includes(n) || c.preview.toLowerCase().includes(n)) : conversations;
  const unreadTotal = conversations.reduce((s, c) => s + c.unread, 0);

  const clients = clientsQ.data ?? [];
  const current =
    conversations.find((c) => c.clientId === picked) ??
    (picked
      ? (() => {
          const cl = clients.find((x) => x.id === picked);
          return cl ? { clientId: cl.id, company: cl.company, email: cl.email ?? null } : null;
        })()
      : null);

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search customer or message…" />}
        count={chatsQ.isLoading ? undefined : `${shown.length} conversation${shown.length === 1 ? "" : "s"}${unreadTotal ? ` · ${unreadTotal} unread` : ""}`}
        hint="Customers' portal chat messages that aren't about a shipment (Chat with ExPac › General). Shipment chat stays in each shipment's Comms."
        filters={
          <select value="" onChange={(e) => e.target.value && setPicked(e.target.value)} aria-label="Message a customer">
            <option value="">Message a customer…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
        }
      />
      <div className="panel">
        {chatsQ.isLoading ? (
          <Loading />
        ) : chatsQ.isError ? (
          <ErrorNote error={chatsQ.error} />
        ) : (
          <div className="cmsg-layout">
            <div className="cmsg-list">
              {shown.length === 0 ? (
                <EmptyState>{n ? `No conversations match "${search.trim()}".` : "No customer messages yet."}</EmptyState>
              ) : (
                shown.map((c) => (
                  <button
                    key={c.clientId}
                    type="button"
                    className={`cmsg-item${current?.clientId === c.clientId ? " active" : ""}`}
                    onClick={() => setPicked(c.clientId)}
                  >
                    <span className="cmsg-item-top">
                      <b>{c.company}</b>
                      <span>{formatDateTime(c.last)}</span>
                    </span>
                    <span className="cmsg-item-top">
                      <span className="cmsg-preview">
                        {c.lastIn ? "" : "You: "}
                        {c.preview}
                      </span>
                      {c.unread > 0 && <span className="cmsg-unread">{c.unread}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div>
              {current ? (
                <>
                  <div className="panel-head" style={{ marginBottom: 8 }}>
                    <h2>{current.company}</h2>
                    <Link to={`/clients/${current.clientId}?tab=messages`} className="link-btn">
                      Customer record
                    </Link>
                  </div>
                  <ClientChatThread key={current.clientId} clientId={current.clientId} company={current.company} clientEmail={current.email} />
                </>
              ) : (
                <EmptyState>Pick a conversation, or start one with "Message a customer…".</EmptyState>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
