# Hunt Atlas Milestone A — farming event and evidence contract

**Status (2026-10-13):** implementation in premium userscript v1.9.4; synthetic fixtures, **not** live-server certification. Based on [Hunt Rewards](HUNT_REWARDS_AND_RARE_LOOT.md), [Auto Catch economics](AUTOCATCH_CAPTURE_ECONOMICS.md), and [Combat Model](COMBAT_MODEL_CONTRACT.md). No new socket or market request is added.

## Source and trust boundaries

- `observed-server/event`: a parsed `batalha.ev` event from the existing game WebSocket. The source is the received *client-side* event, not a claim that we audited the production server.
- `observed-client`: explicitly populated fields in a `welcome` / `estado` client snapshot. Missing keys in a delta are **not zero**, and unknown tier/bonus meaning stays unknown.
- `upstream-shared`: deterministic equations checked against the upstream mirror. Those references do not establish complete live-server parity.
- `wiki-derived`: rules documented by the wiki but still needing runtime confirmation, including ordinary catch odds and the Bicycle Fragment rare drop.
- `personalized-model`, `static-baseline`, and `unknown` remain distinct from a sustained measurement.

We only store a **bounded aggregation** of event fields, not raw packets, names, auth tokens or account identifiers. A browser-session nonce and incrementing local session generation separate observations after `welcome`, socket closure and hunt switches. The measurement key also includes the current lead instance/loadout/level, explicit Outland tier where present, catalog revision and numerically represented bonus snapshot where present. The browser profile's own local storage remains the persistence boundary. v4 historical records are intentionally not promoted to v5 measured rates.

## Decoder matrix

| `batalha.ev[k]` | Allowed event fields | Accepted/normalized interpretation | Duplicate, missing and delayed behavior |
| --- | --- | --- | --- |
| `spawn` | `slot` or `s`, species, HP, level | New alive generation at the slot; the existing combat sampler retains its own HP samples | Repeated spawn of an already living slot does not generate a second corpse; a new spawn *after* a death permits a new death |
| `morte` + `quem='selvagem'` | `slot/s`, `xpTreinador`, `xpPokemon`, `ouro`, `ouroVendaAuto`, `drops` | One accepted wild kill; separate trainer/Pokémon XP, kill Coins, already-realized auto-sale Coins and observed drops | Repeated death in the same spawn generation is rejected. Missing slot is rejected for accounting; missing reward remains unknown to the event normalizer, not fabricated from `xp`. Player deaths excluded |
| `bola` | `slot/s`, `ballId`, `shiny`, optional `chance/sucesso` | One **server-emitted accepted ball use**, not an automation click; shiny seen distinct from caught | Requires correlated defeated corpse; the first accepted use per corpse is counted. Repeat/unlinked use rejected conservatively. `chance` semantics unresolved and not used |
| `capturado` | `slot/s`, `pokemon.shiny` | Confirmed capture, only after a correlated accepted throw | Duplicate and unlinked capture rejected for conservative rates; unknown-slot captures remain unlinked, not guessed |
| `cura` | `itemId` | One potion use by item ID | An absent item ID is rejected; consecutive uses are **not** collapsed solely because identical |
| `revive` | `itemId` | One revive use by item ID | Same as `cura` |
| `bossMorto` | `drops` and other boss-specific fields | Boss event is accounted separately from wild kills | Never included in K/h, trainer hunt XP/h or wild rare-drop denominator |
| `compra` | `itemId`, quantity/currency where supplied | Purchase acknowledgment only; **not** a second consumable expense | No cost inferred without authoritative catalog and currency |
| Other/unknown `k` | None | Ignored by this farming ledger | No guessing an event type |

The `farmingEventEvidence()` decoder returns **only** event kind, a safe allowlist of field names, recognized flag, missing-slot flag, schema version and evidence source. `recordFarmingEvidence()` accumulates per-kind presence counts; no values from arbitrary fields are retained. `normalizeFarmingSnapshot()` records explicit tier, catalog revision and bonus *shape* when present, plus inventory/currency field-presence flags; it does **not** treat inventory presence as a purchase, sale or item use.

