# Motion AI, design proposal (Deliverable 1)

Status: **approved 2026-11-04. Stage 1 built (migration 0214, motion-ai-chat, chat panel).**
Date: 2026-11-04

Decisions: Supabase CLI via npx (user signs in), daily briefing 05:00 weekdays SAST, Motion AI admin-only to start (permission `motion_ai`).

One shared engine, three bots on top of it. Phase 1 builds the engine plus the Operations bot. Sales and Support bots later become new rows in a table (prompt + allowed tools), not new code paths.

---

## 1. How it fits together

```
 Browser (Motion chat panel, approval cards, Settings screens)
      |  user's own login token
      v
 Supabase Edge Functions  (holds ANTHROPIC_API_KEY as a Supabase secret)
   motion-ai-chat     chat turns, streams the reply
   motion-ai-action   approve / edit / reject / undo an AI action
   motion-ai-worker   runs triggers and schedules (called by pg_cron every minute)
   _shared/           the foundation every bot uses:
                      Claude client, tool registry, autonomy check,
                      knowledge lookup, audit logger
      |
      v
 Postgres: our tables, read and written only through named tools
```

Key rules:

- **The model never touches the database directly.** It can only call tools from its bot's allowed list. Each tool is a small, fixed piece of code (one query or one existing RPC).
- **Tools run as the person.** In chat, a tool uses the logged-in user's token, so normal RLS applies. A portal bot can only ever see `my_client_id()` data because the database refuses anything else, not because the prompt says so.
- **Approved actions run as the approver.** When you click Approve, the action executes with your token, so existing history (for example `job_status_history.changed_by`) shows a real person.
- **Triggers and schedules** have no logged-in user, so they run with the service key. Only the internal Operations bot may run this way. Portal bots can never run under the service key; the worker refuses.
- **Model is a setting, per kind of work** (`ai_settings.models`), editable in Settings with no deploy:

  | Work | Default model | Why |
  |---|---|---|
  | Chat | `claude-sonnet-5-5` | Fast, strong at tool use, mid price |
  | Daily briefing | `claude-sonnet-5-5` | Summarising data, once a day |
  | Trigger triage | `claude-haiku-5-5` | Many small "does this need action?" checks, very cheap |
  | Deep drafting (quotes) | `claude-opus-5-5` | Pricing mistakes cost money; worth the best model |

  Refusals fall back to another model on the server (`fallbacks: "default"`), and the fixed prompt + tool list is prompt-cached to cut cost.

---

## 2. Schema changes (new migrations from 0214)

All new tables: RLS on; staff read; admins edit settings; inserts into the log only from the Edge Functions.

| Table | What it holds |
|---|---|
| `ai_settings` | One row: model, effort level, monthly spend cap, daily briefing time, master on/off switch. |
| `ai_bots` | One row per bot: `key` (ops / sales / support), name, system prompt, allowed tool list, audience (staff / bdr / portal), enabled. Phase 1 seeds `ops` only. |
| `ai_action_policies` | Autonomy level per bot + action: `suggest` / `draft` / `auto`. Every row starts at `draft`. External email is locked to `draft` in phase 1. |
| `ai_conversations` | One chat or one automated run: bot, user (or trigger), source (chat / trigger / schedule), title. |
| `ai_messages` | The turns of each conversation, including tool calls and results, token counts. |
| `ai_actions` | Every write the bot wants to make: tool, input, status (suggested / awaiting approval / executed / rejected / undone / failed), who decided, the edited version if a human changed it, and the "before" values needed for undo. This is the approval queue and the oversight dashboard's data. |
| `ai_audit_log` | Append-only: who or what triggered it, bot, tool, inputs, result, error, tokens, cost, timestamp. Every model call and every tool call writes one row. Admin read only, nobody can edit or delete. |
| `ai_triggers` | The trigger catalogue: key, event or cron schedule, which bot, instruction template, enabled. |
| `ai_events` | The work queue: one row per thing that happened (new lead, status change, task overdue...). Status queued / running / done / failed, attempts, error. Gives retries and lets you see what fired. |
| `ai_knowledge` | Knowledge base: scope (all bots or one), kind (SOP / pricing rule / tone guide / example / learned correction), title, body, active flag, source (manual or learned from action X). Full-text search index. |
| `ai_feedback` | Every human approve / edit / reject / thumbs-down on AI output: original, edited version, note, who. |

Small changes to existing tables:
- `quotes.ai_draft boolean` so AI-drafted quotes show an "AI draft" badge until a person saves them.
- New permission `motion_ai` in Roles & Permissions (who can use the chat).

---

## 3. Tool list, phase 1 (Operations bot)

**Read tools** (always allowed, no approval needed):

| Tool | Reads |
|---|---|
| `search_shipments` / `get_shipment` | `jobs`, status history, timeline steps, packing list, tracking, Motion WMS hub status (`job_hubs`, `wms_hub_sync`) |
| `search_quotes` / `get_quote` | `quotes`, quote lines |
| `search_clients` / `get_client` | `clients`, contacts, shippers |
| `search_suppliers` | `suppliers` and partners (agents, transporters, clearing agents) |
| `search_leads` / `search_opportunities` | CRM leads, opportunities, quote pipeline cards |
| `list_tasks` | `ops_tasks` (filters: overdue, mine, by shipment) |
| `get_alerts` | Control Tower signals: `system_health`, tracking exceptions, ETA due, overdue tasks, expiring quotes |
| `lookup_rates` | Rates & Tariff Sheet (`tariff_sheets` by route, mode and tier) |
| `search_knowledge` | `ai_knowledge` |
| `build_briefing` | One call that gathers the daily briefing figures |

