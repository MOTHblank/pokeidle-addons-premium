# Hunt Atlas Premium — development roadmap

**Repository:** `MOTHblank/pokeidle-addons-premium` · **Baseline inspected:** experimental Hunt Atlas **1.9.3**, 2026-10-13  
**Scope:** `huntatlas/hunt-atlas.user.js`, its isolated tests and documentation. The regular `pokeidle-addons` copy is independent and **must not** be assumed to receive premium changes.

## Goal and engineering rules

Evolve Hunt Atlas into a **trustworthy hunt and farming comparator**: trainer XP/h, active Pokémon XP/h, guaranteed Coins/h, ordinary NPC-loot EV/h, net Coins/h, individual rare drops/h, Outland tier selection, and species/ball capture odds. Recommend the best hunt for the **user-selected objective**, not an opaque single “best” score.

1. **Observed beats predicted**, but only for the matching hunt, lead/loadout, boost state and sufficiently representative window. Surface sample count, window length, coverage, freshness and meaningful uncertainty. Never relabel a cold-start baseline as observed.
2. **Different ledgers stay different:** trainer XP vs Pokémon XP; paid kill Coins vs auto-NPC-sale proceeds vs unsold inventory; expected rare items vs realized sale receipts; Coins vs Gems vs Diamonds; kill, accepted throw, boss victory and crafted-item denominators.
3. **Evidence labels are mandatory:** `observed-server/event`, `upstream-shared`, `wiki-derived`, `personalized-model`, `static-baseline`, `unknown`. The shared upstream mirror is not the entire deployed server. Unknown inputs yield null/“—” rather than zero or fabricated certainty.
4. **Low-resource by construction:** reuse the existing game WebSocket/session event stream, normalized game catalogs and bounded local samples. No new permanent sockets, per-frame calculations, high-frequency market calls, always-running simulation or duplicate listeners.
5. **Safe interaction:** predictive recommendations are read-only. Changing the active hunt or Outland tier must use a verified game action, honor trainer unlocks and switch cooldowns, and wait for state confirmation; never invent a packet name or silently switch areas.
6. Keep **PT-BR and EN**, saved filter compatibility, one active Hunt Atlas installation per browser profile, and the private-repository manual installation/update caveat. Testing in live gameplay is the user's responsibility; synthetic tests are not server certification.

## Inspected baseline — already implemented, not new work

- `hunt-atlas.user.js` **v1.9.3** replaces the Map with a searchable list, type/multi-weakness filtering, capture *ownership* filters, hunt navigation, market/NPC reference information and a Top 5 trainer-XP/h recommendation.
- The combat sampler watches `batalha.ev` for defeats/attacks, collects trainer/Pokémon XP, Coins including `ouroVendaAuto`, attack/cast samples and lead-specific records. `observedRates()` derives XP/h, Pokémon XP/h, Coins/h and kills/h from sampled kill intervals after at least two kills. This is a useful baseline, **not yet a robust downtime-aware session estimator**.
- `huntXpEstimate()` prefers observed values, then a personalized combat estimate when all weighted spawn targets have modeled HP/damage, then a labeled static baseline. Spawn-point-weighted model coverage, immunity safeguards, conservative AoE cast grouping and experimental diagnostics already exist.
- Predicted trainer/Pokémon XP/h is present; **predicted `goldValue` is `null`** in the normal model path. Existing `goldH` is an observed, aggregated number, not a modeled gross/net breakdown.
- Current code has **no Outland tier picker or tier-aware rare-drop comparison**; its `outland` references are mainly catalog/area and Parcel Panic. An Outland tier is not a separate hunt/map. No per-ball catch-rate estimation or accepted-throw/capture-yield forecast is implemented.
- `huntatlas/tests/accuracy.test.cjs` checks partial model coverage, immunity and cast grouping; `parcel-panic.test.cjs` covers the independent minigame. Preserve these capabilities and tests.

## Calculation contracts to implement

