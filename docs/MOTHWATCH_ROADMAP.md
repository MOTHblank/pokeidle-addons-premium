# Moth Watch development roadmap

**Baseline:** premium Moth Watch `v0.3.0` (`addons/market-bot.user.js`), reviewed **2026-10-13**.  
**Scope:** market monitoring, opt-in buy rules, Pokémon/item valuation and an optional market-economy view.  
**Purpose:** implementation-ready work queue for future agents. These are **proposals, not completed features or scheduled release promises**. Check a task only after the relevant code/documentation is actually updated.

## Ground rules

1. **No surprise purchases.** `fixedRulesEnabled: false` remains the default; rules require a positive, explicitly configured maximum price, suitable currency, available balance and the existing buy guards. Adding a category-wide rule must never enable buying automatically. Preserve manual purchase functionality.
2. **No automatic selling.** Do not restore `market.criar`, removed auto-sell controls or retired percentage-based auto-buy. Adding *valuation* must not silently become authorization to buy anything.
3. **Never treat `send() === true` as a completed order.** A timed-out purchase is **unknown**, not failed. Do not blindly retry an uncertain transaction.
4. **Buyer price vs seller value are distinct.** `preco` is the **unit asking price** in Coins (`gold`) or Gems (`orb`); reserves and per-order caps are different limits. No guessed Coin/Gem conversion, no arbitrary rarity-to-price multipliers.
5. **Evidence before invention.** Wiki statements, inspected shared upstream code, implementation behavior and live-server evidence are separate tiers. Missing server handlers and fields must stay marked **UNVERIFIED**.
6. **Keep long-running profiles lightweight.** Reuse the authenticated game WebSocket and already-observed data; bounded queues, caching and rate-limit backoff instead of new high-frequency polling, additional sockets or DOM work every tick. PT-BR remains supported with EN.
7. **Testing division:** isolated deterministic tests/CI and documented reproduction cases are useful engineering checks; actual gameplay/purchases require user-led live verification. Never label synthetic tests as live purchase certification.

### Source documents (read before changing the corresponding subsystem)

| Document | Primary roadmap input |
| --- | --- |
| [MARKET_PROTOCOL_REFERENCE.md](./MARKET_PROTOCOL_REFERENCE.md) | Protocol envelopes, buyer-side confirmation, retention lottery, fees, budget rules, rate limits, verification matrix |
| [POKEMON_VALUATION_REFERENCE.md](./POKEMON_VALUATION_REFERENCE.md) | Accurate N/P/Q/IV comparisons, forms, rarity, completed-sale evidence, confidence and sale eligibility |
| [COMBAT_MODEL_CONTRACT.md](./COMBAT_MODEL_CONTRACT.md) | Physical/special roles, actual moves, Speed IV, TM/Mega/cooldown caveats when ranking Pokémon builds |
| [HUNT_REWARDS_AND_RARE_LOOT.md](./HUNT_REWARDS_AND_RARE_LOOT.md) | Rare-item classes, economic provenance, observed vs expected rewards and realized vs unrealized assets |
| [AUTOCATCH_CAPTURE_ECONOMICS.md](./AUTOCATCH_CAPTURE_ECONOMICS.md) | Consumable budgets, restock price provenance and single-count cost accounting |
| [POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md](./POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md) | Tradeability, house/bike/fragment mechanics, user restrictions and wiki-vs-upstream uncertainties |

The [archived original valuation reference](./archive/POKEMON_VALUATION_REFERENCE_ORIGINAL.md) is **historical**; do not roll back the newer v0.3.0 safeguards based on it.

## Present baseline — already implemented, not roadmap work

- **Buying:** specific-item rules, **Any item**, and **Any Pokémon / Shiny / P5** absolute-price rules. Shiny is Gem-only. The master switch is off for new profiles; per-rule toggles, currency reserves, per-purchase caps, cooldowns and one pending purchase exist.
- **Scanning:** item summary prefilter followed by `market.item` offers; Pokémon buying searches a **bounded maximum of three cheapest-price pages per currency**, only when a Pokémon rule is active. This is **not exhaustive**, and the server's live pagination/sort semantics remain unverified.
- **Market evidence:** completed Pokémon sales cached separately by species/form, currency, shiny status and potency, with N/Q/IV/level/refinement comparability where supplied; lower-confidence references do not become automatic buying criteria.
- **Resources:** background send spacing, rate-limit backoff, candidate/detail caches and scanning deferral during native market browsing. Current code carries a **5-second nominal watch scan interval**, **3-second minimum background-send gap**, **30-second closed-panel rule scan floor** and **15-second rate-limit backoff**. These are code settings, not guaranteed server quotas.
- **Checks:** `tests/moth-watch-automation.test.cjs` and the existing GitHub Actions workflow exercise local logic; no claim of completed live purchase protocol certification.

