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
pnpm check          # lint, strict TypeScript, production build, database/API tests
pnpm format:check   # verify formatting
pnpm typegen        # regenerate Worker bindings after changing wrangler.jsonc
pnpm deploy:check   # validate the built Worker without publishing
```

The integration suite starts isolated, temporary PostgreSQL databases and exercises real transactions, silent identity creation, access isolation, revocation, single-use pairing and recovery, weekly ownership, concurrent saves, retry deduplication, conflict snapshots, pagination, and migrations. Group tests cover concurrent admission at capacity, admission racing the last departure, duplicate joins, overlap deduplication, membership authorization, and retained history after leaving. It does not use a production database. Calculation tests cover the four patterns, incomplete inputs, rounding, contradictions, and reproduced upstream issues. Browser checks use Playwright CLI against the running app.

The pnpm migration preserves the direct dependency versions and passes a clean `pnpm install --frozen-lockfile`, `pnpm check` (including all 124 tests), formatting, icon generation, and the deployment dry run. Both the development server and production preview connect to the existing local database. The dry run checks packaging without publishing.

The current checkpoint passes all 124 tests across eight files, lint, all TypeScript checks, the production build, and formatting. Browser checks confirm Forecast ranges and Prediction details remain visible after heading clicks on desktop and at 320 pixels, including shared weeks; past-week controls remain read-only. A fresh profile starts with Unknown, an unambiguous preceding week defaults to Decreasing without creating history, and a saved manual Unknown survives reload. The footer credit, link, NOTICE, and Apache license render correctly. Desktop and 320-pixel layouts have no page overflow, and desktop and mobile screenshots were reviewed. No deployment or deployment dry run was performed at this checkpoint.

The previous groups checkpoint passed all 104 tests (48 API/schema, 33 prediction, and 23 browser-storage/calendar tests), lint, strict TypeScript, the production build, formatting, and the deployment dry run. The group change included 12 PostgreSQL integration tests. The dry run verifies packaging without publishing or proving hosted database connectivity.

At that checkpoint, Chrome checks with three independent browser profiles verified immediate access to all 13 price inputs, custom names and saved prices, group creation and sharing, and shared links that prefill a code while requiring an explicit Join action. Overlapping groups showed each player once; the then-current comparisons used reported prices for a selected period and left unknown values blank. Member weeks and past history were read-only. Leaving one group preserved access through another, while the final shared departure revoked access and cleared the shared view without deleting own prices. Desktop and 390-pixel screenshots were reviewed, with no horizontal overflow down to a 320-pixel viewport.

The interactive chart and weekly group-table update passes targeted lint, strict TypeScript, the production build, all 33 prediction tests, and formatting checks. Chrome checks verify click selection of the nearest half-day with exact engine min–max values, arrow keys, Home, End, Escape, touch selection of the first and last periods, and the shared-member chart.

At the prior weekly-table checkpoint, browser checks covered five members including a long name, all thirteen price columns, reported values and predicted ranges, a missing Sunday price with a valid sales-based forecast, empty weeks, inconsistent inputs, and group filters. Mobile then defaulted to By day at 390 pixels, showing Sunday plus the selected day's AM/PM values. Both day selection and Full week scrolling worked at narrow widths; names stayed fixed while scrolling, and the page itself fit a 320-pixel viewport. Desktop and mobile screenshots were reviewed. That rebuilt app passed the 320-pixel smoke check: day and full-week views fit the page, semantic column groups matched the visible days, names remained fixed at the far-right scroll position, and chart tooltips fit without overlapping the legend. Its build, strict TypeScript, and formatting checks passed.

The Full week default and fixed probability grid pass lint, strict TypeScript, production build, formatting, and browser checks at 320, 390, 820, and 1280 pixels. Names and all four probabilities remain fixed and visible at the start, middle, and end of horizontal scrolling while price columns move. Both mobile views use the 2×2 probability grid, By day and day selection still work, and no page overflow occurs. The 390-pixel screenshot was reviewed.

The earlier calculator checkpoint also passed its deployment dry run and desktop/phone-size Chrome checks for direct entry, typing during silent login, real forecasts, reloads, offline edits/reconnect, optional recovery, pairing, history, conflict choices, storage failures, and identity-switch races. Actual phone installation and offline opening remain part of the PWA milestone.

To manually check pairing, use two independent browser profiles (or a normal and private window):

1. Open the first window and enter a weekly price. No profile form is required. In Settings, optionally set a name, then choose **Create recovery code** and save it outside the app.
2. Open the second window, then choose **Settings → Connect this device to an existing profile** and generate a connection code.
3. In the first window's Settings, choose **Approve another device** and approve that code. Only approve a code from a device you are connecting yourself.
4. Choose **Finish connecting** in the second window. Both windows should show the same player and saved prices. Switching profiles preserves their separate records; it does not merge them.
5. Revoke the second device from the first. Its next authenticated request should fail.
6. Use a third browser to recover with the saved recovery code. Save the replacement; the old recovery code must no longer work.

Also check price entry with missing values, clearing a saved field, past-week navigation, reconnection after an offline edit, and conflicting edits from two connected devices. Historical controls are read-only; the server still accepts queued edits made before week rollover.

For the chart, enter a Sunday price and some selling prices, then click or tap different half-days to inspect their min–max tooltips. Focus the chart and check arrow keys, Home, End, and Escape. Repeat on a member's read-only week.

For groups, create a group in Friends, then copy its code or share its link with a second browser profile. Join there and enter prices. Refresh in the first profile after the cooldown to compare Sunday, reported sales, and predicted ranges in the table, then open the member's week or history. On mobile, check that Full week opens by default and scroll through Saturday while names and all four probabilities remain visible. Check the 2×2 probability grid in both Full week and the optional By day view. Join both players to a second group to verify that All friends still shows each player once. Leaving one shared group retains access through the other; leaving the final shared group removes access without deleting either player's own records.

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

- Opening the calculator reuses a valid device cookie or silently creates a player and session. The public friend code identifies the player; it is neither a recovery secret nor a group admission code. No recovery credential is created during bootstrap.
- Each device has an independent random session secret, expiring after 180 days. The browser receives it in an HttpOnly, SameSite=Strict cookie; PostgreSQL stores only its SHA-256 verifier. HTTPS uses a Secure `__Host-` cookie. Insecure cookies are allowed only for loopback HTTP development.
- Pairing begins on the new device. A temporary, high-entropy code is approved from an existing session, then claimed by the initiating browser using a separate secret cookie. Approval alone does not give the approver the new device's session.
- Pairing expires after ten minutes. Revoking the approving device invalidates its outstanding challenges.
- Recovery codes are generated only when requested in Settings. Codes are single-use: successful recovery atomically replaces the code and issues a new independent session. Existing devices can be revoked in Settings.
- Authenticated mutations serialize against the player record and revalidate the session inside the transaction. Other players cannot supply an ownership ID to change these records.
- Weekly saves use immutable mutation IDs, payload hashes, and base revisions. Replaying an acknowledged request returns its original revision; a conflicting edit returns the current server snapshot for review. Browser caches are separated by player, and authenticated requests assert the expected player to prevent a stale tab from uploading into a newly connected profile.
- Group codes grant admission, while generated player friend codes identify players. Membership changes serialize against the group record to enforce capacity and atomically delete empty groups. Shared reads hold group locks through membership checks and data reads; another player's week or history is available only while a current shared group permits it. Group membership never grants editing rights.
- Mutations require a same-origin request; body-bearing endpoints accept bounded JSON with strict validation. API responses are not cacheable. Session tokens and recovery codes are never saved to browser local storage or logged by the application.

The `turnip_private` database schema is outside Supabase's default exposed schemas. All application tables enable row-level security without public policies. Keep this schema out of the Supabase Data API. The backend expects a trusted database role that owns these tables, or a role with both explicit schema/table privileges and BYPASSRLS. Browsers never receive database credentials or a Supabase service key.

## Hosted connection checkpoint

The local Worker → Hyperdrive development binding → PostgreSQL path can be verified here. A deployed Worker → Hyperdrive → **Supabase** connection still requires real service configuration; the all-zero Hyperdrive ID in `wrangler.jsonc` is a local placeholder, not a provisioned resource.

To complete that checkpoint:

1. Choose the Supabase project and apply migrations through a direct PostgreSQL connection with the trusted backend role.
2. Create a Cloudflare Hyperdrive configuration for Supabase's **direct PostgreSQL endpoint**. Disable query caching for this application; authentication, revocation, and membership checks require current data.
3. Replace the placeholder Hyperdrive ID in `wrangler.jsonc` with that configuration's ID. Keep production credentials in Cloudflare/Supabase configuration.
4. Run the checks, build, and deployment dry run. When ready to publish, deploy the built Worker with Wrangler and check `/api/health`, silent bootstrap, weekly saves, groups and membership revocation, pairing, recovery, and device revocation over HTTPS.

The code does not provision paid services or publish a production deployment. Real Android/iOS installation and offline verification belong to the PWA milestone.

References: [Cloudflare React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [Drizzle and pg through Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/), [Supabase direct connection](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

The prediction engine is adapted from [Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices), pinned to `c7b7ab3614faf61686da3c535cf204ef568d4cdb`. Its Apache 2.0 license, NOTICE, and copyright attribution are distributed with the app. The [engine audit](src/prediction/UPSTREAM_AUDIT.md) records reproduced small-spike fixes, input conventions, and remaining approximation limits. Compatibility with the current game version is not yet independently verified.
