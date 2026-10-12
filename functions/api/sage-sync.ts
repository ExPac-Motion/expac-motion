/**
 * Cloudflare Pages Function, read-only sync from Sage Business Cloud
 * Accounting (South Africa, API 2.0.0) into Motion (migration 0156).
 *
 * Each run: the Sage company (first one the login sees, or SAGE_COMPANY_ID),
 * every Sage customer (name, balance), tax invoices changed since the last
 * run, every invoice still owing (so payments show without waiting for the
 * invoice itself to change), and customer receipts changed since the last
 * run. Then auto-links Sage customers to Motion customers with the identical
 * company name. Database triggers link each invoice to its customer and to
 * the shipment whose number is the invoice Reference.
 *
 * Sage limits: 5000 requests a day per company, 100 results per list call,
 * so a run makes at most MAX_CALLS requests; a large first backfill finishes
 * over a few runs (the 30-minute cron).
 *
 * Auth: x-cron-key (pg_cron, CRON_SECRET) or a signed-in Admin / Standard
 * User ("Sync now" in Settings › Sage Accounting).
 *
 * Env: SAGE_API_KEY, SAGE_USERNAME, SAGE_PASSWORD, SAGE_COMPANY_ID (optional),
 *      SAGE_API_URL (optional, default https://accounting.sageone.co.za/api/2.0.0),
 *      SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

const PAGE = 100;
const MAX_CALLS = 40;
const BACKFILL_DAYS = 730;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

/* ---------- Supabase (service role) ---------- */
function sb(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(extra || {}),
  };
}
async function sbJson(env, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, init);
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function upsert(env, table, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    await sbJson(env, `/rest/v1/${table}?on_conflict=sage_id`, {
      method: "POST",
      headers: sb(env, {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
  }
}

async function callerMaySeeAccounts(env, authHeader) {
  if (!authHeader || !env.SUPABASE_ANON_KEY) return false;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_see_accounts`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: authHeader, "content-type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

/* ---------- Sage ---------- */
function sageClient(env) {
  const base = (env.SAGE_API_URL || "https://accounting.sageone.co.za/api/2.0.0").replace(/\/+$/, "");
  const auth = "Basic " + btoa(`${env.SAGE_USERNAME}:${env.SAGE_PASSWORD}`);
  let companyId = env.SAGE_COMPANY_ID ? String(env.SAGE_COMPANY_ID) : "";
  let calls = 0;
  async function call(method, path, params, body, raw) {
    calls++;
    const qs = new URLSearchParams({ apikey: env.SAGE_API_KEY, ...(params || {}) });
    if (companyId) qs.set("companyid", companyId);
    const r = await fetch(`${base}/${path}?${qs.toString()}`, {
      method,
      headers: {
        authorization: auth,
        accept: raw ? "application/pdf, application/octet-stream" : "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 || r.status === 403) {
      throw new Error("Sage refused the login, check SAGE_API_KEY, SAGE_USERNAME and SAGE_PASSWORD");
    }
    if (!r.ok && r.status !== 204) {
      const t = (await r.text()).slice(0, 300);
      throw new Error(`Sage ${path}: ${r.status} ${t}`);
    }
    if (raw) return r;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    call,
    get calls() {
      return calls;
    },
    get companyId() {
      return companyId;
    },
    setCompany(id) {
      companyId = String(id);
    },
  };
}

/** Pages through a list call ($top / $skip), oldest change first. */
async function list(sage, path, params, budget) {
  const out = [];
  let skip = 0;
  let complete = false;
  while (sage.calls < budget) {
    const page = await sage.call("GET", path, { ...params, $top: String(PAGE), $skip: String(skip) });
    const rows = (page && page.Results) || [];
    out.push(...rows);
    skip += rows.length;
    if (rows.length < PAGE || (page.TotalResults != null && skip >= page.TotalResults)) {
      complete = true;
      break;
    }
  }
  return { rows: out, complete };
}

const day = (s) => (s ? String(s).slice(0, 10) : null);
const num = (v) => (v == null || v === "" ? null : Number(v));
/** OData v3 datetime literal from a Sage "Modified" value. */
const odataDate = (s) => `datetime'${String(s).replace(/Z$/, "").slice(0, 19)}'`;
function maxText(rows, cur) {
  let m = cur || "";
  for (const r of rows) if (r.Modified && String(r.Modified) > m) m = String(r.Modified);
  return m || null;
}

function invoiceRow(i) {
  const total = num(i.Total);
  const due = num(i.AmountDue);
  return {
    sage_id: i.ID,
    sage_customer_id: i.CustomerId,
    document_number: i.DocumentNumber || null,
    reference: i.Reference || null,
    invoice_date: day(i.Date),
    due_date: day(i.DueDate),
    exclusive: num(i.Exclusive),
    tax: num(i.Tax),
    total,
    amount_due: due,
    paid: !!i.Paid || (due != null && due <= 0),
    status: i.Status || null,
    sage_modified: i.Modified ? String(i.Modified) : null,
    synced_at: new Date().toISOString(),
  };
}

async function sync(env) {
  const sage = sageClient(env);
  const state = (await sbJson(env, `/rest/v1/sage_state?id=eq.1&select=*`, { headers: sb(env) }))[0] || {};

  // Company.
  let companyName = state.company_name || null;
  if (!sage.companyId) {
    if (state.company_id) {
      sage.setCompany(state.company_id);
    } else {
      const companies = await sage.call("GET", "Company/Get", {});
      const first = ((companies && companies.Results) || [])[0];
      if (!first) throw new Error("This Sage login has no company");
      sage.setCompany(first.ID);
      companyName = first.Name || null;
    }
  }

  // Customers (full list, a few calls).
  const cust = await list(sage, "Customer/Get", { $orderby: "ID" }, MAX_CALLS);
  await upsert(
    env,
    "sage_customers",
    cust.rows.map((c) => ({
      sage_id: c.ID,
      name: c.Name || `Customer ${c.ID}`,
      email: c.Email || null,
      tax_reference: c.TaxReference || null,
      balance: num(c.Balance),
      credit_limit: num(c.CreditLimit),
      active: c.Active !== false,
      sage_modified: c.Modified ? String(c.Modified) : null,
      synced_at: new Date().toISOString(),
    })),
  );

  // Invoices changed since the last run (first run: the last two years).
  const since =
    state.invoices_since ||
    new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 19);
  const changed = await list(
    sage,
    "TaxInvoice/Get",
    { $filter: `Modified ge ${odataDate(since)}`, $orderby: "Modified" },
    MAX_CALLS - 6,
  );
  await upsert(env, "customer_invoices", changed.rows.map(invoiceRow));
  const invoicesSince = maxText(changed.rows, state.invoices_since);

  // Everything still owing, refreshed every run; a stored invoice no longer
  // owing in Sage is paid.
  const owing = await list(sage, "TaxInvoice/Get", { $filter: "AmountDue gt 0", $orderby: "ID" }, MAX_CALLS - 3);
  await upsert(env, "customer_invoices", owing.rows.map(invoiceRow));
  if (owing.complete) {
    const ids = new Set(owing.rows.map((i) => i.ID));
    const stored = await sbJson(env, `/rest/v1/customer_invoices?amount_due=gt.0&select=sage_id`, {
      headers: sb(env),
    });
    const settled = (stored || []).map((r) => r.sage_id).filter((id) => !ids.has(id));
    for (let i = 0; i < settled.length; i += 100) {
      await sbJson(env, `/rest/v1/customer_invoices?sage_id=in.(${settled.slice(i, i + 100).join(",")})`, {
        method: "PATCH",
        headers: sb(env, { "content-type": "application/json", prefer: "return=minimal" }),
        body: JSON.stringify({ amount_due: 0, paid: true, synced_at: new Date().toISOString() }),
      });
    }
  }

  // Receipts changed since the last run.
  const rSince =
    state.receipts_since ||
    new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 19);
  const receipts = await list(
    sage,
    "CustomerReceipt/Get",
    { $filter: `Modified ge ${odataDate(rSince)}`, $orderby: "Modified" },
    MAX_CALLS,
  );
  await upsert(
    env,
    "customer_receipts",
    receipts.rows.map((r) => ({
      sage_id: r.ID,
      sage_customer_id: r.CustomerId,
      document_number: r.DocumentNumber || null,
      reference: r.Reference || null,
      description: r.Description || null,
      receipt_date: day(r.Date),
      total: num(r.Total),
      unallocated: num(r.TotalUnallocated),
      sage_modified: r.Modified ? String(r.Modified) : null,
      synced_at: new Date().toISOString(),
    })),
  );
  const receiptsSince = maxText(receipts.rows, state.receipts_since);

  // Identical company names link up by themselves.
  const matched = await sbJson(env, `/rest/v1/rpc/sage_auto_match`, {
    method: "POST",
    headers: sb(env, { "content-type": "application/json" }),
    body: "{}",
  });

  const count = async (path) => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      method: "HEAD",
      headers: sb(env, { prefer: "count=exact" }),
    });
    const m = (r.headers.get("content-range") || "").match(/\/(\d+)$/);
    return m ? Number(m[1]) : null;
  };

  return {
    company_id: Number(sage.companyId),
    company_name: companyName,
    invoices_since: invoicesSince,
    receipts_since: receiptsSince,
    customers: cust.rows.length,
    invoices: await count("customer_invoices?select=sage_id"),
    receipts: await count("customer_receipts?select=sage_id"),
    linked_customers: await count("clients?select=id&sage_customer_id=not.is.null"),
    matched,
    calls: sage.calls,
    more: !changed.complete || !receipts.complete,
  };
}

async function saveState(env, patch) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/sage_state?on_conflict=id`, {
    method: "POST",
    headers: sb(env, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({ id: 1, ...patch }),
  }).catch(() => undefined);
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase isn't configured on this deployment." }, 500);
  }
  const cronKey = request.headers.get("x-cron-key");
  const viaCron = !!cronKey && !!env.CRON_SECRET && cronKey === env.CRON_SECRET;
  if (!viaCron && !(await callerMaySeeAccounts(env, request.headers.get("authorization")))) {
    return json({ error: "Not allowed." }, 403);
  }
  if (!env.SAGE_API_KEY || !env.SAGE_USERNAME || !env.SAGE_PASSWORD) {
    return json(
      {
        error:
          "Sage isn't connected yet, add SAGE_API_KEY, SAGE_USERNAME and SAGE_PASSWORD to the " +
          "Cloudflare Pages project (Settings › Variables and Secrets), then redeploy.",
        notConnected: true,
      },
      503,
    );
  }
  try {
    const r = await sync(env);
    const now = new Date().toISOString();
    await saveState(env, {
      company_id: r.company_id,
      company_name: r.company_name,
      invoices_since: r.invoices_since,
      receipts_since: r.receipts_since,
      customers: r.customers,
      invoices: r.invoices,
      receipts: r.receipts,
      linked_customers: r.linked_customers,
      last_sync_at: now,
      last_ok_at: now,
      last_error: null,
    });
    return json(r);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await saveState(env, { last_sync_at: new Date().toISOString(), last_error: msg });
    return json({ error: "Sage sync failed: " + msg }, 502);
  }
}
