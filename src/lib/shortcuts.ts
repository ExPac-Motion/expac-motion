import type { KeyboardEvent } from "react";

/** Send shortcut in the mail windows: Alt+S, or Ctrl+Enter (⌘+Enter on a Mac). */
export function isSendShortcut(e: KeyboardEvent): boolean {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyS" || e.key.toLowerCase() === "s")) return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter";
}

export const SEND_SHORTCUT_HINT = "Alt+S or Ctrl+Enter to send";
