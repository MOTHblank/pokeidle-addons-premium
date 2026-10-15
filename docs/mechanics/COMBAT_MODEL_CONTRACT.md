# Combat model contract — moves, cooldowns, type effectiveness and hunt throughput

> **Implementation-focused reference for Hunt Atlas**, from the owner's PokéIdle wiki, the inspected `MOTHblank/pokeidle-upstream` shared/client source and the current [Hunt Atlas userscript](https://github.com/MOTHblank/pokeidle-addons/blob/master/addons/hunt-atlas.user.js). The goal is a combat estimator that does not confuse theoretical damage, real hit events, move readiness, area attacks, player survival and XP/hour.
>
> **Scope:** reference/documentation only. This does not alter combat, Hunt Atlas, automation, market operations or the Controller.

**Reviewed:** 2026-10-12  
**Evidence labels:** **[WIKI]** user-provided current-game wiki; **[UPSTREAM]** checked source implementation; **[ADDON]** inspected userscript implementation; **[DERIVED]** clearly conditioned calculation; **[UNVERIFIED]** needs the missing game server source or live observed behavior.  
**Limit:** `pokeidle-upstream` contains important client/shared modules but **not the full server combat simulator** referenced in source comments (e.g. `server/game/combate.mjs`). Shared formulas are useful, but do not prove all server scheduling, rounding, AI, damage or event behavior.

Related references: [Wiki ↔ upstream mechanics map](./POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md), [Hunt rewards and rare-drop economy](./HUNT_REWARDS_AND_RARE_LOOT.md), [Pokémon valuation](./POKEMON_VALUATION_REFERENCE.md).

## 1. Ground truth, computation order and units

The most useful separation for any combat estimate:

| Layer | Primary source | What it can answer | What it cannot establish alone |
| --- | --- | --- | --- |
| Individual Pokémon stats, move set, equipped TM/AoE | Live game state + normalized species catalog | Player's attack/defense values, learned moves, equipment | Actual opponent response, target location |
| Elemental type chart | Live `tabelaTipos` when available; [`shared/tipo-efetividade.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tipo-efetividade.mjs) | Per-move type multiplier for one/two defender types | Whether a move is currently usable |
| Hunt-only amplified matchup | [`hunt-analyser.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/hunt-analyser.mjs) | Explicit nonlinear multiplier mapping | Whether other combat modes use it |
| Attack power, category, cooldown | Post-transform runtime species `attacks` + [`shared/cooldown-golpes.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/cooldown-golpes.mjs) | Expected attack strength and reload | Which move the live AI chooses at a given instant |
| Actual hit/cast/death events | Live `batalha.ev` and combat state | Observed damage, kills, target HP and cadence | Unseen casts if payload lacks a stable cast identifier |
| Hunt performance | Measured kills/hour plus measured XP/kill | XP/h and drop opportunity rate | Market value or capture success (different models) |

**Source precedence:** authoritative live game state and observed accepted events first; transformed in-game catalog next; shared pure functions for deterministic missing inputs; dated static indexes only as references; unverified wiki formula or heuristic only with an explicit provenance label. For comparable hunting recommendations, display **measured** vs **modeled** rather than representing a cold-start assumption as exact.

**Never substitute** Pokémon grade `N`, ranking power `⚔`, species quality score or NPC sale price for combat **ATK/DEF/Sp.Atk/Sp.Def**, the attack `power`, or observed DPS. The grade is a normalized within-species valuation reference, not a server damage multiplier.

## 2. Damage equation, physical/special categories and randomness

**[WIKI — Combate → O dano]** The documented basic formula is:

```text
baseDamage = ((2 * attackerLevel / 5 + 2) * movePower * attackStat / defenseStat) / 50 + 2
damageBeforeServerIntegerHandling =
    baseDamage * STAB * effectivenessInContext * randomMultiplier
randomMultiplier ∈ [0.85, 1.00]
```

- **`PHYSICAL`:** use the attacker's **ATK** divided by defender's **DEF**.
- **`SPECIAL`:** use the attacker's **Sp.Atk** divided by defender's **Sp.Def**.
- **STAB:** **×1.5** when the *move type* is one of the attacking Pokémon's current elemental types, otherwise ×1.
- **Effectiveness:** computed for *the move's type*, against both defender types, then amplified when the context is an ordinary hunt.
- **Randomness:** wiki range **0.85–1.00**. Its distribution (continuous/discrete), intermediate floors, minimum-damage guards, immunity path and actual server integer rounding were **not verified** in the checked shared mirror. Preserve a range instead of promising a single exact hit number.
- **Attacker level:** the Pokémon's actual current fighting level, not the hunter's trainer level, not `hunt.nivel` and not the captured specimen's post-capture ceiling.

**[DERIVED example]** level 100, physical 90-power move, ATK 200 against DEF 100, STAB, and hunt-amplified effectiveness ×2.5: base = **153.2**, pre-random final = **574.5**, expected **illustrative** damage interval **488.325–574.5** *before server rounding*. With an immunity (×0), this calculation yields zero — don't use a minimum-damage fallback to turn immunity into positive damage.

### Wild modifiers and survival

**[WIKI — O selvagem joga com vantagem]** Ordinary wild Pokémon receive **×5 HP** and deal **×1.8 damage per attack** relative to the base encounter design. The wiki also reports nominal global attack floors: player's **0.9 seconds**, enemy's **1.4 seconds**, subject to the separate Speed IV adjustments for the player. **[UNVERIFIED]** The exact insertion point of these modifiers in server calculation and all status/critical exceptions is absent from the checked shared source. In particular, don't multiply every already-observed `maxHp` by five again: observed HP is already the effective runtime value.

**Model implication:** a damage-only rank can recommend suicidal hunts. Include **enemy hits before kill**, potions/revives spent, death downtime and trainer-XP loss in any "sustainable farming" comparison, using actual events when possible.

## 3. Type chart: double types, diagonal exceptions and hunt amplification

**[UPSTREAM]** [`shared/tipo-efetividade.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tipo-efetividade.mjs) implements `multAtaqueContraDefesa(atq,def,linha)` and `efetividade(atq,def1,def2,tabela)`. The game mirror's stored elemental table omits some same-type diagonal cells **intentionally**, so missing does **not** universally mean neutral.

