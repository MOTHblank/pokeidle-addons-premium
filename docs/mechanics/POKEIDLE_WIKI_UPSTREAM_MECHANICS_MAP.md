# PokéIdle wiki ↔ upstream mechanics map

**Reviewed:** 2026-10-12  
**Scope:** implementation-oriented mechanics outside the Pokémon [valuation reference](../market/POKEMON_VALUATION_REFERENCE.md).  
**Evidence:** the owner's supplied PokéIdle wiki (chapters cited below), the currently inspected `MOTHblank/pokeidle-upstream` shared/client files, and the addon files in this repository.  
**Confidence rule:** a wiki claim, a mirror implementation, and an addon assumption are three distinct sources. An upstream shared constant is good evidence of intended game logic, but not proof of what a deployed game server is using at this moment. This upstream mirror does **not** include the entire authoritative server.

This is a source map and a set of actionable contracts, not a replacement for the full game wiki. It identifies areas worth deeper dedicated documents and precise validation of the running addons.

## 1. Hunt income: XP, gold, loot and throughput — highest priority

**Wiki:** *Níveis e XP*; *Combate → Ondas e corpos*; *Mapa e Hunt Analyser*; *A Sessão*.  
**Upstream:** [`shared/sell-value.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/sell-value.mjs), [`shared/recompensa-hunt.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/recompensa-hunt.mjs), [`shared/economia-drop.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/economia-drop.mjs), [`hunt-analyser.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/hunt-analyser.mjs).  
**Addons:** [Hunt Atlas](../../addons/hunt-atlas/hunt-atlas.user.js), [Moth Watch](../../addons/moth-watch/moth-watch.user.js).

### Exact upstream per-kill reward curves

The mirror defines `xpPorDerrota(hunt, nivelMob, especie) = xpDoNivel(nivelMob)`; species-specific `experience` is **not** directly used by that exported reward function.

```text
XP per kill at mob level n:
  n <= 150: floor(0.6*n^2) + 8
  n > 150: round(13,500 * (n/150)^1.25)

Gold per kill:
  exponent = ln(6000/36) / ln(5000)
  gold(n) = min(gold(25000), max(1, round(36 * max(1,n)^exponent)))

Anchors:
  gold(1)    = 36
  gold(5000) = 6000
  gold(25000) = 15776 (rounded)
  gold above 25000 stops increasing
```

`ouroDoNivel(n)` also exists, but **is not** the same as `ouroPorKillDoNivel(n)`; do not substitute one for the other. The former is a legacy/economic helper, while `ouroPorDerrotaHunt` calls the latter.

**NPC-resale loot adds another part of the economy.** `shared/economia-drop.mjs` exports `alvoRendaPorKill` (target economic return) and `alvoDropPorKill`; below level 25,000 its target is approximately **15% additional NPC-resale value above gold per kill**. Above that cap, drops carry further growth, with `EXPOENTE_RENDA = 0.30`. Loot is species-specific and stochastic, and that function's target **is not a guarantee** of the drops realized by every player or kill. The balancing source preserves species drop **chances** where it can, adjusts quantities, caps each loot line at 20 items, and introduces the `Rare Pokémon Picture` as a balancing outlet.

In the game's own `hunt-analyser.mjs`, `mediaPorKill` weights spawn members by their `pontos`. Its **baseline** kills/hour uses `MAX_MOBS=16`, `MS_ONDA=2600`, global attack floor `CD_GOLPE_MS=900`, travel `MS_DESLOC_MS=600`, and average movement/attack `CD_MOVIMENTO_MEDIO_MS=2000`. These are simple estimator assumptions, not measured DPS for a particular Pokémon. Hunt Atlas maintains a personalized measured/modelled combat model; avoid overwriting measured values with the built-in baseline.