**Ambiguity, not a hidden workaround:** a packet lacking a stable unique event identifier cannot always distinguish a repeated `cura`/`revive` from a legitimate identical consecutive item use. We count each server event and do not assert a stronger deduplication guarantee. Likewise, a capture whose event contains no correlatable slot is left unlinked. These are live-protocol verification points for HA-02, not a reason to invent data.

## Measurement window and invalidation

- **Sustained wall rate:** aggregate `morte` receipts into 30-second buckets over a rolling 15-minute window. Each bucket holds kills and the three separate event amounts, so fast kill streams are not truncated to the last 40 intervals or 240 individual kills.
- **Eligibility:** at least **6 wild kills** and **60 seconds** of elapsed wall time, measured from the first accepted kill. Until then the displayed recommendation remains *modeled* and shows a warming-up label; 30 kills over 5 minutes gives higher sample confidence.
- **Wall denominator includes** waves, movement, healing and temporary restock/inactivity. A separate productive-time diagnostic is calculated from eligible inter-kill gaps of at most 60 seconds, **not** substituted into displayed sustained rates.
- **Freshness:** after 2 minutes without a qualifying kill, the prior window is stale and no longer a measured recommendation. The next kill after that gap starts a fresh warming window. A 10-minute empty interval cannot preserve an old high rate.
- **Scope changes:** `welcome`/reconnect, active hunt switch, browser session, lead/loadout, explicit tier, numeric bonus snapshot and catalog revision cannot silently reuse a previously measured rate. The model fallback can still be shown and is labeled accordingly.
- **Boundedness:** at most 33 rate buckets per record, 64 tracked corpse slots, 64 item counters and 160 historical performance records, plus fixed-size recent combat samplers already in the script. The listener reuses the existing WebSocket hook. No new timer or polling frequency was introduced.

If a field is absent/invalid, `normalizeFarmingEvent` uses `null`; a zero value is meaningful only when actually received. Existing cumulative UI totals may use zero for unavailable receipt quantities, but the normalizer and diagnostic preserve the unknown distinction.

## Formula implementation anchors

The pure functions embedded in `hunt-atlas.user.js` (between `HA MILESTONE A PURE BEGIN/END`) are exercised directly by `huntatlas/tests/farming-milestone-a.test.cjs`:

| Formula | Fixture / expected output |
| --- | --- |
| `farmingXpForLevel` | XP(1)=8, XP(150)=13,508 |
| `farmingGoldForLevel` | Coins(1)=36; (5,000)=6,000; (25,000)=(160,300)=15,776 |
| `farmingLootChance` | `5000 / 100000 = 0.05` (5%); `0.5 / 100000 = 0.000005` (0.0005%) |
| `farmingTier` | Exactly 8 gates: 150 / 500 / 1,000 / 2,000 / 4,000 / 8,000 / 16,000 / 25,000; rare multipliers 1 / 1.25 / 1.5 / 2 / 3 / 4 / 6 / 8 |
| `farmingShinyEggChance` | Frozen 30-level ladder; zero below 5,000 and in Outland; 5,000 = 0.0000375, 160,300 = 0.000081 |
| `farmingChanceAtLeastOne` | `1-(1-p)^N`, including zero rolls, p=1, and a 0.05% roll over 2,000 kills (~63.2%) |
| `farmingConfidence` | Explicit warming, stale, medium, high; never call a cold-start projection observed |

The formula helpers are foundational for later milestones; their presence **does not mean** the Outland UI, Coins/h model, NPC loot EV, rare-item predictor or catch planner have shipped.

## Reproducible diagnostics

In the game console (only on a test profile, when diagnostics are needed):

```js
const snapshot = window.__mothHuntAtlasExperimentV1.snapshot();
console.log(snapshot.farmingEvidence);
console.log(snapshot.prediction);
```

`farmingEvidence.events` contains only safe field-name counters, and `prediction` exposes source, measured status, sample count and wall-clock window. Do not copy raw socket packets, inventory identifiers or credentials into bug reports. Synthetic regression commands:

```sh
cd huntatlas
node --test tests/*.test.cjs
```

**Outstanding production checks:** whether `bola` and `capturado` reliably carry the same slot; whether `cura`/`revive` have stable execution IDs for strong duplicate suppression; the deployed Outland tier field name and bonus semantics; and alternative `drops` payload shapes. The tests only establish internal deterministic behavior.