| Metric | Preferred basis | Formula/meaning | Important caveat |
| --- | --- | --- | --- |
| Kills/h | Sustained, session-matched accepted wild `morte` events | `K = acceptedWildKills / activeOrWallHours` with explicitly named denominator | Include travel, waves, healing, restock and offline gaps according to the displayed “active”/“wall-clock” rate; do not extrapolate an idle gap as productive time |
| Trainer XP/h | Event XP delta first; otherwise `K × weighted XP/kill × trainer multiplier` | `xpDoNivel(n) = floor(0.6*n²)+8` for `n<=150`, else `round(13500*(n/150)^1.25)` | Not the trainer's total-XP-to-level curve, not species `experience`, and not added to Pokémon XP |
| Pokémon XP/h | Actual `xpPokemon` event delta; otherwise separately modeled multiplier | Same base kill curve, **different** XP bonus stack | Extra house/held XP Share recipients are a separate optional ledger |
| Kill Coins/h | Observed `ouro` or `K × E[ouroPorKillDoNivel(mobLevel)]` | `round(36*max(1,n)^e)`, capped at level 25,000; `e=ln(6000/36)/ln(5000)` | Anchors: 36 at level 1; 6,000 at 5,000; **15,776** from 25,000. Do not use `ouroDoNivel` |
| Ordinary NPC-loot EV/h | Verified species loot table, probability encoding, quantity and NPC sell eligibility | `K × Σ_species(weight_s × Σ_line(chance/100000 × meanQty × npcSellPrice))` | `chance:5000` means 5%; use actual observed species mix if available; `alvoDropPorKill` is only a balancing target |
| Net farming Coins/h | Explicitly documented realized or replacement-cost convention | Paid kill Coins + **one** realization of NPC-sale proceeds − verified consumable costs | `ouroVendaAuto` is already included in the native kill receipt; never count it again as unsold loot or later income |
| Rare item units/h | `K × effectiveDropP × quantity` for **wild-kill** rolls | Keep each item and its probability source distinct | Expected counts are not guaranteed; boss loot is per **boss victory**, not wild kill |
| Capture success | Authoritative accepted throws by species/ball; fallback conditional wiki formula | `expectedCaptures/h = Σ acceptedThrowsPerHour(species,ball) × pCatch(species,ball)` | A corpse generally affords **one** accepted attempt; `kills/h` is not `throws/h` |
| Shiny captures/h | Eligible throws × shiny-roll chance × capture success, where validated | Wiki ordinary baseline `1/24000` per **eligible throw**, `1/12000` with Shiny Secret Lure | Outland shiny eligibility is disputed; shiny *seen* vs *caught* differs |

Use actual per-event mob levels when present; only substitute catalog hunt level as a flagged fallback. All probability fields use fractions in `[0,1]` internally and display percentages only at the presentation edge. Unknown, stale, or unverifiable bonuses must not silently multiply a prediction.

### Outland and other rare-drop contracts

Outland has **one shared map**, eight selectable tiers, the same normal level-150 spawn/XP/Coins foundation, and tier-specific rare chances. The inspected tier gates/multipliers are:

| Tier | Required trainer level | Rare-drop multiplier |
| --- | ---: | ---: |
| 1 | 150 | ×1 |
| 2 | 500 | ×1.25 |
| 3 | 1,000 | ×1.5 |
| 4 | 2,000 | ×2 |
| 5 | 4,000 | ×3 |
| 6 | 8,000 | ×4 |
| 7 | 16,000 | ×6 |
| 8 | 25,000 | ×8 |

**Before bonuses**, Bronze Boss Token has `p=0.0005` per Outland kill (0.05%) and Key/Shiny Stone fragments have `p=0.000005` each (0.0005%). Bicycle Fragment uses the same base/tier curve **according to the wiki**, but the server drop path is not established by the shared tier module: keep that provenance visible. Calculate each independently as `pEffective = clamp(pBase × selectedTierMultiplier × verifiedApplicableLootBoosts, 0, 1)`. **Do not apply the tier multiplier to XP, kill Coins, ordinary loot, catch chance, or Shiny Egg fragments.**

**Shiny Egg Fragment** is a *separate* non-Outland hunt-level ladder at level ≥5,000: `p=0.0000375 + (stepIndex-1)*0.0000015`, where `stepIndex` comes from the **fixed** upstream 30-level ladder; chance is zero in Outland or before level 5,000. Do not calculate this index from the current number of hunts. Ten fragments craft an egg; base incubation is 168 hours, not immediate sellable income.

