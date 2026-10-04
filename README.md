# Turnip Tycoon

An Animal Crossing: New Horizons turnip price calculator, following the agreed [implementation plan](turnip-app-plan.md).

The app opens directly to the current week's prices: an optional Sunday purchase price and a Monday–Saturday AM/PM table. Its cream background, plum accents, rounded cards, and compact Prices / Friends / History / Settings navigation take inspiration from the sibling `turnipcc` prototype. Forecast ranges and pattern probabilities appear alongside the table on desktop and below it on narrow screens. Prediction details and available forecast ranges stay visible without expanding a widget, including in own history and shared weeks. There is no landing page or signup step.

Click or tap a half-day in the forecast chart to see its potential minimum and maximum prices. Keyboard users can focus the chart and use the arrow keys, Home, and End to select a half-day; Escape dismisses the tooltip. Reported prices also appear in the tooltip when available. The same chart is used for own and shared weeks.

For a new, unsaved week, **Last week's pattern** defaults to the same player's immediately preceding week only when `predictWeek` identifies a single possible pattern. Missing, ambiguous, or inconsistent results leave it Unknown; an older week is never carried forward. Saved choices, including Unknown, are preserved, and the field remains editable. A cached preceding week can supply the default offline. On initialization, fresh server data takes priority over an unchanged cache; pending local edits to the preceding week can update the default, including to Unknown. Applying the default alone does not create a history entry; an actual save does.

The centered footer follows `turnipcc`: a linked “Inspired by Turnip Prophet” credit, “A fan project, not affiliated with Nintendo.”, and an expandable attribution area that loads the bundled NOTICE and Apache 2.0 license.

A player and device session are created silently. Each player receives an immutable, app-generated friend code, used as the initial display name; the name can be changed in Settings. Nintendo friend codes are not used. Recovery-code creation and device pairing are optional Settings actions.

The calculator includes local predictions, IndexedDB price storage, revisioned uploads with retry and conflict handling, and read-only history. Friends adds working group creation, joining by code or shared link, sharing, leaving, and price comparisons. Groups hold up to eight players; players can belong to any number of groups. There are no owner roles, and the final departure automatically deletes an empty group.

All friends deduplicates players shared through multiple groups. The Friends screen compares each member's Sunday buy price and all twelve selling periods in a table. Reported prices use solid green cells; unentered selling periods show dashed purple min–max predictions when the engine can produce a forecast. Unavailable values remain “—”, and inconsistent inputs retain their reported prices. Each row links to the member's week. Valid forecasts show the probabilities of all four selling patterns beneath the prices, sorted highest to lowest for each player, including 0% for ruled-out patterns; unavailable forecasts show their status instead. The four probabilities use a 2×2 grid on mobile in both Full week and By day.

Full week is the default at every screen width. At narrow widths, only the price columns scroll horizontally; player names and selling-pattern probabilities stay in place. The optional By day view contains each member's Sunday buy price and the selected day's AM/PM values. The calculator's compact friends panel keeps its selected-period, reported-price comparison.

Group members can open one another's read-only weeks and paginated history; the server checks current shared membership on every request. Shared prices load on opening and through manual Refresh, with a 60-second client cooldown stored in IndexedDB. There is no polling or refresh on tab focus. A player's own uploads run immediately and independently of that cooldown.

A web app manifest, Apple touch icon, and regular/maskable PWA icons are included. A service worker, full PWA installation verification, and reliable offline opening are still outstanding. Once the app is loaded, cached own prices, calculation, and queued edits can work without a connection; that is separate from opening the app offline. Shared group data is fetched with a current membership check and is not persisted as offline proof of access.

The supplied raccoon mascot is used for the header and browser icons. Small optimized web assets live in `public/icons`; Apple App Store/Xcode and Google Play exports live in `exports/app-icons` and are not downloaded by the website. Run `pnpm icons:generate` to regenerate them from the retained source. See [icon assets and platform requirements](assets/branding/README.md).

## Run locally

Use Node.js 24 and pnpm 10.15.0, pinned in `package.json`. If you use nvm, run `nvm use` to select the version in `.nvmrc`. Enable Corepack so `pnpm` uses the pinned version:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5173**. This starts a real local PostgreSQL 17 database, applies migrations, and starts React and the Hono API in the Cloudflare Workers development runtime. No cloud account or Docker installation is needed. Database files persist in `.local/postgres`; stop with Ctrl+C. The bundled PostgreSQL runtime must run as a regular user, not root.

Approved native build dependencies are listed in `pnpm-workspace.yaml`; their install scripts prepare the development binaries. If pnpm reports another blocked dependency, review its setup script before adding it to that allowlist and rebuilding it. Keep the allowlist explicit instead of approving every dependency.

