---
name: devbyloki-sites
description: Build, run, and maintain devbyloki client websites — an Astro static frontend plus a Cloudflare Worker API (D1, KV, R2) with an OTP-secured /admin panel. Use whenever working in a devbyloki site such as gps-painting or el-patron-barbers, or any site with this Astro-plus-worker-plus-wrangler.toml-plus-migrations layout — running it locally, adding features or admin pages, editing the D1 schema and migrations, wiring worker API routes, deploying to Cloudflare, or scaffolding a brand-new client site from the same pattern. Also use when a dev-server run got confused (started the wrong thing, ran wrangler alone, or only started one of the two servers).
---

# devbyloki client sites

Every devbyloki site is the **same two-part stack**. Learn it once, apply it to every site and to new ones you scaffold for clients.

## The architecture (identical across all sites)

- **Frontend** — Astro, `output: 'static'`. Plain static pages + an `/admin` page. Deployed to **Cloudflare Pages**.
- **API** — a single **Cloudflare Worker** (`worker/index.js`), a hand-rolled router matching `url.pathname`. Deployed to a `*-api.devbyloki.com` custom domain.
- **Data** — Cloudflare **D1** (SQLite, binding `DB`), **KV** (binding `KV`, holds admin sessions), **R2** (binding `R2`, file uploads).
- **Admin** — `/admin` page talks to the worker's `/admin/*` routes. Auth is **OTP by email** (Resend), a session token stored in KV as `admin_session:<hash>`, plus one-time **setup tokens** in D1 for first-run.
- The frontend picks its API base by environment:
  `import.meta.env.DEV ? 'http://127.0.0.1:<workerPort>' : 'https://<site>-api.devbyloki.com'`.

**This means every site runs TWO dev servers at once** — the Astro frontend AND the wrangler worker. That is the single most important thing to get right (see below).

## Step 0 — read this site's specifics (never guess them)

Ports, db name, and Pages project differ per site. Read them, don't assume:

- **`package.json` → `scripts`** — the source of truth for how to run/deploy. You'll find `dev` (Astro port, e.g. `--port 4003`), `worker:dev` (wrangler port, e.g. `--port 8790`), `worker:deploy`, `pages:deploy` (with the `--project-name`), and `db:migrate:local` / `db:migrate:remote`.
- **`wrangler.toml`** — bindings (`DB`/`KV`/`R2`), the D1 `database_name`, the `[env.production]` block (real `database_id`, KV id, routes/custom domain), and `ALLOWED_ORIGINS` (CORS — must include the frontend's dev URL).

Known current sites (verify against the files, these drift):
| Site | Frontend | Worker | D1 db | Pages project |
|---|---|---|---|---|
| gps-painting | 4003 | 8790 | gps-painting-db | gps-painting |
| el-patron-barbers | 4002 | 8789 | el-patron-db | el-patron-barbers |

## Running a site locally — TWO servers, and let the user run them

An Astro/wrangler dev server is **long-running and blocks forever** — never launch one from your own `bash` tool (it will hang your turn) and never try to "start the server" as a single step. And you **cannot** drive OpenChamber's built-in terminal — it's browser-only.

So when the user wants to run a site, **give them the exact commands to paste into two OpenChamber terminals** (they open a terminal from the dashboard; it starts in the project directory), and tell them what each does and the URL it serves. Read the real ports from `package.json` first. Template:

```
# Terminal 1 — frontend (Astro)
npm run dev            # → http://localhost:<frontendPort>  (LAN via --host)

# Terminal 2 — worker API (wrangler, local D1/KV/R2)
npm run worker:dev     # → http://localhost:<workerPort>
```

Both must be running for the site to work — the frontend's admin/API calls hit the worker port. If the user reports the site half-working (pages load but forms/admin fail), the worker terminal is almost certainly not running. If a port is already in use, they started it twice — have them stop the old one rather than picking a new port (the frontend hard-codes the worker port).

For a **one-shot** command that finishes on its own (a build, a migration, a deploy) you *can* run it in `bash` yourself — those return. Only the dev servers are the "hand it to the user" case.

## D1 schema & migrations

Migrations are numbered SQL files in `migrations/` (`001_initial.sql`, `002_*.sql`, …), applied in order. `schema.sql`, where present, is the full current shape for reference.

- **Apply locally:** `wrangler d1 execute <database_name> --local --file=migrations/<file>.sql`
  (or the site's `npm run db:migrate:local -- --file=migrations/<file>.sql`).
- **Apply to production:** the same with `--remote` — do this **deliberately and only when the user asks**; it mutates the live client database.
- **Adding a feature that needs new tables/columns:** write a NEW numbered migration file (never edit an already-applied one), apply it `--local`, verify, and leave the `--remote` apply to a deploy step the user approves.
- Local D1 data lives under the site's `.wrangler/` dir; it's disposable — re-running migrations from scratch is fine in dev.

## Worker API routes & admin

`worker/index.js` is one file: a `fetch(request, env)` handler that reads `url.pathname` + method and matches routes top to bottom. To add an endpoint, add another `if (path === '...' && method === '...')` block, use `env.DB` (prepared statements: `env.DB.prepare(sql).bind(...).run()/.first()/.all()`), `env.KV`, `env.R2`. Public routes live before the admin gate; admin routes check the KV session (`admin_session:<hash>`) first. Keep CORS working — responses go through the site's `json()`/CORS helper and origins are gated by `ALLOWED_ORIGINS` in `wrangler.toml` (add the dev origin there if a new port/host is used).

The `/admin` Astro page is a self-contained client that calls `API + '/admin/...'`. Match its `fetch` shape when adding admin features.

## Deploying (Cloudflare)

Two separate deploys — frontend and worker are independent:

- **Worker API:** `npm run worker:deploy` (`wrangler deploy --env production`) — publishes `worker/index.js` to the `*-api.devbyloki.com` route with the production D1/KV bindings.
- **Frontend:** `npm run build` then `npm run pages:deploy` (`wrangler pages deploy dist --project-name <project>`).
- Deploys hit **live client sites** — confirm with the user before any deploy, and never deploy as a side effect of another task. A schema change means: apply the migration `--remote` first (user-approved), then deploy the worker.

## Scaffolding a NEW client site

Clone the pattern from an existing site (gps-painting is a clean reference):
1. Copy the structure: `astro.config.mjs` (static), `src/` (layouts + `index`/`admin` pages), `worker/index.js`, `wrangler.toml`, `migrations/001_initial.sql`, `package.json` scripts.
2. Rename everything per client: pick unique **dev ports** (frontend + worker — don't collide with running sites), the D1 `database_name`, the Pages `--project-name`, the `*-api` route, and `ALLOWED_ORIGINS`.
3. Create the D1 database (`wrangler d1 create <name>`), put the returned `database_id` in `[env.production]`, apply `001_initial.sql` `--local`.
4. Build out pages + worker routes + admin against the same conventions above.
Keep new sites byte-consistent with the pattern — the whole point is that every devbyloki site works the same way so any of them is instantly familiar.
