# Capture probabilities and resource management — PokéIdle wiki ↔ upstream

> **Technical reference for Auto Catch+ and [Hunt Atlas](../../addons/hunt-atlas/hunt-atlas.user.js)**. Defines ordinary and special capture probabilities, capture opportunities, ball efficiency, consumable/revive economics, restock safety, and how to estimate sustainable captures/hour without inventing live server behavior.
>
> **Scope:** the formula and model provenance are updated for upstream v1.314.2. Native and Premium Hunt Atlas now model evolution-stage odds for ordinary hunts; auto-throw and restocking behavior are unchanged.

**Capture formula checked against supplied wiki and shared upstream:** 2026-10-27 (original broader review: 2026-10-18).  
**Source tiers:** **[WIKI]** owner-supplied current rules; **[UPSTREAM]** inspected client/shared mirror in [MOTHblank/pokeidle-upstream](https://github.com/MOTHblank/pokeidle-upstream); **[ADDON]** present implementation in pokeidle-addons; **[DERIVED]** arithmetic/engineering inference with assumptions; **[UNVERIFIED]** needs deployed server or observed, authorized game messages.  
**Important:** this upstream mirror does **not** contain the full authoritative server simulation. Functions referenced by wiki/client such as the ordinary server `chanceCaptura` are not available in the checked files; a client-side formula is not proof that every live server path currently applies it.

Related: [Hunt rewards and rare drops](./HUNT_REWARDS_AND_RARE_LOOT.md), [Pokémon grade/valuation](../market/POKEMON_VALUATION_REFERENCE.md), [Wiki ↔ upstream mechanics map](./POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md).

## 1. Core capture model and its boundaries

[WIKI — Captura] On an ordinary hunt, a Pokémon is fought until defeated; its **fallen body persists for 30 seconds**. A successful capture creates a Pokémon; a **failed throw at a fallen body consumes that body** and, according to the wiki, cannot be retried. A *living* target can persist after a failed throw, but that is a different path. Do not treat every 30-second body as a source of unlimited attempts, and do not conflate kills, targets seen, throw attempts, capture results and captured Pokémon.

- **Per-kill chance** is not necessarily the **per-throw chance**: some bodies expire, some are skipped for inventory/reserve reasons, and the player may not be allowed to throw at a particular target.
- **Per-throw capture success** in an ordinary hunt depends on the species' evolutionary stage (capture-level cap 20/40/100), ball efficiency, target HP and capture bonuses. Outside ordinary hunts, the older value-based formula can still apply.
- **Shiny** is rolled on capture attempt, *before* success, not on wild spawn; rarity/IV/quality/potency of the caught specimen are distinct from capture difficulty and require their own model.
- An ordinary captured Pokémon may be moved to the **Depot** if the five-slot party is full; the Depot is not a failure state.
- An ordinary captured specimen is not automatically marketable: its individual N, P, IVs, Q, level and shiny status matter. See the valuation reference.

### 1.1 Current upstream capture formula (v1.314.2)

The shared game module `shared/captura-degrau.mjs` defines ordinary-hunt factors by the evolutionary stage from `shared/teto-captura.mjs`. A three-stage chain has 20/40/100, a two-stage chain has 40/100, and a Pokémon without evolutions has 100.

```text
fator(20)  = 2.8669   // first of three
fator(40)  = 3.5745   // middle of three, or first of two
fator(100) = 4.4681   // final stage or no evolution
p_raw      = 0.0075 × ballEfficiency / fator × (1.4 − currentHP / maxHP)
p_final    = clamp(p_raw after applicable bonuses, 0.003, 0.10)
```

**Legendary and Mythical special encounters** keep their separate capture contracts; non-hunt species can retain the earlier economic-rarity factor `1 + (log10(max(100,price))-1)^3/17`. Do not substitute specimen sale value, NPC price, or hunt level for the evolutionary stage in ordinary hunts. The model is supported by the game's shared capture-stage module and the supplied current wiki (which describes the same server calculation); exact deployed-server bonus handling remains unverified via accepted live throws.

**Source:** `shared/captura-degrau.mjs`, `shared/teto-captura.mjs`, `shared/evolucoes-ramificadas.mjs`; the last is essential for Eevee, regional branches, and other non-linear evolution chains. The latest native and userscript models construct their stage table once from the public catalogs.

### 1.2 Balls and nominal Coins/throw

[WIKI — Captura and Market] Five capture-ball tiers are:

| Ball ID | Ball | Efficiency | First evolutionary stage, defeated, no boosts | NPC purchase cost | Currency |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Poké Ball | ×1 | ≈0.37% | 5 | Coins |
| 2 | Great Ball | ×2 | ≈0.73% | 20 | Coins |
| 3 | Super Ball | ×3 | ≈1.10% | 50 | Coins |
| 4 | Ultra Ball | ×4 | ≈1.46% | 130 | Coins |
| 5 | Beast Ball | ×8 | ≈2.93% | **not bought for Coins** | Diamonds (shop bundles) |

This table is for an **ordinary hunt's first-stage Pokémon**, before optional modifiers. Middle and final stages are harder. The wiki says Beast gives twice Ultra's base efficiency; once final **10% cap** applies, doubled efficiency does **not necessarily double effective capture probability**.

**[ADDON]** Auto Catch+ reads the game `catalogoBolas` (including `catchRate`, `priceGold` and `compravel`) and has an independent game-WebSocket hook. **Do not invent a Coin price for Beast Ball** from its Diamonds bundle or from a Coin↔Gem market conversion. If the user voluntarily supplies a Diamonds budget, maintain a separate Diamonds-spend column; don't combine it with Coins without an explicit exchange assumption.

### 1.3 Numerical validation examples

With a Beast Ball (efficiency ×8), defeated-body baseline odds are approximately **2.93% / 2.35% / 1.88%** for caps **20 / 40 / 100**. An Ultra Ball (×4) gives approximately **1.46% / 1.17% / 0.94%**. These figures vary if live capture modifiers apply.

Do not use the former economic-rarity examples (0.99% Poké Ball or 7.93% Beast Ball for a price-100 species) as ordinary-hunt forecasts after v1.314.2.

## 2. Multipliers, caps, and non-equivalences

[WIKI — Loja de Diamantes, Bônus na Kick, Captura]

| Modifier | Wiki rule | Result / caveat |
| --- | --- | --- |
| Capture Boost | **×2** capture chance | Respect upper 10% cap |
| Kick “Capture Boost” redemption | **+15% multiplier** for redeemed hour | ×1.15; stacks multiplicatively with Capture Boost: ×2.3 jointly |
| Ball tier | ×1 / ×2 / ×3 / ×4 / ×8 | Applies to the ball efficiency, before final cap |
| HP condition | `1.4 - hpFraction` | On a corpse `hpFraction = 0`; not a bonus from damaging beyond zero |
| Shiny Secret Lure | **×2 shiny appearance roll** | **Does not double ordinary capture success chance** |
| Kick Secret Lure redemption | ×1.15 shiny roll when redeemed | A separate effect from Kick capture multiplier |
| XP / Pokémon XP / VIP / Loot Boost | Each has separate scope | **Do not** apply generic XP or loot bonuses to ordinary capture chance |

[UNVERIFIED] The precise order of lower-bound clamping, bonus application, and per-event rounding on the live server cannot be resolved from the inspected shared mirror. The statement `p = clamp(base * 2 * 1.15, 0.003, 0.10)` is a useful *conditional* idealization, not a proven reproduction of every implementation detail. A runtime `bola.chance` field exists in the addon, but its **units and post-bonus semantics need validation** against the game's display before treating it as a `0..1` probability.

### 2.1 Shiny is **not** an extra ball bonus

[WIKI — Shiny] Outside game exceptions, shiny appearance is **1/24,000 per eligible capture attempt**, or **1/12,000** with Shiny Secret Lure; Kick may further affect that roll. The roll can be revealed on **failed attempts**, too. A shiny *seen* is different from a shiny *successfully captured*.

For eligible attempts, **if** the shiny roll and capture result are independent as described by the wiki:

```text
P(shiny captured on a throw) ≈ P(shiny rolled) * P(capture succeeds)
Expected shiny captures over attempts ≈ Σ p_shiny_i * p_capture_i
```

Do **not** display “1 shiny every 24,000 kills”; the roll is *per eligible throw*, a kill may produce no thrown ball, and there is also the probability of a failed capture. Avoid presenting means as pity guarantees.

**[Source tension]** `sessao-hunt.mjs` in the inspected upstream mirror explicitly declares **no shiny capture rolls in Outland** and hides shiny session slots there, whereas the wiki's global Shiny chapter presents the usual uniform shiny chance without drawing attention to that exclusion. Treat **Outland shiny eligibility as unresolved until the deployed server/client rules are verified**; do not assume the standard 1/24,000 roll applies to Outland.

## 3. Corpses, scheduling, and what counts as an attempt

[WIKI — Combate, Captura] A fallen body lasts **30 seconds** and the ordinary native VIP auto-throw uses **1.2-second minimum spacing**. Its configured ball list chooses the first in-stock selected ball. VIP expiration disables the **native** auto-catch privilege.

**[ADDON — Auto Catch+ current code]** Its **separate userscript** defaults to:
- `enabled: false`, `intervalMs: 100`, and `restock.enabled: false`. The native VIP-auto-throw 1.2-second interval is **not** a tested limit for the userscript's click scheduler; do not claim it performs identically to the game's native automation.
- Targets are discovered from `#caidos-lista .caido[data-slot]` and correlated by `slot` to protocol events. The addon prioritizes targets with the least remaining body lifetime (`.caido-tempo i` width, or `.acabando` fallback). Changed DOM elements representing the same slot start a new lifecycle.
- It listens to `batalha.ev[k='bola']`, correlates `slot`, `sucesso`, `ballId`, `shiny` and an optional `chance`, and deliberately does not count unrelated manual/native captures as its own.
- On an **authoritative `sucesso=false`** event, `handleBallResult` sets `lastResult='failed'` but currently **allows another throw if the same corpse slot remains visible**; likewise `lastResult='pending'` can be retried after a 1-second result timeout. Pending retries can produce more than one in-flight response.
- Its scheduling comments describe sustained target throughput, not a guarantee of accepted server capture actions. The default chosen ball is the **weakest enabled available ball above its reserve**, no escalation.

### 3.1 High-priority **wiki/addon contradiction** to investigate before using probability estimates

**The wiki is explicit: a failed ordinary throw on a fallen Pokémon removes the body, permitting only one attempt per corpse.** The addon explicitly queues a retry following a confirmed failed `bola` event, provided that slot still appears; if that UI row persists because a late message, refused command, reuse of a slot or desynchronization, retries might be appropriate for **failed/unknown transport delivery** but must not be counted as fresh statistically independent capture opportunities from the **same killed Pokémon**.

**Safe documentation-level rule:** keep **four** distinct counters and reconcile to authoritative events:

1. `corpseObserved`: each unique corpse lifecycle.
2. `clickAttempted`: a userscript-origin click/dispatch.
3. `throwAccepted`: authoritative accepted `bola` event with a consumed ball/recorded attempt.
4. `captureSucceeded`: accepted event or authoritative `capturado` success, deduplicated by slot/individual identity.

Do not calculate success rate from `clickAttempted` if server messages are missing. A timeout is **unknown outcome**, not failure or evidence for a free additional ball. Preserve diagnostic difference between an accepted failure that consumes the corpse and a rejected/never-accepted throw. **No addon logic was changed in this documentation pass.**

### 3.2 Throughput ceiling

With `K` observed wild kills/hour, `c` fraction that yield **eligible, non-expired, targetable** corpses, `a` probability the capture scheduler actually makes one accepted throw before the corpse expires, and `p` effective success probability averaged over *accepted* throws:

```text
expectedAcceptedThrowsPerHour <= K * c * a
expectedCapturesPerHour = acceptedThrowsPerHour * p
expectedShiniesSeenPerHour = eligibleAcceptedThrowsPerHour * p_shiny
expectedShiniesCaughtPerHour ≈ eligibleAcceptedThrowsPerHour * p_shiny * p
```

The final expression assumes independent rolls on eligible hunts. If species differ, compute `Σ(acceptedThrowsBySpecies/hour × pCaptureSpecies)`, not `K × averageCaptureChance` with inconsistent weights.

**[DERIVED]** A single-target native cadence of 1.2 seconds implies a theoretical maximum **3,000 scheduled throws/hour** if it were the only limit, but the actual accepted rate can be much lower due to kill supply, corpses, server throttling, inventory, interface, competing actions and downtime. This **does not** assert that the server will accept 3,000 throws/h. The userscript's 100-ms tick is a *poll interval*, **not an accepted throw rate of 36,000/hour**.

## 4. Expected ball consumption, capture yield, and efficiency

For ordinary fallen captures with one accepted attempt per body and constant `p` for the same species/ball:

```text
expectedAcceptedThrowsUntilOneSuccess = 1 / p
expectedConsumedBallsUntilOneSuccess = 1 / p
expectedCoinReplacementCostPerCapture = CoinBallPrice / p
expectedCapturesPer1000Throws = 1000 * p
```

This is **statistical cost at stationary conditions**, not a guarantee, and excludes fighting, potions, revives, restock travel/delay and shiny scarcity. If throws fail to get accepted and **no ball is consumed**, they are not part of the denominator. Use measured **accepted** ball consumption when possible.

**[DERIVED] First of a three-stage evolution chain (cap 20), from the current stage-based ordinary-hunt formula at zero HP (no boosts):**

| Ball | Coins per throw | Catch chance | Mean accepted balls/success | Expected Coins per success |
| --- | ---: | ---: | ---: | ---: |
| Poké | 5 | 0.366% | ~273.0 | ~1,365 |
| Great | 20 | 0.732% | ~136.5 | ~2,730 |
| Super | 50 | 1.099% | ~91.0 | ~4,551 |
| Ultra | 130 | 1.465% | ~68.3 | ~8,874 |
| Beast | **Diamonds** | 2.930% | ~34.1 | **No Coin cost assigned** |

**Interpretation:** more expensive balls generally reduce bodies/throw attempts per captured Pokémon but are not cheapest in Coins per success. For capture scarcity or time-limited targets, throughput can dominate Coins efficiency. It is misleading to say “Ultra is always best” or “Poké is always best” without the player's objective.

**Capture per unit time** also depends on corpse throughput. If a first-stage hunt yields 600 killed targets/hour and all offer an accepted throw, that implies about **2.20 captures/h** with Poké, **4.39/h** with Great, or **8.79/h** with Ultra; Beast would give about **17.58/h**, excluding travel/stock limits. These are math illustrations, **not guaranteed live rates**.

**Do not price a captured specimen as a typical eligible RMT listing.** Each capture creates a distinct draw of potency/quality/IV/shiny; N/market eligibility cannot be pre-known. At most, estimate *NPC resale* with a distribution of quality and captured level, while keeping individual high-value outcomes distinct.

## 5. Captured level and trainer access

**[UPSTREAM]** [`shared/teto-captura.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/teto-captura.mjs) implements the post-capture level ceiling:

```text
if wildLevel <= 100: capturedLevel = wildLevel
else: capturedLevel = min(wildLevel, speciesEvolutionStageCap)
```

- Three-stage line: **20 → 40 → 100**.
- Two-stage line: **40 → 100**.
- No evolution/standalone: **100**.
- The file defines a future-compatible four-stage ladder **20 → 40 → 70 → 100** (current catalog claims no ordinary chain of four).
- It computes chain depth across cross-generational/branched evolution (e.g., Eevee) and aligns eligible evolution levels with the relevant destination ceiling.
- **Outland variants do not evolve**; avoid inferring a national species' evolution chain from a variant's display name.

Captured Pokémon *still fight at the wild hunt level before capture*; a level-3,500 Torterra can arrive in the collection at **level 100**. That affects post-capture NPC value, RMT training desirability and inventory planning, **not** the kill's original XP/gold or capture rarity.

[UPSTREAM] `shared/pokemon-nivel-treinador.mjs` permits a non-starter Pokémon to fight only up to **trainer level + 5**, with starter exception; `shared/reduzir-nivel.mjs` covers intentionally lowering levels subject to species floors. Hunt Atlas should not recommend a purchased/caught Pokémon as an immediately usable lead solely because its level is high.

## 6. Normal versus Mystic Arena: explicitly different probabilities

**[UPSTREAM]** [`shared/mistico.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/mistico.mjs) supplies an *actual exact shared probability table* for the **Mystic Arena**, **not the normal hunt**:

| Ball ID | Mystic capture probability per throw |
| ---: | ---: |
| 1 Poké | 0.1% |
| 2 Great | 0.2% |
| 3 Super | 0.3% |
| 4 Ultra | 0.4% |
| 5 Beast | 0.5% |

`chanceCapturaMistica(ballId, multCaptura=1)` uses `min(1, base * max(1, multCaptura))`. Thus the code's **Capture Boost ×2** example makes Beast **1%** per attempt. There is **one attempt per ticket** following a boss victory, not a normal species-price-based chance. The species pool is constructed from eligible sprite-backed Legendary/Mythical Pokémon, with fixed capture level 100.

**Special idle safeguard:** `MISTICO_ESCOLHA_MS = 25_000` allows choice of ball before the **server auto-chooses the strongest available after 25 seconds**; this is shorter than the normal 30-second body lifetime. **Do not let ordinary Auto Catch target logic assume that waiting forever is safe in Mystic Arena, or that the same ordinary formula applies.** Verify whether the ordinary UI target list is even used there before trying to integrate.

**Confirmed source discrepancy:** the owner's current wiki says Mystic captured birth floors Q≥1.2, total IV≥120 and P≥2, while inspected `shared/mistico.mjs` exports **Q≥1.5, IV total≥150 and P≥3**. These are **birth-quality floors, not capture chances**. Confirm deployed version; neither figure should be silently substituted into capture probability formulas.

## 7. Healing and revive economics

**[WIKI — Desmaiar e curar]** Potions and Revives cost Coins at the NPC. Poisons/HP mechanics differ from sale drops; the NPC does **not buy back** unused shop consumables, so they represent real outflow/opportunity cost.

| Item ID | Item | Effect | NPC buy price, Coins |
| ---: | --- | --- | ---: |
| 200 | Small Potion | +60 HP | 50 |
| 201 | Great Potion | +150 HP | 150 |
| 202 | Ultra Potion | +400 HP | 400 |
| 203 | Hyper Potion | +1,000 HP | 800 |
| 204 | Ultimate Potion | +3,000 HP | 1,500 |
| **[verify ID]** | Golden Potion | Restore 50% maximum HP | 2,500 |
| 205 | Revive | Revive with **10% max HP** | 600 |
| 206 | Max Revive | Revive with **100% max HP** | 5,000 |

**[UPSTREAM]** `assets/items.json` contains ordinary potion IDs **200–204**, revive IDs **205–206**, but raw mirror data is **not the final source for every price/effect**. In particular raw `Max Revive` has `npcPrice=2500` and raw `Revive` has `revivePct=0.5`; [`shared/ajuste-item-espelho.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/ajuste-item-espelho.mjs) **explicitly overrides** those to **5,000 Coins** and **10% HP** respectively. Another `priceGold` field on raw item records contains smaller legacy values and should not overwrite the normalized `npcPrice`/runtime `preco` shop purchase cost. This is a **real data-precedence hazard for restock cost estimation**.

**[UNVERIFIED ID]** The Golden Potion comes from additional runtime/catalog adjustments; don't invent a numeric ID based on adjacent item IDs until an authoritative catalog or runtime shop payload provides it.

### 7.1 HP restored per Coin is context-dependent

For a `maxHp` target with `missingHp`:

```text
effectiveHealingFixed = min(missingHp, fixedHpRestore)
effectiveHealingGolden = min(missingHp, 0.5 * maxHp)
healingEfficiency = effectiveHealing / CoinsPrice
```

**[DERIVED]** Without overheal, the 3,000-HP Ultimate Potion provides **2 HP/Coin**; the 60-HP Small Potion provides **1.2 HP/Coin**. Hyper = **1.25 HP/Coin**, Great = **1**, Ultra = **1**. Golden heals 50% of max HP so its value depends on the Pokémon's max HP and how much is missing. A potion that heals 3,000 when 40 HP are missing wastes most of its nominal value. Likewise a Max Revive can beat Revive + several potions when max HP and incoming damage are high, **but not universally**.

**[WIKI — Automations]** Native potion automation supports **10%–100% HP threshold in 10% steps**, default 30%, and revive ordering by selected item. Auto Catch+ currently automates **capture and restocking**, not these native healing combat decisions.

### 7.2 Death spiral / XP loss

If the party falls, the player returns to Pokémon Center, where Nurse Joy heals for free but **does not reset move cooldowns**. The wiki describes **loss of 10% of the trainer's current-level XP on normal hunt knockout**, waived with active Catch-up Boost. Clicking leave-hunt voluntarily is a different event; abruptly leaving the active game during a battle also has a documented penalty in the wiki.

**[WIKI — Automações]** The game's native return-to-hunt automation normally pauses if no **Potion or Revive** is available, to prevent repeated deaths/XP loss. No inventory is not permission to keep re-entering unsafe hunts.

**Resource model:** include **death frequency/h**, **recovery downtime**, **Revive versus Max Revive cost**, and **trainer XP lost/h** separately. Do not hide the XP loss inside Coins cost or recommend farming based only on maximum XP/kill.

## 8. Safe replenishment and inventory budgets

**[ADDON — current Auto Catch+ settings and behavior]**

```text
Auto Catch+ enabled                 false by default
Capture tick interval              100 ms default; idle polling ~250 ms
Auto-restock enabled               false by default
Ball low-stock / refill target     50 / 500 (Poké Ball ID 1)
Potion low-stock / refill target   10 / 50 (Small Potion ID 200)
Revive low-stock / refill target   1 / 5 (none selected by default)
Gold reserve                       0 by default (configurable)
Max quantity in an individual buy  5,000
Only one purchase in flight
Purchase confirmation timeout      10 s
Post-confirm inventory settling    2 s
Retry delay (1st / 2nd)            2 s / 4 s
After third timeout                30 s cooldown
```

Separate ball, potion and revive restock selectors are intentional. A **null selected revive** means *no revive restock*, even if the category displays a nominal 1→5 threshold; don't claim revives are replenished automatically without a chosen shop item and enabled restock.

**Mechanism:** the addon observes `welcome.catalogoBolas`, `welcome.itensCompraveis`, `estado.balls`, `estado.items`, `estado.gold`, and `batalha.ev[k='compra']`, with `items.json`/bridge snapshot as fallback. It sends the game's native `shop.buy` packet, with `kind='ball'|'item'`, the selected ID and quantity. **This is the present code's behavior, not an invented server API contract**.

Purchases should only be attempted when the authoritative game socket, priced catalog and gold snapshot are available; confirmation/event or inventory changes must reconcile the pending purchase before new spend decisions. The addon currently reserves pending spend and subtracts configured `goldReserve`:

```text
availableGold = max(0, serverGold - goldReserve - pendingRestockSpend)
affordableQty = floor(availableGold / verifiedShopPrice)
wantedQty = min(5000, refillTarget - inventoryCount)
requestQty = clamp(min(affordableQty,wantedQty), 0, ...)
```

**Safeguards worth preserving when engineering new consumers:** item IDs rather than partial names, only actually NPC-purchasable items, separation of the three categories, a unique pending order per selected SKU, authoritative acknowledgement, timeout/backoff, no duplicate spending during stale-state settlement and explicitly bounded purchases. Check server responses before claiming success; a sent request is not a confirmed buy.

**Potential mismatch:** `mergeItemCatalog` prefers `preco ?? npcPrice ?? priceGold`, which is correct if the normalized purchase price is available. But a partial/fallback catalog that contains only the raw smaller `priceGold` could lead to *budget/affordability estimates below the actual cost*. Require or display **price provenance** and confirm against the runtime `compra.gasto` / gold delta before relying on prices. Prefer explicit unknown over unsafe assumptions.

**Another review candidate:** the addon's historical settings use key names `master` / `other`, while the live catalog labels ball ID 5 **Beast Ball**. Test catalog `key` assignment and UI categorization rather than assuming the “master” key always means Beast; this note does **not** assert that the current visible button is broken.

## 9. Sustainable resource cost and restock planning

For `T` minutes of **continuous observed farming** and per-item `usedQty`, define:

```text
usagePerHour[item] = (consumedSinceStart[item] / measuredSessionHours)
hoursToExhaust[item] = max(0, inStock[item] - reserve[item]) / usagePerHour[item]
replacementCostCoinsPerHour = Σ(usagePerHour[pricedConsumable] × verifiedNpcBuyPrice)
expectedRefillCost = Σ(max(0,targetStock-currentStock) × verifiedNpcBuyPrice)
```

Caveats:
- **Consumption** is not the same event as **buying**; replacing supplies later should not be charged a second time to the same economic ledger.
- Be explicit whether your “session profit” is **actual Coins balance change** or **replacement-cost-adjusted** income; the latter charges the economic cost of consuming previously purchased inventory.
- Include **restock interruptions** and uncertain polling/connection gaps separately; insufficient supplies may reduce accepted throws/h, captures/h and XP/h.
- Reserve Coins for potions/revives if losing hunting uptime matters more than all-possible Poké Balls.
- The 5,000 unit limit is **per addon purchase command**, not proof of the server's total inventory cap.
- Dynamic price source: raw `items.json` contains **`priceGold` values that differ from `npcPrice`** on potions and revives. For item purchases, the correct running game source is the **normalized NPC price**.

## 10. Use the game's native session ledger instead of guessing costs

**[UPSTREAM]** [`sessao-hunt.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/sessao-hunt.mjs) gives a clean, event-based accounting reference:

| Incoming `batalha.ev` kind | Data | Ledger |
| --- | --- | --- |
| `morte` with `quem='selvagem'` | `xpTreinador, xpPokemon, ouro, ouroVendaAuto, drops` | XP, kills, total Coins from defeat plus auto NPC resale, rare drops |
| `bola` | `ballId, shiny` | **One ball consumed per event**, shiny seen |
| `capturado` | `pokemon.shiny` | One confirmed capture, shiny caught |
| `cura` | `itemId` | One potion consumed |
| `revive` | `itemId` | One revive consumed |
| `bossMorto` | boss reward fields and drops | Boss rewards, **not ordinary wild kills** |

The native `GASTOS_SESSAO=['bolas','pocoes','revives']` stores a **count by exact item ID**. `custosDaSessao()` calculates **replacement cost** from the current purchase catalog; for unknown-price items like Beast Balls it adds **0 to the Coin total** rather than inventing a Coin price. That zero **means 'not counted in Coins'**, not 'free'. Native `sessao.gold` explicitly includes `ouroVendaAuto`; adding expected NPC loot again would double-count it.

The ledger is **client-local**, persisted with paused time excluded when the game is closed; unknown/missing/disconnected event intervals can produce incomplete totals. `porHora()` and `ritmoDaSessao()` clamp the measurement denominator to at least **60 seconds**.

**[ADDON]** Auto Catch+ also reports its own attempts, captures, `stats.used` (inferred from visible inventory decreases), and confirmed restock orders. Its `stats.used` can include unrelated/manual/native inventory consumption if the same UI count falls, while its `stats.attempts` is click-origin. These are **not automatically equivalent** to accepted `bola` event counts. To avoid double accounting, source the authoritative per-ID item consumption *once* from the native event ledger (or a semantically equivalent single observer) and tag any secondary inference as diagnostic.

**Do not repeatedly poll the game for this data.** The existing WebSocket events already encode it, and the Controller/Auto Catch+ target long-running low-resource operation.

## 11. Choosing balls: three different objectives

A future informational comparison can legitimately offer *different recommendations depending on the goal*, without modifying auto-buy defaults.

### Lowest Coins per successful ordinary capture

Rank finite-Coin balls by `npcPrice(ball)/p_capture(ball,species,boosts)` (smaller is better), also accounting for time lost due to low success. The cheapest ball often wins **Coin efficiency**, but not necessarily **captures/hour**.

### Most successful captures per hour

Rank by `acceptedThrowOpportunityRate × p_capture`, where opportunities depend on kills/hour, corpse lifetime, current in-stock and action cadence. This can favor Ultra/Beast on rare hunt targets or when fewer bodies can be reached. Account for each ball's separate currency.

### Highest expected economic value, especially shiny/rare hunting

Estimate:

```text
expectedCaptureAssetsBySpecies/h = acceptedThrowsBySpecies/h * p_capture
expectedShinyCaptures/h ≈ Σ eligibleAcceptedThrowsBySpecies/h * p_capture * p_shiny
expectedCoinConsumableCost/h = Σ ballsUsedById/h * npcCoinPrice[ballId]
                             + Σ healingUsedById/h * npcCoinPrice[healId]
```

Never convert expected Pokémon captures into a single RMT “ideal price” without the **specimen's unknown score/P/IV/Q distribution** and **actual comparable sold prices**. The [Pokémon valuation reference](../market/POKEMON_VALUATION_REFERENCE.md) explains why even two N=4.0 Pokémon of the same species can have very different buyer demand.

**Hunt Atlas integration:** compare hunts by capture opportunities/h, expected captured Pokémon/h, estimated ball cost/h, and *expected* viable farmed specimens. Show **measured versus modeled**, probability provenance and missing inputs; avoid using mean kill speed and a flat capture chance across mixed species.

## 12. One-click purchase versus native automatic restoration

The wiki's built-in **native** revive, potion and return-to-hunt automations are separate from Auto Catch+'s ability to **purchase supplies**. Built-in healing may already be enabled for a new account by default, but the addon's *restock and capture* functions still default to **off**.

| Function | Native game (wiki) | Auto Catch+ (inspected addon) |
| --- | --- | --- |
| Auto-throw on fallen target | VIP-only; 1.2s cadence; user-selected ball order | Independent disabled-by-default userscript, target/ball scheduling; UI/protocol observation |
| Use potions in battle | HP-threshold selection (default 30%) | **Does not replace** native potion-use automation |
| Revive in battle | Revive types/ordering; 10% vs 100% HP | **Does not replace** native revive-use automation |
| Return to previous hunt on full party defeat | Native recovery, pauses without healing items | Does not claim to override native recovery safety |
| Buy balls/potions/revives | User can buy in NPC Market | Opt-in `shop.buy` restock with selected item, low/high thresholds and gold reserve |

A game account can have **native healing active, Auto Catch+ capture off, and addon restock off**, or other combinations. State each toggle distinctly; don't imply buying more revives makes them automatically used when the game's *revive-use* automation is off.

## 13. Testing / validation checklist for implementation

1. **Ordinary hunt** at corpse HP=0: evolutionary cap **20** yields approximately **0.366% / 0.732% / 1.099% / 1.465% / 2.930%** for Poké / Great / Super / Ultra / Beast. Evolutionary cap **40** yields **1.17% Ultra / 2.35% Beast**; cap **100** yields **0.94% Ultra / 1.88% Beast**. No species price or wild hunt level belongs in this ordinary-hunt formula.
2. The 10% cap can cause **Beast+Capture Boost** to be less than exactly twice its pre-boost effective probability.
3. Separate **shiny rolled**, **capture succeeded**, and **shiny caught**. A failed shiny roll still counts as seen, not captured.
4. For confirmed successful and failed `bola` events, use actual ball consumption; exclude clicks rejected by server from accepted-attempt statistics.
5. Inspect the **accepted failure → corpse disappears** path vs **timeout/retry while still visible** path; verify no two accepted throws can consume the same corpse lifecycle, or document a confirmed server exception if found.
6. When 30-second corpse expires, stop retrying; if the same slot is reused by a different DOM element/target, create a new lifecycle.
7. Multiple fallen bodies at once: earliest deadline is prioritized, but per-source target identity is never confused.
8. Captured levels: below/equal 100 unchanged, above 100 apply **20/40/100** chain cap; do not use hunt level as captured level.
9. Mystic Arena: **0.1%–0.5%** ball table, one ticket/attempt and **25-second** forced strongest-ball selection; never apply regular economic-rarity formula.
10. Healing catalog regression: `Revive(id205)` restores **10%**, `Max Revive(id206)` costs **5,000 Coins** and restores **100%**, even if raw `items.json` differs.
11. Budget: `available = gold - reserve - pending`; no repeat order during 2-second settle; timeout causes backoff, no false success.
12. Revives remain independently selectable for restock; with `selectedReviveId = null`, they are **not** auto-bought.
13. Test a held item with missing/zero price: unknown price is **not** treated as free NPC sell value or budget-safe buy value.
14. Native session `morte.ouroVendaAuto` must be counted **once**. Item consumption replacement costs must not be double-charged on both use and purchase.
15. Use five party slots and an unlimited Depot consistently in captures; the sixth caught Pokémon is **not** a failed capture merely because the party is full.
16. Use actual observed `bola.chance` units only after verifying whether the packet value is fractional or percent and whether it includes current buffs.
17. Outland shiny source conflict is visibly marked until resolved; don't infer that every kill yields a chance for shiny.
18. Maintain low resource use: no additional high-rate polls, unnecessary catalog downloads or new persistent raw player data.

## 14. Implementation handoff: minimal data contract (proposal, **not** an existing packet)

```ts
type CaptureEstimate = {
  speciesId: number;
  huntId: string;
  wildLevel: number | null;
  capturedLevel: number | null;
  npcRarityValue: number | null;    // normalized economic value, not specimen sale price
  ballId: number;
  ballEfficiency: number;
  ballCurrency: 'coin' | 'diamond' | 'unknown';
  unitPrice: number | null;
  chancePerAcceptedThrow: number | null;   // probability fraction [0, 1]
  chanceSource: 'wiki-formula' | 'client-calculator' | 'observed-server' | 'unknown';
  bonusSource: 'runtime-state' | 'wiki-assumption' | 'unknown';
  corpseLifetimeSeconds: number | null;
  throwAcceptanceRatePerHour: number | null;
  acceptedThrowCount: number | null;
  observedCaptureCount: number | null;
  expectedCapturesPerHour: number | null;
  expectedCoinBallCostPerCapture: number | null; // null for Diamond-priced balls
  potionCostCoinsPerHour: number | null;
  reviveCostCoinsPerHour: number | null;
  warnings: string[];
};
```

**Do not expose null as 0**, do not conflate accepted throw with click, and do not mix per-attempt statistics with per-kill or per-boss-victory events. For long sessions prefer existing game event messages and amortized calculations, with clear measurement windows and stale-data information rather than a constantly changing warning banner.

## 15. Sources and outstanding questions

| Question | What the inspected sources establish | Gap / action |
| --- | --- | --- |
| Ordinary capture formula | **Wiki** gives explicit price/HP/ball formula; `pokedex-gpt.mjs` says client supplies corresponding calculated chance | Full server `chanceCaptura` absent from checked mirror; validate normalized rarity input, cap order and rounding |
| Normal failed corpse | **Wiki**: one throw, body disappears; **Auto Catch+**: allows retry if failed slot persists | High-priority behavioral/protocol review before assuming more than one accepted throw |
| Ordinary server throw cadence | Wiki's **native VIP auto** interval is 1.2 s; addon ticks at 100 ms when active | Server action throttle and userscript accepted maximum need live verification |
| Shiny Outland | Upstream `sessao-hunt.mjs` source comment/classification disallows shiny rolls there; wiki Shiny chapter gives general chance | Resolve deployed rules; do not apply regular shiny predictions to Outland without proof |
| Shop item price | Wiki and `ajuste-item-espelho.mjs` agree on 5,000 Coin Max Revive and 10% HP Revive | Raw item `priceGold` is not reliable purchase-price authority; validate live catalog |
| Golden Potion ID | Wiki effect +50% maximum HP, 2,500 Coins | Source ID not established here, defer to live item catalog |
| Actual capture inventory/recovery | `sessao-hunt.mjs` details event types and local ledger, addon observes `batalha.ev` | Correlate live events to exact action acceptance, item consumption and restock receipts |
| Special Mystic Arena | `shared/mistico.mjs` exports explicit probabilities, 25s forced ball selection | Confirm whether addon may see/interact with this target UI; never infer |
| Wild/shiny roll timing | Wiki says shiny rolled on attempt, not on kill/spawn | Verify server-side Outland exclusions and whether other event classes skip shiny |
| XP lost after defeat | Wiki: 10% of trainer XP within current level, except Catch-up Boost | Full server death/reconnect handling not available in checked mirror |
| Profitability | Upstream session ledger tracks shop replacement cost and auto NPC sale inside kill gold | Reconcile source fields; compare separately to [hunt reward economics](./HUNT_REWARDS_AND_RARE_LOOT.md) |

**Bottom line:** model capture as a *costed, time-limited, probabilistic outcome of one accepted throw at an eligible corpse*, not as a guaranteed reward per kill. Keep the rare shiny roll, capture success, NPC resale, consumables and server-confirmed actions separate. When game/server and addon's apparent behavior differ, document and instrument the disagreement before changing a purchase or capture algorithm.
