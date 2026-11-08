# Upstream Scraper & Asset Exporter

[Install/update the scraper](https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/upstream-scraper/scraper-exporter.user.js) in Violentmonkey, then open PokéIdle in that Firefox profile.

The scraper now supports both **source-file inspection** and **image discovery/download**. It never needs to submit game commands or use authentication tokens. The user starts each scan manually.

## Collecting assets

1. Open the game and choose **Scrape** in the top menu.
2. Choose **Scan source** to archive public JavaScript, JSON, CSS and other client files. Before crawling maps, the scraper checks the current `MOTHblank/pokeidle-upstream` `master` tree and reuses map JSONs already present under `assets/world/maps/`; only missing maps are downloaded. **This reuse applies only to world maps.** Every other gameplay file is fetched fresh on every scan. The scan seeds item/creature catalogs, moves, map markers, world collision/offset/draw-order tables, `campo.mjs`, `mapa.mjs`, hunt-session/analyser modules and spawn filtering, then derives missing-map probes from every public hunt marker plus the generated-map naming scheme. Player-outfit manifests are deliberately ignored.
3. Choose **Download images**. The scraper inspects loaded images, network resource timing, static CSS/JS image paths and the publicly accessible `/assets/items.json` catalog. Explicit catalog item IDs are associated with their real icon URLs; player-outfit artwork is deliberately ignored.
4. Let the scan finish or press **Cancel**. **Export TAR** downloads the source files plus actual image bytes. **Manifest** downloads the inspection report alone.

You can run **Download images** again after visiting other maps, encountering different Pokémon or opening more game panels. Already downloaded assets are reused in memory; new URLs add to the archive.

## Pacing completeness

Source scans now carry an explicit `pacing` object in the manifest. A scrape is `pacing.ready: true` only when all pacing-critical world modules/tables were freshly captured and **all 500 exact map IDs** from `/hunt`'s PokéIdle 1.409.0 pacing corpus exist either in `pokeidle-upstream` or in the current scan. A raw count of 500 arbitrary map files is not enough.

The scraper does not silently treat speculative map probes as failures: candidate hunt/map names that return HTTP 404 are counted in `pacing.probeMisses`. The known pacing IDs are probed directly, including generated/source maps that never appear as Hunt Map marker slugs. Existing upstream map filenames with a trailing content hash are canonicalized to their stable map ID before comparison, so `gerado_fogo_03-<hash>.json` prevents a redundant `gerado_fogo_03` download. If the GitHub inventory lookup fails or is truncated, the scraper safely falls back to downloading all maps. It never reuses non-map files. `pacing.missingPacingMapIds` lists any exact pacing inputs still absent.

The source limits are intentionally much higher than before (5,000 files, 8,000 discovered URLs, 12 MiB per text file and 768 MiB total text) because the old 350-file / 64-MiB limits could never hold the full map corpus. Reusing maps already committed upstream reduces subsequent scan size substantially; the first population of the map corpus can still be memory-heavy.

## Export structure

The TAR contains:

- `upstream/images/<host>/<public-path>.<format>` — the downloaded PNG, GIF, JPEG, WebP or AVIF files.
- `upstream/manifest.json` — image/source URLs, download sizes, SHA-256 hashes, origin evidence, explicit `kind`/`id` mappings, skipped URLs, limits, incomplete-scan flags and unresolved paths.
- `upstream/image-index.json` — `sprites`, `items`, and `balls` arrays with IDs only from public catalogs. The `sprites` entries contain **PNG Pokémon sprites only**, using the format accepted by the controller's `--pokemon-index` option.
- `upstream/...` — existing public text sources and their manifest entries.

To consume a verified Pokémon index later, extract `image-index.json` from the TAR, review the URLs and use:

```sh
python scripts/sync-native-visuals.py --pokemon-index /path/to/image-index.json
```

The controller's current synchronizer embeds **PNG only**; GIF/WebP/AVIF are collected for inspection and require conversion or renderer support before inclusion. Some third-party item art also requires `--allow-external` when syncing from the controller repository.

## Security and scope

The image scanner uses unauthenticated requests (`credentials: omit`) to the current PokéIdle origin and anonymous userscript requests to the explicitly approved public art host `pokexguides.com`. Source scans make one anonymous read-only request to `api.github.com` to list existing `MOTHblank/pokeidle-upstream` map files before deciding which map JSONs still need downloading. It never downloads arbitrary external domains, arbitrary endpoints, private account URLs or resource URLs with unapproved query parameters. Player-outfit manifests and artwork are excluded before they consume crawl/download limits. Unapproved image hosts are reported by hostname only. Unsupported formats and failed requests are listed in the manifest.

A download is capped at 2 MiB per image, 96 MiB across images, 1,200 image files and 3,000 discovered image URLs. The original text scan has its own separate limits. The browser may still hold a large TAR in memory during export; prefer working in a clean dedicated browser tab.

The scraper **does not claim complete sprite coverage**: sprites hidden behind unevaluated runtime paths, canvas generation or unloaded map/panel states may remain unavailable. Dynamic sprite templates are reported, not guessed. Likewise, an individual Pokémon's database record ID (or a rendering `looktype`) is not treated as its species ID. A species mapping is emitted only when an actual public species entry supplies that ID.

Review licensing and redistribution permissions before committing downloaded artwork. Downloading public images does not itself grant permission to redistribute them.
