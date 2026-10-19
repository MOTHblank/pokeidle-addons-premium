// ==UserScript==
// @name         PokéIdle Auto Catch+
// @namespace    moth.pokeidle
// @version      6.6.4
// @description  Configurable auto-catch with protocol-backed capture stats and per-target state.
// @match        https://pokeidle.io/*
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/autocatch.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/autocatch.user.js
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-autocatch', '6.6.4');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const SETTINGS_KEY = 'moth-pokeidle-autocatch-v4';
    const MIN_INTERVAL_MS = 100;
    // Lower idle DOM/inventory polling overhead without changing active throw timing.
    const IDLE_POLL_INTERVAL_MS = 250;
    const RESULT_TIMEOUT_MS = 1000;
    const RESTOCK_ACK_TIMEOUT_MS = 10000;
    const RESTOCK_SETTLE_MS = 2000;
    const RESTOCK_RETRY_DELAY_MS = 2000;
    const RESTOCK_BACKOFF_MS = 30000;
    const RESTOCK_MAX_QTY = 5000;

    /*
     * Reuse PokéIdle's own ball artwork. Unknown/future catalog entries fall
     * back to the icon currently rendered by the native automation/capture UI.
     */
    const BALL_ASSET_BY_ID = Object.freeze({
        1: '/assets/site/assets/ui/ball-poke.png',
        2: '/assets/site/assets/ui/ball-great.png',
        3: '/img/ball-super.png',
        4: '/assets/site/assets/ui/ball-ultra.png',
        5: '/img/ball-beast.png'
    });

    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const q = (selector, root = document) => root.querySelector(selector);
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

    const DEFAULTS = {
        enabled: false,
        intervalMs: 100,
        ballPriority: ['ultra'],
        use: {
            poke: true,
            great: true,
            super: true,
            ultra: true,
            beast: true,
            master: false,
            other: false
        },
        reserve: {
            poke: 0,
            great: 0,
            super: 0,
            ultra: 0,
            beast: 0,
            master: 1,
            other: 0
        },
        restock: {
            enabled: false,
            goldReserve: 0,
            selectedBallId: 4,
            selectedPotionId: 200,
            selectedReviveId: null,
            ballAt: 50,
            ballTo: 500,
            potionAt: 10,
            potionTo: 50,
            reviveAt: 1,
            reviveTo: 5
        }
    };

    const BALL_PRIORITY_KEYS = ['beast', 'ultra', 'super', 'great', 'poke', 'master', 'other'];

    function sanitizeBallPriority(priority) {
        if (!Array.isArray(priority)) return [];
        return [...new Set(priority.filter(key =>
            BALL_PRIORITY_KEYS.includes(key)
        ))].slice(0, 2);
    }

    function migrateBallPriority(saved) {
        if (Array.isArray(saved.ballPriority)) {
            return sanitizeBallPriority(saved.ballPriority);
        }

        // The previous default enabled every regular ball. That configuration
        // was not an intentional ordering, so use Ultra by default.
        const oldUse = saved.use;
        if (!oldUse || (
            oldUse.poke !== false &&
            oldUse.great !== false &&
            oldUse.super !== false &&
            oldUse.ultra !== false &&
            !oldUse.master &&
            !oldUse.other
        )) {
            return [...DEFAULTS.ballPriority];
        }

        // Preserve customized legacy choices, strongest-first, up to two.
        // The old "other" category was also how Beast Balls were classified.
        const legacy = { ...oldUse };
        if (legacy.other && legacy.beast === undefined) {
            legacy.beast = true;
            legacy.other = false;
        }
        return sanitizeBallPriority(
            BALL_PRIORITY_KEYS.filter(key => Boolean(legacy[key]))
        );
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');

            // escalation existed in v4; intentionally ignore it from now on.
            /*
             * 650 ms was the old default. With upstream's stable data-slot
             * identity we no longer need that conservative delay, so migrate
             * only that legacy default value to the new 100 ms baseline.
             */
            if (Number(saved.intervalMs) === 650) {
                saved.intervalMs = 100;
            }

            // v6.3 removes the redundant floating capture HUD.
            delete saved.showHud;
            saved.ballPriority = migrateBallPriority(saved);

            /*
             * v6.5 keeps balls and potions independent and adds Revives as a
             * separate restock category.
             */
            const savedRestock =
                saved.restock && typeof saved.restock === 'object'
                    ? { ...saved.restock }
                    : {};

            if (
                savedRestock.selectedBallId === undefined ||
                savedRestock.selectedBallId === null
            ) {
                const legacyBallIds = {
                    poke: 1,
                    great: 2,
                    super: 3,
                    ultra: 4,
                    master: 5
                };

                const legacyBallKey = [
                    'poke',
                    'great',
                    'super',
                    'ultra',
                    'master'
                ].find(key => {
                    const threshold =
                        Number(
                            savedRestock.to?.[key] ??
                            savedRestock.at?.[key] ??
                            0
                        );

                    return threshold > 0 &&
                        (saved.use?.[key] ?? DEFAULTS.use[key]);
                });

                savedRestock.selectedBallId =
                    legacyBallIds[legacyBallKey] ??
                    DEFAULTS.restock.selectedBallId;
            }

            if (
                savedRestock.selectedPotionId === undefined ||
                savedRestock.selectedPotionId === null
            ) {
                const legacyPotionIds = {
                    smallPotion: 200,
                    greatPotion: 201
                };

                const legacyPotionKey = [
                    'smallPotion',
                    'greatPotion'
                ].find(key =>
                    Number(
                        savedRestock.to?.[key] ??
                        savedRestock.at?.[key] ??
                        0
                    ) > 0
                );

                savedRestock.selectedPotionId =
                    legacyPotionIds[legacyPotionKey] ??
                    DEFAULTS.restock.selectedPotionId;
            }

            if (savedRestock.ballAt === undefined) {
                const legacyBallKey =
                    ['poke', 'great', 'super', 'ultra', 'master']
                        .find(key =>
                            Number(
                                savedRestock.to?.[key] ??
                                savedRestock.at?.[key] ??
                                0
                            ) > 0
                        );

                savedRestock.ballAt = Math.max(
                    0,
                    Number(
                        savedRestock.at?.[legacyBallKey] ??
                        DEFAULTS.restock.ballAt
                    ) || 0
                );
            }

            if (savedRestock.ballTo === undefined) {
                const legacyBallKey =
                    ['poke', 'great', 'super', 'ultra', 'master']
                        .find(key =>
                            Number(
                                savedRestock.to?.[key] ??
                                savedRestock.at?.[key] ??
                                0
                            ) > 0
                        );

                savedRestock.ballTo = Math.max(
                    0,
                    Number(
                        savedRestock.to?.[legacyBallKey] ??
                        DEFAULTS.restock.ballTo
                    ) || 0
                );
            }

            if (savedRestock.potionAt === undefined) {
                const legacyPotionKey =
                    ['smallPotion', 'greatPotion']
                        .find(key =>
                            Number(
                                savedRestock.to?.[key] ??
                                savedRestock.at?.[key] ??
                                0
                            ) > 0
                        );

                savedRestock.potionAt = Math.max(
                    0,
                    Number(
                        savedRestock.at?.[legacyPotionKey] ??
                        DEFAULTS.restock.potionAt
                    ) || 0
                );
            }

            if (savedRestock.potionTo === undefined) {
                const legacyPotionKey =
                    ['smallPotion', 'greatPotion']
                        .find(key =>
                            Number(
                                savedRestock.to?.[key] ??
                                savedRestock.at?.[key] ??
                                0
                            ) > 0
                        );

                savedRestock.potionTo = Math.max(
                    0,
                    Number(
                        savedRestock.to?.[legacyPotionKey] ??
                        DEFAULTS.restock.potionTo
                    ) || 0
                );
            }

            delete savedRestock.at;
            delete savedRestock.to;
            saved.restock = savedRestock;

            return {
                ...DEFAULTS,
                ...saved,
                use: {
                    ...DEFAULTS.use,
                    ...(saved.use || {})
                },
                ballPriority: saved.ballPriority,
                reserve: {
                    ...DEFAULTS.reserve,
                    ...(saved.reserve || {})
                },
                restock: {
                    ...DEFAULTS.restock,
                    ...(saved.restock || {})
                }
            };
        } catch {
            return structuredClone(DEFAULTS);
        }
    }
    let settings = loadSettings();
    let timer = null;

    const inventoryBaseline = new Map();
    const targetStates = new Map();

    const ballCatalog = new Map();
    const itemCatalog = new Map();
    let serverItemCatalogReady = false;
    const protocolBalls = new Map();
    const protocolItems = new Map();
    const restockPending = new Map();
    const restockHealth = new Map();
    const restockSettledUntil = new Map();
    let itemCatalogLoadPromise = null;
    let itemCatalogRetryTimer = null;
    let itemCatalogLoadingRetryTimer = null;

    let protocolGold = null;
    let activeProtocolSocket = null;
    let restockSettleUntil = 0;
    let restockLastAction = 'off';

    /*
     * Local click -> outgoing ball.throw -> incoming batalha.ev[k="bola"].
     * The server slot is the authoritative correlation key.
     */
    const pendingBySlot = new Map();

    let stats = freshStats();
    let protocolHookInstalled = false;
    const observedProtocolSockets = new WeakSet();
    const AUTO_CATCH_WS_HOOK = '__mothAutoCatchProtocolHookV654';
    let lastWebSocketHookTarget = null;
    let protocolSockets = 0;
    let protocolMessages = 0;
    let protocolCaptureSignals = 0;
    let protocolLastType = 'waiting';

    function freshStats() {
        return {
            startedAt: Date.now(),
            attempts: 0,
            captures: 0,
            restockOrders: 0,
            restockBought: 0,
            used: {
                poke: 0,
                great: 0,
                super: 0,
                ultra: 0,
                beast: 0,
                master: 0,
                other: 0
            },
            status: 'Idle'
        };
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function normalize(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function visible(el) {
        if (!el?.isConnected || el.hidden || el.classList?.contains('hidden')) return false;

        const style = getComputedStyle(el);
        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.pointerEvents === 'none'
        ) return false;

        return el.getClientRects().length > 0;
    }

    function fireClick(el) {
        if (!el?.isConnected) return false;

        try {
            if (typeof el.click === 'function') {
                el.click();
                return true;
            }
        } catch {}

        try {
            return el.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window
            }));
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------
    // Ball inventory
    // ---------------------------------------------------------------------

    function classifyBall(button) {
        const text = normalize([
            button?.title,
            button?.getAttribute('aria-label'),
            button?.querySelector('img')?.src
        ].filter(Boolean).join(' '));

        if (text.includes('beast')) return 'beast';
        if (text.includes('master')) return 'master';
        if (text.includes('ultra')) return 'ultra';
        if (text.includes('super')) return 'super';
        if (text.includes('great')) return 'great';
        if (text.includes('poke')) return 'poke';
        return 'other';
    }

    function ballCount(button) {
        const title = button?.title || '';
        const match = title.match(/(?:voce tem|você tem|you have|tienes)\s+([\d.,]+)/i);
        if (!match) return null;

        const digits = match[1].replace(/\D/g, '');
        return digits ? Number(digits) : null;
    }

    function ballLabel(button) {
        const title = button?.title || '';
        return title.split('—')[0].trim() || classifyBall(button);
    }

    function ballIdentity(button) {
        return [
            classifyBall(button),
            normalize(ballLabel(button)),
            normalize(button?.querySelector('img')?.src || '')
        ].join('|');
    }

    function getBallButtons() {
        return qa('#caidos-bolas button.caidos-bola');
    }

    function syncInventoryUsage() {
        for (const button of getBallButtons()) {
            const count = ballCount(button);
            if (count === null) continue;

            const id = ballIdentity(button);
            const key = classifyBall(button);
            const previous = inventoryBaseline.get(id);

            if (previous !== undefined && count < previous) {
                stats.used[key in stats.used ? key : 'other'] += previous - count;
            }

            inventoryBaseline.set(id, count);
        }
    }

    function totalUsed() {
        return Object.values(stats.used).reduce((sum, value) => sum + value, 0);
    }

    function rankFor(key) {
        return {
            poke: 0,
            great: 1,
            super: 2,
            ultra: 3,
            beast: 4,
            other: 5,
            master: 6
        }[key] ?? 99;
    }

    function ballMetaForButton(button) {
        const label = normalize(ballLabel(button));
        if (!label) return null;

        return [...ballCatalog.values()]
            .find(meta => normalize(meta.nome || '') === label) ||
            null;
    }

    function getEligibleBalls() {
        const priority = sanitizeBallPriority(settings.ballPriority);
        return getBallButtons()
            .map((button, index) => {
                const meta = ballMetaForButton(button);
                const key = meta?.key || classifyBall(button);
                const domCount = ballCount(button);
                return {
                    button,
                    key,
                    index,
                    count: domCount !== null
                        ? domCount
                        : meta && protocolBalls.has(meta.id)
                            ? Number(protocolBalls.get(meta.id))
                            : null
                };
            })
            .filter(({ button, key, count }) => {
                if (button.disabled || !visible(button) || !priority.includes(key)) {
                    return false;
                }
                const reserve = Number(settings.reserve[key] || 0);
                return count === null || count > reserve;
            })
            // Selection order is intentional: use the primary ball until
            // exhausted, then fall back to the second. No rate-based escalation.
            .sort((a, b) =>
                priority.indexOf(a.key) - priority.indexOf(b.key) ||
                a.index - b.index
            );
    }

    function chooseBall() {
        return getEligibleBalls()[0] || null;
    }

    function selectBall(choice) {
        if (!choice?.button?.isConnected) return false;

        if (!choice.button.classList.contains('on')) {
            return fireClick(choice.button);
        }

        return true;
    }

    // ---------------------------------------------------------------------
    // Per-target state — authoritative upstream data-slot identity
    // ---------------------------------------------------------------------

    function targetName(target) {
        const named = target?.querySelector?.('.caido-quem');
        const text = String(named?.textContent || target?.textContent || 'Pokémon')
            .replace(/\s+/g, ' ')
            .trim();

        return text.slice(0, 48) || 'Pokémon';
    }

    function scanTargets() {
        const list = q('#caidos-lista');
        if (!list) return [];

        const now = Date.now();
        const seen = new Set();
        const entries = [];

        for (const element of qa('.caido[data-slot]', list)) {
            if (!visible(element)) continue;

            const slot = String(element.dataset.slot || '');
            if (!slot) continue;

            const key = 'slot:' + slot;
            seen.add(key);

            let state = targetStates.get(key);

            /*
             * PokéIdle reuses the exact same row while a corpse exists.
             * A different DOM node for the same slot therefore means a new
             * corpse lifecycle and must get a fresh state.
             */
            if (!state || state.element !== element) {
                state = {
                    key,
                    slot,
                    name: targetName(element),
                    element,
                    firstSeenAt: now,
                    lastSeenAt: now,
                    lastAttemptAt: 0,
                    throws: 0,
                    pendingTimeoutRetries: 0,
                    lastBallKey: null,
                    lastBallLabel: null,
                    lastResult: null,
                    lastServerBallId: null,
                    lastChance: null,
                    shiny: false,
                    captured: false,
                    capturedAt: 0,
                    attempted: false,
                    resolved: false,
                    dispatchScheduled: false
                };

                targetStates.set(key, state);
                pendingBySlot.delete(slot);
            } else {
                state.name = targetName(element) || state.name;
                state.lastSeenAt = now;
            }

            entries.push(state);
        }

        for (const [key, state] of targetStates) {
            if (seen.has(key)) continue;

            const unseenFor = now - state.lastSeenAt;

            /*
             * Keep recently-gone states briefly so a slightly-late bola
             * event can still correlate to its server slot.
             */
            if (unseenFor > 5000) {
                targetStates.delete(key);

                if (pendingBySlot.get(state.slot) === state) {
                    pendingBySlot.delete(state.slot);
                }
            }
        }

        return entries;
    }

    function currentTargetState() {
        const states = [...targetStates.values()];

        return states
            .filter(state => state.element?.isConnected)
            .sort((a, b) => (b.lastAttemptAt || b.firstSeenAt) - (a.lastAttemptAt || a.firstSeenAt))[0]
            || null;
    }

    function retryDelayForState(state) {
        if (!state || state.throws <= 0 || state.resolved) return null;

        if (state.lastResult === 'failed') {
            return Math.max(
                MIN_INTERVAL_MS,
                Number(settings.intervalMs) || MIN_INTERVAL_MS
            );
        }

        if (state.lastResult === 'pending') {
            /*
             * A throw with no authoritative result is not terminal. If the
             * exact corpse is still present after the result timeout, retry
             * it again. Keep doing that until a bola result succeeds or the
             * corpse/slot disappears.
             */
            return RESULT_TIMEOUT_MS;
        }

        return null;
    }

    function targetRemainingPercent(state) {
        const bar = state?.element?.querySelector?.('.caido-tempo i');
        const inline = Number.parseFloat(bar?.style?.width || '');

        if (Number.isFinite(inline)) {
            return Math.max(0, Math.min(100, inline));
        }

        /*
         * Upstream adds .acabando below six seconds. It is less precise than
         * the inline progress width, but still lets us rescue an expiring body
         * if a future client stops exposing the exact percentage.
         */
        return state?.element?.classList?.contains('acabando')
            ? 19.9
            : 100;
    }

    function chooseTargetState(states) {
        const now = Date.now();

        /*
         * A corpse has a hard 30 s deadline. Fair round-robin alone is wrong
         * under sustained kills: an almost-expired body can wait behind safer
         * work and disappear. Among targets currently eligible for a throw,
         * earliest deadline wins; last-service time breaks ties so retries
         * still rotate fairly.
         */
        return states
            .filter(state => {
                if (
                    state.resolved ||
                    state.dispatchScheduled ||
                    !state.element?.isConnected ||
                    String(state.element?.dataset?.slot || '') !== state.slot
                ) {
                    return false;
                }

                if (state.throws === 0) return true;

                const retryDelay = retryDelayForState(state);
                return retryDelay !== null &&
                    now - state.lastAttemptAt >= retryDelay;
            })
            .sort((a, b) => {
                const remaining =
                    targetRemainingPercent(a) -
                    targetRemainingPercent(b);

                if (Math.abs(remaining) > 0.05) {
                    return remaining;
                }

                const aServiceAt = a.lastAttemptAt || a.firstSeenAt;
                const bServiceAt = b.lastAttemptAt || b.firstSeenAt;
                return aServiceAt - bServiceAt || a.firstSeenAt - b.firstSeenAt;
            })[0] || null;
    }

    function nextRetryDelay(states) {
        const now = Date.now();
        let best = Infinity;

        for (const state of states) {
            const retryDelay = retryDelayForState(state);
            if (retryDelay === null) continue;

            best = Math.min(
                best,
                Math.max(0, retryDelay - (now - state.lastAttemptAt))
            );
        }

        return Number.isFinite(best) ? best : null;
    }

    function getTargetClickElement(target) {
        /* Upstream .caido itself is the button whose onclick sends ball.throw. */
        if (!target?.isConnected || !target.matches?.('.caido[data-slot]')) return null;
        return target;
    }

    function formatTargetState(state) {
        if (!state) return 'No target';

        const parts = [
            state.name || 'Pokémon',
            'slot ' + state.slot,
            state.throws + ' throw' + (state.throws === 1 ? '' : 's')
        ];

        if (state.lastBallLabel) parts.push(state.lastBallLabel);
        if (state.lastResult) parts.push(state.lastResult);

        return parts.join(' · ');
    }
    // ---------------------------------------------------------------------
    // Server-backed ball inventory / automatic restocking
    // ---------------------------------------------------------------------

    function classifyBallName(
        value
    ) {
        const text =
            normalize(
                value
            );

        if (text.includes('beast')) return 'beast';
        if (
            text.includes(
                'master'
            )
        ) {
            return 'master';
        }

        if (
            text.includes(
                'ultra'
            )
        ) {
            return 'ultra';
        }

        if (
            text.includes(
                'super'
            )
        ) {
            return 'super';
        }

        if (
            text.includes(
                'great'
            )
        ) {
            return 'great';
        }

        if (
            text.includes(
                'poke'
            )
        ) {
            return 'poke';
        }

        return 'other';
    }

    function mergeBallCatalog(
        catalog
    ) {
        if (
            !Array.isArray(
                catalog
            )
        ) {
            return;
        }

        for (
            const ball of
            catalog
        ) {
            const id =
                Number(
                    ball?.id
                );

            if (
                !Number.isFinite(
                    id
                )
            ) {
                continue;
            }

            ballCatalog.set(
                id,
                {
                    id,
                    nome:
                        ball?.nome ||
                        'Ball ' +
                        id,
                    key:
                        classifyBallName(
                            ball?.nome ||
                            ''
                        ),
                    catchRate:
                        Number(
                            ball?.catchRate ||
                            0
                        ),
                    priceGold:
                        Number(
                            ball?.priceGold ||
                            0
                        ),
                    compravel:
                        Boolean(
                            ball?.compravel
                        )
                }
            );
        }
    }

    function restockPendingKey(kind, id) {
        return kind + ':' + id;
    }

    function restockInventoryForKind(kind) {
        return kind === 'ball'
            ? protocolBalls
            : kind === 'item'
                ? protocolItems
                : null;
    }

    function markRestockTimedOut(pendingKey, now) {
        const previous = restockHealth.get(pendingKey);
        const failures = Number(previous?.failures || 0) + 1;
        const delay = failures >= 3
            ? RESTOCK_BACKOFF_MS
            : RESTOCK_RETRY_DELAY_MS * failures;

        restockHealth.set(pendingKey, {
            failures,
            blockedUntil: now + delay
        });

        return { failures, delay };
    }

    function expirePendingRestocks(now = Date.now()) {
        let timedOut = null;

        for (const [pendingKey, pending] of restockPending) {
            if (now - pending.sentAt < RESTOCK_ACK_TIMEOUT_MS) continue;

            restockPending.delete(pendingKey);
            const health = markRestockTimedOut(pendingKey, now);
            timedOut = { pending, health };
        }

        if (timedOut) {
            restockLastAction =
                (timedOut.pending.name || 'Purchase') +
                ' confirmation timeout · ' +
                (
                    timedOut.health.failures >= 3
                        ? '30s cooldown'
                        : 'retry queued'
                );
            stats.status = 'Restock · ' + restockLastAction;
        }

        return timedOut;
    }

    function confirmRestock(pendingKey, pending, bought = null) {
        if (!pending || restockPending.get(pendingKey) !== pending) {
            return false;
        }

        const confirmedQty = Math.max(
            0,
            Number.isFinite(Number(bought))
                ? Number(bought)
                : Number(pending.qty || 0)
        );

        restockPending.delete(pendingKey);
        restockHealth.delete(pendingKey);
        const settleUntil =
            Date.now() +
            RESTOCK_SETTLE_MS;

        restockSettledUntil.set(
            pendingKey,
            settleUntil
        );
        restockSettleUntil = Math.max(
            restockSettleUntil,
            settleUntil
        );

        stats.restockBought += confirmedQty;
        restockLastAction =
            (pending.name || pending.kind + ' ' + pending.id) +
            ' +' +
            confirmedQty;
        stats.status =
            'Restock · ' +
            restockLastAction;

        return true;
    }

    const GOLDEN_POTION_ID = 70070;
    const GOLDEN_POTION_PRICE_GOLD = 2500;

    function isRestockPotion(item) {
        if (Number(item?.id ?? item?.itemId) === GOLDEN_POTION_ID) return true;
        return Boolean(
            item &&
            /potion|pocao/.test(normalize(item.name || item.nome || ''))
        );
    }

    function isRestockRevive(item) {
        return Boolean(
            item &&
            normalize(item.name || item.nome || '').includes('revive')
        );
    }

    function mergeItemCatalog(catalog, source = 'fallback') {
        const list = Array.isArray(catalog)
            ? catalog
            : Array.isArray(catalog?.items)
                ? catalog.items
                : [];

        if (!list.length) return;

        for (const item of list) {
            // The live shop is authoritative. The bundled items.json can
            // lag behind new shop inventory (for example Golden Potion).
            const id = Number(item?.itemId ?? item?.id);
            if (!Number.isSafeInteger(id) || id <= 0) continue;

            const previous = itemCatalog.get(id);
            // Fetch of the older assets/items.json can finish *after* the
            // welcome payload. Never overwrite a shop item with stale data.
            if (source !== 'shop' && previous?.source === 'shop') continue;

            const name = item?.name || item?.nome || previous?.name ||
                (id === GOLDEN_POTION_ID ? 'Golden Potion' : null);
            if (!name || (!isRestockPotion({ name }) &&
                !isRestockRevive({ name }))) {
                continue;
            }

            const suppliedPrice =
                item?.preco ??
                item?.npcPrice ??
                item?.priceGold ??
                (id === GOLDEN_POTION_ID ? GOLDEN_POTION_PRICE_GOLD : null);
            const parsedPrice = Number(suppliedPrice);
            const priceGold =
                suppliedPrice != null &&
                Number.isFinite(parsedPrice) &&
                parsedPrice > 0
                    ? parsedPrice
                    : Number(previous?.priceGold || 0);

            itemCatalog.set(id, {
                id,
                name,
                nome: name,
                icon: item?.icon || previous?.icon || '',
                priceGold,
                source,
                // No synthetic shop items, ids or prices. A potion only
                // becomes auto-buyable after a verified catalog entry.
                compravel: Number.isFinite(priceGold) && priceGold > 0
            });
        }
    }

    function syncBridgeMarketSnapshot() {
        try {
            const bridge = page.__mothControllerBridgeV1;
            if (!bridge || typeof bridge.marketCatalogSnapshot !== 'function') {
                return false;
            }

            const snapshot = bridge.marketCatalogSnapshot();
            if (!snapshot?.ready) return false;

            mergeBallCatalog(snapshot.balls);
            if (Array.isArray(snapshot.items)) {
                serverItemCatalogReady = true;
                mergeItemCatalog(snapshot.items, 'shop');
            }
            if (snapshot.state) {
                mergeProtocolState(snapshot.state);
            }

            return true;
        } catch (_) {
            return false;
        }
    }

    function gameIsLoading() {
        const loading = q('#carregando');
        if (!loading) return false;
        if (
            loading.hidden ||
            loading.classList.contains('hidden') ||
            loading.getAttribute('aria-hidden') === 'true'
        ) {
            return false;
        }
        return loading.getClientRects().length > 0;
    }

    function ensureRestockItemCatalog() {
        if (gameIsLoading()) {
            if (itemCatalogLoadingRetryTimer === null) {
                itemCatalogLoadingRetryTimer = window.setTimeout(() => {
                    itemCatalogLoadingRetryTimer = null;
                    ensureRestockItemCatalog();
                }, 750);
            }
            return Promise.resolve(null);
        }

        if (itemCatalogRetryTimer !== null) return Promise.resolve(null);
        if (itemCatalogLoadPromise) return itemCatalogLoadPromise;

        itemCatalogLoadPromise = fetch('/assets/items.json', {
            cache: 'no-store'
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('items catalog HTTP ' + response.status);
                }

                return response.json();
            })
            .then(payload => {
                mergeItemCatalog(payload, 'fallback');
                if (
                    !restockPotionEntries().length &&
                    !restockReviveEntries().length
                ) {
                    throw new Error('items catalog contains no restockable potion/revive entries');
                }

                if (itemCatalogRetryTimer !== null) {
                    clearTimeout(itemCatalogRetryTimer);
                    itemCatalogRetryTimer = null;
                }

                return itemCatalog;
            })
            .catch(error => {
                console.warn(
                    '[PokéIdle Auto Catch+] item catalog load failed',
                    error
                );

                itemCatalogLoadPromise = null;
                if (itemCatalogRetryTimer === null) {
                    itemCatalogRetryTimer = window.setTimeout(() => {
                        itemCatalogRetryTimer = null;
                        if (
                            !restockPotionEntries().length &&
                            !restockReviveEntries().length
                        ) {
                            ensureRestockItemCatalog();
                        }
                    }, 5000);
                }
                return null;
            })
            .finally(() => {
                maybeRestock();
                updateUI();
            });

        return itemCatalogLoadPromise;
    }

    function mergeProtocolInventory(kind, rawInventory, inventory) {
        if (
            !rawInventory ||
            typeof rawInventory !== 'object' ||
            Array.isArray(rawInventory)
        ) {
            return;
        }

        /*
         * Upstream delta state is shallow at the top level. When "items" or
         * "balls" is present, that object is the COMPLETE current inventory;
         * an absent id means zero. Merging entries into the previous Map left
         * stale counts behind when a consumable reached zero — especially
         * potions, which can be consumed several times between snapshots.
         */
        const previous = new Map(inventory);
        const next = new Map();

        for (const [rawId, rawCount] of Object.entries(rawInventory)) {
            const id = Number(rawId);
            const count = Number(rawCount);

            if (!Number.isFinite(id) || !Number.isFinite(count)) continue;
            next.set(id, count);
        }

        inventory.clear();
        for (const [id, count] of next) {
            inventory.set(id, count);
        }

        /*
         * Inventory growth is a useful secondary acknowledgement. The
         * authoritative "compra" event is still preferred because an item can
         * be bought and consumed before the next state snapshot, making the
         * net count stay flat or even fall.
         */
        for (const [pendingKey, pending] of restockPending) {
            if (pending.kind !== kind) continue;

            const count = next.get(pending.id) ?? 0;
            const oldCount = previous.get(pending.id) ?? 0;

            if (
                count > pending.before ||
                count > oldCount
            ) {
                confirmRestock(
                    pendingKey,
                    pending,
                    pending.qty
                );
            }
        }
    }

    function mergeProtocolState(gameState) {
        if (!gameState || typeof gameState !== 'object') return;

        if (gameState.gold !== undefined && gameState.gold !== null) {
            const gold = Number(gameState.gold);
            if (Number.isFinite(gold)) protocolGold = gold;
        }

        mergeProtocolInventory('ball', gameState.balls, protocolBalls);
        mergeProtocolInventory('item', gameState.items, protocolItems);
    }

    function socketReady() {
        return Boolean(
            activeProtocolSocket &&
            activeProtocolSocket.readyState === page.WebSocket.OPEN
        );
    }

    function sendProtocol(payload) {
        if (!socketReady()) return false;

        try {
            activeProtocolSocket.send(JSON.stringify(payload));
            return true;
        } catch {
            return false;
        }
    }

    function restockBallMetaForId(id) {
        const targetId = Number(id);

        return [...ballCatalog.values()]
            .filter(ball =>
                Number(ball.id) === targetId &&
                ball.compravel &&
                Number(ball.priceGold || 0) > 0
            )[0] || null;
    }

    function restockBallEntries() {
        return [...ballCatalog.values()]
            .filter(ball =>
                ball.compravel &&
                Number(ball.priceGold || 0) > 0
            )
            .sort((a, b) => {
                const aRate = Number(a.catchRate);
                const bRate = Number(b.catchRate);
                const aKnown = Number.isFinite(aRate) && aRate > 0;
                const bKnown = Number.isFinite(bRate) && bRate > 0;

                if (aKnown && bKnown) {
                    return aRate - bRate || Number(a.id) - Number(b.id);
                }

                if (aKnown) return -1;
                if (bKnown) return 1;

                return Number(a.id) - Number(b.id);
            });
    }

    function restockPotionMetaForId(id) {
        const item = itemCatalog.get(Number(id));
        return isRestockPotion(item) && item?.compravel ? item : null;
    }

    function restockPotionEntries() {
        // Market data-chave="i70070" identifies Golden Potion. The
        // static items.json mirror omits it, so keep a known fallback.
        if (!itemCatalog.has(GOLDEN_POTION_ID)) {
            itemCatalog.set(GOLDEN_POTION_ID, {
                id: GOLDEN_POTION_ID,
                name: 'Golden Potion',
                nome: 'Golden Potion',
                icon: '/img/itens/golden-potion.png',
                priceGold: GOLDEN_POTION_PRICE_GOLD,
                source: 'observed-market',
                compravel: true
            });
        }
        return [...itemCatalog.values()]
            .filter(item => {
                if (!isRestockPotion(item) ||
                    !item.compravel ||
                    Number(item.priceGold || 0) <= 0) return false;

                // Keep a previously selected type available until changed.
                // The current upstream catalog calls ID 204 "Ultimate Potion".
                // Also accept Golden Potion if a live catalog supplies it.
                const name = normalize(item.name || item.nome);
                return Number(item.id) === Number(settings.restock.selectedPotionId) ||
                    /small|ultimate|golden|dourad/.test(name);
            })
            .sort((a, b) =>
                Number(a.id) - Number(b.id)
            );
    }

    function restockReviveMetaForId(id) {
        const item = itemCatalog.get(Number(id));
        return isRestockRevive(item) && item?.compravel ? item : null;
    }

    function restockReviveEntries() {
        return [...itemCatalog.values()]
            .filter(item =>
                isRestockRevive(item) &&
                item.compravel &&
                Number(item.priceGold || 0) > 0
            )
            .sort((a, b) =>
                Number(a.id) - Number(b.id)
            );
    }

    function restockThresholds() {
        return {
            ballAt: Math.max(
                0,
                Number(settings.restock.ballAt || 0)
            ),
            ballTo: Math.max(
                0,
                Number(settings.restock.ballTo || 0)
            ),
            potionAt: Math.max(
                0,
                Number(settings.restock.potionAt || 0)
            ),
            potionTo: Math.max(
                0,
                Number(settings.restock.potionTo || 0)
            ),
            reviveAt: Math.max(
                0,
                Number(settings.restock.reviveAt || 0)
            ),
            reviveTo: Math.max(
                0,
                Number(settings.restock.reviveTo || 0)
            )
        };
    }

    // Native game artwork; mirrored items.json paths omit the /assets/site
    // prefix, and Golden Potion isn't represented in the static mirror.
    const RESTOCK_ITEM_ASSET_BY_NAME = Object.freeze({
        'small potion': '/assets/site/assets/markitems/small_potion.png',
        'great potion': '/assets/site/assets/markitems/great_potion.png',
        'ultra potion': '/assets/site/assets/markitems/ultra_potion.png',
        'hyper potion': '/assets/site/assets/markitems/hyper_potion.png',
        'ultimate potion': '/assets/site/assets/markitems/ultimate_potion.png',
        'golden potion': '/img/itens/golden-potion.png',
        'pocao dourada': '/img/itens/golden-potion.png',
        'revive': '/assets/site/assets/markitems/revive.png',
        'max revive': '/assets/site/assets/markitems/max_revive.png'
    });

    function normalizeRestockIconPath(value) {
        const path = String(value || '').trim();
        if (!path) return null;
        if (path.startsWith('/assets/site/') ||
            path.startsWith('/img/')) return path;
        if (path.startsWith('site/assets/')) return '/assets/' + path;
        if (path.startsWith('/assets/markitems/')) return '/assets/site' + path;
        if (path.startsWith('assets/markitems/')) return '/assets/site/' + path;
        if (path.startsWith('img/')) return '/' + path;
        if (path.startsWith('/')) return path;
        return null;
    }

    // Match the native potion/revive picker by its exact visible name,
    // disregarding the game's optional "— acabou" stock suffix.
    function nativeRestockItemIcons() {
        const icons = new Map();
        for (const button of qa(
            '#auto-potion-opts button.auto-chip, #auto-revive-opts button.auto-chip'
        )) {
            const title = normalize(
                String(button.title || '').split(/\s+[—–]\s+/)[0]
            );
            const src = normalizeRestockIconPath(
                button.querySelector('img')?.getAttribute('src')
            );
            if (title && src) icons.set(title, src);
        }
        return icons;
    }

    function restockItemImageSrc(item, nativeIcons) {
        const name = normalize(item?.name || item?.nome);
        return nativeIcons.get(name) ||
            RESTOCK_ITEM_ASSET_BY_NAME[name] ||
            normalizeRestockIconPath(item?.icon) ||
            null;
    }

    function catalogPickerIcon(src, fallbackLabel) {
        const fallback = () => {
            const span = document.createElement('span');
            span.className = 'moth-ac-ball-fallback';
            span.textContent = String(fallbackLabel || '●').slice(0, 1).toUpperCase();
            return span;
        };
        if (!src) return fallback();

        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            if (img.isConnected) img.replaceWith(fallback());
        }, { once: true });
        return img;
    }

    function syncRestockSelections() {
        const nativeIcons = nativeRestockItemIcons();
        const categories = [
            { hostId: 'moth-ac-restock-ball', field: 'selectedBallId',
              kind: 'ball', entries: restockBallEntries(), label: 'ball' },
            { hostId: 'moth-ac-restock-potion', field: 'selectedPotionId',
              kind: 'item', entries: restockPotionEntries(), label: 'potion' },
            { hostId: 'moth-ac-restock-revive', field: 'selectedReviveId',
              kind: 'item', entries: restockReviveEntries(), label: 'revive' }
        ];

        let changed = false;
        for (const category of categories) {
            const host = document.getElementById(category.hostId);
            if (!host) continue;

            const entries = category.entries;
            const selectedId = Number(settings.restock[category.field]);
            const hasSelected = entries.some(entry =>
                Number(entry.id) === selectedId
            );
            // Preserve a saved Golden Potion (or any other live-shop item)
            // while the older local items.json is the only available catalog.
            // Missing inventory/catalog data must never silently switch
            // an existing restock rule to buying Small Potion.
            const selected = hasSelected ? selectedId : (
                selectedId > 0 ? selectedId :
                    entries.length ? Number(entries[0].id) : null
            );

            if (selectedId <= 0 && entries.length && selected !== selectedId) {
                settings.restock[category.field] = selected;
                changed = true;
            }

            const signature = JSON.stringify([
                selected,
                entries.map(entry => [
                    entry.id, entry.nome || entry.name,
                    category.kind === 'ball'
                        ? ballImageSrc(entry)
                        : restockItemImageSrc(entry, nativeIcons),
                    entry.priceGold
                ])
            ]);
            if (host.dataset.signature === signature) continue;
            host.dataset.signature = signature;
            host.replaceChildren();

            if (!hasSelected && selectedId > 0) {
                const waiting = document.createElement('span');
                waiting.className = 'moth-ac-restock-waiting';
                waiting.textContent =
                    category.field === 'selectedPotionId' &&
                    settings.restock.selectedPotionName
                        ? settings.restock.selectedPotionName + ' · …'
                        : 'Selected item · …';
                waiting.title = serverItemCatalogReady
                    ? 'Saved item is not available from the live shop catalog; choose another'
                    : 'Waiting for live shop catalog; saved choice is preserved';
                host.appendChild(waiting);
            } else if (!entries.length) {
                const waiting = document.createElement('span');
                waiting.textContent = '…';
                waiting.title = 'Waiting for ' + category.label + ' catalog';
                host.appendChild(waiting);
            }

            for (const entry of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'moth-ac-restock-choice';
                const active = Number(entry.id) === selected;
                setClass(button, 'on', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
                const name = entry.nome || entry.name || 'Item ' + entry.id;
                button.title = name + ' · ' + Number(entry.priceGold || 0) + ' gold';
                button.setAttribute('aria-label', name);
                button.appendChild(catalogPickerIcon(
                    category.kind === 'ball'
                        ? ballImageSrc(entry)
                        : restockItemImageSrc(entry, nativeIcons),
                    name
                ));
                button.addEventListener('click', () => {
                    settings.restock[category.field] = Number(entry.id);
                    if (category.field === 'selectedPotionId') {
                        settings.restock.selectedPotionName = name;
                    }
                    saveSettings();
                    maybeRestock();
                    updateUI();
                });
                host.appendChild(button);
            }
        }

        if (changed) saveSettings();
    }

    function pendingRestockSpend() {
        return [...restockPending.values()]
            .reduce(
                (sum, pending) =>
                    sum +
                    Math.max(
                        0,
                        Number(pending.qty || 0) *
                        Number(pending.price || 0)
                    ),
                0
            );
    }

    function tryRestockCandidate({
        kind,
        meta,
        count,
        at,
        to,
        now
    }) {
        if (!meta) return false;

        const pendingKey = restockPendingKey(kind, meta.id);
        if (restockPending.has(pendingKey)) return false;

        const settledUntil = Number(
            restockSettledUntil.get(pendingKey) || 0
        );

        if (settledUntil > now) return false;
        if (settledUntil) restockSettledUntil.delete(pendingKey);

        const health = restockHealth.get(pendingKey);
        if (Number(health?.blockedUntil || 0) > now) return false;

        const threshold = Math.max(
            0,
            Number(at || 0)
        );

        const target = Math.max(
            threshold,
            Number(to || 0)
        );

        if (target <= 0 || count > threshold || count >= target) {
            return false;
        }

        const price = Number(meta.priceGold);
        if (!Number.isFinite(price) || price <= 0) return false;

        const goldReserve = Math.max(
            0,
            Number(settings.restock.goldReserve || 0)
        );

        const spendable = Math.max(
            0,
            protocolGold -
            goldReserve -
            pendingRestockSpend()
        );

        const affordable = Math.floor(spendable / price);
        const wanted = Math.min(
            RESTOCK_MAX_QTY,
            target - count
        );

        const qty = Math.max(
            0,
            Math.min(wanted, affordable)
        );

        if (qty <= 0) {
            restockLastAction =
                (meta.nome || meta.name || key) +
                ' low · gold reserve protected';
            return false;
        }

        if (!sendProtocol({
            t: 'shop.buy',
            kind,
            id: meta.id,
            qty
        })) {
            restockLastAction = 'purchase send failed';
            return false;
        }

        restockPending.set(pendingKey, {
            kind,
            id: meta.id,
            name: meta.nome || meta.name || key,
            before: count,
            qty,
            price,
            goldBefore: protocolGold,
            sentAt: now
        });

        stats.restockOrders++;

        restockLastAction =
            'buying ' +
            qty +
            '× ' +
            (meta.nome || meta.name || key);

        stats.status =
            'Restock · ' +
            restockLastAction;

        updateUI();
        return true;
    }

    function maybeRestock() {
        // Expire unacknowledged orders before readiness checks. If the game
        // socket/catalog/gold snapshot disappears, the old order must not block
        // all later restocking forever.
        const now = Date.now();
        const timedOut = expirePendingRestocks(now);

        if (!settings.enabled || !settings.restock?.enabled) {
            if (!timedOut) restockLastAction = 'off';
            return false;
        }

        // Retry missing catalog data before the readiness guard; otherwise
        // one failed initial fetch leaves the picker and restock permanently
        // stuck on "Waiting for … catalog".
        if (
            !restockPotionEntries().length &&
            !restockReviveEntries().length
        ) {
            ensureRestockItemCatalog();
        }

        if (
            !socketReady() ||
            (!ballCatalog.size && !itemCatalog.size) ||
            protocolGold === null
        ) {
            if (!timedOut) {
                restockLastAction = 'waiting for server state';
            }
            return false;
        }

        /*
         * Only one purchase is allowed in flight. That makes purchase events
         * unambiguous and prevents several orders from being priced against
         * the same not-yet-updated gold snapshot.
         */

        if (restockPending.size) {
            const pending = restockPending.values().next().value;
            restockLastAction =
                'waiting · ' +
                (pending?.name || 'purchase') +
                ' confirmation';
            return false;
        }

        if (now < restockSettleUntil) {
            restockLastAction = 'syncing server inventory';
            return false;
        }

        const thresholds = restockThresholds();

        const ballMeta = restockBallMetaForId(
            settings.restock.selectedBallId
        );
        const ballCount = Number(
            protocolBalls.get(ballMeta?.id) || 0
        );

        if (tryRestockCandidate({
            kind: 'ball',
            meta: ballMeta,
            count: ballCount,
            at: thresholds.ballAt,
            to: thresholds.ballTo,
            now
        })) {
            return true;
        }

        const potionMeta = restockPotionMetaForId(
            settings.restock.selectedPotionId
        );
        const potionCount = Number(
            protocolItems.get(potionMeta?.id) || 0
        );

        if (tryRestockCandidate({
            kind: 'item',
            meta: potionMeta,
            count: potionCount,
            at: thresholds.potionAt,
            to: thresholds.potionTo,
            now
        })) {
            return true;
        }

        const reviveMeta = restockReviveMetaForId(
            settings.restock.selectedReviveId
        );
        const reviveCount = Number(
            protocolItems.get(reviveMeta?.id) || 0
        );

        if (tryRestockCandidate({
            kind: 'item',
            meta: reviveMeta,
            count: reviveCount,
            at: thresholds.reviveAt,
            to: thresholds.reviveTo,
            now
        })) {
            return true;
        }

        if (timedOut) {
            const failures = timedOut.health.failures;
            restockLastAction =
                (timedOut.pending.name || 'Purchase') +
                ' confirmation timeout · ' +
                (
                    failures >= 3
                        ? '30s cooldown'
                        : 'retry queued'
                );
        } else {
            restockLastAction = 'stock OK';
        }

        return false;
    }

    // ---------------------------------------------------------------------
    // Authoritative WebSocket capture result
    // ---------------------------------------------------------------------

    function decodeProtocolData(data) {
        if (typeof data === 'string') {
            try {
                return JSON.parse(data);
            } catch {
                return null;
            }
        }

        if (data instanceof ArrayBuffer) {
            try {
                return JSON.parse(new TextDecoder().decode(data));
            } catch {
                return null;
            }
        }

        return null;
    }

    function stateForBallResult(event) {
        if (event?.slot === undefined || event?.slot === null) return null;

        const slot = String(event.slot);
        return pendingBySlot.get(slot) || targetStates.get('slot:' + slot) || null;
    }

    function handleBallResult(event) {
        if (!event || event.k !== 'bola' || typeof event.sucesso !== 'boolean') return;

        protocolCaptureSignals++;
        protocolLastType = event.sucesso ? 'bola · captured' : 'bola · failed';

        const state = stateForBallResult(event);
        if (!state || state.throws <= 0) {
            /* Manual/native-auto throw; do not claim it as ours. */
            return;
        }

        /*
         * Timeout retries can leave more than one server response in flight.
         * Once this exact corpse has been captured, a late failure from an
         * older throw must never reopen it and queue another retry.
         */
        if (state.captured && !event.sucesso) {
            return;
        }

        state.lastServerBallId = event.ballId ?? state.lastServerBallId;
        state.lastChance = typeof event.chance === 'number' ? event.chance : null;
        state.shiny = Boolean(event.shiny);
        state.lastResult = event.sucesso ? 'captured' : 'failed';
        state.resolved = Boolean(event.sucesso);
        state.pendingTimeoutRetries = 0;

        pendingBySlot.delete(String(event.slot));

        if (event.sucesso) {
            if (!state.captured) {
                state.captured = true;
                state.capturedAt = Date.now();
                stats.captures++;
            }

            stats.status = state.name + ' · captured';
        } else {
            /*
             * Failure is not terminal: the same fallen Pokémon remains
             * eligible until a later throw succeeds or the slot disappears.
             */
            stats.status = state.name + ' · failed · retry queued';
        }

        updateUI();
    }

    function handlePurchaseResult(event) {
        if (!event || event.k !== 'compra' || !restockPending.size) return;

        const eventName = normalize(event.nome || '');
        const eventQty = Number(event.qtd);
        const eventSpend = Number(event.gasto);
        const eventId = Number(
            event.id ??
            event.itemId ??
            event.ballId
        );
        const eventKind = normalize(event.kind || '');

        const candidates = [...restockPending.entries()]
            .map(([key, pending]) => {
                if (
                    Number.isFinite(eventId) &&
                    eventId !== Number(pending.id)
                ) {
                    return null;
                }

                if (
                    eventKind &&
                    eventKind !== normalize(pending.kind)
                ) {
                    return null;
                }

                const idMatches =
                    Number.isFinite(eventId) &&
                    eventId === Number(pending.id);

                const nameMatches =
                    eventName &&
                    normalize(pending.name || '') === eventName;

                const qtyMatches =
                    Number.isFinite(eventQty) &&
                    eventQty === Number(pending.qty);

                const spendMatches =
                    Number.isFinite(eventSpend) &&
                    eventSpend ===
                        Number(pending.qty) *
                        Number(pending.price);

                return {
                    key,
                    pending,
                    score:
                        (idMatches ? 8 : 0) +
                        (nameMatches ? 4 : 0) +
                        (qtyMatches ? 2 : 0) +
                        (spendMatches ? 1 : 0),
                    acceptable:
                        idMatches ||
                        nameMatches ||
                        (
                            restockPending.size === 1 &&
                            qtyMatches &&
                            spendMatches
                        )
                };
            })
            .filter(candidate => candidate?.acceptable)
            .sort((a, b) =>
                b.score - a.score ||
                a.pending.sentAt - b.pending.sentAt
            );

        const match = candidates[0];
        if (!match) return;

        const bought =
            Number.isFinite(eventQty) && eventQty > 0
                ? eventQty
                : Number(match.pending.qty || 0);

        /*
         * The purchase event can arrive before the state snapshot containing
         * the new inventory. A short settlement window prevents the next
         * 100 ms tick from seeing the old low count and buying the same stock
         * twice.
         */
        confirmRestock(
            match.key,
            match.pending,
            bought
        );

        updateUI();
    }

    function inspectIncomingProtocolMessage(data, sourceSocket = null) {
        protocolMessages++;

        const decoded = decodeProtocolData(data);
        if (!decoded) return;

        // The welcome identifies the actual PokéIdle game socket and carries
        // the shop's ball catalog. This is observed directly; Bridge is optional.
        if (decoded.t === 'welcome') {
            if (sourceSocket) activeProtocolSocket = sourceSocket;
            protocolHookInstalled = true;

            mergeBallCatalog(decoded.catalogoBolas);
            if (Array.isArray(decoded.itensCompraveis)) {
                serverItemCatalogReady = true;
                mergeItemCatalog(decoded.itensCompraveis, 'shop');
            }
            mergeProtocolState(decoded.estado);

            maybeRestock();
            updateUI();
            return;
        }

        // Ignore packets from auxiliary sockets once the game socket is known.
        // If the page began before this hook could see the welcome, recover the
        // active channel from a full state packet rather than remaining inert.
        if (sourceSocket) {
            if (
                !activeProtocolSocket ||
                activeProtocolSocket.readyState !== page.WebSocket.OPEN
            ) {
                if (decoded.t === 'estado' || decoded.t === 'batalha') {
                    activeProtocolSocket = sourceSocket;
                }
            }

            if (activeProtocolSocket && activeProtocolSocket !== sourceSocket) {
                return;
            }
        }

        if (decoded.t === 'estado') {
            mergeProtocolState(decoded.estado);
            maybeRestock();
            updateUI();
            return;
        }

        if (decoded.t !== 'batalha' || !Array.isArray(decoded.ev)) return;

        for (const event of decoded.ev) {
            if (event?.k === 'bola') handleBallResult(event);
            if (event?.k === 'compra') handlePurchaseResult(event);
        }
    }

    function inspectOutgoingProtocolMessage(data) {
        const decoded = decodeProtocolData(data);

        if (decoded?.t === 'ball.throw') {
            protocolLastType = 'ball.throw';
        }
    }

    function attachProtocolSocket(socket) {
        if (!socket || observedProtocolSockets.has(socket)) return false;
        observedProtocolSockets.add(socket);
        protocolSockets++;

        socket.addEventListener('close', () => {
            if (activeProtocolSocket === socket) {
                activeProtocolSocket = null;
            }
        });

        socket.addEventListener('message', event => {
            if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
                event.data.text()
                    .then(text => inspectIncomingProtocolMessage(text, socket))
                    .catch(() => {});
                return;
            }

            inspectIncomingProtocolMessage(event.data, socket);
        });

        // Observe outgoing traffic for diagnostics only; never block or modify it.
        try {
            const nativeSend = socket.send;
            socket.send = function(data) {
                try { inspectOutgoingProtocolMessage(data); } catch (_) {}
                return nativeSend.call(this, data);
            };
        } catch {}

        return true;
    }

    function adoptBridgeSocket() {
        // Optional late-attach recovery. Auto Catch+ does not require Bridge:
        // its own WebSocket constructor hook below observes the game's protocol.
        try {
            const bridge = page.__mothControllerBridgeV1;
            const candidate =
                bridge && typeof bridge.socket === 'function'
                    ? bridge.socket()
                    : null;

            if (!candidate || candidate.readyState > page.WebSocket.OPEN) {
                return false;
            }

            syncBridgeMarketSnapshot();
            attachProtocolSocket(candidate);
            if (
                !activeProtocolSocket ||
                activeProtocolSocket.readyState !== page.WebSocket.OPEN
            ) {
                activeProtocolSocket = candidate;
            }
            protocolHookInstalled = true;
            return true;
        } catch {
            return false;
        }
    }

    function installProtocolHook() {
        let NativeWebSocket;
        try {
            NativeWebSocket = page.WebSocket;
        } catch (_) {
            return false;
        }

        if (typeof NativeWebSocket !== 'function') {
            protocolHookInstalled = false;
            return false;
        }

        try {
            // If Bridge or an earlier Auto Catch hook wrapped us, the marker
            // passes through its Proxy. Avoid stacking duplicate wrappers.
            if (NativeWebSocket[AUTO_CATCH_WS_HOOK] === true) {
                protocolHookInstalled = true;
                return true;
            }
        } catch (_) {}

        if (NativeWebSocket === lastWebSocketHookTarget) {
            return protocolHookInstalled;
        }
        lastWebSocketHookTarget = NativeWebSocket;

        let WrappedWebSocket;
        try {
            WrappedWebSocket = new Proxy(NativeWebSocket, {
                get(target, property, receiver) {
                    if (property === AUTO_CATCH_WS_HOOK) return true;
                    return Reflect.get(target, property, receiver);
                },
                construct(target, args, newTarget) {
                    const socket = Reflect.construct(
                        target,
                        args,
                        newTarget === WrappedWebSocket ? target : newTarget
                    );

                    // Instrumentation errors must never prevent the game socket
                    // from being created or returned to PokéIdle.
                    try {
                        attachProtocolSocket(socket);
                    } catch (error) {
                        try {
                            console.warn('[PokéIdle Auto Catch+] socket observation failed', error);
                        } catch (_) {}
                    }

                    return socket;
                }
            });

            page.WebSocket = WrappedWebSocket;
            protocolHookInstalled =
                page.WebSocket === WrappedWebSocket ||
                page.WebSocket?.[AUTO_CATCH_WS_HOOK] === true;

            if (!protocolHookInstalled) {
                console.warn('[PokéIdle Auto Catch+] could not install independent WebSocket hook');
            }
        } catch (error) {
            protocolHookInstalled = false;
            try {
                console.warn('[PokéIdle Auto Catch+] WebSocket hook failed; game startup will continue', error);
            } catch (_) {}
        }

        return protocolHookInstalled;
    }

    // Hook the native protocol independently of Controller Bridge. Both addons
    // can wrap the same constructor safely; the game receives its original
    // WebSocket instance and Auto Catch only observes messages.
    installProtocolHook();
    setInterval(() => {
        // If another addon wrapped the constructor first, re-check its marker.
        installProtocolHook();

        const socket = activeProtocolSocket;
        if (!socket || socket.readyState !== page.WebSocket.OPEN) {
            // Snapshot recovery is strictly a fallback for a missed welcome or
            // disconnected socket; it must not overwrite the direct protocol
            // stream while that stream is healthy.
            syncBridgeMarketSnapshot();
            adoptBridgeSocket();
        }
    }, 1000);

    // ---------------------------------------------------------------------
    // Automation
    // ---------------------------------------------------------------------

    function setEnabled(value) {
        settings.enabled = Boolean(value);
        saveSettings();

        clearTimeout(timer);
        timer = null;

        stats.status = settings.enabled ? 'Starting' : 'Paused';
        updateUI();

        if (settings.enabled) tick();
    }

    function schedule(delayMs = null) {
        clearTimeout(timer);
        timer = null;

        if (!settings.enabled) return;

        const normalDelay = Math.max(
            MIN_INTERVAL_MS,
            Number(settings.intervalMs) || MIN_INTERVAL_MS
        );

        const requested =
            delayMs === null || delayMs === undefined
                ? normalDelay
                : Math.max(MIN_INTERVAL_MS, Number(delayMs) || 0);

        timer = setTimeout(tick, Math.min(normalDelay, requested));
    }

    // Used only when no target is eligible: new targets remain on screen long
    // enough that polling every 100 ms is unnecessary. Active throw scheduling
    // below keeps the user's configured interval.
    function scheduleIdle(delayMs = null) {
        clearTimeout(timer);
        timer = null;

        if (!settings.enabled) return;

        const normalDelay = Math.max(
            MIN_INTERVAL_MS,
            Number(settings.intervalMs) || MIN_INTERVAL_MS
        );
        const requested = delayMs === null || delayMs === undefined
            ? IDLE_POLL_INTERVAL_MS
            : Math.max(IDLE_POLL_INTERVAL_MS, Number(delayMs) || 0);

        timer = setTimeout(tick, Math.max(normalDelay, requested));
    }

    function tick() {
        timer = null;

        if (!settings.enabled) return;

        installPanel();
        syncInventoryUsage();
        maybeRestock();

        const fallenPanel = q('#caidos');
        const states = scanTargets();

        if (
            !fallenPanel ||
            fallenPanel.classList.contains('hidden') ||
            !states.length
        ) {
            stats.status = 'Waiting for target';
            updateUI();
            scheduleIdle();
            return;
        }

        const state = chooseTargetState(states);

        if (!state) {
            const retryDelay = nextRetryDelay(states);
            const failedTargetWaitingForRetry = states.some(
                candidate =>
                    candidate.lastResult === 'failed' &&
                    retryDelayForState(candidate) !== null
            );

            stats.status = retryDelay !== null
                ? 'Waiting for result'
                : 'Waiting for new fallen Pokémon';

            updateUI();

            // Failed captures retain the exact configured retry behavior.
            // Only pending server results / no-target waits use the slower idle poll.
            if (failedTargetWaitingForRetry) {
                schedule(retryDelay);
            } else {
                scheduleIdle(retryDelay);
            }
            return;
        }

        const choice = chooseBall();

        if (!choice) {
            stats.status = 'No allowed balls';
            updateUI();
            scheduleIdle();
            return;
        }

        const wasRetry = state.throws > 0;
        const retryingTimedOutPending = state.lastResult === 'pending';
        state.dispatchScheduled = true;

        /*
         * Upstream ball-button selection is synchronous. It updates
         * estado.bolaCaidos and immediately repaints, so there is no
         * arbitrary settle timeout anymore.
         */
        if (!selectBall(choice)) {
            state.dispatchScheduled = false;
            stats.status = 'Could not select ball';
            updateUI();
            schedule();
            return;
        }

        /*
         * Re-find by authoritative slot after the ball selector repaint.
         * Do not trust an old DOM reference if upstream ever redraws it.
         */
        const targetElement = qa('#caidos-lista .caido[data-slot]')
            .find(element => String(element.dataset.slot || '') === state.slot);

        const clickTarget = getTargetClickElement(targetElement);

        if (!clickTarget || !visible(clickTarget)) {
            state.dispatchScheduled = false;
            stats.status = 'Target disappeared before throw';
            updateUI();
            schedule();
            return;
        }

        const now = Date.now();

        state.element = clickTarget;
        state.name = targetName(clickTarget);
        state.throws++;
        if (retryingTimedOutPending) {
            state.pendingTimeoutRetries++;
        }
        state.attempted = true;
        state.lastAttemptAt = now;
        state.lastBallKey = choice.key;
        state.lastBallLabel = ballLabel(choice.button);
        state.lastResult = 'pending';
        state.resolved = false;

        pendingBySlot.set(state.slot, state);

        if (!fireClick(clickTarget)) {
            pendingBySlot.delete(state.slot);
            state.throws--;
            if (retryingTimedOutPending) {
                state.pendingTimeoutRetries = Math.max(
                    0,
                    state.pendingTimeoutRetries - 1
                );
            }
            state.attempted = state.throws > 0;
            state.lastResult = state.throws > 0 ? 'pending' : null;
            state.dispatchScheduled = false;

            stats.status = state.name + ' · click failed';
            updateUI();
            schedule();
            return;
        }

        state.dispatchScheduled = false;
        stats.attempts++;

        stats.status = wasRetry
            ? state.name + ' · retry ' + state.throws
            : state.name + ' · throwing';

        updateUI();
        schedule();
    }
    function resetStats() {
        stats = freshStats();
        inventoryBaseline.clear();
        targetStates.clear();
        pendingBySlot.clear();
        /*
         * Do not clear transactional restock state here. Resetting counters
         * while a purchase is in flight must not make the same order eligible
         * a second time.
         */

        syncInventoryUsage();
        updateUI();
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------

    function injectStyle() {
        if (q('#moth-ac-style')) return;

        const style = document.createElement('style');
        style.id = 'moth-ac-style';
        style.textContent = `
            #moth-ac-panel {
                margin: 8px 0 10px;
                padding: 7px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 8px;
                background: rgba(18,15,18,.72);
                color: #f4edf0;
                font: 12px/1.3 system-ui,sans-serif;
            }

            #moth-ac-panel * { box-sizing: border-box; }
            #moth-ac-panel button,
            #moth-ac-panel input { font: inherit; }

            .moth-ac-head {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 7px;
            }

            .moth-ac-title {
                font-weight: 750;
                font-size: 13px;
            }

            .moth-ac-status {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #b9adb2;
                font-size: 10px;
            }

            .moth-ac-toggle {
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 999px;
                padding: 4px 9px;
                color: white;
                background: #5b3038;
                cursor: pointer;
                font-weight: 700;
            }

            .moth-ac-toggle.on { background: #23683d; }

            .moth-ac-current {
                margin-bottom: 7px;
                padding: 5px 7px;
                border-radius: 5px;
                background: rgba(255,255,255,.045);
                color: #d7cdd1;
                font-size: 10px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .moth-ac-stats {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 4px;
                margin-bottom: 6px;
            }

            .moth-ac-stat {
                min-width: 0;
                padding: 4px 2px;
                border-radius: 5px;
                background: rgba(255,255,255,.05);
                text-align: center;
                white-space: nowrap;
            }

            .moth-ac-stat b { font-size: 12px; }
            .moth-ac-stat span { margin-left: 4px; color: #aaa0a4; font-size: 9px; }

            .moth-ac-grid {
                display: grid;
                grid-template-columns: 1fr 72px;
                gap: 5px 8px;
                align-items: center;
            }

            .moth-ac-grid input[type="number"],
            .moth-ac-ball-active input[type="number"] {
                padding: 3px 5px;
                border-radius: 5px;
                border: 1px solid rgba(255,255,255,.14);
                color: white;
                background: rgba(0,0,0,.22);
            }

            .moth-ac-grid input[type="number"] { width: 72px; }
            .moth-ac-speed { margin-bottom: 5px; }

            .moth-ac-ball-intro {
                display: flex;
                align-items: center;
                gap: 7px;
                margin: 6px 0 5px;
            }

            .moth-ac-ball-intro b { font-size: 11px; }
            .moth-ac-ball-intro span { color: #aaa0a4; font-size: 9px; }
            .moth-ac-ball-intro button {
                margin-left: auto;
                border: 1px solid rgba(255,255,255,.16);
                border-radius: 5px;
                padding: 2px 7px;
                color: #eee;
                background: rgba(255,255,255,.06);
                cursor: pointer;
                font: inherit;
            }

            .moth-ac-balls {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 5px;
            }

            .moth-ac-ball-active {
                min-width: 0;
                padding: 4px 5px;
                border-radius: 6px;
                border: 1px solid var(--rx-rosa, #b04a86);
                background: rgba(139,53,104,.22);
            }

            .moth-ac-ball-top {
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
            }

            .moth-ac-ball-top b {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 10px;
            }

            .moth-ac-ball-rank { color: #efc2d8; font-size: 10px; font-weight: 750; }
            .moth-ac-ball-top img,
            .moth-ac-ball-options img {
                width: 23px;
                height: 23px;
                object-fit: contain;
                image-rendering: pixelated;
            }

            .moth-ac-ball-fallback {
                display: inline-grid;
                place-items: center;
                width: 23px;
                height: 23px;
                border-radius: 50%;
                background: #6c493f;
                font-weight: 800;
                flex-shrink: 0;
            }

            .moth-ac-ball-action {
                padding: 0 3px;
                border: 0;
                color: #e0c8d0;
                background: transparent;
                cursor: pointer;
                font: inherit;
            }

            .moth-ac-ball-bottom {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-top: 3px;
                color: #c1b7bd;
                font-size: 9px;
            }

            .moth-ac-ball-bottom label {
                display: flex;
                align-items: center;
                gap: 3px;
                margin-left: auto;
            }

            .moth-ac-ball-active input[type="number"] {
                width: 42px;
                padding: 2px 3px;
                text-align: right;
                font-size: 9px;
            }

            .moth-ac-ball-options {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-top: 5px;
                padding: 6px;
                border-radius: 6px;
                background: rgba(255,255,255,.035);
            }

            .moth-ac-ball-options[hidden],
            .moth-ac-restock-settings[hidden] { display: none !important; }

            .moth-ac-ball-option {
                position: relative;
                display: inline-grid;
                place-items: center;
                width: 39px;
                height: 39px;
                padding: 3px;
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 6px;
                color: white;
                background: rgba(255,255,255,.04);
                opacity: .75;
                cursor: pointer;
            }

            .moth-ac-ball-option.on {
                opacity: 1;
                border-color: #ef95bf;
                background: rgba(139,53,104,.35);
                box-shadow: inset 0 0 0 1px rgba(239,149,191,.4);
            }

            .moth-ac-ball-option small {
                position: absolute;
                right: 2px;
                bottom: 1px;
                font-size: 8px;
            }

            .moth-ac-ball-empty {
                grid-column: 1 / -1;
                padding: 6px;
                border-radius: 5px;
                color: #aaa0a4;
                background: rgba(255,255,255,.045);
                font-size: 10px;
            }

            .moth-ac-restock {
                margin-top: 8px;
                padding: 7px;
                border: 1px solid rgba(255,255,255,.09);
                border-radius: 6px;
                background: rgba(255,255,255,.035);
            }

            .moth-ac-restock-head {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }

            .moth-ac-restock-head label {
                display: flex;
                align-items: center;
                gap: 5px;
                font-weight: 700;
            }

            .moth-ac-restock-head { margin-bottom: 0; }
            .moth-ac-restock-expand {
                order: 3;
                border: 1px solid rgba(255,255,255,.15);
                border-radius: 5px;
                padding: 2px 5px;
                color: #eee;
                background: rgba(255,255,255,.05);
                cursor: pointer;
                font: inherit;
            }

            .moth-ac-restock-settings { margin-top: 6px; }

            .moth-ac-restock-picker {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 5px;
                margin-bottom: 6px;
            }

            .moth-ac-restock-picker > div {
                min-width: 0;
                color: #aaa0a4;
                font-size: 9px;
            }

            .moth-ac-restock-choices {
                display: flex;
                gap: 3px;
                flex-wrap: wrap;
                margin-top: 3px;
            }

            .moth-ac-restock-choice {
                display: inline-grid;
                place-items: center;
                width: 31px;
                height: 31px;
                padding: 3px;
                border: 1px solid rgba(255,255,255,.16);
                border-radius: 5px;
                color: white;
                background: rgba(255,255,255,.04);
                opacity: .65;
                cursor: pointer;
            }

            .moth-ac-restock-choice.on {
                opacity: 1;
                border-color: #ef95bf;
                background: rgba(139,53,104,.35);
            }

            .moth-ac-restock-choice img {
                width: 23px;
                height: 23px;
                object-fit: contain;
                image-rendering: pixelated;
            }

            .moth-ac-restock-waiting {
                flex-basis: 100%;
                color: #c7aeb7;
                font-size: 9px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .moth-ac-restock-status {
                min-width: 0;
                margin-left: auto;
                color: #a99fa3;
                font-size: 9px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .moth-ac-restock-grid {
                display: grid;
                grid-template-columns: minmax(60px,1fr) 62px 62px;
                gap: 4px 6px;
                align-items: center;
            }

            .moth-ac-restock-grid small {
                color: #8f858a;
                text-align: center;
                font-size: 8px;
                text-transform: uppercase;
            }

            .moth-ac-restock-grid input[type="number"] {
                width: 62px;
                padding: 3px 4px;
                border-radius: 5px;
                border: 1px solid rgba(255,255,255,.14);
                color: white;
                background: rgba(0,0,0,.22);
            }

            .moth-ac-restock-gold {
                margin-top: 6px;
            }

            .moth-ac-foot {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-top: 7px;
                padding-top: 6px;
                border-top: 1px solid rgba(255,255,255,.08);
                color: #aaa0a4;
                font-size: 10px;
            }

            .moth-ac-foot label {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .moth-ac-reset {
                margin-left: auto;
                padding: 3px 7px;
                border: 1px solid rgba(255,255,255,.15);
                border-radius: 5px;
                color: #ddd;
                background: rgba(255,255,255,.05);
                cursor: pointer;
            }

        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function nativeBallImageSrc(meta) {
        const wanted = normalize(meta?.nome || '');

        for (const button of [
            ...getBallButtons(),
            ...qa('#auto-ball-opts button.auto-chip')
        ]) {
            const title = normalize(button?.title || '');
            if (wanted && !title.includes(wanted)) continue;

            const img = button?.querySelector?.('img');
            if (img?.src) return img.src;
        }

        return null;
    }

    function ballImageSrc(meta) {
        return BALL_ASSET_BY_ID[Number(meta?.id)] ||
            nativeBallImageSrc(meta) ||
            null;
    }

    function ballPickerEntries() {
        return [...ballCatalog.values()]
            .filter(meta => settings.use[meta.key] !== undefined)
            .sort((a, b) => {
                const aRate = Number(a.catchRate);
                const bRate = Number(b.catchRate);
                const aKnown = Number.isFinite(aRate) && aRate > 0;
                const bKnown = Number.isFinite(bRate) && bRate > 0;

                if (aKnown && bKnown) {
                    return aRate - bRate || Number(a.id) - Number(b.id);
                }

                if (aKnown) return -1;
                if (bKnown) return 1;

                return rankFor(a.key) - rankFor(b.key) ||
                    Number(a.id) - Number(b.id);
            });
    }

    let ballOptionsExpanded = false;

    function setBallOptionsExpanded(expanded) {
        ballOptionsExpanded = Boolean(expanded);
        const host = q('#moth-ac-ball-options');
        const toggle = q('#moth-ac-change-balls');
        if (host) host.hidden = !ballOptionsExpanded;
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(ballOptionsExpanded));
            toggle.textContent = ballOptionsExpanded ? 'Close ▴' : 'Change ▾';
        }
    }

    function choosePriorityBall(key) {
        const priority = sanitizeBallPriority(settings.ballPriority);
        const position = priority.indexOf(key);
        if (position !== -1) {
            priority.splice(position, 1);
        } else if (priority.length < 2) {
            priority.push(key);
        } else {
            // Preserve the chosen primary; a third choice replaces fallback.
            priority[1] = key;
        }
        settings.ballPriority = priority;
        saveSettings();
        setBallOptionsExpanded(false);
        updateUI();
    }

    function syncBallPicker() {
        const host = q('#moth-ac-balls');
        const optionsHost = q('#moth-ac-ball-options');
        if (!host || !optionsHost) return;

        const entries = ballPickerEntries();
        const priority = sanitizeBallPriority(settings.ballPriority);
        const signature = JSON.stringify([
            priority, entries.map(meta =>
                [meta.id, meta.key, meta.nome, meta.catchRate, ballImageSrc(meta)]
            )
        ]);

        if (host.dataset.signature !== signature) {
            host.dataset.signature = signature;
            host.replaceChildren();
            optionsHost.replaceChildren();

            if (!priority.length) {
                const empty = document.createElement('div');
                empty.className = 'moth-ac-ball-empty';
                empty.textContent = 'No balls selected. Choose up to two.';
                host.appendChild(empty);
            }

            for (const [index, key] of priority.entries()) {
                const meta = entries.find(entry => entry.key === key);
                const name = meta?.nome ||
                    key.charAt(0).toUpperCase() + key.slice(1) + ' Ball';
                const card = document.createElement('div');
                card.className = 'moth-ac-ball-active';
                card.dataset.mothActiveId = String(meta?.id ?? '');
                card.dataset.mothActiveKey = key;

                const top = document.createElement('div');
                top.className = 'moth-ac-ball-top';
                const rank = document.createElement('span');
                rank.className = 'moth-ac-ball-rank';
                rank.textContent = index === 0 ? '1' : '2';
                const fallbackIcons = { beast: 5, ultra: 4, super: 3, great: 2, poke: 1 };
                top.append(
                    rank,
                    catalogPickerIcon(
                        meta ? ballImageSrc(meta) :
                            BALL_ASSET_BY_ID[fallbackIcons[key]],
                        name
                    )
                );
                const title = document.createElement('b');
                title.textContent = name;
                title.title = name;
                top.appendChild(title);

                if (index === 1) {
                    const promote = document.createElement('button');
                    promote.type = 'button';
                    promote.className = 'moth-ac-ball-action';
                    promote.title = 'Make primary ball';
                    promote.setAttribute('aria-label', 'Use ' + name + ' first');
                    promote.textContent = '↑';
                    promote.addEventListener('click', () => {
                        settings.ballPriority = [key, priority[0]];
                        saveSettings();
                        updateUI();
                    });
                    top.appendChild(promote);
                }

                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'moth-ac-ball-action';
                remove.title = 'Remove ' + name;
                remove.setAttribute('aria-label', 'Remove ' + name);
                remove.textContent = '×';
                remove.addEventListener('click', () => choosePriorityBall(key));
                top.appendChild(remove);

                const bottom = document.createElement('div');
                bottom.className = 'moth-ac-ball-bottom';
                const stock = document.createElement('span');
                stock.className = 'moth-ac-ball-stock';
                stock.textContent = '— in bag';
                bottom.appendChild(stock);

                const reserveLabel = document.createElement('label');
                reserveLabel.textContent = 'Keep';
                reserveLabel.title = 'Never spend this many ' + name + 's';
                const reserve = document.createElement('input');
                reserve.type = 'number';
                reserve.min = '0';
                reserve.step = '1';
                reserve.dataset.mothReserve = key;
                reserve.setAttribute('aria-label', 'Reserve ' + name);
                reserve.value = String(Math.max(0, Number(settings.reserve[key] || 0)));
                reserve.addEventListener('change', () => {
                    settings.reserve[key] = Math.max(0, Number(reserve.value) || 0);
                    reserve.value = String(settings.reserve[key]);
                    saveSettings();
                    updateUI();
                });
                reserveLabel.appendChild(reserve);
                bottom.appendChild(reserveLabel);
                card.append(top, bottom);
                host.appendChild(card);
            }

            if (!entries.length) {
                const waiting = document.createElement('span');
                waiting.textContent = 'Waiting for ball catalog…';
                optionsHost.appendChild(waiting);
            }

            for (const meta of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'moth-ac-ball-option';
                const selectedIndex = priority.indexOf(meta.key);
                setClass(button, 'on', selectedIndex !== -1);
                button.setAttribute('aria-pressed', String(selectedIndex !== -1));
                button.setAttribute('aria-label', meta.nome);
                button.title = meta.nome +
                    (selectedIndex >= 0 ? ' · selected ' + (selectedIndex + 1) :
                        priority.length === 2 ? ' · replace fallback' : ' · select');
                button.appendChild(catalogPickerIcon(ballImageSrc(meta), meta.nome));
                if (selectedIndex >= 0) {
                    const number = document.createElement('small');
                    number.textContent = String(selectedIndex + 1);
                    button.appendChild(number);
                }
                button.addEventListener('click', () => choosePriorityBall(meta.key));
                optionsHost.appendChild(button);
            }
        }

        for (const card of qa('[data-moth-active-key]', host)) {
            const id = Number(card.dataset.mothActiveId);
            const count = id && protocolBalls.has(id)
                ? Number(protocolBalls.get(id)) : null;
            const stock = q('.moth-ac-ball-stock', card);
            if (stock) stock.textContent =
                (count === null ? '—' : String(count)) + ' in bag';
            const key = card.dataset.mothActiveKey;
            const input = q('[data-moth-reserve]', card);
            const reserve = Math.max(0, Number(settings.reserve[key] || 0));
            if (input && document.activeElement !== input &&
                Number(input.value) !== reserve) {
                input.value = String(reserve);
            }
        }
        optionsHost.hidden = !ballOptionsExpanded;
    }

    function restockControl(
        key,
        label
    ) {
        return `
            <span>${label}</span>
            <input type="number" min="0" step="1" data-moth-restock-at="${key}" title="Restock when inventory is at or below this amount">
            <input type="number" min="0" step="1" data-moth-restock-to="${key}" title="Buy enough to reach this amount">
        `;
    }

    function panelMarkup() {
        return `
            <div class="moth-ac-head">
                <span class="moth-ac-title">Auto Catch+</span>
                <span class="moth-ac-status" id="moth-ac-status">Idle</span>
                <button type="button" class="moth-ac-toggle" id="moth-ac-toggle">OFF</button>
            </div>

            <div class="moth-ac-current" id="moth-ac-current">No target</div>

            <div class="moth-ac-stats">
                <div class="moth-ac-stat"><b id="moth-ac-captures">0</b><span>caught</span></div>
                <div class="moth-ac-stat"><b id="moth-ac-balls-used">0</b><span>balls</span></div>
                <div class="moth-ac-stat"><b id="moth-ac-rate">0%</b><span>success</span></div>
            </div>

            <div class="moth-ac-grid moth-ac-speed">
                <label for="moth-ac-interval">Throw interval (ms)</label>
                <input id="moth-ac-interval" type="number" min="100" max="5000" step="25">
            </div>

            <div class="moth-ac-ball-intro">
                <b>Capture balls</b>
                <span>Primary → fallback · max 2</span>
                <button type="button" id="moth-ac-change-balls" aria-expanded="false" aria-controls="moth-ac-ball-options">Change ▾</button>
            </div>
            <div class="moth-ac-balls" id="moth-ac-balls"></div>
            <div class="moth-ac-ball-options" id="moth-ac-ball-options" hidden></div>

            <div class="moth-ac-restock">
                <div class="moth-ac-restock-head">
                    <label title="Automatically buy the selected ball, potion, and revive while Auto Catch is ON.">
                        <input id="moth-ac-restock-enabled" type="checkbox">
                        Auto-restock
                    </label>
                    <span class="moth-ac-restock-status" id="moth-ac-restock-status">off</span>
                    <button type="button" class="moth-ac-restock-expand" id="moth-ac-restock-expand" aria-expanded="false" aria-controls="moth-ac-restock-settings">Options ▾</button>
                </div>

                <div class="moth-ac-restock-settings" id="moth-ac-restock-settings" hidden>
                    <div class="moth-ac-restock-picker">
                        <div><span>Ball</span><div class="moth-ac-restock-choices" id="moth-ac-restock-ball" role="group" aria-label="Ball to restock"></div></div>
                        <div><span>Potion</span><div class="moth-ac-restock-choices" id="moth-ac-restock-potion" role="group" aria-label="Potion to restock"></div></div>
                        <div><span>Revive</span><div class="moth-ac-restock-choices" id="moth-ac-restock-revive" role="group" aria-label="Revive to restock"></div></div>
                    </div>

                    <div class="moth-ac-restock-grid">
                        <small></small><small>at ≤</small><small>to</small>
                        ${restockControl('ball', 'Ball')}
                        ${restockControl('potion', 'Potion')}
                        ${restockControl('revive', 'Revive')}
                    </div>

                    <div class="moth-ac-grid moth-ac-restock-gold">
                        <label for="moth-ac-restock-gold">Keep gold</label>
                        <input id="moth-ac-restock-gold" type="number" min="0" step="100">
                    </div>
                </div>
            </div>

            <div class="moth-ac-foot">
                <span id="moth-ac-protocol">Protocol: loading</span>
                <button type="button" class="moth-ac-reset" id="moth-ac-reset">Reset stats</button>
            </div>
        `;
    }
    function installPanel() {
        injectStyle();

        if (q('#moth-ac-panel')) return true;

        const host = q('#auto-corpo');
        if (!host) return false;

        const panel = document.createElement('section');
        panel.id = 'moth-ac-panel';
        panel.innerHTML = panelMarkup();
        host.prepend(panel);

        q('#moth-ac-toggle', panel).addEventListener('click', () => {
            setEnabled(!settings.enabled);
        });

        const interval = q('#moth-ac-interval', panel);
        interval.value = settings.intervalMs;

        interval.addEventListener('change', () => {
            settings.intervalMs = Math.max(
                MIN_INTERVAL_MS,
                Math.min(5000, Number(interval.value) || MIN_INTERVAL_MS)
            );

            interval.value = settings.intervalMs;
            saveSettings();

            if (settings.enabled) schedule();
        });

        syncBallPicker();
        syncRestockSelections();
        q('#moth-ac-change-balls', panel).addEventListener('click', () => {
            setBallOptionsExpanded(!ballOptionsExpanded);
        });
        q('#moth-ac-restock-expand', panel).addEventListener('click', event => {
            const settingsPanel = q('#moth-ac-restock-settings', panel);
            const expanded = settingsPanel.hidden;
            settingsPanel.hidden = !expanded;
            event.currentTarget.setAttribute('aria-expanded', String(expanded));
            event.currentTarget.textContent = expanded ? 'Close ▴' : 'Options ▾';
        });

        const restockEnabled =
            q(
                '#moth-ac-restock-enabled',
                panel
            );

        restockEnabled.checked =
            Boolean(
                settings.restock
                    .enabled
            );

        restockEnabled.addEventListener(
            'change',
            () => {
                settings.restock.enabled =
                    restockEnabled.checked;

                if (restockEnabled.checked) {
                    restockHealth.clear();
                    restockSettledUntil.clear();
                    restockSettleUntil = 0;
                }

                saveSettings();
                maybeRestock();
                updateUI();
            }
        );

        // Icon pickers manage their own selection handlers in
        // syncRestockSelections(), including future catalog entries.

        for (
            const input of
            qa(
                '[data-moth-restock-at]',
                panel
            )
        ) {
            const key = input.dataset.mothRestockAt;
            const field =
                key === 'ball'
                    ? 'ballAt'
                    : key === 'potion'
                        ? 'potionAt'
                        : 'reviveAt';

            input.value =
                Number(settings.restock[field] || 0);

            input.addEventListener(
                'change',
                () => {
                    settings.restock[field] = Math.max(
                        0,
                        Number(input.value) || 0
                    );

                    input.value =
                        String(settings.restock[field]);

                    saveSettings();
                    maybeRestock();
                }
            );
        }

        for (
            const input of
            qa(
                '[data-moth-restock-to]',
                panel
            )
        ) {
            const key = input.dataset.mothRestockTo;
            const field =
                key === 'ball'
                    ? 'ballTo'
                    : key === 'potion'
                        ? 'potionTo'
                        : 'reviveTo';

            input.value =
                Number(settings.restock[field] || 0);

            input.addEventListener(
                'change',
                () => {
                    settings.restock[field] = Math.max(
                        0,
                        Number(input.value) || 0
                    );

                    input.value =
                        String(settings.restock[field]);

                    saveSettings();
                    maybeRestock();
                }
            );
        }

        const restockGold =
            q(
                '#moth-ac-restock-gold',
                panel
            );

        restockGold.value =
            Number(
                settings.restock
                    .goldReserve ||
                0
            );

        restockGold.addEventListener(
            'change',
            () => {
                settings.restock
                    .goldReserve =
                        Math.max(
                            0,
                            Number(
                                restockGold.value
                            ) ||
                            0
                        );

                restockGold.value =
                    settings.restock
                        .goldReserve;

                saveSettings();
                maybeRestock();
            }
        );

        q('#moth-ac-reset', panel).addEventListener('click', resetStats);

        updateUI();
        return true;
    }

    function setText(selector, value) {
        const el = q(selector);

        if (!el) {
            return;
        }

        const next = String(value);

        if (el.textContent !== next) {
            el.textContent = next;
        }
    }

    function setClass(el, className, enabled) {
        if (
            el &&
            el.classList.contains(className) !== enabled
        ) {
            el.classList.toggle(
                className,
                enabled
            );
        }
    }

    function protocolLabel() {
        if (!protocolHookInstalled) return 'Protocol: hook failed';
        if (!protocolSockets) return 'Protocol: waiting for socket';
        if (!protocolCaptureSignals) return `Protocol: live · ${protocolMessages} msgs`;
        return `Protocol: ${protocolLastType}`;
    }

    function updateUI() {
        const used = totalUsed();
        const denominator = used || stats.attempts;
        const rate = denominator ? (stats.captures / denominator) * 100 : 0;
        const state = currentTargetState();
        const targetText = formatTargetState(state);
        const protocolText = protocolLabel();

        const toggle = q('#moth-ac-toggle');

        if (toggle) {
            const toggleText =
                settings.enabled
                    ? 'ON'
                    : 'OFF';

            if (
                toggle.textContent !==
                toggleText
            ) {
                toggle.textContent =
                    toggleText;
            }

            setClass(
                toggle,
                'on',
                settings.enabled
            );
        }

        setText('#moth-ac-status', stats.status);
        setText('#moth-ac-current', targetText);
        setText('#moth-ac-captures', stats.captures);
        setText('#moth-ac-balls-used', used);
        setText('#moth-ac-rate', `${rate.toFixed(rate >= 10 ? 0 : 1)}%`);
        setText('#moth-ac-protocol', protocolText);
        syncBallPicker();
        syncRestockSelections();

        setText(
            '#moth-ac-restock-status',
            settings.restock?.enabled
                ? restockLastAction +
                  (
                      stats.restockBought
                          ? ' · +' +
                            stats.restockBought +
                            ' bought'
                          : ''
                  )
                : 'off'
        );

    }

    // ---------------------------------------------------------------------
    // Bootstrap
    // ---------------------------------------------------------------------

    function bootstrap() {
        installProtocolHook();
        ensureRestockItemCatalog();
        installPanel();

        scanTargets();
        syncInventoryUsage();
        updateUI();

        let lastPausedMaintenanceAt = 0;

        setInterval(() => {
            // Purchase acknowledgement expiry must keep running even when
            // Auto Catch is paused and its main tick no longer runs.
            if (restockPending.size) {
                const timedOut = expirePendingRestocks(Date.now());
                if (timedOut) updateUI();
            }

            // When enabled, tick() already performs these jobs at the active
            // capture cadence. Avoid duplicating DOM scans and UI sync here.
            if (settings.enabled) return;

            // While paused, repair the panel and refresh its display every
            // three seconds rather than scanning inventory and targets each second.
            const now = Date.now();
            if (now - lastPausedMaintenanceAt < 3000) return;
            lastPausedMaintenanceAt = now;

            installPanel();
            scanTargets();
            syncInventoryUsage();
            updateUI();
        }, 1000);

        if (settings.enabled) tick();

        console.info('[PokéIdle Auto Catch+] v6.5.7 loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