## Prioritized implementation queue

Legend: **P0** purchase correctness / player funds; **P1** trustworthy price comparisons; **P2** additional utility; **P3** UX/distribution. IDs give future agents stable task references. Suggested release trains indicate sequencing, not dates.

### Milestone A — Make v0.3.x purchase automation dependable (P0)

**Implementation update (2026-10-13, premium v0.3.1):** purchase safety and read-only fixture code landed in the [Milestone A implementation PR](../addons/market-bot.user.js). New-preset authorizations remain unchanged. This is **not** certification of server behavior or a claim that the milestone gate has been passed.

- **MW-01:** synthetic non-identifying fixtures, [field-presence matrix](./MOTHWATCH_MILESTONE_A_PROTOCOL_FIXTURES.md), and checks for missing/empty/mismatched response classes now exist. **Still blocked on owner-authorized redacted live packet shapes, observed game build/date and empty-reply semantics**.
- **MW-02:** one pending background `market.listar` scan, explicit kind/currency/page arbitration, strict empty-page handling, item detail request match and history reply checks have been implemented and covered by isolated fixtures. Native browsing cannot retract an already-sent WebSocket request; real interference cases need owner-led verification.
- **MW-03:** manual, fixed, any-item, Pokémon and Controller purchase paths now converge on guarded buying and an account-local prepared/submitted/confirmed/refused/unknown journal. Reconnects, late matching acknowledgements and duplicate events are handled conservatively. Unknown orders block additional purchases and reserve their quoted upper-bound exposure. **Actual executed unit price/quantity, partial-fill and inventory reconciliation remain unsupported without authoritative response fields; do not claim them**.
- **MW-04:** optional per-rule session/day price budgets, per-rule session purchase/quantity caps, account-wide per-currency session/day ceilings, total session purchase/quantity caps, and a pause switch exist. Zero explicitly means unlimited; old profiles do not gain buy authorization.
- **MW-05:** require a server-derived quote no older than 30 seconds, explicit listing ID/currency/quantity/seller/price, owner/hold checks and a rule recheck at send time. Unknown Pokémon properties do not trigger category automation; Controller-only unsourced quote submissions are refused. Server changes **after** the last verified quote remain server-authoritative.
- **MW-06:** hard bounds on candidate/detail caches and queue size, 3-second background spacing, a rotating any-item target cursor, serialized Pokémon/Diamond requests, history timeouts and existing rate-limit backoff. **Still requires hours-long CPU/memory measurements and native-market interaction testing**.
- **MW-07:** README, operator EN/PT-BR statuses, pause/budget UI and [protocol reference](./MARKET_PROTOCOL_REFERENCE.md) have been updated. A missing/unknown response is displayed as uncertain, not as a failed order.

**Gate remaining:** deployed empty-page packet shapes, authoritative purchase/partial-fill receipts, live balance/inventory reconciliation and 24-hour resource behavior need **owner-led live validation**. Synthetic CI tests are not live trading evidence.

**Deliverable:** price-ceiling rules can be left running without ambiguous outcomes, runaway spending or interference with the native market.

- [ ] **MW-01 · Read-only market protocol fixtures.** Capture or request *redacted, authorized* examples of `welcome.mercado.catalogo`, `market.itens`, `market.item`, Pokémon/Diamond `market.listar` (including **empty and paginated** responses), `market.historicoGlobal`, hold/release and `marketComprado`/refusal packets. Persist **field-presence matrices and synthetic fixtures**, not nicknames, IDs identifying accounts, authentication tokens or raw transcripts. Record observed build/date and what remains unknown. **Done when:** the decoder/normalizer has explicit positive, empty, missing-field and mismatched-response cases. **Depends on:** access to redacted live samples for claims about deployed behavior. **Source:** Market Protocol §§2, 6, 11–12.

- [ ] **MW-02 · Request/response arbitration.** Centralize attribution for pending item detail, item summary, Pokémon pages, Diamond pages and historical pages. Do not let `aba:'vitrine'` with missing `tipo`/`moeda` or an empty `linhas` array be misread as the wrong active scan; prevent scanner responses from overwriting the player's native market browsing. Validate expected page, currency and kind wherever the server supplies them. **Done when:** reordered, late, missing-field, manual-browse and timeout fixtures cannot contaminate another cache or advance an unrelated scan. **Source:** Market Protocol §§6, 10–12.

