# Contributing to Turnip Tycoon

Turnip Tycoon uses React and Vite for the calculator, a Hono API on Cloudflare Workers, and PostgreSQL through Drizzle and Hyperdrive. Predictions run in the browser. GitHub Pages serves the frontend separately from the API.

[Local development](#local-development) · [Checks](#checks) · [Architecture](#architecture-and-data-rules) · [Deployment](#deployment) · [Offline testing](#offline-and-update-verification) · [Assets and licensing](#assets-and-licensing)

## Local development

Use Node.js 24 and pnpm 10.15.0. The versions are recorded in `.nvmrc` and `package.json`; run `nvm use` if you use nvm, then:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5173**. The launcher starts PostgreSQL 17, applies migrations, and runs React and the Workers API without Docker or cloud accounts. Stop with Ctrl+C; data persists in `.local/postgres`.

PostgreSQL listens on `127.0.0.1:54329` with local-only credentials and must run as a regular user. Review native install scripts before extending the `pnpm-workspace.yaml` dependency allowlist.

To use another PostgreSQL instance, start it separately and configure:

| File               | Variable                                                   | Purpose                             |
| ------------------ | ---------------------------------------------------------- | ----------------------------------- |
| `.env`             | `DATABASE_URL`                                             | Database migration connection       |
| `.dev.vars`        | `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | Local Worker's database connection  |
| `.env.pages.local` | `VITE_API_URL`                                             | Public API origin for a Pages build |

See [.env.example](.env.example), [.dev.vars.example](.dev.vars.example), and [.env.pages.example](.env.pages.example). The actual configuration files are ignored by Git. Never prefix credentials with `VITE_`: those variables are public browser configuration.

With an external local database configured, run:

```sh
pnpm db:migrate
pnpm dev:app
```

After schema changes, run `pnpm db:generate`, review the migration, then apply it with `pnpm db:migrate`. Forward migrations must preserve existing profiles and history.

## Checks

```sh
pnpm check          # lint, strict TypeScript, local build, unit and PostgreSQL integration tests
pnpm format:check
pnpm typegen        # regenerate production Worker binding types
pnpm deploy:check   # bundle the API Worker without publishing
```

Run `pnpm build:pages` as well when changing the frontend or deployment configuration. Set `VITE_API_URL` in `.env.pages.local` first. CI uses an isolated example API origin for build checks and does not connect to the production database.

Tests cover temporary PostgreSQL databases, authentication and ownership, concurrent/idempotent writes, groups, browser storage/sync, PWA generation and updates, and prediction fixtures.

For browser changes, test saves/reloads, groups, pairing, revocation, and recovery in independent profiles. Check shared links, Pages with third-party cookies blocked, keyboard/touch chart controls, and the horizontally scrolling price table at 320 pixels.

Use **Conventional Commits with single-line messages**, for example:

```text
feat: add offline forecast access
fix: retain queued prices after reconnecting
docs: clarify local Pages setup
```

Keep each commit focused on a coherent change. Describe the resulting behavior, relevant checks, and any remaining limitations in the pull request.

## Architecture and data rules

| Path               | Responsibility                                                      |
| ------------------ | ------------------------------------------------------------------- |
| `src/client`       | Calculator, forecasts, Friends, history, Settings, and PWA controls |
| `src/client/data`  | Browser API, identity bootstrap, IndexedDB, and sync queue          |
| `src/shared`       | API/week/group contracts and device-local calendar helpers          |
| `src/prediction`   | Standalone prediction adapter and audited upstream engine           |
| `src/server`       | Hono API, access, weekly records, groups, and shared reads          |
| `src/db/schema.ts` | Drizzle PostgreSQL schema                                           |
| `drizzle`          | Versioned SQL migrations and snapshots                              |
| `scripts`          | Local database, development server, migrations, and icon generation |
| `tests/api`        | API and database integration tests                                  |
| `tests/client`     | Browser-storage, session, synchronization, and PWA tests            |
| `tests/prediction` | Prediction fixtures and regression tests                            |
| `tests/build`      | Generated service-worker behavior                                   |
| `public/licenses`  | Distributed upstream licenses and notices                           |

Keep launch focused on price entry with silent identity creation and app-generated friend codes. Weeks use the device's local calendar, start Sunday, and retain unknown observations. Historical screens are read-only, but queued edits must upload after rollover. Infer the previous pattern only from the immediately preceding week when unique; otherwise use Unknown and preserve saved/manual choices.

Groups allow eight equal members and unlimited memberships. Store prices once, deduplicate overlapping friends, and delete empty groups without deleting prices. Opening Prices or Friends reads the server at most once a minute, silently, with no refresh button; own uploads, group changes and error retries bypass that limit. Display observations separately from predictions and order all pattern probabilities highest first.

### Access and security invariants

- Device secrets expire after 180 days; PostgreSQL stores SHA-256 verifiers. Local development uses HttpOnly, SameSite=Strict cookies. Pages uses bearer credentials encrypted in IndexedDB with a non-extractable AES-GCM key. Encryption does not defend against same-origin JavaScript; sibling GitHub Pages projects share that boundary.
- Save credentials and public profile metadata atomically. Reject stale identity responses. Expected-player assertions prevent older tabs from uploading into another identity, but never replace authentication.
- Recovery is opt-in and single-use, atomically rotating the code and issuing a new session. Never persist recovery codes or log credentials. Pairing requires existing-device approval and a separate initiating-browser claim secret; challenges expire after ten minutes and are invalidated when the approving device is revoked.
- Mutations serialize against the player and revalidate the session inside the transaction. Immutable mutation IDs, payload hashes, and base revisions provide retry deduplication and explicit conflicts; retain pending local values for review.
- Group changes serialize against the group. Shared reads lock through current-membership validation and data retrieval. Membership never grants editing rights. Each profile keeps only the latest current-week groups response in IndexedDB, codes included, for offline reading; each refresh replaces it, and a 401/403 or a rejected device session deletes it.
- Enforce the exact `FRONTEND_ORIGIN`, validate preflights before opening database connections, require credentials on protected endpoints, and validate bounded JSON bodies. Cookie mutations retain same-origin checks. API responses must remain uncacheable.

The `turnip_private` schema enables RLS without public policies and must stay outside the Supabase Data API. Use a trusted database role that owns the tables, or has explicit privileges plus BYPASSRLS. Never expose database credentials or a Supabase service key to browsers.

## Deployment

Frontend: `https://rakantor.github.io/turnip-tycoon/`. API: `https://turnip-tycoon.rakantor-dev.workers.dev`. Pages uses hash routes and project-relative assets and links.

`wrangler.jsonc` configures the production API, bearer auth, allowed origin, and Hyperdrive. The Hyperdrive ID is public; database credentials stay in Hyperdrive. `wrangler.dev.jsonc` uses local PostgreSQL and cookie auth. Deployment commands explicitly select the production configuration.

### Supabase and Hyperdrive

1. Put the hosted migration connection in the ignored `.env.production` as `DATABASE_URL` (see [.env.production.example](.env.production.example)), then run `pnpm db:migrate:prod`. Only that command reads `.env.production`; `pnpm dev` and `pnpm db:migrate` never do. On an IPv4-only computer, use Supabase's complete **Session pooler** connection string on port **5432**; its username and hostname differ from Direct. Use verified TLS with `sslmode=verify-full` and `sslrootcert` pointing to the downloaded Supabase CA certificate.
2. Connect Hyperdrive to Supabase's **Direct connection** endpoint on port **5432**. Disable query caching so authentication, membership, revocation, and saved-price reads stay current. Hyperdrive handles pooling; the local migration pooler choice does not change this connection.
3. Run `pnpm exec wrangler login`, then `pnpm check` and `pnpm deploy:check`. Publish the API with `pnpm deploy:api` and retain its Worker origin.

### GitHub Actions

1. Set **Settings → Pages → Source** to **GitHub Actions**.
2. Add `VITE_API_URL` under **Settings → Environments → github-pages → Environment variables**. The build and deploy jobs both select this environment. A repository-level Actions variable also works. Use only the public API origin: no credentials, path, or query string. There is no workflow fallback, and local `.env.pages.local` files do not reach GitHub Actions.
3. A push to `main` runs **Deploy GitHub Pages** automatically. The workflow checks the project, builds `dist/pages`, and publishes that directory. Other branches do not deploy Pages.
4. API deployment remains manual. To use **Deploy API Worker**, configure a scoped `CLOUDFLARE_API_TOKEN` Actions secret and the `CLOUDFLARE_ACCOUNT_ID` repository variable. The workflow uses the `production` environment, which can have deployment protection rules.
5. After deploying, check `/api/health`, silent bootstrap, price saves/reloads, groups, pairing, recovery, and revocation. Complete the offline and mobile checks below before release.

Only public `VITE_` configuration enters the frontend build. `.env` and `.env.production` are for migration tooling. Both Worker configurations set `secrets.required` to an empty list so Wrangler does not infer migration credentials as Worker secrets or generated bindings.

Documentation: [Cloudflare with Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [Hyperdrive caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

### Local Pages preview

For a production frontend build, set the deployed API origin in `.env.pages.local` and run `pnpm build:pages`.

To test the complete Pages setup locally, leave `pnpm db:local` running, or reuse the database started by `pnpm dev`. Start a local bearer-mode Worker in another terminal:

```sh
pnpm exec wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port 8787 --var FRONTEND_ORIGIN:http://localhost:4174
```

Build and serve the Pages frontend in a third terminal:

```sh
VITE_API_URL=http://127.0.0.1:8787 pnpm build:pages
VITE_API_URL=http://127.0.0.1:8787 pnpm preview:pages
```

Open **http://localhost:4174/turnip-tycoon/**. With the checked-in local connection settings, this uses the local database, not Supabase. Production's origin allowlist intentionally rejects localhost pages. Rebuild with the production `VITE_API_URL` before publishing.

## Offline and update verification

Production Pages builds, including local Pages preview, generate a worker scoped to `/turnip-tycoon/`. Normal development does not install it. Precache only the static app, icons, manifest, and licenses; scope cache cleanup to the project. API responses, credentials, and friends' data must never enter Cache Storage. Own records, queued edits, and the latest copy of friends' current-week prices stay in IndexedDB.

Offline reopening needs one online visit to complete profile setup and reach **Settings → Offline access → Ready to open offline**. Cached own weeks, forecasts, and new local edits then work offline; uploads resume when connected with the app open. Friends show this week's prices from the last online visit; refreshing, joining, and leaving need a connection. Closed-app background uploading is not promised.

Settings provides installation, offline readiness, retry, and update checks. Installation is optional and uses the browser prompt or instructions, including Safari's **Share → Add to Home Screen**. On phones, an **Install** shortcut beside Settings opens the same prompt, or the Settings instructions when the browser offers none, and disappears once the app runs installed or Chromium reports an installed copy. Downloaded updates wait for **Update now** on a safe screen, flush valid local writes, and block on invalid drafts or an unrestorable profile. Pending uploads need not finish first. Only the requesting tab reloads.

Using the local Pages preview:

1. Open online, save a price, and wait for offline readiness. Inspect the worker scope and verify Cache Storage contains only static project files.
2. Go offline, close/reopen, edit a price, and reopen again. Confirm forecasts work, the edit remains queued, and Friends still shows this week's shared prices.
3. Reconnect and confirm uploads finish and survive reload. Check conflicts using a second profile/device.
4. Keep two tabs open. Make a visible source change, rebuild with the local API origin, check for updates, and apply from Prices. Confirm the new version, retained queued edits, and no reload in the other tab. Repeat with an invalid draft and with a downloaded update while offline.
5. On physical Android/iOS devices, test installation, standalone launch, recovery, offline reopening, reconnection, and queued uploads after rollover.

Persistent-profile Chromium checks passed for offline reopening/reconnection, downloaded updates applied offline, invalid-draft protection, preserving another tab's draft, 320-pixel Settings, and manifest/installability checks. Automated private profiles stalled during activation; updates timed out safely. **Physical-device installation and further private-mode update verification remain outstanding.**

## Assets and licensing

Original project materials are licensed under the [Apache License, Version 2.0](LICENSE). Contributions are accepted under the same license. Third-party components retain their respective licenses and notices; see [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md).

The mascot's optimized website assets live in `public/icons`. App Store/Xcode and Google Play exports live in `exports/app-icons`, outside the public web bundle. Run `pnpm icons:generate` to regenerate them from the retained source. See [icon assets and platform requirements](assets/branding/README.md).

The prediction engine is adapted from [Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices), pinned to `c7b7ab3614faf61686da3c535cf204ef568d4cdb`. Preserve its Apache 2.0 license, NOTICE, and copyright attribution in the distributed app. The [engine audit](src/prediction/UPSTREAM_AUDIT.md) documents small-spike fixes, input conventions, and remaining approximation limits; [third-party notices](THIRD_PARTY_NOTICES.md) record attribution. Compatibility with the current game version is not yet independently verified.
