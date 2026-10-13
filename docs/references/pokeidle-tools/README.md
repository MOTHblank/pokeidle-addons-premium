# PokeIdle Tools — extracted calculator reference

Source: https://pokeidle-tools.vercel.app/
Observed: 2026-10-13 (UTC).
Public application bundle: https://pokeidle-tools.vercel.app/assets/index-CW1XaDka.js
Public stylesheet: /assets/index-DfP7Ay0J.css

This folder records the useful mathematical behavior and numeric configuration of the deployed third-party site. These are **site assumptions, not verified server mechanics**. No Hunt Atlas or Moth Watch runtime behavior is changed. The companion [calculator-data.json](calculator-data.json) preserves constants, defaults, item IDs, and tool availability in machine-readable form.

## Extraction scope

The HTML contains a React mount point; application content and calculator logic live in the JavaScript bundle. Inspection found no application API fetches or external game-data URLs in that bundle (the fetch present belongs to the module-preload helper). The two implemented tools are shiny capture probability and rare drops. Farm efficiency (XP/money/hour), IV comparison, and DPS are advertised but have no implemented calculators. There is no Pokémon database, market-price database, ball catalogue, combat model, or live account integration in the inspected application.

The useful content is summarized here rather than copying React dependencies, visual styling, branding, marketing prose, or the entire minified bundle. Original source files, private backend code and deployment history cannot be recovered from this public payload.

## Shared probability model

Let p be a constant success probability per independent trial and n a nonnegative safe-integer number of trials.

- At least one success: P = 1 - (1 - p)^n.
- No successes: 1 - P.
- Numerically stable implementation: P = -Math.expm1(n * Math.log1p(-p)).
- Boundary handling: p=0 or n=0 gives P=0; otherwise p=1 gives P=1.
- Input p must be finite and in [0,1]; n must be a nonnegative safe integer.

For target probability q, the drop tool computes the minimum trials:

n = ceil(log1p(-q) / log1p(-p)).

Its helper returns 0 for q=0; otherwise 1 for p=1; null for p=0 or q=1; and null if the computed count is not a safe integer. The UI accepts only 0 < q <= 1, so q=0 is a helper boundary rather than a selectable target. A 100% target is unattainable in finite trials when 0 < p < 1.

Expected successes are n*p; this is an expectation, not a guaranteed reward. These formulas require independent trials with constant probability and make no allowance for pity mechanics.

## Shiny capture calculator

Base shiny encounter probability: 1/24,000.

Shiny multiplier = (shiny boost enabled ? 1.5 : 1)
  * (1 + shiny event percent / 100)
  * (Kick shiny boost enabled ? 1.15 : 1).

Effective shiny encounter probability = min(1, base shiny probability * shiny multiplier).

Capture multiplier = (catch boost enabled ? 1.5 : 1)
  * (1 + catch event percent / 100)
  * (Kick catch boost enabled ? 1.15 : 1).

Effective capture percent = min(100, user-entered base capture percent * capture multiplier).

Shiny capture probability per encounter = effective shiny probability * effective capture percent / 100.

Apply the shared accumulated-probability formula to this joint probability and the supplied encounter count. The UI reports effective shiny encounter chance, effective capture chance, joint shiny capture chance, cumulative chance of at least one capture, and chance of no capture.

Defaults: 10,000 encounters, 2.44% base capture chance, every toggle disabled, both event percentages zero. This 2.44% is a form default, not a universal Pokémon capture rate. Base capture percent is required in [0,100]; event percentages must be finite and nonnegative. Numeric text cannot be empty. Boosts multiply; the site does not add their percentages together.

**Missing mechanics:** no ball selection or explicit Ultra Ball/Beast Ball multiplier; no per-species capture data; no attempt frequency, ball budget, multiple throws, ball consumption, shiny-specific capture modifier, or encounter-rate model. Before using this with Hunt Atlas, establish what the entered base capture chance represents so ball or other bonuses are neither omitted nor counted twice. Kick bonus controls are part of this reference, not a request to reintroduce Kick into the controller.

## Rare-drop calculator