For one defender type:

```text
if attackerType == defenderType:
    if explicit chart cell exists: use its value
    else if type ∈ {GHOST, DRAGON}: 2
    else if type ∈ {NORMAL, GROUND, FLYING}: 1
    else: 0.5
else:
    use chart[attackerType][defenderType] if present, otherwise 1
```

For two **different** defending types, **multiply** those two single-type factors. If the second type is absent or identical to the first, calculate only once. Immunity `0 × anything = 0`. Use the game's 18 canonical uppercase identifiers: `NORMAL`, `FIRE`, `WATER`, `GRASS`, `ELECTRIC`, `ICE`, `FIGHTING`, `POISON`, `GROUND`, `FLYING`, `PSYCHIC`, `BUG`, `ROCK`, `GHOST`, `DRAGON`, `DARK`, `STEEL`, `FAIRY`.

**Examples [WIKI/UPSTREAM]:**
- WATER move against ROCK/GROUND: **2 × 2 = 4** raw multiplier.
- FIRE against WATER: **0.5** raw.
- Ground move against FLYING: **0** raw; adding another defending type cannot remove immunity.
- GHOST against itself and DRAGON against itself: use the special diagonal **2**, not generic missing-cell 1.
- FIRE against FIRE where the explicit diagonal cell is omitted: use **0.5**; NORMAL against NORMAL has special neutral **1**.

**[UPSTREAM]** The hunt-specific wrapper `efetividadeHunt()` applies `amplificarHunt(raw, 1.5)` **after** multiplying the defender's two types:

```js
function amplificarHunt(raw, factor = 1.5) {
  if (raw === 0 || raw === 1) return raw;
  return raw > 1
    ? 1 + (raw - 1) * factor
    : raw / factor;
}
```

| Raw effectiveness | On ordinary hunt |
| ---: | ---: |
| ×0 | ×0 |
| ×0.25 | ×0.166666… |
| ×0.5 | ×0.333333… |
| ×1 | ×1 |
| ×2 | ×2.5 |
| ×4 | ×5.5 |

**Do not amplify each defending type separately and then multiply.** For instance a raw 4× double weakness gives **5.5×** rather than `2.5×2.5 = 6.25×`. The amplification applies to the **final raw factor**, in both attacking and defending directions of an ordinary hunt. It should **not** be blindly applied to PvP, boss arenas, guild wars and competitions without inspecting their distinct combat rules.

