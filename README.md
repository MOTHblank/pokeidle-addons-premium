# PokéIdle Addons Premium — Moth Watch

Moth Watch lives in this repository starting with **v0.2.1**. The standard `pokeidle-addons` controller does not install or update it automatically.

## Installation

Install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) in the desired Firefox profile and open [Moth Watch userscript](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/market-bot.user.js). Confirm the installation in Violentmonkey. Existing users of the public script should replace their old copy to avoid two concurrent Moth Watch instances. Check that the script's `@updateURL` and `@downloadURL` point at this repository.

The script preserves its existing local settings keys. **Automated buying stays disabled for new profiles**; fixed item-buy rules are the only supported automatic purchase path. Pokémon purchases remain manual.

## Pokémon valuation

See [Pokémon valuation reference](docs/POKEMON_VALUATION_REFERENCE.md) for documented game rules and uncertainties. The pricing scanner uses completed sales, separate currencies, species/form, shiny and potency, and narrower comparisons for score/quality/IVs when the game supplies them. A coarse comparator is not an independently validated fair price. No fixed rarity-to-price multiplier is assumed.

Run the non-network tests with `node --test tests/moth-watch-automation.test.cjs`.

> Repository visibility: the GitHub repository is currently public. Merely moving this userscript here does not restrict downloads or source access.