**Documentation value:** separate *base gold*, *realizable NPC-resale loot*, *rare-drop market value*, *training XP* and *consumable costs*. The wiki's Session panel already tracks balls/potions/revives and net profit, so a useful hunt comparison is **net expected value per hour**, not just gross Coins/h or XP/h. Market sale income belongs to a different price source than NPC resale.

### Cross-source caveat

The wiki's short description of Hunt Analyser Gold/hour refers to the species' `experience` value. The inspected exported upstream reward function uses a **mob-level gold curve instead**. This is a **wording/implementation mismatch to verify**, not justification to claim the live game is wrong.

## 2. Outland rare drops and progression

**Wiki:** *Combate → Drop na Outland / As 8 Outlands*; *Casa e XP Share*; *Bicicletas*; *Shiny*.  
**Upstream:** [`shared/outland-tiers.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/outland-tiers.mjs), [`shared/outland.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/outland.mjs), [`shared/caixas-npc.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/caixas-npc.mjs), [`shared/escala-hunt-level.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/escala-hunt-level.mjs).

The wiki and exported `OUTLAND_TIERS` currently agree:

| Tier | Trainer level gate | Rare-drop multiplier |
| --- | ---: | ---: |
| Outland 1 | 150 | ×1 |
| Outland 2 | 500 | ×1.25 |
| Outland 3 | 1,000 | ×1.5 |
| Outland 4 | 2,000 | ×2 |
| Outland 5 | 4,000 | ×3 |
| Outland 6 | 8,000 | ×4 |
| Outland 7 | 16,000 | ×6 |
| Outland 8 | 25,000 | ×8 |

**Crucial:** these are tier choices on the **same Outland map**, not eight separate hunt catalogs. They modify the three native rare drops — **Bronze Boss Token**, **Key Fragment**, and **Shiny Stone Fragment** — and the wiki also describes **Bicycle Fragment** on this same Outland rare-drop schedule. The exported tier comment names three drops and does not itself establish the bicycle fragment's precise server hook; verify that path in the sim before treating bicycle as confirmed by this module alone.

The wiki's *unboosted* Outland 1 chance of a Bronze Boss Token is **0.05% = one per 2,000 kills on average**. The Key, Shiny Stone and Bicycle fragment wiki probabilities are each **0.0005% = one per 200,000 kills on average**. A tier ×8 gives expected waiting times of approximately 250 and 25,000 kills respectively *at identical kills/hour*, before Loot Boost, guild bonuses, or events; these are **expectations**, not pity timers or promised drops.

`tierOutlandValido(tier, trainerLevel)` enforces eligibility and can fall back to the highest unlocked tier. `shared/outland.mjs` maps historical variant IDs from `10501+` into `2001+`; don't count the old and normalized identifiers as distinct variants, and don't offer ordinary evolution for Outland-specific forms.

**Documentation value:** estimate rare fragments/hour from observed kills/hour, selected Outland tier and active bonuses. Keep per-drop expected value separate from NPC Coins/hour. An economic comparison can use Moth Watch's **confirmed completed-sale** references with uncertainty for items, rather than turning in-game rarity into an invented Gem/Coin price.

## 3. Shiny Egg fragments: separate high-level farm

