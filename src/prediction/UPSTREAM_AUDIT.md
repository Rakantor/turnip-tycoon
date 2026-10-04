# Prediction engine audit

Audited on 2026-10-04. This is a real local forecasting engine, with the
limitations below; it is not a verified reimplementation of the current game.

## Provenance and packaging

Source: [Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices).
The fetched upstream HEAD was
[`c7b7ab3614faf61686da3c535cf204ef568d4cdb`](https://github.com/mikebryant/ac-nh-turnip-prices/tree/c7b7ab3614faf61686da3c535cf204ef568d4cdb),
dated 2021-11-19. The original `js/predictions.js` SHA-256 is
`431d25c7f84620f9b13bd3fcb938d8bfe51c1e89225f157ea174476d292bc7a2`.

`vendor/predictions.js` retains the upstream JavaScript for straightforward
comparison. Changes are the module export, removal of diagnostic logging,
normalized line endings, a modification notice, and the small-spike range fixes
described below. The probability calculations and pattern-generation rules are
unchanged. `vendor/predictions.d.ts` provides the typed boundary and `index.ts`
validates/adapts inputs and sums outcome probabilities by pattern. No React,
storage, network, or other runtime dependency is used.

The small-spike range fix also keeps inferred ranges ordered when upstream's
tolerance accepts a center slightly outside its physical limits. In that case,
the inferred shoulder bounds use the same clamped model center already used in
upstream's probability calculation; the displayed observed center stays intact.
An additional failing regression was reproduced before applying this adjustment.

The Apache 2.0 LICENSE, NOTICE, and COPYRIGHT files are copied verbatim under
`public/licenses/turnip-prophet/` and distributed as website assets. Their SHA-256
checksums are respectively:

- `1eb85fc97224598dad1852b5d6483bbcf0aa8608790dcc657a5a2a761ae9c8c6`
- `5eda8744bc5609ac55c8bd04484cac935c2ef5a1c427c149e765d5e392da0b07`
- `a5779d3d2c70d1dfa222b2445a5415b99e0d1a04052493f3c55acb7d25debede`

## Inputs and output

- `purchasePrice` is the own-island Sunday price (90–110), or `null` when unknown.
- `prices` contains exactly twelve positive integer observations or `null`,
  ordered Monday AM through Saturday PM. Observations are never changed.
- `firstBuy: true` selects upstream's first island purchase model: small spike
  with an unknown hidden base searched across 90–110. The displayed purchase
  price does not determine that hidden base, matching upstream.
- `firstBuy: null` uses the same general four-pattern model as upstream's
  unchecked first-buy control. This is an explicit modeling convention, not a
  calculated Bayesian mixture of first-buy and established-island models. Set
  the option to Yes if the first-island-purchase rule applies.
- `previousPattern: null` uses upstream's stationary prior. A known value uses
  its transition-matrix row. The caller must only supply the immediately prior
  week's justified pattern; the engine neither stores nor guesses prior weeks.
- No price observations at all returns `needs-input`. An own-island purchase
  price alone permits ranges; an unknown purchase price plus selling prices also
  permits ranges. No finite positive-probability outcomes returns `inconsistent`.
- `possible` includes twelve ranges and normalized per-pattern probabilities.
  Other statuses contain empty arrays. The probabilities are model estimates.
- Upstream retries failed inputs with numerical tolerances from 1 to 5 bells.
  The adapter exposes `tolerance`; the UI should disclose a nonzero value.
  Neither the adapter nor upstream replaces the saved observations.

The first-buy meaning follows
[upstream English input wording](https://github.com/mikebryant/ac-nh-turnip-prices/blob/c7b7ab3614faf61686da3c535cf204ef568d4cdb/locales/en.json):
the first purchase by a resident from Daisy Mae on this island. Opening this app
for the first time, or returning after a break, does not establish that condition.

## Reproduced issues and verified changes

The two range regression tests were added and run **before** changes. The original
engine failed both: it returned center minimum 138 instead of 139, and an earlier
shoulder maximum 215 instead of 152. Those tests pass after the changes.

The independent check is the small-spike formula in
[Ninji's price-generation code](https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b):
one common peak rate is chosen in 1.4–2.0; the center rounds that rate times base;
each shoulder rounds a rate at most equal to the peak, then subtracts one bell.
Thus a center is above each shoulder, and a known center bounds both shoulders.

| Lead                                                                       | Reproduction and disposition                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #369](https://github.com/mikebryant/ac-nh-turnip-prices/pull/369)      | Open at audit time. Its proposed extra bell at the center agrees with the independent formula. Our range correction includes that bound and also respects a known right shoulder. No blanket application of an unverified patch.                                                                                        |
| [Issue #376](https://github.com/mikebryant/ac-nh-turnip-prices/issues/376) | Base 99, previous small spike, Monday 65/110 reproduces the wrong Wednesday AM minimum. Center now correctly ranges 139–198.                                                                                                                                                                                            |
| [Issue #367](https://github.com/mikebryant/ac-nh-turnip-prices/issues/367) | Base 108, previous large spike, 66/62/58/53/103/147, followed by missing Thursday AM and known Thursday PM 153: both shoulders now range 151–152. General backward propagation through decreasing phases remains incomplete and ranges can be conservative.                                                             |
| [Issue #600](https://github.com/mikebryant/ac-nh-turnip-prices/issues/600) | Its published 105 and 91/86/83/79/74/70/67/103/162 fixture is inconsistent with first-buy Yes, but gives a 100% large-spike result with first-buy No and zero tolerance. This reproduces an input-model mismatch, not evidence of a newly changed game formula. The report's other browser behavior was not reproduced. |
| [Issue #616](https://github.com/mikebryant/ac-nh-turnip-prices/issues/616) | A report of an entered price reverting to the previous week's value, not evidence of a calculation defect. This module has no storage and a repeat-call isolation test passes. App persistence and rollover need their own tests.                                                                                       |

No reported issue is assumed to explain every future inconsistency. Inputs may
also combine different islands or weeks, contain typos, or cross a game reset.

## Validation and remaining uncertainty

`tests/prediction/prediction.test.ts` contains independent, manually specified
valid rate sequences for all four patterns, sparse observations of each,
stationary and known-prior probabilities, pinned upstream mixed-outcome parity,
unknown purchase price, first buying, rounding thresholds, contradiction and
mutation checks, tolerance disclosure, and the issue fixtures above. Run with:

```sh
pnpm exec vitest run tests/prediction/prediction.test.ts
```

These fixtures check the established reverse-engineered rules; they are not
recordings collected from the current game binary. Upstream approximates rate
probability densities with discrete bins, uses JavaScript numbers rather than
the game's float behavior, and includes a small numerical-tolerance fallback.
Our range fixes do not establish exact probability calibration or resolve every
possible range-propagation issue.

[Nintendo's current update history](https://en-americas-support.nintendo.com/app/answers/detail/a_id/49112)
lists version 3.0.3 (2026-04-29) at audit time, substantially newer than the pinned
engine. Its published notes do not establish the turnip generation algorithm.
**Compatibility with the current game is unverified.** A release claiming that
compatibility needs independently captured sequences from that version or a
fresh rule audit. Do not infer compatibility merely from absent patch notes or
successful legacy fixtures.
