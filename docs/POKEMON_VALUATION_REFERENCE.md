# PokéIdle Pokémon grading, combat value, and Moth Watch pricing

**Status:** upstream research and partial implementation reference (premium Moth Watch v0.2.0)  
**Reviewed:** 2026-10-12  
**Sources:** the complete PokéIdle wiki supplied by the project owner (especially *Stats, Qualidade e IV*, *Nota, Poder e Calculadora*, *Potência*, *Shiny*, *Combate*, *Evolução*, *Mercado da Comunidade*, and *Todas as taxas*); [pokeidle-upstream](https://github.com/MOTHblank/pokeidle-upstream) `master`; and this repository's [Moth Watch](../addons/market-bot.user.js).  
**Source authority:** wiki = stated live game rules; upstream mirror = inspected client/shared implementation; Moth Watch = existing behavior. Where a server-only calculation, message shape, live transaction sample, or buyer preference is missing, this document says so rather than guessing.

## Premium Moth Watch v0.2.0: implemented valuation safeguards

**Released in the premium repository source; live-game market payloads remain unverified.** The main research below predates the migration. In v0.2.0:

- Completed sale references are rebuilt in a **v2 local cache**, kept separate for currency, species/form ID, shiny state and potency. The legacy v1 cache is not treated as graded comparables; the historical scan must be refreshed before Pokémon opportunities appear.
- History snapshots preserve non-identifying information only: gross completed-sale price, broad level band, game-provided numeric N (if present), quality (if present), individual IVs (only when an unambiguous keyed six-stat vector is present), and refinement (only when keyed values are available). No seller, owner or personal Pokémon IDs are stored in the reference.
- A six-tier comparison attempts exact grade/level/quality/IV/refinement first, then relaxes dimensions with visible confidence labels. Even a broadened grade match **never crosses half-point grade boundaries**, particularly the N=3.5 and N=4.0 boundary.
- The discovery panel shows the completed-sale median, an empirical interquartile price range, sample size, comparison dimensions, and grade/quality availability. Price-ratio opportunities are permitted only for a minimum-sample **grade-matched** tier, never ungraded or species-only history. A 'low confidence' label still requires independent judgment.
- There is **no automatic Pokémon buying**, inferred combat role, arbitrary potency-to-price multiplier, or fabricated N or IV distribution. Fixed item purchase rules keep their previous defaults and safeguards.
- Sources do not yet establish reliable timestamps, TM/move metadata, or precise live listing and history schemas. Missing attributes are not imputed, and no claim is made that a median is an ideal listing price. The first page of the market is still the only scanned listing page per currency; the historical refresh keeps the existing bounded request cadence.

**Implementation notice:** when historical sales supply no \`ficha.nota\` or the listing lacks it, only a broad contextual reference can be produced, and no Pokémon opportunity is flagged. Likewise, full IV comparison is impossible if the payload has only IV totals or an array without a verified stat order. This deliberately favors false negatives over false bargains. Review redacted real market payloads before supporting more field aliases or improving role evaluation.

## Executive findings

1. **The score really is calculable from upstream:** `shared/nota-pokemon.mjs` implements the 0–10 *Nota N=* from species base stats, six individual IVs, quality, potency, shiny, refinement, and evolution-lineage floors. Its log-scaled normalization is more involved than averaging IVs.
2. **Listing eligibility is not strictly “score > 3.5.”** The shared rule is **level >= 50 and N >= 3.5**, inclusive, with **shiny and P5 bypassing both minimums**. Shiny listings can use **Gems only**.
3. **N=3.5 versus N=4.0 is a meaningful market boundary**, not an instruction to raise the price by 4/3.5. Supply is censored by the 3.5 minimum; there can be a large price difference even for a small grade difference. No reliable numeric price premium has been established.
4. **N is not combat fitness or interchangeable across species.** For a physical attacker an exceptional ATK IV can matter more than a higher total N driven by other stats; special attackers prioritize Sp.Atk. Speed IV affects attack cooldowns despite Speed not appearing in direct damage.
5. **Moth Watch v0.1.51 pooled unlike Pokémon.** Its completed-sale lookup groups by `currency | speciesId | shiny | potency | level band`, with a fallback that drops level band. **It does not group by N, IV distribution, quality, refinement, moves/TMs, or buyer-desired build.** Its current median is a *coarse historical comparator*, **not an ideal price**.

## 1. The exact grade calculation: upstream

Primary source: [`shared/nota-pokemon.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/nota-pokemon.mjs), with [`shared/linhagem-nota.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/linhagem-nota.mjs) and [`shared/refino-stats.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/refino-stats.mjs).