**Wiki:** *Ovo Shiny*; *Chocadeira e Mystery Eggs*.  
**Upstream:** [`shared/ovo-shiny.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/ovo-shiny.mjs).

The Shiny Egg fragment is **not an Outland drop**. The game describes it on hunts of **level >= 5,000** (Unova onward), explicitly excluding Outland. The upstream function `chanceFragmentoOvoShiny({ area, nivel })` matches this location gate.

```text
chance per kill = 0,                                  below level 5000 or in Outland
chance per kill = 0.0000375 + (tierIndex - 1)*0.0000015,  otherwise

tierIndex = number of fixed DEGRAUS_FRAGMENTO_OVO_SHINY levels <= hunt.level
   at level 5000   → 0.00375%
   at level 160300 → 0.00810%
```

The tier list is **frozen intentionally**: inserting a new hunt level does not silently shift existing probabilities. Upstream IDs: `FRAGMENTO_OVO_SHINY_ID=70017`, `OVO_SHINY_ITEM_ID=70094`; **10 fragments** craft one guaranteed-shiny egg; incubation is **168 hours / 7 days**, before any permitted heating modifier. The fragment and unhatched crafted egg are tradable according to the wiki and module comments.

**Documentation value:** report **fragment rate**, **expected hours to craft**, **incubation delay**, and completed-market-sale reference **separately**. A level-160,300 hunt may earn many more fragments per *kill*, but if the player's kills/hour collapses, it may not be the best expected fragments/hour.

## 4. Combat and matchup: model inputs, not price/grade

**Wiki:** *Combate*; *Tipos: forças e fraquezas*.  
**Upstream:** [`shared/tipo-efetividade.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tipo-efetividade.mjs), [`shared/cooldown-golpes.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/cooldown-golpes.mjs), [`hunt-analyser.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/hunt-analyser.mjs), [`assets/index/moves-index.json`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/assets/index/moves-index.json).

- An attack's effectiveness against a dual type multiplies effects against each defending type; `shared/tipo-efetividade.mjs` also has special handling of missing same-type diagonal cells. A raw, generic Pokémon type chart is **not sufficient**.
- The hunt amplifies matchups through `amplificarHunt(..., 1.5)`: ordinary ×2 becomes **×2.5**, ×4 becomes **×5.5**, ×0.5 becomes **×1/3**. Neutral and immune multipliers stay unchanged. This amplification is a **hunt-specific** rule, not the ordinary matchup chart.
- Physical moves use ATK vs DEF, special moves use Sp.Atk vs Sp.Def; STAB is **×1.5**, randomness is **0.85–1.0** by the wiki. Native move choice prefers highest expected damage among ready moves. Identifying `PHYSICAL` and `SPECIAL` moves from the indexed catalog can improve Atlas modelling.
- The generic move cooldown curve is in `shared/cooldown-golpes.mjs`; species base Speed gives up to **7%** skill cooldown reduction potential, scaled by Speed IV/32. The wiki describes a distinct **10 ms reduction per Speed IV point** for basic attack/global interval. Do not treat displayed Speed as movement velocity, and do not add cooldown reduction twice.
- A Pokémon's N grade and ranking ⚔ are **not** direct damage inputs. Refer to [valuation documentation](../market/POKEMON_VALUATION_REFERENCE.md) for their definitions.

**Documentation value:** a dedicated *Combat Model Contract* with formulas, move categories, source versions, observed-cast counterexamples, uncertainty ranges, and how the measured Hunt Atlas model calibrates against static upstream assumptions.

## 5. Capture, level ceilings and automation safeguards

**Wiki:** *Captura*; *Desmaiar e curar*; *Automações*; *Oferenda de Pokémon*.  
**Upstream:** [`shared/teto-captura.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/teto-captura.mjs), [`shared/pokemon-nivel-treinador.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/pokemon-nivel-treinador.mjs), [`shared/reduzir-nivel.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/reduzir-nivel.mjs), [`shared/oferenda.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/oferenda.mjs), Auto Catch+.

