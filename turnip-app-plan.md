# Turnip Tycoon — Implementation Plan

Updated: 4 October 2026  
Status: Weekly-table calculation, silent access, weekly storage/sync, history, and friend groups are implemented. The interface uses the Island Ledger design chosen from a three-direction exploration: a sand-and-cream look drawn from the raccoon mascot, the mascot's weekly advice, a week board with forecast-range placeholders, a half-day bar chart with anchored tooltips, and Right now / Full week friend comparisons. GitHub Pages builds now include project-scoped service-worker caching, offline reopening, Settings installation controls, and user-controlled updates that preserve local writes. These PWA changes have not been deployed. Physical Android/iOS installation, recovery, and offline-use verification remain release checks.

App name: Turnip Tycoon.

## 1. Purpose

Build a free Animal Crossing: New Horizons turnip calculator that helps friends decide where and when to sell their turnips.

The app takes inspiration from Turnip Prophet and Turnip-Calculator, with the Island Ledger visual direction built around the raccoon mascot. Its primary task is entering weekly prices and calculating forecasts. It opens directly to that task, with a weekly table and no landing page or signup flow. Retained history and sharing across groups of friends support the calculator.

The first release will be a responsive website and installable progressive web app (PWA) for Android and iOS. It will use Cloudflare Workers and Supabase PostgreSQL. Growth should be driven by actual resource usage rather than an authentication provider's monthly active user charges.

This document consolidates the final decisions from planning. The implementation details below are practical defaults within that scope; they do not introduce additional product requirements.

## 2. Agreed product rules

| Area | Decision |
|---|---|
| Player model | One player represents one island. No separate island entity or table. |
| Editing | Players can contribute and edit only their own prices. |
| Groups | A player can create and join multiple groups, with no product limit on the number of groups. |
| Group size | At most eight players per group initially. Keep the limit configurable for future expansion. |
| Group roles | No owner, administrator, moderator, or co-editor roles. |
| Joining | A shared group code grants admission while the group has capacity. |
| Sharing | Each group has a Share button for sharing its code through messengers or copying it. |
| Invitations | No Invite Users button, recipient selection, invitation records, or approval workflow. |
| Leaving | Leaving removes the player's prices and history from that group's available data. |
| Deletion | Users cannot manually delete a group. Delete an empty group automatically when its last member leaves. |
| History | Retain previous weeks. Historical prices are read-only in the interface. |
| Refresh | Pull on opening and through a manual Refresh button with a 60-second cooldown. |
| Cooldown | Store a timestamp in IndexedDB and enforce the cooldown only in the interface. |
| Uploads | Upload a player's edits immediately when online, independently of the pull cooldown. |
| Time | Use the current device's local calendar and clock. Do not save or share a player time zone. |
| Price records | Store the week, day, AM/PM slot, and price. No exact observation or edit timestamp is required. |
| Entry screen | Open directly to the current week's Sunday price and twelve AM/PM inputs: day tickets on desktop and design A's full-week grid on tablets and phones, within the Island Ledger interface. |
| Access | Silently create/reuse a player and device session. No email, password, social signup, or login screen before price entry. |
| Friend code | Generate a unique, immutable app friend code for each player. Nintendo friend codes are not part of the app. |
| Display name | Initially the generated friend code; optionally change the name in Settings. |
| Recovery | Create a recovery code only when requested in Settings. Pairing and recovery are optional access tools. |
| Encryption | No end-to-end encryption requirement. Normal HTTPS and access control still apply. |

## 3. Player identity and access

### Starting and returning

A new visitor sees the weekly price table immediately and can begin entering prices. Behind the scenes, the app reuses a valid session or creates a stable player ID and independent device session. A failed network/database request must not be mistaken for a missing session. Prices entered before bootstrap finishes are retained locally and attached to the resolved identity.

The backend generates a unique, immutable app friend code, such as `ABCD-EFGH-JKLM`. This becomes the initial display name. The player can set a custom name in Settings at any time, without changing the code. The app neither requests nor stores new Nintendo friend codes. Existing custom names and other profile/history data are preserved by the migration; legacy island names may remain in storage but are not requested by the current Settings screen.

The generated friend code is public identity information, not an authentication credential or group admission code. Friend codes, temporary device-connection codes, recovery codes, and group admission codes serve separate purposes.

Provide clear Settings entry points for changing the name, connecting to an existing player from another device, creating a recovery code, and recovering access with a saved code. None of these interrupt first price entry.

Every paired device accesses the same player, prices, history, and group memberships. A browser that already received a new identity can explicitly connect to an existing one. Switching identities does not merge prices or delete the former identity's records; browser caches stay separated by player.

### Pairing devices

Use a temporary, single-use pairing challenge displayed as a QR code or manually entered code. An already connected device approves the new device.

Each device receives its own revocable session. Pairing must not give every device a copy of one permanent shared session secret.

Device pairing and joining a group are separate operations:

- Pairing grants access to the player's own identity and editing rights.
- A group code grants shared visibility, without permission to edit other players' prices.

### Recovery

