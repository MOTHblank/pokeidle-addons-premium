// ==UserScript==
// @name         PokéIdle Upstream Scraper & Exporter
// @namespace    moth.pokeidle
// @version      1.2.0
// @description  Captures public PokéIdle client assets into a TAR and verified manifest, with limits and cancellation.
// @match        https://pokeidle.io/*
// @match        https://www.pokeidle.io/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const ROOT_ID = 'moth-upstream-scraper';
    const BUTTON_ID = 'moth-upstream-scraper-button';
    const STYLE_ID = 'moth-upstream-scraper-style';

    const MAX_FILES = 350;
    const MAX_DISCOVERED = 1000;
    const MAX_TEXT_BYTES = 3 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
    const FETCH_TIMEOUT_MS = 15000;

    // In-memory list of actual public asset URLs (not response bodies).
    const observedAssets = new Set();
    const state = {
        running: false,
        cancelRequested: false,
        currentRequest: null,
        complete: false,
        files: new Map(),
        errors: [],
        unresolvedDynamicPaths: new Set(),
        status: 'Not scanned yet',
        attempted: 0,
        discovered: 0,
        startedAt: 0,
        finishedAt: 0
    };

    const q = (selector, root = document) =>
        root.querySelector(selector);

    const qa = (selector, root = document) =>
        [...root.querySelectorAll(selector)];

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function isDynamicTemplate(value) {
        const raw = String(value || '');
        let decoded = raw;
        try { decoded = decodeURIComponent(raw); } catch {}
        return /\$\{|\{[A-Za-z_$][^}]*\}|%24%7b|%7b/i.test(raw) ||
            /\$\{|\{[A-Za-z_$][^}]*\}/i.test(decoded);
    }

    function normalizeUrl(value, base = location.href) {
        try {
            if (isDynamicTemplate(value)) return null;
            const url = new URL(value, base);
            if (isDynamicTemplate(url.pathname)) return null;
            if (url.origin !== location.origin ||
                !/^https?:$/.test(url.protocol) ||
                url.username || url.password) {
                return null;
            }

            // Never crawl account endpoints or URLs with arbitrary query data.
            // Only conventional static-asset cache-busters are accepted.
            if (/\/(?:api|auth|account|accounts|user|users|profile|session|login|logout|admin|private|graphql|socket)(?:\/|$)/i.test(url.pathname)) {
                return null;
            }
            if ([...url.searchParams.keys()].some(key =>
                !/^(?:v|ver|version|build|hash|t|_)$/i.test(key))) {
                return null;
            }

            url.hash = '';
            return url.href;
        } catch {
            return null;
        }
    }

    function resourcePath(urlValue, contentType = '') {
        const url = new URL(urlValue);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '/app' || pathname === '/app/') {
            return 'upstream/app.html';
        }

        pathname = pathname.replace(/^\/+/, '').replace(/\/+$/g, '');
        if (!pathname) pathname = 'index.html';
        if (!/\.[a-z0-9]{1,8}$/i.test(pathname) && /html/i.test(contentType)) {
            pathname += '.html';
        }

        const safe = pathname
            .split('/')
            .filter(part => part && part !== '.' && part !== '..')
            .map(part => part.replace(/[\\<>:"|?*\x00-\x1f\x7f]/g, '_'))
            .join('/');

        return 'upstream/' + (safe || 'index.html');
    }

    function addHashSuffix(path, suffix) {
        const extension = path.match(/\.[^/.]+$/)?.[0] || '';
        return path.slice(0, path.length - extension.length) + suffix + extension;
    }

    function isTextCandidate(urlValue) {
        try {
            const url = new URL(urlValue);
            const path = url.pathname.toLowerCase();

            if (
                path === '/' ||
                path === '/app' ||
                path === '/app/'
            ) {
                return true;
            }

            return /\.(?:js|mjs|css|html?|json|csv|txt|xml|map)$/i
                .test(path);
        } catch {
            return false;
        }
    }

    function isTextContentType(type) {
        const value = String(type || '').toLowerCase();

        return (
            value.startsWith('text/') ||
            value.includes('javascript') ||
            value.includes('json') ||
            value.includes('xml') ||
            value.includes('csv') ||
            value === ''
        );
    }

    function observeAsset(entry) {
        if (!['script', 'link', 'css', 'fetch', 'xmlhttprequest'].includes(entry?.initiatorType)) return;
        const url = normalizeUrl(entry.name);
        if (!url || !isTextCandidate(url)) return;
        if (['fetch', 'xmlhttprequest'].includes(entry.initiatorType) &&
            !/^\/(?:assets(?:-packs)?|shared|static)\//i.test(new URL(url).pathname)) return;
        if (observedAssets.size < MAX_DISCOVERED) observedAssets.add(url);
    }

    function collectInitialUrls() {
        const urls = new Set();

        const add = value => {
            const normalized =
                normalizeUrl(value);

            if (
                normalized &&
                isTextCandidate(normalized)
            ) {
                urls.add(normalized);
            }
        };

        add(location.origin + '/app');

        for (
            const el of
            qa('script[src], link[href]')
        ) {
            const value =
                el.getAttribute('src') ||
                el.getAttribute('href');

            if (!value) continue;

            const rel =
                String(
                    el.getAttribute('rel') ||
                    ''
                ).toLowerCase();

            if (
                el.tagName === 'LINK' &&
                rel &&
                !rel.includes('stylesheet') &&
                !rel.includes('modulepreload') &&
                !rel.includes('preload')
            ) {
                continue;
            }

            add(value);
        }

        // Include concrete dynamic assets fetched by the game, never API responses.
        try {
            for (const entry of performance.getEntriesByType('resource')) observeAsset(entry);
        } catch {}
        for (const url of observedAssets) add(url);
        return [...urls];
    }

    function extractImports(
        text,
        sourceUrl,
        contentType
    ) {
        const discovered =
            new Set();

        const add = (raw, moduleImport = false) => {
            if (!raw) return;
            if (isDynamicTemplate(raw)) {
                if (state.unresolvedDynamicPaths.size < 100 &&
                    /\.(?:json|js|mjs|css|map)(?:\?|$)/i.test(raw)) {
                    state.unresolvedDynamicPaths.add(String(raw).slice(0, 180));
                }
                return;
            }
            // Bare module specifiers are package names, not URL paths.
            if (moduleImport && !/^(?:\.{1,2}\/|\/|https?:\/\/)/i.test(raw)) return;

            const normalized =
                normalizeUrl(
                    raw,
                    sourceUrl
                );

            if (
                normalized &&
                isTextCandidate(normalized)
            ) {
                discovered.add(normalized);
            }
        };

        const path =
            new URL(sourceUrl)
                .pathname
                .toLowerCase();

        if (
            /(?:javascript|ecmascript)/i.test(
                contentType
            ) ||
            /\.(?:js|mjs)$/i.test(path)
        ) {
            const patterns = [
                /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g,
                /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
                /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g
            ];

            for (
                const pattern of
                patterns
            ) {
                let match;

                while (
                    (
                        match =
                            pattern.exec(text)
                    )
                ) {
                    add(match[1], true);
                }
            }
        }

        if (
            /(?:javascript|ecmascript)/i.test(contentType) ||
            /\.(?:js|mjs)$/i.test(path)
        ) {
            // Large PokéIdle bundles fetch JSON game data at runtime, not
            // through ES module imports. Discover literal static references
            // without executing code or making arbitrary API requests.
            const assetPatterns = [
                /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
                /['"`]((?:\/|\.{1,2}\/)[^'"`\s?#]+\.(?:json|mjs|js|css|html?|csv|txt|xml|map)(?:\?[^'"`\s]*)?)['"`]/g,
                /\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/g
            ];
            for (const pattern of assetPatterns) {
                let match;
                while ((match = pattern.exec(text))) {
                    const url = normalizeUrl(match[1], sourceUrl);
                    if (url &&
                        (/^\/(?:assets(?:-packs)?|shared|static)\//i.test(new URL(url).pathname) ||
                         /\.(?:js|mjs|css|map)$/i.test(new URL(url).pathname))) add(match[1]);
                }
            }
            // Template placeholders are diagnostics, not network requests.
            const dynamic = /\$\{[^}]+\}[^'"`\s]{0,100}\.(?:json|mjs|js|css|map)/g;
            for (const match of text.matchAll(dynamic)) add(match[0]);
        }

        if (
            /css/i.test(contentType) ||
            /\.css$/i.test(path)
        ) {
            let match;

            const imports =
                /@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?/g;

            while (
                (
                    match =
                        imports.exec(text)
                )
            ) {
                add(match[1]);
            }
        }

        if (
            /html/i.test(contentType) ||
            /\.html?$/i.test(path) ||
            path === '/app'
        ) {
            const parser =
                new DOMParser();

            const doc =
                parser.parseFromString(
                    text,
                    'text/html'
                );

            for (
                const el of
                doc.querySelectorAll(
                    'script[src], link[href]'
                )
            ) {
                add(
                    el.getAttribute('src') ||
                    el.getAttribute('href')
                );
            }
        }

        // Public index JSON can point at concrete category manifest URLs.
        if (/json/i.test(contentType) &&
            /^\/(?:assets(?:-packs)?|static)\/.*(?:index|manifest|version|categories|asset-packs)[^/]*\.json$/i.test(path)) {
            try {
                const stack = [JSON.parse(text)];
                let visited = 0;
                while (stack.length && visited++ < 40000) {
                    const value = stack.pop();
                    if (typeof value === 'string') {
                        if (/\.(?:json|mjs|js|css|map)(?:\?|$)/i.test(value)) add(value);
                    } else if (Array.isArray(value)) {
                        for (const row of value) stack.push(row);
                    } else if (value && typeof value === 'object') {
                        for (const row of Object.values(value)) stack.push(row);
                    }
                }
            } catch (error) {
                state.errors.push({ url: sourceUrl, error: 'Invalid asset index: ' +
                    String(error?.message || error) });
            }
        }

        return [...discovered];
    }

    async function sha256(text) {
        const bytes =
            new TextEncoder()
                .encode(text);

        const digest =
            await crypto.subtle.digest(
                'SHA-256',
                bytes
            );

        return [...new Uint8Array(digest)]
            .map(value =>
                value
                    .toString(16)
                    .padStart(2, '0')
            )
            .join('');
    }

    async function fetchText(url) {
        const controller = new AbortController();
        state.currentRequest = controller;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                // Static client assets should be downloadable without account cookies.
                credentials: 'omit',
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);

            const finalUrl = normalizeUrl(response.url || url);
            if (!finalUrl || !isTextCandidate(finalUrl)) {
                throw new Error('Redirected outside permitted client assets');
            }

            const type = response.headers.get('content-type') || '';
            if (!isTextContentType(type)) {
                throw new Error('Non-text response: ' + type);
            }

            const length = Number(response.headers.get('content-length') || 0);
            if (length > MAX_TEXT_BYTES) {
                throw new Error('Too large (' + length + ' bytes)');
            }
            if (!response.body) {
                throw new Error('Response streaming is unavailable');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let text = '';
            let bytes = 0;
            while (true) {
                if (state.cancelRequested) {
                    controller.abort();
                    throw new Error('Cancelled');
                }
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > MAX_TEXT_BYTES) {
                    controller.abort();
                    throw new Error('Too large (' + bytes + ' bytes)');
                }
                text += decoder.decode(value, { stream: true });
            }
            text += decoder.decode();

            return {
                text,
                bytes,
                contentType: type.split(';')[0].trim(),
                finalUrl
            };
        } catch (error) {
            if (timedOut) {
                throw new Error('Timed out after ' + (FETCH_TIMEOUT_MS / 1000) + ' seconds');
            }
            throw error;
        } finally {
            clearTimeout(timer);
            if (state.currentRequest === controller) state.currentRequest = null;
        }
    }

    function inferVersion() {
        const candidates = [];

        for (
            const file of
            state.files.values()
        ) {
            try {
                const url =
                    new URL(file.url);

                const version =
                    url.searchParams.get(
                        'v'
                    );

                if (version) {
                    candidates.push(
                        version
                    );
                }
            } catch {}
        }

        return (
            candidates
                .sort(
                    (a, b) =>
                        String(b)
                            .localeCompare(
                                String(a),
                                undefined,
                                {
                                    numeric: true
                                }
                            )
                )[0] ||
            null
        );
    }

    function cancelScrape() {
        if (!state.running || state.cancelRequested) return;
        state.cancelRequested = true;
        state.status = 'Cancelling…';
        state.currentRequest?.abort();
        updateUI();
    }

    async function scrape() {
        if (state.running) return;

        state.running = true;
        state.cancelRequested = false;
        state.complete = false;
        state.files.clear();
        state.errors = [];
        state.unresolvedDynamicPaths.clear();
        state.attempted = 0;
        state.startedAt = Date.now();
        state.finishedAt = 0;
        state.status = 'Discovering resources…';
        updateUI();

        const queue = collectInitialUrls();
        const queued = new Set(queue);
        let cursor = 0;
        let capped = false;

        // Do not let recursively discovered imports grow an unbounded queue.
        if (queue.length > MAX_DISCOVERED) {
            queue.length = MAX_DISCOVERED;
            capped = true;
        }
        const enqueue = url => {
            if (queued.has(url)) return;
            if (queue.length >= MAX_DISCOVERED) {
                capped = true;
                return;
            }
            queued.add(url);
            queue.push(url);
        };

        try {
            while (cursor < queue.length &&
                   state.files.size < MAX_FILES &&
                   !state.cancelRequested) {
                const url = queue[cursor++];
                state.attempted = cursor;
                state.status = 'Scanning ' + cursor + '/' + queue.length +
                    ' · ' + new URL(url).pathname;
                updateUI();

                try {
                    const result = await fetchText(url);
                    if (state.cancelRequested) break;

                    const hash = await sha256(result.text);
                    const originalPath = resourcePath(result.finalUrl, result.contentType);
                    let path = originalPath;
                    let collision = 0;

                    // Query variants can contain distinct builds. Never silently
                    // replace one version with another in the exported archive.
                    while (path === 'upstream/manifest.json' || state.files.has(path)) {
                        if (state.files.get(path)?.sha256 === hash) {
                            path = null; // Same bytes: keep one copy.
                            break;
                        }
                        collision++;
                        path = addHashSuffix(originalPath,
                            '~' + hash.slice(0, 12) +
                            (collision > 1 ? '-' + collision : ''));
                    }

                    if (path) {
                        if (totalBytes() + result.bytes > MAX_TOTAL_BYTES) {
                            capped = true;
                            state.errors.push({
                                url: '(scraper)',
                                error: 'Reached ' + prettyBytes(MAX_TOTAL_BYTES) +
                                    ' total text limit'
                            });
                            break;
                        }
                        state.files.set(path, {
                            path,
                            url: result.finalUrl,
                            contentType: result.contentType,
                            bytes: result.bytes,
                            sha256: hash,
                            text: result.text
                        });
                    }

                    for (const dependency of extractImports(
                        result.text, result.finalUrl, result.contentType)) {
                        enqueue(dependency);
                    }
                } catch (error) {
                    if (state.cancelRequested) break;
                    state.errors.push({
                        url,
                        error: String((error && error.message) || error)
                    });
                }

                // Yield to the game instead of monopolizing its UI thread.
                if (cursor % 8 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        } catch (error) {
            state.errors.push({
                url: '(scraper)',
                error: 'Unexpected scrape error: ' +
                    String((error && error.message) || error)
            });
        } finally {
            state.discovered = queue.length;
            if (state.files.size >= MAX_FILES && cursor < queue.length) {
                capped = true;
                state.errors.push({
                    url: '(scraper)',
                    error: 'Reached MAX_FILES=' + MAX_FILES
                });
            }
            if (capped) {
                state.errors.push({
                    url: '(scraper)',
                    error: 'Capture stopped or limited; see skipped resources'
                });
            }
            state.complete = !state.cancelRequested && !capped &&
                !state.errors.length && !state.unresolvedDynamicPaths.size &&
                cursor >= queue.length;
            state.running = false;
            state.finishedAt = Date.now();
            state.status = (state.cancelRequested ? 'Cancelled' :
                state.complete ? 'Complete' : 'Partial capture') +
                ' · ' + state.files.size + ' files · ' +
                state.errors.length + ' failed' +
                (state.unresolvedDynamicPaths.size
                    ? ' · ' + state.unresolvedDynamicPaths.size + ' unresolved dynamic paths' : '');
            updateUI();
        }
    }

    function totalBytes() {
        return [...state.files.values()]
            .reduce(
                (sum, file) =>
                    sum +
                    Number(
                        file.bytes ||
                        0
                    ),
                0
            );
    }

    function manifestObject() {
        return {
            generatedAt:
                new Date(
                    state.finishedAt ||
                    Date.now()
                ).toISOString(),
            source:
                location.origin,
            page:
                location.pathname,
            version:
                inferVersion(),
            fileCount:
                state.files.size,
            totalBytes:
                totalBytes(),
            complete: state.complete,
            cancelled: state.cancelRequested,
            observedStaticAssetCount: observedAssets.size,
            unresolvedDynamicPaths: [...state.unresolvedDynamicPaths].sort(),
            coverage: 'public client assets discoverable in this session; dynamic assets not yet observed may remain',
            attemptedCount: state.attempted,
            discoveredCount: state.discovered,
            limits: {
                maxFiles: MAX_FILES,
                maxDiscovered: MAX_DISCOVERED,
                maxFileBytes: MAX_TEXT_BYTES,
                maxTotalBytes: MAX_TOTAL_BYTES,
                timeoutMs: FETCH_TIMEOUT_MS
            },
            files:
                [...state.files.values()]
                    .map(file => ({
                        path:
                            file.path,
                        url:
                            file.url,
                        contentType:
                            file.contentType,
                        bytes:
                            file.bytes,
                        sha256:
                            file.sha256
                    }))
                    .sort(
                        (a, b) =>
                            a.path.localeCompare(
                                b.path
                            )
                    ),
            skipped:
                state.errors
        };
    }

    function downloadBlob(
        blob,
        filename
    ) {
        const url =
            URL.createObjectURL(
                blob
            );

        const anchor =
            document.createElement(
                'a'
            );

        anchor.href =
            url;

        anchor.download =
            filename;

        document.body.appendChild(
            anchor
        );

        anchor.click();
        anchor.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(
                    url
                ),
            1500
        );
    }

    function exportManifest() {
        if (!state.files.size) {
            return;
        }

        const text =
            JSON.stringify(
                manifestObject(),
                null,
                2
            ) + '\n';

        downloadBlob(
            new Blob(
                [text],
                {
                    type:
                        'application/json'
                }
            ),
            'pokeidle-upstream-manifest.json'
        );
    }

    function tarString(
        header,
        offset,
        length,
        value
    ) {
        for (
            let i = 0;
            i < length;
            i++
        ) {
            header[
                offset + i
            ] = 0;
        }

        const bytes =
            new TextEncoder()
                .encode(
                    String(value)
                );

        header.set(
            bytes.slice(
                0,
                length
            ),
            offset
        );
    }

    function tarOctal(
        header,
        offset,
        length,
        value
    ) {
        const text =
            Math.max(
                0,
                Number(value) ||
                0
            )
                .toString(8)
                .padStart(
                    length - 1,
                    '0'
                )
                .slice(
                    -(length - 1)
                ) +
            '\0';

        tarString(
            header,
            offset,
            length,
            text
        );
    }

    const tarEncoder = new TextEncoder();

    function ustarPath(name) {
        const encoded = tarEncoder.encode(name);
        if (encoded.length <= 100) return { filename: name, prefix: '' };

        // USTAR limits are BYTES (not JavaScript UTF-16 string lengths).
        for (let cut = name.lastIndexOf('/'); cut > 0;
             cut = name.lastIndexOf('/', cut - 1)) {
            const prefix = name.slice(0, cut);
            const filename = name.slice(cut + 1);
            if (tarEncoder.encode(prefix).length <= 155 &&
                tarEncoder.encode(filename).length <= 100) {
                return { filename, prefix };
            }
        }
        return null;
    }

    function paxPathRecord(path) {
        const line = 'path=' + path + '\n';
        const byteLength = tarEncoder.encode(line).length;
        let digits = 1;
        while (true) {
            const length = byteLength + digits + 1;
            if (String(length).length === digits) {
                return tarEncoder.encode(length + ' ' + line);
            }
            digits = String(length).length;
        }
    }

    function tarHeader(name, size, mtime, type = '0') {
        const path = ustarPath(name);
        if (!path) throw new Error('Cannot fit TAR header: ' + name);
        const header = new Uint8Array(512);

        tarString(header, 0, 100, path.filename);
        tarOctal(header, 100, 8, 420);
        tarOctal(header, 108, 8, 0);
        tarOctal(header, 116, 8, 0);
        tarOctal(header, 124, 12, size);
        tarOctal(header, 136, 12, Math.floor(mtime / 1000));
        for (let i = 148; i < 156; i++) header[i] = 32;
        header[156] = type.charCodeAt(0);
        tarString(header, 257, 6, 'ustar');
        tarString(header, 263, 2, '00');
        tarString(header, 345, 155, path.prefix);

        let checksum = 0;
        for (const byte of header) checksum += byte;
        const checksumText = checksum.toString(8)
            .padStart(6, '0').slice(-6) + '\0 ';
        tarString(header, 148, 8, checksumText);
        return header;
    }

    function tarParts() {
        const encoder = new TextEncoder();
        const manifest = JSON.stringify(manifestObject(), null, 2) + '\n';
        const entries = [
            ...[...state.files.values()].map(file => ({
                path: file.path,
                bytes: encoder.encode(file.text)
            })),
            {
                path: 'upstream/manifest.json',
                bytes: encoder.encode(manifest)
            }
        ].sort((a, b) => a.path.localeCompare(b.path));

        const parts = [];
        const mtime = state.finishedAt || Date.now();
        const append = (name, bytes, type = '0') => {
            parts.push(tarHeader(name, bytes.byteLength, mtime, type));
            parts.push(bytes);
            const remainder = bytes.byteLength % 512;
            if (remainder) parts.push(new Uint8Array(512 - remainder));
        };

        entries.forEach((entry, index) => {
            if (!ustarPath(entry.path)) {
                // POSIX PAX preserves filenames USTAR cannot represent.
                append('PaxHeaders/' + index, paxPathRecord(entry.path), 'x');
                append('upstream/long-file-' + index, entry.bytes);
            } else {
                append(entry.path, entry.bytes);
            }
        });

        parts.push(new Uint8Array(1024));
        return parts;
    }

    function exportTar() {
        if (!state.files.size) {
            return;
        }

        const version =
            inferVersion();

        const filename =
            'pokeidle-upstream' +
            (
                version
                    ? '-v' +
                      version
                    : ''
            ) +
            '.tar';

        downloadBlob(
            new Blob(
                tarParts(),
                {
                    type:
                        'application/x-tar'
                }
            ),
            filename
        );
    }

    function injectStyle() {
        if (
            q(
                '#' +
                STYLE_ID
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id =
            STYLE_ID;

        style.textContent = `
            #${BUTTON_ID} {
                display:inline-flex!important;
                align-items:center!important;
                justify-content:center!important;
                min-width:0!important;
                width:auto!important;
                height:30px!important;
                padding:5px 8px!important;
                border:1px solid rgba(255,255,255,.17)!important;
                border-radius:6px!important;
                background:rgba(42,34,38,.86)!important;
                color:#eee!important;
                font:700 10px/1 system-ui,sans-serif!important;
                cursor:pointer!important;
            }

            #${ROOT_ID} {
                position:fixed!important;
                right:12px!important;
                bottom:12px!important;
                z-index:2147483646!important;
                width:min(380px,calc(100vw - 24px))!important;
                padding:10px!important;
                border:1px solid rgba(255,255,255,.18)!important;
                border-radius:9px!important;
                background:#171316!important;
                color:#eee7ea!important;
                box-shadow:0 10px 35px rgba(0,0,0,.5)!important;
                font:11px/1.35 system-ui,sans-serif!important;
            }

            #${ROOT_ID}[hidden] {
                display:none!important;
            }

            #${ROOT_ID} * {
                box-sizing:border-box!important;
            }

            .mus-head {
                display:flex;
                align-items:center;
                gap:7px;
                margin-bottom:7px;
            }

            .mus-head strong {
                flex:1;
                font-size:12px;
            }

            .mus-head button,
            .mus-actions button {
                border:1px solid rgba(255,255,255,.14);
                border-radius:5px;
                background:rgba(255,255,255,.06);
                color:#eee;
                padding:5px 7px;
                font:inherit;
                cursor:pointer;
            }

            .mus-head button:disabled,
            .mus-actions button:disabled {
                opacity:.45;
                cursor:default;
            }

            .mus-status {
                min-height:31px;
                padding:6px 7px;
                border-radius:6px;
                background:rgba(255,255,255,.045);
                color:#cfc4c9;
                overflow-wrap:anywhere;
            }

            .mus-meta {
                display:grid;
                grid-template-columns:repeat(3,minmax(0,1fr));
                gap:5px;
                margin-top:7px;
            }

            .mus-meta div {
                padding:5px;
                border-radius:5px;
                background:rgba(255,255,255,.045);
                text-align:center;
            }

            .mus-meta b {
                display:block;
                font-size:13px;
            }

            .mus-meta span {
                color:#93898e;
                font-size:9px;
            }

            .mus-actions {
                display:flex;
                gap:6px;
                margin-top:7px;
            }

            .mus-actions button {
                flex:1;
            }

            .mus-hint {
                margin-top:7px;
                color:#93898e;
                font-size:9px;
            }

            .mus-errors {
                max-height:120px;
                overflow:auto;
                margin-top:7px;
                color:#a99fa3;
                font-size:9px;
            }
        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(
            style
        );
    }

    function ensureButton() {
        if (
            q(
                '#' +
                BUTTON_ID
            )
        ) {
            return;
        }

        const host =
            q('.menu-topo') ||
            document.body;

        if (!host) {
            return;
        }

        const button =
            document.createElement(
                'button'
            );

        button.type =
            'button';

        button.id =
            BUTTON_ID;

        button.textContent =
            'Scrape';

        button.title =
            'PokéIdle upstream scraper/exporter';

        button.addEventListener(
            'click',
            () => {
                const panel =
                    ensurePanel();

                panel.hidden =
                    !panel.hidden;

                updateUI();
            }
        );

        host.appendChild(
            button
        );
    }

    function ensurePanel() {
        injectStyle();

        let root =
            q(
                '#' +
                ROOT_ID
            );

        if (root) {
            return root;
        }

        root =
            document.createElement(
                'section'
            );

        root.id =
            ROOT_ID;

        root.hidden =
            true;

        root.innerHTML = `
            <div class="mus-head">
                <strong>Upstream Scraper</strong>
                <button type="button" data-mus-close>×</button>
            </div>

            <div class="mus-status" data-mus-status></div>

            <div class="mus-meta">
                <div><b data-mus-files>0</b><span>files</span></div>
                <div><b data-mus-size>0 KB</b><span>text</span></div>
                <div><b data-mus-errors>0</b><span>skipped</span></div>
            </div>

            <div class="mus-actions">
                <button type="button" data-mus-scan>Scan</button>
                <button type="button" data-mus-cancel disabled>Cancel</button>
                <button type="button" data-mus-tar disabled>Export TAR</button>
                <button type="button" data-mus-manifest disabled>Manifest</button>
            </div>
            <div class="mus-hint">Only public client assets are captured. Dynamic paths not observed are reported, never guessed. Partial exports are flagged in the manifest.</div>

            <div class="mus-errors" data-mus-error-list></div>
        `;

        document.body.appendChild(
            root
        );

        q(
            '[data-mus-close]',
            root
        ).addEventListener(
            'click',
            () => {
                root.hidden =
                    true;
            }
        );

        q(
            '[data-mus-scan]',
            root
        ).addEventListener(
            'click',
            scrape
        );

        q(
            '[data-mus-cancel]',
            root
        ).addEventListener(
            'click',
            cancelScrape
        );

        q(
            '[data-mus-tar]',
            root
        ).addEventListener(
            'click',
            exportTar
        );

        q(
            '[data-mus-manifest]',
            root
        ).addEventListener(
            'click',
            exportManifest
        );

        return root;
    }

    function prettyBytes(
        bytes
    ) {
        if (
            bytes >=
            1024 *
                1024
        ) {
            return (
                bytes /
                1024 /
                1024
            ).toFixed(1) +
                ' MB';
        }

        return Math.round(
            bytes /
            1024
        ) + ' KB';
    }

    function updateUI() {
        const root =
            ensurePanel();

        const status =
            q(
                '[data-mus-status]',
                root
            );

        if (status) {
            status.textContent =
                state.status;
        }

        q(
            '[data-mus-files]',
            root
        ).textContent =
            String(
                state.files.size
            );

        q(
            '[data-mus-size]',
            root
        ).textContent =
            prettyBytes(
                totalBytes()
            );

        q(
            '[data-mus-errors]',
            root
        ).textContent =
            String(
                state.errors.length + state.unresolvedDynamicPaths.size
            );

        const scan =
            q(
                '[data-mus-scan]',
                root
            );

        scan.disabled =
            state.running;

        const cancel = q('[data-mus-cancel]', root);
        cancel.disabled = !state.running || state.cancelRequested;

        scan.textContent =
            state.running
                ? 'Scanning…'
                : state.files.size
                    ? 'Rescan'
                    : 'Scan';

        for (
            const selector of [
                '[data-mus-tar]',
                '[data-mus-manifest]'
            ]
        ) {
            q(
                selector,
                root
            ).disabled =
                state.running ||
                !state.files.size;
        }

        const errors =
            q(
                '[data-mus-error-list]',
                root
            );

        errors.innerHTML =
            state.errors
                .slice(0, 12)
                .map(
                    item =>
                        `<div>${escapeHtml(new URL(item.url, location.href).pathname)} — ${escapeHtml(item.error)}</div>`
                )
                .join('') +
            [...state.unresolvedDynamicPaths].slice(0, 8)
                .map(path => `<div>Unresolved dynamic path (not fetched): ${escapeHtml(path)}</div>`)
                .join('');
    }

    function bootstrap() {
        injectStyle();
        ensureButton();
        ensurePanel();

        // Collect late-loading assets such as map manifests when the player travels.
        try {
            if (typeof PerformanceObserver === 'function') {
                const observer = new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) observeAsset(entry);
                });
                observer.observe({ type: 'resource', buffered: true });
            }
        } catch {}

        setInterval(
            ensureButton,
            3000
        );

        console.info(
            '[PokéIdle Upstream Scraper] v1.2.0 loaded'
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
