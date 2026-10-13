# Hunt Atlas Milestone E — Ultra/Beast capture economics and shiny hunting

**Premium experimental v1.9.8 · 2026-10-13 · synthetic regressions, not deployed-server validation.** Sources: [capture economics](AUTOCATCH_CAPTURE_ECONOMICS.md), [roadmap](HUNTATLAS_ROADMAP.md), [Milestone A protocol](HUNTATLAS_MILESTONE_A_PROTOCOL.md), `shared/sell-value.mjs`, `pokedex-gpt.mjs`, `shared/mistico.mjs` in `MOTHblank/pokeidle-upstream`.

## Product focus

**Ultra Ball (ID 4, ×4) is the default comparison**, with **Beast Ball (ID 5, ×8)** available through one selector. The other three ball types are supported by the core math for regression consistency, but the main UI avoids making users examine a five-ball matrix they rarely use. Beast is a **Diamonds** purchase; never assign it a fabricated Coins exchange value, or call it free. If the running game does not disclose the Diamond unit price, display it as unknown.

The hunt list shows **both Ultra and Beast chance per species** and each visible species' **estimated captures/h and shiny catches/h**. Sort by **captures per hour of the species being ranked**, or by **shiny captures per hour**, using the currently selected Ultra/Beast scenario. Existing XP and Coins sorts are unaffected. Missing rarity, lack of K/h, immunity, or uncertain Outland shiny eligibility produce **unknown** estimates and are not sorted as zero.

## Source of species rarity and ball chance

For ordinary *defeated* wild Pokémon the **wiki-conditional** formula is:

```text
economicRarity = log10(max(100, speciesEconomicPrice)) - 1
difficulty      = 1 + economicRarity^3/17
chancePerAcceptedBall =
  clamp(0.0075 × ballEfficiency/difficulty × (1.4 - hpFraction), 0.003, 0.10)
hpFraction = 0 for a defeated corpse
```

`speciesEconomicPrice` is **not** the sale value of a caught specimen (MKT), a player-market listing (RMT), N/P/quality/IV, or wild level. `captureRarityFromCatalog` uses the un-capped normalized **species economic rarity** from the static creature catalog. When `huntLevel>150`, it mirrors the upstream high-region normalization `round(12000 × (huntLevel/150)^0.6)` rather than the separately *capped* NPC Pokémon sale-value helper; lower-level catalog data are accepted only when a positive, bounded `sellValue`/`priceNpc` is available. It **does not** invent rarity for a missing species. The deployed server may additionally align evolution-chain values; raw catalog reconstruction is therefore labeled **wiki-conditional / upstream-mirrored**, not a verified server `chanceCaptura` implementation.

The client may supply `welcome.catalogoBolas[*].catchRate` and `priceGold`; explicit valid values take priority over wiki reference ball efficiencies and Coin purchase cost. Wiki defaults include Ultra 130 Coins and Beast **no Coins price**. Live `bola.chance` values are retained only as bounded min/max plus field-presence diagnostics: **their units (fraction vs percent), boost stage and relation to the final UI chance are not verified** and they are never applied as a silent multiplier. No additional WebSocket connection, market scan, game interaction, or polling loop is introduced.

**Illustrative unboosted easiest-body math:** economic rarity price 100 yields Ultra **3.9667%**, Beast **7.9333%**. For economic rarity price 10,000, Ultra is approximately **1.6227%**, Beast **3.2455%**. The **10% success cap** means Beast's ×8 does **not always** double an already-capped Ultra result. The formula's **0.3% minimum** means weaker balls may share the same floor for difficult bodies.

## Accepted throws, actual captures and source of throughput

Milestone A already deduplicates one `morte` per corpse slot generation; one `bola` per eligible dead corpse (accepted server event); `capturado` only after a correlated throw; and separate shiny **seen** in `bola.shiny` versus shiny **caught** in `capturado.pokemon.shiny`. Milestone E adds a scoped, bounded **30-second bucketed window, maximum 33 rows/15 min** containing unique defeated bodies, accepted throws, confirmed captures, ball IDs, (when available) species identity, and shiny evidence. It does **not** convert an Auto Catch+ 100 ms click/poll tick into a throw, invent a second accepted attempt after failure, or treat unknown responses as failures. When shiny fields are absent, their observed counts are **unknown**, not zero.