| Item | Base probability per kill | Reciprocal |
| --- | ---: | ---: |
| Bronze Boss Token | 0.0005 | 1 / 2,000 |
| Bike fragment | 0.000005 | 1 / 200,000 |
| Key fragment | 0.000005 | 1 / 200,000 |
| Shiny Stone fragment | 0.000005 | 1 / 200,000 |

The Shiny Stone fragment entry additionally declares 10 required fragments. That field is **unused by the calculator**: the probability result is for at least one fragment, not completion of a ten-fragment stone.

| Outland | Required trainer level | Drop multiplier |
| --- | ---: | ---: |
| 1 | 150 | 1 |
| 2 | 500 | 1.25 |
| 3 | 1,000 | 1.5 |
| 4 | 2,000 | 2 |
| 5 | 4,000 | 3 |
| 6 | 8,000 | 4 |
| 7 | 16,000 | 6 |
| 8 | 25,000 | 8 |

Effective drop probability = min(1, base probability * Outland multiplier * loot multiplier * guild multiplier * event multiplier * Kick multiplier).

The UI asks for **multipliers**, not percentages: 1 means no bonus, 2 means twice the rate. UI inputs must be finite and >=1. The internal multiplication helper accepts finite nonnegative multipliers, so its validation is less restrictive than the UI.

Two modes:

1. Target probability: supply a desired percentage and kills/hour; calculate minimum kills, time in hours = minimum kills / kills per hour, and expected units = minimum kills * effective probability.
2. Fixed kill count: calculate probability of at least one item, probability of none, and expected units.

Defaults: Bronze Boss Token, Outland 1, all multipliers 1, target mode, target 90%, and 250 kills/hour. The fixed-count default is the literal malformed string `10000'`, which fails integer validation until edited. The target-mode option label mentions 99% despite the 90% actual initial target; preserve actual values rather than interpreting the label as a rule.

Kills/hour must be finite and positive. Fixed kill count must be a nonnegative safe integer. Outland trainer levels are displayed as information; there is no account-level validation or restriction on selecting a tier. The rate is entered manually and does not account for different kill speed across Outlands.

## Display behavior and useful UI ideas

Probability formatting uses pt-BR percent formatting, a minimum of two decimal places, and a maximum of six when the percentage is below 0.01%, four below 1%, otherwise two. This helps small probabilities remain visible.

Drop reciprocals and counts use pt-BR numbers with at most two decimal places. Estimated time is rounded upward to minutes for less than one hour, hours for less than one day, then days plus rounded-up remaining hours (carrying 24 hours into the next day). These are coarse labels; preserve precise numeric time separately if reused.

The shiny tool includes a cumulative probability bar and distinct per-encounter and cumulative results. Invalid inputs replace output with a validation message. Drop results distinguish expected item count from at-least-one probability and explicitly treat results as estimates.

## Application to premium addons

Useful reference candidates for Hunt Atlas:

- Stable cumulative shiny-capture and rare-drop probability calculations.
- User-selectable confidence targets with required encounters/kills and estimated time.
- Explicit separation of shiny encounters from successful shiny captures.
- Clear distinction between expected drop units and probability of receiving any.
- Small-probability formatting and multipliers expressed with unambiguous units.

Derived extensions (not implemented on the source site): expected drops/hour = kills/hour * effective drop probability; shiny captures/hour = encounters/hour * joint shiny capture probability. These can support Hunt Atlas projections if encounter/kill rates and game probability inputs are reliable. They are not realized income and must not become Moth Watch buying authorization or guaranteed sale value.

Verify all shiny/drop base rates, Outland unlock levels and multipliers, stacking rules and caps against current upstream/wiki/server evidence before changing production mechanics. The reference contains no reward money, XP formulas, item prices or net-profit model. Existing repository mechanics and validated sources remain authoritative.

## Known limitations

- Site claims have not been cross-checked against the game in this extraction.
- No rendered-browser interaction or live gameplay verification was performed.
- A ten-fragment completion probability needs a separate count-distribution model; this site's at-least-one formula does not answer it.
- A higher Outland multiplier alone does not establish the best hunt; kills/hour, eligibility, survival and resource costs matter.
- The bundle URL identifies this deployment; future site deployments may change the extracted behavior.
