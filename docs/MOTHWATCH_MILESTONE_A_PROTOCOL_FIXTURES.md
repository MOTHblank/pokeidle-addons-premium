# Moth Watch — Milestone A market packet verification

**Implementation:** Moth Watch v0.3.1 (2026-10-13). **Status:** synthetic, source-informed regression coverage; **no live traffic or real purchases inspected**.

The shared PokéIdle upstream mirror does not include the complete deployed server purchase dispatcher. The field matrix below describes **requirements of the conservative decoder**, not guaranteed server fields. A response that does not carry enough evidence is deliberately ignored and retried after a bounded timeout, rather than silently attributed to another scan.

| Packet | Positive packet requirements | Empty or missing fields | Reordered / mismatched / manual-browse case |
| --- | --- | --- | --- |
| `welcome.mercado.catalogo` | catalog array of item IDs, optional names; `estado` may supply `servidorAgora` | absent catalog treated as empty; don't invent names or currency | only authenticated game socket should be used for commands |
| `market.itens` | `aba:'itens'`, `resumo`/ `medias` | missing summaries yield no actionable item detail | must never authorize a purchase without a fresh `market.item` quote |
| `market.item` | matching pending `itemId` and `moeda`; `linhas` array | missing ID/currency ignored; empty exact match is valid zero offers | another item's response cannot advance the queue; native market gets priority |
| `market.listar` Pokémon | matching pending `aba:'vitrine'`, currency, kind and page, explicit in envelope or unambiguous listing rows | **empty** response requires `tipo`, `moeda`, `pagina`; otherwise ignored | unrelated Diamond/page/currency rows never become Pokémon offers |
| `market.listar` Diamond | same, kind `diamante` | empty responses require all three discriminators | serializes with Pokémon queries; native browsing suspends acceptance |
| `market.historicoGlobal` | in-flight request, expected currency/page and Pokémon sale rows | empty response requires currency and page; nonempty without currency requires each row to carry expected currency | changed currency/page ignored; timeout retries request conservatively |
| listing hold/release | positive listing ID/quoted unit `preco` and integer `qtd`, known seller, server `compravelEm` | unknown/zero units, unknown seller and stale quote cannot authorize buy | fresh extended hold wins; local release timers do not confer server permission |
| `batalha.ev[k:'marketComprado']` | explicit matching listing ID (or documented alias) | no ID → no confirmation; duplicate matching acknowledgement is idempotent | late acknowledgement can settle an unknown journaled order |
| `erro` | matching listing ID needed for a refusal | unrelated/error without ID never settles order | disconnect/timeout become `unknown`, not `refused` |

## Synthetic fixture catalogue

`tests/moth-watch-automation.test.cjs` exercises positive, empty, mismatched and late paths for the response arbiter, price and availability checks, session/day currency budgets, unknown-order exposure, duplicate acknowledgements and cross-reload journal hydration. The separate JSON samples in `tests/fixtures/moth-watch-market-protocol.json` demonstrate safe shapes only. They contain fake identifiers and no game accounts, authentication, chat or copied transcripts.

**No server-issued acknowledgement has been observed by these tests.** The journal conservatively stores the *submitted upper-bound amount* for budgets; it does not call that the actual executed quantity, price or settlement. Only a matching game event can confirm an order, and its actual fill amount is not inferred when absent. A timed-out listing stays protected across restarts. A user-led live session is still needed to establish actual deployed field presence, actual partial-fill semantics, and the proper reconciliation surface.

### Safe read-only live verification handoff

With the account owner's permission, inspect **only the schema**, not payload data. For each family, record: game build/date, response `t`/`aba`, present property **names**, whether kind/currency/page appear on empty replies, `linhas` count (coarsened), and whether an event supplies order ID and an explicit executed quantity/price. Replace all personal/account IDs, nicknames, Pokémon IDs and authentication values with placeholders; never commit full raw payloads. For refusals and purchases, use owner-supervised normal gameplay; **do not trigger test orders or repeat unknown purchases to gather fixtures.**

### Guardrails and known limitations

- Pending one-at-a-time `market.listar` requests reduce background attribution races. Because the browser's native code and the userscript share the WebSocket, a user opening the native market *after* a bot request is sent can still receive a background response in the game client. The addon stops accepting it when the native market is visible; it cannot cancel the already-sent server response.
- Purchase reconciliation after a refresh is **conservative**: unknown records remain reserved, and no automated retry of their listing is allowed. A later matching acknowledgement/refusal may resolve them, but without a confirmed server history protocol the UI cannot safely claim a forgotten order was refunded or wholly filled.
- Currency balances, sale reference prices, history medians and rate-limit timings are observations, **not** guarantees of server settlement or throughput.
- The `@updateURL` of this private repository is not guaranteed to work in Violentmonkey without authenticated access. Use manual installation when necessary.
