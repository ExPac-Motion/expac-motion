/**
 * Cloudflare Pages Function, a PDF from Sage Accounting (migration 0156):
 *
 *   POST { invoice: <Sage invoice id> }                       → the tax invoice
 *   POST { statement: true, client?: <uuid>, from, to }       → Statement of Account
 *
 * Access is checked with the caller's own login: an invoice must be readable
 * by them under the customer_invoices RLS (staff, or that customer's portal
 * login with the Invoices permission); a statement goes through
 * sage_statement_target (staff for any customer, a portal login only its own).
 *
 * Env: SAGE_API_KEY, SAGE_USERNAME, SAGE_PASSWORD, SAGE_COMPANY_ID (optional),
 *      SAGE_API_URL (optional), SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

/** PostgREST as the caller (their RLS applies). */
async function asCaller(env, authHeader, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...(init || {}),
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: authHeader,
      "content-type": "application/json",
      ...((init && init.headers) || {}),
    },
  });
  if (!r.ok) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function companyId(env) {
  if (env.SAGE_COMPANY_ID) return String(env.SAGE_COMPANY_ID);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/sage_state?id=eq.1&select=company_id`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const rows = r.ok ? await r.json() : [];
  return rows[0] && rows[0].company_id ? String(rows[0].company_id) : "";
}

async function sagePdf(env, method, path, body) {
  const base = (env.SAGE_API_URL || "https://accounting.sageone.co.za/api/2.0.0").replace(/\/+$/, "");
  const qs = new URLSearchParams({ apikey: env.SAGE_API_KEY });
  const cid = await companyId(env);
  if (!cid) throw new Error("Sage hasn't synced yet, run Sync now in Settings › Sage Accounting first");
  qs.set("companyid", cid);
  const r = await fetch(`${base}/${path}?${qs.toString()}`, {
    method,
    headers: {
      authorization: "Basic " + btoa(`${env.SAGE_USERNAME}:${env.SAGE_PASSWORD}`),
      accept: "application/pdf, application/octet-stream",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) throw new Error("Sage has no statement for that period");
  if (!r.ok) throw new Error(`Sage ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.arrayBuffer();
}

const isoDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase isn't configured on this deployment." }, 500);
  }
  if (!env.SAGE_API_KEY || !env.SAGE_USERNAME || !env.SAGE_PASSWORD) {
    return json({ error: "Sage isn't connected yet.", notConnected: true }, 503);
  }
  const auth = request.headers.get("authorization");
  if (!auth) return json({ error: "Not signed in." }, 401);
  const body = await request.json().catch(() => ({}));

  try {
    let pdf;
    let filename;
    if (body.invoice != null) {
      const id = Number(body.invoice);
      if (!Number.isInteger(id)) return json({ error: "Bad invoice." }, 400);
      const rows = await asCaller(
        env,
        auth,
        `/rest/v1/customer_invoices?sage_id=eq.${id}&select=sage_id,document_number`,
      );
      if (!rows || rows.length === 0) return json({ error: "Not allowed." }, 403);
      pdf = await sagePdf(env, "GET", `TaxInvoice/Export/${id}`);
      filename = `Invoice ${rows[0].document_number || id}.pdf`;
    } else if (body.statement) {
      const target = await asCaller(env, auth, `/rest/v1/rpc/sage_statement_target`, {
        method: "POST",
        body: JSON.stringify({ p_client: body.client || null }),
      });
      const t = target && target[0];
      if (!t) return json({ error: "This customer isn't linked to Sage yet." }, 403);
      const to = isoDay(body.to) || new Date().toISOString().slice(0, 10);
      const from =
        isoDay(body.from) || new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      pdf = await sagePdf(env, "POST", "CustomerStatement/Export", {
        FromDate: from,
        ToDate: to,
        FromCustomer: t.name,
        ToCustomer: t.name,
        IncludeActive: true,
        IncludeInactive: true,
        CommunicationMethod: -1,
        Detailed: true,
        ShowBalanceBroughtForward: true,
      });
      filename = `Statement ${t.name} ${from} to ${to}.pdf`;
    } else {
      return json({ error: "Nothing asked for." }, 400);
    }
    return new Response(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return json({ error: e && e.message ? e.message : String(e) }, 502);
  }
}
