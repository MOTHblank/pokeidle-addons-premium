# Moth Watch Milestone B — Pokémon pricing evidence contract

**Implementation:** v0.4.0, 2026-10-13. **Evidence level:** source-informed, deterministic tests and synthetic examples; **not** a certified live-market packet format. This document records how the read-only pricing analysis makes uncertainty visible.

## Normalized observations and permitted provenance

| Field | Listing (when supplied) | Completed sale (when supplied) | Missing behavior |
| --- | --- | --- | --- |
| Species identity | `ficha.speciesId` or `pokeId` | Same | No comparable bucket |
| Explicit form | `formId` / `formaId` | Same | Separate `?` form bucket; never mix with known forms |
| Shiny / potency | `shiny` boolean, `potencia` 1–5 | Same | No identity key; never treat missing as ordinary/P1 |
| N grade | Game-supplied `ficha.nota` | Same | N unknown, comparison context only; never approximate from total IV |
| Q, level, IVs | `qualidade`/`quality`, `level`, six named `ivs` stats | Same | Unknown, not zero/low band; IV array without verified order rejected |
| Refinement | `refino` with six named stats | Same | Unknown, never assumed unrefined |
| Rare/extras | Nullable explicit Boolean Legendary, Mythical, Mega, TM and held flags | Same | Unverified, high-confidence pricing prohibited |
| Sale price | Asking `preco`, **not** a sale | Positive integer completed-sale `bruto` or `preco` | No reference |
| Sale time | Listing observation time (not sale time) | Tentative `vendidoEm` / `soldAt` | **Undated**; never mislabel retrieval time as time of sale |
| Collection time | In-memory last observed listing scan | Timestamp when history page was fetched | Evidence freshness shown separately |

The form identifiers, transfer metadata, sale timestamp aliases and collectible flags **require owner-authorized redacted live examples** before they can be considered verified field names. No personal nicknames, seller IDs, unique Pokémon IDs, authentication data, full packets or purchase orders are persisted as valuation evidence. Unknown accessory metadata is **not** equivalent to not having that accessory.

## Reference calculation (read only)

- v3 sale-cache key includes **currency, species ID, explicit/unknown form, Shiny boolean and P tier**. v1/v2 caches are invalidated because they lack required provenance. No automatic migration can reconstruct unseen timestamps, missing forms or special-asset flags.
- Historical pages hold a bounded maximum of **200 non-identifying samples per bucket**. Known sale dates over **90 days** old are excluded. Unknown dates can contribute a *contextual* historical price, with a visible date warning and reduced confidence.
- Comparisons start with exact N half-point class, level band, Q, six named IVs, and refinement when observed; later stages explicitly relax requirements. Unknown data never manufactures N/Q/IV/P. N=3.5 and 4.0 are different classes, and distinct currencies, P tiers or forms cannot share a sales bucket.
- Report the number of matched and available bucket sales, match stage, median, interquartile range (P25–P75), P10–P90, dispersion ratio, number of dated sales and last/oldest sale dates when supported.
- An actionable *display-only bargain signal* requires recent dated completed sales (within **30 days**), a fresh history snapshot (within **24 hours**), complete explicit collectible/form flags, sufficiently low price dispersion (P75/P25 ≤ 1.75) and matched N grade. This **does not permit or initiate a buy**. Undated, stale, broad-species and rare metadata-limited comparisons remain contextual. These thresholds are conservative heuristics, **not market price guarantees**.
- No Coin ↔ Gem conversion, rarity-to-price multiplier, species-to-species pooling, or estimation of server-only executed price is used.

## Combat signal boundaries

The inspection UI may annotate role as **physical, special, mixed, or unknown** from explicitly supplied equipped-move categories (`movimentosEquipados` / `equippedMoves`). If unavailable, directly provided positive base ATK/Sp.Atk values can yield an **indicative** signal, not an equipped-build assertion. Relevant ATK, Sp.Atk and Speed IVs are shown **without assigning a price premium**.

The actual deployed equipped-move schema, move IDs, type advantage, STAB, cooldown exceptions, TMs, held modifiers and transfer metadata are not yet verified for both sales and listings. No inferred damage/XP or cooldown-adjusted price is calculated; full MW-10 combat-role comparison still needs further verification.

## User-visible inspection and separation of concerns

Open **Moth Watch → Pokémon price evidence**. It displays at most **60 sampled listings** taken from the existing Pokémon scanner and never adds an extra socket or scans the entire market. With price rules enabled the scanner samples at most three cheapest-price pages per currency; without them it observes only a recent page. The interface explicitly distinguishes observed asking price, completed-sale median/range, unknown/stale prices, sale-age evidence, collectible flags, missing data, and a **non-binding rule preview**.

The preview describes configured category rules, their maximum absolute price and relevant pause/currency/spending/hold/identity checks. It never toggles rule settings or calls `market.comprar`. The actual purchase engine still enforces independent server-quote, balance, journal and rule guards. **The preview is not a promise a later order will fill**; listings, holds, price and balance can change after observation.

## Validation and handoff

Run `node --test tests/moth-watch-automation.test.cjs`. Deterministic tests cover form/P/shiny/currency partitioning, grade and IV mismatches, outliers, stale/undated samples, price-stage fallback, role provenance, and non-mutating rule preview. **No live sales or buying tests have been performed.**

When validating against real server packets, record only redacted key-presence matrices (with observed game build/date), date units, true **sale** timestamp provenance, form and asset flags, equipped-move sources, and whether listings/sales supply the same facts. Do not insert full player-specific market transcripts into the repository. Never initiate a live purchase solely to test read-only valuation.
