# Moth Watch Milestone D — operator safety, diagnostics and private release

**Target build:** v0.6.0 · **2026-10-13**. This describes implemented source behavior and remaining **owner-led live validation**, not a claim of 24-hour runtime certification.

## MW-17 — What the buy rules actually do

Moth Watch is *read-only by default*. For a new profile, **Enable rule-based buying** is OFF, even if general Watch monitoring is ON. Individual new rules have a unit/specimen price ceiling and a separate Buy switch. The master switch and the individual rule must both be enabled to submit orders. Existing saved rule settings are preserved during upgrades, so upgrading a profile with enabled rules does **not** silently reset them.

| Rule | Matches | Price meaning | Monitoring coverage |
| --- | --- | --- | --- |
| Fixed item | An exact catalog item ID and explicit Coin/Gem currency | **maximum unit** price; may purchase multiple available units within caps | Detailed market offers, refreshed selectively |
| Any item | Any listed market item in the selected currency | **maximum unit** price, *not* per lot; quantity limited by budgets | Summary narrows item types, then rate-limited detail offers |
| Any Pokémon | Any species/form allowed in the selected currency | maximum **per specimen** listing price | Up to 3 cheapest-price pages per currency when purchase rules are active; **not exhaustive** |
| Shiny | Explicit shiny Pokémon; Gems only | maximum per specimen in Gems | Same bounded Pokémon page sample |
| P5 | Explicit P5 Pokémon in the selected currency | maximum per specimen | Same bounded Pokémon page sample |

**Exposure boundaries:** reserves and **per-purchase** caps only constrain each order; they do *not* bound repeated orders. Session/day Coin/Gem spending caps, rule session/day spending caps, and per-session purchase-count/quantity caps are cumulative, and **zero means unlimited**. Unknown submitted orders retain reserved maximum exposure and can block additional buying. The server confirms orders, hold expiration, funds, actual fill and inventory receipt.

**Activation warning:** turning on the master switch while broad rules have no cumulative cap, adding an active broad rule, enabling an existing broad rule without cumulative protection, **or removing the last cumulative cap while one is active** prompts the user for confirmation. Declining leaves saved settings unchanged. Existing enabled profiles retain their configuration; do not silently disable them on upgrade. The UI discloses a rule's cap and bounded coverage, and shows inactive/paused status *before* a speculative affordability result. A recently displayed listing is not a guarantee it remains buyable.

Manual buy buttons are explicit user actions, but are still subject to the same quote validation, retention, serialized journal and balance checks. No automatic selling exists.

## MW-18 — Privacy-preserving diagnostic report

Open **Moth Watch → Activity & references → Redacted diagnostics**. Click **Start diagnostics** (disabled by default); reproduce the issue; click **Copy sanitized report**; then **Stop diagnostics** or **Reset counters**. Diagnostics are in-memory only and automatically clear on page reload; there is no telemetry upload or hidden persistent log.

The v1 report contains only a fixed-allowlist of **packet field names**, message family, count of result lines, coarse relative timings, bounded request/outcome counters and local cache/pending-order **counts**. It never captures packet values, player nicknames, seller names, account or listing IDs, credentials, transaction prices, user-configured rules, item names or WebSocket transcripts. The ring holds a maximum of **64 shape samples**, with collection disabled unless opted in. Generated text is copied only after a user click; review the text before sharing.

Included deterministic tests check the distinct `market:vitrine` shape when currency is present versus missing, unknown outcomes and packet counting, retention of at most 64 samples across 1,000 synthetic packets, opt-in state, and that sample reports cannot contain injected sensitive fields. Older Milestone A protocol fixtures cover holds, unknown orders, empty cross-currency responses, and partial quantities. A real uninterrupted 24-hour browser/CPU/RAM validation remains **unperformed**.

## MW-19 — Installing/updating a private userscript

The repository is **private**. Generic `raw.githubusercontent.com/.../main/...` URLs do **not** provide authenticated updates to Violentmonkey in every browser. Accordingly, v0.6.0 intentionally **removes `@updateURL` and `@downloadURL`** rather than offering a misleading automatic updater. Do **not** make the repository public, embed GitHub tokens, commit credentials, or share the private raw source to solve this.

### Manual installation (works with authorized GitHub access)

1. Open [`addons/market-bot.user.js`](../addons/market-bot.user.js) while authenticated to an authorized GitHub account. View **Raw** in the browser if it opens under your authenticated session, or copy from the source view.
2. In Firefox Developer Edition, install **Violentmonkey** for the game-account browser profile. Create a new userscript, paste the **entire** v0.6.0 source, save it, and verify it applies to `https://pokeidle.io/app*`.
3. Disable or replace the old Moth Watch entry so that **only one** version is active per account. Confirm the installed version is v0.6.0, that the UI opens, and that auto-buy permission still matches that profile's saved settings.
4. For upgrades, edit that same Violentmonkey script and replace the code. Do **not** delete the old script or browser profile unless you intentionally want to reset its existing `localStorage` rule/journal data.

### Authenticated private GitHub Actions package (optional)

With repository access, go to **Actions → Private MothWatch userscript package → Run workflow** on `main`. After the run succeeds, download its **moth-watch-private-[run number]** artifact, extract `moth-watch.user.js`, inspect it and paste into the existing Violentmonkey userscript. The workflow copies the validated single source; its artifacts remain subject to private-repository authorization and GitHub artifact retention (**14 days**). This is an **on-demand artifact**, not an auto-update channel or public release. The CI step verifies distributable module parity and JS syntax before packaging.

## MW-20 — Source organization and release hygiene

As of **v0.6.1, sixteen maintenance sections** have separate source files under `src/mothwatch/`: **rules**, **orders/journal**, **transport/backoff**, **Pokémon pricing**, **economy**, **rule safety**, **redacted diagnostics**, **item scanner**, **Pokémon scanner**, **automation scanner**, **socket protocol handlers**, **UI style**, **market browse cards**, **UI rule controls**, **UI rendering**, and **UI event handlers**. The installed userscript remains a single file at `addons/market-bot.user.js`, with those sections embedded between generated markers. **Do not edit generated spans by hand**; edit their source files, then run `node tools/build-mothwatch.cjs` to regenerate. CI runs `node tools/build-mothwatch.cjs --check` and `node --check addons/market-bot.user.js` to catch divergence. Central configuration, catalog, controller bridge and some support functions remain in the main userscript. This is still an **incremental refactor**; no extra runtime modules or browser network observers are loaded.

Version history:
- **0.3.x:** opt-in rule engine, conservative order journaling, cumulative limits and protocol guards.
- **0.4.0:** completed-sale Pokémon comparator, uncertainty and read-only rule preview.
- **0.5.0:** read-only seller fees, item provenance, manual holdings, optional farming-cost bridge.
- **0.6.0:** safer broad-rule activation, rule coverage explanations, private manual package workflow, bounded diagnostics and seven testable source sections.
- **0.6.1:** nine additional scanner/socket/UI maintenance sections; item-market inventory markup cached until actual underlying inputs change; avoids off-tab candidate sorting, baseline formatting and automation-settings serialization; focused Buy actions invalidate when quotes or order status change. Repeated-render synthetic tests do **not** establish 24-hour live CPU/RAM improvements.

**Validation split:** the Node synthetic tests and GitHub Actions module/syntax checks can be confirmed in source control; actual authenticated private package download, Violentmonkey interaction, modal layout, gameplay buy/hold behavior and 24-hour CPU/RAM must be checked by the owner. A source test does **not** prove an actual market purchase, nor does a successful CI test prove an authenticated browser upgrade.
