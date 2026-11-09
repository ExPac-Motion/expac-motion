/**
 * Cloudflare Pages Function, connects the signed-in login's own mailbox to
 * the Inbox (migration 0227).
 *
 * POST { email, password, host?, port?, user? }
 *   Tests the login on the mail server first (and counts its folders), then
 *   saves the mailbox for this login with the password in Supabase Vault
 *   (public.mailbox_save, service role). host / port default to the
 *   company's mail server (IMAP_HOST / IMAP_PORT), user to the address.
 *
 * Only a login with Inbox access can connect, and only for itself. An
 * address already connected to another login is refused.
 *
 * Env: IMAP_HOST, IMAP_PORT, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */
import { connect } from "cloudflare:sockets";
import { listFolders, openImap } from "../../server/mail/imap";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

async function caller(env, authHeader) {
  if (!authHeader || !env.SUPABASE_ANON_KEY) return null;
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
  });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user || !user.id) return null;
  const ok = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_use_inbox`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader, "content-type": "application/json" },
    body: "{}",
  });
  if (!ok.ok || (await ok.json()) !== true) return null;
  return user.id;
}

const service = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
  "content-type": "application/json",
});

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase isn't configured on this deployment." }, 500);
  }
  const uid = await caller(env, request.headers.get("authorization"));
  if (!uid) return json({ error: "Only a login with Inbox access can connect a mailbox." }, 403);

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const host = String(body.host || env.IMAP_HOST || "").trim();
  const port = Number(body.port || env.IMAP_PORT || 993);
  const user = String(body.user || email).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter the mailbox's email address." }, 400);
  if (!password) return json({ error: "Enter the mailbox's password." }, 400);
  if (!host) return json({ error: "Enter the mail server (IMAP) address." }, 400);

  // Someone else's mailbox?
  const taken = await fetch(
    `${env.SUPABASE_URL}/rest/v1/mailboxes?email=eq.${encodeURIComponent(email)}&select=id,owner_id`,
    { headers: service(env) },
  );
  const rows = taken.ok ? await taken.json() : [];
  if (rows.some((r) => r.owner_id && r.owner_id !== uid)) {
    return json({ error: `${email} is already connected to another login.` }, 409);
  }

  // Test the login before saving anything.
  let folders = 0;
  try {
    const imap = await openImap(connect, { host, port, user, password });
    try {
      folders = (await listFolders(imap)).filter((f) => f.selectable && !f.system).length;
    } finally {
      await imap.close();
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const wrong = /auth|login|credential|password|invalid/i.test(msg);
    return json({ error: wrong ? "The mail server didn't accept that address and password." : `Could not reach the mail server: ${msg}` }, 400);
  }

  const save = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mailbox_save`, {
    method: "POST",
    headers: service(env),
    body: JSON.stringify({ p_owner: uid, p_email: email, p_host: host, p_port: port, p_user: user, p_password: password }),
  });
  if (!save.ok) return json({ error: "Could not save the mailbox: " + (await save.text()) }, 500);
  const id = await save.json();
  return json({ ok: true, mailboxId: id, folders });
}
