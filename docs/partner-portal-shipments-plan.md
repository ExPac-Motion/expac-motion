# Partner Portal: Shipments tab (build plan)

Status: steps 1 to 4 built 13/11/2026 as ONE migration, 0243_partner_shipments.sql (reads, updates, uploads, messages), plus the Shipments tab (src/pages/partner/PartnerShipments.tsx, DEV preview /dev/partner-shipments?kind=). Decisions taken: 1 straight onto the shipment + logged; 2 partner statuses go straight through (portal progress bar reads job_status_history), no automatic customer email; 3 partners see their own buy lines with amounts; 4 no-login link not built (step 6). Step 5 built 13/11/2026 (no migration): shipment workspace Partners tab (src/pages/shipments/PartnersTab.tsx, DEV /dev/partner-shipments?view=staff) with partners per leg, portal-login chip, last activity, thread + reply (optional email), Request a document, "Updated by" log.

Partners (origin agent, destination agent, transporter, clearing agent) already
log in to the Partner Portal (migration 0121) for their rate sheets and coverage,
and clearing agents have the Broker Desk (0232). This adds a **Shipments** tab:
the shipments they are assigned to, their leg only.

## 1. Who sees which shipment

A partner login (`profiles.role = 'partner'`, `partner_id`, `partner_kind`) sees a
shipment when it is assigned on that job:

| Partner kind | Assigned when |
|---|---|
| Origin agent | `quotes.agent_id` of the shipment's quote (`jobs.quote_id`) |
| Destination agent | `quotes.destination_agent_id` |
| Transporter | `quotes.transporter_id` |
| Clearing agent | `customs_files.clearing_agent_id`, else `quotes.clearing_agent_id` |

Quote-less jobs and master/house shipments: houses follow their master's
assignment; a partner sees the master plus its houses.

**Build:** a SECURITY DEFINER `partner_shipments()` RPC that returns only the
allowed columns (below) for the caller's `partner_id`. No direct RLS on `jobs`
for partners, so nothing outside the column list can leak.

Optional later: `jobs.agent_id` / `transporter_id` overrides, so ops can change the
partner on a shipment without editing the won quote.

## 2. What each role sees

**Never shown to any partner:** customer company, customer contacts, consignee
contacts, sell rates, margin, quotation PDF, other partners' names or rates,
invoices to the customer, customer chat, internal ops remarks.

| Field | Origin agent | Transporter | Clearing agent | Destination agent |
|---|:-:|:-:|:-:|:-:|
| Shipment no (`reference`), mode, incoterm, delivery terms | Yes | Yes | Yes | Yes |
| Origin / destination, POL / POD | Yes | Yes | Yes | Yes |
| Commodity, packing list (pcs, kg, CBM, dims, chargeable) | Yes | Yes | Yes | Yes |
| Cargo ready, ETD, ETA, provisional delivery date | Yes | Yes | Yes | Yes |
| Carrier, vessel / flight, voyage, MBL / AWB, container, seal | Yes | ETA only | Yes | Yes |
| Shipper name + pickup address + on-site contact | Yes | If collecting | No | No |
| Delivery address + on-site contact | No | If delivering | Yes | Yes |
| Customs stage, entry no, release status | No | Released Y/N | Yes | Yes |
| Their own buy lines for this job (code, desc, unit, cur, rate) | Yes | Yes | Yes | Yes |
| Live tracking map (vessel/flight position, no source names) | Yes | Yes | Yes | Yes |

## 3. What each role can do

| Action | Origin agent | Transporter | Clearing agent | Destination agent |
|---|:-:|:-:|:-:|:-:|
| Fill in booking: carrier, vessel/flight, voyage, MBL/AWB, container, seal, ETD, ETA | Yes | No | No | No |
| Set status: Booked, Collected, Received, Loaded, Departed | Yes | No | No | No |
| Set status: Collected, On-Delivery, Delivered (+ signed by, delivered at) | No | Yes | No | Yes |
| Customs: Entry lodged, Query raised, Cleared | No | No | Yes (Broker Desk) | No |
| Report a delay (reason + new date) | Yes | Yes | Yes | Yes |
| Upload documents | MBL/AWB, HBL draft, CI, PL, photos | POD, delivery note, photos | Release note, entry, duty/VAT invoice | Arrival docs, POD |
| Upload their invoice against the job | Yes | Yes | Yes | Yes |
| Message ExPac on the shipment | Yes | Yes | Yes | Yes |
| Delete anything | No | No | No | No |