For any rare wild drop with independent identical rolls: `E[units/h] = K × p × qty`; `E[hours/first] = 1/(K×p)` for unit drops; `P(at least one in N kills) = 1-(1-p)^N`. A mean waiting time is **not** a guarantee or pity timer. Where data permits, show chances of ≥1 drop in one hour and 24 hours, plus expected time to 10 craft fragments. Suppress waiting-time estimates when K or p is unknown/zero.

### Ordinary capture contract

The wiki's **conditional**, **not independently server-verified**, normal-hunt formula is:

```text
rarity = log10(max(100, normalizedSpeciesEconomicValue)) - 1
factor = 1 + rarity^3 / 17
rawP   = 0.0075 * (ballEfficiency / factor) * (1.4 - currentHP/maxHP)
pCatch = clamp(rawP * verifiedApplicableBonuses, 0.003, 0.10)
```

For a defeated body, `currentHP=0`. Nominal ball efficiencies are Poké ×1, Great ×2, Super ×3, Ultra ×4, Beast ×8; purchase costs and currencies must come from the **running NPC catalog** (Beast has no invented Coins price). The economic input is `valorEconomicoDe`-style **species** value, **not** a particular Pokémon's NPC resale value or Community Market asking price. Prefer authoritative in-game per-ball chance if its units/bonus semantics are verified. Mystic Arena uses its **own** capture table and may not share ordinary-hunt corpse semantics.

## Priority roadmap

Legend: **P0** foundational correctness/core rates; **P1** major farming functionality; **P2** optimization/UX. IDs are stable handoff keys. All boxes below are *proposed*, not claims that an implementation has shipped.

### Milestone A — Measurements and reproducible evidence (P0)

**Exit:** rates are explainable and measured performance cannot be accidentally inflated by short samples, source mixing, inactivity or stale profiles.

- [ ] **HA-01 · Evidence/protocol inventory.** Map observed `batalha.ev` `morte`, `bola`, `capturado`, `cura`, `revive`, `bossMorte`, session/account/hunt/tier fields and optional game-provided estimator fields. Capture small **redacted** field-presence fixtures, version/source labels and known missing values. Never log identity/auth tokens. **Done:** a documented decoder matrix covers absent, malformed, duplicated, delayed and reconnect cases. **Sources:** Hunt Rewards §§4,9–13; Capture §§3,10,14.
- [ ] **HA-02 · One normalized farming ledger.** Introduce pure normalizers for kill rewards, accepted throw, capture success, item use, inventory/auto-sale, rare rewards, and boost snapshots. Separate *observed* from *expected* data in typed structures even inside the single distributed userscript. Scope by account/profile, hunt, lead **instance/loadout**, Outland tier, catalog revision and effective bonuses. **Done:** no double-counted event, same-slot reused corpse, duplicate kill, unrelated player/boss death or prior profile leakage.
- [ ] **HA-03 · Correct rolling-rate denominators.** Replace reliance on the last ≤40 inter-kill intervals as the sole sustained-throughput estimate with explicit wall-clock vs productive-time windows, interval eligibility, switch grace, sample minimum, dropout/stale detection and old-profile expiration. Show “warming up” until enough representative kills/time accrue; do not extrapolate single fast fights into permanent XP/h. **Done:** a 10-minute empty/paused period and a reconnect are not reported as high sustained income.
- [ ] **HA-04 · Shared pure formulas and fixtures.** Add deterministic helpers for level XP, gold cap, loot encoded chances, Outland tiers, fixed Shiny Egg ladder, probability conversions and confidence labels, tested via the actual script or extracted testable modules. Check against exact document anchors; fix documentation/code divergence before expanding UI. **Done:** expected values reproduce the reference points and cannot turn 0.0005% into 0.05%.

### Milestone B — Better XP/h and combat estimates (P0 → P1)

**Exit:** accurate current XP readings plus calibrated, clearly marked cross-hunt forecasts for the actual lead.