- The wiki's normal capture formula depends on a **species economic-price-derived rarity**, ball effectiveness and target HP; it is clamped to **0.30%–10%** per throw. A downed corpse gives **one attempt** before disappearing, remains for **30 seconds**, and the wiki documents **1.2 seconds** between built-in VIP auto-throws. This capture probability is **wiki-derived**: the mirror's `shared/teto-captura.mjs` defines **captured level**, not the authoritative server capture-probability function.
- Captured level is distinct from the wild's combat/hunt level: above level 100, chain stages cap new captures at **20 / 40 / 100** for 3-stage evolutions, **40 / 100** for 2-stage evolutions, and **100** for standalone species. At or below level 100, the captured level remains the wild's level. `shared/teto-captura.mjs` implements these ceilings.
- The player can field an ordinary Pokémon only up to **trainer level + 5** (`FOLGA_NIVEL_POKEMON=5`), with a starter exception; `shared/reduzir-nivel.mjs` has a deliberate floor for reducing an overleveled Pokémon. Therefore buying a high-level Pokémon may not make it *immediately usable*.
- The wiki gives full-party defeat a trainer-XP loss and says abruptly closing the tab during combat counts as defeat; the presence of items/revives is important to avoid a repeated-loss loop. The **precise server disconnect and revive paths have not been verified** by this upstream shared mirror.
- Auto Catch+ has separate server-protocol capture acknowledgement and consumable restock logic; a future dedicated document should distinguish confirmed packet/state behavior from UI-only corpse detection and estimate **cost per successful capture**, not just ball unit price.

## 6. Houses, bikes, held Exp. Share and rare-item valuation