The local database listens only on `127.0.0.1:54329`. Its checked-in credentials are for this local development instance only. To use your own PostgreSQL instead, start it separately, set `DATABASE_URL` in `.env` for migrations and `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in `.dev.vars` for the Worker, then run:

```sh
pnpm db:migrate
pnpm dev:app
```

See [.env.example](.env.example) and [.dev.vars.example](.dev.vars.example). Never prefix database credentials with `VITE_`, which exposes variables to the browser.

## Verify

```sh
pnpm check          # lint, strict TypeScript, local build, unit and PostgreSQL integration tests
pnpm format:check
pnpm typegen        # regenerate production Worker binding types
pnpm deploy:check   # bundle the API Worker without publishing
```

`pnpm build:pages` additionally validates and builds the GitHub Pages frontend. Set `VITE_API_URL` in `.env.pages.local` first; `.env.pages.example` shows its format. CI uses an isolated example origin when checking the Pages build, never a production database.

The integration suite starts temporary PostgreSQL databases. It covers identity creation, access isolation, device revocation, single-use pairing/recovery, cross-origin bearer authentication, weekly ownership, concurrent saves, retry deduplication, conflict snapshots, groups, and migrations. Client tests cover storage, synchronization, credential persistence and URL generation. Prediction tests cover all four patterns and audited upstream fixes.

For browser verification, use two independent profiles to create/join a group, compare prices, connect a second device, revoke it, and recover with a one-time code. Check reloads on shared URLs, offline price edits followed by reconnection, and the horizontally scrolling full-week table at 320 pixels. The Pages build must also be tested with third-party cookies blocked.

## Structure

| Path               | Responsibility                                                 |
| ------------------ | -------------------------------------------------------------- |
| `src/client`       | Weekly table, forecasts, Friends, shared/own history, Settings |
| `src/client/data`  | Browser API, identity bootstrap, IndexedDB, sync queue         |
| `src/shared`       | API/week/group contracts and device-local calendar helpers     |
| `src/prediction`   | Standalone prediction adapter and audited upstream engine      |
| `src/server`       | Hono API, access, weekly records, groups and shared reads      |
| `src/db/schema.ts` | Drizzle PostgreSQL schema                                      |
| `drizzle`          | Versioned SQL migrations and schema snapshots                  |
| `scripts`          | Local database, development server, migration tooling          |
| `tests/api`        | API and schema integration tests                               |
| `tests/prediction` | Prediction fixtures and regression tests                       |
| `public/licenses`  | Distributed upstream licenses and notices                      |

Create a new migration with `pnpm db:generate` after changing the schema. Apply migrations with `pnpm db:migrate`; the development launcher also applies them on startup.

The `0001_generated_friend_codes` migration replaces legacy friend-code values with unique app-generated codes while preserving existing custom names, island names, sessions, and price history. The Settings interface no longer requests island names or Nintendo codes.

## Access design

- Opening the calculator reuses a valid device credential or silently creates a player and session. The public friend code identifies the player; it is neither a recovery secret nor a group admission code. No recovery credential is created during bootstrap.
- Each device has an independent random session secret, expiring after 180 days; PostgreSQL stores only its SHA-256 verifier. Local development uses an HttpOnly, SameSite=Strict cookie. Production on GitHub Pages uses an Authorization bearer token and does not depend on cross-site cookies. The browser persists its credential encrypted with a non-extractable AES-GCM key in IndexedDB. This protects against storing the raw token, but does not protect against malicious JavaScript running on the same origin. Other projects under the same `rakantor.github.io` origin share that security boundary.
- Pairing begins on the new device. A temporary, high-entropy code is approved from an existing session, then claimed by the initiating browser using a separate secret: a cookie locally or an in-memory token in the initiating Pages tab. Approval alone does not give the approver the new device's session.
- Pairing expires after ten minutes. Revoking the approving device invalidates its outstanding challenges.
- Recovery codes are generated only when requested in Settings. Codes are single-use: successful recovery atomically replaces the code and issues a new independent session. Existing devices can be revoked in Settings.
- Authenticated mutations serialize against the player record and revalidate the session inside the transaction. Other players cannot supply an ownership ID to change these records.
- Weekly saves use immutable mutation IDs, payload hashes, and base revisions. Replaying an acknowledged request returns its original revision; a conflicting edit returns the current server snapshot for review. Browser caches are separated by player, and authenticated requests assert the expected player to prevent a stale tab from uploading into a newly connected profile.
- Group codes grant admission, while generated player friend codes identify players. Membership changes serialize against the group record to enforce capacity and atomically delete empty groups. Shared reads hold group locks through membership checks and data reads; another player's week or history is available only while a current shared group permits it. Group membership never grants editing rights.
- Production browser requests allow exactly the configured `FRONTEND_ORIGIN`; preflight validation runs before opening a database connection. Bearer mutations require that origin and protected endpoints still require the device credential. Local cookie mutations retain same-origin checks. Body-bearing endpoints accept bounded JSON with strict validation. API responses are not cacheable. Recovery codes are never persisted by the application, and credentials are never logged. Encrypted device credentials and public profile metadata are saved together; stale identity responses must not overwrite a recovered or paired identity.

The `turnip_private` database schema is outside Supabase's default exposed schemas. All application tables enable row-level security without public policies. Keep this schema out of the Supabase Data API. The backend expects a trusted database role that owns these tables, or a role with both explicit schema/table privileges and BYPASSRLS. Browsers never receive database credentials or a Supabase service key.

## Deploy to GitHub Pages and Cloudflare

The frontend is served at `https://rakantor.github.io/turnip-tycoon/`. Its Pages build uses hash routes, such as `/turnip-tycoon/#/settings`, so direct links work on GitHub's static hosting. Vite rebases assets to `/turnip-tycoon/`, and generated invite/pairing URLs preserve that path.

