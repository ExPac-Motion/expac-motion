/**
 * Inbox: does an email look like a scam / phishing? (Phase 3)
 *
 * Plain rules, no AI, so it's instant and free and says exactly why:
 *   strong (2 points)
 *     - the sender's name claims a company (xneelo, Microsoft, a bank, DHL,
 *       ExPac itself…) but the address is from another domain
 *     - the sender's name carries a different email address than the real one
 *     - a link shows one website but goes to another
 *   weak (1 point)
 *     - replies would go to a different domain than the sender's
 *     - a carrier / courier name (DHL, Maersk, MSC…) from another domain
 *     - a generic "Support / Security / Admin team" name from outside ExPac
 *     - pressure words: account suspended, verify your account, payment
 *       required, website vulnerable, password expires…
 * 2 points or more: suspicious. The list uses the sender only (the body
 * isn't loaded there); the open email uses everything.
 */

export interface SafetyInput {
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  direction: "in" | "out";
  /** Newsletter / automated mail: tracking links are normal there. */
  is_bulk?: boolean;
}
export interface SafetyBody {
  html?: string | null;
  text?: string | null;
  /** Reply-To address(es) from the headers. */
  replyTo?: string[];
}
export interface SafetyResult {
  suspicious: boolean;
  score: number;
  reasons: string[];
}

/** Companies whose names scammers borrow, and the domains they really mail from. */
/** weak: carriers and couriers, whose names agents often use in their own (e.g. "Lily (MSC bookings)"). */
const BRANDS: { name: RegExp; label: string; domains: string[]; weak?: boolean }[] = [
  { name: /\bx[\s-]?neelo\b/i, label: "xneelo", domains: ["xneelo.co.za", "xneelo.com", "xneelo.net"] },
  { name: /\bhetzner\b/i, label: "Hetzner", domains: ["hetzner.co.za", "hetzner.com", "xneelo.co.za"] },
  { name: /\bafrihost\b/i, label: "Afrihost", domains: ["afrihost.com", "afrihost.co.za"] },
  { name: /\b(microsoft|office ?365|outlook|onedrive|sharepoint|teams)\b/i, label: "Microsoft", domains: ["microsoft.com", "office.com", "outlook.com", "microsoftonline.com", "sharepoint.com", "onmicrosoft.com"] },
  { name: /\b(google|gmail|google workspace)\b/i, label: "Google", domains: ["google.com", "gmail.com", "googlemail.com"] },
  { name: /\bdhl\b/i, label: "DHL", domains: ["dhl.com", "dhl.co.za", "dhl.de"], weak: true },
  { name: /\bfedex\b/i, label: "FedEx", domains: ["fedex.com"], weak: true },
  { name: /\bups\b/i, label: "UPS", domains: ["ups.com"], weak: true },
  { name: /\bmaersk\b/i, label: "Maersk", domains: ["maersk.com"], weak: true },
  { name: /\bmsc\b/i, label: "MSC", domains: ["msc.com"], weak: true },
  { name: /\bsars\b|south african revenue/i, label: "SARS", domains: ["sars.gov.za"] },
  { name: /\babsa\b/i, label: "Absa", domains: ["absa.co.za", "absa.africa"] },
  { name: /\bfnb\b|first national bank/i, label: "FNB", domains: ["fnb.co.za"] },
  { name: /standard ?bank/i, label: "Standard Bank", domains: ["standardbank.co.za", "standardbank.com"] },
  { name: /\bnedbank\b/i, label: "Nedbank", domains: ["nedbank.co.za"] },
  { name: /\bcapitec\b/i, label: "Capitec", domains: ["capitecbank.co.za", "capitec.co.za"] },
  { name: /\bpaypal\b/i, label: "PayPal", domains: ["paypal.com"] },
  { name: /\bapple\b|\bicloud\b/i, label: "Apple", domains: ["apple.com", "icloud.com"] },
  { name: /\bdocusign\b/i, label: "DocuSign", domains: ["docusign.com", "docusign.net"] },
  { name: /\bwetransfer\b/i, label: "WeTransfer", domains: ["wetransfer.com"] },
  { name: /\bdropbox\b/i, label: "Dropbox", domains: ["dropbox.com", "dropboxmail.com"] },
  { name: /\badobe\b/i, label: "Adobe", domains: ["adobe.com"] },
  { name: /\bexpac\b/i, label: "ExPac", domains: ["expac.co.za"] },
];
const GENERIC_NAME = /^(it |tech(nical)? )?(support|security|admin(istrator)?|webmaster|helpdesk|help desk|mail(box)? (admin|administrator|team|server)|account(s)? team|billing( team)?|service desk|system admin(istrator)?)\b|\b(support|security) (team|security|center|centre|department)\b/i;
const PRESSURE: RegExp[] = [
  /\b(account|mailbox|domain|website|service)\b[^.]{0,40}\b(suspend|suspended|deactivat|terminat|block|locked|expire|expir)/i,
  /\bverify (your|the) (account|identity|mailbox|email|login|details)/i,
  /\b(remains?|is|are) vulnerable\b/i,
  /\b(initial|immediate|urgent|outstanding|overdue) payment\b|\bpayment (is )?required\b/i,
  /\bpassword (will )?(expire|expires|expired|reset required)/i,
  /\bunusual (sign[- ]?in|activity|login)\b/i,
  /\bmailbox (is )?(full|over ?quota|storage)/i,
  /\bconfirm (your )?(bank(ing)?|card|payment) details\b/i,
  /\bclick (here|below|the link) (to|within)\b[^.]{0,40}\b(avoid|prevent|keep|restore|verify)/i,
];

