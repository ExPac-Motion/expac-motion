import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { unsubscribeLead } from "../lib/db";

/** Public, unauthenticated -- reached from the {{ unsubscribe_link }}
 *  merge field in a sent campaign email. See unsubscribe_lead() RPC in
 *  0034_mail_campaigns.sql (security definer, granted to anon). */
export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const recipientId = params.get("r") ?? "";
  const [state, setState] = useState<"working" | "done" | "notfound" | "error">(
    () => (recipientId ? "working" : "notfound"),
  );

  useEffect(() => {
    if (!recipientId) return;
    unsubscribeLead(recipientId)
      .then((ok) => setState(ok ? "done" : "notfound"))
      .catch(() => setState("error"));
  }, [recipientId]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-name">ExPac</div>
            <div className="brand-sub" style={{ color: "#9aa39a" }}>
              FORWARDING
            </div>
          </div>
        </div>
        {state === "working" && <p className="sub">Working…</p>}
        {state === "done" && (
          <>
            <h1>You're unsubscribed</h1>
            <p className="sub">
              You won't receive any more mailer emails from ExPac Forwarding.
              If this was a mistake, just get in touch with us.
            </p>
          </>
        )}
        {state === "notfound" && (
          <>
            <h1>Link not recognised</h1>
            <p className="sub">
              This unsubscribe link is invalid or has expired. Contact ExPac
              Forwarding directly if you'd like to stop receiving emails.
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <h1>Something went wrong</h1>
            <p className="sub">
              We couldn't process that just now. Please try again shortly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