The API runs separately at `https://turnip-tycoon.rakantor-dev.workers.dev` on Cloudflare Workers after deployment. `wrangler.jsonc` contains the production Hyperdrive ID, bearer authentication mode, and allowed frontend origin. The Hyperdrive ID is a non-secret resource identifier; database passwords and Cloudflare API tokens must stay out of Git. Database credentials are stored in Hyperdrive. The Worker requires no separate database-password secret.

`wrangler.dev.jsonc` is exclusively for local development and preview. It uses the embedded local database and cookie authentication. The deployment commands always specify the production configuration explicitly, so a previous Vite preview build cannot redirect a production deployment to the local configuration.

1. Apply the SQL migrations to Supabase using `DATABASE_URL` in the ignored `.env`, then run `pnpm db:migrate`. From an IPv4-only computer, copy the complete **Session pooler** connection string on port **5432**; its username and hostname differ from Direct. Use TLS with certificate verification for hosted migration connections (`sslmode=verify-full` and `sslrootcert` pointing to the downloaded Supabase CA certificate).
2. Configure Hyperdrive with Supabase's **Direct connection** endpoint on port **5432**. Disable query caching so authentication, revocation, membership, and saved-price reads are current. Hyperdrive handles its own pooling; the local migration pooler choice does not change this setting.
3. Sign into Cloudflare with `pnpm exec wrangler login`. Run `pnpm check` and `pnpm deploy:check`, then publish the API with `pnpm deploy:api`. Save the resulting `https://turnip-tycoon.<subdomain>.workers.dev` origin.
4. In the GitHub repository, set **Settings → Pages → Source** to **GitHub Actions**. Under **Settings → Secrets and variables → Actions**, add repository variable `VITE_API_URL` with that API origin. It is public configuration and must contain no credentials, path, or query string.
5. Run the **Deploy GitHub Pages** workflow. It validates the project, builds `dist/pages`, and publishes only that static directory. Both deployment workflows are manual (`workflow_dispatch`), so pushing code does not publish automatically.
6. To deploy the API through GitHub Actions, create an appropriately scoped Cloudflare API token, save it as the `CLOUDFLARE_API_TOKEN` Actions secret, and add the `CLOUDFLARE_ACCOUNT_ID` repository variable. Then run **Deploy API Worker**. The job uses the `production` GitHub environment, where deployment protection rules can be configured.
7. Verify the API `/api/health` response and the hosted frontend's silent bootstrap, price saves/reloads, groups, pairing, recovery, and device revocation. Real-device PWA installation and reliable offline opening remain a separate milestone.

For a production Pages build, put the deployed API origin in `.env.pages.local` and run `pnpm build:pages`. To preview the complete setup locally, first leave `pnpm db:local` running (or reuse the database started by `pnpm dev`). Start a local bearer-mode Worker in another terminal:

```sh
pnpm exec wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port 8787 --var FRONTEND_ORIGIN:http://localhost:4174
```

Build and serve the Pages frontend in a third terminal:

```sh
VITE_API_URL=http://127.0.0.1:8787 pnpm build:pages
VITE_API_URL=http://127.0.0.1:8787 pnpm preview:pages
```

Open `http://localhost:4174/turnip-tycoon/`. This uses the local database, not Supabase. The production origin allowlist intentionally rejects localhost pages. Rebuild with `pnpm build:pages` before publishing to restore the production API origin.

The frontend build receives only public `VITE_` configuration. `.env` is for migration tooling. `secrets.required` is empty in both Worker configs so Wrangler does not infer migration credentials as Worker secrets or generated bindings.

References: [Cloudflare Supabase connection](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The prediction engine is adapted from [Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices), pinned to `c7b7ab3614faf61686da3c535cf204ef568d4cdb`. Its Apache 2.0 license, NOTICE, and copyright attribution are distributed with the app. The [engine audit](src/prediction/UPSTREAM_AUDIT.md) records reproduced small-spike fixes, input conventions, and remaining approximation limits. Compatibility with the current game version is not yet independently verified.
