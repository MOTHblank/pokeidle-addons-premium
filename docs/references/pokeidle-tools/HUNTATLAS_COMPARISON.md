# PokeIdle Tools vs Hunt Atlas — actual feature comparison

Reviewed 2026-10-13. Sources: [extracted deployed-site behavior](README.md), [site constants](calculator-data.json), current premium `huntatlas/hunt-atlas.user.js` v1.9.9–1.9.10, and HuntAtlas Milestones A–F. **The third-party site is reference evidence, not an authoritative description of the deployed server.**

## What the reference site really implements

Only **two** calculator pages in the inspected deployed bundle:
1. Shiny capture: base `1/24000`, shiny boost `×1.5`, catch boost `×1.5`, event percentages on both, optional Kick boosts `×1.15`, user-entered base catch chance (2.44% **default only**) and accumulated joint shiny-and-catch probability.
2. Rare drops: Bronze Boss Token `1/2000`, three fragment types `1/200000`, Outland tiers 1–8 and their multipliers, plus manually entered loot/guild/event/Kick drop multipliers. Computes expected items and chance of none/at least one over the user-supplied kill count.

The advertised farm XP/money, IV and DPS tools have no implemented calculators in the inspected bundle. No game account, kill history, combat state, Pokémon catalog, live capture evidence, pricing data, ball catalog or action automation was found. These are not features we should imitate or promise.

## Side-by-side comparison

| Dimension | PokeIdle Tools (actual deployed site) | HuntAtlas premium | Objective judgment |
| --- | --- | --- | --- |
| Shiny odds and catching | Manual per-encounter base catch percent; shiny/catch/event/Kick boost toggles | Per-species wiki-conditional Ultra ×4 / Beast ×8 model with cap, spawn weighting, accepted throws, target-specific shiny **seen vs caught** and hypothetical lure | **HuntAtlas better** for practical, species-specific hunting; source **better** for exposing an explicit manually stacked boost scenario |
| Rare drops | Four Outland drop definitions, source tier multipliers and manually specified loot/guild/event/Kick multipliers | All four Outland items **plus Shiny Egg Fragments**, tier unlocks, current-vs-preview tier, observed drop counts, kills/h, units/h, one- and 24-hour chances, crafting/incubation | **HuntAtlas better overall**; source exposes optional multiplicative bonuses absent from verified HuntAtlas forecasts |
| Chance display | Small-percentage precision, explicit probability of none and expected count | Existing >=1 at one and 24 hours, rare units/h, average time; shiny caught >=1 in 24h | **Source clearer about complementary no-success probability**; reference preview now shows it with six-decimal tiny odds |
| Trainer/Pokémon XP/h | Advertised, **not implemented** | Observed session rates, lead-aware combat models, uncertain cross-hunt projections | **HuntAtlas** |
| Money and costs | Advertised, **not implemented** | Kill Coins, NPC loot EV, realized Coins, replacement-cost-adjusted net and currency separation, with incomplete sources marked unknown | **HuntAtlas** |
| IV and DPS | Advertised, **not implemented** | Combat speed/attack modeling, IV/lead context and matchup; full live cooldown simulation still unverified | **HuntAtlas has useful partial coverage**, not a feature-complete IV/DPS tool |
| Game integration | Standalone manual form; no verified game/account integration | WebSocket event evidence, session counters, map/Outland controls with state confirmation, target-specific sorting | **HuntAtlas**, subject to deployed-game validation |
| Reliability of numerical claims | Convenient mathematical what-if, **site assumptions** | Source-qualified estimated and observed data; server catch formula and active boost stack still open | **HuntAtlas makes fewer silent assumptions**, though cannot claim server parity |

## Adopted in premium HuntAtlas v1.9.10

- Optional, **off by default** read-only *Third-party boost scenarios* inside expanded hunt details.
- Manual toggles for documented shiny/catch `×1.5` and optional Kick `×1.15` coefficients. Editable nonnegative shiny/catch event percentages in **percent units**; explicit no-boost defaults. Kick scenarios do not start or modify the removed controller Kick integration.
- Manual rare `loot`, `guild`, `event`, `Kick` **multipliers** (default `1` rather than percent); applied to the **already tier-adjusted** selected rare item, not mistakenly applied to XP or Coins.
- Scenario result: chosen Ultra/Beast catch chance, expected catches/h, shiny seen/h and caught/h, chance of >=1/none in 24 hours. For the chosen rare item: chance per kill, expected items/h, chance of >=1/none in 24 hours.
- Tiny probability display adapts precision down to six decimal percentage places. Strict input validation, caps and known-unknown separation; no fabricated Outland shiny eligibility.
- Model output remains **what-if** with explicit third-party source and caveat. It never auto-detects or activates boosts, changes observed rates, changes the actual underlying forecast, alters rankings, buys/sells anything or adds polling/sockets. These user-controlled options are saved with the existing Atlas filter data.

## Not adopted, deliberately

- Treating the site's **2.44% default capture probability** as universal or substituting it for HuntAtlas species rarity / Ultra/Beast efficiency.
- Calling a third-party shiny/catch/event/Kick bonus **active** without game-state verification. The site computes shinies per user-entered encounter; HuntAtlas correctly keeps its **per eligible accepted ball** baseline consistent with its existing capture-event evidence. Transfer only the source's hypothetical *multipliers*, not unsupported encounter semantics.
- Applying multiplied rare odds by default to rankings, observed receipts, realized Coins/h, or Moth Watch buying rules.
- Copying nonexistent farm, IV or DPS implementations from site navigation, treating an advertised future calculator as available.
- Replacing the game/upstream tier gates, Shiny Egg model or server evidence with site-derived assumptions.

## Follow-up evidence, not a reason to block development

The *deployed server* must establish whether the shiny ×1.5, catch ×1.5 and Kick ×1.15 modifiers are still enabled, their activation signals, target stage and composition order. It must also establish whether loot/guild/event boosts stack by multiplication after Outland tier. The current browser-session telemetry cannot certify them. A manually selected scenario remains hypothetical even if it numerically matches an active buff.

Pure regression coverage: `huntatlas/tests/pokeidle-tools-reference.test.cjs` (standalone Node fixtures; game runtime verification owner-led).