**[ADDON]** Hunt Atlas has both a simple `weaknessMultiplier()` using chart entries with a `?? 1` fallback **and** an improved `typeMultiplierExact()` / `exactEffectiveness()` / `huntEffectiveness()` path that reproduces the same-type exceptions and post-product amplification. For any calculation used to predict damage, **use the exact path**, or centralize both so display filters and combat predictions cannot silently disagree on same-type interactions.

## 4. Move catalog, normalization and final-evolution signatures

**[UPSTREAM]** The practical move fields are `name`, `type`, `category` (`PHYSICAL`/`SPECIAL`), `power`, `cooldownMs`, `learnLevel`, plus special flags `categoriaFixa`, `cdFixo`, `golpeMega` and `tmElemental` when applicable. A move's *name alone is not an identity* when species-specific balancing and category overrides exist.

The move sources form **a pipeline**, not a universal one-file lookup:

- Species/attack data in `assets/creatures.json`, `assets/creatures-novos.json`, `assets/creatures-outland-novos.json`, audit overrides and runtime catalog merges.
- [`shared/golpes-planilhas.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/golpes-planilhas.mjs) applies species-specific rework tables, sometimes replacing the full moveset. Spreadsheet rows set `name`, `type`, `category`, `power` and can lock move category; the converted `learnLevel` may be **1**.
- [`shared/golpes-especiais.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/golpes-especiais.mjs) injects up to **two 600-power signature moves** for an eligible final evolution: one of each type for dual-type Pokémon; two of the same type for single-type. Their category generally tracks the species' stronger attack side, **except category-locked spreadsheet moves**. It also has reserve names to avoid colliding with a lower-power same-name move: cooldown is keyed by **move name** in parts of the simulator.
- [`shared/megas.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/megas.mjs) builds Mega species with their own base stats and possibly **changed types/moveset**. Mega moves have a separate 600-power/30-second exception.
- [`shared/cooldown-golpes.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/cooldown-golpes.mjs) normalizes ordinary move power/cooldown and exempts flagged fixed-CD special cases.

**Catalog caution:** `assets/index/moves-index.json` in the inspected mirror declares `gerado: 2026-08-21T19:51:12.909Z` and is keyed as `porAtaque`, whose entries include `nome`, `tipo`, `categoria`, `power`, `cooldownMs`, `aprendidoPor`, `powerMin`, `powerMax`. Later source files contain **September/October 2026 reworks**. Therefore the static moves index is valuable for **names, reverse learnsets, initial references and diagnostics**, **not automatically authoritative for a live Pokémon's current damage, cooldown or category**. `powerMin/powerMax` already show that a single named move can vary by species.

**Compatibility rule:** if `welcome`/live player state provides actual active move definitions, prefer them; otherwise load or reproduce the documented transformations in the correct order. Do not infer a move's physical/special category from its elemental type, its name, the old index alone or a generic Pokémon database.

## 5. Cooldown-by-power curve — exact shared implementation

**[UPSTREAM]** `cooldownDoPoder(power)` in `shared/cooldown-golpes.mjs` normalizes all ordinary attack powers below 15 to **15**, and uses two straight-line segments with 0.1-second rounding:

```text
p = max(15, finite(power) ? power : 15)
if p <= 100: seconds = 10 + (p - 15) * (20 / 85)
if p > 100:  seconds = 30 + (p - 100) * (30 / 500)
cooldownMs = round(seconds * 10) * 100
```

| Power | Cooldown from shared function |
| ---: | ---: |
| 15 | 10.0 s |
| 40 | 15.9 s |
| 60 | 20.6 s |
| 80 | 25.3 s |
| 100 | 30.0 s |
| 120 | 31.2 s |
| 150 | 33.0 s |
| 300 | 42.0 s |
| 600 | 60.0 s |

**Important exceptions:**

