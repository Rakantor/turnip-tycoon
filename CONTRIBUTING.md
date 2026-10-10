# Contributing to Turnip Tycoon

Turnip Tycoon uses React and Vite for the calculator, a Hono API on Cloudflare Workers, and PostgreSQL through Drizzle and Hyperdrive. Predictions run in the browser. GitHub Pages serves the frontend separately from the API.

[Local development](#local-development) · [Checks](#checks) · [Architecture](#architecture-and-data-rules) · [Translations](#translations) · [Deployment](#deployment) · [Offline testing](#offline-and-update-verification) · [Assets and licensing](#assets-and-licensing)

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
pnpm check          # lint, catalog sync, strict TypeScript, local build, unit and PostgreSQL integration tests
pnpm format:check
pnpm typegen        # regenerate production Worker binding types
pnpm deploy:check   # bundle the API Worker without publishing
```

Run `pnpm build:pages` as well when changing the frontend or deployment configuration. Set `VITE_API_URL` in `.env.pages.local` first. CI uses an isolated example API origin for build checks and does not connect to the production database.

Tests cover temporary PostgreSQL databases, authentication and ownership, concurrent/idempotent writes, groups, browser storage/sync, PWA generation and updates, and prediction fixtures.

For browser changes, test saves/reloads, trades, groups, pairing, revocation, and recovery in independent profiles; edit the same week on two devices to check merging. Check shared links, Pages with third-party cookies blocked, keyboard/touch chart controls, and the horizontally scrolling price table at 320 pixels.

Use **Conventional Commits with single-line messages**, for example:

```text
feat: add offline forecast access
fix: retain queued prices after reconnecting
docs: clarify local Pages setup
```

Keep each commit focused on a coherent change. Describe the resulting behavior, relevant checks, and any remaining limitations in the pull request.

## Architecture and data rules

| Path               | Responsibility                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `src/client`       | Calculator, forecasts, turnip trades, Friends, history, Settings, and PWA controls           |
| `src/client/data`  | Browser API, identity bootstrap, IndexedDB, sync queue, and merging edits from other devices |
| `src/shared`       | API/week/group contracts, ledger calculations, and device-local calendar helpers             |
| `src/prediction`   | Standalone prediction adapter and audited upstream engine                                    |
| `src/server`       | Hono API, access, weekly records and trades, ledger totals, groups, and shared reads         |
| `src/db/schema.ts` | Drizzle PostgreSQL schema                                                                    |
| `drizzle`          | Versioned SQL migrations and snapshots                                                       |
| `scripts`          | Local database, development server, migrations, and icon generation                          |
| `tests/api`        | API and database integration tests                                                           |
| `tests/client`     | Browser-storage, session, synchronization, merging, ledger, and PWA tests                    |
| `tests/shared`     | Calendar and ledger calculations shared by the client and API                                |
| `tests/prediction` | Prediction fixtures and regression tests                                                     |
| `tests/build`      | Generated service-worker behavior                                                            |
| `public/licenses`  | Distributed upstream licenses and notices                                                    |

Keep launch focused on price entry with silent identity creation and app-generated friend codes. Weeks use the device's local calendar, start Sunday, and retain unknown observations. The interface edits the current and previous weeks; older weeks are read-only, and queued edits must upload after rollover. Infer the previous pattern only from the immediately preceding week when unique; otherwise use Unknown and preserve saved/manual choices. When an edit to the previous week changes the pattern it identifies, offer it to the current week rather than changing a saved choice.

Each player keeps a private turnip ledger. A week holds at most 40 purchases and sales, in bunches of 10: purchases at 90–110 bells each, sales at 9–660 with their half-day, and never more sold than bought. Trades save with their week under the same revision and mutation ID. A save without `trades` keeps the saved list, so app versions from before the ledger cannot erase it. Only the owner's reads include trades; shared weeks, history, and group responses never do, and `GET /api/ledger` returns the owner's weekly totals. A week's result counts unsold turnips as lost; overall profit adds this week's made-so-far to every finished week.

Groups allow eight equal members and unlimited memberships. Store prices once, deduplicate overlapping friends, and delete empty groups without deleting prices. Opening Prices or Friends reads the server at most once a minute, silently, with no refresh button; own uploads, group changes and error retries bypass that limit. Prices also re-reads its week when the app is shown or focused again, within the same limit, so another device's saves appear before anything is typed. Display observations separately from predictions and order all pattern probabilities highest first. Odds of a better price don't wait for the current half-day: until its price is entered (or, among friends, shared), they compare with the latest price and name its half-day, never presenting it as current. An unreported half-day stays open until Nook's Cranny closes at 10 PM.

### Access and security invariants

- Device access uses a 30-day window, renewed at most daily by successful authenticated online use; PostgreSQL stores SHA-256 verifiers. Cookie responses renew Max-Age only when the database expiry advances and the client coordinates credential changes through Web Locks. Offline use does not renew access, and there is no background keepalive. Local development uses HttpOnly, SameSite=Strict cookies. Pages uses bearer credentials encrypted in IndexedDB with a non-extractable AES-GCM key. Encryption does not defend against same-origin JavaScript; the custom domain keeps that origin to this app alone.
- Save credentials and public profile metadata atomically. Reject stale identity responses. Expected-player assertions prevent older tabs from uploading into another identity, but never replace authentication.
- Recovery is opt-in and single-use, atomically rotating the code and issuing a new session. Never persist recovery codes or log credentials. Pairing requires existing-device approval and a separate initiating-browser claim secret; challenges expire after ten minutes and are invalidated when the approving device is revoked.
- Mutations serialize against the player and revalidate the session inside the transaction. Immutable mutation IDs, payload hashes, and base revisions provide retry deduplication and explicit conflicts; retain pending local values for review. Devices combine edits to different entries, trade by trade for trades, against the version they started from; only an entry both devices changed differently asks the player.
- Group changes serialize against the group. Shared reads lock through current-membership validation and data retrieval. Membership never grants editing rights. Each profile keeps only the latest current-week groups response in IndexedDB, codes included, for offline reading; each refresh replaces it, and a 401/403 or a rejected device session deletes it.
- Enforce the exact `FRONTEND_ORIGIN`, validate preflights before opening database connections, require credentials on protected endpoints, and validate bounded JSON bodies. Cookie mutations retain same-origin checks. API responses must remain uncacheable.

The `turnip_private` schema enables RLS without public policies and must stay outside the Supabase Data API. Use a trusted database role that owns the tables, or has explicit privileges plus BYPASSRLS. Never expose database credentials or a Supabase service key to browsers.

## Translations

Interface text goes through [Lingui](https://lingui.dev). Write the English in place: `t` from `@lingui/core/macro` for plain strings, `<Trans>` from `@lingui/react/macro` for text with markup. Each message is a whole sentence; never build one from fragments, possessives, or a lowercased label, because other languages order and inflect words differently. Give placeholders readable names by assigning expressions to locals first, and add a `comment` where the text alone is ambiguous. Pages remount when the language changes, so helpers may call the global `t` when they run, but never at import time. Format numbers, percentages, dates and weekday names with `i18n.number` and `i18n.date`, not `toLocaleString(undefined)`. Weeks still start on Sunday in every language.

Catalogs are `src/client/locales/{locale}.po`. English is the source and ships with the app; other languages load on demand and are precached for offline use. After changing text, run `pnpm i18n:extract`; `pnpm check` fails while catalogs are stale. In development, Settings offers a `pseudo` language that stretches and brackets every extracted message, so text that missed extraction stands out.

Translations are first drafted by machine, following the style guides in `src/client/locales/style/` and the glossary, and committed marked fuzzy, which translation tools show as needing review. `tests/client/translations.test.ts` checks every committed translation: placeholders, tags and plural forms must survive, and Animal Crossing terms must use the game's official names from `src/client/locales/glossary.json`. Settings marks unreviewed languages as machine-translated; German is one.

To add a language, add it to `locales` in `lingui.config.ts` and to `LANGUAGES` and `catalogs` in `src/client/i18n.ts`, give every `game` term in the glossary its official name in that language (with a source), add a style guide, then extract and translate its catalog. Check its fonts: Fredoka and Nunito cover Latin scripts, and Nunito covers Cyrillic, but neither covers Chinese, Japanese or Korean.

The API answers in English. `src/client/data/server-messages.ts` translates each message the server can send, by its exact text, and `tests/client/server-messages.test.ts` keeps it in step with `src/server`. Terms and Privacy are published in English only.

## Deployment

Frontend: `https://turniptycoon.app/`, served by GitHub Pages. API: `https://api.turniptycoon.app`, a Worker custom domain with the `workers.dev` address switched off. Pages uses hash routes and project-relative assets and links.

`wrangler.jsonc` configures the production API, its custom domain, bearer auth, allowed origin, and Hyperdrive. The Hyperdrive ID is public; database credentials stay in Hyperdrive. `wrangler.dev.jsonc` uses local PostgreSQL and cookie auth. Deployment commands explicitly select the production configuration.

### Supabase and Hyperdrive

1. Put the hosted migration connection in the ignored `.env.production` as `DATABASE_URL` (see [.env.production.example](.env.production.example)), then run `pnpm db:migrate:prod`. Only that command reads `.env.production`; `pnpm dev` and `pnpm db:migrate` never do. On an IPv4-only computer, use Supabase's complete **Session pooler** connection string on port **5432**; its username and hostname differ from Direct. Use verified TLS with `sslmode=verify-full` and `sslrootcert` pointing to the downloaded Supabase CA certificate.
2. Connect Hyperdrive to Supabase's **Direct connection** endpoint on port **5432**. Disable query caching so authentication, membership, revocation, and saved-price reads stay current. Hyperdrive handles pooling; the local migration pooler choice does not change this connection.
3. Run `pnpm exec wrangler login`, then `pnpm check` and `pnpm deploy:check`. Publish the API with `pnpm deploy:api`. The `turniptycoon.app` zone must be in the same Cloudflare account; Wrangler creates the `api.turniptycoon.app` DNS record and certificate, and refuses if a CNAME record already holds that name.

### GitHub Actions

1. Set **Settings → Pages → Source** to **GitHub Actions**, and **Custom domain** to `turniptycoon.app` with **Enforce HTTPS**. The workflow needs no `CNAME` file. In Cloudflare DNS, point the apex at GitHub Pages with DNS-only (unproxied) `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, `AAAA` records `2606:50c0:8000::153` through `2606:50c0:8003::153`, and a `www` CNAME to `rakantor.github.io`. GitHub then redirects `www` and the old `rakantor.github.io/turnip-tycoon/` address to the apex. Verify the domain under the account's **Settings → Pages** to block takeovers.
2. Add `VITE_API_URL` (`https://api.turniptycoon.app`) under **Settings → Environments → github-pages → Environment variables**. The build and deploy jobs both select this environment. A repository-level Actions variable also works. Use only the public API origin: no credentials, path, or query string. There is no workflow fallback, and local `.env.pages.local` files do not reach GitHub Actions.
3. A push to `main` runs **Deploy GitHub Pages** automatically. The workflow checks the project, builds `dist/pages`, and publishes that directory. Other branches do not deploy Pages.
4. A push to `main` that changes the API runs **Deploy API Worker** automatically: files under `src/server`, `src/db`, `src/shared` or `src/prediction`, `wrangler.jsonc`, or dependencies. Other pushes leave the Worker as it is; run the workflow by hand to redeploy, for example after a failed run. It needs a scoped `CLOUDFLARE_API_TOKEN` Actions secret, allowed to edit Workers routes on the `turniptycoon.app` zone, and the `CLOUDFLARE_ACCOUNT_ID` repository variable, and uses the `production` environment, which can have deployment protection rules. Migrations stay manual, so run `pnpm db:migrate:prod` before pushing code that needs them.
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

Open **http://localhost:4174/**. With the checked-in local connection settings, this uses the local database, not Supabase. Production's origin allowlist intentionally rejects localhost pages. Rebuild with the production `VITE_API_URL` before publishing.

## Offline and update verification

Production Pages builds, including local Pages preview, generate a worker scoped to the site root. Normal development does not install it. Precache only the static app, icons, manifest, and licenses; scope cache cleanup to the project. API responses, credentials, and friends' data must never enter Cache Storage. Own records, queued edits, and the latest copy of friends' current-week prices stay in IndexedDB.

Offline reopening needs one online visit to complete profile setup and activate the service worker. Cached own weeks, forecasts, and new local edits then work offline; uploads resume when connected with the app open. Friends show this week's prices from the last online visit; refreshing, joining, and leaving need a connection. Closed-app background uploading is not promised.

Installation is optional and uses the browser's own controls, including Safari's **Share → Add to Home Screen**. On phones, an **Install** shortcut beside Settings opens the browser's install prompt while one is offered, and disappears once the app runs installed or Chromium reports an installed copy. The app checks for updates on load, and again when it regains focus or a connection at most hourly. Downloaded updates wait for **Update now** on a safe screen, flush valid local writes, and block on invalid drafts or an unrestorable profile. Pending uploads need not finish first. Only the requesting tab reloads.

Using the local Pages preview:

1. Open online, save a price, and wait for the service worker to activate. Inspect the worker scope and verify Cache Storage contains only static project files.
2. Go offline, close/reopen, edit a price, and reopen again. Confirm forecasts work, the edit remains queued, and Friends still shows this week's shared prices.
3. Reconnect and confirm uploads finish and survive reload. Check conflicts using a second profile/device.
4. Keep two tabs open. Make a visible source change, rebuild with the local API origin, reload one tab to fetch the update, and apply from Prices. Confirm the new version, retained queued edits, and no reload in the other tab. Repeat with an invalid draft and with a downloaded update while offline.
5. On physical Android/iOS devices, test installation, standalone launch, recovery, offline reopening, reconnection, and queued uploads after rollover.

Persistent-profile Chromium checks passed for offline reopening/reconnection, downloaded updates applied offline, invalid-draft protection, preserving another tab's draft, 320-pixel Settings, and manifest/installability checks. Automated private profiles stalled during activation; updates timed out safely. **Physical-device installation and further private-mode update verification remain outstanding.**

## Terms and privacy

The public `/terms` and `/privacy` routes live in `src/client/legal.tsx`. They are available
from the footer, Settings, and the welcome screen. Direct visits do not start profile lookup
or creation, and the welcome dialog must not cover them. Keep both routes usable without an
API connection and in the installed app. These pages describe the hosted service, not every
possible self-hosted configuration.

The pages are written for players: short, plain sections with the privacy summary first. Keep
them that way. Put implementation detail here, not on the pages. They state these operator facts,
confirmed on 2026-10-06:

- The controller is Rakantor, `rakantor.dev@gmail.com`; the operator confirmed the public
  pseudonym is sufficient where they are established.
- Supabase hosts the database in the EU on the **Free plan**: no automatic backups, 1-day logs.
  Cloudflare Workers runs on the **Free plan**: 3-day Workers Logs. `wrangler.jsonc` disables
  per-request invocation logs, so only the app's own error logs (event, error name, and path) are
  kept; re-enabling them would put every request in the logs and change the page. No
  operator-managed backups exist. **Upgrading either plan changes these facts; update "How long we keep it".**
- Support emails are deleted within a month after the request is resolved.
- Transfers: GitHub, Cloudflare, and Google state EU-U.S. Data Privacy Framework certification
  (with standard contractual clauses as well); Supabase relies on standard contractual clauses
  for the United States and Singapore.

### Profile data controls

`src/server/profile-data.ts` implements authenticated `DELETE /api/profile` and
`GET /api/profile/export?section=…&after=…`. Deletion requires the expected player ID and an
explicit confirmation, takes the normal player/session lock, locks groups in ID order, and
deletes the player and any resulting empty groups in one transaction. Foreign-key cascades
remove prices, weeks, trades, memberships, devices, recovery verifiers, approved pairing
challenges, and mutation records. Unapproved pairing challenges have no player association.
Other players and nonempty groups stay. The existing origin checks and no-store headers apply.

Export reads at most 100 records per page, including expired device metadata and all historical
weeks with prices and private trades. It omits secret credentials/verifiers, group invite codes,
and other players' data. The client downloads one versioned JSON file, with this profile's local
weeks, unsent edits, and conflicts separate from server records. Each batch rechecks the session;
the file records its start/end times and is not a database-wide point-in-time snapshot.

`SessionVault` persists deletion intent before sending the request. Profile writes use
`writeForProfile` to check a per-profile block marker inside the IndexedDB transaction, preventing
late responses or other tabs from restoring erased rows, including refresh/cooldown metadata.
Blocked user edits reject persistence so their patches and warnings remain queued until writes
resume or cleanup is confirmed. The marker contains a player ID and removal state, not credentials or game records. A confirmed
deletion clears local profile access, weeks, anonymous drafts, ledger data, and shared snapshots.
Other tabs refresh through the existing identity channel and discard their retained in-memory
edits when observing completed removal. A per-profile cleanup generation survives reset and
reconnection, so suspended tabs discard stale snapshots and patches before restoring access even
if they missed the removal notification. Returning to welcome unblocks anonymous edits in every
tab. Local disconnection preserves other profiles' shared snapshots; confirmed deletion clears
snapshots that contain the deleted player. Other devices clear their saved data,
including unsent edits, when an online access check returns `401 DEVICE_REMOVED`: the presented
credential no longer has a device record, following revocation or profile deletion. An expired
record returns `401 DEVICE_EXPIRED`; missing/invalid credentials return `401 UNAUTHENTICATED`.
Those cases pause uploads and clear friends' cached prices, but preserve the owner's local work
for reconnection to the same profile. Retain expired bearer credentials for later removal checks.
A missing cookie cannot establish removal, and offline devices cannot be erased remotely.
No replacement profile is created automatically.

Renewal only updates still-valid device records with less than 29 days remaining and never rotates
their token, revives expired access, or undoes revocation. Concurrent renewals recheck the threshold
in the UPDATE; only the request that extends expiry sends Set-Cookie. Cookie requests share an
origin-wide Web Lock, while credential-changing requests take it exclusively through receipt of
the response headers. `X-Session-Renewal: 1` opts into renewal under that lock. Cookie clients
without Web Locks retain their issued fixed expiry; bearer clients renew without cookie coordination.
Existing longer sessions keep their expiry until they enter the renewal window.

Known validation, authentication, or identity rejections of the first deletion request cancel its
pending marker and restore the profile; the normal access check then reports expiry or removal. Lost acknowledgements leave uploads paused and preserve access for an
explicit retry; a later rejection cannot establish whether an earlier attempt succeeded. A 401
does not prove deletion: the UI offers local cleanup and a private contact route without claiming
server success. In cookie mode, local cleanup requires acknowledged logout before reporting access
cleared. Logout also acknowledges already removed or expired credentials and clears the cookie.
Provider logs, backups, and contact email are outside these endpoints. Before
restoring any backup, ensure previously erased records cannot become active again.

When changing the pages or the app:

- Keep the data-control wording aligned with shipped behavior, and recheck both pages whenever
  data collection, group sharing, storage, providers, plans, or account controls change. Give
  material changes a visible in-app notice and update the date.
- Keep the contact address monitored for requests the app cannot handle (corrections, objections,
  restrictions, lost access). Never ask for secret tokens by email. Verify control proportionately,
  record each request, and reply within a month. If a requester cannot be identified, follow
  Article 11 rather than assuming ownership.
- Avoid logging credentials, request bodies, or invite codes. Path identifiers can appear in
  request logs, as the page states.
- The stated legal bases are Article 6(1)(b) for the app and support, 6(1)(f) for security logs,
  and 6(1)(c) for rights requests. Neither dismissing the welcome dialog nor reading a page is
  consent to unrelated processing.

Facts that must stay accurate:

| Area                                                                                                 | Repository evidence                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Profile creation waits for a welcome answer, including skipping the name                             | `src/client/data/session-controller.ts`, `src/client/welcome.tsx`                                      |
| Device credentials, code verifiers, memberships, weekly data, trades, sync metadata                  | `src/db/schema.ts`, `src/server/app.ts`, `src/server/http.ts`                                          |
| Invite previews expose group/member names without authentication; joining requires no host approval  | `src/server/groups.ts`                                                                                 |
| Shared members can read prior weeks; own trade records are excluded                                  | `src/server/groups.ts`, `src/server/weeks.ts`, `src/server/ledger.ts`                                  |
| Local profile access, history, unsent edits, the latest current-week group snapshot, language choice | `src/client/data/database.ts`, `session-vault.ts`, `shared-groups.ts`, `sync.ts`, `src/client/i18n.ts` |
| Forecasts run locally; fonts are bundled; no third-party audience analytics are included             | `src/prediction`, `src/client/fonts.css`, `src/client/data/api.ts`, `vite.config.ts`                   |
| Removing a device or clearing browser data does not delete the player/history                        | `src/server/app.ts`, `src/db/schema.ts`                                                                |

Research checked on 2026-10-06: [GDPR text (especially Articles 5, 6, 11–20, 28 and 44–49)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng),
[European Commission: principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en),
[handling rights requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en),
[EU guidance on unfair terms](https://europa.eu/youreurope/citizens/consumers/unfair-treatment/unfair-contract-terms/index_en.htm),
[GitHub Pages IP logging](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection),
[Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/),
[Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/),
[Supabase GDPR and residency guidance](https://supabase.com/docs/guides/security/gdpr-compliance),
[Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum),
[Supabase privacy policy](https://supabase.com/privacy),
[Supabase plan limits](https://supabase.com/pricing),
[Workers Logs retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[Google's transfer frameworks](https://policies.google.com/privacy/frameworks), and
[Google privacy policy](https://policies.google.com/privacy).

## Assets and licensing

Original project materials are licensed under the [Apache License, Version 2.0](LICENSE). Contributions are accepted under the same license. Third-party components retain their respective licenses and notices; see [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md).

The README's images in `assets/readme` are rendered from the app: `screens.webp` shows a demo profile with friends on a 390-pixel phone layout, and `open-button.png` is the app's green button at 2.5× with a transparent background. Retake them when those screens or the button change. The mascot's optimized website assets live in `public/icons`. App Store/Xcode and Google Play exports live in `assets/app-icons`, outside the public web bundle. Run `pnpm icons:generate` to regenerate them from the retained source. See [icon assets and platform requirements](assets/branding/README.md).

The prediction engine is adapted from [Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices), pinned to `c7b7ab3614faf61686da3c535cf204ef568d4cdb`. Preserve its Apache 2.0 license, NOTICE, and copyright attribution in the distributed app. The [engine audit](src/prediction/UPSTREAM_AUDIT.md) documents small-spike fixes, input conventions, and remaining approximation limits; [third-party notices](THIRD_PARTY_NOTICES.md) record attribution. Compatibility with the current game version is not yet independently verified.
