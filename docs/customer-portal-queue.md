# Customer Portal, queued items (to discuss)

From the "Customer Portal EXPAC (ZAJNB)" deck, 5 Oct 2026. These headings / sections appear in the deck but are **not built yet**, because ExPac doesn't offer or capture them yet (or it needs a decision first). Everything else in the deck is live in the portal rebuild.

## Dashboard
- **Drag-and-drop widget layout** (rearrange / add / remove dashboard cards per customer). Today the layout is fixed.
- **CO2 emissions** widgets: "CO2 Emissions Avg (kg/TTW)" and "Cumulative CO2 emissions". These need an emissions source per shipment (distance × mode factor, or a carrier API).
- **Total Invoices donut (Paid / Due / Overdue)**. This needs payment status, which only exists once invoices come from Sage.
- **Rate Search bar on the dashboard** (shipment type, origin port, destination port, pick-up date, cargo → instant rates). Today "Search Rates" opens the Tariff Sheet. Live rate search needs published buy/sell rates per lane.
- **Create Booking** (customer books directly, without a quotation). Today every booking goes through Request a Quote, then acceptance.
- **Shipments Calendar "Pick Up / Deliveries" filter**. Today the calendar shows Departures (ETD) and Arrivals (ETA). Pick-up and delivery dates per shipment aren't captured yet.

## Tasks
- **"My Tasks" for the customer** ("Upload the updated packing list", due date, Overdue / Due today, Remark / Comment, Upload button). Needs customer-facing tasks on shipments, quotations, receipts and releases, plus document upload from the portal.
- **Quotation Tasks / Receipt Tasks / Release Tasks** side panels (same feature, per area).

## Shipments
- **Current status → Next status** stepper and "Last updated x hours ago".
- **Watchlist / share a shipment** link.
- **Tracking details with several containers** (one tab per container no.). Today: one container / AWB per shipment.
- **CO2 emission per shipment**.
- **Customer document upload** on a shipment (commercial invoice, packing list, permits).

## Quotations
- **Pin / duplicate / edit a quotation** from the list (re-request a similar quote).

## Invoices
- **Invoice amounts, due dates, statuses (Due / Paid / Partially paid / Disputed) and ageing (10–19 / 20–29 / 30–39 / 40+ days)**. Waiting on the Sage integration; today Invoices lists the invoice documents shared on shipments.
- **Pay online** ("Pay USD …" / "Pay AED …"). Needs a payment gateway (e.g. PayFast / Peach / Stripe) and a decision on currencies.
- **Statement of Account & Ageing** report.

## Warehouse
- **Product expiry dates and batch numbers** per SKU (receipts capture SKU, qty and dimensions, but not batch or expiry).
- **Customer-created warehouse releases and delivery instructions** (self-service: the customer asks for goods to be released or delivered). Today ExPac books releases.
- **Receipt status "Weights & Measures" / "Allotted"** workflow states.

## Reports
- **Report builder** with period / curve function / table view, "Cost per unit", "Status report" and a "Detailed statement of account".
- Today: shipments per month by mode and freight spend per month, with CSV downloads of shipments and quotations.

## General
- **Dark mode** and **language switch (EN)** in the top bar.
- **Activity / notifications bell for the customer** (new quote ready, shipment arrived, document shared). The dashboard's "Action required" list covers the main ones for now.
- **Mobile app** (the deck shows a phone app). The portal works in a phone browser; a native app is a separate project.
- **Email to support@ when a customer requests a quote**. Today staff see it in Notifications and in Quotations › New Lead.

## Customer record (staff side), tabs not built yet
From the customer-record screenshot (5 Oct 2026). Built: General, Contacts, Other Details, Bank Detail, Documents, Permits / Certificates, Products & SKUs, Consignees & Shippers, Associated Leads, Margins & Charges (+ Quotes & Shipments).
- **Integrations**: customer EDI / API / ERP links.
- **Customer Forecast**: expected volumes per lane / month.
- **Status**: the last tab, cut off in the screenshot ("Statu…"). Confirm what it holds (account status? credit hold?).
- **Portal Access counter "(1/2 Contacts)"**: shows contacts with a login out of all contacts; today it shows the number of contacts.
- **Documents visible to the customer in the portal**: the `visible_to_client` flag exists on customer documents; the portal screen isn't built yet.