- [ ] **MW-03 · Durable order lifecycle and reconciliation.** Make all buy paths (manual, fixed item, Any item, Pokémon and Controller bridge) follow one auditable state machine: validated → submitted → confirmed/refused/**unknown**. Keep uncertain listing attempts protected across refresh/reconnect as appropriate; reconcile executed quantity, executed unit price, inventory and balance **only from authoritative evidence**. Do not assume silence/refusal after five seconds or infer a refund. **Done when:** a matching `marketComprado` is the only success path; unrelated errors, duplicate packets, lost acknowledgements, partial fills and reconnects never produce unguarded duplicate orders. **Source:** Market Protocol §§3–5, 11–12.

- [ ] **MW-04 · Cumulative spending controls for broad rules.** Add optional, explicit **per-rule and total session/day Coin/Gem budgets**, purchase-count/quantity limits and a pause/kill switch. Distinguish lifetime/rolling spend from existing **per-order** caps. An unset cap must visibly mean *unlimited*, not zero spending. Store budget accounting per Firefox account; mark unknown purchases as **reserved exposure** until reconciled. **Done when:** several purchases across different listing IDs cannot bypass a configured aggregate limit; defaults and existing profiles do not gain auto-buy permission through migration. **Source:** Market Protocol §§5, 11 and Auto Catch §8.

- [ ] **MW-05 · Fresh-quote validation and rule safety.** Before order submission, require a valid positive listing ID, currency, server-quoted unit price, availability, owner exclusion, retention deadline, and safe quantity. Re-evaluate the exact matching rule at submission time after config edits. Handle missing `ficha.shiny`/`potencia` without inventing attributes; never buy a known Coin-priced Shiny. Clearly define whether a multi-unit item lot is partially purchased or skipped at a budget boundary. **Done when:** stale details, edited rule prices, invalid quantity, seller self-match, newly extended hold and unknown category fields fail closed. **Source:** Market Protocol §§3–5, 9, 12; Valuation §§2, 4.

- [ ] **MW-06 · Bounded and fair scan scheduling.** Measure requests and memory in an hours-long session. Avoid a category-wide rule repeatedly walking/queuing every catalog item in one tick; bound pending details and in-memory offers, prioritize manual inspection and actionable rules, expire stale data, and back off on rate limits. Treat cheapest-page pagination as a **bounded sampling window**, not full market coverage; retain a cursor/fairness policy so large catalogs and multi-currency rules do not starve one another. **Done when:** no overlapping scans interfere with native browsing, network attempts remain bounded under large catalogs, and CPU/RAM stay near the existing idle baseline. **Source:** Market Protocol §§10–12.

- [ ] **MW-07 · Correct the current docs and operator cues.** Remove stale statements that Pokémon purchases are *manual-only* in earlier Market Protocol sections, distinguish historical versions from v0.3.0, and document first-page/three-page limits, rule authorization, fees and unknown outcomes consistently. Surface meaningful statuses: *waiting for game*, *stale quote*, *rule paused*, *budget blocked*, *awaiting acknowledgement*, *unverified*. Avoid constantly updating noisy timer text. **Done when:** README, in-script EN/PT-BR labels and current docs agree on what can actually buy. **Source:** Market Protocol §§5, 9–12 and v0.3.0 README.

**Suggested first implementation sequence:** **MW-01 → MW-02 → MW-03 → MW-05 → MW-04 → MW-06 → MW-07**. A read-only protocol inspection is not permission to make live purchases. Existing fixed-item behavior and test coverage should remain intact.

### Milestone B — Evidence-backed Pokémon pricing (P1; proposed v0.4.x)

**Deliverable:** useful, inspectable **price ranges** rather than a deceptively precise “ideal price.”

- [ ] **MW-08 · Typed Pokémon facts and provenance.** Normalize species/form, currency, shiny, P tier, game-authoritative N, Q, level, six named IVs, refinement and optional transferred metadata. Identify fields available in **listings vs completed sales**, with source, collection date and missing reasons. Do not recalculate N from guessed fields; only reproduce upstream `notaPokemon` with validated versioned catalog/lineage/refinement inputs when necessary. **Done when:** incomplete packets produce explicit unknowns, not fabricated N, P1, Q or IV arrays. **Source:** Valuation §§1–4, 6; Market Protocol §6.

- [ ] **MW-09 · Improve comparable-sale selection.** Keep currency, species/form, Shiny, potency and meaningful N boundaries separate; refine comparisons by level, Q, build IVs and refinement **only when observed**. Add sale-age windows, sample counts, percentiles/dispersion and transparent relaxation of filters. Prefer observed completed prices over asking prices; keep frozen fallback/active median distinctly labeled. **Done when:** N≈3.5 and N≈4.0, P4 vs P5, Shiny vs non-Shiny, opposite ATK/Sp.Atk builds, old/outlier sales and no-sale cases never silently share a “high-confidence” price. **Source:** Valuation §§2, 4, 6; Market Protocol §7.

- [ ] **MW-10 · Combat-role-aware comparison, read-only.** Optional physical/special/mixed/**unknown** role signal from species stats, actual normalized moveset, cooldown exceptions, type and Speed IV. Use observed equipped moves where possible; otherwise mark stale index/cold-start approximations. **Never** treat static move names as unique definitions, double-reduce cooldowns, or confuse per-hit AoE events with one cast. **Done when:** relevant IVs affect *comparison annotations* with stated confidence, but never authorize an automatic purchase or assign an unsupported price premium. **Depends on:** MW-08 and verified move/state data. **Source:** Valuation §3; Combat Model §§4–8, 10–13.

- [ ] **MW-11 · Better listing evidence and scarcity handling.** Display N/P/Q, total and relevant individual IVs, collectible flags, matched-sale count and age, reference median and defensible price interval. Separate Legendary/Mythical, Mega/evolved forms, TM/held extras and rare P5/Shiny niches. If empirical comps are insufficient, say **“insufficient comparable sales”**; rarity odds do not by themselves determine buyer demand or liquidity. **Done when:** reference source/limits are visible and the UI cannot display a broad species estimate as a guaranteed bargain. **Source:** Valuation §§2–6.

- [ ] **MW-12 · Read-only “deal inspection” vs absolute-price buying.** Keep discovery/valuation signals and user-owned buying rules in separate code and UI paths. Offer a preview of which rules **would match**, which limits apply and why an opportunity does **not** qualify. An analytical recommendation never toggles `buyEnabled`, changes `buyMax` or sends `market.comprar`. **Done when:** reference model changes cannot silently modify transaction behavior. **Source:** Valuation §6; Market Protocol §§4–5.

### Milestone C — Real economy context, without speculative automation (P2; proposed v0.5.x)

**Deliverable:** explain item value and market exposure without conflating market asks, NPC sale value or expected hunt loot.

- [ ] **MW-13 · Item provenance/tradability matrix.** Normalize catalog IDs and category for ordinary loot, evolution stones, TMs, Bronze Boss Tokens, fragments, crafted houses/bikes, eligible Diamonds and other collectible assets. Label RMT eligibility **only when verified** by the game/catalog, not from name similarity or NPC `priceGold`. Treat Diamonds purchased in the market as distinct from Diamonds eligible for resale. **Done when:** unsupported/NPC-ineligible assets cannot acquire fictitious player-market or NPC valuations. **Source:** Hunt Rewards §§3, 10, 12; Market Protocol §9; Wiki Mechanics §§5–6.

- [ ] **MW-14 · Transaction and fee breakdown (read-only).** Separate **buyer gross spend**, listing gross, seller net after exact verified commissions, optional upfront Pokémon holding cost (100,000 Coins/day) and unrealized holdings. Use the shared Gem marginal fee formula (including integer rounding), validate Coin rounding before promising exact payouts, and keep currencies separate. **Done when:** examples around the **500 / 5,000 Gem fee brackets** are correct and no seller receipt is counted at buy time. **No auto-sell.** **Source:** Market Protocol §§8–9; Valuation §4.

- [ ] **MW-15 · Optional inventory value and liquidity dashboard.** Show recent **completed-sale** references for assets already held, with provenance, freshness and uncertainty. Do not value inventory as realized Coins/Gems, promise an “instant sale,” or count both currency alternatives. Mark scarce/no-sale categories **unknown**. **Done when:** realized purchase history, estimated asset value and market exposure have non-overlapping totals. **Source:** Hunt Rewards §§10, 12; Market Protocol §§7–8.

- [ ] **MW-16 · Optional farming-cost context, not a buy signal.** If needed, consume already-available native session/Hunt Atlas/Auto Catch+ telemetry to distinguish hunt Coins, NPC auto-sales, rare-drop EV, confirmed capture receipts and ball/potion/revive replacement costs. Treat expected rare drops as stochastic, and do not count `ouroVendaAuto` twice. Avoid adding another browser observer or high-frequency polling. **Done when:** values always carry a unit (Coins, Gems, units/h), source (*observed* or *modeled*) and uncertainty, without changing market buying rules. **Depends on:** MW-13/15 and a shared, versioned, low-resource telemetry contract. **Source:** Hunt Rewards §§9–12; Auto Catch §§8–10; Combat Model §§9–10.

### Milestone D — Operator experience and private distribution (P3; alongside earlier milestones)

- [ ] **MW-17 · Rule safety and usability audit.** Clear EN/PT-BR descriptions for *any item*, *any Pokémon*, *Shiny* and *P5* rules, spend-per-unit vs per-order vs cumulative limits, currency, active/paused status, and the limited market-page coverage. Warn before enabling potentially broad buying when budgets are unlimited. Preserve settings during migration; do not show stale data as “currently eligible.” **Done when:** a user can explain exactly which offers a rule can buy, why it did/did not act, and what money it can spend.
- [ ] **MW-18 · Diagnostics and lightweight verification.** Add opt-in **redacted** protocol diagnostics (schema keys, counts, timing, source confidence) and deterministic replay scenarios for timeouts, holds, duplicate orders, cross-currency attribution, partial lots and 24-hour idle resource usage. Never persist raw account credentials or full buyer/seller identity. **Done when:** regressions are reproducible without live-market orders, and a user can provide a small sanitized failure report.
- [ ] **MW-19 · Private updates/distribution.** Decide how authorized users install updates while the repository stays private; a bare `raw.githubusercontent.com` metadata URL is **not** a reliable authenticated Violentmonkey update channel. Provide a documented manual-install/release path first, then implement authenticated distribution only if required. Never publish private source or keys merely to make auto-update work. **Done when:** installation and upgrade instructions match the actual repository/access model.
- [ ] **MW-20 · Refactor and release hygiene.** When earlier milestones stabilize, break the large userscript into clearly testable modules (market transport, normalized data, rules, order lifecycle, pricing, view), while preserving a single distributable Violentmonkey userscript. Reconcile stale version-specific claims in all docs; keep normal non-buying operation working. **Done when:** no hidden stubs, no extra permanent sockets, no silently dropped capabilities, and release notes distinguish **tested in isolation** from **confirmed in the live game**.

## Milestone gates and handoff

| Order | Exit conditions | Requires evidence beyond source tests? |
| --- | --- | --- |
| **A: transactional integrity** | Normalized requests and replies, conservative unknown orders, controllable cumulative exposure, safe broad-rule scanning | **Yes** — real packet shapes and eventually a user-led live buy check |
| **B: trusted pricing** | Empirical comparables and ranges with source/sample/age/unknown fields, read-only role annotation | **Yes** — real redacted sale/listing metadata and date provenance |
| **C: economy context** | Valid asset categories, fee gross/net accounting, separated realized/unrealized totals | **Some** — verified item IDs/catalog and seller settlement semantics |
| **D: release quality** | Coherent UI/docs, bounded diagnostics/CPU/RAM, reproducible isolated checks and private distribution instructions | **Yes** for actual install/update behavior |

### Working instructions for the next agent

1. Read this file and the cited section(s) **before** touching code; inspect the latest default-branch source rather than assuming this 2026-10-13 baseline is still current.
2. Select the **next unchecked P0 task**, write a narrow implementation plan, and keep existing working rules intact. Complete closely related tasks together only when they reduce risk, not simply to maximize changed lines.
3. Favor **pure helpers**, bounded queues, and explicit state transitions. Do not add new polling as a shortcut for missing facts. Always preserve Coins/Gems separation and the default-off buying master switch.
4. Update this roadmap's task checkbox and a brief evidence/behavior note only after implementation; clearly flag unresolved **UNVERIFIED** points. Never claim server transaction success based on synthetic tests.
5. Keep gameplay testing **user-led**. Run available quick deterministic/CI checks where practical but do not substitute them for live verification or invent live validation outcomes. Prefer direct, reviewable default-branch changes; do not leave unmerged PRs without explicit reason.

**Non-goals until explicitly requested:** automatic sales, automatic percentage-based purchases, an unconditional AI-driven Pokémon sniper, automatic Coin↔Gem conversion, per-frame combat simulation inside Moth Watch, bypassing the game's retention lottery or restrictions, and public release of a private addon.