**Action tools** (each goes through its autonomy level):

| Tool | Does | Undo |
|---|---|---|
| `create_task` / `create_note` | Insert into `ops_tasks`, linked to the shipment / quote / customer | Remove it |
| `update_shipment_status` | Sets `jobs.shipment_status` the normal way (history trigger fires) | Set back to the previous status |
| `draft_quote` | Calls the existing `save_quote` with rates from the tariff sheet, status New Lead, `ai_draft = true` | Delete the draft |
| `draft_email` | Customer / supplier email draft; sent only when a person clicks **Approve & send** (uses the existing `/api/send-mail`, so signature and merge codes still work) | No undo once sent, which is why it can't go to auto |

What the levels mean:
- **Suggest only**: the bot describes the action in chat; nothing is saved to the queue.
- **Draft for approval**: saved to `ai_actions` as an approval card (in chat and in the oversight dashboard) with Approve, Edit, Reject.
- **Auto-execute**: runs straight away, logged, shown in the dashboard with Undo.

---

## 4. Trigger framework

Two ways work gets into the `ai_events` queue:

1. **Database triggers** (instant, on change): new lead, new web form enquiry (`web_form_submissions`), shipment status change, shipment marked Detained.
2. **pg_cron scans** (time-based): quote follow-up due, task overdue, ETA delay (ETA passed and not arrived), daily briefing.

Then `pg_cron` calls `motion-ai-worker` every minute (same pattern and secret check as today's `private.call_job()`, and it reports into System health). The worker picks up queued events, runs the bot for each one, and the bot's output lands as approval cards, tasks or a briefing.

Safeguards: duplicate events are merged (one "quote follow-up" per quote per day), failed events retry 3 times then raise an alert, and the monthly spend cap pauses automated runs (chat still works).

WhatsApp: there's no WhatsApp connection in Motion today, so the "new WhatsApp enquiry" trigger is built but has nothing to fire it until WhatsApp is connected.

---

## 5. Learning loop and knowledge base

- **Retrieval:** before each bot turn, the top matching active `ai_knowledge` entries for that bot are added to its context (Postgres full-text search, so no extra service or key). We can add semantic search later if it isn't finding things well.
- **Capture:** every Approve, Edit-then-approve, Reject (with optional reason) and thumbs up / down writes to `ai_feedback`.
- **Feed back:** when you edit an AI draft and approve it, the "before → after" becomes a *learned example* in `ai_knowledge`. It starts as **pending review** and only goes live after you approve it in the Learned screen.
- **Admin screen:** Settings › Motion AI › Knowledge: add / edit SOPs, pricing rules, tone guide, approved examples; a "Learned" tab to approve, edit or delete what the bots picked up.

---

## 6. Oversight

- **Settings › Motion AI**: model, spend cap, briefing time, per-action autonomy levels, bot prompts (admin only).
- **Oversight dashboard** (Control Tower › Motion AI tab): every action with status, who or what triggered it, filters, Undo where possible, link to the full conversation and audit trail.
- **Alerts**: a Control Tower chip for "AI awaiting approval" and "AI errors"; repeated errors or a trigger failing also raise a System health alert, which emails you (existing Resend path).

---

## 7. Beyond the brief: making it learn and earn trust

Added because the goal is a self-improving, AI-run forwarder, not just a chat box:

1. **Trust scorecard per action.** Approval rate, edit rate and rejection rate per action type. When an action reaches, say, 30 approvals in a row with no edits, the dashboard *suggests* promoting it to Auto. Promotion stays your click. (Stage 2.)
2. **Replay tests before any change.** Approved outputs become a test set. Before switching model or editing a prompt, the bot re-runs them and shows what changed, so an upgrade can't quietly make it worse. (Stage 5.)
3. **Spend view.** Cost per bot, per day, per action, against the monthly cap. (Stage 2.)
4. **Next big wins after phase 1** (options, not yet scheduled):
   - Support bot reads the support@ Inbox (already synced) and drafts replies and tasks.
   - Document reading: supplier invoices, bills of lading, AWBs, packing lists → fields filled on the shipment, for you to check.
   - WhatsApp Business connection, so WhatsApp enquiries reach the same triggers.
   - Semantic (meaning-based) knowledge search once the knowledge base grows.

## 8. Build stages (each one testable on the live site)

1. **Chat that can look things up.** Tables for settings / bots / conversations / audit log, `motion-ai-chat`, all read tools, the chat panel. Test: ask about shipments, quotes, tasks.
2. **Actions and approvals.** `ai_actions`, `ai_action_policies`, task / note / status tools, approval cards, `motion-ai-action`, autonomy settings, oversight dashboard with Undo.
3. **Quotes and emails.** `draft_quote` from the tariff sheet, `draft_email` with Approve & send.
4. **Triggers and briefing.** `ai_events`, `ai_triggers`, `motion-ai-worker`, database triggers and cron scans, daily briefing, Control Tower alerts.
5. **Knowledge and learning.** Knowledge base screen, retrieval, feedback capture, Learned review screen.

Each stage = one migration to paste into the SQL editor + Edge Function deploy + front-end push.
