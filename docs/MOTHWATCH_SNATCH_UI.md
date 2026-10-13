# MothWatch Snatch — UI/UX acceptance notes

This document describes interface behavior added after the original held-listing queue. It does **not** claim that the feature has won a contested live-market purchase.

## Queue location and actions

The main MothWatch navigation includes a dedicated **Snatch queue** tab and a live count of armed listings. **Activity & references** has a link to it. Item offer rows, Pokémon price-evidence cards and actionable opportunities expose a **Snatch / Cancel snatch** button with a descriptive tooltip, accessible name and pressed state. Native RMT rows receive a button beside the hold timer **only when the actual markup exposes a listing ID matching authenticated market evidence**.

The queue separates **Player-marked targets** (each with a Cancel action) from **Rule-triggered targets** (managed by their active buying rules). Player targets are ordered by nearest unlock. A row shows the listing ID, item/Pokémon name when known, maximum authorized unit/specimen price and currency, current state and number of submitted attempts.

## Statuses are not confirmations

The UI distinguishes **Unlocks in N seconds**, **Recovering listing**, **Refreshing listing evidence**, **Competing for purchase**, **Next attempt in N seconds**, **Purchase sent · awaiting server confirmation**, **Purchases paused**, **Waiting for game connection**, and **Blocked by an unverified purchase**. These indicate local conditions, not confirmed ownership. Only an authoritative game purchase acknowledgement confirms a successful purchase.

The existing account-scoped queue persists after closing RMT and across a page reload. Cancel from the dedicated queue without finding the listing again. Keyboard focus is restored after in-place updates where the target remains present; after cancellation focus moves to the queue tab.

No new polling intervals, WebSockets or document observers were introduced by the UI update. Labels update on the existing render cadence, independently of the exact-unlock purchase timer.

## Owner-led acceptance checks

1. Confirm that the native RMT listing markup exposes unambiguous IDs, the Snatch button appears beside the correct hold timer, and it remains aligned at narrow window widths.
2. Arm one held item and one Pokémon, close the RMT panel, reopen the Snatch queue, and verify the correct prices, currencies and cancel behavior.
3. Verify PT-BR and English labels, tab keyboard navigation, and focus preservation on queue updates.
4. Observe disconnected, paused, unknown-transaction and server-confirmed states against the live game, without treating timers or synthetic tests as proof of a completed order.
5. Confirm that long-session CPU/RAM remains acceptable.

**Pending:** live browser placement checks and real contested purchase success; the tests in source control are synthetic and do not guarantee those outcomes.
