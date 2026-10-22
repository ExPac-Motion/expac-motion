import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import InboxTab from "./crm/InboxTab";

/**
 * DEV-ONLY preview of Sales CRM › Inbox with fabricated mail, so the reading
 * pane, full view and compose can be checked without a signed-in mailbox:
 *   /dev/inbox
 * Registered only when import.meta.env.DEV, it can't reach prod. Sending
 * fails here (no /api in dev), everything up to Send works.
 */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const SIGNATURE =
  '<p style="margin:0"><b>Oliver</b><br>ExPac Forwarding · support@expac.co.za · +27 11 568 8281</p>';

const MAIL = [
  {
    id: "m1",
    direction: "in",
    message_id: "<m1@demoimports.co.za>",
    thread_key: "t1",
    from_email: "gilbert@demoimports.co.za",
    from_name: "Gilbert O'Connell",
    to_emails: ["support@expac.co.za", "ops@demoimports.co.za"],
    cc_emails: ["finance@demoimports.co.za"],
    subject: "Ningbo to Durban LCL, 4 pallets",
    snippet: "Morning Oliver, please quote 4 pallets ex Ningbo, 2.1 cbm, 640 kg, ready 30 October.",
    body_html:
      "<html><head><style>p{color:#333}</style></head><body><p>Morning Oliver,</p><p>Please quote <b>4 pallets</b> ex Ningbo:</p><ul><li>2.1 cbm</li><li>640 kg</li><li>Ready 30 October</li></ul><p>Thanks,<br>Gilbert</p></body></html>",
    has_attachments: false,
    sent_at: ago(25),
    seen: false,
    answered: false,
    category: "customer",
    record_kind: "client",
    record_id: "c-1",
    record_name: "Demo Imports (Pty) Ltd",
  },
  {
    id: "m2",
    direction: "in",
    message_id: "<m2@agent.cn>",
    thread_key: "t2",
    from_email: "lily@shenzhen-agent.cn",
    from_name: "Lily Chen",
    to_emails: ["support@expac.co.za"],
    cc_emails: [],
    subject: "Booking confirmation SEA826893",
    snippet: "Dear ExPac, booking confirmed on MSC Aurora, ETD 1 Nov.",
    body_html: "<p>Dear ExPac,</p><p>Booking confirmed on MSC Aurora, ETD 1 Nov.</p><p>Best regards,<br>Lily</p>",
    has_attachments: false,
    sent_at: ago(60 * 5),
    seen: true,
    read_at: ago(60 * 4),
    answered: false,
    category: "partner",
    record_kind: "agent",
    record_id: "a-1",
    record_name: "Shenzhen Agent Co.",
    job_id: "job-1",
    job_reference: "SEA826893",
  },
];

export default function InboxDemoPage() {
  const qc = useQueryClient();
  useState(() => {
    const seed = (key: unknown[], data: unknown) => {
      qc.setQueryDefaults(key, { staleTime: Infinity, retry: false, refetchInterval: false });
      qc.setQueryData(key, data);
    };
    seed(["inbox"], MAIL);
    seed(["inbox_sent"], []);
    seed(["inbox_state"], { mailbox: "support", last_sync_at: ago(3), last_error: null });
    seed(["company_settings"], { id: 1, mail_signature_html: SIGNATURE, mail_sender_name: "ExPac Forwarding" });
    seed(["jobs"], [{ id: "job-1", reference: "SEA826893", origin: "CNSZX", destination: "ZADUR", mode: "Sea Freight (LCL)", client: { company: "Maritsu Van Straaten" } }]);
    seed(["clients"], []);
    seed(["leads"], []);
    seed(["media_assets"], []);
    seed(["inbox_drafts"], [
      {
        id: "d1",
        to_emails: "lily@shenzhen-agent.cn",
        cc_emails: "",
        bcc_emails: "",
        subject: "Re: Booking confirmation SEA826893",
        body_html: `<div>Hi Lily, please send the draft BL before sailing.</div><div><br></div>${SIGNATURE}`,
        reply_to_id: "m2",
        reply_all: false,
        forward_id: null,
        include_original: true,
        forward_files: null,
        attachments: [],
        created_at: ago(40),
        updated_at: ago(38),
      },
    ]);
    seed(["mail_templates"], [
      {
        id: "t1",
        name: "Rate request to agent",
        subject: "Rate request {{ origin }} to {{ destination }}",
        body: "<div>Dear {{ contact.name }},</div><div><br></div><div>Please send your best rate for shipment {{ shipment.number }}, {{ mode }}.</div>",
        attachments: [],
        created_at: ago(9000),
        updated_at: ago(9000),
      },
    ]);
    return true;
  });
  // The tab syncs on open, which refetches (empty, signed out): put the
  // demo mail back whenever that happens.
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        if (e.type === "updated" && e.query.queryKey[0] === "inbox" && e.query.state.data !== MAIL)
          qc.setQueryData(["inbox"], MAIL);
      }),
    [qc],
  );
  return (
    <div className="main">
      <h1 style={{ marginTop: 0 }}>Inbox (demo data)</h1>
      <InboxTab />
    </div>
  );
}