- [ ] **HA-05 · Trainer vs Pokémon XP event accuracy (P0).** Treat native `xpTreinador` and `xpPokemon` as distinct event streams; track active bonuses/expiration for each, VIP, guild, streams, events and conditional catch-up separately. If a multiplier cannot be verified, display observed totals or the unboosted model, not a guess. Record transition kills spanning a catch-up threshold instead of multiplying entire sessions at one rate. **Done:** the UI never combines trainer and Pokémon XP into one purported training rate.
- [ ] **HA-06 · Lead/loadout and hunt-specific calibration (P0).** Partition samples on actual lead identity, level/IV/speed, move set, TM/Mega/AoE, target mix, hunt, buffs and meaningful state changes. Give measured rates precedence for the *same* profile only; do not apply an old high-DPS lead's calibrated multiplier as though it were the new lead. **Done:** changing lead, loadout, area or bonuses invalidates or explicitly downgrades predictions.
- [ ] **HA-07 · Combat simulation v2 (P1).** Use physical/special attacks, current types and game-specific hunt amplification, move readiness and fixed cooldown exceptions, Speed IV's distinct global-vs-skill effects, real AoE cast grouping, basic fallback, weighted mob HP, wave/movement/heal/death downtime and target selection. Avoid inferring exact cooldowns from packet-arrival gaps or counting several AoE victims as several casts. **Done:** no optimistic estimate from missing spawn-weight coverage; known immunities remain blocking; one-hit attacks include first-hit delay. **Source:** Combat Model §§2–10,12–13.
- [ ] **HA-08 · Confidence, validation and forecast error (P1).** Show source, weighted model coverage, sample count, window, observed-vs-predicted deviation, estimated range and fallback reason. Compare rolling predictions against later real hunt sessions, storing bounded anonymized per-profile residuals. Sort uncertain cross-hunt guesses below supported measurements when the objective difference is within noise. **Done:** “best XP hunt” cannot be asserted from a partial/unknown model without a visible caveat.

### Milestone C — Coins/hour and net farm economics (P0 → P1)

**Exit:** distinguish guaranteed kill payouts, ordinary loot, realized earnings and costs; comparable hunts have modeled Coins/h even without first visiting them.

- [ ] **HA-09 · Predicted guaranteed Coins/h (P0).** Implement `K × weighted gold-per-kill` using the correct capped `ouroPorKillDoNivel`, actual mob levels and measured/modelled K. Retain existing observed `goldH` but break it into `ouro` and `ouroVendaAuto` on ingestion. **Done:** cold-start prediction is non-null when K and levels are known; Gold(25,000)=Gold(160,300)=15,776 per kill; source explicitly says *modeled*.
- [ ] **HA-10 · Ordinary NPC loot EV (P1).** Normalize each species' finalized loot rows, probabilities/quantities and NPC resale eligibility/price, weighting by actual species kills where known or spawn `pontos` otherwise. Cache results by catalog version. Treat items not NPC-sellable as **zero NPC sale value**, and unverified prices/eligibility as **unknown**, not fictitious earnings. Do not substitute the 15% target curve as precise species EV. **Done:** both observed auto-sales and still-held loot cannot enter the same realized Coins total.
- [ ] **HA-11 · Consumption and net Coins/h (P1).** Reuse `bola`, `cura`, `revive`, server-visible inventory and the native Session ledger to show ball/potion/revive replacement expense, stock/runway and restock downtime. Distinguish *actual balance delta* from *replacement-cost-adjusted farm profit* so bought inventory isn't expensed twice. Keep Beast/Diamond use in its own currency column. **Done:** users can explain exactly why net differs from kill Coins and gross NPC-loot EV.
- [ ] **HA-12 · Four meaningful income numbers (P1).** Display **kill Coins/h**, **NPC loot EV/h**, **realized Coins/h** and **net Coins/h** with source/freshness badges in details; sortable **Coins/h** and **net Coins/h** where estimates are valid. No forced market connection and no compulsory item sale. **Done:** sorting uses the requested column, not a hidden trainer-XP proxy.

### Milestone D — Outland tier picker and rare farming (P0 → P1)

**Exit:** users can plan for all unlocked Outlands, safely select a real tier, and compare expected individual rare drops/h.