Uploads land in the Document Vault with `visible_to_client = false` and a new
`from_partner_id`, so staff decide what the customer sees.

## 4. Screens

1. **Shipments list** (Partner Portal tab): Active / Completed toggle, search by
   shipment no, MBL/AWB, container. Columns: Shipment, Mode, Route, Ready / ETD,
   ETA (same ETA-due highlight as the board), Status, Action needed.
2. **Shipment page:** header (shipment no, status pill, route), the fact grid
   above, packing list, "Your charges", documents (list + upload), status buttons
   for their role, booking form (agents), messages, tracking map, history.
3. **Action needed** flags on the list: booking details missing past cargo ready,
   no pickup update on the collection date, POD missing after Delivered,
   document requested by ExPac.

## 5. ExPac side

- Every partner change writes a `job_events` row and a Control Tower note (as
  Broker Desk steps do now), tagged with the partner's company.
- Shipment page shows "Updated by <partner>" next to booking fields and statuses.
- New **Partners** strip on the shipment: who's assigned per leg, last activity,
  "Send portal link" / "Request document" buttons.
- Partner messages go to a new `job_partner_messages` table, shown in Shipment
  Comms as a separate "Partner" thread (never on the customer portal).

## 6. Notifications to partners

Email (Aptos, branded link, BCC support@) when: assigned to a shipment, ExPac
requests a document, ETD/ETA or delivery date changes, ExPac replies to a message.
One digest per day for anything else.

## 7. Open decisions

1. Agent booking details: write straight onto the shipment (recommended, logged
   and reversible) or go in as a suggestion staff accept?
2. Customer-facing statuses from partners: Collected and Delivered go straight
   to the customer portal and email (recommended); others need staff to confirm?
3. Should partners see the ExPac buy figure for their own lines, or charge
   lines without amounts?
4. Partners without a portal login: send a no-login link per shipment (like the
   RFQ reply link) for status + uploads?

## 8. Build order

| Step | Migration | What |
|---|---|---|
| 1 | 0243 | `partner_shipments()` + `partner_shipment(id)` RPCs, column whitelist per kind; `shipment_documents.from_partner_id` |
| 2 | 0244 | `partner_update_shipment(id, patch)`: booking fields + statuses allowed per kind, writes `job_events` + Control Tower note |
| 3 | 0245 | `partner_upload_document`, `job_partner_messages` table + RLS |
| 4 | none | Portal UI: Shipments tab, list, shipment page |
| 5 | none | ExPac side: Partners strip, Partner thread in Comms, "Updated by" tags |
| 6 | 0246 | Notification emails + no-login shipment link (if decision 4 is yes) |
| 7 | none | Merge Broker Desk into the clearing agent's shipment page (keep Broker Desk as a filter) |

Steps 1 to 4 make it usable for partners; 5 and 6 close the loop for ops.

## Update 13/11/2026: agent profile (0244)

User direction: agents need a full view on their own profile (ops, tracking, quotes and rates, milestone statuses), linked to Motion active shipments; agents have nothing to do with the clearing agent, so step 7 (Broker Desk merge) is dropped. Built: Dashboard (counts, fleet map, needs attention, arriving next), Shipments list on the shared DataTable grid like Active Shipments, Tracking tab (fleet map + grid), Quotes tab (RFQs sent to the partner via partner_rfqs()), email alerts (partner_alerts queue, pg_cron partner-alerts every 5 min: assigned + ETD/ETA/delivery date changes by ExPac). No-login link not built (profile login instead). Manual: docs/partner-manual (ExPac Motion - Vendor Profile Manual.pdf, source manual.html, screenshots from /dev/partner-shipments?view=...).