Measured accepted-throw coverage is `acceptedThrows / killedCorpses`, and accepted throws per hour use the same **sustained wall-clock denominator** as measured kill XP (at least six kills, 60 seconds, within two minutes of the last kill). A representative **target species-kill distribution** requires **at least 30 identified kills and full attribution**; otherwise the existing spawn `pontos` mix is used with the source labeled modeled. For **whole-hunt captured odds**, if at least 30 **accepted throws** have all been attributed to species, the capture model instead weights those species by the actual **throw mix**, since the player may intentionally throw at some species more often than others; partial attribution does not get normalized optimistically. Correlated server events are distinct from unverified `bola.sucesso` flags, which are preserved in the receipt but not promoted to a confirmed capture unless a matching `capturado` arrives.

**Current hunt with valid evidence:** `acceptedThrows/h = kills/h × measured accepted-throw fraction`. **Other hunts / insufficient evidence:** the model explicitly shows **an upper-bound scenario assuming every killed corpse receives one accepted throw**, not a promise of actual capture throughput. Expired corpses, pauses, skipped bodies, inventory reserve, restocking, server capture limits, and competition with other activity can all lower throughput. No invented constant native 1.2s scheduler bound is applied to an unverified userscript.

The planner reports:

- **Chance per accepted ball:** per species and weighted hunt mix, Ultra/Beast separately.
- **Expected successful captures/h:** accepted attempts/h × conditional capture chance; species-specific predictions also weight spawn/confirmed representative target distribution.
- **Expected balls per capture:** `1/p`; **expected Coins per Ultra success:** `Ultra Coin unit price/p`, or separate **Diamonds per Beast success** *only if a real Diamond unit price exists*. Ball inventory and runway use **that ball's own observed consumption rate**, not all balls together.
- **Observed outcomes:** accepted throws, confirmed captures, shiny seen, shiny caught, and proportion of killed bodies actually thrown at. No success rate is presented as statistically certain on tiny samples.
- **Shiny seen/h:** eligible accepted attempts/h × shiny roll; **shiny caught/h:** eligible accepted attempts/h × shiny roll × success chance. A shiny seen on a failed throw is *not* a caught shiny.

The Shiny Secret Lure toggle is explicitly a **hypothetical ×2 simulation**: it changes the eligible roll baseline from **1/24,000** to **1/12,000** but makes **no claim** that a lure is active. The estimated chance of at least one shiny caught over 24 hours is calculated with independent stationary trials. These are probability estimates **per accepted ball**; there is no pity timer or guarantee, and a captured specimen is not guaranteed to be legal for RMT (N ≥ 3.5).

For **Outland**, ordinary capture estimates can still be displayed if species rarity is known, but **shiny eligibility is withheld as unknown** due to the mismatch between the wiki's general statement and `sessao-hunt.mjs` explicitly excluding Outland from shiny attempts. We do not extrapolate 1/24,000 into Outland.

## Mystic and captured-level isolation

`captureMysticChance(ballId, boost)` is a separate tested helper mirroring `shared/mistico.mjs`: Poké 0.1% → Beast 0.5% at baseline, Ultra 0.4%, Beast 1% with a verified ×2 Capture Boost. A Mystic capture spends a **MysticTicket per attempt** (and has unique ticket/encounter gating). Hunt Atlas deliberately **does not treat Mystic as a normal selectable farm hunt** or reuse the ordinary species price rarity formula for Mystic.

When the creature catalog explicitly supplies `tetoCaptura`, the species row can show a post-capture level ceiling separately. Missing cap is left unknown; wild target HP, experience and economic rarity are **not** altered by this captured level.

## Limitations and owner-led checks

The shared mirror does not expose a fully authoritative deployed `chanceCaptura` function, active Capture Boost/lure stack/expiration protocol, current `bola.chance` units, all server targetability constraints, or the complete chain-aligned rarity catalog. These limitations remain open for HA-19, HA-21 and HA-23. The current implementation fulfills the **conditional version** of the planner and the **accepted server event** lifecycle but is **not a runtime-certified catch rate**.

Useful checks in a live game session: compare the UI's ball odds with `window.__mothHuntAtlasExperimentV1.snapshot().captureEvidence` on two contrasting known species, using Ultra and Beast; verify `bola.chance` units/bonuses without copying raw packets or account data; compare sustained actual attempts and `capturado` receipts after 6+ kills / 60 seconds; check shiny seen on a failed attempt and captured only on success; test stock/reserve/restock downtime; and verify whether Outland ever emits eligible shiny rolls.

Run `node --check huntatlas/hunt-atlas.user.js` and `node --test huntatlas/tests/*.test.cjs`. Regression fixtures include rarity fallbacks, 0.3%/10% caps, Ultra vs Beast, per-species spawn mix, accepted throw deduplication, missing shiny evidence, seasonal shiny scenarios, and Mystic isolation. **Automated tests do not certify live gameplay.**
