# HuntAtlas v1.9.12 — rare event rate and visual UI audit

Reviewed 2026-10-13. Code: `huntatlas/hunt-atlas.user.js` premium branch. Source inspection and deterministic helper tests only; live game and actual rendered Firefox layouts remain owner-led.

## Problem and solution

The earlier global `formatRate()` rounded every positive value below one to the nearest integer, so a rare expected rate could be shown as **0**. It also used `—` for real zero and negative numbers, including negative measured net Coins/h. The Top Five `rank.value` text blindly appended `/h` for **all** objectives, including rare-event rates and **Coins per successful capture**. The rare/capture panels contained independent fixed-decimal formatting that similarly lost precision or displayed almost-zero chances as 0.0000%.

This release uses a single presentation-only format for **expected event frequencies**:
- `0/h` means exactly zero events expected per hour; `—` means the source is unknown/unavailable.
- `>=0.1/h`: adaptive decimals/hour (e.g. `0.125/h`).
- `>=1/day` and below 0.1/h: events/day (e.g. `1.2/d`).
- Rarer: expected average interval `~1 / 4.17 d` or `~1 / 1.14 yr`, **not** an event guarantee.
- These intervals are averages under sustained rates and the existing source/independent-roll assumptions. Hunt rankings, server receipts, session history and drop probabilities do not get rounded or altered.

The display uses a separate `formatDurationHours()` for average waiting/crafting times, now in hours, days or years, and `formatProbability()` for small percentages, including scientific notation if six decimal places would still conceal a positive probability. The normal `formatRate()` now preserves true zero, negative values and numeric-string inputs. It is distinct from `formatEventRate()`, so XP and Coins are not incorrectly converted into days.

## UI paths fixed

| UI surface | Old behavior | New behavior |
| --- | --- | --- |
| Top Five and best recommendation | Small rare/shiny/capture rates rounded to `0/h`; ball-efficiency cost incorrectly carried `/h` | Objective-aware values with correct time units or `Coins/capture`; underlying score sorting untouched |
| Individual species card | Shiny caught/h or captures/h formatted to fixed decimals, sometimes as 0 | Dynamic time units, readable waiting time, and percent precision for Ultra/Beast odds |
| Expanded hunt details | Selected rare item rate used integer-only `formatRate` | Rare-specific rate with days/years when appropriate |
| Outland and Shiny Egg rare planner | Tiny items/h + extremely long `h` waits; fixed probability precision | Unified event frequency and expected wait in d/yr; probabilities with adaptive precision |
| Global catch/shiny planner | Fixed 5 decimals/h potentially obscured very rare positive rates | Adaptive selected-ball capture, shinies seen and shinies caught rates; days/years for long shiny waits |
| Optional third-party scenarios | Tiny catches/shinies/rare items/h formatted with fixed decimals | Same adaptive event-rate presentation, still explicitly **what-if** and off by default |
| Net Coins | Negative realized net treated like missing data | Signed negative and real zero distinguishable |
| Ranking rows on small viewports | Very long source/rate strings forced grid overflow and could crowd out Go | Bounded score column, wrapping text, stacked rows on narrower widths; Go remains visible |
| Reference multiplier controls | Number boxes had no bounded width and were easily crowded | Compact readable bounded fields with minimum height and wrap support |

## QA

New `huntatlas/tests/rare-rate-ui.test.cjs` checks actual production helpers, real/unknown zero distinctions, negative Coins, numeric strings, hour/day/year transitions, tiny positive percentages, ranking units and UI wiring/wrapping. The Milestone F ranking fixture now expects objective-aware formatting instead of the old hard-coded `formatRate(score)`.

Pure fixtures and JavaScript syntax checks do **not** substitute for real browser screenshots. Manually verify:
1. Search a rare species and sort by target shiny captures, then expand the species card. No positive predicted rate should read `0/h`.
2. Rank Outland by Bicycle Fragment or Key Fragment with different tiers; the Top 5 and expanded planner should show equivalent ordering and meaningful magnitudes. Verify any exact zero/unknown still says `0/h`/`—`.
3. Compare Ultra vs Beast, Shiny Lure simulation and optional reference boost scenarios; display units adapt while server assumptions remain labeled.
4. Test narrow Firefox width / 125–150% zoom, keyboard focus, long source strings and opening/closing the rare/capture details. The Go control should not be clipped.
5. Verify negative net Coins/h remains visibly negative without reporting fabricated realized revenue.

No new timers, network calls, market polling, snapshots, game automation or tier commands were introduced by this patch.
