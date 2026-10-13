# HuntAtlas UI/UX review — v1.9.11

**Scope:** Premium HuntAtlas 1.9.10 → 1.9.11, 2026-10-13. This is a **source-based** review of the actual userscript, markup, controls, CSS, state and interaction paths. It is **not** a claim that screenshots or a live Firefox game session were tested. Product goals: **PT-BR default**, honest evidence/status, fast hunt navigation and very low overhead for long-running Firefox/headless profiles.

## Findings and changes

| Severity | Problem in previous UI | Delivered correction |
| --- | --- | --- |
| High | `activeFilterCount()` compared **every persisted preference** against defaults. Open detail panels, ball choice, Outland preview and hypothetical reference scenarios incorrectly counted as active list filters; **Limpar filtros** reset them. | Restrict the count/reset to nine actual search dimensions. Keep objective sort/order, selected rare, chosen ball, Outland preview and hypothetical scenarios. |
| High | Outland shortcut showed “no command” for several unrelated states; the action disappeared rather than explaining why it was unavailable, and a six-second timeout had no visible result. | Keep explicit visible action (disabled when unsafe), show **tier currently active** and localized reason for locked level, missing tier snapshot, disconnected socket, already selected, pending acknowledgment or no confirmation. Match success only to observed game state. |
| High | On small displays, the dense four-column/then two-column filter form competed for vertical space with the 120-item result list and ranking panel. | Add an accessible collapsible search-filter toolbar, default **collapsed at ≤620 px**, expanded on larger widths. Limit height/scroll of expanded filters and optional details independently from results. Preserve user’s open/closed choice for this browser session. |
| Medium | Every search keystroke rebuilt a very large species view, re-ranked hunts and wrote settings immediately. | 160 ms trailing debounce for search and level-range typing (user edits still update local input immediately), no extra background polling. |
| Medium | A zero-results panel only contained an explanation: recovering on a cramped mobile view required finding a filter button. | Add a visible **Limpar filtros e mostrar Pokémon** action whenever search restrictions are active. Leave game-data-not-loaded states informational (no false reset). |
| Medium | Recommendation panel `innerHTML` refresh replaced selected controls and could steal keyboard focus; weakness choices were rebuilt on every click. | Restore focus to equivalent `data-mha-*` controls without scroll jumps; keep weakness button nodes and update their active/ARIA state in place. |
| Medium | Labels, descriptions and click targets frequently used 8 px text and 22–30 px controls; long details could overwhelm the list. | Improve reading size of core labels/status/rates, touch targets, focus outlines and overflow behavior while keeping existing colors and information density. |
| Low | Top Five disclosure did not communicate its expanded state via attributes; the global `/` shortcut could intercept editing in contenteditable areas. | Add `aria-expanded`/`aria-controls` and ignore contenteditable or modifier-assisted key events. Preserve long game status in a tooltip rather than truncating it irretrievably. |

## Outland-specific acceptance criteria

1. With Outland unlocked, the main recommendation area shows **Tier Outland (troca rápida)**, preview-tier dropdown, **Ativo: N** if received, and an explicit **Mudar para este tier** button.
2. Selecting a dropdown option *alone* does not submit `outland.tier`. Only an explicit action does. Locked tiers remain previewable but cannot be applied.
3. The action remains disabled with a descriptive reason if locked, disconnected, active tier unknown, already active, or awaiting server confirmation.
4. Clicking a permitted tier sends the existing native request and shows **aguardando confirmação**. It becomes active **only** after a later native state packet confirms the selected tier. After six seconds without confirmation, show a retry explanation; do not claim success.
5. UI and panel data do not treat tier preview as live tier or alter other hunt economics/XP as a side effect.

## Focus, responsive layout and evidence design

- Search/filter collapse does not close HuntAtlas or disable any addon. The existing user-selected mode still controls whether the addon is active.
- Filters and recommendation details scroll independently; results retain their own scroll container.
- Buttons remain visible and keyboard-focusable where useful; disabled state is conveyed by adjacent text, not color alone.
- Measured XP/h, modelled XP/h, conditional catches/h and **unverified** third-party boost what-if projections remain separate. No “live boost applied” badge, imaginary catch probability or fake realized Coins was added.
- The version check becomes **1.9.11** while retaining the same Controller Bridge contract; no changes to MothWatch, Auto Catch+ or normal-release HuntAtlas.
- The only new timer is a 160 ms *interaction-scoped* search debounce. It is cleared on further input/reset. No new network requests, market polling, browser observers, socket connections or scheduled scans.

## Deterministic QA

`node --check huntatlas/hunt-atlas.user.js`
`node --test huntatlas/tests/*.test.cjs`

New `huntatlas/tests/ui-ux-audit.test.cjs` extracts the live search helpers to test what actually counts/clears, verifies the 9 search fields, confirms reference scenarios and selected tier survive reset, checks timeout cancellation and asserts the relevant markup/accessibility guards. Pure/static tests do not establish the actual dimensions of the hosted game modal.

## Owner-led visual and live-game checks

- **Desktop Firefox at normal and 125–150% zoom:** filters expand/collapse, search/level typing stays focused, empty-search recovery, scrolls within expanded Top Five/detail panels, keyboard tab order, no overflow or clipped Outland action.
- **Narrow viewport/mobile simulation (e.g. 390×844):** filters start collapsed, show/hide buttons work, results remain reachable, buttons fit width, selected weakness retains keyboard focus.
- **Outland level gates and real game connection:** try locked/unlocked tiers; test no server tier state, disconnect, actual accepted tier, rejection/cooldown and six-second timeout. Only actual state confirms a change.
- **Long-running session with Performance+ and multiple profiles:** compare idle CPU/RAM and confirm results do not repaint while hidden; synthetic tests cannot certify real runtime costs.
- **Locale:** PT-BR default; switch EN and verify headings, disabled reasons and no clipped labels.

## Further improvements intentionally not claimed as done

- Pixel-by-pixel audit requires current screenshots/Firefox UI; styling needs a reality check across host modal sizes.
- Native server `outland.tier` acknowledgment/cooldown semantics remain partially unverified; tool cannot fix a field the deployed server does not expose.
- Full WCAG review with screen reader is separate from these keyboard/semantic improvements.
- Future component extraction would make the 14k-line userscript easier to maintain, but this review avoids a large rewrite and preserves the single userscript distribution.

## Follow-up cleanup — v1.9.13

The independent delivery game was removed, including its UI toggle, canvas, animations, input handlers, CSS, localization, storage keys and game-only test. Pokémon XP/h and net Coins/h were removed from both sort menus and ranking objectives without deleting their calculations or hunt-detail/telemetry fields. The supported-sort allowlist now maps saved obsolete selections back to trainer XP/h, and regression coverage protects this reduction. The v1.9.12 rate display refinements remain intact.
