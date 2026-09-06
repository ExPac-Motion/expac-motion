import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  useAgents,
  useClearingAgents,
  useClients,
  useJobs,
  useLeads,
  useMailTemplates,
  useOpportunities,
  useOpsTasks,
  useQuotes,
  useRateSheet,
  useSuppliers,
  useTransporters,
} from "../lib/hooks";
import { OPPORTUNITY_STAGES } from "../lib/types";

const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

interface Hit {
  group: string;
  label: string;
  sub: string;
  to: string;
}

/** Search icon in the top nav + a spotlight palette over everything the
 *  app already caches (quotes, shipments, leads, opportunities, the four
 *  contact books, tasks, rates, templates). Opens on click or Ctrl/⌘K. */
export default function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        className="icon-btn"
        title="Search (Ctrl / ⌘ K)"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        {SearchIcon}
      </button>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only mounts while the palette is open, so these queries don't run on
  // every page load.
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const leadsQ = useLeads();
  const oppsQ = useOpportunities();
  const clientsQ = useClients();
  const suppliersQ = useSuppliers();
  const agentsQ = useAgents();
  const transportersQ = useTransporters();
  const clearingQ = useClearingAgents();
  const tasksQ = useOpsTasks();
  const ratesQ = useRateSheet();
  const templatesQ = useMailTemplates();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stageLabel = (k: string) =>
    OPPORTUNITY_STAGES.find((s) => s.key === k)?.label ?? k;

  const index = useMemo<Hit[]>(() => {
    const quotes = quotesQ.data ?? [];
    const jobs = jobsQ.data ?? [];
    const leads = leadsQ.data ?? [];
    const opps = oppsQ.data ?? [];
    const clients = clientsQ.data ?? [];
    const suppliers = suppliersQ.data ?? [];
    const agents = agentsQ.data ?? [];
    const transporters = transportersQ.data ?? [];
    const clearing = clearingQ.data ?? [];
    const tasks = tasksQ.data ?? [];
    const rates = ratesQ.data ?? [];
    const templates = templatesQ.data ?? [];
    const out: Hit[] = [];
    for (const x of quotes)
      out.push({
        group: "Quotations",
        label: x.reference,
        sub: [x.client?.company, x.supplier?.company].filter(Boolean).join(" → ") ||
          x.mode,
        to: `/quotes/${x.id}`,
      });
    for (const x of jobs)
      out.push({
        group: "Shipments",
        label: x.reference,
        sub: [x.client?.company, x.mode].filter(Boolean).join(" · "),
        to: "/jobs",
      });
    for (const x of leads)
      out.push({
        group: "Leads",
        label: x.company,
        sub: [x.contact, x.email, x.phone].filter(Boolean).join(" · "),
        to: "/crm?tab=leads",
      });
    for (const x of opps)
      out.push({
        group: "Opportunities",
        label: x.lead?.company ?? x.client?.company ?? "Opportunity",
        sub: stageLabel(x.status),
        to: "/crm?tab=opportunities",
      });
    const books: [string, typeof clients, string][] = [
      ["Customers", clients, "/clients"],
      ["Shippers", suppliers, "/suppliers"],
      ["Agents", agents, "/agents"],
      ["Transporters", transporters, "/transporters"],
      ["Clearing Agents", clearing, "/clearing-agents"],
    ];
    for (const [group, list, to] of books)
      for (const x of list)
        out.push({
          group,
          label: x.company,
          sub: [x.contact, x.email, x.phone].filter(Boolean).join(" · "),
          to,
        });
    for (const x of tasks)
      out.push({
        group: "Tasks",
        label: x.title,
        sub: [x.kind, x.status].filter(Boolean).join(" · "),
        to: "/ops?tab=tasks",
      });
    for (const x of rates)
      out.push({
        group: "Rates",
        label: x.description || x.code || x.mode,
        sub: [x.mode, [x.origin, x.destination].filter(Boolean).join("→"), x.carrier]
          .filter(Boolean)
          .join(" · "),
        to: "/rates",
      });
    for (const x of templates)
      out.push({
        group: "Templates",
        label: x.name,
        sub: x.subject,
        to: "/crm?tab=templates",
      });
    return out;
  }, [
    quotesQ.data,
    jobsQ.data,
    leadsQ.data,
    oppsQ.data,
    clientsQ.data,
    suppliersQ.data,
    agentsQ.data,
    transportersQ.data,
    clearingQ.data,
    tasksQ.data,
    ratesQ.data,
    templatesQ.data,
  ]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const scored = index.filter(
      (h) =>
        h.label.toLowerCase().includes(term) ||
        h.sub.toLowerCase().includes(term) ||
        h.group.toLowerCase().includes(term),
    );
    // keep at most 6 per group, 40 overall
    const perGroup = new Map<string, number>();
    const capped: Hit[] = [];
    for (const h of scored) {
      const n = perGroup.get(h.group) ?? 0;
      if (n >= 6) continue;
      perGroup.set(h.group, n + 1);
      capped.push(h);
      if (capped.length >= 40) break;
    }
    return capped;
  }, [q, index]);

  // Keep the highlighted row in range as results shrink.
  const activeClamped = Math.min(active, Math.max(hits.length - 1, 0));

  function go(h: Hit) {
    navigate(h.to);
    onClose();
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeClamped + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeClamped - 1, 0));
    } else if (e.key === "Enter" && hits[activeClamped]) {
      e.preventDefault();
      go(hits[activeClamped]);
    }
  }

  let lastGroup = "";

  return (
    <div className="gsearch-backdrop" onMouseDown={onClose}>
      <div
        className="gsearch"
        role="dialog"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gsearch-inputrow">
          {SearchIcon}
          <input
            ref={inputRef}
            type="search"
            placeholder="Search quotes, shipments, leads, companies, tasks…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="gsearch-results">
          {q.trim() === "" ? (
            <p className="gsearch-empty">
              Type to search across the whole system.
            </p>
          ) : hits.length === 0 ? (
            <p className="gsearch-empty">No matches for “{q}”.</p>
          ) : (
            hits.map((h, i) => {
              const head = h.group !== lastGroup ? h.group : "";
              lastGroup = h.group;
              return (
                <div key={`${h.to}-${h.label}-${i}`}>
                  {head && <div className="gsearch-group">{head}</div>}
                  <button
                    className={`gsearch-hit${i === activeClamped ? " active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                  >
                    <span className="gsearch-hit-label">{h.label}</span>
                    {h.sub && <span className="gsearch-hit-sub">{h.sub}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
