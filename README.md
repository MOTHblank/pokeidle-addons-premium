# PokéIdle Addons Premium

Moth Watch lives in this repository starting with **v0.2.1**. The standard `pokeidle-addons` controller does not install or update it automatically.

## Moth Watch installation

Install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) in the desired Firefox profile and open [Moth Watch userscript](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/market-bot.user.js). Confirm the installation in Violentmonkey. Existing users of the public script should replace their old copy to avoid two concurrent Moth Watch instances. Check that the script's `@updateURL` and `@downloadURL` point at this repository.

The script preserves its existing local settings keys. **Automated buying stays disabled for new profiles**; fixed item-buy rules are the only supported automatic purchase path. Pokémon purchases remain manual.

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
- [Hunt rewards and rare loot](docs/HUNT_REWARDS_AND_RARE_LOOT.md)
- [Community Market protocol, fees and transaction safeguards](docs/MARKET_PROTOCOL_REFERENCE.md)
- [PokéIdle wiki/upstream mechanics map](docs/POKEIDLE_WIKI_UPSTREAM_MECHANICS_MAP.md)
- [Pokémon valuation reference — current premium edition](docs/POKEMON_VALUATION_REFERENCE.md)
- [Original public valuation reference — exact archived copy](docs/archive/POKEMON_VALUATION_REFERENCE_ORIGINAL.md)

The `pokeidle-huntatlas` repository itself has **not** been deleted; its experimental contents are archived here so it can later be removed without losing files.
