# PokéIdle Addons Premium

Moth Watch **v0.3.0** lives in this repository. The standard `pokeidle-addons` controller does not install or update it automatically.

## Development roadmap

See [**Moth Watch roadmap**](docs/MOTHWATCH_ROADMAP.md) for the prioritized, 20-task implementation queue: purchase safety and protocol validation first, Pokémon pricing second, economy analysis third, and UI/distribution improvements throughout. The roadmap explicitly separates implemented v0.3.0 behavior from proposed work and unverified live-server assumptions.

## Moth Watch installation

Install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) in the desired Firefox profile. While signed in with access to this **private** repository, open [Moth Watch source](addons/market-bot.user.js), copy the script into Violentmonkey, and save. Do not keep an old Moth Watch copy enabled alongside it. The script contains premium `@updateURL` and `@downloadURL` metadata, but private GitHub raw endpoints might not be accessible to a userscript manager; manual updates may be necessary.

The script preserves its existing local settings keys. **Automated buying stays disabled for new profiles**. Each purchase rule can be individually toggled, but no rule will place an order until the master **Enable rule-based buying** switch is turned on.

## Rule-based purchases (v0.3.0)

Three groups are available in **Moth Watch → Automation**:

1. **Fixed item**: choose a specific item, currency, and maximum **unit** price.
2. **Any item**: choose Coins or Gems and the maximum **unit** price; for example, any item at or below **10,000 Coins per unit**.
3. **Pokémon**: choose **Any Pokémon**, **Shiny Pokémon**, or **P5 Pokémon**, Coins/Gems (Shiny requires Gems), and the maximum **per-Pokémon** listing price. For example, any Pokémon at or below **1,000,000 Coins**, or any Shiny at or below **5 Gems**.

All modes use the same reserves and per-purchase spending caps. A cap of zero means no additional limit beyond the spendable balance; with zero reserves, an enabled category-wide rule can spend the entire currency balance on multiple purchases. Items are bought in full available quantity, bounded by affordability/caps, while Pokémon are indivisible and bought one at a time. Only **one order can be pending** server confirmation, and the same recently attempted listing is temporarily excluded.

**These are absolute-price rules, not value predictions.** A Pokémon can qualify even without reliable grade, IVs, or completed-sale history. No arbitrary reference discount is required; the user-configured price is the explicit authorization. Moth Watch validates currencies and listing prices, skips your own ads and retained ads, and sends the listed unit price to the server. Server purchase acceptance remains authoritative.

The broad-item scanner uses the market's item summary to shortlist relevant item types, then verifies individual offers at a bounded request cadence. When Pokémon buying rules are active, it scans up to **three cheapest-price pages per currency**. It does not promise to inspect all listings or beat retention lotteries, and monitoring pauses when the player browses the normal market to avoid replacing that view.



## Pokémon valuation

See [Pokémon valuation reference](docs/POKEMON_VALUATION_REFERENCE.md) for documented game rules and uncertainties. The pricing scanner uses completed sales, separate currencies, species/form, shiny and potency, and narrower comparisons for score/quality/IVs when the game supplies them. A coarse comparator is not an independently validated fair price. No fixed rarity-to-price multiplier is assumed.

Run the non-network tests with `node --test tests/moth-watch-automation.test.cjs`.

> **Private repository:** Direct `raw.githubusercontent.com` links and automatic updates may not work from userscript managers without authentication. For a reliable manual installation, open the file in GitHub while signed in, copy its contents into Violentmonkey, and disable previous copies. GitHub visibility alone is not a premium distribution system.

## Hunt Atlas experiment

The independent Hunt Atlas experiment is preserved under [`huntatlas/`](huntatlas/) at version **1.9.3**. This copy stays separate from the regular Hunt Atlas installed by `pokeidle-addons` and does not automatically synchronize with it. The original preview image, combat accuracy tests and Parcel Panic minigame tests have all been retained.

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