Do not generate or present a recovery code during silent player creation. Let the player request a securely generated recovery code later in Settings, and make it easy to save outside the app. Existing players who already have a recovery code keep it until they explicitly replace or use it.

Using the recovery code restores the same player and replaces the used recovery code. Provide device management so access from an old device can be revoked.

If every connected device and the recovery code are lost, there is no email or social identity available to restore access. Explain this briefly when presenting the code.

### Backend responsibilities

Use standard secure random tokens and hashed secret storage. Local development uses secure session cookies; GitHub Pages uses bearer sessions persisted encrypted in IndexedDB. Credential expiry metadata is allowed where needed; the decision to omit timestamps concerns price observations, not session or pairing mechanics.

Authenticated browser requests include an expected-player assertion as well as the device session credential. The server rejects a mismatch so an older tab cannot upload one player's pending prices into a different identity after pairing or recovery changes the active session. The assertion is a consistency check, never an authorization credential.

The backend must verify:

- The device session is valid.
- An edit belongs to the authenticated player.
- A read of another player's data is permitted by a current shared group.
- A join does not exceed the eight-member limit.

Do not use Supabase Auth, including its anonymous-user feature, for these player identities. Store them as ordinary application records in PostgreSQL.

## 4. Groups and shared visibility

Group APIs and the Friends screen are implemented. A friends postcard on the opening calculator names the best price shared for the current half-day, and the Friends screen provides group creation, joining, sharing, leaving, selected-group comparisons, and All friends. Membership is optional and never blocks price entry. Friends are the players visible through shared groups; a separate individual friend-request system is outside this model.

Creating a group creates its first membership and generates its share code. The creator has exactly the same capabilities as every other member.

Any current member can share the code. A player can join by entering the code or opening a shared link containing it and explicitly choosing Join. The code remains valid while the group exists; no separate expiring invitation system is needed. New groups have a name of up to 60 characters and a generated twelve-character code displayed as `XXXX-XXXX-XXXX`.

Joining the same group twice must not create duplicate membership. Joining a full group should show a clear message.

### Leaving and empty groups

When a player leaves:

1. Remove their membership.
2. Their data is no longer included in that group's server responses.
3. Preserve their own prices and history, including access through other groups.
4. If no memberships remain, delete the group; its code becomes invalid.

Other members' already downloaded views reflect the departure on their next refresh. No push update is implied by this design.

Membership changes and empty-group cleanup run transactionally under a group lock, so simultaneous joins and departures cannot leave inconsistent groups. Capacity is enforced in the database transaction, not just in the interface. The initial limit is the configurable `GROUP_CAPACITY = 8` constant in `src/server/groups.ts`.

Every group detail, shared week, and shared history request checks current membership. Shared reads hold group locks through the check and data read. A player who leaves loses access unless another group still connects the same players; the server does not rely on a previously downloaded member list as authorization. Shared week and history screens are read-only.

### No copied group price records

Groups expose the records belonging to their current members. Prices and history are stored once per player, not copied into each group.

A player appearing in several groups therefore has one canonical set of records. The All friends comparison and refresh response deduplicate players across all current groups.

## 5. Calendar, price slots, and history

### Local time only

The frontend always uses the device's current local date and time to determine:

- The current Sunday-start calendar week.
- The selected day and AM/PM period.
- Which weekly record the interface allows the player to edit.

There is no saved time-zone setting, shared time zone, manual in-game clock, or dedicated time-travel feature in the first release.

Paired devices use their own local clocks. Do not add cross-time-zone reconciliation to the first version.

### Weekly records

A weekly record belongs to a player and is identified by a calendar week-start date, such as 2026-10-04. Store this as a date, not a UTC midnight timestamp.

Each week contains:

- The player's own island's Sunday purchase price, if known.
- Up to twelve selling prices: Monday through Saturday, AM and PM.
- The prediction inputs needed for first-time buying and the previous pattern.

Missing entries remain unknown; do not interpret a missing price as zero.

The Sunday input used for prediction is the purchase price on that player's own island. Do not substitute the amount they happened to pay on a friend's island.

An individual selling-price entry is identified by player, week, day, and AM/PM period. Exact entry, observation, and update timestamps are unnecessary.

### Historical weeks

The interface permits editing only the current week, including filling earlier slots within that week. Previous weeks are read-only.

This is an interface rule only. The backend does not reject an otherwise authorised price edit because its week has passed. An offline edit queued while a week was current can finish uploading after rollover.

Starting a new week must preserve all earlier records. Leaving a group must not delete the player's history.

Load history when requested rather than downloading every past week on each refresh. Current members may view each other's history through shared groups.

Store observations and prediction inputs. Historical predictions can be recalculated with the installed engine version; exact snapshots of what a forecast looked like at an earlier moment are outside the first release.

## 6. Refresh and upload behaviour

### Pulling shared data

The calculator loads its own week on opening, and the friends panel loads current shared prices. Group screens reuse that response. Own and shared history load on demand.

On opening the app, refresh shared current-week data and validate current membership. Preserve the manual refresh cooldown across reloads and immediate reopening by reading the stored IndexedDB timestamp. A cold load and a successful create, join, or leave can fetch current membership immediately; the cooldown governs the manual Refresh control.

