# Hunt Atlas Milestone F — goal-specific recommendations, compact UX and resource safeguards

**Implemented in experimental premium v1.9.9, 2026-10-13.** Regression tests are deterministic fixtures; **the owner is responsible for live-game verification**. This document supplements the [roadmap](HUNTATLAS_ROADMAP.md), [capture math](HUNTATLAS_MILESTONE_E.md), [economy](HUNTATLAS_MILESTONE_C.md) and [rare model](HUNTATLAS_MILESTONE_D.md).

## 1. Every ranking has exactly one objective

`haMetricValue` and `haRankMetricRows` are small, independent helpers covered by `huntatlas/tests/recommendations-milestone-f.test.cjs`. They select only the requested metric; **missing data are last in both directions**, never replaced with a high trainer-XP estimate, fabricated zero, or a blended score. Negative net Coins remains a valid negative value, distinct from `null`.

| Dropdown objective | Score and limitations |
| --- | --- |
| Trainer XP/h | Measured or labeled modelled trainer XP only; default remains `xp` |
| Active Pokémon XP/h | Separate `pokemonValue`; missing Pokémon XP is not replaced with trainer XP |
| Kill Coins/h | Guaranteed kill payout prediction or observed kill receipts where complete |
| NPC loot EV/h | **Expected** NPC-saleable ordinary loot; not realized liquid Coins |
| Net Coins/h | Observed complete realized Coins less item replacement cost; unavailable with incomplete cost evidence |
| Selected rare items/h | **Individual** Boss Token/Key/Shiny Stone/Bicycle/Egg Fragment from the Outland preview tier or eligible ordinary hunt; cannot rank from a generic combined rare scalar |
| Target capture successes/h | Accepted-throw percentage × **target species spawn frequency** × conditional ball odds; Ultra is default, Beast optional |
| Target shiny captures/h | Eligible accepted throws × target catch probability × conditional shiny roll; Outland is intentionally unknown |
| Fewest Coins per successful Ultra capture | Coin unit price divided by conditional Ultra success chance; **lower is better** in default order; Beast Diamonds are not assigned a Coin exchange value |

Filtering is applied **before** hunt ranking. Hunts are deduplicated by actual `slug` (not phantom Outland 2–8 variants), locked hunts are excluded and species-targeted metrics are computed only from species surviving search, type, weakness and caught/uncaught filters. For a hunt with multiple matching species, capture rankings choose the strongest *matching target* and show its name. Both the species list and Top 5 match the selected supported ranking metric. Numeric sort direction is preserved, ties resolved by hunt level and stable slug. Name/Pokédex/matchup sorts continue their own species-list behavior, while the Top 5 explicitly labels trainer XP/h rather than pretending those textual sorts are quantitative farming goals.

The user can select an individual rare item, **Bronze Boss Token (default), Key Fragment, Shiny Stone Fragment, Bicycle Fragment or Shiny Egg Fragment**. The source is still the unboosted conditional model with server caveats. The selected tier is read-only **preview**, distinct from the in-game active Outland tier. Shiny Egg Fragment applies only in eligible non-Outland hunts; selecting another rare item outside Outland cannot create an imaginary drop.

## 2. Compact interface, user-facing provenance