- [ ] **HA-13 · Outland tier state and unlocks (P0).** Resolve the player's selected tier from authoritative game state if exposed; distinguish it from the area/hunt ID and the min/max hunt-level filter. Use exactly 8 tier gates and `tierOutlandValido` fallback semantics. Normalize historical variant IDs `10501+` to `2001+` where relevant. **Done:** no phantom “Outland 2–8” hunt catalogs or false access to locked tiers.
- [ ] **HA-14 · Outland tier selection UX (P0).** Add an explicit Outland 1–8 selector with two states: **compare/preview tier** (read-only, even if currently elsewhere) and **active in-game tier**. Offer “Use this tier” only when a **verified native game command/UI action** exists; respect switch cooldown, disabled/locked state and confirm successful tier change from game state. If protocol support is absent, keep preview functional and clearly mark activation **unavailable**, never fake success. **Done:** selectors do not accidentally change the currently selected hunt or pretend a request succeeded.
- [ ] **HA-15 · Per-item Outland rare/h (P1).** Model Bronze Boss Token, Key Fragment, Shiny Stone Fragment, and **wiki-reported/unverified bicycle** chance for the chosen tier, measured/predicted K, and only validated Loot Boost/guild/event multipliers. Show units/h, mean hours/one, mean hours/10 where craftable, and actual observed item drops separately. **Done:** moving tier 1→8 alters rare odds ×8 at fixed K and does **not** alter XP/Coins/catch odds.
- [ ] **HA-16 · Shiny Egg Fragment predictor (P1).** Apply the frozen 30-step non-Outland hunt-level ladder, including levels not themselves in the original ladder; compute units/h and time toward ten fragments/one crafted egg, with separate 168-hour incubation delay. **Done:** Outland reports zero Shiny Egg fragments regardless of tier; level 5,000 gives `0.0000375` and 160,300 `0.000081` per kill before boosts.
- [ ] **HA-17 · Rare-drop uncertainty and achievement horizons (P1).** Show “chance of ≥1 in 1h/24h” and expected kills/time at the selected K, conditional on stationary independent trials. Add explicit caveat for unknown mutual exclusivity of distinct item rolls, long-tail variance, unseen boost stacking and unverified bicycle hook. **Done:** low probability is displayed correctly and mean hours is never described as guaranteed.
- [ ] **HA-18 · Optional read-only market valuation (P2).** If premium Moth Watch supplies trustworthy **completed-sale** samples, show item EV/h by **currency and sample age** beside item units/h, never as realized Coins. Do not infer an exchange rate or assume all rare items are saleable. Feature must work without Moth Watch, with missing prices shown “—”; no auto-buy/sell coupling. **Done:** absence of trades cannot transform a fragment into fictitious Coins/h. **Source:** Market Protocol; Pokémon Valuation; Moth Watch roadmap.

### Milestone E — Catch rates, ball economics and capture throughput (P1)

**Exit:** species-specific capture chances are explainable, capture throughput is grounded in accepted attempts, and ball recommendations depend on user objectives.

- [ ] **HA-19 · Validate source of capture probability.** Identify the current game species economic rarity input, normalized ball efficiencies/prices, target HP and active capture bonuses. Determine whether protocol `bola.chance` represents a fraction, percent, base or boosted chance; prefer verified runtime odds. Otherwise implement the **clearly labeled wiki-conditional** ordinary formula with 0.30–10% cap. Never substitute MKT, N, P, sell price of a particular specimen, or fabricated economic values. **Done:** unknown rarity or bonus semantics produce a warning/unknown rate instead of a precise percentage.
- [ ] **HA-20 · Capture event lifecycle and throughput.** Distinguish unique corpse lifecycle, client click/command, **authoritatively accepted throw**, consumed ball, confirmed capture, shiny seen, shiny caught, expiry/skips and reconnect unknowns; deduplicate delayed/reused slots. Derive targetable-body fraction and actual attempts/h from samples, with one-accepted-throw-per-defeated-corpse as the documented default. **Done:** a 100ms automation tick cannot be mistaken for 36,000 accepted throws/h; failed accepted throws do not magically produce new bodies.
- [ ] **HA-21 · Per-ball and per-hunt catch planner.** For each species and available ball show conditional catch %, expected captures/h, balls per capture, replacement Coins/capture or Diamonds consumption, stock reserves and hours of coverage. Support explicit priorities: **maximize catches/h**, **minimize Coins per successful capture**, **maximize rare target probability**. Include success-cap saturation and capture/restock downtime. **Done:** the optimizer does not always recommend the most expensive ball or assign a Coin cost to Beast.
- [ ] **HA-22 · Shiny/capture distinctions.** Separate shiny rolled/seen from shiny caught; use 1/24,000 eligible attempts as the wiki ordinary baseline, 1/12,000 when an applicable Shiny Secret Lure is verified, and multiply by actual capture chance only for **caught** projections. Mark Outland shiny eligibility **unresolved** until verified. Ordinary captures are not guaranteed to meet N≥3.5 market-sale eligibility or yield a high-value specimen. **Done:** no “one shiny per X kills” claim from attempts alone.
- [ ] **HA-23 · Special captures and level ceilings.** Keep normal hunts separate from Mystic Arena's server-derived ball table (Poké 0.1% … Beast 0.5%, before verified boosts) and ticket-per-attempt gating; support captured-level cap (evolution chain, level 100) as explanatory info without altering wild-combat XP/catch rarity. **Done:** no reuse of ordinary body formula in Mystic or use of captured level as wild level. **Source:** Capture §§5–6.