- **Mega signature**: `COOLDOWN_MEGA_MS = 30000` (600 power, **30 s**), flagged `cdFixo: true` and `golpeMega: true`. A normal `cooldownDoPoder(600)` would incorrectly overwrite it to **60 s**.
- **Elemental TM**: [`shared/tm-elemental.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tm-elemental.mjs) explicitly defines **2800 power / 60000 ms cooldown**, **not** the ordinary power-based extrapolation (which would be **192 s**), even though the same 60-second move cooldown may receive Speed-based discount. Use the **real move's cooldownMs** and its special identity rather than deriving this cooldown from power. `tmElemental: true`.
- Certain reworked species have explicitly category-locked moves, and the Mega's 600-power mark overrides the generic rewriter. **Rerunning the cooldown normalization over a final live moveset without respecting flags destroys these exceptions.**

A normal high-power move is not necessarily a better damage-per-time choice solely because `power` is larger: STAB, physical/special matchup, opponent defenses, cooldown readiness, target lifetime, AoE and global attack spacing all change the realized yield.

## 6. Speed: two DIFFERENT timing rules

**[UPSTREAM]** `shared/cooldown-golpes.mjs` implements percentage reduction on **skill/ultimate cooldowns**, based on the **species' base Speed** and the **individual Speed IV**, not the Pokémon's large final displayed SPD stat.

```text
baseSpeed = max(0, species.baseSpeed)
potentialPct =
    baseSpeed <= 120
      ? baseSpeed / 20
      : 6 + (baseSpeed - 120) / 40
potentialPct = min(7, potentialPct)
speedIvNormalized = clamp(round(speedIV || 1), 1, 32)
discountPct = potentialPct * (speedIvNormalized / 32)
effectiveMoveCooldownMs = round(baseMoveCooldownMs * (1 - discountPct/100))
```

| Example | Base Speed | Speed IV | Potential at IV32 | Actual reduction | 60s skill cooldown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Snorlax | 30 | 32 | 1.5% | 1.5% | 59.1 s |
| Jolteon | 130 | 16 | 6.25% | 3.125% | 58.125 s |
| Jolteon | 130 | 24 | 6.25% | 4.6875% | 57.188 s (≈57.2) |
| Ninjask | 160 | 32 | 7% | 7% | 55.8 s |
| Regieleki | 200 | 32 | capped 7% | 7% | 55.8 s |

**[WIKI] The BASIC attack and global interval have a different, fixed Speed IV discount:** **10 milliseconds per IV point** (up to 320 ms with IV32) rather than the species-Speed percent. The ordinary **Investida** has **2,000 ms** base → **1,680 ms** at IV32; the player's normal **900-ms global attack interval** becomes **580 ms** at IV32, with a minimum floor of **400 ms**. These interval rules are described as residing in unavailable `server/game/combate.mjs`, not exported by `shared/cooldown-golpes.mjs`. **[UNVERIFIED]** Intermediate ordering, readiness relative to the global interval, and behavior across different simulated combat modes require server/live checking.

**Do not:**
- Apply the 7% species-Speed cooldown reduction **again** to a skill `cooldownMs` already discounted by the game.
- Treat the 10 ms per IV as 10 ms per unit of **displayed Speed**.
- Accelerate trainer/lead walking tiles with Speed IV (wiki: displayed SPD **does not** accelerate movement; **bicycle** modifies tile duration instead).
- Treat 900 ms as an immutable minimum in models that also include Speed IV.
- Assume that a move is ready merely because its cooldown was mathematically elapsed while that Pokémon was off-field.

## 7. Move selection, fallback basic attack and readiness state

**[WIKI]** The active Pokémon picks the **highest expected damage** move *among moves whose cooldown has finished* against the current target, accounting for power, STAB, type effectiveness and physical/special attack versus defense. A static sorted list of strongest powers **does not reproduce** the live AI; availability changes each attack and target.

**When no named move is ready:** it falls back to **Investida**:
- **Power = 30**, **PHYSICAL**, base interval **2 seconds**.
- Always chooses a Pokémon elemental type (thus **STAB ×1.5**) but for a dual-type lead tries **type1**, falling back to **type2 only if target is immune to type1**; it is **not** the best of the two types by damage.
- Uses **ATK / DEF even for a Pokémon whose best moves are SPECIAL**. Strong Sp.Atk alone cannot make Investida powerful.
- Is subject to the *fixed* **Speed-IV-only** timing behavior above, not `cooldownDoPoder(30)`. The curve would assign a much longer reload, and doing so would catastrophically understate continuous damage.

### Per-Pokémon cooldown persistence

**[WIKI]** Cooldown counts down only while that Pokémon is **actively on the field**. Swapping it out **pauses** remaining time; returning resumes. Nurse Joy healing restores HP without resetting skills. Paid Boss and Mystic Arena entry resets skills ready; PvP, guild combat, gyms and championships have their own fresh simulated cooldown state.

**Model implication:** preserve remaining cooldown per individual Pokémon/skill when simulating swaps. No “rotation of five freshly ready 600-power signatures” or passive recharge for benched Pokémon. A one-lead hunt model need not simulate swaps initially, but must disclose it omits swap/death interruptions rather than assuming bench cooldown continues.

**[UNVERIFIED]** Because the server combat simulator is absent, precise tick alignment, tie-breaker behavior between equally strong moves, cooldown pause clock implementation, and conditions that consume a ready move when a target dies require runtime traces.

## 8. TM Elemental, AoE disks and Mega interactions

**[UPSTREAM / WIKI]** [`shared/tm-elemental.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tm-elemental.mjs) defines the permanent Elemental TM attack:

