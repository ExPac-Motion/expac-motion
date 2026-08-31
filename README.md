# ExPac Motion

Quoting, rates and shipment-tracking tool for ExPac Forwarding.

Quote builder → job / milestone tracking → light client & supplier CRM → dashboard.

## Stack

| Layer    | Choice                                                     |
| -------- | -------------------------------------------------------- |
| Frontend | React 19 + Vite + TypeScript, React Router, TanStack Query |
| Backend  | Supabase (Postgres, Auth, auto REST API)                 |
| Auth     | Email + password, one login per team member              |
| Hosting  | Static host (Cloudflare Pages)                            |

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the two Supabase values
npm run dev
```

First run also needs the database schema — run every file in `supabase/migrations/`
in number order in the Supabase SQL editor. Full walkthrough in **[SETUP.md](SETUP.md)**.

## Scripts

- `npm run dev` — local dev server on <http://localhost:5173>
- `npm run build` — type-check + production build to `dist/`
- `npm run preview` — serve the production build locally
- `npm run lint` — oxlint

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings: **build command** `npm run build`, **output directory** `dist`.
4. **Settings → Environment variables** (Production *and* Preview): add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as `.env.local`).
5. SPA routing is handled by `public/_redirects` (`/* → /index.html 200`) — nothing to configure.
6. After the first deploy, copy the `*.pages.dev` URL into Supabase →
   **Authentication → URL Configuration** (Site URL + Redirect URLs). Repeat for any
   custom domain you add.

Every push to the default branch redeploys automatically.

## Project layout

```
src/
  auth/         AuthProvider, LoginPage
  components/   Layout (sidebar), Modal, Toast, shared bits
  lib/          supabase client, types, calc, charge catalog, FX, db access, hooks
  pages/        Dashboard, Quotations list, Quote builder, Quote detail, Jobs, Contacts
supabase/
  migrations/   numbered .sql — tables, RPCs, row-level-security; run in order
```
