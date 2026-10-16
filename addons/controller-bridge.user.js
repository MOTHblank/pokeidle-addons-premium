// ==UserScript==
// @name         Moth Controller Bridge
// @namespace    moth.pokeidle
// @version      1.3.15
// @description  Lightweight protocol bridge for the native Moth controller.
// @match        https://pokeidle.io/app*
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/controller-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/controller-bridge.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-controller-bridge', '1.3.15');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const page = window;
    const existingBridge = page.__mothControllerBridgeV1;
    if (
        existingBridge &&
        Number(existingBridge.version) >= 14 &&
        typeof existingBridge.snapshot === 'function' &&
        typeof existingBridge.gameSnapshot === 'function'
        && typeof existingBridge.streamStateSnapshot === 'function' &&
        typeof existingBridge.marketCatalogSnapshot === 'function' &&
        typeof existingBridge.socket === 'function'
    ) {
        return;
    }

    let socket = null;
    let gameSocket = null;
    // Browser-only, memory-only handshake metadata for the opt-in native session test.
    // Never persist, log, or export this to the DOM or localStorage.
    const helloBySocket = new WeakMap();
    let state = null;
    let statePokemon = new Map();
    let marketCatalogReady = false;
    let catalogoBolas = [];
    let itensCompraveis = [];
    let hunts = [];
    let serverTypeChart = null;
    let huntAmplification = 1.5;

    let lastStreamBonus = '';
    let lastStreamBonusAt = 0;
    let lastMessageAt = 0;

    const copy = value => {
        try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
    };

    /*
     * The current upstream client advertises delta: 1 in hello and then
     * receives partial state frames. Mirror shared/estado-delta.mjs here so
     * the bridge always exposes the same complete state that the game sees.
     */
    function merge(partial, full = false) {
        if (!partial || typeof partial !== 'object') return state;

        const {
            cheio,
            pokemons,
            pkMud,
            pkFora,
            dexMud,
            dexFora,
            ...rest
        } = partial;

        if (full || cheio || !state) {
            state = { ...rest };
            statePokemon = new Map(
                (Array.isArray(pokemons) ? pokemons : [])
                    .filter(pokemon => pokemon?.id != null)
                    .map(pokemon => [String(pokemon.id), pokemon])
            );
            return state;
        }

        Object.assign(state, rest);

        if (Array.isArray(pokemons)) {
            statePokemon = new Map(
                pokemons
                    .filter(pokemon => pokemon?.id != null)
                    .map(pokemon => [String(pokemon.id), pokemon])
            );
        }

        for (const pokemon of pkMud || []) {
            if (pokemon?.id != null) statePokemon.set(String(pokemon.id), pokemon);
        }

        for (const id of pkFora || []) {
            statePokemon.delete(String(id));
        }

        if (dexMud || dexFora) {
            state.pokedex = { ...(state.pokedex || {}), ...(dexMud || {}) };
            for (const id of dexFora || []) delete state.pokedex[id];
        }

        return state;
    }
    function incoming(data, sourceSocket = null) {
        if (typeof data !== 'string') return;

        let message;
        try { message = JSON.parse(data); } catch { return; }

        if (message.t !== 'pong') {
            lastMessageAt = Date.now();
        }

        /*
         * PokéIdle can create more than one WebSocket over the lifetime of a
         * page. The authoritative game socket is the one that emits welcome
         * and game state messages. Do not let an unrelated socket replace it,
         * or the standalone addons can observe the wrong connection.
         */
        if (message.t === 'welcome' && sourceSocket) {
            socket = sourceSocket;
            gameSocket = sourceSocket;
        }

        if (message.t === 'welcome') {
            // Auto Catch+ can attach after this one-time frame, so retain shop
            // catalogs instead of requiring every addon to be listening early.
            catalogoBolas = Array.isArray(message.catalogoBolas)
                ? copy(message.catalogoBolas) || []
                : [];
            itensCompraveis = Array.isArray(message.itensCompraveis)
                ? copy(message.itensCompraveis) || []
                : [];
            marketCatalogReady = true;

            if (Array.isArray(message.hunts)) {
                hunts = copy(message.hunts) || [];
            } else if (Array.isArray(message.estado?.hunts)) {
                hunts = copy(message.estado.hunts) || [];
            } else {
                hunts = [];
            }

            if (
                message.tabelaTipos &&
                typeof message.tabelaTipos === 'object'
            ) {
                serverTypeChart = copy(message.tabelaTipos);
            }

            if (Number.isFinite(Number(message.ampliacaoHunt))) {
                huntAmplification = Number(message.ampliacaoHunt);
            }

            merge(message.estado, true);
            return;
        }

        if (Array.isArray(message.hunts)) {
            hunts = copy(message.hunts) || hunts;
        }

        if (message.estado?.hunts && Array.isArray(message.estado.hunts)) {
            hunts = copy(message.estado.hunts) || hunts;
        }

        if (message.tabelaTipos && typeof message.tabelaTipos === 'object') {
            serverTypeChart = copy(message.tabelaTipos);
        }

        if (Number.isFinite(Number(message.ampliacaoHunt))) {
            huntAmplification = Number(message.ampliacaoHunt);
        }

        if (message.t === 'estado') {
            merge(message.estado);
            return;
        }

        if (message.t === 'batalha') {
            if (sourceSocket && (message.ev || []).some(event => event?.k === 'hunt')) {
                socket = sourceSocket;
                gameSocket = sourceSocket;
            }

            // Keep current-hunt state current without retaining native-Atlas
            // battle history.
            for (const event of message.ev || []) {
                if (event?.k === 'hunt' && typeof event.slug === 'string' && event.slug) {
                    if (!state) state = {};
                    state.huntSlug = event.slug;
                }
            }
            return;
        }
    }

    function attach(ws) {
        if (!socket) socket = ws;

        ws.addEventListener('close', () => {
            if (gameSocket === ws) gameSocket = null;
            if (socket === ws) socket = gameSocket || null;
        });

        ws.addEventListener('message', event => {
            if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
                event.data.text().then(text => incoming(text, ws)).catch(() => {});
            } else {
                incoming(event.data, ws);
            }
        });
    }

    function installHook() {
        /*
         * Observe newly created game sockets through a constructor Proxy.
         * The hook runs in the page context so the game and bridge share the
         * same WebSocket constructor and there is no cross-sandbox assignment.
         */
        const NativeWebSocket = page.WebSocket;
        if (typeof NativeWebSocket !== 'function') return false;
        const nativeSend = NativeWebSocket.prototype.send;
        NativeWebSocket.prototype.send = function (data) {
            try {
                if (typeof data === 'string' && data.length < 32768) {
                    const payload = JSON.parse(data);
                    if (payload?.t === 'hello' && typeof this.url === 'string') {
                        helloBySocket.set(this, data);
                    }
                }
            } catch { /* Protocol observation must never affect gameplay. */ }
            return Reflect.apply(nativeSend, this, arguments);
        };

        let WrappedWebSocket;
        try {
            WrappedWebSocket = new Proxy(NativeWebSocket, {
                construct(target, args, newTarget) {
                    const ws = Reflect.construct(
                        target,
                        args,
                        newTarget === WrappedWebSocket ? target : newTarget
                    );

                    try {
                        attach(ws);
                    } catch (error) {
                        try {
                            console.warn(
                                '[Moth Controller Bridge] socket observation failed:',
                                error
                            );
                        } catch {}
                    }

                    return ws;
                }
            });

            page.WebSocket = WrappedWebSocket;
            return page.WebSocket === WrappedWebSocket;
        } catch (error) {
            /*
             * Instrumentation must never prevent the game from starting.
             * If the page won't allow the wrapper assignment, leave WebSocket
             * untouched and let the game continue without bridge data.
             */
            try {
                console.warn(
                    '[Moth Controller Bridge] WebSocket instrumentation unavailable:',
                    error
                );
            } catch {}
            return false;
        }
    }

    function bridgeSocket() {
        return gameSocket || socket || null;
    }

    function pickNumber(value, names, depth = 0, seen = new Set()) {
        if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return null;
        seen.add(value);

        for (const [key, raw] of Object.entries(value)) {
            const lower = key.toLowerCase();
            if (names.has(lower) && (typeof raw === 'number' || typeof raw === 'string')) {
                const n = Number(raw);
                if (Number.isFinite(n)) return n;
            }
            if (raw && typeof raw === 'object') {
                const nested = pickNumber(raw, names, depth + 1, seen);
                if (nested != null) return nested;
            }
        }
        return null;
    }

    function activePokemon() {
        const id = state?.activeId;
        return id == null
            ? null
            : statePokemon.get(String(id)) || null;
    }

    function bodyTextBonus() {
        // Upstream renders the bonus in these explicit HUD nodes. Avoid a
        // full document.body.innerText traversal on every controller poll.
        const sources = [
            document.querySelector('#tr-ativos')?.innerText || '',
            document.querySelector('#evento-texto')?.innerText || '',
            document.querySelector('#evento-faixa')?.innerText || ''
        ];

        const lines = sources
            .join('\n')
            .split(/\n+/)
            .map(v => v.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        const current = lines.find(line =>
            /\+\s*15\s*%/i.test(line) &&
            /\b(?:XP|EXP|experi)/i.test(line)
        ) || '';

        if (current) {
            lastStreamBonus = current;
            lastStreamBonusAt = Date.now();
        }

        return current;
    }

    function fallen() {
        return document.querySelectorAll('#caidos-lista .caido').length;
    }

    function balls() {
        return [...document.querySelectorAll('#caidos-bolas button.caidos-bola')]
            .map(button => {
                const raw = button.title || button.getAttribute('aria-label') || '';
                const match = raw.match(/(?:você\s+tem|voce\s+tem|you\s+have|tienes)\s+([\d.,]+)/i);
                if (!match) return null;
                return {
                    name: (raw.split('—')[0] || 'Ball').replace(/\s+/g, ' ').trim(),
                    count: Number(match[1].replace(/\D/g, '')) || 0
                };
            })
            .filter(Boolean);
    }

    function snapshot() {
        const pokemon = activePokemon();
        const scanner = document.querySelector('#moth-scan-live-streams');

        const text = selector => {
            const el = document.querySelector(selector);
            return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
        };

        const currentStreamBonus = bodyTextBonus();

        const twitch = state?.twitch || {};
        const twitchPct = Number(
            twitch.pctAtual ??
            twitch.pct ??
            0
        );

        const twitchWatching = Array.isArray(twitch.assistindoEm)
            ? twitch.assistindoEm.filter(Boolean)
            : [];

        const kickScanner = (() => {
            try {
                const api = page.__mothKickScannerV1;
                return api && typeof api.snapshot === 'function'
                    ? copy(api.snapshot())
                    : null;
            } catch {
                return null;
            }
        })();

        if (
            twitchWatching.length &&
            twitchPct > 0
        ) {
            lastStreamBonus =
                '+' +
                twitchPct +
                '% XP · watching ' +
                twitchWatching.join(', ');
            lastStreamBonusAt = Date.now();
        }

        const playerXp = text('#tr-xp-txt');

        const bonusLines = [
            text('#tr-ativos'),
            text('#evento-texto'),
            text('#evento-faixa')
        ]
            .filter(Boolean)
            .filter(line =>
                /\+\s*\d+\s*%/.test(line) &&
                /\b(?:XP|EXP|experi)/i.test(line)
            )
            .slice(0, 8);

        const numberFrom = selector => {
            const match = text(selector).match(/\d[\d.,]*/);
            return match ? Number(match[0].replace(/\D/g, '')) || 0 : 0;
        };

        return {
            connected: !!gameSocket && gameSocket.readyState === page.WebSocket.OPEN,
            lastMessageAt,
            state: {
                level: Number.isFinite(Number(state?.level)) ? Number(state.level) : null,
                xp: Number(state?.xp) || 0,
                xpNivel: Number(state?.xpNivel) || 0,
                xpProximo: Number(state?.xpProximo) || 0,
                huntSlug: state?.huntSlug || '',
                activeId: state?.activeId ?? null,
                gold: Number(state?.gold) || 0,
                orbs: Number(state?.orbs) || 0,
                balls: copy(state?.balls) || {},
                items: copy(state?.items) || {},
                activePokemon: copy(pokemon),
                activePokemonXp: pickNumber(
                    pokemon,
                    new Set(['xp','exp','experiencia','experience','xpAtual','expAtual'])
                ),
                activePokemonXpNivel: Number(pokemon?.xpNivel) || 0,
                activePokemonXpProximo: Number(pokemon?.xpProximo) || 0,
                fallen: fallen(),
                playerXp,
                visibleStreamBonus: currentStreamBonus,
                lastStreamBonus,
                lastStreamBonusAt,
                twitch: copy(state?.twitch),
                kick: copy(state?.kick),
                loja: copy(state?.loja),
                guild: copy(state?.guild),
                passe: copy(state?.passe),
                evento: copy(state?.evento),
                guildBonusPct: Number(state?.guildBonusPct) || 0,
                guildBonusRank: Number(state?.guildBonusRank) || 0,
                trainerXp: Number(state?.xp) || 0,
                trainerXpNivel: Number(state?.xpNivel) || 0,
                trainerXpProximo: Number(state?.xpProximo) || 0,
                xpBonuses: [...new Set(bonusLines)],
                serverNow: Number(state?.servidorAgora) || 0,
                domBalls: balls(),
                autoCatchOn: text('#moth-ac-toggle').toUpperCase() === 'ON',
                autoCatchCaptures: numberFrom('#moth-ac-captures'),
                autoCatchBallsUsed: numberFrom('#moth-ac-balls-used'),
                autoCatchRate: text('#moth-ac-rate'),
                autoCatchRestock: text('#moth-ac-restock-status'),
                streamScanStatus: scanner?.dataset?.mothScanStatus || '',
                streamScanLive: Number(scanner?.dataset?.mothScanLive || 0) || 0,
                streamScanTwitchChannels: scanner?.dataset?.mothScanTwitchChannels !== undefined &&
                    scanner.dataset.mothScanTwitchChannels !== ''
                    ? Number(scanner.dataset.mothScanTwitchChannels) : null,
                streamScanOpened: Number(scanner?.dataset?.mothScanOpened || 0) || 0
            },
            huntAtlas: (() => {
                try {
                    const api = page.__mothHuntAtlasControllerV1;
                    return typeof api?.metrics === 'function' ? copy(api.metrics()) : null;
                } catch { return null; }
            })(),
            hunts: copy(hunts) || [],
            stream: {
                twitch: copy(state?.twitch),
                kick: copy(state?.kick),
                kickScanner,
                bonusCurrent: currentStreamBonus,
                bonusLast: lastStreamBonus
            },
        };
    }

    function gameSnapshot() {
        return {
            connected: !!gameSocket && gameSocket.readyState === page.WebSocket.OPEN,
            lastMessageAt,
            state: {
                level: Number.isFinite(Number(state?.level)) ? Number(state.level) : null,
                xp: Number(state?.xp) || 0,
                xpNivel: Number(state?.xpNivel) || 0,
                xpProximo: Number(state?.xpProximo) || 0,
                huntSlug: state?.huntSlug || '',
                activeId: state?.activeId ?? null,
                noCentro: state?.noCentro ?? null,
                casa: copy(state?.casa),
                boss: copy(state?.boss),
                evento: copy(state?.evento),
                pokemons: copy([...statePokemon.values()]) || [],
                pokedex: copy(state?.pokedex) || {}
            },
            hunts: copy(hunts) || [],
            // Give late-attaching HuntAtlas the native ball efficiencies
            // without requiring a second WebSocket welcome event.
            marketCatalogReady,
            catalogoBolas: copy(catalogoBolas) || [],
            serverTypeChart: copy(serverTypeChart),
            huntAmplification
        };
    }

    page.__mothControllerBridgeV1 = {
        version: 14,
        sessionBootstrap() {
            // Only expose the server-confirmed game socket, not unrelated sockets.
            const ws = gameSocket;
            const hello = ws && helloBySocket.get(ws);
            return ws && ws.readyState === page.WebSocket.OPEN && hello
                ? { url: ws.url, hello } : null;
        },
        marketCatalogSnapshot() {
            return {
                ready: marketCatalogReady,
                balls: copy(catalogoBolas) || [],
                items: copy(itensCompraveis) || [],
                state: state ? {
                    gold: state.gold,
                    balls: copy(state.balls),
                    items: copy(state.items)
                } : null
            };
        },
        streamStateSnapshot() {
            // Used by the stream scanner to read live state without calling
            // snapshot(), which itself queries the scanner diagnostics API.
            return {
                twitch: copy(state?.twitch),
                kick: copy(state?.kick)
            };
        },
        snapshot,
        gameSnapshot,
        socket: bridgeSocket
    };

    installHook();
})();
