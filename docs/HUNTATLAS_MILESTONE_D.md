# Hunt Atlas Milestone D — Outland tiers, rare drops and shiny-egg horizons

**Implemented in experimental premium v1.9.7, 2026-10-13.** Synthetic CI regression tests are not live-game certification. Companion references: [roadmap](HUNTATLAS_ROADMAP.md), [rare-drop economy](HUNT_REWARDS_AND_RARE_LOOT.md), [Milestone C](HUNTATLAS_MILESTONE_C.md).

## Native game tier vs comparison tier

- The source mirror's `shared/outland-tiers.mjs` defines **exactly eight** tiers (trainer gates 150/500/1,000/2,000/4,000/8,000/16,000/25,000; multipliers 1/1.25/1.5/2/3/4/6/8), all on **the same** Outland map. It explicitly documents the `outland.tier` native request and `players.outland_tier` server state. The shared file does not provide a full deployed packet/response example, and the runtime addon cannot independently certify a particular server version's current handler without gameplay.
- The UI's **compare/preview tier** is persisted as a user filter and never modifies `huntSlug` or the active game state. You can compare while traveling or hunting elsewhere. Locked choices have an explicit level requirement rather than a fake forecast or phantom Outland marker.
- The **active in-game tier** displays only if a `welcome`/`estado` snapshot explicitly includes `tierOutland`, `outlandTier` or `outland_tier` (the names available to the addon). If unknown, activation is disabled and the UI says so. Deltas that omit the field leave the preceding confirmed state unchanged. Only the exact integer values 1–8 are accepted, with invalid/missing state shown as unknown rather than fabricated Outland 1.
- **Use this tier** sends `{t:'outland.tier',tier:N}` only when the authoritative tier is known, the requested tier is unlocked, the socket is open, the requested tier is different, and no request is pending. It does **not** assume that sending is success. The pending UI clears on an authoritative state update with the matching tier; it otherwise times out in six seconds, allowing normal retry. The native server is authoritative for additional rate limits/cooldowns, not the addon.
- An upstream-compatible `outlandNativeTier()` helper mirrors `tierOutlandValido`: an inaccessible valid tier falls back to the highest allowed tier, malformed selection defaults to tier 1, and trainer level below 150 does not unlock the Outland map. Historical **10501–10547** Outland variants map to **2001–2047** for catalog/HP/loot/kill species lookups; ordinary 10001 mirror IDs are not called Outland.

## Probability assumptions and provenance

| Drop | Item ID | Eligible | Base fractional chance per kill, no boosts | Tier multiplier | Evidence |
| --- | ---: | --- | ---: | --- | --- |
| Bronze Boss Token | 70000 | Outland 1–8 | 0.0005 (0.05%) | 1/1.25/1.5/2/3/4/6/8 | wiki + shared-tier documentation |
| Key Fragment | 70011 | Outland 1–8 | 0.000005 (0.0005%) | same | wiki + shared-tier documentation |
| Shiny Stone Fragment | 70012 | Outland 1–8 | 0.000005 | same | wiki + shared-tier documentation |
| Bicycle Fragment | 70013 | Outland 1–8 | 0.000005 | same | **wiki reported; server drop hook not verified** |
| Shiny Egg Fragment | 70017 | Non-Outland hunts of level 5000+ | 0.0000375 at level 5000, +0.0000015 each fixed tier, max 0.000081 | **never** Outland multiplier | `shared/ovo-shiny.mjs` frozen 30-tier ladder |

No tier-specific normal-kill XP, Gold, ordinary species loot, shiny-capture odds or K/h multiplier is introduced. The preview runs off the currently measured K/h only if the live hunt matches the sampled context; otherwise it uses the existing labeled cold-start/personalized model. The choice of a tier is **not** automatically an observation of that tier.

For each eligible item the panel displays: exact **per-kill chance** as a percentage with six decimal places, expected **units/h** (`K × p`), mean hours to one (`1/(Kp)`), mean hours for ten fragments (`10/(Kp)`), **P(≥1 in 1 hour)** and **P(≥1 in 24 hours)** via the numerically stable `-expm1(n*log1p(-p))` expression. Zero throughput yields zero probability and unknown/infinite expected time rather than a fictitious finite number. Expected values and mean horizons are **not guarantees**, especially for 1-in-200,000 drops.

**No undocumented bonus stacking:** Loot Boost, stream, guild, event and rare-drop effects are not applied until verified active state / server formulas become available. The model is explicitly **unboosted**. The wiki-reported Bicycle probability is labeled pending server confirmation. Independence across *different* items and mutual-exclusion policy are unverified: the ≥1 formula applies to each item's own repeated kills under stationary independent identical-trial assumptions, not to a made-up sum of distinct rares.

**Shiny Egg:** 10 × Shiny Egg Fragments crafts one egg. Crafting/hours are shown separately from its additional **168-hour incubation** (the wiki describes 126 hours with verified heating). Outland never receives a Shiny Egg chance, even in an artificial high-level Outland hunt. A level inserted between the source's fixed 30 thresholds stays on the preceding tier; this is not calculated by counting the live list of hunts.

## Recorded drops and optional valuation

- The existing normalized and bounded wild-kill ledger already counts distinct `morte.drops` receipts, scoped to the current hunt / selected tier and session. Milestone D also recognizes exact `nome` when the drop has no item ID, using only the four Outland and one Shiny Egg allowlisted names. No raw packet, identity, password or token is stored. The panel shows observed counts **only** when its location/tier matches the live session; comparison-tier forecasts never borrow another tier's actual drop count.
- A pure **read-only completed-sale** valuation gate permits an optional historical **Coins or Gems** price only if the record is explicitly a completed sale with at least 3 samples, an aged timestamp and an actual positive same-currency reference. The addon does **not** have a verified live Moth Watch item-trade feed to supply that evidence; the UI therefore shows **—** instead of a fictitious value. No price lookup, market scan, exchange rate or purchase/sell automation is added. This keeps **HA-18 partial** pending a trustworthy provider.

## QA and limitations

`huntatlas/tests/rare-milestone-d.test.cjs` covers eight gates, source normalization, fractional tier multipliers, no Outland Shiny Egg, fixed intermediate-level Egg chances, independent-trial 1/24-hour probabilities, 10-fragment crafting, duplicate wild-drop receipts, zero/unknown kill rates, completed-sale price gating, and the independent preview / guarded send path.

Remaining owner-led checks: exact `outland.tier` payload/ack field from a real server session, tier rejection/cooldown UX, whether `welcome.estado` always exposes selected tier, live rare-drop event shapes, per-tier boost modifiers and the Bike hook. These cannot honestly be claimed as deployed-game verified from the shared mirror. The script uses the existing WebSocket observer, bounded ledger and normal drawer rendering; no new timers except one **six-second timeout on user-initiated tier activation**.