**Inputs:** species bases `baseHp, baseAtk, baseDef, baseSpAtk, baseSpDef, baseSpeed`; per-stat IVs `hp, atk, def, spAtk, spDef, speed`; quality `quality`/`qualidade`; `potencia`; `shiny`; optional per-stat `refino`; lineage metadata `notaAncestrais`. Species identity matters.

At birth, for each stat `k`, the shared implementation sums individually rounded values:

```text
birthStat[k] = round((speciesBase[k] + refino[k] + 2*IV[k])
                     * quality^qualityExponent[k]
                     * potencyMultiplier * (shiny ? 3 : 1))
birthSum = sum(birthStat[k] for all six stats)
```

- `qualityExponent`: **0.95** on HP and Speed, **0.8** on ATK, DEF, Sp.Atk, Sp.Def.
- `potencyMultiplier`: P1 **1.00**, P2 **1.05**, P3 **1.10**, P4 **1.25**, P5 **2.00**.
- Each IV is **1–32**; IV total **6–192**. An actual IV vector is better than the total.
- For current-level **combat stats**, the wiki adds `level/100` before rounding; grade uses the **level-100 birth-strength comparison**, so ordinary leveling alone does not improve N.
- The calculation clamps quality to **0.8–1.8** and potency to **1–5**. Refinement changes current bases without changing the species' unrefined grading endpoints.