After a refresh, the manual Refresh button becomes available after 60 seconds. Each subsequent manual refresh restarts that cooldown. Keep the button disabled while a refresh is in progress.

Use a simple local timestamp to calculate availability. There is:

- No server-side cooldown enforcement.
- No periodic polling.
- No WebSocket connection or push subscription.
- No automatic group refetch merely because a tab regains focus.
- No global cooldown synchronised between devices.

The refresh updates memberships and the relevant current-week prices, with players deduplicated across several groups. Each profile keeps the latest current-week response in IndexedDB, including group codes, so friends' prices open instantly and stay readable offline; the opening refresh replaces it. A new week starts empty until its first refresh. A failed access check (401/403) or a rejected device session deletes the saved copy and clears the shared view; leaving a group removes it locally straight away.

Do not show when friends' prices were last refreshed. While loading for the first time, draw the cards with placeholders instead of loading text.

### Uploading edits

When a player commits a price edit:

1. Save it locally.
2. Update their own displayed prices and predictions.
3. Upload it immediately if online.
4. Mark it synced only after backend confirmation.

The pull cooldown must never block an upload. A successful upload does not require refetching all friends' data.

Friends see the new value the next time they refresh. The app does not promise that a friend's screen updates immediately after an upload.

### Offline use and retry behaviour

IndexedDB stores cached own records and pending changes. After an online visit completes silent profile setup and Settings reports that offline access is ready, the cached Pages app and prediction engine can reopen and work offline. First-time profile creation and refreshing friends’ prices still require a connection; the latest current-week copy of friends’ prices stays readable offline.

Current implementation: production Pages builds generate a service worker scoped to `/turnip-tycoon/`. It precaches the static app, icons, manifest, and licenses, with no runtime API caching. IndexedDB retains own records, credentials, pending uploads, revision conflicts, and the latest friends' prices independently of the app cache. Local development does not install a service worker; use the Pages preview in [CONTRIBUTING.md](CONTRIBUTING.md) to exercise offline reopening.

Settings exposes installation, offline readiness, setup retry, and update checks. Updates wait for an explicit Update now action on a safe screen. Valid local writes flush before reloading; invalid drafts and an unrestorable profile block the reload. Pending uploads can remain queued, and other open tabs are never force-reloaded. Installation remains optional and introduces no startup prompt.

When connectivity returns, retry pending uploads while the app is running. Also resume pending uploads when the app is opened. Do not depend on mobile background execution while the app is closed.

Use idempotent mutation identifiers and ordered updates so retrying an upload does not duplicate data or overwrite a newer local edit with an older queued value.

A refresh must not silently discard pending local edits. If two paired devices change the same entry, retain the pending value and surface the conflict rather than silently losing it. An opaque revision number can support this without introducing price timestamps.

Clear errors and a Waiting to sync state should distinguish local edits from confirmed server data.

## 7. Main screens

The structure retains **A: Weekly table** inside the **Island Ledger** visual direction (design B), chosen from a three-direction exploration. A dotted sand background, cream cards with chunky borders and offset shadows, leaf-green actions, gold highlights, and the Fredoka and Nunito typefaces draw on the raccoon mascot. Desktop uses pill navigation; phones use a full-width bottom tab bar for Prices, Friends, and History, with Settings in the header beside an Install shortcut that disappears once the app is installed.

The root route is the current week. The mascot opens it with plain-language advice in a speech bubble, followed by a separate Sunday purchase input and six days of AM and PM fields: a row of day tickets on desktop, and a compact full-week grid beside the forecast on tablets and above it on phones, so the whole week is visible at a glance on a phone. Empty fields show their forecast range as a placeholder. Price fields accept digits only and reject keystrokes that can no longer reach the allowed range: 90–110 bells for the Sunday purchase price and 9–660 bells for selling prices, inclusive; a shorter out-of-range entry is flagged and not saved. The API and database keep their existing checks. Prediction inputs sit in a collapsible Week settings panel that summarises the current values, access management stays in Settings, and a friends postcard supports the calculator without interrupting price entry.

| Screen | Purpose |
|---|---|
| My Prices | Mascot advice, Sunday purchase price, twelve weekly selling slots with forecast-range placeholders, collapsible prediction inputs, pattern probabilities, and an interactive chart. A friends postcard names the best price shared for the current half-day and links to Friends. |
| Friends | Create or join groups; compare players Right now (a best-price card and per-player mini week graphs for a selected period) or for the Full week (a weekly table of Sunday buy prices, reported sales, and predictions); refresh, share codes/links, and leave. |
| All friends | Compare all distinct players available through current memberships in the same Right now and Full week views. |
| Member week and history | Read another member's full weekly inputs, forecasts, and paginated history while a current shared group permits access. |
| History | Browse previous weeks and charts in read-only form. |
| Settings | Editable display name, read-only generated friend code, paired devices, optional recovery, and attribution. Export remains planned. |

### Exploring the forecast