- The normal hunt row remains a compact line: location, level/access, trainer XP label and both Ultra/Beast conditional chances. Its expandable native `details` includes sustained kills/h, separate Pokémon XP, kill Coins, ordinary NPC loot EV, net Coins, **selected** rare item units/h/source/tier preview, selected-ball chance, target catches/shiny estimates, source/confidence/model coverage, location-sharing and verified captured-level ceiling when provided. No extra network lookup or new browser overlay is required.
- The main recommendation states **“Best for [metric]”**, the numeric score and its evidence source. Top Five follows the selected metric; no hard-coded “Top 5 trainer XP” when sorted for rares, catches or Coins. For the best matching capture target, the species name is attached. Missing source/rate yields a visible **no data** state, not a false leaderboard winner.
- The formerly bulky main economy, rare and capture sections are behind a **persisted native expandable details block**, default closed for existing users. The important selected ranking and metric remain visible. PT-BR is the app default and all new UI labels have PT-BR and EN translations; existing filter persistence, Outland tier preview and Ultra/Beast options remain intact.
- A further opt-in **local diagnostic** checkbox inside the expanded block is **off by default** and resets at app startup. It shows only source, measured-window duration if any, coverage, bounded counts of recognized kills/accepted balls/captures, **the number of boost field names** and UI-render attempts. **No raw game packets, account names, chat information, credentials or tokens** are collected, uploaded or displayed. The existing `__mothHuntAtlasExperimentV1.snapshot()` remains a read-only, user-invoked diagnostic, not a background export. Shared Controller Bridge snapshot contract stays at `V1`; no incompatible telemetry changes.

## 3. CPU/RAM cost budgets

The browser already runs long-lived Firefox sessions and may be headless or have the native game map visible; a cosmetic tracker must not pay for full UI list scans continuously.

- No additional market calls, sockets, external services, canvas animation loops or new gameplay automation are added.
- Previously, even with Atlas closed, the recurring 3-second housekeeping tick performed **`syncFromControllerBridge()`**, rebuilding a hunt list and merging state. Now this heavy sync happens when Atlas **opens**, and thereafter only during a **visible-list passive refresh at 12 seconds or longer**. The periodic button check remains cheap. The original 3-second timer remains, so nothing adds another periodic timer; it simply skips the expensive work.
- Incoming combat events can arrive frequently. The new UI queue is **coalesced at a minimum 1.5-second redraw interval** and checks the game modal, enabled Atlas and open Parcel Panic before scheduling. Closed/headless/native-map sessions avoid expensive redraws. Direct user interactions (sort/filter, rare-item selection, expansion) update immediately.
- The previous 120-row incremental limit, 33 x 30-second accepted-event buckets, 64 corpse slots, limited combat samples and bounded caches remain. Expandable per-hunt details are tracked for at most **40 cards**. The redundant legacy verbose per-hunt formatting pass was removed, and optional shared-location work runs only on an expanded card. Formatted DOM HTML is compared with existing content before being replaced.
- Source calculations use local per-render maps for economy and capture sorting, and reuse the existing estimate cache and normalized creature/item/ball catalogs. Server snapshots, relevant scope transitions and window expiration still control rate freshness; the UI throttling does not throttle the actual accepted-event counters.

**Not claimed:** CPU/RAM benchmarks on four concurrent profiles, verified overnight browser-lifetime budget or complete deployed server probabilities. That is why HA-26 retains runtime-performance follow-up in the roadmap.

## 4. Synthetic QA and manual release gates

`huntatlas/tests/recommendations-milestone-f.test.cjs` executes the exact pure math embedded in the shipped userscript. It asserts every metric selector, null-last direction, negative/zero net distinction, cheapest-coin efficiency order, Outland tier gating and individual rare-drop choice, deterministic ties, selected-metric UI wiring and open/closed/performance guardrails. Earlier A–E tests continue to cover source semantics, combat coverage, loot, rare drops, Ultra/Beast capture and shiny roll stages. Node syntax and regression workflows run on GitHub Actions.

Owner-led live QA remains: exercise all metrics/sorts/rare selections in a large catalog while keeping the existing search/weakness filters, verify Top Five names and targeted capture rates, expand/collapse cards through live telemetry refresh, compare background CPU/RAM before/after over multiple hours and verify the real capture/bonus/market protocol unknowns documented in Milestones B–E. Passing CI **does not certify server behavior, runtime cost or the availability of an unknown price**.

## Rollout boundary

The only modified running addon is the **premium** `huntatlas/hunt-atlas.user.js`; the ordinary distribution in `pokeidle-addons`, Auto Catch+, Moth Watch and Parcel Panic logic are not copied/released/rewritten. This is an experimental version for the user's own runtime certification.
