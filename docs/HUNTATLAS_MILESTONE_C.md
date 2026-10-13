# Hunt Atlas Milestones B refinement and C — XP accuracy and Coins economy

**Premium experimental userscript:** 1.9.6 · **2026-10-13** · **synthetic regression only**, not live-game validation.

## Milestone B follow-through

- **Bonus expiration scoping:** explicit, plausible **Unix-millisecond** `expiresAt`/`until` fields can transition a measurement/prediction profile from active to expired *without waiting for a new packet*. Unverified timestamp units are not guessed. Bonus stack combinations and catch-up end-of-level splits remain read-only diagnostics, not modeled with invented multipliers.
- **Forecast cache correctness:** both combat-profile and hunt-estimate caches include the *effective* farming/bonus context. Changes to a source-confirmed scope expire stale predictions; measured trainer and active Pokémon XP remain distinct.
- Existing partial B work (per-cast AoE grouping, type/move evidence, physical/special-informed observed damage, first-attack Speed IV, rolling error validation, conservative ranking) remains. The deployed simulator's move readiness and full boost semantics are still unavailable in the shared mirror, so HA-05/07/08 are deliberately not called fully server-certified.

## Milestone C contract

| Output | Formula and actual provenance | Null/unknown behavior |
| --- | --- | --- |
| **Kill Coins/h** | Measured complete wild `morte.ouro` window first; otherwise `K × Σ spawnWeight × ouroPorKillDoNivel(mobLevel)` | Missing K or all level information → null. Catalog hunt level is a flagged fallback; never use `ouroDoNivel`. |
| **NPC loot EV/h** | `K × Σ spawnWeight × Σ p(encoded chance) × meanQty × npcPrice`, using locally **reconstructed** upstream species-loot rebalance and raw item catalog classification | If catalog/species/price/eligibility is incomplete, return null (and coverage %), not a fraction of the generic 15% balancing target. Not realized income. |
| **Realized Coins/h** | Complete measured wild kill Coins/h **plus** measured `ouroVendaAuto` on the same kill receipts | This auto-sale is *already realized*; never add it a second time as unsold inventory or speculative loot EV. Missing either receipt channel → null. |
| **Net Coins/h** | **Realized** Coins/h minus **replacement value** of accepted balls, potions and revives consumed over the same observed window | Null without complete realized receipts or known costs. **Not** wallet balance delta, not a book-keeping purchase expense, and no conversion from Gems/Diamonds. |

**Important conventions:** `ouroVendaAuto` counts exactly once, at receipt time. `NPC loot EV/h` is a separately displayed *potential NPC resale value*, never added to realized or net coins. An inventory item is not earned Coins until actually sold. Captures and wild kills use separate denominators. Missing means null, never zero. All displayed values describe a specific current loadout/hunt/bonus context and currently selected 15-minute rolling wall-clock rate, or an explicitly labeled cold-start model.

### Data sources and assumptions

- The current game provides normal-hunt `welcome.hunts` and the normal `batalha.ev` reward ledger. Its `welcome.catalogoBolas` and `welcome.itensCompraveis` may carry live prices; **only explicit numeric entries in those payloads** can value consumed balls/heals/revives. No guessed Poké/Great/Beast pricing, and no refresh/poll of the shop.
- Hunt Atlas already fetches cached `/assets/creatures*.json`. Version 1.9.6 loads `/assets/items.json` **once alongside the existing creature fetch**, with `force-cache` and no new interval or permanent socket. NPC ordinary-loot eligibility uses the shared server mirror's `itemVendavelAoNpc` conditions as a conservative *allowlist* for category `loot`, excludes evolution stones, dead imports, sold shop items and the known boss token. Unknown categories or price mappings are **not valued**.
- `shared/economia-drop.mjs` rebalances raw creature loot using per-species type-themed seeds, qty rounding/cap 20, the fixed 5%-rare-picture residual and capped kill-gold target. The embedded helper reconstructs this behavior on a **cloned raw** catalog entry. This is **not** necessarily the finalized deployed server table; displayed provenance remains *reconstructed static catalog, not live drop certification*.
- For ordinary loot weighting, the code currently uses **spawn `pontos`**. Per-species kill counters are recorded but the data does not yet establish a sufficiently representative species mix or complete source-level mob data; treat the predicted table as an approximation. Missing any weighted NPC value causes unknown EV, never optimistic normalization over the known subset.
- Wild `morte.ouro` vs `ouroVendaAuto` have separate completeness counters, preventing one missing channel from making a fabricated realized total. `goldValue` in the XP projection remains a compatible aggregate; the new economy fields are explicit and exposed in the read-only controller snapshot.

### Consumable replacement cost and inventory

- The existing server-event listener counts *accepted* `bola` once per corpse, `cura` and `revive` at their respective item IDs. It does **not** charge a second cost for purchases; `compra` is an acknowledgement, not another used ball.
- Consumable uses are aggregated into bounded 30-second time buckets for the same measurement window, with max 33 buckets per active profile. Separate ball/item pricing maps come from the running game's catalog. Unpriced use blocks a confident net result; a Diamond-only price is displayed as **Diamonds/h**, not free Coins and not converted to a Coins total. Missing or unlinked accepted ball events can also block net Coins/h, since their cost would otherwise be understated; the panel explains the missing evidence.
- If snapshot `balls`/`items` uses a known ID→quantity shape, current stock and runway at the observed usage rate appear in the details. A different/unknown snapshot shape yields no runway rather than invented holdings.
- **Net** uses an explicit *replacement cost* convention. It is not the observed wallet-balance delta: buying ten potions today and consuming one across hunts would otherwise be counted twice. Beast/Diamond rates stay separate, and the final net Coin result **does not** assert profit after unobserved fees, premium currency or market sales.

### UI and tests

The main Hunt Atlas filters now include **Coins/h from kills** and **net Coins/h (measured)** with normal ascending/descending sorting; missing values sort below known amounts. Hunt cards show the selected model/receipt basis. The farming panel shows all four income numbers and explicit source, cost, coverage, unknown-price, Diamond and stock caveats. The XP Top Five retains its own clear heading instead of silently becoming a Coins top five. PT-BR and English are supported.

Run `node --test huntatlas/tests/*.test.cjs` and `node --check huntatlas/hunt-atlas.user.js` in a repository checkout. `economy-milestone-c.test.cjs` tests 25,000-level gold cap, spawn-point weighting, 5%-encoded loot lines, NPC-ineligible items, nonmutation of raw loot, incomplete table coverage, partial price catalogs, no double counting and independent currencies.

### Outstanding live checks and next steps

HA-10/11 remain partial until a real profile confirms that the game's actual normalized loot, current shop prices and slot/consumable event semantics match the mirror. Unknown or incomplete prices must remain an explicit no-net outcome. A future verified native balance delta, market sale stream and per-species kill mixture should be added **without** treating loot EV as income. Milestone D (Outland rares) and E (accepted capture odds) remain separate future work.