The chart shows each half-day as a column: reported prices as dots, unentered half-days as min–max bars, and a dashed line at the purchase price. Every column is labelled AM or PM beneath its day name. Clicking or tapping anywhere in a column opens a tooltip anchored above that half-day with its potential minimum and maximum in bells per turnip, or the reported price, and the change against the purchase price. The selected half-day is marked on the chart. The tooltip lets taps pass through to other columns, may cover the card heading, and stays within the card. Keyboard users reach the chart as one tab stop, move with the arrow keys, jump with Home or End, and dismiss the tooltip with Escape. Own weeks, history, and shared member weeks use the same chart component. The separate Forecast ranges table was removed; ranges appear in the chart and in empty price fields.

The mascot's advice restates only what the forecast supports: the most likely pattern and the highest price still possible in the remaining half-days. When several half-days share that peak, it names the window instead of a single half-day and marks no best day. It recommends selling only when the current reported price meets or beats every remaining possibility. A single best day, when one exists, is marked on the week board and the chart. The current day is marked Today, including Sunday.

### Comparing selling opportunities

Distinguish observed prices from predictions. A possible future peak must not be presented as an already available sale price.

Display the day and AM/PM slot explicitly. With no shared time zone or observation timestamp, the app cannot establish whether another player's shop currently offers a displayed value. Use wording such as Best reported price for the selected period, rather than claiming universal live availability.

The Friends screen shows one row per member, including their name, Sunday buy price, and Monday–Saturday AM/PM cells. Reported values appear in solid green cells. Missing selling observations show possible min–max ranges in dashed gold cells when a forecast exists; they do not become reported prices. Missing Sunday prices are never inferred. Empty or inconsistent weeks leave unavailable cells as “—” and show a forecast status while preserving entered values.

Right now is the default view. It compares one selected period, initially the current half-day. A best-price card names the highest reported selling price, or the lowest Sunday buy price, with that player's most likely pattern and a link to their week. Every other player follows with their reported value for the period and a twelve-column mini graph on a shared scale, in which reported prices are solid bars and forecast ranges are floating bars. Full week shows the weekly table: at narrow widths, only the price columns scroll horizontally; names and all four selling-pattern probabilities stay in place, the probabilities use a 2×2 grid on mobile, and the current half-day's column is highlighted. Right now's period selection replaces the former By day view. The calculator's friends postcard names the best price shared by another player for the current half-day, or says that none is shared yet. Unknown reported prices remain unknown; do not promote an old high price to the current slot.

The weekly structure and the Island Ledger visual direction are agreed. The app name and specific chart/component libraries remain implementation choices. Prioritise readable mobile inputs, accessible controls, and clear forecasts; avoid adding a community landing experience.

## 8. Technology stack

| Layer | Choice |
|---|---|
| Language | TypeScript across frontend, backend, shared types, and prediction module. |
| Frontend | React with Vite. |
| Navigation | React Router used as a routing library. |
| App delivery | GitHub Pages PWA with a manifest, regular/maskable install icons, scoped static precaching, and user-controlled updates. |
| Typefaces | Fredoka and Nunito variable fonts, self-hosted Latin subsets from Fontsource, precached for offline use. |
| Local data | IndexedDB through Dexie. |
| API | Hono running on Cloudflare Workers. |
| Database | Supabase-hosted PostgreSQL. |
| Database queries | Drizzle ORM with the pg driver. |
| Connection pooling | Cloudflare Hyperdrive. |
| Access | Application-owned device sessions, pairing, and recovery. |
| Prediction execution | In the browser, independent of React. |
| Tests | Vitest for calculations and backend behaviour; Playwright for browser flows. |
| Deployment tooling | Cloudflare Vite plugin and Wrangler. |

Serve the frontend on GitHub Pages and the API on Cloudflare Workers. Production uses persisted bearer device sessions and an exact frontend-origin allowlist; local development retains same-origin cookies. Keep database credentials in backend configuration, never in the browser.

Cloudflare documents the [React + Vite deployment model](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) and [Drizzle with pg through Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/). Connect Hyperdrive to the [Supabase direct PostgreSQL endpoint](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/).

