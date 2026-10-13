# Hunt rewards and rare-drop economy — wiki ↔ upstream reference

> **Implementation reference for Hunt Atlas, Moth Watch and Auto Catch+.** Describes how to derive reward rates without confusing guaranteed Coins, NPC-resellable loot, community-market valuables, and captured Pokémon. **No addon behavior is changed by this document.**

**Reviewed:** 2026-10-12.  
**Primary sources:** the supplied PokéIdle wiki (*Níveis e XP; Bônus de live; Combate; Mapa e Hunt Analyser; A Sessão; Shiny; Casa e XP Share; Bicicletas; Ovo Shiny; Bosses; Market; Mercado da Comunidade; Loja de Diamantes*); `MOTHblank/pokeidle-upstream` shared/client code at review time; [Hunt Atlas](../addons/hunt-atlas.user.js), [Moth Watch](../addons/market-bot.user.js), and [Auto Catch+](../addons/autocatch.user.js).  
**Upstream availability:** the checked repository mirrors client/shared source, **not the full deployed game server**. Server-only roll semantics, dynamic boosts, per-session data and transactions must be marked **wiki-reported**, **source-implemented**, or **live-verified** as appropriate. Never assume static catalog files alone establish a live player's rewards.

Companion references:
- [Pokémon valuation and grade](./POKEMON_VALUATION_REFERENCE.md) — individual Pokémon quality, IVs, P tier, score and resale.
- [Wiki ↔ upstream mechanics map](./POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md) — other correlated systems.

## Contents

