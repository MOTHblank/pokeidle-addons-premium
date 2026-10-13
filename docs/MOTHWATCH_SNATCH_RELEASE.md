# MothWatch Snatch — Release-Window Purchase Queue (v0.7.0)

## What Snatch does

PokéIdle Community Market shows new listings immediately but **holds them for approximately two minutes**. A listing's `compravelEm` is the server-reported release timestamp.

**Snatch pre-arms a specific item or Pokémon listing** from an observed, authenticated game-market packet. It schedules one short-lived timer to dispatch `market.comprar` through the existing authenticated game WebSocket **when the server clock reaches the release timestamp**. The first attempt uses the verified pre-release quote; **there is no market scan, HTTP fetch, or 1-second scanner tick on the first-buy critical path**.

When a current, active fixed-item, Any-item, Any-Pokémon, Shiny or P5 rule matches a held listing, its existing explicit unit/specimen price limit and currency can authorize a release attempt. Rules still require their master enable switch; new profiles remain buying-OFF. Other targets require a **player click on Snatch**, which authorizes purchase **only for that listing ID, kind, currency and observed maximum unit price**. Manual Snatch does not silently activate category rules.

The Watch item offers, Watch opportunities and Pokémon price-evidence cards expose a Snatch / Cancel Snatch control. The native Community Market is enhanced **only when a row exposes an unambiguous listing ID matching a recently received game-market packet**; this selector requires **owner-led in-game DOM verification**. The Watch Activity tab shows manually armed targets and can cancel them after leaving the listing view.

Targets are scoped to the authenticated game account and persisted to localStorage. They survive closing the RMT view or reloading the page. **The underlying PokéIdle tab and account connection must remain alive**; Snatch does not run as an external cloud service, and background browser throttling can delay timers. After reload, item/Pokémon observations must be recovered before purchase.

## Contested release scheduling

1. Observe `compravelEm`, listing ID, kind, currency, seller, price and quantity **while the item is held**. When stock changes or the seller edits the price, a newer observed hold supersedes the previous one.
2. Prepare a single nearest-release timer; keep regular market scans off the shared socket for roughly **3.2 seconds** around an armed release. Do not perform a scan **between unlock and first purchase request**.
3. At the server-estimated release instant, send the existing `{t:'market.comprar',id,qtd,preco,moeda}` through the authenticated game socket with the exact price and currency, after checking the game-account journal, reservations, balance, rules and retained quote.
4. **At most one unanswered buy** is in flight. When the server explicitly refuses, release that attempt and retry after **400 ms** for the initial 30 acknowledged refusals. After 30 attempts, retry no faster than **1.5 s**; after 90 attempts, **5 s**. Respect any server rate-limit delay of **15 s**. Attempt counts advance only when a request was actually dispatched. Do **not** repeat an unacknowledged or uncertain order.
5. Stop once there is a confirmed successful purchase, a confirmed missing item listing from repeated complete detail responses, user cancellation, loss of authorization or the bounded target lifetime. An unknown purchase outcome **blocks new purchases** until reconciled; it does not count as a refusal.

Manual Snatch currently keeps an armed target for up to **30 minutes after its last observed release**. Rule-based targets are likewise limited to about 30 minutes after that release. This is a bounded best-effort lifetime rather than an endless high-frequency loop.

**Server-side fairness matters:** the wiki and [market protocol notes](./MARKET_PROTOCOL_REFERENCE.md) describe a **three-second release lottery with one entry per player per listing**. Faster or duplicate entries during that lottery do **not** establish an advantage; no response field in the accessible mirror proves otherwise. Snatch prioritizes submitting a valid entry promptly and pursues subsequent definitive refusals. It does not bypass retention, lottery fairness, purchase limits or rate limiting.

## Safety and resource limits

- One timer handles up to 40 in-memory held targets; at most 40 player-marked targets are persisted per account. Live native listing observations are capped at 240 rows.
- No global DOM observer, extra WebSocket, per-frame market polling or additional high-frequency scanner is installed.
- Reservations, spending caps, server seller/price checks, saved journal and unknown-order guards are shared with existing MothWatch purchases.
- A quote observed during hold can be used for up to three minutes to cover the two-minute retention. Quotes older than that require targeted refresh rather than speculative orders.
- The first timed attempt is **not guaranteed to execute on the literal first rendered frame**: scheduler accuracy, OS background throttling, network latency and server clock differences are outside userscript control.
- The native-market Snatch row selector is conditional on known listing ID attributes; where no such attribute exists, use the Watch UI instead. In-game verification remains pending.

## Owner-led testing

1. Observe a held item with an enabled fixed/Any-item rule, then verify the first `market.comprar` is transmitted at/after the release, without an intervening `market.item` or bulk scan.
2. Mark a held item and a Pokémon manually, leave the RMT view and check that the target remains armed and dispatches when eligible.
3. Test a second client winning the same listing, a seller cancelling/adding stock, changed hold time, server rate-limit errors and a deliberately missing purchase acknowledgement.
4. Check that an explicit refusal allows a subsequent order, but a lost acknowledgement **does not**. Validate per-account isolation, caps, balances, rule disabling and canceled queue entries.
5. Run in both visible and headless Firefox and measure timer latency with the browser foreground/background; confirm native listing button placement in the current game build.

Automated JS replay verifies scheduling, acknowledgment gating, and module compatibility; **no competitive live-purchase win rate, actual server lottery response or 24-hour runtime has been certified**.