Disable Hyperdrive query caching for authentication, membership checks, and mutable current-week data. Pooling remains useful without query-result caching. See [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

### Architecture

```text
React PWA
  ├─ Prediction engine
  ├─ Dexie / IndexedDB
  │    ├─ Downloaded records
  │    ├─ Friends' current-week prices
  │    ├─ Pending edits
  │    └─ Local refresh timestamp
  └─ HTTPS requests
       └─ Hono API on Cloudflare Workers
            └─ Drizzle + pg
                 └─ Hyperdrive
                      └─ Supabase PostgreSQL
```

Next.js, Durable Objects, Supabase Realtime, and a hosted authentication service are not part of this stack.

### Why this setup

The app is primarily an interactive calculator with browser-local state and a small API. React + Vite fits that model without requiring server rendering.

A PWA provides web access and installation on Android and iOS from one codebase. Installation and background capabilities vary by browser, so verify the intended experience on real phones.

Capacitor remains an option for later native packaging and store distribution. It is not part of the first release.

## 9. Proposed data model

These are logical records; table and field names can be refined during implementation.

| Record | Main contents |
|---|---|
| players | Stable ID, display name, immutable unique generated friend code; optional legacy island name. |
| devices / sessions | Player association and revocable device access. |
| recovery credentials | Optional player association and verifier, created only when the player requests a code. |
| pairing challenges | Temporary single-use device-pairing state. |
| groups | Stable ID and unique share code; an optional display name if useful. |
| memberships | Group ID and player ID, unique together. No role field. |
| weeks | Player ID, week-start date, Sunday purchase price, first-buy and previous-pattern inputs. |
| price entries | Weekly record, day, AM/PM slot, and price. |
| mutation metadata | Only what is necessary for idempotent retries and revision checks. |

Required relationships and constraints:

- One weekly record per player and week-start date.
- One unique, non-null app friend code per player; it cannot be changed through the profile API.
- One observed price per weekly record and selling slot.
- One membership per player and group.
- Price and weekly records belong directly to players.
- No island table.
- No invitation table or group administration records.
- No stored player time zone.
- No exact timestamp required on a price entry.
- Deleting an empty group must not cascade into player price/history deletion.

Index memberships in both directions: groups for a player, and players in a group. Index weekly records by player and date. Keep history queries paginated.

The eight-member limit belongs in configurable application policy with transactional enforcement. Increasing it later should not require changing the ownership model.

## 10. Prediction engine and upstream audit

Use the calculation logic from [Turnip Prophet's repository](https://github.com/mikebryant/ac-nh-turnip-prices) as the starting point.

Extract it into an independently testable module. The module should accept weekly observations and prediction inputs and return possible patterns, ranges, and probabilities without depending on React, browser storage, or database access.

Run predictions locally to support offline use and avoid server calculation costs for every edit.

### Audit work

Before treating the inherited engine as production-ready:

1. Pin the upstream revision being used.
2. Review the calculation implementation, open issues, and relevant unmerged fixes.
3. Reproduce reported defects with small input fixtures.
4. Check each proposed fix against the underlying price-generation rules.
5. Add regression tests before applying verified fixes.
6. Document approximation or uncertainty that remains.
7. Verify compatibility with the current game version rather than assuming it.

Known starting points from planning:

- [PR #369](https://github.com/mikebryant/ac-nh-turnip-prices/pull/369): proposed small-spike off-by-one correction.
- [Issue #367](https://github.com/mikebryant/ac-nh-turnip-prices/issues/367): small-spike behaviour and known later prices narrowing possible earlier ranges.
- [Issue #376](https://github.com/mikebryant/ac-nh-turnip-prices/issues/376): reported small-spike range discrepancy.
- [Issue #616](https://github.com/mikebryant/ac-nh-turnip-prices/issues/616): reported values reverting to a previous week's data; relevant to storage and rollover tests.
- [Issue #600](https://github.com/mikebryant/ac-nh-turnip-prices/issues/600): reported missing predictions and possible first-time-buyer input confusion.

The engine is now pinned to upstream revision `c7b7ab3614faf61686da3c535cf204ef568d4cdb`. The [audit record](src/prediction/UPSTREAM_AUDIT.md) documents reproduced small-spike range defects, verified corrections, regression fixtures, input conventions, and uncertainty. Targeted calculation checks pass 33 tests. Some inferred ranges remain conservative, upstream probability approximations remain, and compatibility with the current game version has not been independently verified. A passing legacy-fixture suite does not establish that compatibility.

### Required calculation coverage

Cover all four patterns: fluctuating, large spike, decreasing, and small spike.

Include missing prices, unknown Sunday price, first-time buying, unknown previous pattern, integer and rounding boundaries, contradictory observations, and how later observations constrain a prediction.

Use an independently specified valid-sequence generator or other independent fixtures where practical; avoid tests that merely duplicate the implementation.

First-time buying refers to the relevant first purchase from Daisy Mae on the player's own island, not first use of this app or returning after a long break. Match the upstream meaning and verify it during the audit. See [Turnip Prophet's input wording](https://github.com/mikebryant/ac-nh-turnip-prices/blob/master/locales/en.json).

When initializing a new, unsaved week, default **Last week's pattern** from the same player's immediately preceding week only if `predictWeek` identifies a single possible pattern. Missing, ambiguous, or inconsistent preceding-week results leave the field Unknown; never carry forward an older week's pattern. Preserve existing saved choices, including Unknown, and allow manual changes. Cached preceding-week data can supply the default offline. Fresh server data takes priority over an unchanged cache; pending local edits to the preceding week can update the default during initialization, including to Unknown. Applying this default alone must not create a history entry; the week is recorded only after an actual save.

If no pattern matches the supplied observations, retain the observations and explain that the inputs are inconsistent with the engine. Do not silently change the user's numbers.

### Attribution and licensing

The centered footer follows `turnipcc`: display a linked “Inspired by Turnip Prophet” credit and “A fan project, not affiliated with Nintendo.” An expandable attribution area loads and displays the bundled NOTICE and Apache 2.0 license.

Preserve the applicable [Apache 2.0 license](https://github.com/mikebryant/ac-nh-turnip-prices/blob/master/LICENSE), [NOTICE](https://github.com/mikebryant/ac-nh-turnip-prices/blob/master/NOTICE), and copyright attribution for reused code. Mark modified upstream files as required by the license. The visible inspiration credit does not replace these obligations.

## 11. Cost and scaling approach

Supabase is being used as a PostgreSQL provider, not as the player authentication provider. Our own player records and database connections do not constitute Supabase Auth monthly active users.

Avoid adding Supabase Auth or a direct third-party identity integration later without reassessing the billing model. See [Supabase's MAU definition](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users).

The intended cost controls are:

- Static frontend delivery.
- Prediction calculations on devices.
- Pulls on opening or explicit refresh rather than persistent live connections.
- A simple client-side refresh cooldown.
- One canonical price history per player, regardless of group count.
- Deduplicated current-week reads.
- History loaded on demand.
- Pooled database connections and indexed membership/history queries.

The UI cooldown is a convenience and request-reduction measure, not a server-enforced traffic limit. Do not reintroduce server-side enforcement for this feature.

Workers, database compute, storage, and database egress still cost money. The previously discussed small-plan baseline and request estimates are not a guarantee of the total cost at hundreds of thousands or millions of users.

Measure request counts, database reads/writes, response sizes, and latency during the prototype and load testing. Recheck [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), and [Supabase pricing](https://supabase.com/pricing) before provisioning paid services.

Do not assume moving the API to Cloudflare removes Supabase's database egress charges.

## 12. Implementation stages

### Stage 1: Foundation and access

Implementation checkpoint (4 October 2026): the React/Hono foundation, private PostgreSQL schema and migrations, independent device sessions, approval-based pairing, recovery rotation, and device revocation are implemented. The revised access model silently creates/reuses a player, uses an app-generated immutable friend code as the initial name, and creates recovery credentials only on request. A forward migration preserves existing custom names and history. The 36 API/schema tests cover access isolation, weekly saves, concurrency, idempotency, conflicts, history, identity switching, and migration. Integrated lint, TypeScript, production build, formatting, and deployment dry run pass. Browser flows verify silent creation, recovery and pairing from automatically created profiles, and protection against delayed session responses. See [CONTRIBUTING.md](CONTRIBUTING.md) for local startup, hosted Supabase/Hyperdrive configuration, and the separate Pages/API deployment procedures.

- Set up React, Vite, TypeScript, React Router, and the Hono Worker.
- Add the database schema and migrations.
- Prove the Workers → Hyperdrive → Supabase PostgreSQL connection.
- Implement silent player creation/reuse, generated friend codes, optional Settings recovery, device sessions, pairing, and device revocation.
- Keep local development possible without a production deployment.

Completion check: two devices can access the same player; a different player cannot edit that player's records.

### Stage 2: Calculator and weekly records

Implementation checkpoint: design A's table, forecast chart/ranges, optional prediction inputs, device-local weeks, IndexedDB persistence, revisioned weekly API, upload retries/conflict review, and historical views are implemented. At the calculator checkpoint, the full suite passed 92 tests, including 33 prediction regressions and 23 storage/calendar tests. Desktop and phone-size Chrome checks covered immediate entry, typing during bootstrap, saved values and blank clearing, reloads, offline reconnect, read-only history, conflict resolution, and retained input after browser-storage failures. PWA offline opening is implemented in Stage 4. Independent current-game compatibility verification remains outstanding.

Current chart update: click/tap and keyboard selection expose each half-day's potential minimum and maximum in a tooltip, with reported values shown when available. Targeted lint, strict TypeScript, production build, all 33 prediction tests, and formatting checks pass. Browser checks verify nearest-half-day click selection against exact engine values, arrow keys, Home, End, Escape, touch selection of the first and last periods, and the shared-member chart.

- Extract and audit the prediction engine.
- Implement Sunday and AM/PM price entry.
- Save observations locally and upload them.
- Use device-local calendar dates for weekly records.
- Implement read-only historical views and safe week rollover.

Completion check: predictions work with incomplete inputs, old weeks remain visible, and editing controls follow the current local week.

### Stage 3: Groups and manual sharing

Implementation checkpoint: group creation, joining by code or shared link, sharing, leaving, and last-member cleanup are implemented, with unlimited group memberships and a configurable eight-player capacity. All friends deduplicates players across groups and links to read-only member weeks and paginated history. The comparison table includes Sunday buy prices, reported sales, and predictions for unentered selling slots. Full week is the default at every width; names and probabilities stay fixed while price columns scroll horizontally. Both views use a 2×2 probability grid on mobile. Shared reads require current membership, with access retained only when another shared group still permits it. Manual refresh uses a 60-second IndexedDB cooldown, with no polling or focus refresh; own-price uploads remain immediate. Twelve PostgreSQL integration tests cover permissions, overlap, retained records, capacity races, and final-departure races. At the previous groups checkpoint, the integrated suite passed all 104 tests (48 API/schema, 33 prediction, and 23 browser-storage/calendar), lint, strict TypeScript, production build, formatting, and deployment dry run. The dry run validated packaging without publishing or establishing hosted database connectivity.

At the previous checkpoint, browser verification passed with three independent profiles: all 13 price inputs appeared on a fresh launch; custom names and prices saved; creating and sharing groups worked; shared links prefilled the code but required an explicit Join action. Overlapping groups deduplicated players, the then-current selected-period comparisons retained unknown prices, and member weeks and past history were read-only. Leaving one group preserved other shared access, while the final shared departure revoked access and cleared the shared view/cache without deleting own prices. Desktop and 390-pixel screenshots were reviewed, and layouts had no horizontal overflow down to 320 pixels.

The prior weekly-table checkpoint passed targeted lint, strict TypeScript, production build, all 33 prediction tests, and formatting checks. Browser checks covered five members including a long name, all thirteen price columns, reported values versus predictions, unknown Sunday with a valid forecast, empty weeks, inconsistent inputs retaining reported prices, and group filters. At 390 pixels, By day was then the default and included Sunday plus the selected day's AM/PM prices. Day selection and Full week scrolling worked, with fixed names and no page overflow down to 320 pixels. Desktop and mobile screenshots were reviewed. That rebuilt app passed its 320-pixel smoke check for page width in both views, semantic column groups, names fixed at the far-right scroll position, and tooltips that fit without overlapping the legend.

The Full week default and fixed probability grid pass lint, strict TypeScript, production build, formatting, and browser checks at 320, 390, 820, and 1280 pixels. Names and all four probabilities remain fixed and visible at the start, middle, and end of horizontal scrolling while price columns move. Both mobile views use the 2×2 probability grid, By day and day selection still work, and no page overflow occurs. The 390-pixel screenshot was reviewed; see [CONTRIBUTING.md](CONTRIBUTING.md) for verification details.

Island Ledger checkpoint (4 October 2026): the redesign replaces the Full week default and By day view described above with Right now and Full week, removes the Forecast ranges table, and moves the selected-period comparison from the calculator to Friends. The suite passes 200 tests, including advice regressions for likely spikes, tied peaks, selling now, confident declines, cautious early weeks, completed weeks, and past weeks. Lint, strict TypeScript, production and Pages builds, and formatting pass; the Pages worker precaches the four font files and the 384-pixel mascot. Browser checks at 320, 390, 860, and 1280 pixels cover day tickets and the phone grid with every weekday visible above the tab bar at 390×844, a full-width tab bar, the Sunday Today marker, anchored tooltips by click and keyboard that stay within the card and pass taps through, Right now and Full week with three profiles, shared weeks, Settings, History, empty and past weeks, and no page overflow.

Offline friends checkpoint (5 October 2026): each profile keeps the latest current-week groups response, codes included, in IndexedDB. Friends' prices then open instantly, refresh in the background, and stay readable offline, including a friend's current week. First loads draw the real cards with placeholders that appear after 200 ms, and content fades in only after visible placeholders. The suite passes 211 tests, including saved-copy storage and session forgetting. Lint, strict TypeScript, production and Pages builds, and formatting pass. Browser checks with slowed and failing API calls cover placeholders on Prices, Friends, History, shared weeks, and Settings at 320, 390, 860, and 1280 pixels without overflow; offline Friends with Refresh and Leave disabled; and deletion of the saved copy after a rejected session or a 403, with refilling once access returns. They also cover local removal of a group after leaving it.

- Implement unlimited group creation and joining by code.
- Enforce the configurable eight-member limit.
- Add Share, Leave, and empty-group deletion.
- Add selected-group and combined-group comparisons.
- Implement opening refresh and the IndexedDB-based manual cooldown.
- Load shared history on demand.

Completion check: an edit is stored once, becomes visible to friends on their next refresh, and leaving a group removes access without deleting player data.

### Stage 4: Offline behaviour and PWA

Icon preparation is complete: the supplied raccoon artwork is used for browser and website branding, Apple touch icons, and regular/maskable PWA icons. Optimized Apple App Store/Xcode and Google Play exports are retained outside the public web bundle. The manifest parses without browser errors; icon resources, retina rendering, and layouts at 320, 390, and 1280 pixels have been checked. Pages-only service-worker caching and Settings installation controls are implemented. Real-device installation checks remain below. See [icon assets](assets/branding/README.md).

- [x] Cache the static Pages app for offline reopening after initial online setup, without caching API responses.
- [x] Retain IndexedDB records and the pending-edit queue across reopening and reconnection.
- [x] Add safe, user-controlled updates that flush local writes, block invalid drafts, and leave other tabs open.
- [x] Add Settings installation, offline-readiness, setup-retry, and update-check controls.
- [x] Verify desktop browser offline reopening, reconnecting uploads, invalid-entry update blocking, offline updates, and retained drafts in other tabs; verify the Settings layout at 320 pixels.
- [ ] Complete physical-device checks of retries, conflicts, and retained edits across offline reopening and updates.
- [ ] Verify that late queued uploads complete after week rollover on real devices.
- [ ] Verify installation, recovery, and offline use on Android and iOS.
- [ ] Complete data export and remaining accessibility checks; bundled attribution is already available offline.

Completion check: ordinary offline use does not lose entries, and pending changes remain clearly distinguished from synced data.

### Stage 5: Private beta and operational checks

- Exercise multi-device and multi-group flows with a small test group.
- Test simultaneous joins, leaving the last group member, and retries.
- Verify backup and restore procedures.
- Measure actual usage and estimate costs from observed traffic.
- Complete focused load testing and fix demonstrated bottlenecks.

Completion check: calculation regressions, access controls, sync behaviour, and the main mobile flows pass their checks before a public release.

## 13. Acceptance checklist

- [ ] Web app works on desktop and mobile and installs as a PWA on supported Android/iOS browsers.
- [x] A player needs no email, password, or social login.
- [x] Silent bootstrap assigns a generated app friend code as the initial display name; names can be changed without changing the code.
- [x] Recovery credentials are created only on request; pairing and recovery restore the same player through the API.
- [x] Integrated price-entry, pairing, recovery, and Settings browser flows pass for design A.
- [x] The previous groups checkpoint passed refreshed desktop/mobile layouts and three-profile sharing, comparison, history, and access-revocation browser flows.
- [x] The prior weekly-table checkpoint passed browser verification for chart click/tap and keyboard tooltips, the weekly group table, mobile By day, and full-week scrolling with fixed names.
- [x] That rebuilt app passed its 320-pixel browser smoke check for table scrolling, fixed names, semantic column groups, and tooltips clear of the legend.
- [x] Full week (the default until the Island Ledger redesign) keeps names and probabilities fixed during horizontal price scrolling from 320 to 1280 pixels, without page overflow and with the mobile 2×2 probability grid.
- [x] The Island Ledger checkpoint passes 200 tests, lint, TypeScript checks, production and Pages builds, and formatting. Browser checks at 320, 390, 860, and 1280 pixels cover the week board, the full phone week above the tab bar, anchored chart tooltips with keyboard control, Right now and Full week, shared weeks, Settings, and History.
- [x] Current checkpoint passes 124 tests, lint, TypeScript checks, production build, and formatting. Browser checks verify always-visible forecast and prediction sections on own/shared weeks, read-only past controls, Unknown and inferred new-week defaults without an automatic history entry, saved Unknown after reload, footer attribution, and layouts without overflow at 1280 and 320 pixels. Desktop and 320-pixel screenshots were reviewed.
- [x] One player maps directly to one set of island prices; no island entity exists.
- [x] Players can belong to multiple groups and create any number of groups.
- [x] The ninth member cannot join an eight-member group.
- [x] Groups have no owner, administrator, invite-user workflow, or manual delete action.
- [x] Group codes can be shared and used to join.
- [x] Leaving removes shared access while preserving the player's own history.
- [x] The last departure deletes the empty group and invalidates its code.
- [x] Group overlap never duplicates a player's price records.
- [x] Only the owner can submit changes to their prices.
- [x] Twelve AM/PM selling slots and a separate Sunday purchase input are supported.
- [x] Price records use calendar dates and slots, without exact observation timestamps.
- [x] No player time zone is stored or shared; the frontend uses local device time.
- [x] The interface edits only the current week; the backend applies no historical-week lock.
- [x] Opening validates shared membership; manual Refresh follows the local 60-second cooldown.
- [x] Friends' current-week prices stay readable offline and are deleted when access is lost.
- [x] The cooldown persists in IndexedDB and has no server-side enforcement.
- [x] No polling, WebSockets, Durable Objects, or background group refetch is introduced.
- [x] Edits upload immediately when online, regardless of the pull cooldown.
- [x] Offline retries do not duplicate or silently discard edits.
- [x] Queued edits can upload after rollover.
- [x] Observed prices and forecast possibilities remain clearly distinguished.
- [x] Past weeks remain browsable and are fetched on demand.
- [x] Verified calculation fixes have regression coverage.
- [x] Turnip Prophet attribution, license, and notices are included.
- [ ] Independently verify compatibility with the current game version before claiming it.

## 14. Deferred scope

The following are not required for the first release:

- Dedicated time-travel support or a shared island clock.
- Multiple islands per player or editing someone else's prices.
- Group ownership, roles, moderation tools, or invitation management.
- Real-time push sharing or scheduled polling.
- Server-enforced refresh cooldowns or historical-week editing locks.
- Native app-store releases; consider Capacitor later if useful.
- Push reminders, screenshot/OCR entry, or public island discovery.
- Exact historical forecast snapshots.
- End-to-end encryption or peer-to-peer synchronisation.
- An email, password, or social authentication provider.

The product name, domain, production service configuration, and exact dependency versions remain implementation-time choices. The accepted visual direction is Island Ledger: the weekly table and full-week phone grid with sand, cream, leaf green, gold, chunky rounded cards, and the mascot's advice. Immediate price entry and optional friend groups remain the product model.

## 15. Additional implementation references

- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [React Router modes](https://reactrouter.com/start/modes)
- [Dexie documentation](https://dexie.org/docs/Dexie.js)
- [Vite PWA guide](https://vite-pwa-org.netlify.app/guide/)
- [PWA installation support](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Background Sync support and limitations](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Playwright documentation](https://playwright.dev/docs/intro)
- [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Capacitor, for possible later native packaging](https://capacitorjs.com/docs)
