# Moth Watch Milestone C — conservative economy evidence

**Implementation:** Moth Watch v0.5.0, 2026-10-13. **Scope:** read-only economy interpretation; no automatic sales, no additional WebSocket sends, no new polling interval, no conversion of Coins to Gems.

## MW-13: asset provenance and sale eligibility

The game sends `welcome.mercado.catalogo`; Moth Watch records IDs and an **explicit category field** (`categoria`, `category`, `tipo`) only when supplied. Being named like a stone, TM, Boss Token, fragment, house or bicycle **does not itself prove** current RMT/NPC eligibility. A market-catalogued item is annotated as **in the market catalog**, not universally approved for the user's account to list.

`itemProvenance(id)` distinguishes: (1) observed membership in that authenticated server market catalog, (2) optional explicit server Boolean `vendavelRmt` / `marketEligible`, (3) optional explicit `vendavelNpc`, and (4) NPC price only with an explicit NPC-sellable flag and positive numeric NPC price. Unknowns stay null and do not become an invented sale price. Deployed field names/availability are not yet verified.

**Diamonds:** `diamondProvenance(origin)` never assumes secondary-market diamonds can be resold. Wiki/source rules distinguish card/PIX acquired diamonds, market-bought diamonds and reward/free diamonds; even a declared first-party origin must undergo authoritative server eligibility checks. Moth Watch never turns free or market-bought diamonds into an eligible seller balance.

## MW-14: gross, commission, holding and settlement

The separate fee simulator uses user-entered unit price × quantity as **hypothetical buyer gross / listing gross**. The buyer does not pay the seller commission on top. The simulator does not submit, create or modify an order.

For **Gem-denominated Pokémon** the commission is the game-shared marginal basis-points calculation:

```text
commissionGems = ceil((min(total,500)*1300
  + min(max(total-500,0),4500)*1000
  + max(total-5000,0)*750) / 10000)
```

Only a **single** final upward rounding applies. Item and Diamond transactions use `ceil(total*1500/10000)` in Gems, including partial purchases calculated from the **executed lot total**, not the unit price. JavaScript `BigInt` makes the numeric fee rounding exact for safe-integer input. Pokémon are single units.

| Gross, Gems | Category | Commission, Gems | Seller net, Gems |
| ---: | --- | ---: | ---: |
| 3 | Item | 1 | 2 |
| 500 | Pokémon | 65 | 435 |
| 501 | Pokémon | 66 | 435 |
| 5,000 | Pokémon | 515 | 4,485 |
| 5,001 | Pokémon | 516 | 4,485 |
| 10,000 | Pokémon | 890 | 9,110 |
| 1,200 | Diamond | 180 | 1,020 |

**Coin commission:** the rate is 15%, but the exact *server-side Coin rounding* remains unverified. The UI therefore reports the adjacent integer fee/net possibilities instead of falsely claiming an exact payout. The seller's optional **Pokémon holding cost** is 100,000 **Coins** per prepaid day (1–30) and appears **separately**; it does not reduce a hypothetical Gem seller net in-place or get added to the buyer's price. The game handles escrow/holds and seller credits; Moth Watch does not.

## MW-15: manually recorded holdings and purchase exposure

Open **Moth Watch → Economy & holdings**. Users can *optionally* register an item from the observed game market catalog, a quantity, and **one** reference currency. These are **manual what-if holdings**, not a synced bag, currently owned quantity, escrow, Depot content or settled seller proceeds. Up to 40 entries are retained **per authenticated game account** in account-separated local storage; switching accounts does not merge them. No external telemetry, nickname or personal Pokémon ID is stored in the holdings.

A manually recorded item receives a hypothetical gross estimate only when `market.itens.medias[itemId][currency]` has a positive **completed-sale 7-day weighted average**, at least **three units sold** and a snapshot fetched within **24 hours**. The frozen fallback, NPC sale value, active asking-price median, missing market catalog row, absent samples and unsupported currency produce **unknown**, not zero. Estimates are totaled independently in Coins and Gems; different currency alternatives are never added together or used to value the same item twice. These are *not instant sale/liquidity offers*, because listing time, buy-side demand and sale speed are not observed.

The confirmed purchase-exposure ledger uses **buyer-acknowledged** journal rows and their quoted **maximum** spend. Unknown/pending orders remain separate, refused attempts contribute zero. Neither journal category is seller income, actual settled spending, a guaranteed inventory receipt or mark-to-market gain. The plugin does not have authoritative item-by-item realized sales, exact partial-fill settlements or server-backed resale positions.

## MW-16: opt-in lightweight farming context

A producer can *optionally* expose an immutable or plain **versioned**, fresh snapshot at `unsafeWindow.MOTH_ECONOMY_TELEMETRY_V1`. Moth Watch **only reads it when rendering the economy tab** (bounded by its existing UI refresh), does not subscribe to new WebSocket events or request more game data. This is an integration contract, not a claim that the native session, Hunt Atlas or Auto Catch+ already publishes it.

```js
{
  version: 1,
  source: 'session',
  capturedAt: Date.now(), // ms
  windowMinutes: 60,
  huntCoinsIncludesNpcSales: true, // REQUIRED for net
  observed: {
    huntCoins: 12000, npcSaleCoins: 3000,
    ballsCoins: 1000, potionsCoins: 200, revivesCoins: 100,
    rareDropsUnits: 2
  },
  modeled: { rareDropExpectedUnitsPerHour: 0.5 }
}
```

Only snapshots younger than ten minutes with a valid positive duration (max 24 hours) are accepted; missing/invalid measurements display `?`. If `huntCoinsIncludesNpcSales` is `true`, `npcSaleCoins` is **not** added again. If `false`, explicit NPC sales are added once. When the flag is absent/ambiguous, net Coins are **unknown** instead of double counting `ouroVendaAuto`. Consumable **replacement costs** are subtracted only when all three observed values are supplied. Drop **expected value** is displayed separately in *units/hour*, never silently counted as realized income. No guessed currency conversion or rarity × market price model.

**Not yet integrated / verified:** a real producer for this bridge; captured Pokémon receipts and unusual costs; actual inventory counts; Diamond provenance packets; seller settlement rounding in Coins; freshness and market eligibility beyond verified presence. Owner-led live verification should use redacted field-presence matrices, not full user market packets.

## Tests and acceptance status

`node --test tests/moth-watch-automation.test.cjs` verifies bracket boundaries, unit-total fees, incomplete provenance, Coin rounding uncertainty, multi-account manual holdings, currency isolation, old/low-volume references, purchase journal separation and double-count-safe telemetry. CI passing is **not** live-game certification. No sell opcode, buy-limit alteration or new background worker is introduced.