```js
{
  name: "TM <TYPE>", power: 2800, type: "<TYPE>",
  category: "SPECIAL", cooldownMs: 60000, tmElemental: true
}
```

Its type is restricted to the Pokémon's own type(s), so its move receives **STAB ×1.5**. It is a **SPECIAL** move regardless of whether the species otherwise prefers ATK, so compare **Sp.Atk/Sp.Def** correctly. Its full 2800 power makes it a major damage source; using an old 600-power move list can drastically underestimate strength.

**Two different AoE mechanics [WIKI]:**

| Effect | Geometry | Affects which moves? |
| --- | --- | --- |
| **Elemental TM** | **3×3 square centered on the chosen enemy target**; radius `1` in [shared source](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tm-elemental.mjs) | The Elemental TM strike itself |
| **AoE disk** | **11×11 square centered on the active player Pokémon** (up to 5 map tiles in each axis) | Ordinary eligible strikes, **not** an enlargement of the Elemental TM's 3×3 |

The wiki's examples for an Elemental TM attacking a target adjacent to the player: if the target is **orthogonally adjacent**, up to **five** monsters among the eight adjacent player tiles can be affected (including target); if **diagonally adjacent**, up to **three**. This is geometry dependent, **not a constant number of targets hit per cast**.

The two permanent disks can coexist on one Pokémon. A model that sets `AoE = 11×11 for all moves` will over-count an Elemental TM strike; a model that assumes the TM always hits five will over-count when monsters are not standing in the relevant tiles.

**[WIKI — Mega Evolution]** Megas are distinct species forms (typically `pokeId=3000+dex`) with **replaced species base stats and sometimes different types**, not a universal percentage stat boost. Their IV, quality, potency and refinement still apply. A Mega gains a separate 600-power **30-second** signature, but its full moveset may come from a species-specific Mega spreadsheet; don't inject ordinary signatures again into the final Mega catalog. The final-evolution signature injector in upstream deliberately excludes these forms.

**Note on source limits:** shared source confirms TM power, SPECIAL category, cooldown and 3×3 radius; the **11×11 disk area and detailed server target collection** are documented in wiki, while the server's corresponding hit-selection code is absent from the mirror. Treat exact edge/obstacle behavior as unverified.

## 9. Damage cadence, targeting, travel and wave throughput

**[WIKI]** The hunting lead walks to the **nearest wild Pokémon**, then attacks only when **adjacent**; it does not deal ordinary ranged attacks across the map. Base scene movement is reported as **260 ms/tile for the Pokémon** and **290 ms/tile for trainer**, independent of Speed IV. Bicycle rarity changes **step duration**, not skill cooldown or damage. From Unova onward, many wilds spawn in groups intended for comparably paced hunts; still use actual observed density for each location.

**[UPSTREAM]** `hunt-analyser.mjs` defines a crude baseline:

```text
MAX_MOBS = 16
MS_ONDA = 2600
CD_GOLPE_MS = 900      // pre-Speed-IV baseline, not universal real attack time
MS_DESLOC_MS = 600
CD_MOVIMENTO_MEDIO_MS = 2000

killsPerHour(hunt) =
  3600 * min(16,sum(spawnPoints))
  / ((min(16,sum(spawnPoints)) * (900+600+2000) + 2600) / 1000)
```

This is explicitly a **fixed single-target heuristic**, not a simulator for per-move cooldowns, AoE, species hit points, repositioning, headless mode, simultaneous hits, death or healing. Do **not** use it as measured KPH. **[ADDON]** Hunt Atlas currently has its own fallback of similar form and a richer personalized model, along with live measured rate precedence.

### Correct quantity for reward recommendations

```text
expectedTrainerXP/h = effectiveKills/h × encounterWeightedTrainerXP/kill
expectedPokemonXP/h = effectiveKills/h × encounterWeightedPokemonXP/kill
expectedRareDrops/h = effectiveKills/h × correctPerKillDropProbability
```

