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

// The real Support signature (docs/email-signature-support.html): a 595px table.
const SIGNATURE = "<table role=\"presentation\" width=\"595\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:595px;max-width:100%;border-collapse:collapse;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;color:#262626;\">\r\n<tr><td style=\"padding:0 0 10px 0;font-size:11pt;line-height:1.4;\">Kind Regards</td></tr>\r\n<tr><td style=\"padding:0;\"><a href=\"https://expac-motion.co.za/login\" target=\"_blank\" style=\"text-decoration:none;border:0;\"><img src=\"https://cdn.expac.co.za/mail-assets/media/327931ee-eb64-4175-a351-bf45cdf6e88b.png\" width=\"595\" alt=\"ExPac Forwarding, Excellence In Motion: Sea Freight, Air Freight, Cx Freight, ERP Login\" style=\"display:block;width:595px;max-width:100%;height:auto;border:0;\"></a></td></tr>\r\n<tr><td style=\"padding:12px 0 10px 0;font-size:10.5pt;line-height:1.45;\"><b>Oliver</b> | Support | International Logistics and Global Trade Compliance<br>Air and Ocean Freight Clearing &amp; Forwarding, Great Voyages Starts Here</td></tr>\r\n<tr><td style=\"padding:10px 0;border-top:1px solid #a6a6a6;font-size:10pt;line-height:1.45;\">Enjoyed working with ExPac Forwarding? Your feedback helps us continue providing exceptional service. We'd greatly appreciate a Google Review. <b>Leave a Review: <a href=\"https://g.page/r/CbXf1k3cms1YEAI/review\" target=\"_blank\" style=\"color:#262626;text-decoration:none;\">Click here</a></b></td></tr>\r\n<tr><td style=\"padding:10px 0;border-top:1px solid #a6a6a6;font-size:10pt;line-height:1.6;\"><b style=\"color:#92D400;\">T:</b> +27 (0) 11 568 8281 | <b style=\"color:#92D400;\">M:</b> +27 (0) 82 682 3332 | <b style=\"color:#92D400;\">F:</b> +27 (0) 86 482 2371 <b style=\"color:#92D400;\">E:</b> <a href=\"mailto:support@expac.co.za\" style=\"color:#262626;text-decoration:none;\">support@expac.co.za</a><br><b style=\"color:#92D400;\">Office:</b> <a href=\"mailto:admin@expac.co.za\" style=\"color:#262626;text-decoration:none;\">admin@expac.co.za</a> | <b style=\"color:#92D400;\">W:</b> <a href=\"http://www.expac.co.za\" target=\"_blank\" style=\"color:#262626;text-decoration:none;\">www.expac.co.za</a> | <b style=\"color:#92D400;\">A:</b> Centurion, Gauteng, South Africa, 1620<br><b style=\"color:#92D400;\">Postal Address:</b> PostNet Suite 84, Private Bag X1015, Lyttelton, 0140</td></tr>\r\n<tr><td style=\"padding:10px 0 8px 0;border-top:1px solid #a6a6a6;font-size:10pt;line-height:1.45;\">Our team operates flexibly across multiple time zones, allowing us to provide responsive support and seamless collaboration no matter where you are located. This means faster turnarounds, greater availability, and a workflow that adapts to your schedule.</td></tr>\r\n<tr><td style=\"padding:4px 0 0 0;font-size:7pt;line-height:1.4;color:#171717;\">This message contains confidential information and is intended only for the individual named. If you are not the named addressee you should not disseminate, distribute, or copy this e-mail. Please notify the sender immediately by e-mail if you have received this e-mail by mistake and delete this e-mail from your system. E-mail transmission cannot be guaranteed to be secure or error-free as information could be intercepted, corrupted, lost, destroyed, arrive late or incomplete, or contain viruses. The sender therefore does not accept liability for any errors or omissions in the contents of this message, which arise because of e-mail transmission.</td></tr>\r\n</table>";

const MAIL = [
  {
    id: "m1",
    flagged: true,
    archived_at: null,
    deleted_at: null,
    snoozed_until: null,
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
  {
    // Answered from Outlook (Sent folder sync): m2 no longer needs a reply.
    id: "m3",
    mailbox: "support:sent",
    direction: "out",
    message_id: "<m3@expac.co.za>",
    thread_key: "t2",
    from_email: "support@expac.co.za",
    from_name: "ExPac Forwarding",
    to_emails: ["lily@shenzhen-agent.cn"],
    cc_emails: [],
    subject: "Re: Booking confirmation SEA826893",
    snippet: "Thanks Lily, noted.",
    body_html: "<p>Thanks Lily, noted.</p>",
    has_attachments: false,
    sent_at: ago(60 * 3),
    seen: true,
    answered: false,
    category: "partner",
    record_name: "Shenzhen Agent Co.",
    job_id: "job-1",
    job_reference: "SEA826893",
  },
  {
    id: "m4",
    direction: "in",
    thread_key: "t4",
    from_email: "accounts@highveld.co.za",
    from_name: "Highveld Accounts",
    to_emails: ["support@expac.co.za"],
    cc_emails: [],
    subject: "Statement for September",
    snippet: "Please find our statement attached.",
    body_html: "<p>Please find our statement attached.</p>",
    has_attachments: true,
    sent_at: ago(60 * 24 * 3),
    seen: true,
    read_at: ago(60 * 24 * 3),
    answered: false,
    category: "customer",
    record_name: "Highveld Outdoor Gear",
    snoozed_until: new Date(Date.now() + 86_400_000).toISOString(),
  },
  {
    id: "m5",
    direction: "in",
    thread_key: "t5",
    from_email: "news@carrier.com",
    from_name: "Carrier News",
    to_emails: ["support@expac.co.za"],
    cc_emails: [],
    subject: "Peak season surcharge notice",
    snippet: "PSS applies from 1 November.",
    body_html: "<p>PSS applies from 1 November.</p>",
    has_attachments: false,
    sent_at: ago(60 * 24 * 6),
    seen: true,
    read_at: ago(60 * 24 * 6),
    answered: false,
    category: "unknown",
    archived_at: ago(60 * 24 * 5),
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
