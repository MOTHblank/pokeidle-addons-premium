// ==UserScript==
// @name         PokéIdle Performance+
// @namespace    moth.pokeidle
// @version      5.5.4
// @description  Performance+ pauses map rendering, hides visual noise and chat, and keeps capture controls visible.
// @match        https://pokeidle.io/*
// @match        https://www.pokeidle.io/*
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/performance.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/performance.user.js
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-performance', '5.5.4');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const STORAGE_KEY = 'moth-pokeidle-performance-v7';
    const PREVIOUS_KEY = 'moth-pokeidle-performance-v6';
    const LEGACY_KEY = 'moth-pokeidle-performance-v5';
    const NATIVE_OPT_OWNER_KEY = 'moth-pokeidle-performance-native-opt-owner';
    const NATIVE_OPT_BASE_KEY = 'moth-pokeidle-performance-native-opt-base';
    const TRIGGER_ID = 'moth-performance-trigger';
    const TELEMETRY_ID = 'moth-performance-telemetry';
    const STYLE_ID = 'moth-performance-style';

    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const q = (selector, root = document) => root.querySelector(selector);

    const nativeSetInterval = page.setInterval.bind(page);
    const nativeClearInterval = page.clearInterval.bind(page);

    // ON is always the strongest safe profile: pause map drawing, preserve
    // the live capture controls, freeze sprite animations and simplify UI.
    // OFF restores the game's original rendering and scheduling.
    const DEFAULTS = {
        enabled: true
    };

    function loadSettings() {
        let saved = {};
        let currentSettings = null;
        try {
            currentSettings = localStorage.getItem(STORAGE_KEY);
        } catch {}
        const isUpgrade = currentSettings === null;

        try {
            saved = JSON.parse(
                currentSettings ||
                localStorage.getItem(PREVIOUS_KEY) ||
                localStorage.getItem(LEGACY_KEY) ||
                '{}'
            );
        } catch {}

        // Older releases could persist OFF or the removed Full profile.
        // Start enabled once on upgrade, then preserve the user's new toggle choice.
        const loaded = {
            ...DEFAULTS,
            ...saved,
            enabled: isUpgrade
                ? true
                : typeof saved.enabled === 'boolean'
                    ? saved.enabled
                    : DEFAULTS.enabled
        };
        delete loaded.profile;

        if (isUpgrade) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
            } catch {}
        }

        return loaded;
    }

    let settings = loadSettings();
    // Headless Firefox forces Performance+ only for the monitored session.
    // Preserve the saved toggle for the next visible session.
    const FORCE_ON_ATTR = 'data-moth-performance-force-on';
    const ACTIVE_ATTR = 'data-moth-performance-active';
    let forcedOn = document.documentElement?.hasAttribute(FORCE_ON_ATTR) ?? false;
    const isEnabled = () => settings.enabled || forcedOn;

    function refreshHeadlessPolicy() {
        forcedOn = document.documentElement?.hasAttribute(FORCE_ON_ATTR) ?? false;
    }

    document.addEventListener('moth-performance-policy-change', () => {
        refreshHeadlessPolicy();
        applyMode();
    });

    let interactionBoostUntil = 0;
    // Apply the saved choice before app.js creates its first Campo instance.
    let currentMode = isEnabled() ? 'paused' : 'full';


    // Exact campo.mjs loop hook state.
    const nativeRAF = page.requestAnimationFrame?.bind(page);
    const nativeCancelRAF = page.cancelAnimationFrame?.bind(page);
    const throttledRequests = new Map();
    const suspendedCampoRequests = new Map();
    // A suspended replay callback must not keep an otherwise destroyed Campo
    // and its canvas alive merely because Performance+ is enabled.
    const weakCampoCallback = callback => typeof WeakRef === 'function'
        ? new WeakRef(callback)
        : { deref: () => callback };

    function pruneSuspendedCampoLoops() {
        for (const [id, ref] of suspendedCampoRequests) {
            if (!ref.deref()) {
                suspendedCampoRequests.delete(id);
                throttledRequests.delete(id);
            }
        }
    }
    const rafState = new WeakMap();
    const rafClassification = new WeakMap();
    let nextSyntheticRafId = -1;
    let campoHookInstalled = false;
    let campoLoopFound = false;
    let campoRunsWindow = 0;
    let campoRunsPerSecond = 0;

    function saveSettings() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function isNativeEconomy() {
        return document.documentElement.classList.contains('modo-economia');
    }

    function autoCatchEnabled() {
        const button = q('#moth-ac-toggle');

        if (button) {
            return button.textContent.trim().toUpperCase() === 'ON';
        }

        try {
            return Boolean(
                JSON.parse(
                    localStorage.getItem('moth-pokeidle-autocatch-v4') || '{}'
                ).enabled
            );
        } catch {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Native optimized mode cooperation
    // ------------------------------------------------------------------

    function forceNativeOptimized() {
        try {
            const owned =
                localStorage.getItem(
                    NATIVE_OPT_OWNER_KEY
                ) === '1';

            if (owned) {
                localStorage.setItem(
                    'cfg-otimizado',
                    '1'
                );

                return;
            }

            if (
                localStorage.getItem(
                    'cfg-otimizado'
                ) === '1'
            ) {
                /*
                 * The player already enabled PokéIdle's own optimization.
                 * Leave it entirely under their control.
                 */
                return;
            }

            const previous =
                localStorage.getItem(
                    'cfg-otimizado'
                );

            localStorage.setItem(
                NATIVE_OPT_BASE_KEY,
                previous === null
                    ? '__null__'
                    : previous
            );

            localStorage.setItem(
                NATIVE_OPT_OWNER_KEY,
                '1'
            );

            localStorage.setItem(
                'cfg-otimizado',
                '1'
            );
        } catch {}
    }

    function restoreNativeOptimized() {
        try {
            if (
                localStorage.getItem(
                    NATIVE_OPT_OWNER_KEY
                ) !== '1'
            ) {
                return;
            }

            const previous =
                localStorage.getItem(
                    NATIVE_OPT_BASE_KEY
                );

            if (
                previous ===
                '__null__'
            ) {
                localStorage.removeItem(
                    'cfg-otimizado'
                );
            } else if (
                previous !==
                null
            ) {
                localStorage.setItem(
                    'cfg-otimizado',
                    previous
                );
            }

            localStorage.removeItem(
                NATIVE_OPT_OWNER_KEY
            );

            localStorage.removeItem(
                NATIVE_OPT_BASE_KEY
            );
        } catch {}
    }

    function syncNativeOptimized() {
        const shouldForce = isEnabled() && !isNativeEconomy();

        if (shouldForce) {
            forceNativeOptimized();
        } else {
            restoreNativeOptimized();
        }
    }

    /*
     * Restore the user's own native preference on navigation/reload. The
     * next page load re-enables it at document-start if Performance+ still
     * needs it.
     */
    page.addEventListener(
        'pagehide',
        restoreNativeOptimized
    );

    // ------------------------------------------------------------------
    // Upstream-aware requestAnimationFrame throttling
    // ------------------------------------------------------------------

    function scheduleComesFromCampo() {
        try {
            return /(?:https:\/\/pokeidle\.io)?\/campo\.mjs(?:\?|:)/i
                .test(
                    String(
                        new Error()
                            .stack ||
                        ''
                    )
                );
        } catch {
            return false;
        }
    }

    function classifyRafCallback(
        callback
    ) {
        if (
            typeof callback !==
                'function'
        ) {
            return null;
        }

        if (
            rafClassification.has(
                callback
            )
        ) {
            return rafClassification.get(callback);
        }

        const name =
            String(
                callback.name ||
                ''
            );

        let kind =
            null;

        /*
         * app.js has a permanent rAF in the Pokémon Center solely to keep
         * the nurse/TM/depot/house buttons visually attached to NPCs.
         */
        if (
            name ===
                'seguirEnfermeira' ||
            String(
                callback
            ).includes(
                'seguirBotaoCentro'
            )
        ) {
            kind =
                'npc';


        } else if (
            scheduleComesFromCampo()
        ) {
            /*
             * Every Campo instance has its own bound loop. v4 only found
             * the first one, allowing replay/war/PvP Campo instances to
             * run uncapped. Classify every distinct callback once.
             */
            kind =
                'campo';

            campoLoopFound =
                true;
        }

        // Do not throttle unknown rAF callers; some drive controls/modals.
        rafClassification.set(callback, kind);

        if (
            kind ===
                'campo'
        ) {
            console.info(
                '[PokéIdle Performance+] hooked a campo.mjs renderer'
            );
        } else if (
            kind ===
                'npc'
        ) {
            console.info(
                '[PokéIdle Performance+] hooked Center NPC positioning loop'
            );
        }

        return kind;
    }

    function intervalForRafKind(kind) {
        if (!isEnabled()) return 0;
        if (kind !== 'npc') return 0; // Campo rendering is suspended entirely.
        if (document.hidden) return 500;
        // On user input, keep NPC action buttons attached to their targets.
        if (Date.now() < interactionBoostUntil) return 1000 / 30;
        return 1000;
    }

    function installCampoHook() {
        if (
            campoHookInstalled ||
            !nativeRAF ||
            !nativeCancelRAF
        ) {
            return campoHookInstalled;
        }

        function mothRequestAnimationFrame(
            callback
        ) {
            const kind =
                classifyRafCallback(
                    callback
                );

            if (!kind) {
                return nativeRAF(
                    callback
                );
            }

            const publicId = nextSyntheticRafId--;
            if (kind === 'campo' && isEnabled() && currentMode === 'paused') {
                const pending = { actualId: null, cancelled: false, suspended: true };
                throttledRequests.set(publicId, pending);
                suspendedCampoRequests.set(publicId, weakCampoCallback(callback));
                return publicId;
            }

            const pending = {
                actualId: null,
                cancelled: false
            };

            const gate =
                timestamp => {
                    if (
                        pending.cancelled
                    ) {
                        throttledRequests.delete(
                            publicId
                        );

                        return;
                    }

                    if (kind === 'campo' && isEnabled() && currentMode === 'paused') {
                        pending.actualId = null;
                        pending.suspended = true;
                        suspendedCampoRequests.set(publicId, weakCampoCallback(callback));
                        return;
                    }

                    const interval =
                        intervalForRafKind(
                            kind
                        );

                    let callbackState =
                        rafState.get(
                            callback
                        );

                    if (
                        !callbackState
                    ) {
                        callbackState = {
                            lastRun:
                                -Infinity
                        };

                        rafState.set(
                            callback,
                            callbackState
                        );
                    }

                    if (
                        interval > 0 &&
                        timestamp -
                            callbackState
                                .lastRun <
                            interval
                    ) {
                        pending.actualId =
                            nativeRAF(
                                gate
                            );

                        return;
                    }

                    callbackState.lastRun =
                        timestamp;

                    if (
                        kind ===
                            'campo'
                    ) {
                        campoRunsWindow++;
                    }

                    throttledRequests.delete(
                        publicId
                    );

                    callback.call(
                        page,
                        timestamp
                    );
                };

            pending.actualId =
                nativeRAF(
                    gate
                );

            throttledRequests.set(
                publicId,
                pending
            );

            return publicId;
        }

        function mothCancelAnimationFrame(
            id
        ) {
            const pending =
                throttledRequests.get(
                    id
                );

            if (!pending) {
                return nativeCancelRAF(
                    id
                );
            }

            pending.cancelled =
                true;

            if (
                pending.actualId !=
                null
            ) {
                nativeCancelRAF(
                    pending.actualId
                );
            }

            suspendedCampoRequests.delete(id);
            throttledRequests.delete(
                id
            );
        }

        try {
            page.requestAnimationFrame =
                mothRequestAnimationFrame;

            page.cancelAnimationFrame =
                mothCancelAnimationFrame;

            campoHookInstalled =
                page.requestAnimationFrame ===
                mothRequestAnimationFrame;
        } catch (error) {
            console.warn(
                '[PokéIdle Performance+] rAF hook failed',
                error
            );

            campoHookInstalled =
                false;
        }

        return campoHookInstalled;
    }

    // ------------------------------------------------------------------
    // Hot presentation interval throttling
    // ------------------------------------------------------------------

    const uiTimerClassification =
        new WeakMap();

    // sprites.mjs: spriteAnimado paints the first frame synchronously, then
    // starts a 220ms animation timer per canvas. Preserve that first image.
    // In Performance mode one shared cleanup pass replaces all the timers;
    // otherwise their native 220ms cadence runs unchanged.
    const spriteTimers = new Map();
    const SPRITE_MAINTENANCE_MS = 15000;
    let spriteTimerId = -1000000;
    let spriteMaintenanceId = null;
    let spriteTimerMode = isEnabled();

    function spriteTimerTick(record) {
        if (!spriteTimers.has(record.id)) return;
        try {
            record.callback.apply(page, record.args);
        } catch (error) {
            console.error('[PokéIdle Performance+] sprite timer error', error);
        }
    }

    function stopSpriteMaintenance() {
        if (spriteMaintenanceId == null) return;
        nativeClearInterval(spriteMaintenanceId);
        spriteMaintenanceId = null;
    }

    function ensureSpriteMaintenance() {
        if (spriteMaintenanceId != null || !spriteTimers.size || !isEnabled()) return;
        spriteMaintenanceId = nativeSetInterval(() => {
            for (const record of [...spriteTimers.values()]) spriteTimerTick(record);
        }, SPRITE_MAINTENANCE_MS);
    }

    function startSpriteNativeTimer(record) {
        if (record.nativeId != null) return;
        record.nativeId = nativeSetInterval(
            () => spriteTimerTick(record), record.delay
        );
    }

    function registerSpriteTimer(callback, delay, args) {
        const id = spriteTimerId--;
        const record = { id, callback, delay, args, nativeId: null };
        spriteTimers.set(id, record);
        if (isEnabled()) ensureSpriteMaintenance();
        else startSpriteNativeTimer(record);
        return id;
    }

    function mothClearInterval(id) {
        const record = spriteTimers.get(id);
        if (!record) return nativeClearInterval(id);
        spriteTimers.delete(id);
        if (record.nativeId != null) nativeClearInterval(record.nativeId);
        if (!spriteTimers.size) stopSpriteMaintenance();
    }

    function syncSpriteTimerMode() {
        if (spriteTimerMode === isEnabled()) return;
        spriteTimerMode = isEnabled();
        if (isEnabled()) {
            for (const record of spriteTimers.values()) {
                if (record.nativeId != null) nativeClearInterval(record.nativeId);
                record.nativeId = null;
            }
            ensureSpriteMaintenance();
        } else {
            stopSpriteMaintenance();
            for (const record of spriteTimers.values()) startSpriteNativeTimer(record);
        }
    }

    let uiTimerHookInstalled =
        false;

    function classifyUiTimer(
        callback,
        delay
    ) {
        if (
            typeof callback !==
                'function'
        ) {
            return null;
        }

        if (
            uiTimerClassification.has(
                callback
            )
        ) {
            return (
                uiTimerClassification.get(
                    callback
                ) ||
                null
            );
        }

        const name =
            String(
                callback.name ||
                ''
            );

        const source =
            String(
                callback
            );

        // Exact spriteAnimado() closure (sprites.mjs). A timer-only hook avoids
        // wrapping every Canvas2D drawImage/clearRect call on the page.
        const isSpriteTimer = Number(delay) === 220 &&
            /\bcv\.isConnected\b/.test(source) &&
            /\bclearInterval\s*\(\s*timer\s*\)/.test(source) &&
            /\bpintar\s*\(\s*\)/.test(source);

        let kind = isSpriteTimer ? 'sprite' : null;

        if (kind === 'sprite') {
            // Already classified by callsite signature.
        } else if (
            name ===
                'tiqueCentroSaida'
        ) {
            kind =
                'exitHud';
        } else if (
            name ===
                'pintarCaidos'
        ) {
            kind =
                'fallen';
        } else if (
            name ===
                'pintarPillDeFila' ||
            name ===
                'tiqueFilaNoModal'
        ) {
            kind =
                'pvpTicker';
        } else if (
            name ===
                'tiqueCentro'
        ) {
            kind =
                'centerTicker';
        } else if (
            Number(delay) ===
                100 &&
            source.includes(
                'reposicionarGolpesPainel'
            ) &&
            source.includes(
                'golpesCooldownFim'
            )
        ) {
            kind =
                'moveHud';
        }

        uiTimerClassification.set(
            callback,
            kind ||
                false
        );

        return kind;
    }

    function uiTimerMinimum(kind) {
        if (!isEnabled()) return 0;
        // Any recent user interaction restores native cadence temporarily.
        if (Date.now() < interactionBoostUntil) return 0;

        switch (kind) {
            case 'moveHud': return 2000;   // Hidden move panel
            case 'exitHud': return 500;    // Keep the exit button actionable
            case 'pvpTicker': return 1500;
            case 'centerTicker': return 1500;
            case 'fallen':
                // Auto Catch+ reads the upstream fallen-body DOM, not the map.
                // Never delay its producer while Auto Catch+ is enabled.
                return autoCatchEnabled() ? 0 : 750;
            default: return 0;
        }
    }

    function installUiTimerHook() {
        if (
            uiTimerHookInstalled
        ) {
            return true;
        }

        function mothSetInterval(
            callback,
            delay,
            ...args
        ) {
            const kind =
                classifyUiTimer(
                    callback,
                    delay
                );

            if (kind === 'sprite') {
                return registerSpriteTimer(callback, delay, args);
            }

            if (!kind) {
                return nativeSetInterval(
                    callback,
                    delay,
                    ...args
                );
            }

            let lastRun =
                -Infinity;

            const wrapped =
                function (
                    ...callbackArgs
                ) {
                    const now =
                        performance.now();

                    const minimum =
                        uiTimerMinimum(
                            kind
                        );

                    if (
                        minimum > 0 &&
                        now -
                            lastRun <
                            minimum
                    ) {
                        return;
                    }

                    lastRun =
                        now;

                    return callback.apply(
                        this,
                        callbackArgs
                    );
                };

            return nativeSetInterval(
                wrapped,
                delay,
                ...args
            );
        }

        try {
            page.setInterval =
                mothSetInterval;

            // Native IDs pass through; managed sprite intervals use
            // negative synthetic IDs and must be cancelled through our map.
            page.clearInterval =
                mothClearInterval;

            uiTimerHookInstalled =
                page.setInterval ===
                mothSetInterval;
        } catch (error) {
            console.warn(
                '[PokéIdle Performance+] UI timer hook failed',
                error
            );

            uiTimerHookInstalled =
                false;
        }

        return uiTimerHookInstalled;
    }

    // Install both hooks before app.js/campo.mjs schedule their permanent loops.
    installCampoHook();
    installUiTimerHook();

    // ------------------------------------------------------------------
    // UI performance levels
    // ------------------------------------------------------------------

    function calculateMode() {
        return isEnabled() ? 'paused' : 'full';
    }

    function resumeSuspendedCampoLoops() {
        const pendingRequests = [...suspendedCampoRequests.entries()];
        suspendedCampoRequests.clear();

        for (const [id, weak] of pendingRequests) {
            const pending = throttledRequests.get(id);
            const callback = weak.deref();
            if (!pending || pending.cancelled || !callback) {
                continue;
            }

            throttledRequests.delete(id);
            pending.cancelled = true;
            try {
                callback.call(page, performance.now());
            } catch (error) {
                console.warn('[PokéIdle Performance+] could not resume map renderer', error);
            }
        }
    }

    function applyMode() {
        const previousMode = currentMode;
        currentMode = calculateMode();
        if (previousMode === 'paused' && currentMode !== 'paused') {
            resumeSuspendedCampoLoops();
        }

        const html =
            document.documentElement;

        // The dashboard reads this state, never the browser's frame rate.
        html.setAttribute(ACTIVE_ATTR, isEnabled() ? '1' : '0');
        html.classList.toggle('moth-perf-minimal', isEnabled());

        html.classList.toggle('moth-ui-performance', isEnabled());
        html.classList.remove('moth-ui-lite', 'moth-ui-aggressive');

        syncSpriteTimerMode();
        syncNativeOptimized();
        updateUI();
    }

    // Keep essential controls responsive to input; changing this timestamp
    // does not switch modes or repeatedly write DOM on every wheel event.
    function recordActivity() {
        interactionBoostUntil = Date.now() + 2500;
    }

    for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.addEventListener(eventName, recordActivity, {
            passive: true, capture: true
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) interactionBoostUntil = Date.now() + 1500;
        applyMode();
    });

    function installStyles() {
        if (q('#' + STYLE_ID)) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id = STYLE_ID;

        style.textContent = `
            /*
             * Trace-backed target:
             * reposicionarGolpesPainel produced repeated style/layout work.
             * In an idle game the move HUD is informational, not an input.
             */
            html.moth-ui-performance #golpes-painel {
                display: none !important;
            }

            /*
             * Aggressive UI Lite stops painting frequently-changing
             * informational feeds. Capture controls/history are NOT here.
             */
            html.moth-ui-performance #hud-log,
            html.moth-ui-performance .evento-faixa,
            html.moth-ui-performance #musica-player {
                display: none !important;
            }

            /*
             * UI Max must never remove interactive/core game UI.
             * Chat, team, active Pokémon and automation controls stay fully
             * usable. Only redundant live indicators are removed.
             */
            html.moth-ui-performance #ir-centro-conta {
                display: none !important;
            }

            /* Map canvas and decorative overlays are hidden; the actual
               campo.mjs rAF loop is suspended above, not merely made invisible. */
            html.moth-ui-performance #palco > :not(#caidos) {
                visibility: hidden !important;
                pointer-events: none !important;
            }

            html.moth-ui-performance #palco {
                background: transparent !important;
            }

            /* Capture is the sole scene surface kept interactive. */
            html.moth-ui-performance #caidos:not(.hidden),
            html.moth-ui-performance #caidos:not(.hidden) * {
                visibility: visible !important;
                pointer-events: auto !important;
            }

            html.moth-ui-performance #p-chat {
                display: none !important;
            }

            /* Freeze CSS-driven animations for active and party Pokémon. */
            html.moth-ui-performance :is(#ativo-card, #time-corpo),
            html.moth-ui-performance :is(#ativo-card, #time-corpo) *,
            html.moth-ui-performance :is(#ativo-card, #time-corpo) *::before,
            html.moth-ui-performance :is(#ativo-card, #time-corpo) *::after {
                animation-play-state: paused !important;
                animation-duration: 0s !important;
                transition: none !important;
            }

            /*
             * Do not put a wildcard rule on every #app descendant: PokéIdle
             * creates/reuses DOM constantly, and forcing every new node and
             * pseudo-element through a giant override selector becomes its
             * own style-recalculation tax. Native Optimized already removes
             * scene hit effects; target the remaining decorative surfaces.
             */
            html.moth-perf-minimal :is(
                .ab-confete,
                .ab-confete *,
                .recompensa,
                .recompensa *,
                .shiny-anuncio,
                .shiny-anuncio *,
                .lendario-anuncio,
                .lendario-anuncio *,
                .evento-faixa,
                .evento-faixa *,
                .pvp-fila-pill,
                .pvp-fila-pill *,
                .rc-flash,
                .rc-particulas,
                .la-relampago,
                .la-raios,
                .la-faiscas
            ) {
                animation-duration: .001ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: .001ms !important;
                backdrop-filter: none !important;
                filter: none !important;
                text-shadow: none !important;
                box-shadow: none !important;
            }

            html.moth-perf-minimal :is(
                .la-relampago,
                .la-raios,
                .la-faiscas,
                .rc-flash,
                .rc-particulas,
                .ab-confete
            ) {
                display: none !important;
            }

            #${TRIGGER_ID} {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 0 !important;
                width: auto !important;
                height: 25px !important;
                padding: 3px 7px !important;
                margin-left: auto !important;
                border: 1px solid rgba(255,255,255,.16) !important;
                border-radius: 999px !important;
                background: rgba(40,31,35,.75) !important;
                color: #ddd !important;
                font: 700 9px/1 system-ui,sans-serif !important;
                cursor: pointer !important;
                opacity: 1 !important;
                visibility: visible !important;
                position: relative !important;
                z-index: 20 !important;
            }

            #${TRIGGER_ID}.working {
                color: #8fe0a5 !important;
                border-color: rgba(100,210,130,.35) !important;
            }

            #${TRIGGER_ID}.warning {
                color: #ffd27c !important;
                border-color: rgba(255,190,80,.38) !important;
            }

            #${TELEMETRY_ID} {
                display: none !important;
            }

        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);
    }

    function setText(el, value) {
        if (!el) {
            return;
        }

        const next =
            String(value);

        if (
            el.textContent !==
            next
        ) {
            el.textContent =
                next;
        }
    }

    function setClass(el, className, enabled) {
        if (
            el &&
            el.classList.contains(
                className
            ) !== Boolean(enabled)
        ) {
            el.classList.toggle(
                className,
                Boolean(enabled)
            );
        }
    }

    // ------------------------------------------------------------------
    // Light control UI
    // ------------------------------------------------------------------

    function ensureTelemetry() {
        let telemetry = q('#' + TELEMETRY_ID);

        if (!telemetry) {
            telemetry = document.createElement('div');
            telemetry.id = TELEMETRY_ID;
            telemetry.hidden = true;
            telemetry.setAttribute('aria-hidden', 'true');
            (document.body || document.documentElement)?.appendChild(telemetry);
        }

        for (const id of ['mpp-browser-fps', 'mpp-scene-runs']) {
            if (q('#' + id, telemetry)) continue;

            const value = document.createElement('span');
            value.id = id;
            value.textContent = '0';
            telemetry.appendChild(value);
        }

        return telemetry;
    }

    function ensureTrigger() {
        if (!document.body) {
            return false;
        }

        installStyles();
        installCampoHook();
        ensureTelemetry();

        const header =
            q('#p-auto .painel-cab-auto') ||
            q('#p-auto .painel-cab');

        if (!header) {
            return false;
        }

        let trigger = q('#' + TRIGGER_ID);
        if (!trigger) {
            trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.id = TRIGGER_ID;
            trigger.title = 'Toggle Performance+ on or off';
            trigger.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                if (forcedOn) return;

                settings.enabled = !settings.enabled;
                saveSettings();
                applyMode();
            });
        }

        const collapse = q('#btn-auto-toggle', header);
        if (collapse) {
            if (trigger.parentElement !== header) {
                header.insertBefore(trigger, collapse);
            }
        } else if (trigger.parentElement !== header) {
            header.appendChild(trigger);
        }

        return true;
    }

    function updateUI() {
        const trigger =
            q('#' + TRIGGER_ID);

        ensureTelemetry();
        setText(
            q('#mpp-browser-fps'),
            document.hidden || currentMode === 'paused'
                ? 0
                : Math.round(campoRunsPerSecond)
        );
        setText(
            q('#mpp-scene-runs'),
            Math.round(campoRunsPerSecond)
        );

        if (!trigger) {
            return;
        }

        let triggerText;
        let working = false;
        let warning = false;

        if (!isEnabled()) {
            triggerText = 'Performance+ OFF';
        } else if (isNativeEconomy()) {
            triggerText = 'Performance+ ON · Native Eco';
            warning = true;
        } else if (
            !campoHookInstalled ||
            !uiTimerHookInstalled
        ) {
            triggerText = 'Performance+ ON · Hook!';
            warning = true;
        } else if (!campoLoopFound) {
            triggerText = 'Performance+ ON · Loading…';
            warning = true;
        } else {
            triggerText = 'Performance+ ON';
            working = true;
        }

        setText(trigger, forcedOn ? triggerText + ' · Headless' : triggerText);
        trigger.setAttribute('aria-pressed', String(isEnabled()));
        trigger.title = forcedOn
            ? 'Performance+ is required while Firefox is headless'
            : isEnabled()
                ? 'Turn Performance+ off'
                : 'Turn Performance+ on';

        setClass(trigger, 'working', working);
        setClass(trigger, 'warning', warning);
    }

    // ------------------------------------------------------------------
    // Tick / bootstrap
    // ------------------------------------------------------------------

    nativeSetInterval(() => {
        // Fallback if the policy event does not cross userscript worlds.
        refreshHeadlessPolicy();
        campoRunsPerSecond = campoRunsWindow;
        campoRunsWindow = 0;
        pruneSuspendedCampoLoops();
        applyMode();
    }, 1000);

    function bootstrap() {
        refreshHeadlessPolicy();
        installStyles();
        installCampoHook();
        ensureTrigger();

        applyMode();

        nativeSetInterval(() => {
            installCampoHook();
            installUiTimerHook();
            ensureTrigger();
        }, 1500);

        console.info(
            '[PokéIdle Performance+] v5.5.3 loaded'
        );
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            bootstrap,
            {
                once: true
            }
        );
    } else {
        bootstrap();
    }
})();