/** Link-protection and tracking hosts: the shown site and the real one differ by design. */
const WRAPPERS = /(^|.)(safelinks.protection.outlook.com|urldefense.(com|proofpoint.com)|mimecast.com|cudasvc.com|list-manage.com|mailchimp.com|sendgrid.net|hubspotlinks.com|mcusercontent.com)$/i;
const domainOf = (email: string | null | undefined) => (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
/** a.b.example.co.za -> example.co.za (good enough for comparing who sent what). */
function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sl = parts[parts.length - 2];
  const twoLevel = parts[parts.length - 1].length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sl);
  return parts.slice(twoLevel ? -3 : -2).join(".");
}
const sameOrg = (a: string, b: string) => !!a && !!b && baseDomain(a) === baseDomain(b);
const ownedBy = (domain: string, domains: string[]) => domains.some((d) => domain === d || domain.endsWith("." + d));

/** Links whose visible text names a website other than where they go. */
function mismatchedLinks(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref=("|')(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 3) {
    const href = m[2];
    const shown = m[3].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const shownHost = (shown.match(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]|\b)/i) ?? [])[1];
    if (!shownHost) continue;
    let realHost = "";
    try {
      realHost = new URL(href).hostname;
    } catch {
      continue;
    }
    if (WRAPPERS.test(realHost)) continue;
    if (!sameOrg(shownHost, realHost)) out.push(`${baseDomain(shownHost)} → ${baseDomain(realHost)}`);
  }
  return out;
}

export function checkSafety(m: SafetyInput, body?: SafetyBody): SafetyResult {
  const reasons: string[] = [];
  let score = 0;
  if (m.direction !== "in") return { suspicious: false, score, reasons };
  const domain = domainOf(m.from_email);
  if (!domain) return { suspicious: false, score, reasons };
  const name = (m.from_name ?? "").trim();

  // Claims to be a company it isn't mailing from.
  const brand = BRANDS.find((b) => b.name.test(name));
  if (brand && !ownedBy(domain, brand.domains)) {
    score += brand.weak ? 1 : 2;
    reasons.push(`The sender calls itself "${brand.label}" but writes from ${domain}`);
  }
  // A name that is itself a different address.
  const nameEmail = (name.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/i) ?? [])[0];
  if (nameEmail && nameEmail.toLowerCase() !== (m.from_email ?? "").toLowerCase()) {
    score += 2;
    reasons.push(`The sender's name shows ${nameEmail.toLowerCase()}, but it really comes from ${m.from_email}`);
  }
  // Generic "support team" names from outside ExPac.
  if (!brand && GENERIC_NAME.test(name) && !ownedBy(domain, ["expac.co.za"])) {
    score += 1;
    reasons.push(`A generic name ("${name}") from ${domain}`);
  }

  if (body) {
    const text = `${m.subject ?? ""}\n${body.text ?? (body.html ?? "").replace(/<[^>]+>/g, " ")}`;
    const links = body.html ? mismatchedLinks(body.html) : [];
    if (links.length) {
      score += m.is_bulk ? 1 : 2;
      reasons.push(`A link shows one website but goes to another (${links.join(", ")})`);
    }
    const other = (body.replyTo ?? []).map(domainOf).find((d) => d && !sameOrg(d, domain));
    if (other) {
      score += 1;
      reasons.push(`Replies would go to ${other}, not to ${domain}`);
    }
    if (PRESSURE.some((re) => re.test(text))) {
      score += 1;
      reasons.push("It pushes for urgent action (account, payment, password or security warnings)");
    }
  } else if (PRESSURE.some((re) => re.test(m.subject ?? ""))) {
    score += 1;
    reasons.push("The subject pushes for urgent action");
  }
  return { suspicious: score >= 2, score, reasons };
}

/** Out-of-office, bounces, read receipts and meeting replies: nothing to answer. */
export function isAutoReply(subject: string | null | undefined): boolean {
  return /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered|delivery (status )?notification|delivery has failed|mail delivery (failed|system|subsystem)|returned mail|failure notice|read:|read receipt|accepted:|declined:|tentative(ly accepted)?:)/i.test(
    subject ?? "",
  );
}
