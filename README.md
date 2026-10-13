# PokéIdle Addons Premium

Moth Watch **v0.3.1** lives in this repository. The standard `pokeidle-addons` controller does not install or update it automatically.

## Development roadmap

See [**Moth Watch roadmap**](docs/MOTHWATCH_ROADMAP.md) for the prioritized, 20-task implementation queue: purchase safety and protocol validation first, Pokémon pricing second, economy analysis third, and UI/distribution improvements throughout. The roadmap explicitly separates implemented v0.3.0 behavior from proposed work and unverified live-server assumptions.

## Moth Watch installation

Install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) in the desired Firefox profile. While signed in with access to this **private** repository, open [Moth Watch source](addons/market-bot.user.js), copy the script into Violentmonkey, and save. Do not keep an old Moth Watch copy enabled alongside it. The script contains premium `@updateURL` and `@downloadURL` metadata, but private GitHub raw endpoints might not be accessible to a userscript manager; manual updates may be necessary.

The script preserves its existing local settings keys. **Automated buying stays disabled for new profiles**. Each purchase rule can be individually toggled, but no rule will place an order until the master **Enable rule-based buying** switch is turned on.

## Rule-based purchases (v0.3.1)

Three groups are available in **Moth Watch → Automation**:

1. **Fixed item**: choose a specific item, currency, and maximum **unit** price.
2. **Any item**: choose Coins or Gems and the maximum **unit** price; for example, any item at or below **10,000 Coins per unit**.
3. **Pokémon**: choose **Any Pokémon**, **Shiny Pokémon**, or **P5 Pokémon**, Coins/Gems (Shiny requires Gems), and the maximum **per-Pokémon** listing price. For example, any Pokémon at or below **1,000,000 Coins**, or any Shiny at or below **5 Gems**.

All modes use the same reserves and per-purchase spending caps, plus optional **per-rule session/day spend and session purchase-count/quantity caps**, **account-wide session/day Coin/Gem ceilings**, global session purchase/quantity caps, and the **Pause all purchases** kill switch. **Zero means unlimited** for a cap, not zero permission. Existing rule authorization is unchanged. Day boundaries are UTC; the session persists through a page refresh in the same browser tab. Without a cumulative cap, an enabled category-wide rule may still exhaust available currency over multiple orders. Items are bought in available quantities bounded by affordability and all configured caps (a partial item lot may be purchased), while Pokémon are indivisible and bought one at a time. Only **one order can be pending** server confirmation. Every submitted order is journaled under a non-identifying account-specific key in the browser profile, with quoted upper-bound spend reserved. A new authenticated account loads its own journal; the raw player nickname is not stored in the key. Run only one active Moth Watch buying tab per game account: concurrent tabs lack server-backed idempotency and cross-tab transaction locks. A purchase without a matching authoritative acknowledgement becomes **unknown**, including across refresh/reconnect, and is never blindly retried for the same listing. Matching late acknowledgements/refusals can resolve it; balance changes and timeouts cannot.

**These are absolute-price rules, not value predictions.** A Pokémon can qualify even without reliable grade, IVs, or completed-sale history. No arbitrary reference discount is required; the user-configured price is the explicit authorization. Moth Watch validates currencies and listing prices, skips your own ads and retained ads, and sends the listed unit price to the server. Server purchase acceptance remains authoritative.

The broad-item scanner uses the market's item summary to shortlist relevant item types, then verifies fresh individual offers at a bounded request cadence. Offers missing explicit quantity, seller, valid price or listing identity are not purchased; previously selected rules are rechecked at submission time. The Controller buy path cannot submit an unobserved, caller-supplied price as a verified quote. When Pokémon buying rules are active, it scans up to **three cheapest-price pages per currency**. It does not promise to inspect all listings or beat retention lotteries. Pokémon and Diamond listing scans are serialized; empty replies lacking the required kind/currency/page are discarded rather than guessed. Background acceptance pauses when the player browses the normal market. A request already sent before opening the native market can still be delivered to the game's own handler.



## Pokémon valuation

See [Pokémon valuation reference](docs/POKEMON_VALUATION_REFERENCE.md) for documented game rules and uncertainties. The pricing scanner uses completed sales, separate currencies, species/form, shiny and potency, and narrower comparisons for score/quality/IVs when the game supplies them. A coarse comparator is not an independently validated fair price. No fixed rarity-to-price multiplier is assumed.

Read [Milestone A protocol fixtures and verification status](docs/MOTHWATCH_MILESTONE_A_PROTOCOL_FIXTURES.md) for field-presence requirements, synthetic positive/empty/mismatched examples and what still needs authorized live-server verification. The journal uses quoted **maximum exposure**, not invented actual execution price/quantity or a presumed refund. Orders and server-side inventory/balance reconciliation have **not** been certified in live play.

Run the non-network tests with `node --test tests/moth-watch-automation.test.cjs`.

> **Private repository:** Direct `raw.githubusercontent.com` links and automatic updates may not work from userscript managers without authentication. For a reliable manual installation, open the file in GitHub while signed in, copy its contents into Violentmonkey, and disable previous copies. GitHub visibility alone is not a premium distribution system.

## Hunt Atlas experiment

The independent Hunt Atlas experiment is preserved under [`huntatlas/`](huntatlas/) at version **1.9.3**. This copy stays separate from the regular Hunt Atlas installed by `pokeidle-addons` and does not automatically synchronize with it. The original preview image, combat accuracy tests and Parcel Panic minigame tests have all been retained.

See the [**Hunt Atlas premium development roadmap**](docs/HUNTATLAS_ROADMAP.md) for the prioritized 27-task plan covering measured and modeled XP/h, net Coins/h, rare drops, eight Outland tiers, catch probabilities, ball costs, uncertainty and low-resource operation.

See [experimental Hunt Atlas instructions](huntatlas/README.md). To run its tests from the repository root: `node --test huntatlas/tests/*.test.cjs`.

## Technical reference documents

Research formerly held in `pokeidle-addons/docs` has moved to [`docs/`](docs/):

- [Auto Catch capture economics](docs/AUTOCATCH_CAPTURE_ECONOMICS.md)
- [Combat, moves, cooldowns and type effectiveness](docs/COMBAT_MODEL_CONTRACT.md)
- [Hunt rewards and rare loot](docs/HUNT_REWARDS_AND_RARE_LOOT.md)
- [Community Market protocol, fees and transaction safeguards](docs/MARKET_PROTOCOL_REFERENCE.md)
- [PokéIdle wiki/upstream mechanics map](docs/POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md)
- [Pokémon valuation reference — current premium edition](docs/POKEMON_VALUATION_REFERENCE.md)
- [Original public valuation reference — exact archived copy](docs/archive/POKEMON_VALUATION_REFERENCE_ORIGINAL.md)

The `pokeidle-huntatlas` repository itself has **not** been deleted; its experimental contents are archived here so it can later be removed without losing files.