**Wiki:** *Casa e XP Share*; *Bicicletas*; *Oferenda de Pokémon*; *Market*.  
**Upstream:** [`shared/casas.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/casas.mjs), [`shared/bicicletas.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/bicicletas.mjs), [`shared/xp-share-held.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/xp-share-held.mjs), [`shared/refino-stats.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/refino-stats.mjs), [`shared/pedras-evolucao.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/pedras-evolucao.mjs).

**Houses** grant extra XP to a roster Pokémon in a house slot: **25% / 40% / 75% / 100% / 100%** of the active battler's Pokémon XP by rarity; Legendary has **two** slots. This is **created additional XP**, not deducted from the active Pokémon. Up to **five houses in use**. A separate, non-tradable held **Exp. Share** grants **5%** to its holder, including a Depot Pokémon, but cannot be combined with a house slot on the same Pokémon. Source ID `XP_SHARE_HELD_ID=70050`, transfer cooldown **60 seconds**.

**Bikes** carry the same rarity weights as houses. Speed boosts are **+15%, +25%, +50%, +75%, +100%**; they shorten *walking step duration*, not damage or move cooldown. They're individually numbered/marketable, and only one is equipped at a time.

**Crafts** use **10 fragments** for a randomized house/bike; combining **5 Common -> 1 Uncommon** and **5 Uncommon -> 1 Rare** is possible, but Mythical/Legendary are not craft-up tiers. Prices depend on numbered identity, rarity, scarcity, trade restrictions and actual completed sales — not simply fragment acquisition cost. Evolution stones are **marketable but excluded from NPC sale** in `shared/venda-npc-item.mjs`; this distinction also matters for Moth Watch's price references.

**Documentation value:** a tradability/rarity/crafting *item provenance matrix*, with exact IDs and canonical price sources, so Moth Watch doesn't treat every 'item' as equivalent, sell non-tradable assets or confuse NPC value and player-market value.

## 7. Official low-resource mode and account/session behavior

**Wiki:** *Configurações e modos de tela*; *Uma sessão por conta*; *Bônus de live*.  
**Upstream:** [`preferencias.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/preferencias.mjs), [`campo.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/campo.mjs).  
**Addons:** Performance+, Twitch Low Resource, Controller the public controller monitor.

The wiki says native **Modo Economia** stops rendering the field while keeping the server session active; **Modo otimizado** keeps the field but removes effects. The inspected `preferencias.mjs` uses local keys `cfg-economia` and `cfg-otimizado`, and Performance+ explicitly recognizes the native `modo-economia` class.

**Documentation value:** a compatibility contract about which render hooks can be paused, which capture controls must remain interactive, which indicators genuinely reflect whether hunting is active, and what is *rendering disabled* versus *server session disconnected*. Performance+ should cooperate with native modes instead of assuming every invisible field means a frozen game.

The wiki says Twitch credit is based on an **authenticated presence in official streamer chat**, with the list checked approximately once per minute and **+15%** XP for the first eligible live chat and **+2.5 percentage points** per additional live chat. The upstream shared/client snapshot does not prove server-side chat reward reconciliation. Controller telemetry should show **number of participating channels**, not confuse it with the number of browser tabs.

## 8. Mismatches and verification queue

| Observation | Wiki | Inspected upstream mirror | Action |
| --- | --- | --- | --- |
| **Mystic legendary birth floor — substantial difference** | At the end of *MysticTicket e Arena Mística*: minimum **quality 1.2, IV sum 120, potency P2** | `shared/mistico.mjs` exports **`MISTICO_QUALIDADE_MIN=1.5`, `MISTICO_IV_SOMA_MIN=150`, `MISTICO_POTENCIA_MIN=3`** | Determine actual live version; do not mix the two rule sets or announce either as confirmed server reality without verification |
| Outland count in code comments | **8 tiers** | `shared/outland-tiers.mjs` opens with “AS CINCO OUTLANDS,” but its actual `OUTLAND_TIERS` array has **8** correct tiers | Treat the comment as stale; derive documentation from exported data |
| Hunt Analyser gold description | Describes Gold/h using species `experience` | `shared/recompensa-hunt.mjs` exports a level-based gold-per-kill function; `hunt-analyser.mjs` uses it | Confirm actual deployment; correct or clarify wiki wording if outdated |
| Bike fragment on Outland tier | Wiki lists it as an Outland-tier-scaled drop | `outland-tiers.mjs` introductory explanation names three other rare drops; this module alone doesn't prove bike handling | Trace actual server rare-drop call site before asserting implementation parity |
| Native capture probability | Wiki supplies formula and ball table | Partial mirror has capture-level and special Mystic chance helpers, but not full ordinary server capture chance call | Keep ordinary formula marked wiki-only until runtime/capture server source is available |
| Market protocol and live transactions | Wiki documents sale locks, lottery, tax and 30-day history | Shared market fee/history constants exist, but full server DB/protocol definitions are not included in mirror | Ground estimators in observed authorized messages and avoid assumed payload fields |

**Important provenance note:** the wiki attachment is presented as current, but a conflict with inspected upstream code does **not** establish which side is deployed. Prefer matching exact build/version and runtime behavior before modifying addon algorithms.

## 9. Suggested dedicated follow-up documents

| Priority | Filename | Contents / addon payoff |
| --- | --- | --- |
| 1 | `HUNT_REWARDS_AND_RARE_LOOT.md` | Per-kill XP, gold, NPC loot, rare drops, Outland tier, boosts, net/h and model vs measured uncertainty. **Hunt Atlas + Moth Watch** |
| 2 | `COMBAT_MODEL_CONTRACT.md` | Damage/defense, move selection, Speed cooldowns, amplified type matchups, AoE and observed hit-event attribution. **Hunt Atlas** |
| 3 | `AUTOCATCH_CAPTURE_ECONOMICS.md` | Catch chance and special cases, per-corpse lifecycle, capture-level ceilings, ball/restock cost, death recovery. **Auto Catch+** |
| 4 | `TRADEABLES_AND_CRAFTING.md` | Houses, bikes, eggs, stones, boxes, numbered assets, tradability, rarity, NPC-versus-player market and expected-value assumptions. **Moth Watch** |
| 5 | `NATIVE_PERFORMANCE_AND_SESSIONS.md` | Mode Economia/otimizado, session and reconnect semantics, controller telemetry and Twitch channel counts. **Performance+ + Controller** |
| 6 | `RMT_PROTOCOL_AND_FEES.md` | Exact request/response shapes from authorized captures, historical price windows, gross/net fee rules and listing release timing. **Moth Watch** |

Use this map as the index. Build a dedicated document when its tests, data sources and behavior become substantial enough to avoid duplicating the wiki or the existing Pokémon valuation document.