### Milestone F — Recommendation UX, performance and rollout (P1 → P2)

**Exit:** players can make defensible decisions without extra browser load or breaking long-running sessions.

- [ ] **HA-24 · Multi-objective rankings (P1).** Offer explicit sorts for **trainer XP/h, active Pokémon XP/h, kill Coins/h, NPC-loot EV/h, net Coins/h, selected rare units/h, capture success/h and ball-efficiency**. Respect unlocked hunts, Outland tier preview, existing search/weakness filters and stable sort direction; surface the relevant Top 5 for the **selected metric**. Avoid a single ungrounded synthetic “profit score.” **Done:** a weak rare/h candidate cannot lead the rare ranking just because it has high XP/h.
- [ ] **HA-25 · Compact hunt detail cards (P1).** Place measured/modelled labels, K/h, XP/h (trainer/Pokémon), Coins/h, net cost, chosen rare item probability/h, selected-ball catch chance and confidence behind a compact expandable layout. Explicitly show “no data”, “learning”, “unverified”, “not eligible” and “tier preview”; keep PT-BR default/EN and persistent filters, without a constantly blinking/recomputing XP display. **Done:** novice players can tell a single Outland map from its selectable tier and distinguish chance from guarantee.
- [ ] **HA-26 · Background cost budgets (P2).** Cache normalized catalogs and probabilistic computations by version/hunt/lead/tier/boost, cap event sample history and diagnostic snapshots, throttle UI redraws and only refresh predictions on meaningful state changes. Reuse existing optional indexes; do not add market scans to collect a cosmetic price. Preserve headless/Performance+ and the separate Parcel Panic minigame. **Done:** multi-hour sessions show bounded CPU, memory, event listeners and network requests relative to baseline.
- [ ] **HA-27 · Evidence-based diagnostics, QA and documentation (P2).** Add opt-in **local-only, redacted** estimate explanations (source, formula inputs, confidence, time window, current boosts, model coverage, discrepancies). Extend `huntatlas/tests/accuracy.test.cjs` with A–F regression fixtures, update `huntatlas/README.md` and this roadmap as tasks ship, and version any shared telemetry contract with Moth Watch/Auto Catch+. **Done:** test results never masquerade as user-led live verification; private script instructions and ordinary-vs-premium independence remain correct.

## Key deterministic regression scenarios