These formulas connect to [HUNT_REWARDS_AND_RARE_LOOT.md](./HUNT_REWARDS_AND_RARE_LOOT.md). **Kills/hour**, not abstract damage-per-second, is the decisive bridge from combat to rewards. A move that one-shots multiple targets may produce better KPH than a large single-target hit even if the latter shows a higher number on screen. Likewise potion expenses and downtime can reverse gross XP/h rankings.

## 10. Hunt Atlas: measured combat events and what the model currently knows

**[ADDON]** The current [`addons/hunt-atlas.user.js`](https://github.com/MOTHblank/pokeidle-addons/blob/master/addons/hunt-atlas.user.js) listens to game battle event kinds:
- `spawn`: target `slot`, `speciesId`, level and possible `hp/maxHp`;
- `ataque`: from player `por='jogador'`, damage `dano`, attack type `tipo`, effectiveness `ef` and target slot;
- `morte`: kill totals, XP/Coins and target retirement.

It records target HP samples, per-type **observed neutralized damage** (`dano / ef` for positive known `ef`), same-target and transition attack intervals, per-hunt kills and XP, and then builds a personalized profile. Measured results take precedence over model predictions; cold-start uses an upstream-inspired baseline. Cached estimates are invalidated by profile/combat revision.

**Important current blind spots**, requiring care before treating model as a true attack simulator:

1. **Move identity:** observed damage is currently bucketed by **elemental type**, not by *individual move ID/name, power, physical/special category or attached TM/Mega source*. Two FIRE attacks with different powers and cooldowns can be averaged together. Adding a move index without observed move IDs does not automatically solve attribution.
2. **AoE/cast grouping:** several `ataque` event rows may originate from **one cast hitting multiple targets**, yet the current `record.attacks` increments per row and intervals are measured using local `Date.now()` on event receipt. The code excludes gaps below **100 ms** from one interval sample, but that is a **heuristic**, not a stable server cast identity. AoE hits separated by scheduling/delivery >100ms can still look like distinct attacks, and consecutive real casts can be missed/merged.
3. **Damage normalization:** `dano / ef` removes the event-reported effectiveness once, if its semantics are understood; don't also remove STAB/randomness casually. `ef` might represent raw or amplified effectiveness depending on server mode; confirm from a controlled typed matchup.
4. **Target HP reconstruction:** inferring `maxHp ≈ hpAlvo + dano` is unsafe if that observed hit was not the first, is overkill-capped, or occurred alongside a second target/hit. Prefer `spawn.maxHp`, full snapshots, or a specifically labelled lower-quality inference.
5. **Partial species coverage:** the prediction skips targets without positive HP or modeled damage; if substantial spawn weight lacks data, successful-species averages become **optimistic**. Report modeled spawn-weight coverage and a warning instead of implying a complete prediction.
6. **Race/identity:** `slot` should be scoped to a target lifecycle. Slots reused on fresh waves must not inherit stale health/attacks or be joined across targets by name.
7. **Warm-start transfer:** scaling damage from a previous lead signature by a single abstract Pokémon `power` ratio is an approximation. The new lead's typing, attack side, TMs and cooldowns can make that ratio wrong.
8. **Hunt-specific game state:** potion use, deaths, movement, rotations, current cooldown remaining and repositioning may be hidden by a purely attack-event model; measured KPH will typically account for them better than a theoretical DPS extrapolation.

**Crucial distinction:** a one-second `Date.now()` gap between WebSocket **event receipt** timestamps is **not necessarily** a one-second real move cooldown. Packet batching, background timers, long tasks, headless rendering and burst delivery can distort client timestamp spacing. Prefer an available server timestamp or explicit cast ID if supplied by the actual protocol, otherwise tag inferred intervals with reduced confidence.

### Conservative modeled throughput proposal

1. Cache the **post-transform lead moveset** and type/defense stats if known (including TM, Mega, held/equipment state).
2. Estimate each target's **effective HP** and each ready move's expected damage against that target using type and category.
3. Simulate **separate move readiness**, basic fallback, global action spacing and movement, marking guessed aspects with confidence.
4. Model AoE **once per originating cast**, applying one hit to each eligible unique target in that cast; target distribution should be measured/simulated, not assumed equal to all spawn points.
5. Add wave delay, potion/revive/death downtime; derive **kills/hour**.
6. Compare against live measured KPH; calibrate carefully with enough kills across the same hunt, same lead, same loadout and boost state.
7. Preserve a static fallback when the model is incomplete, but **label it fallback**, not precise combat accuracy.

The addons are intentionally low-resource and run long sessions. This is a design contract, **not a request to add high-frequency polling, expensive full simulations every redraw or new global WebSocket hooks**. Reuse existing event collection; batch/recompute on meaningful state or catalog changes.

### Hunt Atlas v1.9.18 implementation note (2026-10-15)

- **Modeled** XP/h no longer receives cross-hunt calibration derived from observed kills on another target. Each enemy uses its own catalog HP/DEF/Sp.Def, typing, the live lead's ATK/Sp.Atk and level, eligible runtime/catalog moves (including known Elemental TM), STAB, hunt type amplification, Speed-IV/global and skill cooldown timing. Repeated modeled encounters share move readiness. Basic Investida is physical, uses the first type except on immunity, and uses its 2-second Speed-IV cooldown.
- Wild HP is estimated from catalog base HP, current hunt level and the documented **×5** multiplier, without transplanting measured target HP scaling from other hunts. Unknown IV/quality, healing, AoE geometry, movement pathing and the unavailable server AI keep this an **approximation**, not an exact game simulator.
- **Measured** XP/h from accepted kill receipts is stored per hunt, exact lead/loadout/level and XP/bonus scope. Once a representative window is available, its snapshot remains on disk after leaving or reloading the hunt. A live measurement of the same matchup takes precedence; changing level, equipment or bonus scope creates a new prediction context rather than rewriting old evidence.
- Missing opponent stats, type data or lead damage inputs result in **unknown**, not the same plausible-looking baseline rate assigned to many different enemies. A known full immunity results in zero model throughput. Measurements from a different hunt never change this model's projected rate.
- Regression coverage: `node --test addons/hunt-atlas/tests/rate-model.test.cjs`. The fixture checks asymmetric Xatu/Charizard difficulty, immunity, saved measured-rate isolation, context separation and missing-data handling. In-game calibration and performance still require live observations.

## 11. Compact proposed data contract — not an existing game packet

```ts
type Confidence = 'observed' | 'source-derived' | 'modelled' | 'partial' | 'unknown';
type MoveDef = {
  name: string;
  type: string;
  category: 'PHYSICAL' | 'SPECIAL';
  power: number;
  cooldownMs: number;
  learnLevel?: number;
  source: 'runtime' | 'shared-transform' | 'static-index' | 'inferred';
  cdFixo?: boolean;
  tmElemental?: boolean;
  golpeMega?: boolean;
};
type CombatSnapshot = {
  leadInstanceId: string | null; // not just species name
  leadSpeciesId: number;
  leadLevel: number;
  attack: number | null;
  specialAttack: number | null;
  speedBase: number | null;
  speedIV: number | null;
  types: string[];
  moves: MoveDef[];
  hasAoeDisk: boolean | null;
  huntId: string;
  huntLevel: number;
  targetSampleCount: number;
  observedCastCount: number | null; // null if multi-hit cannot be disambiguated
  observedHitEventCount: number;
  observedKillsPerHour: number | null;
  estimatedKillsPerHour: number | null;
  coveredSpawnWeightFraction: number | null; // 0..1 when known
  confidence: Confidence;
  warnings: string[];
};
```

No new protocol field or polling mechanism is implied by this TypeScript sketch. Unknown stats/move/cast identifiers remain **null** rather than invented values. A counter of `ataque` rows is **not** a counter of casts without a reliable grouping key.

## 12. Deterministic checks and scenario matrix

These checks are suitable for a later implementation, regardless of whether the user performs full runtime validation.

| Case | Expected invariant |
| --- | --- |
| `cooldownDoPoder(15)`, `(100)`, `(600)` | 10,000 / 30,000 / 60,000 ms |
| `cooldownDoPoder(40)`, `(150)`, `(300)` | 15,900 / 33,000 / 42,000 ms |
| Power missing, zero or less than 15 | Normalize to 15 before ordinary cooldown |
| 600-power Mega with `cdFixo` | Remains **30,000 ms**, not overwritten by normal curve |
| Elemental TM power 2800 | Uses **60,000 ms**, never extrapolated to 192 s; **SPECIAL** and its Pokémon type |
| Speed base 130, IV24, 60s skill | **57,188 ms** after rounded percentage reduction |
| Speed base 160 and 200, IV32, 60s skill | Both **55,800 ms**, capped 7% |
| Investida with IV32 | **1,680 ms** nominal, PHYSICAL power 30 |
| Global player 900ms with IV32 | Wiki nominal **580ms**, no extra 7% discount |
| Same-type GHOST/DRAGON missing diagonal cell | **×2**, not ×1 |
| Same-type FIRE missing diagonal cell | **×0.5**, not ×1 |
| WATER versus ROCK/GROUND | Raw ×4, **hunt ×5.5** |
| FIRE versus WATER | Raw ×0.5, **hunt ×1/3** |
| GROUND versus FLYING | Immune ×0 even with second defender type |
| Neutral or immune against a hunt | Remains ×1 or ×0 |
| Move after type amplification | Multiply defender types **first**, amplify **once** |
| 30-power Investida vs an immune type1 target | Try type2 **only upon type1 immunity**, not simply stronger type |
| TM with AoE disk equipped | Elemental TM still **target-centered 3×3**, not 11×11 |
| Three `ataque` events for different slots in one AoE | **Three hit events**, potentially **one cast**, not automatically three independent cooldowns |
| Bench Pokémon over 60-second idle | Its skill cooldown **does not pass** if wiki rule applies |
| Full target HP already from spawn | Never multiply by wild HP ×5 twice |
| Missing modeled enemy species | Lowers **coverage/confidence** rather than silently dropping that enemy |
| Observed KPH and modeled KPH coexist | Observed rate wins for same hunt/lead/time window; hypothetical ranking stays labelled |

### Minimal acceptance criteria for Hunt Atlas improvements

- Type filters, damage predictions and summaries agree on exact same-type diagonal logic.
- A sample with at least two moves of the **same type** cannot silently claim to know their separate cooldown from aggregated type damage.
- A true AoE cast with multiple target rows never inflates *cast* rate.
- Partial matchup/cooldown/HP coverage is visible to the user as uncertainty and cannot produce an unqualified “best hunt”.
- Model-generated kill rates are invalidated on lead change, Mega form change, TM/AoE upgrade, current hunt change, or significant source data revision; measurements are matched only to the appropriate signature.
- No added expensive scans or repeated catalog fetches in idle/headless modes.

## 13. Conflicts, missing server details and interpretation hazards

| Topic | What is supported | What must not be assumed |
| --- | --- | --- |
| Damage rounding and combat AI | Wiki gives standard damage equation, move choice and random range | Exact server rounding, tie-breakers, random sampling, critical/status exceptions |
| Raw type effectiveness | Shared module implements diagonal exceptions and dual-type product | Blank same-type cell means neutral, or a generic Pokémon type chart supersedes game data |
| Hunt amplifier | Shared Hunt Analyser uses post-product factor 1.5 | Same mapping necessarily applies to boss/PvP/guild encounters |
| Skill cooldown | Shared `cooldownDoPoder` and Speed function are exact pure functions | Generic power curve also applies to Mega fixed move, Elemental TM or Investida |
| Live move identity | Runtime moves/planilhas are primary; old index is dated | One `porAtaque[name]` entry uniquely identifies per-species power/category |
| Basic/global Speed IV | Wiki + source comments describe −10ms per IV and floor | Server integer scheduling/tick alignment fully established by shared code |
| Off-field cooldown | Wiki: pause on benched Pokémon, resume on return | Skills recharge passively while not active |
| TM/AoE geometry | Shared Elemental TM radius=1, wiki: target 3×3 vs player 11×11 | Every move is enlarged by AoE disk, or every TM always hits maximum targets |
| Enemy HP/damage buffs | Wiki wild HP ×5 and damage ×1.8 | Already-observed `maxHp` still needs ×5 |
| Hunt Atlas event grouping | Current addon receives `ataque`/slot/type/damage/eff and measures client intervals | Every damage row is a unique cast, local event arrival time is authoritative server time |
| Upstream index freshness | `moves-index.json` was generated August 2026; later move balance source exists | Its indexed cooldowns/categories reflect all October source transforms |
| Real KPH | Upstream provides rough fixed baseline; Hunt Atlas samples events | Static model equals sustained real farming profit/XP |

**Conclusion:** an accurate farming combat model is a **stateful, target- and move-aware process**, not a static attack-power sort. Combine the wiki's physical/special damage and AI rules, the upstream's exact type and cooldown functions, the *final* moveset including TM/Mega exceptions, and Hunt Atlas's observed results. When complete evidence is unavailable, expose uncertainty and fall back to measured kills/hour instead of constructing fictional combat precision.
