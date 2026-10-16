// ==UserScript==
// @name         Twitch Low Resource Mode
// @namespace    moth.pokeidle
// @version      3.2.3
// @description  Keeps one Twitch IRC socket alive, dynamically JOINs/PARTs chats at safe rates, and limits chat rendering.
// @match        https://pokeidle.io/app*
// @match        https://www.pokeidle.io/app*
// @match        https://www.twitch.tv/*
// @match        https://www.twitch.tv/*/*
// @match        https://player.twitch.tv/*
// @match        https://m.twitch.tv/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/twitch-low-resource.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/twitch-low-resource.user.js
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-twitch-low-resource', '3.2.3');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const isTwitch = /(^|\.)twitch\.tv$/i.test(location.hostname);
    const isPokéIdleApp = /(^|\.)pokeidle\.io$/i.test(location.hostname) && /^\/app(?:\/|$)/i.test(location.pathname);
    const popoutMatch = isTwitch && location.pathname.match(/^\/popout\/([^/]+)\/chat(?:\/|$)/i);
    const isTwitchChatPopout = !!popoutMatch;

    function normalizeTwitchChannel(raw) {
        const value = String(raw || '').trim().replace(/^#/, '').toLowerCase();
        return /^[a-z0-9_]{1,25}$/.test(value) ? value : '';
    }

    const initialMultiChatChannels = (() => {
        if (!isTwitchChatPopout) return [];
        let primary = '';
        try { primary = decodeURIComponent(popoutMatch[1]); }
        catch (_) { primary = popoutMatch[1]; }
        const channels = new URLSearchParams(location.search)
            .getAll('moth-channels').flatMap(value => value.split(','));
        return [...new Set([primary, ...channels]
            .map(normalizeTwitchChannel).filter(Boolean))].slice(0, 100);
    })();

    let requestedMultiChatChannels = initialMultiChatChannels;
    let onDesiredChanged = () => {};

    function readDesiredChatChannels() {
        const json = document.documentElement?.getAttribute('data-moth-twitch-desired');
        if (json == null) return initialMultiChatChannels;
        try {
            const names = JSON.parse(json);
            if (!Array.isArray(names)) return requestedMultiChatChannels;
            const unique = [...new Set(names.map(normalizeTwitchChannel).filter(Boolean))];
            if (unique.length > 100) {
                console.warn('[Moth] Twitch concurrent IRC join cap is 100; extra channels skipped');
            }
            return unique.slice(0, 100);
        } catch (_) {
            return requestedMultiChatChannels;
        }
    }

    if (isTwitchChatPopout) {
        window.addEventListener('moth-twitch-desired-changed', () => {
            requestedMultiChatChannels = readDesiredChatChannels();
            onDesiredChanged();
        });
    }

    /*
     * Filter only high-volume chat text. IRC JOIN/PART, ROOMSTATE, USERSTATE,
     * NOTICE, PING and related control messages must reach Twitch's own app,
     * or its connection/room state can become inconsistent.
     */
    function isTwitchIrcSocket(socket) {
        try {
            return new URL(socket.url, location.href).hostname.toLowerCase() === 'irc-ws.chat.twitch.tv';
        } catch (_) {
            return false;
        }
    }

    function filterIrcChatPayload(payload) {
        if (typeof payload !== 'string') {
            return { changed: false, drop: false, data: payload };
        }

        const separator = payload.includes('\r\n') ? '\r\n' : payload.includes('\n') ? '\n' : '\r';
        const lines = payload.split(/\r\n|\n|\r/);
        const kept = lines.filter(line => {
            const match = line.match(/^(?:@[^ ]+\s+)?(?::[^ ]+\s+)?([A-Z0-9]+)(?:\s|$)/i);
            const command = match?.[1]?.toUpperCase() || '';
            return command !== 'PRIVMSG' && command !== 'USERNOTICE';
        });
        if (kept.length === lines.length) {
            return { changed: false, drop: false, data: payload };
        }
        const data = kept.join(separator);
        return { changed: true, drop: !data.trim(), data };
    }

    

    function installChatMessageFilter() {
        const NativeWebSocket = window.WebSocket;
        if (!NativeWebSocket || NativeWebSocket.__mothTwitchChatFiltered) return false;

        const nativeOnMessage =
            Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
        const listenerWrappers = new WeakMap();
        const onMessageHandlers = new WeakMap();
        const filteredEvents = new WeakMap();
        const initializedSockets = new WeakSet();
        const joinedChannels = new Set();
        // The native-first branch hands this IRC handshake to Rust over an
        // already-authenticated Firefox BiDi session, without storing the
        // Twitch bearer token in the DOM, GM storage, console or on disk.
        const authenticationBySocket = new WeakMap();
        const nativeAuthApi = Object.freeze({
            snapshot() {
                const ws = activeSocket;
                const auth = ws && authenticationBySocket.get(ws);
                if (!ws || ws.readyState !== NativeWebSocket.OPEN ||
                    !initializedSockets.has(ws) || !auth?.pass || !auth?.nick)
                    return null;
                return {
                    url: ws.url,
                    pass: auth.pass,
                    nick: auth.nick,
                    cap: auth.cap || ''
                };
            }
        });
        Object.defineProperty(window, '__mothTwitchNativeBootstrapV1', {
            value: nativeAuthApi, configurable: true
        });

        function observeOutgoingIrc(socket, payload) {
            if (!isTwitchIrcSocket(socket) || typeof payload !== 'string') return;
            const auth = authenticationBySocket.get(socket) ||
                { pass: '', nick: '', cap: '' };
            for (const line of payload.split(/\r\n|\n|\r/)) {
                if (/^PASS\s+oauth:[A-Za-z0-9_]+\s*$/i.test(line))
                    auth.pass = line.trim();
                else if (/^NICK\s+[A-Za-z0-9_]{1,25}\s*$/i.test(line))
                    auth.nick = line.trim();
                else if (/^CAP\s+REQ\s+:[a-z0-9.\/\s_-]+$/i.test(line))
                    auth.cap = line.trim();
            }
            authenticationBySocket.set(socket, auth);
        }
        const JOIN_GAP_MS = 600; // < 20 joins per 10 seconds per Twitch user
        let nextJoinAt = 0;
        let activeSocket = null;
        let syncTimer = null;

        function setSocketStatus(status) {
            const root = document.documentElement;
            if (!root || root.getAttribute('data-moth-twitch-irc-status') === status)
                return;
            root.setAttribute('data-moth-twitch-irc-status', status);
            window.dispatchEvent(new Event('moth-twitch-irc-status'));
        }

        function reconcile() {
            syncTimer = null;
            const socket = activeSocket;
            if (!socket || socket.readyState !== NativeWebSocket.OPEN) return;

            const desired = new Set(requestedMultiChatChannels);
            // PART is cheap, and deliberately does not touch persistent rooms.
            for (const channel of [...joinedChannels]) {
                if (desired.has(channel)) continue;
                try {
                    NativeWebSocket.prototype.send.call(socket, 'PART #' + channel);
                    joinedChannels.delete(channel);
                } catch (error) {
                    console.warn('[Moth] Could not PART Twitch chat:', channel, error);
                }
            }

            const missing = requestedMultiChatChannels.find(channel =>
                !joinedChannels.has(channel));
            if (!missing) {
                if (initializedSockets.has(socket)) setSocketStatus('ready');
                return;
            }

            // Rate-limit individual channel joins, not JOIN command strings:
            // Twitch counts each room joined even for comma-separated JOIN.
            const delay = Math.max(0, nextJoinAt - Date.now());
            if (delay) {
                scheduleReconcile(delay);
                return;
            }
            try {
                NativeWebSocket.prototype.send.call(socket, 'JOIN #' + missing);
                joinedChannels.add(missing);
                nextJoinAt = Date.now() + JOIN_GAP_MS;
                setSocketStatus('ready');
            } catch (error) {
                console.warn('[Moth] Could not JOIN Twitch chat:', missing, error);
                nextJoinAt = Date.now() + 10_500;
            }
            scheduleReconcile(Math.max(50, nextJoinAt - Date.now()));
        }

        function scheduleReconcile(delay = 0) {
            if (syncTimer !== null) {
                if (delay > 0) return;
                window.clearTimeout(syncTimer);
            }
            syncTimer = window.setTimeout(reconcile, delay);
        }

        onDesiredChanged = () => scheduleReconcile();
        requestedMultiChatChannels = readDesiredChatChannels();
        // Cross-script DOM events can be delayed in Firefox's isolated worlds.
        // Poll a single attribute as a cheap, reliable fallback.
        window.setInterval(() => {
            const next = readDesiredChatChannels();
            if (JSON.stringify(next) === JSON.stringify(requestedMultiChatChannels)) return;
            requestedMultiChatChannels = next;
            onDesiredChanged();
        }, 5000);

        function filterEvent(event) {
            let result = filteredEvents.get(event);
            if (result) return result;
            result = filterIrcChatPayload(event?.data);
            filteredEvents.set(event, result);
            return result;
        }

        function deliverFiltered(socket, listener, thisArg, event) {
            if (!isTwitchIrcSocket(socket)) {
                return typeof listener === 'function'
                    ? listener.call(thisArg, event)
                    : listener.handleEvent.call(listener, event);
            }
            const result = filterEvent(event);
            if (result.drop) return;

            let deliveredEvent = event;
            if (result.changed) {
                try {
                    Object.defineProperty(event, 'data', {
                        configurable: true, get: () => result.data
                    });
                } catch (_) {
                    deliveredEvent = new MessageEvent('message', {
                        data: result.data,
                        origin: event.origin,
                        lastEventId: event.lastEventId,
                        bubbles: event.bubbles,
                        cancelable: event.cancelable
                    });
                }
            }
            return typeof listener === 'function'
                ? listener.call(thisArg, deliveredEvent)
                : listener.handleEvent.call(listener, deliveredEvent);
        }

        function getWrapper(socket, listener) {
            if (!listener || (typeof listener !== 'function' &&
                typeof listener.handleEvent !== 'function')) return listener;
            let map = listenerWrappers.get(socket);
            if (!map) {
                map = new Map();
                listenerWrappers.set(socket, map);
            }
            if (map.has(listener)) return map.get(listener);
            const wrapped = function (event) {
                return deliverFiltered(socket, listener, this, event);
            };
            map.set(listener, wrapped);
            return wrapped;
        }

        class LowResourceWebSocket extends NativeWebSocket {
            constructor(url, protocols) {
                if (protocols === undefined) super(url);
                else super(url, protocols);
                if (isTwitchIrcSocket(this)) {
                    this.addEventListener('open', () => {
                        if (activeSocket === this) setSocketStatus('connecting');
                    });
                    this.addEventListener('close', () => {
                        if (activeSocket !== this) return;
                        activeSocket = null;
                        joinedChannels.clear();
                        if (syncTimer !== null) window.clearTimeout(syncTimer);
                        syncTimer = null;
                        setSocketStatus('closed');
                    });
                    this.addEventListener('error', () => {
                        if (activeSocket === this) setSocketStatus('error');
                    });
                }
            }

            send(data) {
                if (!isTwitchIrcSocket(this) || typeof data !== 'string')
                    return super.send(data);
                observeOutgoingIrc(this, data);

                // Twitch itself sends the initial JOIN only after authentication.
                // Use that point to bootstrap subscriptions on its existing
                // authenticated WebSocket, without opening extra chat sockets.
                const parts = data.split(/(\r\n|\n|\r)/);
                let hasJoin = false;
                for (let i = 0; i < parts.length; i += 2) {
                    if (/^(?:@[^\s]+\s+)?JOIN\s+#[a-z0-9_]/i.test(parts[i])) {
                        parts[i] = '';
                        hasJoin = true;
                    }
                }
                if (!hasJoin) return super.send(data);

                if (activeSocket !== this) {
                    activeSocket = this;
                    joinedChannels.clear();
                    if (syncTimer !== null) window.clearTimeout(syncTimer);
                    syncTimer = null;
                }
                initializedSockets.add(this);
                const other = parts.join('');
                if (other.trim()) super.send(other);
                scheduleReconcile();
            }

            addEventListener(type, listener, options) {
                if (type === 'message' && isTwitchIrcSocket(this))
                    return super.addEventListener(type, getWrapper(this, listener), options);
                return super.addEventListener(type, listener, options);
            }

            removeEventListener(type, listener, options) {
                if (type === 'message' && isTwitchIrcSocket(this)) {
                    const wrapped = listenerWrappers.get(this)?.get(listener) || listener;
                    return super.removeEventListener(type, wrapped, options);
                }
                return super.removeEventListener(type, listener, options);
            }

            set onmessage(listener) {
                if (!isTwitchIrcSocket(this) || !nativeOnMessage?.set) {
                    if (nativeOnMessage?.set) nativeOnMessage.set.call(this, listener);
                    return;
                }
                if (!listener) {
                    onMessageHandlers.delete(this);
                    nativeOnMessage.set.call(this, listener);
                    return;
                }
                const wrapped = getWrapper(this, listener);
                onMessageHandlers.set(this, { listener, wrapped });
                nativeOnMessage.set.call(this, wrapped);
            }

            get onmessage() {
                return onMessageHandlers.get(this)?.listener ||
                    (nativeOnMessage?.get ? nativeOnMessage.get.call(this) : null);
            }
        }

        Object.defineProperty(LowResourceWebSocket,
            '__mothTwitchChatFiltered', { value: true });
        window.WebSocket = LowResourceWebSocket;
        return true;
    }

    

    // The controller checks the game page to confirm this userscript is enabled.
    // This marker is separate from Twitch's live-mode CSS because the script is
    // intentionally active on the game page only as an installation heartbeat.
    if (isPokéIdleApp) {
        const markReady = () => {
            if (document.getElementById('moth-twitch-low-resource-addon-ready')) return;
            const marker = document.createElement('meta');
            marker.id = 'moth-twitch-low-resource-addon-ready';
            marker.name = 'moth-twitch-low-resource-addon-ready';
            (document.head || document.documentElement)?.appendChild(marker);
        };

        if (document.head || document.documentElement) markReady();
        else document.addEventListener('DOMContentLoaded', markReady, { once: true });
        return;
    }

    // One popout socket can join all current Twitch channels for this Firefox profile.
    if (isTwitchChatPopout) {
        installChatMessageFilter();
        runChatLowResource();
        return;
    }

    if (isTwitch) {
        runTwitch();
        return;
    }

    function textOf(el) {
        try {
            return String(
                el?.closest('label')?.textContent ||
                el?.getAttribute?.('aria-label') ||
                el?.parentElement?.textContent ||
                el?.textContent ||
                ''
            ).replace(/\s+/g, ' ').trim();
        } catch (_) {
            return '';
        }
    }

    function numericQuality(text) {
        const match = String(text || '').match(/(\d{3,4})p/i);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    }

    function simulateClick(el) {
        if (!el) return;

        try {
            el.focus();
        } catch (_) {}

        for (const type of [
            'pointerover',
            'pointerenter',
            'pointerdown',
            'mousedown',
            'pointerup',
            'mouseup',
            'click'
        ]) {
            try {
                el.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true
                }));
            } catch (_) {
                try {
                    el.click();
                } catch (_) {}
            }
        }
    }

    function findMainVideo() {
        const videos = [...document.querySelectorAll('video')]
            .filter(video => {
                const rect = video.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            })
            .sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.width * br.height) - (ar.width * ar.height);
            });

        return videos[0] || null;
    }


    function runChatLowResource() {
        const STYLE_ID = 'moth-twitch-low-resource-chat-css';

        const installStyles = () => {
            if (document.getElementById(STYLE_ID)) return true;

            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = [
                /* Keep the Twitch page/session alive, but remove all chat painting and layout. */
                'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #0e0e10 !important; }',
                '[data-a-target="chat-room-component-layout"], .chat-room__content, .chat-room__container { display: none !important; }',
                /* Fallbacks for Twitch DOM variations. */
                '[data-a-target="chat-scrollable-area__message-container"], .chat-scrollable-area__message-container { display: none !important; }',
                '[data-a-target="chat-input"], [data-a-target="chat-input-container"], .chat-input, .chat-input__textarea { display: none !important; }',
                '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important; }'
            ].join('\n');

            const host = document.head || document.documentElement;
            if (!host) return false;
            host.appendChild(style);
            return true;
        };

        if (!installStyles()) {
            document.addEventListener('DOMContentLoaded', installStyles, { once: true });
        }

        console.info('[Moth] Twitch popout low-resource mode active · IRC JOIN/PART deltas paced · keepalive/control events preserved · chat UI hidden');
    }

    function runTwitch() {
        const TARGET_QUALITY_RE = /^160p(?:\D|$)/i;
        const QUALITY_OPTION_SELECTOR =
            '[data-a-target="player-settings-menu"] input[type="radio"],' +
            '[data-a-target="player-settings-submenu-quality-option"]';

        let qualityBusy = false;
        let lastQualityAttempt = 0;
        let qualityConfiguredAt = 0;
        let lastUrl = location.href;

        const isLowestOption = (el) => TARGET_QUALITY_RE.test(textOf(el));

        const closeQualityMenu = async () => {
            try {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true,
                    cancelable: true
                }));
            } catch (_) {}
            await sleep(100);

            const menu = document.querySelector('[data-a-target="player-settings-menu"]');
            if (menu) {
                try {
                    document.querySelector('[data-a-target="player-settings-button"]')?.click();
                } catch (_) {}
            }
        };

        const forceLowestQuality = async () => {
            if (qualityBusy) return;
            if (Date.now() - qualityConfiguredAt < 60000) return;
            if (Date.now() - lastQualityAttempt < 15000) return;

            const gear =
                document.querySelector('[data-a-target="player-settings-button"]');

            const video = document.querySelector('video');

            if (!gear || !video) return;

            lastQualityAttempt = Date.now();
            qualityBusy = true;

            try {
                gear.click();
                await sleep(250);

                let qualityButton =
                    document.querySelector(
                        '[data-a-target="player-settings-menu-item-quality"]'
                    );

                if (!qualityButton) {
                    qualityButton = [...document.querySelectorAll(
                        '[data-a-target="player-settings-menu"] button'
                    )].find(el => /quality/i.test(el.textContent || ''));
                }

                if (!qualityButton) return;

                qualityButton.click();
                await sleep(250);

                const options = [...document.querySelectorAll(QUALITY_OPTION_SELECTOR)];

                if (!options.length) return;

                let target = options.find(isLowestOption);

                if (!target) {
                    const scored = options
                        .map((el, index) => ({
                            el,
                            index,
                            height: numericQuality(textOf(el))
                        }))
                        .filter(item => Number.isFinite(item.height))
                        .sort(
                            (a, b) =>
                                a.height - b.height ||
                                a.index - b.index
                        );

                    target = scored[0]?.el;
                }

                if (!target) return;

                (target.closest('label') || target.parentElement || target).click();
                await sleep(250);

                qualityConfiguredAt = Date.now();
                console.info('[Moth] Twitch low-resource quality:', textOf(target));
            } catch (error) {
                console.warn('[Moth] Twitch low-resource quality failed:', error);
            } finally {
                await closeQualityMenu();
                qualityBusy = false;
            }
        };

        const addTwitchCss = () => {
            if (document.getElementById('moth-twitch-low-resource-css')) return;

            const style = document.createElement('style');
            style.id = 'moth-twitch-low-resource-css';
            style.textContent = [
                '[data-a-target="chat-room-component-layout"] { display:none !important; }',
                '[data-a-target="side-nav"] { display:none !important; }',
                '[data-a-target="recommendations-container"],',
                '[data-a-target="home-recommendations"] { content-visibility:auto !important; }'
            ].join('\n');

            (document.head || document.documentElement)?.appendChild(style);
        };

        const tick = () => {
            addTwitchCss();

            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastQualityAttempt = 0;
                qualityConfiguredAt = 0;
            }

            void forceLowestQuality();
        };

        addTwitchCss();
        void forceLowestQuality();
        setInterval(tick, 15000);

        console.info('[Moth] Twitch low-resource mode active');
    }
})();
