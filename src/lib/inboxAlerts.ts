import type { InboxUnread } from "./db";

/**
 * Desktop alerts for new Inbox mail (the browser's own notifications).
 * Switched on per browser from Sales CRM › Inbox; the browser asks for
 * permission the first time. Layout watches the unread list on every page
 * and calls notifyNewMail for mail that arrived since the last check.
 */
const KEY = "inbox-desktop-alerts";

export const alertsSupported = (): boolean => typeof window !== "undefined" && "Notification" in window;

/** On: switched on here and allowed by the browser. */
export function alertsOn(): boolean {
  if (!alertsSupported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Switch alerts on (asking the browser if needed) or off. Returns the new
 *  state; "blocked" when the browser refuses (site notifications blocked). */
export async function setAlerts(on: boolean): Promise<boolean | "blocked"> {
  if (!alertsSupported()) return "blocked";
  if (on) {
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (p !== "granted") return "blocked";
  }
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: alerts just stay off */
    return false;
  }
  return on;
}

/** One alert per email; the tag stops several open Motion tabs repeating it. */
export function notifyNewMail(m: InboxUnread, onOpen: () => void): void {
  try {
    const n = new Notification(`New email from ${m.from_name || m.from_email || "unknown sender"}`, {
      body: m.subject || "(no subject)",
      tag: `inbox-${m.id}`,
      icon: "/expac-favicon.png",
    });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
