# PokéIdle Addons Premium

Preserved, premium and experimental [PokéIdle](https://pokeidle.io/app) userscripts. **This repository is currently public.** The native [Moth Controller](https://github.com/MOTHblank/pokeidle-addons) runs without userscripts; browser scripts here are optional.

## Scripts

| Script | Purpose |
| --- | --- |
| [Moth Watch](addons/moth-watch/moth-watch.user.js) · [Install / update](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/moth-watch/moth-watch.user.js) | Community Market browser, rule-based item/Pokémon buying, Snatch queue, purchase activity, Pokémon-sheet valuations and completed-sale price references. |
| [Hunt Atlas experiment](addons/hunt-atlas/) | Alternative hunt finder with measured and modeled XP, resource and rare-drop comparisons, and capture planning. Independent of the public Hunt Atlas installation. |
| [Upstream Scraper & Exporter](addons/upstream-scraper/scraper-exporter.user.js) | Manually export publicly served game client assets and a manifest, with download limits and cancellation. |

## Occasional-use scripts migrated from Moth Controller

The native [Moth Controller](https://github.com/MOTHblank/pokeidle-addons) **does not require Violentmonkey or any userscript**. These browser extensions are preserved here for opt-in manual use when opening PokéIdle in Firefox. Each installer below is a standalone userscript with an auto-update URL on this repository's `main` branch.

| Optional browser userscript | Direct installation | Purpose |
| --- | --- | --- |
| Auto Catch+ | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/autocatch.user.js) | Legacy in-browser capture, reserves, potion/ball/revive restock |
| Controller Bridge | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/controller-bridge.user.js) | Browser diagnostic telemetry and compatibility bridge |
| Hunt Atlas (public release) | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/hunt-atlas.user.js) | In-browser hunt recommendations, combat and XP models |
| Performance+ | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/performance.user.js) | Reduce game-tab rendering work |
| Live Stream Scanner | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/stream-auto-open.user.js) | Browser-based Twitch chat channel selection |
| Twitch Low Resource | [Install](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/twitch-low-resource.user.js) | Browser Twitch chat resource reductions |

**Existing Violentmonkey installations:** the old `pokeidle-addons/master/addons/*.user.js` URLs are retired. Install these Premium versions once to replace the old source and receive future updates here. Disable or remove the old copy if the userscript manager treats it as a separate installation. Native game/Twitch/capture/restock do not need these scripts. Do not run two Hunt Atlas copies or overlapping browser/native Auto Catch for the same account.

The existing [Hunt Atlas experiment](addons/hunt-atlas/) remains as a separate manual-update testbed; the auto-updating release above is the copy for occasional regular use. The former public Hunt Atlas tests have been consolidated under `addons/hunt-atlas/tests/` and `tests/`.

## Installation and automatic updates

1. Install a userscript manager such as [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/).
2. Open **[Install Moth Watch](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/moth-watch/moth-watch.user.js)** and approve installation in your userscript manager. If you previously copied the code manually, update or replace that installation and disable any duplicate.
3. Enable Violentmonkey's automatic userscript update checks for the Firefox profile running PokéIdle. Reload the game after installing an update.

**Direct installer / download:** [moth-watch.user.js](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/moth-watch/moth-watch.user.js)

**Update and download feed:** `@updateURL` and `@downloadURL` both point to the **public `main` branch** at the URL above. Each published change must increase `@version` for installed userscripts to discover it.

**If the repository is made private again:** unauthenticated access to this URL will stop working, so automatic updates will stop. Move the distributable script to a stable public location **before** making it private again if you want uninterrupted updates. A manually triggered packaging workflow remains an alternative for private distribution.

## Moth Watch

Open **Moth Watch → Automation** to configure buying rules:

- **Fixed item:** selected item, currency and maximum unit price.
- **Any item:** currency and maximum unit price for any matching item.
- **Pokémon:** any, Shiny or P5 Pokémon, with currency and maximum listing price per Pokémon.

Turn on **Enable rule-based buying** to let enabled rules place orders; buying is off by default for new profiles. Optional spend limits, reserves, purchase caps and **Pause all purchases** are available. A zero budget cap means *unlimited*, not “spend nothing”.

Use the **Snatch queue** to mark held listings for purchase attempts when they unlock, or let buying rules target matching listings. On release, Snatch prioritizes an initial `market.comprar` attempt for every armed listing and sends additional maximum-affordable-quantity attempts during a **four-second burst**, without the regular buyer's five-in-flight limit. After those four seconds, Snatch keeps submitting `market.comprar` requests as long as the listing remains open and matches its authorized price, using current market quotes or exact `market.anuncio` lookups to identify sold or closed listings. Server lottery rules still decide the winner—multiple sends do not create extra lottery entries. Keep one actively buying Moth Watch tab per account to avoid conflicting order state.

Use **Pokémon values** for stat-adjusted comparisons against current same-species market listings, with completed sales as secondary anchors. **Advanced price references & method** still controls the older history and conservative discovery engine; **Refresh completed sales** fetches that history manually. In a captured or listed Pokémon's native **sheet**, **Moth valuation** now estimates the relevant trading currency using P rarity/stat gain, N, quality, role-relevant IVs, level and refinement; if P is unknown it shows P1–P5 scenarios. The edit panel lets you correct unrecognized facts. Normal Pokémon show a Coin estimate; Shiny show Gems. The game does not establish a fixed Coin/Gem exchange rate, so Moth Watch no longer presents unrelated Coin and Gem estimates as equivalents. A price number still needs an observed market quote for that species in that currency; with none, the relative model explains why no monetary anchor exists. Estimates are heuristic, read-only, and never authorize buying.

**Activity & references** holds logs, baseline tools and opt-in diagnostics; the low-value standalone **Economy & holdings** view has been removed from the navigation. Price estimates are not required by an explicitly authorized maximum-price buying rule. Moth Watch does **not** automate selling.

## Development

Moth Watch is assembled into the standalone userscript from `addons/moth-watch/src/`:

```sh
node addons/moth-watch/build.cjs
```

See [Hunt Atlas instructions](addons/hunt-atlas/README.md) for experiment-specific usage. Durable protocol, economics, combat and pricing references are indexed in [docs/](docs/README.md).

## Repository layout

- `addons/moth-watch/` — distributable script, source sections and builder.
- `addons/hunt-atlas/` — experimental standalone script, instructions and preview.
- `addons/upstream-scraper/` — client-asset export userscript.
- `addons/*.user.js` — archived optional browser addons migrated from the native controller repository.
- `tests/` and `addons/hunt-atlas/tests/` — migrated Hunt Atlas and Twitch regression tests.
- `docs/mechanics/`, `docs/market/`, `docs/references/` — topic-specific technical references.
