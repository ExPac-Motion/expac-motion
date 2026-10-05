/**
 * Cloudflare Pages Function — an ExPac admin gives a customer contact a
 * Customer Portal login from the customer record (General › Enable Customer
 * Portal Access): creates the login with the password typed (or a generated
 * one), or resets an existing customer login's password, and links it to the
 * customer (approved) via admin_link_client_login (migration 0142).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Request (POST /api/customer-login, Authorization: Bearer <admin JWT>):
 *   { clientId, email, fullName?, password?, greeting? }
 * Response: { email, password, created }
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

function sbHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "content-type": "application/json",
    ...(extra || {}),
  };
}

async function errorText(r) {
  const body = await r.json().catch(() => ({}));
  return body.msg || body.message || body.error_description || body.error || `HTTP ${r.status}`;
}

/** 12 characters, no look-alikes (0/O, 1/l/I), always upper + lower + digit. */
function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const rnd = new Uint32Array(12);
  crypto.getRandomValues(rnd);
  const chars = Array.from(rnd, (n, i) => {
    const set = i === 0 ? upper : i === 1 ? lower : i === 2 ? digits : all;
    return set[n % set.length];
  });
  const mix = new Uint32Array(chars.length);
  crypto.getRandomValues(mix);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = mix[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function callerIsAdmin(env, authHeader) {
  if (!authHeader) return false;
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader },
  });
  if (!r.ok) return false;
  const u = await r.json();
  if (!u || !u.id) return false;
  const p = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${u.id}&select=role`, {
    headers: sbHeaders(env),
  });
  const rows = p.ok ? await p.json() : [];
  return rows.length > 0 && rows[0].role === "admin";
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Customer logins aren't configured on this site" }, 500);
  }
  if (!(await callerIsAdmin(env, request.headers.get("authorization")))) {
    return json({ error: "Only an ExPac admin can create customer portal logins" }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const clientId = String(body.clientId || "");
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.fullName || "").trim();
  const typed = String(body.password || "");
  const greeting = String(body.greeting || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Unknown customer" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter the contact's email address" }, 400);
  if (typed && typed.length < 8) return json({ error: "Use at least 8 characters for the password" }, 400);
  const password = typed || generatePassword();

  const existingR = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(email.replace(/[_%\\]/g, "\\$&"))}&select=id,role,client_id`,
    { headers: sbHeaders(env) },
  );
  const existing = existingR.ok ? await existingR.json() : [];
  const prof = existing.find((p) => p && p.id);

  let userId;
  let created = false;
  if (prof) {
    if (["admin", "user", "partner"].includes(prof.role)) {
      return json({ error: "That email already belongs to an ExPac staff or partner login" }, 409);
    }
    if (prof.client_id && prof.client_id !== clientId) {
      return json({ error: "That email is already linked to another customer" }, 409);
    }
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${prof.id}`, {
      method: "PUT",
      headers: sbHeaders(env),
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!r.ok) return json({ error: "Could not set the password: " + (await errorText(r)) }, 502);
    userId = prof.id;
  } else {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { signup_kind: "portal", full_name: fullName || email },
      }),
    });
    if (!r.ok) return json({ error: "Could not create the login: " + (await errorText(r)) }, 502);
    const u = await r.json();
    userId = u.id || (u.user && u.user.id);
    created = true;
  }

  const link = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_link_client_login`, {
    method: "POST",
    headers: sbHeaders(env),
    body: JSON.stringify({ p_user: userId, p_client: clientId }),
  });
  if (!link.ok) return json({ error: "Login made but not linked: " + (await errorText(link)) }, 502);

  // Portal greeting ("Good day, Mr Gilbert", 0141) from the customer record.
  if (greeting) {
    await fetch(env.SUPABASE_URL + "/rest/v1/profiles?id=eq." + userId, {
      method: "PATCH",
      headers: sbHeaders(env),
      body: JSON.stringify({ greeting }),
    });
  }

  return json({ email, password, created });
}
