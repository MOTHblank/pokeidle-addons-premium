# PokéIdle Addons Premium

Private repository for premium and experimental [PokéIdle](https://pokeidle.io/app) userscripts. These scripts are **not installed or updated** by the public [pokeidle-addons](https://github.com/MOTHblank/pokeidle-addons) controller.

## Scripts

| Script | Purpose |
| --- | --- |
| [Moth Watch](addons/moth-watch/moth-watch.user.js) | Community Market browser, rule-based item/Pokémon buying, Snatch queue, purchase activity and read-only pricing/economy context. |
| [Hunt Atlas experiment](addons/hunt-atlas/) | Alternative hunt finder with measured and modeled XP, resource and rare-drop comparisons, and capture planning. Independent of the public Hunt Atlas installation. |
| [Upstream Scraper & Exporter](addons/upstream-scraper/scraper-exporter.user.js) | Manually export publicly served game client assets and a manifest, with download limits and cancellation. |

## Manual installation and updates

1. Install a userscript manager such as [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/).
2. While signed into GitHub with access to this **private** repository, open the script from the table above.
3. Copy the source into a new userscript (or replace an existing copy) in the manager and save it.
4. Disable any duplicate installation of the same addon, then reload PokéIdle.

**Updates are manual.** Private GitHub raw URLs do not provide a reliable unauthenticated userscript update feed. Moth Watch deliberately has no `@updateURL` or `@downloadURL`. An authorized maintainer can also run **Actions → Private MothWatch userscript package** and install the resulting artifact manually.

## Moth Watch

Open **Moth Watch → Automation** to configure buying rules:

- **Fixed item:** selected item, currency and maximum unit price.
- **Any item:** currency and maximum unit price for any matching item.
- **Pokémon:** any, Shiny or P5 Pokémon, with currency and maximum listing price per Pokémon.

Turn on **Enable rule-based buying** to let enabled rules place orders; buying is off by default for new profiles. Optional spend limits, reserves, purchase caps and **Pause all purchases** are available. A zero budget cap means *unlimited*, not “spend nothing”.

Use the **Snatch queue** to mark held listings for purchase attempts when they unlock, or let buying rules target matching listings. Snatch can make repeated attempts while the listing remains available; only a server acknowledgement confirms a purchase. Normal available-listing purchases are not meant to wait for a Snatch release. Keep one actively buying Moth Watch tab per game account to avoid conflicting order state.

The **Activity & references**, **Pokémon price evidence**, and **Economy & holdings** views provide diagnostics and read-only context. Price comparisons are not an additional requirement for an explicitly authorized maximum-price buying rule. Moth Watch does **not** automate selling.

## Development

Moth Watch is assembled into the standalone userscript from `addons/moth-watch/src/`:

```sh
node addons/moth-watch/build.cjs
node --test addons/moth-watch/tests/automation.test.cjs
```

See [Hunt Atlas instructions](addons/hunt-atlas/README.md) for experiment-specific usage. Durable protocol, economics, combat and pricing references are indexed in [docs/](docs/README.md).

## Repository layout

- `addons/moth-watch/` — distributable script, source sections, builder and tests.
- `addons/hunt-atlas/` — experimental standalone script, instructions and preview.
- `addons/upstream-scraper/` — client-asset export userscript.
- `docs/mechanics/`, `docs/market/`, `docs/references/` — topic-specific technical references.