1. [Four separate reward accounts](#1-four-separate-reward-accounts)
2. [XP and gold per kill: exact upstream curves](#2-xp-and-gold-per-kill-exact-upstream-curves)
3. [Ordinary species loot and NPC resale](#3-ordinary-species-loot-and-npc-resale)
4. [Kills/hour, observations and boosted XP](#4-killshour-observations-and-boosted-xp)
5. [Outland rare drops, all eight tiers](#5-outland-rare-drops-all-eight-tiers)
6. [Shiny Egg fragments outside Outland](#6-shiny-egg-fragments-outside-outland)
7. [Bosses, token conversion and linked rewards](#7-bosses-token-conversion-and-linked-rewards)
8. [Boost stacking and uncertainty](#8-boost-stacking-and-uncertainty)
9. [Expected drops/hour, waiting time and risk](#9-expected-dropshour-waiting-time-and-risk)
10. [Fair-value and net-profit accounting](#10-fair-value-and-net-profit-accounting)
11. [Worked comparisons](#11-worked-comparisons)
12. [Data contract, addon integration and tests](#12-data-contract-addon-integration-and-tests)
13. [Source discrepancies and unverified questions](#13-source-discrepancies-and-unverified-questions)

## 1. Four separate reward accounts

| Reward / inventory stream | Trigger | Valuation | Do **not** confuse with |
| --- | --- | --- | --- |
| **Kill gold (Coins)** | Wild defeated; depends on mob/hunt level | Already deposited Coins | Items in inventory or proceeds from selling them |
| **Ordinary species loot** | Species' own `loot` entries, item chance and quantity | NPC resale only if **NPC actually accepts that item** | Every loot item having positive player-market value |
| **Rare/premium drops** | Special drop rolls (Outland, high-level hunts, boss victories) | Quantity and **realized or comparable** Community Market price, by Coin/Gem currency | Guaranteed Coins; item auto-sell; a quoted asking price |
| **Captured Pokémon** | Capture attempt succeeds on a target | Separate NPC Pokémon price or per-specimen Community Market value | Drop per kill; guaranteed capture; species NPC-item resale |

**Two separately tracked XP streams:** the **trainer** and the **active Pokémon** gain XP from defeat, but have different bonus stacks (XP Boost vs Pokémon XP Boost). XP Share via houses/held items is a further **extra Pokémon XP distribution**, not a subtraction from the active battler. XP is a progression output, not a currency to add into Coins/h.

The wiki's **Sessão** panel records trainer/Pokémon XP, gold, kills, captures, rare drops and consumable costs, and reports net profit. Most importantly, **net gold**, **held market inventory**, and **XP** are distinct units. Gems should remain a separate column unless an observed, time-stamped conversion rate is supplied.

**Hunt eligibility is by trainer level**; location markers are not interchangeable with capture level or the current Pokémon's level. Outland has one shared area catalog with selectable rarity tiers, not eight different mob catalogs.

## 2. XP and gold per kill: exact upstream curves

**Source of truth for the inspected shared implementation:**
- [`shared/sell-value.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/sell-value.mjs) exports `xpDoNivel`, `ouroPorKillDoNivel`, `ouroDoNivel`, plus NPC Pokémon resale helpers.
- [`shared/recompensa-hunt.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/recompensa-hunt.mjs) exports `xpPorDerrota` and `ouroPorDerrotaHunt` and **passes the mob level** into the former functions.
- [`hunt-analyser.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/hunt-analyser.mjs) uses those per-kill functions in its static model.

### XP per defeated wild Pokémon

```js
function xpDoNivel(n) {
  return n <= 150
    ? Math.floor((6 * n * n) / 10) + 8
    : Math.round(13_500 * (n / 150) ** 1.25);
}
// xpPorDerrota(hunt, nivelMob, especie) calls xpDoNivel(nivelMob).
```

This is **per-kill XP**, **not** the cubic *total XP needed to level up a trainer or Pokémon*. The wiki contains the separate total-level XP curve.

The current shared function uses **mob level**, not `especie.experience` directly. If the server spawns mobs at different levels inside an area, use the actual level of each mob; the client Hunt Analyser simplifies its weighted estimate using `hunt.nivel`.

### Gold already paid per defeated wild Pokémon

```js
const EXPONENT = Math.log(6000 / 36) / Math.log(5000); // ~0.6007
const CAP_LEVEL = 25_000;
const goldPerKill = n =>
  Math.min(
    Math.round(36 * CAP_LEVEL ** EXPONENT),
    Math.max(1, Math.round(36 * Math.max(1, n) ** EXPONENT))
  );
```

The two economic anchors are **36 Coins at level 1** and **6,000 at level 5,000**; the gold-per-kill payout is capped at **15,776 Coins from level 25,000 upward**. The *different* `ouroDoNivel(n)` helper uses `round(12000*(n/150)^0.6)` and helps normalize species prices/rarity. **It is not the kill gold payout** and can climb beyond the kill cap. Never replace one with the other in a profitability calculation.

### Reproducible reference points (derived by applying the exported functions)

| Mob level | XP/kill, unboosted | Gold/kill, unboosted | Ordinary NPC-loot **target** / kill (section 3) |
| ---: | ---: | ---: | ---: |
| 1 | 8 | 36 | 5 |
| 100 | 6,008 | 572 | 86 |
| 150 | 13,508 | 730 | 109 |
| 1,000 | 144,617 | 2,282 | 342 |
| 5,000 | 1,081,265 | 6,000 | 900 |
| 25,000 | 8,084,343 | 15,776 | 2,366 |
| 160,300 | 82,487,207 | **15,776** | 15,905 |

**Warnings:** third column of outputs is *expected balancing value*, not gold immediately received, and *not every species' exact loot expectation*. Numbers depend on the version of upstream constants. Each real Pokémon death may have separate bonus calculations, kill level, items and server rules.

## 3. Ordinary species loot and NPC resale

**Source:** [`shared/economia-drop.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/economia-drop.mjs), [`shared/venda-npc-item.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/venda-npc-item.mjs), and [`hunt-analyser.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/hunt-analyser.mjs). Wiki: *Market → Venda*.

### A balancing target is **not** a universal per-species payout

The economy balancing helpers are:

```text
G(n) = ouroPorKillDoNivel(n)
TargetTotal(n) =
    round(1.15 * G(n))                                 for n <= 25,000
    round(1.15 * G(25,000) * (n / 25,000)^0.30)        for n > 25,000
TargetNpcLoot(n) = max(0, TargetTotal(n) - G(n))
```

`FRACAO_DROP_BASE=0.15` means **+15% relative to kill gold** below the cap, or **~13.04% of combined income** — not “15% of total.” Above level 25,000, **gold stays flat**, while the economic balancing target continues scaling via a **0.30 exponent**. By level 160,300, the target is around half from items (before market values), but whether the player realizes it depends on loot, inventory/selling and actual kill rate.

The *real* species table is the catalog's `especie.loot`, after its data transforms and normalizations. `aplicarEconomiaDrop` / `reequilibrarEspecie` attempt to bring NPC-resellable entries toward the target by:

1. Preserving original **positive** loot probabilities whenever possible, including a zero-probability entry remaining disabled.
2. Scaling **quantities**, not arbitrary drop chances, for already NPC-sellable drops.
3. Limiting ordinary line quantities to **20** units.
4. For a species with no NPC-resellable loot, adding a type-themed seed item with a chance **up to** 60% — **not always 60%**.
5. Optionally adding a **Rare Pokémon Picture** entry with **5%** roll probability *if the remaining target value justifies at least one unit*. This is not an unconditional 5% rare drop from all monsters, and its quantity depends on the remaining balancing amount.

Quantity and integer rounding produce **differences** between the target and a species' final expected loot. The code's own illustrative species table has different results than `alvoDropPorKill`; for example at hunt level 5,000 its **specific** Snivy example gives 846 NPC Coins of loot EV, whereas the **generic** target is 900. This is not contradictory; it proves the distinction.

### Compute expected NPC loot per species

For a catalog loot line `l`, upstream stores `l.chance` in **percentage × 1000**:

```text
p_line = clamp(l.chance / 100000, 0, 1)
avg_qty = ((l.minCount ?? 1) + (l.maxCount ?? 1)) / 2
EV_NPC_line = p_line * avg_qty * npc_sell_price(item)
EV_NPC_species = sum(EV_NPC_line) over NPC-eligible lines only
```

Use `listaDropsEspecie()` in the upstream Hunt Analyser to display the chance as `l.chance / 1000` **percent**, not as the probability fraction. Example: a stored value of `5000` is **5%**, meaning the fractional probability is **0.05**.

- **An item being dropped is not proof that the NPC buys it.** NPC buy/sell rules must come from the catalog/normalized item classification. Evolution stones, shiny stones and Bronze Boss Tokens cannot be sold to the NPC, according to the wiki; `itemVendavelAoNpc()` and `normalizarNpcPriceItem()` are the shared discriminators.
- **The ordinary Pokémon drop catalog is not generally sellable on RMT**, according to the wiki's player-market item whitelist. Do not assign arbitrary player-market prices to Bug Wing, Fur, etc.
- `especie.huntLevel` can differ from the encounter's **mob level**. `reequilibrarEspecie` uses `esp.huntLevel` to shape its static loot; `xpPorDerrota` uses the **actual mob level**. Combining the two dimensions requires care.
- `loot × completed-sale price` is an estimate of *recoverable market proceeds*, **not** the NPC balancing curve. These are different item sets.
- If `precoDe` does not identify the NPC purchase price, label line value **unknown**, not zero, until its actual NPC eligibility and value are confirmed. A confirmed prohibited item does have **zero NPC value** even if its player-market price is substantial.

### Weighted hunt composition

The built-in `mediaPorKill(hunt, especies)` weights entries by **spawn points**:

```text
weight_i = hunt.especies[i].pontos / sum(all pontos)
EV_NPC_loot_per_kill = Σ weight_i * EV_NPC_species(i)
```

This assumes the point weights represent the actual long-run kill mix and ignores per-species combat time bias, missed spawns and AOE target patterns. For a *measured* comparison, use kills broken down by species when available, not just the catalog spawn weights. The upstream static `mediaPorKill()` includes XP and gold, **not this NPC-loot EV**; it must be calculated separately.

## 4. Kills/hour, observations and boosted XP

The inspected upstream `hunt-analyser.mjs` has a simple baseline:

```text
mobCountPerWave = min(16, sum(hunt.especies[].pontos))
msPerKill = 900 (global attack) + 600 (travel) + 2000 (average action) = 3500
estimatedKillsPerHour =
    3600 * mobCountPerWave / ((mobCountPerWave*3500 + 2600)/1000)
```

This is a **heuristic estimate**, not the game's actual server cadence. It assumes one kill per modeled attack opportunity, fixed travel, and a 2.6-second wave gap. Performance of a real active Pokémon depends on damage, effective matchup, move cooldowns, AOE, actual spawn/respawn, equipment, bicycle, healing and interruptions.

The wiki states: after entering/changing hunts, there is a **10-second** switch/action anti-abuse interval in some circumstances; following a recent fight a newly entered area can appear empty for part of this interval. Repeated hunt switching is not a free source of extra waves. Wild corpses persist for **30 seconds** for a one-attempt capture; corpse presence itself does not constitute another kill.

### Which measurements to prefer

1. **Observed kills/hour** of the same active lead and same hunt, with sufficient sample size and elapsed time.
2. **Measured per-species kill mix** if the protocol exposes identities, plus observed success/downtime.
3. **Personalized modeled combat rate** (as in Hunt Atlas), with uncertainty from missing target HP/damage or AOE attribution.
4. **Static upstream baseline**, explicitly labeled as a baseline or cold-start estimate.

The upstream `ritmoDaSessao()` returns **trainer XP/h and Pokémon XP/h separately**, plus gold/h, kills/h and captures/h; it clamps the denominator to at least **60 seconds** to stop 3-second sessions from producing inflated numbers. It also offers an `xpH` field that **sums trainer and Pokémon XP**; do **not** describe that sum as the level-up rate of either individual. The owner's wiki indicates that the Sessão panel includes consumed balls/potions/revives and costs.

For trainer and Pokémon XP, the minimal model is:

```text
TrainerXpPerHour = measuredKillsPerHour * expectedBaseXpPerKill * effectiveTrainerXpMultiplier
PokemonXpPerHour = measuredKillsPerHour * expectedBaseXpPerKill * effectivePokemonXpMultiplier
```

Actual server boost application/order can be more involved (especially Catch-up Boost target crossing). Keep the **derived estimate** distinct from live sampled XP/h.

## 5. Outland rare drops, all eight tiers

**Wiki:** *Combate → Drop na Outland / As 8 Outlands*, *Bosses*, *Shiny*, *Casa e XP Share*, *Bicicletas*.  
**Upstream:** [`shared/outland-tiers.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/outland-tiers.mjs); [`shared/outland.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/outland.mjs).

The actual `OUTLAND_TIERS` **array has eight tiers** even though its header comment still calls them “five Outlands.” Every tier uses the **same base map, spawns, mob level (150) and normal kill rewards**. The trainer-level gate, chosen tier and specific special-drop chance change; the tier must be validated against the trainer's unlocked level by `tierOutlandValido()`.

### Base drop chances (without boosts)

The **Bronze Boss Token** has wiki base probability **0.0500% per Outland kill**. The wiki separately documents **Key Fragment, Shiny Stone Fragment and Bicycle Fragment** at **0.000500% per Outland kill each**, including the same Outland tier multiplier. Those are *four distinct items/rolls*, not four units of one item. The shared tier module's commentary names the first **three** and omits Bicycle; `shared/ovo-shiny.mjs` comments include Bicycle as an Outland drop, but **the server's full drop call path is not included in this mirror**, so treat Bicycle tier handling as **wiki-reported pending live/server verification**.

| Outland | Trainer level | Tier × | Boss Token per kill | Each 0.0005%-base fragment per kill | Mean kills/token | Mean kills/fragment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 150 | 1 | 0.0500% | 0.000500% | 2,000 | 200,000 |
| 2 | 500 | 1.25 | 0.0625% | 0.000625% | 1,600 | 160,000 |
| 3 | 1,000 | 1.5 | 0.0750% | 0.000750% | 1,333 | 133,333 |
| 4 | 2,000 | 2 | 0.1000% | 0.001000% | 1,000 | 100,000 |
| 5 | 4,000 | 3 | 0.1500% | 0.001500% | 667 | 66,667 |
| 6 | 8,000 | 4 | 0.2000% | 0.002000% | 500 | 50,000 |
| 7 | 16,000 | 6 | 0.3000% | 0.003000% | 333 | 33,333 |
| 8 | 25,000 | 8 | 0.4000% | 0.004000% | 250 | 25,000 |

A table cell **mean kills** is `1 / fractional_probability` **before Loot Boost or other bonuses**. For fragments it is the expected number to **one fragment**, not to a crafted house, bike or Shiny Stone. The wiki requires **10 corresponding fragments** for those crafts, so the expected kills to collect ten is **10×** the one-fragment mean *under fixed independent identical kill conditions*. This does **not** say every player will receive a drop at that kill count.

**Do not apply Outland tier multipliers to:** kill XP, kill gold, ordinary species loot, shiny capture chance, or Shiny Egg fragments. Ordinary loot may still have its own shop/guild/event mechanics; those are separate from the tier.

**Historical Outland IDs:** `shared/outland.mjs` includes legacy `10501+` ID remapping to normalized `2001+` variants. If using a historical dataset, normalize species/form identifiers before aggregating farming distributions; do not count one form twice.

## 6. Shiny Egg fragments outside Outland

**Wiki:** *Ovo Shiny → Onde cai o fragmento*.  
**Upstream:** [`shared/ovo-shiny.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/ovo-shiny.mjs).

The Shiny Egg fragment uses **a different rare-drop curve**, keyed by hunt level and **not** by Outland tier, species quality or trainer level. It drops on non-Outland hunts of level **5,000 or higher**, in **Unova, Kalos and Alola (including Galar and Paldea)**.

```text
D = number of fixed DEGRAUS_FRAGMENTO_OVO_SHINY entries <= hunt.nivel
p_fragment = 0                             if D=0 or hunt.area='outland'
p_fragment = 0.0000375 + (D-1)*0.0000015   otherwise [fraction per kill]

Percent: 0.00375% for D=1, +0.00015 percentage points each subsequent tier.
```

The 30 fixed tiers from the module (do not derive the tier index by counting hunts dynamically):

```text
Unova:  5000, 5400, 5900, 6400, 6950, 8000, 8600
Kalos:  10000, 11250, 12750, 14350, 16000, 20000, 21200
Alola:  25000, 27050, 29450, 32000, 34650, 43100, 50000, 58900,
        64000, 69300, 86150, 100000, 114800, 123350, 132200, 160300
```

| Hunt level | Tier number | Base per-kill chance | Mean kills/fragment | Mean kills/10 fragments |
| ---: | ---: | ---: | ---: | ---: |
| 5,000 | 1 | 0.00375% | 26,667 | 266,667 |
| 8,600 | 7 | 0.00465% | 21,505 | 215,054 |
| 10,000 | 8 | 0.00480% | 20,833 | 208,333 |
| 25,000 | 15 | 0.00585% | 17,094 | 170,940 |
| 160,300 | 30 | 0.00810% | 12,346 | 123,457 |

The wiki prints some entries with four decimal places and may round 0.00375% down to “0.0037%” in a table. **Use the exact upstream constants above in calculations.** The module's fixed level list is an explicit economic decision, so adding a new hunt *between* these levels must not automatically change old tiers.

**Crafting:** `FRAGMENTO_OVO_SHINY_ID=70017`, `OVO_SHINY_ITEM_ID=70094`. **10 fragments → one Shiny Egg**, **168-hour** base incubation, guaranteed shiny from an eligible pool. The wiki says Absorb Bulb heating reduces the time to **126 hours**, a *25% decrease in duration*, not a 25% higher drop chance. Crafting/incubation returns a Pokémon, not guaranteed cash; species distribution, sale eligibility, buyer demand, timing and expenses must be modeled separately.

Loot Boost applies to the rare fragment chance by the wiki and source comments, but the shared module calculates **base chance only**; a different server roll applies boosts.

## 7. Bosses, token conversion and linked rewards

**Wiki:** *Bosses*, *MysticTicket e Arena Mística*, *TM Elemental e AoE*.  
**Upstream:** [`shared/bosses-lendarios.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/bosses-lendarios.mjs), [`shared/mistico.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/mistico.mjs), [`shared/caixas-npc.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/caixas-npc.mjs).

An Outland **Bronze Boss Token is a one-use entrance** for one boss attempt. Its expected downstream item value must account for *defeating* the boss, level restrictions, potion/revive costs, the token spent, and the probability the boss drops each reward. Do **not** equate tokens found with boss prizes already earned.

The shared functions report (for boss pair index `j`, starting at 0):

```text
TM Disk Piece or AoE Piece probability on a relevant boss victory:
    0.005 * (j+1)                // 0.5%, 1%, 1.5% ...

Mega Stone Fragment:
    same rate as TM Piece
Mega Shiny Stone Fragment:
    half of TM Piece

MysticTicket:
    0.000005 * (j+1)             // 0.0005%, 0.0010%, 0.0015% ...
```

These are **per victorious boss encounter**, not per normal wild kill; TM versus AoE depends on which boss awards which piece. The wiki has a detailed boss-by-boss table and reports the token also comes from some Battle Pass rewards — this is a separate source from Outland kills. `shared/mistico.mjs` also gives special Mystic Arena *capture* probabilities, which are **not** a boss-drop probability and should not be mixed with token economics.

**Expected boss return when planning to consume tokens** (conceptual, not an inferred price):

```text
EV_per_attempt_by_currency =
    chance_of_boss_victory * Σ(Pr(drop_j | victory) * net_realizable_sale_price_j)
    - consumable_cost
    - token_acquisition_or_opportunity_cost
```

Token cost is in a specific currency only if it was bought for that currency; opportunity cost of using a self-dropped token should be reported separately if the same token could instead be sold. Never add Gem-valued drops directly to Coin denominators.

## 8. Boost stacking and uncertainty

**Wiki:** *Níveis e XP → O que multiplica o seu XP*, *Bônus de live*, *Loja de Diamantes → Boosts*, *Guilds*, *Outland*.

| Modifier | Wiki-reported effect | Applies to | Implementation caution |
| --- | --- | --- | --- |
| Trainer XP Boost | ×1.5 | Trainer XP | Not Pokémon XP |
| Pokémon XP Boost | ×1.5 | Active Pokémon XP | Not trainer XP |
| VIP | ×1.5 | Both XP tracks | Also native Auto-Catch benefit; unrelated to rare drop odds |
| Guild Boost | ×1.10 | Both XP tracks | `hunt-analyser.mjs` calls `multBoostGuild()` |
| Ranked guild position | +1% to +10% | XP tracks and loot according to wiki | Actual active rank and stacking should come from current state |
| Twitch official live chats | +15% base, +2.5 percentage points per additional eligible official live | Both XP tracks | Authenticated chat presence; do not assume tab count equals participating channels |
| Kick redeemed bonus | +15% XP, or +15% capture, or +15% shiny chance, depending on redemption | Only selected effect/time | Separate time-limited purchased reward, not generic loot |
| Catch-up Boost | ×10 XP until trainer reaches purchased veteran target | Both XP tracks | Can partially apply to the *final* crossover kill; do not extrapolate blindly |
| Loot Boost | ×1.4 | Rare loot drop chances | **Not** XP/h, **not** gold/kill; server application for ordinary catalog loot needs checking |
| Event | Event-specific multiplier | Depends on event | Must observe the active event; cannot assume fixed percentage |

The wiki explicitly states several XP modifiers **multiply rather than add**. E.g. Trainer XP Boost ×1.5 and VIP ×1.5 yield **×2.25**, not ×2. However the inspected `hunt-analyser.mjs` currently incorporates active shop XP boosts, VIP, a guild rank field and guild boost only; it **does not obviously include every Twitch/Kick/event/catch-up case** in its exported `multXpTreinador()` and `multXpPokemon()`. Prefer sampled actual XP/h or runtime active bonus state. Do not claim its static estimate is universally exact.

For **rare drops**, a useful *conditional estimate* is:

```text
p_effective = clamp(p_base * outlandTierMultiplier * lootMultiplier * otherVerifiedMultipliers, 0, 1)
```

Only include multipliers with confirmed applicability to that drop and current player. Avoid applying the same boost twice if the incoming probability is **already boosted**. Guild/event boosts can have different arithmetic and caps; their final server stacking needs runtime/server verification. The Shiny Egg fragment has **no Outland tier multiplier**.

## 9. Expected drops/hour, waiting time and risk

With `K` *measured kills/hour*, independent per-kill probability `p` as a **fraction**, and no active farming interruption:

```text
expected_item_count_per_hour = K * p * quantity_per_drop
expected_kills_to_first_drop  = 1 / p                     (if exactly 1 unit/drop)
expected_hours_to_one_drop   = 1 / (K * p)
expected_hours_to_10_units   = 10 / (K * p)               (under stationary independent rolls)

P(at least one drop in N kills) = 1 - (1 - p)^N
P(no drop in N kills)           = (1 - p)^N
```

The expected values **do not imply a guaranteed pity timer**. At `N=1/p`, the probability of at least one drop is approximately **63%**, not 100%. This is the reason to display both expected value and a “chance of ≥1 within 1h/24h” indicator where justified by complete data.

When kills/hour changes with hunt, **do not compare only per-kill probabilities**: a higher-level area with fewer kills/hour can drop fewer fragments in practice. Use measured `K` for the player's active lead and hunt, or state that comparisons share a hypothetical K.

### Avoid these dimensional mistakes

- `0.05%` = **0.0005** fraction, not `0.05`.
- `0.0005%` = **0.000005** fraction, not `0.0005`.
- `0.00375%` = **0.0000375** fraction.
- `chance: 5000` in species loot = **5%** probability, not 5,000%, and is **a different data encoding** from rare-drop probability constants.
- Boss drops are **per successful boss victory**, egg fragments and Outland specials are **per wild kill**, shiny capture chance is **per capture attempt**, and species NPC loot probability belongs to **each species' loot row**.
- A single kill can have multiple reward categories; without server evidence do not assert that special rolls are mutually exclusive or independent of each other. Linearity of expected individual counts **does not require independence**; combined “at least one of any rare” probability does.

## 10. Fair-value and net-profit accounting

**Wiki:** *Market → Venda*, *Mercado da Comunidade*, *Todas as taxas*.  
**Upstream:** [`shared/venda-npc-item.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/venda-npc-item.mjs), [`shared/sell-value.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/sell-value.mjs), [`shared/taxa-mercado.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/taxa-mercado.mjs).  
**Addon:** [Moth Watch](../addons/market-bot.user.js) already maintains completed-sale/asking-price references for marketable items.

### Three price bases

1. **NPC item resale:** only for NPC-eligible catalog loot; wiki says NPC pays **100% of its catalog purchase value**, without a market commission. Player-bought potions/balls/revives are not NPC-resellable.
2. **Community Market realized sale:** for allowed items such as Bronze Boss Tokens, Shiny Stone/Key/Bicycle/Shiny Egg fragments, stones, TMs, etc. (follow the actual whitelist; use exact item IDs). Marketable item sale in Coins incurs **15% seller fee**, as does an item sale in Gems; the upstream shared fee function handles the integer rounding. Asking price is **not** realized revenue, and listing status does not ensure execution/liquidity.
3. **Individual captured Pokémon:** separate NPC resale from specimen-specific RMT value. The upstream NPC formula is `floor(sellValueBaseDe(species) * (1 + level/50) * quality * (shiny ? 10 : 1))`. **IV and potency do not influence that NPC formula**. A market Pokémon needs an evidence-based comparable-sale reference, as documented in [Pokémon valuation](./POKEMON_VALUATION_REFERENCE.md).

The game distinguishes **Coins**, **Gems** (RMT currency) and **Diamonds** (shop currency). No formula allows multiplying an observed Gem price by an invented Coin rate. Coins-per-hour and Gems-asset-equivalent-per-hour should remain separate unless an explicitly labelled conversion is observed and dated.

### Recommended per-session ledger

```text
GuaranteedCoins/h = kills/h * gold_per_kill
NpcLootCoinsEV/h  = Σ(kills_by_species/h * species_npc_loot_ev_per_kill)
ConsumableCostCoins/h = Σ(balls/potions/revives consumed_by_type/h * NPC_purchase_price)
RealizedNetCoins/h = observed_coins_gain + actual_NPC_sale_proceeds
                     + completed_RMT_coin_sales_net - observed_consumable_coins_spend
                     - other_observed_coin_expenses

RareInventoryEVCoins/h = Σ(E[item_count/h] * evidence_based_NET_RMT_Coin_price[item])
RareInventoryEVGems/h  = Σ(E[item_count/h] * evidence_based_NET_RMT_Gem_price[item])
```

**Do not add** `NpcLootCoinsEV` *again* to `RealizedNetCoins` if it was already auto-sold during the measurement window. Inventory assets are **unrealized**; show them separately, with currency, price provenance, sample count and confidence. If both Coins and Gems listings are possible, choose an explicit target currency and comparable completed sales for it; do not sum both alternatives as if the item could be sold twice.

In a long idle session, a coin balance snapshot alone can mix hunt income, NPC auto-sales, deposits and market purchases. Prefer categorized game events/records when available, or show a **mixed total** rather than falsely attributing all balance changes to farming.

**Important:** buying or crafting a token, house, bike, egg or held asset carries costs and conversion losses/constraints. Expected drops × hypothetical rare price is **not** guaranteed repeatable hourly liquidity.

## 11. Worked comparisons

The following are **hypothetical** examples to illustrate formulas, **not player-specific forecasts**, current market prices or promises of actual KPH.

### A. Outland 1 versus Outland 8, at the same 600 kills/hour (no boosts)

| Metric | Outland 1 ×1 | Outland 8 ×8 |
| --- | ---: | ---: |
| Boss Token, drops/hour | 600 × 0.0005 = **0.30** | 600 × 0.004 = **2.40** |
| One specified 0.0005%-base fragment, drops/hour | 600 × 0.000005 = **0.0030** | 600 × 0.000040 = **0.0240** |
| Expected hours/one specified fragment | **333.3 h** | **41.7 h** |
| Expected hours/ten specified fragments | **3,333.3 h** | **416.7 h** |

At Outland 8 and with **only** the wiki's Loot Boost ×1.4 applied to eligible rare chance, the model would yield **3.36 Tokens/h** and **0.0336 fragments/h** per given fragment type at the same 600 kills/hour. That assumes neither cap nor another effect changes the final rare-roll probability, and that the player really maintains 600 kills/hour.

Outland itself does **not** increase base XP or gold per kill. A model that claims “Outland 8 pays eight times as much gold” is wrong.

### B. Shiny Egg fragment farming at the same hypothetical 600 kills/hour

| Hunt | Chance/kill, without boosts | Fragments/hour | Mean hours/10 fragments |
| --- | ---: | ---: | ---: |
| Unova level 5,000 | 0.00375% | **0.0225** | **444.4 h** |
| Alola level 160,300 | 0.00810% | **0.0486** | **205.8 h** |

These are not comparative recommendations: a level-160,300 hunt may be much slower than level 5,000 for a particular player. If KPH at 160,300 were **200**, its expected fragments/hour would instead be **0.0162**, *worse than the hypothetical level-5,000 rate*. This is precisely why Hunt Atlas should multiply **drop odds by personalized throughput**.

### C. Coins versus ordinary NPC loot at level 25,000

The generic target model yields **15,776 guaranteed Coins per kill** and roughly **2,366 Coins-worth of average NPC loot per kill**. At a hypothetical 600 kills/hour:

```text
Guaranteed kill gold = 15,776 × 600 = 9,465,600 Coins/hour.
Balancing-target ordinary NPC loot = 2,366 × 600 = 1,419,600 Coins/hour.
```

The second number is **not spendable until the loot is actually received and sold**; for a real hunt, replace the balancing target with the **species-table-weighted NPC loot EV** and account for actual sale behavior. Neither number includes rare RMT-only drops, captured Pokémon resale, market conversion, or consumables.

## 12. Data contract, addon integration and tests

### Minimum schema for a farm estimate (design proposal, not a real packet)

```ts
type Provenance = 'wiki' | 'upstream-shared' | 'observed-client' | 'observed-server';
type PriceEvidence = 'completed-sale' | 'active-listing' | 'npc-catalog' | 'unknown';
type FarmEstimate = {
  huntId: string;
  huntLevel: number;
  area: string;
  outlandTier: number | null;                // null outside Outland
  trainerLevel: number;
  leadSpeciesId: number;
  killsPerHour: number | null;
  killsPerHourSource: 'observed' | 'personalized-model' | 'static-baseline' | 'unknown';
  killSampleCount: number | null;
  measuredDurationSeconds: number | null;
  estimatedTrainerXpPerHour: number | null;
  estimatedPokemonXpPerHour: number | null;
  guaranteedGoldPerKill: number | null;
  npcLootEVPerKill: number | null;           // per-species/encounter weighted
  rareDrops: Array<{
    itemId: number | null;                   // known item ID, otherwise null
    name: string;
    trigger: 'wild-kill' | 'boss-victory' | 'capture-attempt';
    baseProbability: number | null;          // fractional (0..1), not percent
    effectiveProbability: number | null;
    perHour: number | null;
    meanHoursPerDrop: number | null;
    priceEvidence: PriceEvidence;
    priceCurrency: 'gold' | 'orb' | null;
    referenceSamples: number | null;
    provenance: Provenance;
  }>;
  warnings: string[];
};
```

**This is an interchange *proposal*, not a requirement to add polling or new game protocol messages.** Prefer sharing existing telemetry/snapshots already collected by the addons; the Controller is intended to remain low-resource for sessions lasting many hours.

### Hunt Atlas (estimation and prioritization)

- Maintain **four visible sorting dimensions**: trainer XP/h, Pokémon XP/h, guaranteed Coins/h (optionally + NPC loot), and **chosen rare item units/hour**. If a market-based profit estimate is supported, label it separately with currency and sample confidence.
- Use observed KPH over speculative static attack models once representative samples exist; state when it is modeled, when KPH is unknown or when a target coverage fraction is low.
- Read **Outland tier** independently from hunt marker; apply the actual unlocked selected tier; use **fixed** Shiny Egg ladder on Unova+.
- Combine *post-normalization* catalog drop probabilities and NPC price eligibility to calculate ordinary loot value; cache by upstream dataset/version, not per render frame.
- Never claim unknown buffs, boss victory rates, empty-hunt timing or evolving player-market prices as deterministic.

### Moth Watch (market reference input)

- Treat **Bronze Boss Tokens, fragments, finished crafts, and ordinary NPC loot as different item classes**; never use NPC price for rare RMT-only items.
- Reuse verified completed-sale medians with sample counts and freshness for an optional **asset value estimate**, not automatic purchases or implied realized profit.
- Keep **gross listed price**, **fee-adjusted seller proceeds**, and **estimated opportunity value** separate. Market orders remain subject to user rules/reserves and should **not** be triggered by new farm estimates.
- Item names/IDs and live sellability come from the game catalog/protocol, not guesses from strings.

### Auto Catch+ (capture economics)

- Capture is **one attempt per fallen body**; count actual ball use, capture probability if the game supplies it, and time spent restocking. An attempted capture is not a guaranteed Pokémon asset.
- Keep gold spent on balls, potions and revives in the **cost** ledger. If possible, measure net Coins at session scope without charging purchases twice.
- Do not count a shiny *spawn* on each kill when the wiki says shiny is rolled on capture attempt. Poké Balls are not NPC-resellable inventory assets.

### Small deterministic check suite for future implementation

1. `xpDoNivel(1)=8`, `xpDoNivel(150)=13508`; above 150 use exponent 1.25.
2. `goldPerKill(1)=36`, `goldPerKill(5000)=6000`, `goldPerKill(25000)=15776`, `goldPerKill(160300)=15776`.
3. Ordinary loot `chance:5000` maps to **5%**, and NPC-ineligible entries contribute **zero NPC EV** (but may have RMT value).
4. `TargetNpcLoot` differs from at least one specific species loot table; never label it exact.
5. Eight Outlands, shared spawns and **tier multipliers [1,1.25,1.5,2,3,4,6,8]**; tier does not multiply regular gold or XP.
6. At tier 1: Token `p=.0005`, specified fragment `p=.000005`; at tier 8: Token `p=.004`, fragment `p=.00004`.
7. Shiny Egg fragment chance is **zero in Outland**, `.0000375` at level 5000 and `.000081` at level 160300. Missing intermediate hunt levels must use the existing fixed lower ladder step.
8. `K=0` or unknown: no invented `expected hours`; absent current market reference: no invented fair price.
9. Retained rare inventory is never added to both available coins and realized sale receipts; item fee applies to sale, **not** drop generation.
10. Pokémon/trainer XP per hour are distinct; the older generic combined `xpH` must not replace them.
11. Samples with different unit triggers (boss victory vs kill) must not share a common denominator.
12. Model does not add extra scanner requests, and read-only informational changes cannot place purchase orders.

## 13. Source discrepancies and unverified questions

| Topic | Verified evidence | Safest handling |
| --- | --- | --- |
| **Outland tier count** | Wiki has eight tiers; `outland-tiers.mjs` array has eight but header still says “five” | Use eight array entries; flag stale header |
| **Outland Bicycle Fragment** | Wiki says 0.000500% and scales up to ×8; tier shared module's short description names only Token, Key and Shiny Stone | Keep Bicycle as wiki-supported and mark actual server roll path unverified |
| **Shiny Egg probabilities** | Wiki sometimes displays rounded four-decimal percents; `ovo-shiny.mjs` exports precise base/step | Use the upstream **0.00375%** first tier and fixed ladder, with provenance |
| **Loot “target” vs realized drops** | `economia-drop.mjs` balances toward a target but preserves probabilities and rounds/caps quantities | Compute per-species EV from catalog; use target only for sanity checks |
| **Gold/h wording in wiki** | Wiki's Hunt Analyser description mentions species `experience`; inspected `recompensa-hunt.mjs` uses the level-based gold curve | Label mirror implementation; verify deployment if a difference appears |
| **Shop, guild and event rare multipliers** | Wiki gives Loot Boost ×1.4 and additional guild/event influences; mirror contains several shared helper modules but not the full rare-drop server roll | Do not invent precise full stacking/caps; require authenticated live data or server source |
| **Market price and tradability** | Wiki lists the RMT whitelist, while Moth Watch reads market responses and history | Require real completed sales, correct currency, item ID, sample count and fees |
| **Session profit and costs** | Wiki describes a local session ledger; `ritmoDaSessao` exposes XP/gold/kills/captures | Check whether a value already includes NPC auto-sale before adding separate EV |
| **Live events, price changes, new hunts** | Static mirror checked on review date; wiki is user-supplied stated-current rules | Version calculations against upstream catalog, snapshot timestamp and game metadata; warn on mismatch |

### Compact engineering conclusion

For hunt `h`, active lead `p`, and player boost state `b`, the reusable estimating rule is:

```text
estimated_rewards_per_hour(h,p,b) =
  personalized_kills_per_hour(h,p)
  × { xp_per_kill(h,b), gold_per_kill(h), weighted_npc_loot_ev_per_kill(h),
      chosen_special_drop_probability_per_kill(h,b) }
```

Each result is a **different unit**. Keep **gross versus net**, **measured versus modeled**, and **guaranteed versus stochastic** visible. When missing inputs prevent a trustworthy estimate, returning **“unknown” with a reason** is more useful than a confident-looking fictitious price or hourly rate.
