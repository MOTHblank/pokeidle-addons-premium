// ==UserScript==
// @name         PokéIdle Live Stream Scanner
// @namespace    moth.pokeidle
// @version      7.2.2
// @description  Maintains one persistent Twitch chat tab and syncs channels with IRC JOIN/PART without reloads; KICK stays in Rust.
// @match        https://pokeidle.io/app*
// @match        https://www.pokeidle.io/app*
// @match        https://www.twitch.tv/popout/*/chat*
// @grant        window.close
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/stream-auto-open.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/stream-auto-open.user.js
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    // Per-profile tab lease and heartbeat. Reconcile chat subscriptions in place.
    const CHAT_TARGET_KEY = 'moth-twitch-chat-target-v2';
    const CHAT_ACTIVE_KEY = 'moth-twitch-chat-active-v2';
    const CHAT_DESIRED_KEY = 'moth-twitch-chat-desired-v3';
    const CHAT_HEARTBEAT_KEY = 'moth-twitch-chat-heartbeat-v3';
    const CHAT_LAUNCH_KEY = 'moth-twitch-chat-launch-v3';
    const CHAT_READY_TIMEOUT_MS = 90_000;
    const CHAT_HEARTBEAT_MAX_AGE_MS = 160_000;
    const CHAT_DISCONNECT_GRACE_MS = 150_000;
    const CHAT_HEARTBEAT_INTERVAL_MS = 20_000;
    const isManagedPopout = location.hostname === 'www.twitch.tv' &&
        /^\/popout\/[^/]+\/chat(?:\/|$)/i.test(location.pathname) &&
        new URLSearchParams(location.search).has('moth-generation');

    function readStoredJson(key) {
        try {
            return JSON.parse(String(GM_getValue(key, '') || 'null'));
        } catch (_) {
            return null;
        }
    }

    function chatHostIsAlive() {
        const heartbeat = readStoredJson(CHAT_HEARTBEAT_KEY);
        if (!heartbeat?.generation ||
            Date.now() - Number(heartbeat.updatedAt) > CHAT_HEARTBEAT_MAX_AGE_MS ||
            Number(heartbeat.updatedAt) > Date.now() + 10_000) return false;

        if (heartbeat.status === 'ready') return true;
        return heartbeat.disconnectedAt &&
            Date.now() - heartbeat.disconnectedAt < CHAT_DISCONNECT_GRACE_MS;
    }

    if (isManagedPopout) {
        const generation = new URLSearchParams(location.search)
            .get('moth-generation') || '';
        let disconnectedAt = 0;
        let wasReady = false;

        function socketStatus() {
            return document.documentElement?.getAttribute('data-moth-twitch-irc-status') || '';
        }

        function closeIfSuperseded(active) {
            if (active === generation) return;
            const target = String(GM_getValue(CHAT_TARGET_KEY, '') || '');
            const launch = readStoredJson(CHAT_LAUNCH_KEY);
            // A candidate remains open until it can replace the current tab.
            // Unactivated contenders that lost a launch race retire promptly.
            const lostLaunch = active !== generation && target !== generation &&
                launch?.generation && launch.generation !== generation &&
                Date.now() - launch.at < CHAT_READY_TIMEOUT_MS;
            const confirmedSuccessor = active && active !== generation &&
                readStoredJson(CHAT_HEARTBEAT_KEY)?.generation === active &&
                chatHostIsAlive();
            if ((active?.startsWith('stop-') && target !== generation) || lostLaunch ||
                (confirmedSuccessor && target !== generation)) {
                try { window.close(); }
                catch (error) { console.warn('[Moth] Twitch tab close failed:', error); }
            }
        }

        function deliverDesired() {
            let channels = readStoredJson(CHAT_DESIRED_KEY);
            if (!Array.isArray(channels)) {
                channels = (new URLSearchParams(location.search)
                    .get('moth-channels') || '').split(',');
            }
            if (!document.documentElement) return;
            document.documentElement.setAttribute(
                'data-moth-twitch-desired', JSON.stringify(channels));
            window.dispatchEvent(new Event('moth-twitch-desired-changed'));
        }

        function publishHeartbeat() {
            if (!generation) return;
            const ready = socketStatus() === 'ready';
            const active = String(GM_getValue(CHAT_ACTIVE_KEY, '') || '');
            const target = String(GM_getValue(CHAT_TARGET_KEY, '') || '');
            if (ready) {
                disconnectedAt = 0;
                wasReady = true;
                // Initial readiness or recovery from a transient disconnect.
                // Do not steal ownership from another confirmed live tab.
                if (active !== generation && target === generation) {
                    GM_setValue(CHAT_ACTIVE_KEY, generation);
                    GM_setValue(CHAT_LAUNCH_KEY, '');
                }
            } else if (wasReady && !disconnectedAt) {
                disconnectedAt = Date.now();
            }

            if (String(GM_getValue(CHAT_ACTIVE_KEY, '') || '') === generation) {
                GM_setValue(CHAT_HEARTBEAT_KEY, JSON.stringify({
                    generation,
                    status: ready ? 'ready' : 'disconnected',
                    disconnectedAt,
                    updatedAt: Date.now()
                }));
            }
            closeIfSuperseded(String(GM_getValue(CHAT_ACTIVE_KEY, '') || ''));
        }

        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(CHAT_DESIRED_KEY, deliverDesired);
            GM_addValueChangeListener(CHAT_LAUNCH_KEY,
                () => closeIfSuperseded(String(GM_getValue(CHAT_ACTIVE_KEY, '') || '')));
            GM_addValueChangeListener(CHAT_ACTIVE_KEY,
                (_key, _old, value) => closeIfSuperseded(String(value || '')));
        }
        window.addEventListener('moth-twitch-irc-status', publishHeartbeat);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', deliverDesired, { once: true });
        } else {
            deliverDesired();
        }
        publishHeartbeat();
        window.setInterval(publishHeartbeat, CHAT_HEARTBEAT_INTERVAL_MS);
        closeIfSuperseded(String(GM_getValue(CHAT_ACTIVE_KEY, '') || ''));
        return;
    }

    

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-stream-auto-open', '7.2.2');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const BUTTON_ID = 'moth-scan-live-streams';
    const INVENTORY_ID = 'btn-bolsa';

    const LIVE_SCAN_INTERVAL_MS = 60 * 1000;
    const INITIAL_SCAN_DELAY_MS = 30 * 1000;
    const UI_RECHECK_INTERVAL_MS = 30 * 1000;

    let scanInProgress = false;
    const openStreams = new Map();
    const MULTI_CHAT_KEY = 'twitch:multi-chat';
    let pendingReplacement = null;
    let nextChatGeneration = 0;
    let twitchEmptySince = 0;
    let lastKickLive = [];
    let lastKickStateAvailable = false;
    let lastKickObservedAt = 0;

    const excludedTwitch = new Set([
        'directory', 'downloads', 'jobs', 'p', 'search',
        'settings', 'subscriptions', 'wallet'
    ]);

    const excludedKick = new Set([
        'categories', 'browse', 'directory', 'following', 'search',
        'settings', 'auth', 'login', 'register', 'signup',
        'video', 'videos'
    ]);

    const sleep = (ms) =>
        new Promise((resolve) => window.setTimeout(resolve, ms));

    const text = (value) =>
        String(value == null ? '' : value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

    function channelName(raw) {
        const value = String(raw || '').trim();

        if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
            return value;
        }

        try {
            const url = new URL(value, location.href);
            const host = url.hostname.toLowerCase().replace(/^www\./, '');

            if (host !== 'twitch.tv' && host !== 'kick.com') {
                return '';
            }

            const parts = url.pathname.split('/').filter(Boolean);

            return parts.length === 1
                ? decodeURIComponent(parts[0])
                : '';
        } catch (_) {
            return '';
        }
    }

    function channelUrl(service, raw) {
        const name = channelName(raw);

        if (!name) {
            return null;
        }

        const host =
            service === 'twitch'
                ? 'www.twitch.tv'
                : service === 'kick'
                    ? 'kick.com'
                    : null;

        return host
            ? 'https://' + host + '/' + encodeURIComponent(name)
            : null;
    }

    function chatUrl(service, raw) {
        const name = channelName(raw);

        if (!name) {
            return null;
        }

        const host =
            service === 'twitch'
                ? 'www.twitch.tv'
                : service === 'kick'
                    ? 'kick.com'
                    : null;

        return host
            ? 'https://' + host + '/popout/' +
                encodeURIComponent(name) + '/chat'
            : null;
    }

    function normalizeLiveLink(service, raw) {
        const url = channelUrl(service, raw);

        if (!url) {
            return null;
        }

        const name = channelName(raw);
        const excluded =
            service === 'twitch' ? excludedTwitch : excludedKick;

        return excluded.has(name.toLowerCase())
            ? null
            : {
                service,
                name,
                url,
                chat: chatUrl(service, name)
            };
    }

    function collectLinks(selectors) {
        const found = new Map();

        for (const selector of selectors) {
            for (const anchor of document.querySelectorAll(selector)) {
                const href =
                    anchor.href ||
                    anchor.getAttribute('href') ||
                    '';

                const host = (() => {
                    try {
                        return new URL(href, location.href)
                            .hostname
                            .toLowerCase()
                            .replace(/^www\./, '');
                    } catch (_) {
                        return '';
                    }
                })();

                const service =
                    host === 'twitch.tv'
                        ? 'twitch'
                        : host === 'kick.com'
                            ? 'kick'
                            : null;

                if (!service) {
                    continue;
                }

                const item = normalizeLiveLink(service, href);

                if (item) {
                    found.set(service + ':' + text(item.name), item);
                }
            }
        }

        return [...found.values()];
    }

    function liveStateRows() {
        return {
            twitch: document.querySelector(
                '#tr-ativos .tr-ativo.twitch'
            ),
            kick: document.querySelector(
                '#tr-ativos .tr-ativo.kick'
            )
        };
    }

    function readLiveChannelsFromBridge() {
        try {
            const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const bridge = page.__mothControllerBridgeV1;
            const state = bridge && typeof bridge.streamStateSnapshot === 'function'
                ? bridge.streamStateSnapshot()
                : null;

            if (!state) {
                return null;
            }

            const twitchLives = state.twitch?.lives;
            const kickOfficials = state.kick?.oficiais;
            const hasTwitchState = Array.isArray(twitchLives);
            const hasKickState = Array.isArray(kickOfficials);

            if (!hasTwitchState && !hasKickState) {
                return null;
            }

            const collected = new Map();

            if (hasTwitchState) {
                for (const channel of twitchLives) {
                    const raw = channel?.login || channel?.name;
                    const item = normalizeLiveLink('twitch', raw);
                    if (item) {
                        collected.set('twitch:' + text(item.name), item);
                    }
                }
            }

            const kickLive = [];
            if (hasKickState) {
                for (const channel of kickOfficials) {
                    if (!channel?.aoVivo) {
                        continue;
                    }

                    const raw = channel?.slug || channel?.login;
                    const item = normalizeLiveLink('kick', raw);
                    if (!item) {
                        continue;
                    }

                    collected.set('kick:' + text(item.name), item);
                    kickLive.push({
                        name: item.name,
                        url: item.url
                    });
                }
            }

            return {
                live: collected,
                twitchStateAvailable: hasTwitchState,
                kickStateAvailable: hasKickState,
                kickLive
            };
        } catch (_) {
            return null;
        }
    }

    async function collectOfficialLiveChannels() {
        // Compatibility fallback for cases where the controller bridge has not
        // attached yet. The normal path reads the game's current live state
        // directly and does not need to open/close the bonus modals.
        const collected = new Map();

        const direct = collectLinks([
            'a.tw-canal.ao-vivo[href*="twitch.tv/"]',
            'a.kk-canal.ao-vivo[href*="kick.com/"]',
            '#tr-ativos .tr-ativo.twitch.tw-aovivo a[href*="twitch.tv/"]',
            '#tr-ativos .tr-ativo.kick.kk-aovivo a[href*="kick.com/"]'
        ]);

        for (const item of direct) {
            collected.set(item.service + ':' + text(item.name), item);
        }

        const target = {
            row: '.tr-ativo.twitch.tw-aovivo',
            links: '#tw-corpo a.tw-canal.ao-vivo[href*="twitch.tv/"]'
        };
        const row = document.querySelector(target.row);

        if (row) {
            try {
                row.click();
            } catch (_) {
                return collected;
            }

            for (let attempt = 0; attempt < 15; attempt += 1) {
                for (const item of collectLinks([target.links])) {
                    collected.set(
                        item.service + ':' + text(item.name),
                        item
                    );
                }

                if ([...collected.values()].some(item => item.service === 'twitch')) {
                    break;
                }

                await sleep(100);
            }

            const close = document.getElementById('modal-fechar');
            if (close) {
                try {
                    close.click();
                } catch (_) {}
                await sleep(80);
            }
        }

        return collected;
    }

    function waitForGameUi(timeoutMs = 15_000) {
        return new Promise((resolve) => {
            const started = Date.now();

            const check = () => {
                const ready =
                    !!document.body &&
                    (
                        document.getElementById(INVENTORY_ID) ||
                        document.querySelector('.menu-topo')
                    );

                if (ready) {
                    resolve(true);
                    return;
                }

                if (Date.now() - started >= timeoutMs) {
                    resolve(false);
                    return;
                }

                window.setTimeout(check, 250);
            };

            check();
        });
    }

    function closeChatHandle(tab) {
        if (!tab || tab.closed) return;
        try { tab.close(); }
        catch (error) { console.warn('[Moth] could not close Twitch chat:', error); }
    }

    function onChatActivated(active) {
        const pending = pendingReplacement;
        if (!pending || String(active || '') !== pending.generation) return;
        pendingReplacement = null;
        window.clearTimeout(pending.timeout);
        console.info('[Moth] Twitch multi-chat socket ready:', pending.channelCount, 'channel(s)');
    }

    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(CHAT_ACTIVE_KEY, (_key, _old, value) =>
            onChatActivated(value));
    }

    function openMultiChat(items) {
        const channels = [...new Set(items
            .map(item => channelName(item?.name).toLowerCase())
            .filter(name => /^[a-z0-9_]{1,25}$/.test(name))
        )].sort((a, b) => a.localeCompare(b));
        if (!channels.length) return false;

        // Publish the full desired set. The existing popout changes IRC
        // subscriptions in place; it never navigates or refreshes for deltas.
        const desired = JSON.stringify(channels);
        if (GM_getValue(CHAT_DESIRED_KEY, '') !== desired) {
            GM_setValue(CHAT_DESIRED_KEY, desired);
        }

        if (chatHostIsAlive()) return false;

        const launch = readStoredJson(CHAT_LAUNCH_KEY);
        if (launch?.generation && Date.now() - launch.at < CHAT_READY_TIMEOUT_MS) {
            return false;
        }
        if (pendingReplacement) return false;

        const baseUrl = chatUrl('twitch', channels[0]);
        if (!baseUrl || typeof GM_openInTab !== 'function') {
            console.error('[Moth] cannot open Twitch popout');
            return false;
        }

        const generation = Date.now().toString(36) + '-' +
            (++nextChatGeneration).toString(36) + '-' +
            Math.random().toString(36).slice(2, 10);
        const target = new URL(baseUrl);
        target.searchParams.set('moth-channels', channels.join(','));
        target.searchParams.set('moth-generation', generation);
        const previousTarget = String(GM_getValue(CHAT_TARGET_KEY, '') || '');
        let tab = null;

        try {
            // The launch lease suppresses duplicate tabs after /app reloads and
            // across game tabs in this Firefox profile.
            GM_setValue(CHAT_LAUNCH_KEY, JSON.stringify({
                generation, at: Date.now()
            }));
            GM_setValue(CHAT_TARGET_KEY, generation);
            tab = GM_openInTab(target.toString(), { active: false, insert: true });
            if (!tab || typeof tab.close !== 'function') {
                throw new Error('GM_openInTab did not return a tab control');
            }

            const pending = {
                generation, tab, channelCount: channels.length, timeout: null
            };
            pendingReplacement = pending;
            openStreams.set(MULTI_CHAT_KEY, tab);
            pending.timeout = window.setTimeout(() => {
                if (pendingReplacement !== pending) return;
                pendingReplacement = null;
                if (String(GM_getValue(CHAT_ACTIVE_KEY, '') || '') === generation) {
                    return;
                }
                closeChatHandle(tab);
                if (openStreams.get(MULTI_CHAT_KEY) === tab)
                    openStreams.delete(MULTI_CHAT_KEY);
                if (readStoredJson(CHAT_LAUNCH_KEY)?.generation === generation)
                    GM_setValue(CHAT_LAUNCH_KEY, '');
                if (GM_getValue(CHAT_TARGET_KEY, '') === generation)
                    GM_setValue(CHAT_TARGET_KEY, previousTarget);
                console.warn('[Moth] Twitch chat socket was not ready; will retry');
            }, CHAT_READY_TIMEOUT_MS);
            onChatActivated(GM_getValue(CHAT_ACTIVE_KEY, ''));
            console.info('[Moth] opening persistent Twitch multi-chat:', channels.length, 'channel(s)');
            return true;
        } catch (error) {
            closeChatHandle(tab);
            if (readStoredJson(CHAT_LAUNCH_KEY)?.generation === generation)
                GM_setValue(CHAT_LAUNCH_KEY, '');
            if (GM_getValue(CHAT_TARGET_KEY, '') === generation)
                GM_setValue(CHAT_TARGET_KEY, previousTarget);
            console.error('[Moth] failed to open Twitch multi-chat:', error);
            return false;
        }
    }

    

    function rewardedTwitchKeys() {
        // A stream can be actively rewarding even when the current live-stream
        // list does not contain it (for example while PokéIdle is refreshing
        // its stream data). Never close a Twitch tab that the game reports as
        // currently being watched for rewards.
        try {
            const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const bridge = page.__mothControllerBridgeV1;
            const snapshot = bridge && typeof bridge.snapshot === 'function'
                ? bridge.snapshot()
                : null;
            const watching = snapshot?.state?.twitch?.assistindoEm;

            if (!Array.isArray(watching)) {
                return new Set();
            }

            return new Set(
                watching
                    .map(channelName)
                    .filter(Boolean)
                    .map(name => 'twitch:' + text(name))
            );
        } catch (_) {
            return new Set();
        }
    }

    function closeStreamsNotLive(liveKeys, protectedKeys = new Set()) {
        for (const [key, tab] of [...openStreams.entries()]) {
            if (
                tab?.closed ||
                (!liveKeys.has(key) && !protectedKeys.has(key))
            ) {
                try {
                    if (!tab?.closed) {
                        tab.close();
                    }
                } catch (_) {}

                openStreams.delete(key);
                if (key === MULTI_CHAT_KEY && pendingReplacement) {
                    window.clearTimeout(pendingReplacement.timeout);
                    pendingReplacement = null;
                }
            }
        }
    }

    function setScanDiagnostics(data) {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        button.dataset.mothScanStatus = data.status || '';
        button.dataset.mothScanReason = data.reason || '';
        button.dataset.mothScanLive = String(data.live ?? 0);
        // Counts selected Twitch channels, not newly opened browser tabs.
        button.dataset.mothScanTwitchChannels = data.twitchChannels == null ? '' : String(data.twitchChannels);
        button.dataset.mothScanOpened = String(data.opened ?? 0);
        button.dataset.mothScanTracked = String(data.tracked ?? 0);
        button.dataset.mothScanKickLive = String(lastKickLive.length);
        button.dataset.mothScanAt = String(Date.now());
    }

    async function runLiveScan(reason = 'manual') {
        if (scanInProgress) {
            return {
                channels: [],
                opened: 0,
                tracked: openStreams.size,
                skipped: true
            };
        }

        scanInProgress = true;
        setScanDiagnostics({ status: 'scanning', reason });

        try {
            if (!(await waitForGameUi())) {
                console.info('[Moth] live scan skipped: game UI not ready');

                setScanDiagnostics({ status: 'not-ready', reason, tracked: openStreams.size });
                return {
                    channels: [],
                    opened: 0,
                    tracked: openStreams.size,
                    notReady: true
                };
            }

            let bridgeData = readLiveChannelsFromBridge();
            let live;

            if (bridgeData) {
                // Fast path: game state already includes the current live
                // channels, including KICK. No modal/UI scraping is needed.
                live = bridgeData.live;
            } else {
                live = new Map();
                for (let attempt = 0; attempt < 10; attempt += 1) {
                    live = await collectOfficialLiveChannels();

                    if (live.size) {
                        break;
                    }

                    await sleep(500);
                }
            }

            const rows = liveStateRows();
            const twitchStateIsAvailable =
                bridgeData ? bridgeData.twitchStateAvailable : !!rows.twitch;

            lastKickStateAvailable = bridgeData
                ? bridgeData.kickStateAvailable
                : !!rows.kick;
            lastKickLive = lastKickStateAvailable
                ? bridgeData
                    ? bridgeData.kickLive
                    : [...live.values()]
                        .filter(item => item.service === 'kick')
                        .map(item => ({ name: item.name, url: item.url }))
                : [];
            if (lastKickStateAvailable) lastKickObservedAt = Date.now();

            const liveKeys = new Set();
            const twitchByKey = new Map();
            let opened = 0;

            for (const item of live.values()) {
                const key = item.service + ':' + text(item.name);
                liveKeys.add(key);

                if (item.service === 'twitch') {
                    twitchByKey.set(key, item);
                }
            }

            // Keep Twitch channels that PokéIdle reports as actively rewarding
            // even during a transient omission from its ordinary live list.
            const protectedKeys = twitchStateIsAvailable
                ? rewardedTwitchKeys()
                : new Set();

            for (const key of protectedKeys) {
                if (!key.startsWith('twitch:') || twitchByKey.has(key)) continue;

                const item = normalizeLiveLink('twitch', key.slice('twitch:'.length));
                if (item) twitchByKey.set(key, item);
            }

            const twitchChannels = [...twitchByKey.values()];
            if (twitchStateIsAvailable && !twitchChannels.length) {
                if (!twitchEmptySince) twitchEmptySince = Date.now();
            } else {
                twitchEmptySince = 0;
            }
            // One temporary empty live-list response is not evidence that
            // every rewarded room went offline. Require sustained emptiness.
            const confirmedEmpty = twitchEmptySince &&
                Date.now() - twitchEmptySince >= 90_000;
            if (twitchChannels.length || !confirmedEmpty) {
                liveKeys.add(MULTI_CHAT_KEY);
            }
            if (twitchChannels.length && openMultiChat(twitchChannels)) {
                opened = 1;
            }

            // Only close the consolidated chat after a sustained empty Twitch
            // state, and never on a failed or unavailable stream-state read.
            if (twitchStateIsAvailable) {
                if (confirmedEmpty) {
                    // Clear old consolidated popouts even if this /app page was
                    // reloaded and has no tab handles left in openStreams.
                    try {
                        const active = String(GM_getValue(CHAT_ACTIVE_KEY, '') || '');
                        if (!active.startsWith('stop-')) {
                            GM_setValue(CHAT_DESIRED_KEY, '[]');
                            GM_setValue(CHAT_TARGET_KEY, '');
                            GM_setValue(CHAT_LAUNCH_KEY, '');
                            GM_setValue(CHAT_HEARTBEAT_KEY, '');
                            GM_setValue(CHAT_ACTIVE_KEY, 'stop-' + Date.now());
                        }
                    } catch (_) {}
                }
                closeStreamsNotLive(liveKeys, protectedKeys);
            }

            setScanDiagnostics({
                status: 'ok',
                reason,
                live: live.size,
                twitchChannels: twitchChannels.length,
                opened,
                tracked: openStreams.size
            });

            console.info(
                '[Moth] live stream scan:',
                reason,
                live.size,
                'live channel(s),',
                opened,
                'shared tab requested,',
                openStreams.size,
                'tracked'
            );
            if (lastKickLive.length) {
                console.info(
                    '[Moth] KICK channels available for Rust MultiKick link:',
                    lastKickLive.map(item => item.name)
                );
            }

            return {
                channels: [...live.values()],
                twitchChannels: twitchChannels.length,
                opened,
                tracked: openStreams.size
            };
        } catch (error) {
            setScanDiagnostics({ status: 'failed', reason, tracked: openStreams.size });
            console.error('[Moth] live stream scan failed:', error);

            return {
                channels: [],
                opened: 0,
                tracked: openStreams.size,
                failed: true
            };
        } finally {
            scanInProgress = false;
        }
    }

    async function scheduledScan() {
        const startedAt = Date.now();
        await runLiveScan('scheduled');
        const elapsed = Date.now() - startedAt;
        window.setTimeout(
            scheduledScan,
            Math.max(0, LIVE_SCAN_INTERVAL_MS - elapsed)
        );
    }

    function ensureButton() {
        const inventory = document.getElementById(INVENTORY_ID);

        if (!inventory || document.getElementById(BUTTON_ID)) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.title = 'Sync live Twitch chats without reloading; KICK is managed separately.';
        button.setAttribute(
            'aria-label',
            'Refresh all Twitch live channels in one shared chat tab'
        );

        const style = window.getComputedStyle(inventory);

        button.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'box-sizing:border-box',
            'min-height:' + Math.max(30, inventory.offsetHeight) + 'px',
            'margin:' + (style.margin || '2px 0 0 0'),
            'padding:' + (style.padding || '6px 10px'),
            'font:' + (style.font || 'inherit'),
            'line-height:' + (style.lineHeight || 'normal'),
            'color:' + (style.color || 'inherit'),
            'background:' + (style.background || 'transparent'),
            'border:' + (style.border || '1px solid currentColor'),
            'border-radius:' + (style.borderRadius || '4px'),
            'cursor:pointer'
        ].join(';');

        const label = document.createElement('span');
        label.textContent = 'Refresh Twitch chats';
        button.appendChild(label);

        button.addEventListener('click', async () => {
            button.disabled = true;
            label.textContent = 'Scanning…';

            const result = await runLiveScan('manual');

            label.textContent = result.failed
                ? 'Scan failed'
                : result.notReady
                    ? 'Game not ready'
                    : result.twitchChannels > 0
                        ? result.opened
                            ? result.twitchChannels + ' Twitch channels · new tab opened'
                            : result.twitchChannels + ' Twitch channels · synced'
                        : 'No live Twitch channels found';

            window.setTimeout(() => {
                if (!button.isConnected) {
                    return;
                }

                button.disabled = false;
                label.textContent = 'Refresh Twitch chats';
            }, 1600);
        });

        inventory.insertAdjacentElement('afterend', button);
    }

    function start() {
        ensureButton();

        window.setInterval(
            ensureButton,
            UI_RECHECK_INTERVAL_MS
        );

        const scheduleInitialScan = () => {
            window.setTimeout(() => {
                void scheduledScan();
            }, INITIAL_SCAN_DELAY_MS);
        };

        if (document.readyState === 'complete') {
            scheduleInitialScan();
        } else {
            window.addEventListener('load', scheduleInitialScan, { once: true });
        }

        const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    page.__mothKickScannerV1 = {
        version: 2,
        snapshot() {
            // The native monitor polls this API independently of the 5-minute
            // Twitch tab scan. Read KICK's current game state on every poll so
            // live channels appear/disappear promptly without waiting for a
            // modal refresh or the next scheduled scan.
            const current = readLiveChannelsFromBridge();
            if (current?.kickStateAvailable) {
                lastKickLive = current.kickLive;
                lastKickStateAvailable = true;
                lastKickObservedAt = Date.now();
            } else {
                lastKickLive = [];
                lastKickStateAvailable = false;
            }

            return {
                live: lastKickLive.map(item => ({ ...item })),
                stateAvailable: lastKickStateAvailable,
                scannedAt: lastKickObservedAt
            };
        }
    };

    console.info('[Moth] live stream scanner v7.2.1 ready · persistent delta-synced Twitch IRC chat · KICK stays in Rust');
    }

    start();
})();
