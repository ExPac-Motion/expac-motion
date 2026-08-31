# EXPAC Rate Desk — Setup & Deployment

A quoting → job-tracking → light-CRM tool for ExPac Forwarding.

- **Frontend:** React + Vite + TypeScript (single-page app)
- **Backend:** Supabase (hosted Postgres + Auth + auto REST API) — no server code to run
- **Auth:** email + password, one login per team member

---

## 1. Create the Supabase project (once, ~5 min)

1. Go to <https://supabase.com>, sign up / sign in, click **New project**.
2. Name it e.g. `expac-rate-desk`, pick the region closest to South Africa
   (**EU West (London)** `eu-west-2` is usually the best latency), set a strong
   database password (save it in your password manager), create the project.
3. When it finishes provisioning, open **Project Settings → API** and copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **Project API keys → `anon` `public`** → this is `VITE_SUPABASE_ANON_KEY`
   (The `service_role` key is secret — never put it in this app.)

## 2. Create the database schema

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Run each file in `supabase/migrations/` **in order**, pasting the whole file
   and clicking **Run** (a "destructive operations" warning on `drop ... if
   exists` lines is expected — they're no-ops on a fresh DB):
   - `0001_init.sql` — tables (`clients`, `suppliers`, `quotes`, `quote_lines`,
     `jobs`, `job_events`, `profiles`), the `save_quote` / `accept_quote` /
     `set_job_milestone` functions, row-level-security.
   - `0002_charge_categories_fx.sql` — adds charge categories + per-line
     `code` / `cur` / `unit`, and per-quote FX rates; widens `save_quote`.
   Any later `00NN_*.sql` files are added the same way, in number order.
   These policies let any
   signed-in ExPac user read and write company data.

## 3. Auth settings

In **Authentication → Providers → Email**:

- Keep **Email** enabled.
- For a small internal team, turn **Confirm email** *off* so you can create
  logins without waiting for confirmation emails. (Leave it on if you'd rather
  verify addresses — users then click a link before first sign-in.)
- **Authentication → URL Configuration:** set **Site URL** to
  `http://localhost:5173` for now; add your deployed URL later (step 6).

To add a teammate: either let them use **"Create an account"** on the login
screen, or go to **Authentication → Users → Add user** and send them the
password. There are no roles yet — every login has full access.

## 4. Point the app at Supabase

In the project root, edit **`.env.local`** (already created, git-ignored):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...your-anon-key...
```

## 5. Run it locally

You need Node.js 20+ (already installed on this machine — if a terminal says
`node` is not found, close and reopen it so the PATH refreshes).

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, create an account, and you're in. If you change
`.env.local`, stop the server (Ctrl+C) and run `npm run dev` again.

## 6. Deploy (whole team can reach it with a login)

The app is a static build (`npm run build` → `dist/`). Any static host works;
**Cloudflare Pages**, **Netlify**, or **Vercel** all have a free tier.

**Netlify example:**

1. Push this project to a GitHub repo.
2. Netlify → **Add new site → Import from Git**, pick the repo.
3. Build command `npm run build`, publish directory `dist`.
4. **Site settings → Environment variables:** add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (same values as `.env.local`).
5. Add a redirect so client-side routing works — create `public/_redirects`
   with one line: `/*  /index.html  200` (Netlify) or configure an SPA
   fallback on your host.
6. Deploy. Copy the site URL back into Supabase **Authentication → URL
   Configuration → Site URL / Redirect URLs**.

That's it — share the URL, each person makes a login.

---

## Data model notes

- A **quote** owns its **charge lines** in the `quote_lines` table (foreign key
  with `on delete cascade`). Saving goes through the `save_quote` Postgres
  function, which upserts the quote and **replaces all its lines in one
  transaction** — so the itemised breakdown always reloads with the quote.
  (This is the bug that the previous prototype had.)
- **Accepting** a quote calls `accept_quote`, which flips the status and creates
  one linked **job** (idempotent — accepting twice won't make two jobs).
- Advancing a job milestone calls `set_job_milestone`, which updates the job and
  appends a row to `job_events` so there's a history of when each stage changed.

## Out of scope (per the brief)

Multi-currency, volumetric calculators, invoicing/accounting, warehouse,
customer portal, automated carrier tracking, preset charge-code libraries.