1. **Core math:** XP at levels 1 and 150 is 8 and 13,508. Gold at levels 1/5,000/25,000/160,300 is 36/6,000/15,776/15,776. Two XP streams never combine into one player rate.
2. **Loot accounting:** ordinary catalog `chance=5000` is 0.05 fraction. A drop forbidden for NPC sale contributes zero NPC-sale EV. A confirmed `ouroVendaAuto` is never added a second time or counted as unsold assets.
3. **Outland:** eight tier gates, multipliers `[1,1.25,1.5,2,3,4,6,8]`. Tier 1 token `p=.0005`; tier 8 token `p=.004`; tier 1 fragment `p=.000005`; tier 8 fragment `p=.00004`. Other normal kill rewards and catch rates are unchanged by tier alone.
4. **Shiny Egg fragments:** no Outland drops, none below level 5,000; fixed base `.0000375` at 5,000 and `.000081` at 160,300; adding an intermediate hunt level does not reindex the curve.
5. **Rare waiting time:** when K=0 or unknown, no invented ETA; `1/p` is a mean, with approximately 63% chance of at least one after that many independent kills, not certainty.
6. **Capture:** nominal efficiencies ×1/×2/×3/×4/×8 are subject to 0.3–10% final cap. A single accepted failure on a corpse cannot create a second new successful capture attempt; denied/time-out commands are separate. Changing ball/capture boost changes the correct objective only.
7. **Combat:** missing high-weight mob stats cannot yield a falsely complete model; distinct-target AoE hits from one cast count once; known immunity blocks the model; changing lead/loadout/hunt/tier/boost clears incompatible calibration.
8. **Downtime:** several fast kills followed by healing, no mobs, a 10-second hunt switch, reconnect or long absence cannot produce a bogus 24-hour income projection.
9. **Accounting:** market quotes in Gems are not Coins, realized revenue is not the same as expected unsold loot EV, and ordinary trainer XP cannot be added to Pokémon XP.
10. **Performance:** closed Atlas, a headless controller profile and an open minigame do not duplicate sockets/listeners or grow unbounded event buffers.

## Execution order and release gates

| Sequence | Work | Gate |
| --- | --- | --- |
| **A / first** | HA-01 → HA-04 | Event/probability contracts, bounded reliable sustained-rate samples |
| **B / core** | HA-05 → HA-06; HA-09 | Credible measured & predicted trainer/Pokémon XP/h and **guaranteed Coins/h** |
| **C / high-value** | HA-13 → HA-15; HA-10 → HA-12 | Safe Outland tier preview/activation where supported; rare/h and honest profit breakdown |
| **D / high-value** | HA-16 → HA-17; HA-19 → HA-22 | Shiny Egg and capture predictions with provenance and resource costs |
| **E / refinement** | HA-07 → HA-08; HA-18; HA-23 | Improved combat prediction, optional market EV, special-mode correctness |
| **F / polish** | HA-24 → HA-27 throughout | Rankings/UI/docs remain aligned, low resource usage, reproducible test cases |

Dependencies matter more than dates: **capture odds require validated rarity/bonus semantics**, **Outland activation requires a confirmed native game action**, and **sale-denominated rare EV requires trustworthy completed-sale prices**. Pure math, UI comparison and conservative fallback can ship independently of those unverified integration details.

**Working instructions for future development agents:** re-read this roadmap, the cited references and current premium source before implementation; take the next unchecked core task with its dependencies; implement several related tasks when useful, but don't just rewrite the plan. Keep isolated tests lightweight; gameplay/live-server validation remains user-led and does not block making engineering progress. Update task checkboxes only when genuinely implemented, disclose unverified details, and merge finished changes to the premium default branch rather than leaving open PRs.

## Source references (premium repository)

- [Hunt Atlas experimental baseline](../huntatlas/README.md) and [source](../huntatlas/hunt-atlas.user.js)
- [Hunt rewards and rare-drop economy](HUNT_REWARDS_AND_RARE_LOOT.md), especially §§2–4, 5–6, 8–12
- [Auto Catch probabilities and resource management](AUTOCATCH_CAPTURE_ECONOMICS.md), especially §§1–4, 6–10, 11–14
- [Combat model contract](COMBAT_MODEL_CONTRACT.md), especially §§2–10 and 12–13
- [Wiki/upstream mechanics map](POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md), especially §§1–5 and 8
- [Market protocol](MARKET_PROTOCOL_REFERENCE.md) and [Pokémon valuation](POKEMON_VALUATION_REFERENCE.md) for **optional**, evidenced market-based estimates
- [Moth Watch roadmap](MOTHWATCH_ROADMAP.md) for premium cross-addon boundaries
- Inspected upstream reference: `MOTHblank/pokeidle-upstream` (`shared/sell-value.mjs`, `shared/recompensa-hunt.mjs`, `shared/economia-drop.mjs`, `shared/outland-tiers.mjs`, `shared/ovo-shiny.mjs`, `shared/teto-captura.mjs`, `shared/mistico.mjs` and `hunt-analyser.mjs`). These are **versioned evidence**, not proof of live-server parity.