Implementation sequence (important for matching the game's displayed N):

1. `somaStatsNascimento()` obtains the birth sum for the particular IV vector, quality, potency, shiny, and current refined bases.
2. `notaDeForca()` converts that sum to a **logarithmic 0–10 value** between reference minimum/maximum birth sums: `10 * (ln(sum) - ln(min)) / (ln(max) - ln(min))`, clamped and rounded to three decimals.
3. `scoreForca(..., { limitesRef: true })` divides that log grade by ten, using the module's neutral `REF_BASE` (80 for each stat) as the *reference* limits.
4. `limitesScoreEspecie(speciesBases)` finds the worst and best normalized score possible for **that species**, with IV=1/32 in each stat, quality=0.8/1.8, potency=P1/P5, and non-shiny/shiny.
5. `notaDeScore()` maps the Pokémon's score from those **species-specific** bounds onto **N=0–10**, with three-decimal rounding.
6. `notaPokemon()` applies the **evolution lineage floor**: take the maximum of the present form's N and each ancestor form's calculated N plus `0.1 * numberOfEvolutionSteps`, capped at 10. A mega-evolution counts as a lineage step where catalog metadata supplies it.
7. `notaDePokemon(pk, species)`/ `notaMercadoDoPokemon(pk, speciesMap)` are the appropriate shared entry points for the displayed/market grade when species data is present.

**Critical implementation cautions:**

- The wiki's short equation for N is a *description of the last species-normalization step*, **not** the whole formula. Upstream's nested log normalization, per-stat rounding, and ancestry rule matter.
- If `ivs` is unavailable, upstream's `ivsDeSoma(total)` distributes the total approximately evenly. That may help estimate N, **but cannot infer which IVs are actually high**. A valuation claiming “perfect ATK” from `iv=180` would be fabricated.
- Omitting `species` falls back to reference bases; omitting `notaAncestrais` drops the evolution floor. A Moth Watch reimplementation must either consume authoritative `ficha.nota` or reproduce the exact catalog-enriched calculation — **not** silently compute a different N.
- The ranking **⚔ power is not N and not a direct combat multiplier**: `poderDePokemon()` rounds `level * 10 * scoreForca(..., limitesRef=true)`. Refinement, species, and level affect ⚔. The wiki describes separate handling for Legendary/Mythical `×4`; the generic shared `notaDePokemon()` does not itself implement a Legendary/Mythical “INESTIMÁVEL” display. Do not apply the ordinary N formula blindly to those special categories.
- Upstream records `NOTA_FORMULA_VERSAO = 2`, `PODER_FORMULA_VERSAO = 5`; invalidate grade-dependent local caches if the formula/version or species bases change.

### Score labels

| N range | Wiki label (PT-BR) | Market reading |
| --- | --- | --- |
| 3.0–<4.0 | Razoável | 3.5 is the ordinary listing entry point |
| 4.0–<5.0 | Bom | May command a large premium; **not guaranteed** |
| 5.0–<6.0 | Forte | Strong birth-strength class |
| 6.0–<7.0 | Poderoso | Scarcer strength combination |
| 7.0–<8.0 | Mítico | Label, **not** Legendary/Mythical species category |
| 8.0–<9.0 | Lendário | Label, **not** Legendary species category |
| 9.0–10.0 | Divino | Extreme grade |

The full scale has 0–1 Extremamente Fraco, 1–2 Fraco, 2–3 Mediano. Compare exact three-decimal N, not just the displayed color; the wiki says boundary handling is conservative.

## 2. Independent rarity and usefulness axes

These are **birth properties** and normally cannot be rerolled by leveling or evolving. Rarity odds describe *supply*, **not a proven multiplier on market price**.

| Attribute | Wiki / upstream facts | Why a buyer may pay more |
| --- | --- | --- |
| **N= grade** | Species-relative strength score; the market gates ordinary listings at >=3.5 | Good top-line filter but inadequate as standalone value |
| **Potency P1–P5** | P1 74.5%; P2 20%; P3 5%; **P4 0.5% = ×1.25 stats**; **P5 0.005% = ×2 stats** | Permanent, all-stat bonus; P5 also bypasses listing minimums |
| **Quality Q** | Independent draw, 0.8–1.8; 1.5–1.6 ≈5%; 1.7–1.8 ≈0.673%; exactly 1.8 ≈0.288%; deliberate no-spawn interval 1.6–1.7 | Affects all six stats, with stat-specific exponents; preserve three decimals |
| **Shiny** | 1 in 24,000 **capture attempts**, potentially 1 in 12,000 with Secret Lure; **×3 all stats**; rerolled IV sum >110 | Scarcity, cosmetics, combat value; bypasses grade/level minimum; **Gems only** in RMT |
| **IV vector** | Six independent 1–32 values; total up to 192; evolution retains IVs | High IV in relevant attack/defensive/cooldown stats can matter more than higher aggregate N |
| **Level** | No cap; affects combat stats, not ordinary birth grade | Saves training time but is often reproducible; compare within level ranges |
| **Refinement +N** | Costs stones, adds +1 species base per refined stat; cannot refine Speed | Permanent player investment; increases N, ⚔, and effective stats |
| **Evolution / Mega** | Changes species bases and typically N; minimum +0.1 each step | Evolution cost/accessibility, changed moves and combat role; should not pool across forms |
| **TM, held items, war medals, trophies** | TM/held items are **not part of N**; wiki says medals/trophies accompany transfer, skin does not | Potential additional market premium; requires separate inspection |
| **Legendary/Mythical** | Wiki states ×4 all stats and “INESTIMÁVEL” in calculator | Separate category; never price by extrapolating normal N |

**Important rarity nuance:** quality is independent of IV, potency, and shiny. P4 is not “Q=1.25” — P4 is a *multiplier* applied on top of the quality exponent. P5 shiny gives **×6** to all stats versus the same non-shiny P1, quality, IV, and level; the wiki states a Legendary/Mythical P5 shiny would receive **×24** when its separate ×4 applies.

For quality probabilities, prefer the more precise `BANDAS_QUALIDADE` from upstream over the wiki's rounded table; its 1.0–1.1 band is 34.03846%, for example. Likewise, **a P5 listing may be exceptionally rare without being automatically liquid at an arbitrary asking price.**

## 3. Combat utility: why the IV distribution matters

Sources: wiki *Combate* and [`shared/cooldown-golpes.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/cooldown-golpes.mjs).

- Damage uses an attacking and defending stat ratio: physical moves use **ATK/DEF**, special moves use **Sp.Atk/Sp.Def**. Formula stated in the wiki: `((2*level/5 + 2) * movePower * attackerStat/defenderStat) / 50 + 2`, then STAB (**×1.5**), type effectiveness, and random factor (**0.85–1**).
- Thus a **physical** build generally values ATK IV more than Sp.Atk IV; a **special** build generally does the opposite. Mixed movesets are a real case. Defensive and HP IVs matter for survival, not just offense.
- **Speed IV** matters for cooldown, *not running speed*: the base Speed stat gives up to 7% skill/ultimate cooldown potential, and IV 32 realizes all of it (IV 16 roughly half). The wiki additionally describes **0.01 second per Speed-IV point** reduction for the basic charge/global attack interval. A low N with excellent Speed and attack IVs can be attractive.
- **Move availability and types** determine which offensive stat is useful. [`assets/index/moves-index.json`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/assets/index/moves-index.json) supplies move `tipo`, `categoria` (`PHYSICAL`/`SPECIAL`), `power`, `cooldownMs`, and `aprendidoPor` entries. These are useful for *proposing* a species' combat role, **not evidence of the exact moves equipped or their live performance**. Its snapshot includes a `gerado` timestamp: check freshness.
- [`shared/tipo-efetividade.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tipo-efetividade.mjs) gives type effectiveness; species bases and available moves must be combined before suggesting “best IV”.
- Example **without invented prices**: physical species A with N=3.5 and ATK IV=32 could be more desirable to an attacker-focused buyer than the same species, potency, quality, and level with N=4.0 whose advantage is mostly unrelated IVs. Which is worth more **must be validated against completed sales**.

**Proposed role model, not an upstream rule:** derive each species' physical/special/mixed preference from its *actual* base ATK/Sp.Atk and its strongest usable move options, factoring cooldown, STAB and effects. Return a confidence value; do not simply decide by a 50/50 base-stat threshold or silently infer an exact build from species name.

## 4. Community Market mechanics relevant to fair price

Sources: wiki *Mercado da Comunidade*, *Todas as taxas*; upstream [`shared/nota-pokemon.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/nota-pokemon.mjs), [`shared/tabela-precos.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/tabela-precos.mjs), [`shared/taxa-mercado.mjs`](https://github.com/MOTHblank/pokeidle-upstream/blob/master/shared/taxa-mercado.mjs).

- **Eligibility:** `MERCADO_POKEMON_MIN = { level: 50, nota: 3.5 }`; compare **>=** for both. `motivoNaoAnunciavel()` explicitly bypasses both tests for **any shiny or P5**. The wiki's “only over 3.5 can sell” is accurate for typical eligible Pokémon but not these exceptions.
- **Currency:** `pokemonSoEmGemas(pk)` returns true only for shiny. A non-shiny grade 4+ is **not** inherently Gems-only. Coins and Gems must have **separate** pricing models; conversion is not a fixed built-in rate.
- **Trading:** 20 active listings/account; Pokémon are indivisible; each listing has **2-minute retention**, and competing requests during the first **3 seconds** after release enter a lottery. This affects execution feasibility but should not change a Pokémon's intrinsic attributes.
- **Historical comparables:** wiki says Pokémon price-table data covers **30 days**, with filters/sorts for grade, potency, total IV, quality, level, shiny, species and type; upstream exports `JANELA_PRECOS_POKEMON_DIAS = 30`. A 7-day sold average in the listing UI is a different summary. Treat *completed sales* as stronger pricing evidence than active asking prices.
- **Fees:** Pokémon in Gems use a **marginal** seller fee: 13% on first 500, 10% on 501–5,000, 7.5% above 5,000, with integer rounding. Pokémon in Coins have a flat **15% seller fee**. Wiki also lists **100,000 Coins/day Pokémon listing pension**, which influences seller net/holding time. The buyer pays the displayed listing price. Do not compare gross sales or seller net without labeling which.
- **Metadata transfer:** nickname, original catcher, medals and trophies accompany the Pokémon; skin does not. Purchased Pokémon arrive in Collection.
- **NPC prices are different** from player-to-player market prices. NPC resale value, the market listing floor and rare collectible value are not interchangeable.

The **3.5 floor creates selection bias**: ordinary below-floor specimens are absent from normal listings; high-N or unusual P5/shiny populations will have very different sample distributions. “Average of listed creatures” is especially misleading near 3.5.

## 5. What Moth Watch v0.1.51 did before the migration (historical baseline)

Source: [`addons/market-bot.user.js`](../addons/market-bot.user.js).

1. It requests `market.historicoGlobal` pages for Pokémon separately in `gold` and `orb`; it takes `line.ficha` and a positive `line.bruto ?? line.preco`. Default: **12 history pages**, **60-minute** refresh, **minimum 3 completed-sale samples**. It retains up to 200 prices per bucket and stores a local reference (version 1).
2. `pokemonBucketKeys()` uses `currency | speciesId | shiny | potency | level band`, falling back to `currency | speciesId | shiny | potency`. Level bands: <100, 100–499, 500–999, 1000–4999, 5000–9999, 10000–24999, 25000+.
3. Each reference uses the **median** of matching sales, not the mean. `handlePokemonListings()` compares candidate asking price to that median via `ratio = price / reference`, and reports it if below the configured discovery threshold.
4. The scanned Pokémon listings currently come from the first `market.listar` page for each currency. **Not all current listings necessarily appear in this scan**. Listings missing a completed-sale comparator are skipped.
5. No part of this Pokémon bucket/ratio calculation reads **N, per-stat IVs, total IV, quality, refinement, TMs or combat role**. Accordingly, a “discount” can be a false bargain if its matched sales had better IVs/grade; or miss a genuinely excellent Pokémon.
6. **Automatic purchase rules** are currently **fixed item rules**, off by default (`fixedRulesEnabled: false`); the script has a manual Pokémon purchase path. This research should **not** be read as authorization to add auto-buying for Pokémon.

`ficha` is passed through from game messages and might contain useful fields (e.g., `nota`, `ivs`, `quality`, `refino`), but **the exact fields present in both listing and completed-sale payloads have not been established from the available shared/client upstream mirror**. Verify an actual authorized, redacted response before designing a required field or storing real user IDs.

## 6. Remaining fair-price/reference model goals

**Principle:** first establish valid *comparable sales*; do not assign arbitrary multipliers such as “+25% price for P4” because **+25% stats is not +25% demand**.

### Tiered comparability, from strict to broad

1. **Identity and separate economy:** same `speciesId` (forms/Outland/Mega distinct), same `currency`, same shiny flag, same potency, and known comparable sale dates. Do not pool Legendary/Mythical with ordinary species, nor Gem and Coin prices.
2. **Grade and progression:** same or narrow neighborhood of **N** (for example, 3.50–3.59 versus 4.00–4.09, *illustrative bands only*); similar level band; similar refinement. If N is not provided, calculate it only with all required catalog metadata and the correct upstream formula version.
3. **Competitive build:** quality range, per-stat IV vector, species role, actual relevant offensive IV, Speed IV, defensive IV; distinguish TM and other tradeable extras when available.
4. **Sparse-data fallback:** progressively widen *one known dimension at a time*, show which dimensions were relaxed, show sample size/date/dispersion, and label the result **low confidence**. Never quietly equate a P5 sale with a P4 sale or pretend unknown per-stat IVs are average.

### Suggested output per listing

```text
Species/form | Level | N= | P tier | Quality | Shiny
IV: HP / ATK / DEF / Sp.Atk / Sp.Def / Speed | IV total
Role signal: physical / special / mixed / unknown (+ source/confidence)
Reference currency | Sold-price median | Date range | Matched sales
Comparable attributes | Missing attributes | Relaxed filters
Estimated fair-price RANGE (only if supported) | Confidence | Deviation
```

Pricing bands and confidence should be *empirically fitted* from observed sales (prefer robust percentiles / median, robust dispersion and sample counts). A single “ideal price” is falsely precise for Pokémon with few trades. If enough sales do not exist, show **“insufficient comparable sales”** or **“broad reference only”**, not a fabricated number. Asking prices may inform context, but are not completed transactions.

### Data availability map

| Need | Available now | Gap / next verification |
| --- | --- | --- |
| Exact N formula; rarity constants; listing gate | Upstream `shared/nota-pokemon.mjs` | Server/runtime catalog-version parity |
| Species bases and lineage | Upstream species catalog and `linhagem-nota.mjs`, `refino-stats.mjs` | Confirm catalog construction and finalized runtime bases used by both sides |
| Move categories, cooldowns and type chart | `assets/index/moves-index.json`, `shared/cooldown-golpes.mjs`, `shared/tipo-efetividade.mjs` | Exact moves/held TM on each sale; snapshot freshness; demand by build |
| Current and historical sale records | Moth Watch observes `market.listar` and `market.historicoGlobal` | Confirm real `ficha` payload completeness; pagination, timestamp, fees/grossness, retention |
| Score/quality/IV of individual sale | The *game's* calculator and price table display P·IV·Q·N | Confirm that full values and six IVs are transmitted, not just displayed or aggregated |
| True price premium for N=4.0, P4/P5, perfect attack IV | **No measured premium established** | Analyze completed transactions per species/currency and report confidence |

### Safe rollout / acceptance criteria

- **Documentation and observability first:** dump only field names, completeness counts and anonymized aggregates of the already received sale/listing messages; avoid leaking player IDs or persisting raw user data.
- **Pure deterministic grade helper:** use the upstream algorithm/version and test worst/best IV vectors, P1/P5, quality endpoints, shiny, ancestral floors, per-stat refinement, missing IV vector, and Legendary/Mythical exception handling. Compare to actual game N in multiple species/forms.
- **Backfill 30-day completed sales** within request-rate limits and the selected page ceiling, per currency; retain provenance and ages. Version local reference data when changing matching keys.
- **Read-only compare mode:** initially show N/IV/Q/P information and evidence-backed reference ranges. Keep current buying-rule defaults and guards unchanged. No experimental pricing should initiate a purchase.
- **Validate examples:** same species+P+level with N 3.5 versus 4.0; two same-N creatures with reversed ATK and Sp.Atk IVs; P4 vs P5; shiny vs non-shiny; refined vs unrefined; freshly evolved vs base; scarce/no sales; outlier sales; missing metadata.

## 7. Other wiki rules useful across this addon suite

These are wiki statements, not claims that all related server modules are present in the upstream mirror:

- **Hunt loop:** only one of up to five party Pokémon fights at a time; knocked-out wild Pokémon corpses remain **30 seconds** for capture; a full party sends new captures to the unlimited Depot. The game continues while its active tab/session remains running.
- **Map, training and progression:** trainer level unlocks hunts; Pokémon level changes combat stats. XP progression is cubic with no stated level cap. Evolutions depend on level and the right type stone; Outland-specific variant species do **not** evolve.
- **Capture:** shiny is rolled on each capture attempt, not revealed on wild spawn; IV, quality and potency are rolled independently on successful capture. Starter and Mystic legendary captures have separate birth floors — do not treat them as random ordinary catch cohorts.
- **Buffs:** the wiki says XP Boost, VIP, guild, events and Twitch/Kick bonuses multiply; they influence the *cost/time to level* but **do not modify an individual Pokémon's fixed birth grade**.
- **Other economy options:** stones have evolution and refinement demand; offer/sacrifice and NPC sale are different dispositions from community resale. Default auto-collection minimum is 3.5, with special protections for shiny, P5, refined and valuable Pokémon; do not conflate this with eligibility to list on RMT.
- **Community-market trading/rate limits:** sale locks, currencies, retention, completed-sale windows and fees matter more to a price watcher than client-side UI grade colors. Keeping scans light and honoring game response pacing is essential for long-running installations.

## 8. Do not claim without new evidence

- A guaranteed Coin/Gem or Gem/USDT equivalence for a particular Pokémon listing.
- A universal N=4.0 premium, a universal “best IV,” or a rarity-to-price conversion.
- That the current Moth Watch `ficha` contains each of the six IVs or authoritative N in every listing **and** historic sale.
- That `⚔`, N, level, IV total, and real battle DPS are interchangeable.
- That an upstream *client/shared* mirror proves server-side market query, executed price or full transaction history semantics.
- That a high-confidence or automated Pokémon buying model exists today.

**Code cross-reference:** `notaPokemon`, `notaDePokemon`, `notaMercadoDoPokemon`, `motivoNaoAnunciavel` (upstream `shared/nota-pokemon.mjs`); `anotarLinhagemDaNota` (`shared/linhagem-nota.mjs`); `basesComRefino` (`shared/refino-stats.mjs`); `pokemonBucketKeys`, `pokemonReferenceFor`, `addPokemonHistorySample`, `handlePokemonListings` (Moth Watch).
