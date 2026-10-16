// ==UserScript==
// @name         PokéIdle Upstream Scraper & Exporter
// @namespace    moth.pokeidle
// @version      1.3.0
// @description  Investigates and downloads PokéIdle client files, item icons and observed sprites with verified manifests.
// @match        https://pokeidle.io/*
// @match        https://www.pokeidle.io/*
// @grant        GM_xmlhttpRequest
// @connect      pokexguides.com
// @connect      www.pokexguides.com
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/upstream-scraper/scraper-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/upstream-scraper/scraper-exporter.user.js
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
    const MAX_IMAGE_FILES = 1200;
    const MAX_IMAGE_DISCOVERED = 3000;
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    const MAX_IMAGE_TOTAL_BYTES = 96 * 1024 * 1024;
    const IMAGE_EXTENSIONS = /\.(?:png|gif|webp|jpe?g|avif)(?:$|[?#])/i;

    // In-memory list of actual public asset URLs (not response bodies).
    const observedAssets = new Set();
    const observedImages = new Set();
    const state = {
        running: false,
        cancelRequested: false,
        currentRequest: null,
        complete: false,
        files: new Map(),
        errors: [],
        imageFiles: new Map(),
        imageCandidates: new Map(),
        imageFailures: [],
        externalImages: new Set(),
        imageStatus: 'Images not scanned yet',
        imageComplete: false,
        imageAttempted: 0,
        imageDiscovered: 0,
        imageCapped: false,
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
        if (['img', 'image', 'css', 'link', 'script', 'other'].includes(entry?.initiatorType) &&
            IMAGE_EXTENSIONS.test(entry.name || '')) {
            const image = normalizeImageUrl(entry.name);
            if (image && observedImages.size < MAX_IMAGE_DISCOVERED) observedImages.add(image);
        }
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


    // Artwork is gathered from observed requests and explicitly identified
    // public catalog records. Never equate a sprite looktype with a species ID.
    const PUBLIC_ART_HOSTS = new Set(['pokexguides.com', 'www.pokexguides.com']);

    function normalizeImageUrl(input, base = location.href) {
        try {
            if (!input || isDynamicTemplate(input)) return null;
            const url = new URL(String(input).trim(), base);
            if (url.protocol !== 'https:' || url.username || url.password ||
                url.href.length > 850 || !IMAGE_EXTENSIONS.test(url.pathname) ||
                [...url.searchParams.keys()].some(key =>
                    !/^(?:v|ver|version|build|hash|t|_|cache)$/i.test(key)) ||
                /\/(?:api|auth|account|user|profile|session|private)(?:\/|$)/i.test(url.pathname)) {
                return null;
            }
            if (url.origin !== location.origin && !PUBLIC_ART_HOSTS.has(url.hostname)) {
                if (state.externalImages.size < 100) {
                    state.externalImages.add(url.hostname); // no personal URL paths
                }
                return null;
            }
            url.hash = '';
            return url.href;
        } catch { return null; }
    }

    function addImageCandidate(value, source, mapping = null, base = location.href) {
        const url = normalizeImageUrl(value, base);
        if (!url) return;
        let candidate = state.imageCandidates.get(url);
        if (!candidate) {
            if (state.imageCandidates.size >= MAX_IMAGE_DISCOVERED) {
                state.imageCapped = true;
                return;
            }
            candidate = { url, sources: new Set(), mappings: new Map() };
            state.imageCandidates.set(url, candidate);
        }
        if (candidate.sources.size < 12) candidate.sources.add(source);
        if (mapping && Number.isSafeInteger(mapping.id) && mapping.id > 0 &&
            mapping.id <= 10000000 && ['item', 'ball', 'pokemon'].includes(mapping.kind)) {
            candidate.mappings.set(mapping.kind + ':' + mapping.id, {
                kind: mapping.kind, id: mapping.id,
                name: String(mapping.name || '').slice(0, 100),
                evidence: source
            });
        }
    }

    function harvestCatalog(value, sourceUrl) {
        if (!value || typeof value !== 'object') return;
        for (const [key, kind] of [
            ['items', 'item'], ['balls', 'ball'], ['pokemon', 'pokemon'],
            ['pokemons', 'pokemon'], ['species', 'pokemon']
        ]) {
            if (!Array.isArray(value[key])) continue;
            for (const entry of value[key].slice(0, 15000)) {
                if (!entry || typeof entry !== 'object') continue;
                // A Pokémon owned by a player has an individual instance ID.
                // Only explicit species IDs, or IDs inside a species catalog,
                // may become native sprite mappings.
                const speciesId = entry.speciesId ?? entry.species_id ??
                    (key === 'species' ? entry.id : undefined);
                const id = Number(kind === 'pokemon' ? speciesId : entry.id);
                const name = entry.name ?? entry.nome ?? '';
                for (const field of [
                    'icon', 'sprite', 'image', 'img', 'iconUrl', 'spriteUrl', 'imageUrl'
                ]) {
                    if (typeof entry[field] === 'string') {
                        addImageCandidate(entry[field], sourceUrl + ' · ' + key + '.' + field,
                            { kind, id, name }, sourceUrl);
                    }
                }
            }
        }
    }

    function harvestImageLiterals(text, sourceUrl, source) {
        const css = /url\(\s*['"]?([^'")\s]{1,500})['"]?\s*\)/gi;
        const literals = /['"\x60]((?:https:\/\/|\/|\.\/|\.\.\/)[^'"\x60\s<>]{1,480}\.(?:png|gif|webp|jpe?g|avif)(?:\?[^'"\x60\s<>]*)?)['"\x60]/gi;
        let hit;
        while ((hit = css.exec(text))) addImageCandidate(hit[1], source, null, sourceUrl);
        while ((hit = literals.exec(text))) addImageCandidate(hit[1], source, null, sourceUrl);
        // Report unresolved runtime templates, but never manufacture URLs or
        // infer a species ID from an unrendered path.
        const dynamic = /\$\{[^}]{1,100}\}[^'"\x60\s]{0,120}\.(?:png|gif|webp|jpe?g|avif)/gi;
        while ((hit = dynamic.exec(text))) {
            if (state.unresolvedDynamicPaths.size < 100) {
                state.unresolvedDynamicPaths.add('image: ' + hit[0].slice(0, 180));
            }
        }
    }

    function discoverImageReferences() {
        for (const url of observedImages) addImageCandidate(url, 'game resource timing');
        try {
            for (const entry of performance.getEntriesByType('resource')) {
                if (IMAGE_EXTENSIONS.test(entry.name || '')) {
                    addImageCandidate(entry.name, 'game resource timing');
                }
            }
        } catch {}
        for (const img of qa('img, source[srcset], video[poster], link[rel="icon"]')) {
            for (const field of ['src', 'data-src', 'poster']) {
                const raw = img.getAttribute(field);
                if (raw) addImageCandidate(raw, 'page element · ' + field);
            }
            const srcset = img.getAttribute('srcset');
            if (srcset) for (const part of srcset.split(',')) {
                addImageCandidate(part.trim().split(/\s+/)[0], 'page srcset');
            }
            if (img.currentSrc) addImageCandidate(img.currentSrc, 'loaded image');
        }
        for (const node of qa('[style]').slice(0, 4000)) {
            harvestImageLiterals(node.getAttribute('style') || '', location.href, 'inline CSS');
        }
        try {
            let seen = 0;
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules || []) {
                        if (++seen > 10000) break;
                        harvestImageLiterals(rule.cssText || '', sheet.href || location.href,
                            'public stylesheet');
                    }
                } catch {} // Cross-origin CSS may be unreadable.
                if (seen > 10000) break;
            }
        } catch {}
        for (const file of state.files.values()) {
            if (file.text.length > 2 * 1024 * 1024) continue;
            harvestImageLiterals(file.text, file.url, 'client source · ' + file.path);
            if (/\.json(?:$|\?)/i.test(file.url)) {
                try { harvestCatalog(JSON.parse(file.text), file.url); } catch {}
            }
        }
    }

    function detectImageFormat(bytes) {
        if (bytes.length < 12) return null;
        const eq = (offset, seq) => seq.every((b, i) => bytes[offset + i] === b);
        if (eq(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'png';
        if (eq(0, [71, 73, 70, 56]) &&
            (eq(4, [55, 97]) || eq(4, [57, 97]))) return 'gif';
        if (eq(0, [255, 216, 255])) return 'jpg';
        if (eq(0, [82, 73, 70, 70]) && eq(8, [87, 69, 66, 80])) return 'webp';
        if (eq(4, [102, 116, 121, 112]) &&
            (eq(8, [97, 118, 105, 102]) || eq(8, [97, 118, 105, 115]))) return 'avif';
        return null;
    }

    async function sha256Bytes(bytes) {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function imageTotalBytes() {
        let total = 0;
        for (const image of state.imageFiles.values()) total += image.bytes.length;
        return total;
    }

    async function fetchPublicImage(url) {
        if (new URL(url).origin !== location.origin) {
            if (!PUBLIC_ART_HOSTS.has(new URL(url).hostname) ||
                typeof GM_xmlhttpRequest !== 'function') {
                throw new Error('Public artwork host not authorized');
            }
            return new Promise((resolve, reject) => {
                const req = GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'arraybuffer',
                    timeout: FETCH_TIMEOUT_MS, anonymous: true,
                    headers: { Accept: 'image/png,image/gif,image/webp,image/avif,image/jpeg' },
                    onload: res => {
                        if (state.cancelRequested) {
                            reject(new Error('Cancelled')); return;
                        }
                        const final = normalizeImageUrl(res.finalUrl || url);
                        // Canonical www/non-www redirects are accepted only
                        // within the two approved public art hosts, and only
                        // when the exact image path is unchanged.
                        const safeRedirect = final &&
                            PUBLIC_ART_HOSTS.has(new URL(final).hostname) &&
                            new URL(final).pathname === new URL(url).pathname;
                        if (res.status !== 200 || !safeRedirect ||
                            !(res.response instanceof ArrayBuffer)) {
                            reject(new Error('Invalid image response or redirect: HTTP ' + res.status));
                            return;
                        }
                        const bytes = new Uint8Array(res.response);
                        if (bytes.byteLength > MAX_IMAGE_BYTES) {
                            reject(new Error('Image exceeds byte limit'));
                        } else resolve(bytes);
                    },
                    onerror: () => reject(new Error('Image request failed')),
                    ontimeout: () => reject(new Error('Image request timed out')),
                    onabort: () => reject(new Error('Cancelled'))
                });
                state.currentRequest = req;
            }).finally(() => { state.currentRequest = null; });
        }
        const controller = new AbortController();
        state.currentRequest = controller;
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                credentials: 'omit', cache: 'no-store', signal: controller.signal
            });
            if (!response.ok || normalizeImageUrl(response.url || url) !== url) {
                throw new Error('Invalid image response or redirect: HTTP ' + response.status);
            }
            if (Number(response.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) {
                throw new Error('Image exceeds byte limit');
            }
            if (!response.body) throw new Error('Image stream unavailable');
            const reader = response.body.getReader();
            const parts = [];
            let size = 0;
            for (;;) {
                if (state.cancelRequested) throw new Error('Cancelled');
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_IMAGE_BYTES) {
                    controller.abort();
                    throw new Error('Image exceeds byte limit');
                }
                parts.push(value);
            }
            const bytes = new Uint8Array(size);
            let position = 0;
            for (const part of parts) {
                bytes.set(part, position); position += part.byteLength;
            }
            return bytes;
        } finally {
            clearTimeout(timer);
            if (state.currentRequest === controller) state.currentRequest = null;
        }
    }

    function imageFilePath(url, format) {
        const hostname = new URL(url).hostname;
        const name = resourcePath(url).replace(/^upstream\//, '')
            .replace(/[^a-z0-9_\-./]/gi, '_')
            .replace(/\.(?:png|gif|webp|jpe?g|avif)$/i, '');
        return 'upstream/images/' + hostname + '/' + name + '.' + format;
    }

    async function scanImages() {
        if (state.running) return;
        state.running = true;
        state.cancelRequested = false;
        state.imageComplete = false;
        state.imageCapped = false;
        state.imageFailures = [];
        state.imageAttempted = 0;
        state.imageCandidates.clear();
        state.externalImages.clear();
        state.status = 'Collecting image URLs and item IDs…';
        updateUI();
        try {
            discoverImageReferences();
            // One documented, public game catalog. All requests omit cookies.
            try {
                const catalog = await fetchText(normalizeUrl('/assets/items.json'));
                if (state.cancelRequested) return;
                harvestCatalog(JSON.parse(catalog.text), catalog.finalUrl);
            } catch (error) {
                state.imageFailures.push({
                    url: '/assets/items.json',
                    error: 'Public item catalog: ' + String(error?.message || error)
                });
            }
            const queue = [...state.imageCandidates.values()]
                .sort((a, b) => b.mappings.size - a.mappings.size ||
                    a.url.localeCompare(b.url));
            state.imageDiscovered = queue.length;
            const downloaded = new Map([...state.imageFiles.values()]
                .map(asset => [asset.url, asset]));
            for (let index = 0; index < queue.length; index++) {
                if (state.cancelRequested) break;
                if (state.imageFiles.size >= MAX_IMAGE_FILES ||
                    imageTotalBytes() >= MAX_IMAGE_TOTAL_BYTES) {
                    state.imageCapped = true; break;
                }
                const candidate = queue[index];
                state.imageAttempted++;
                state.status = 'Image ' + (index + 1) + '/' + queue.length +
                    ' · ' + new URL(candidate.url).pathname;
                updateUI();
                const existing = downloaded.get(candidate.url);
                if (existing) {
                    existing.sources = [...new Set([...existing.sources, ...candidate.sources])].slice(0, 20);
                    existing.mappings = [...new Map([
                        ...existing.mappings.map(m => [m.kind + ':' + m.id, m]),
                        ...candidate.mappings
                    ]).values()];
                    continue;
                }
                try {
                    const bytes = await fetchPublicImage(candidate.url);
                    const format = detectImageFormat(bytes);
                    if (!format) throw new Error('Not a supported image file');
                    if (imageTotalBytes() + bytes.byteLength > MAX_IMAGE_TOTAL_BYTES) {
                        state.imageCapped = true; break;
                    }
                    const hash = await sha256Bytes(bytes);
                    let path = imageFilePath(candidate.url, format);
                    const original = path;
                    let collision = 0;
                    while (state.files.has(path) || state.imageFiles.has(path) ||
                        path === 'upstream/manifest.json') {
                        if (state.imageFiles.get(path)?.sha256 === hash) {
                            path = null; break;
                        }
                        collision++;
                        path = addHashSuffix(original, '~' + hash.slice(0, 12) +
                            (collision > 1 ? '-' + collision : ''));
                    }
                    if (path) {
                        const image = {
                            path, url: candidate.url, format, bytes, sha256: hash,
                            sources: [...candidate.sources],
                            mappings: [...candidate.mappings.values()]
                        };
                        state.imageFiles.set(path, image);
                        downloaded.set(candidate.url, image);
                    }
                } catch (error) {
                    if (state.cancelRequested) break;
                    if (state.imageFailures.length < 150) {
                        state.imageFailures.push({
                            url: candidate.url, error: String(error?.message || error)
                        });
                    }
                }
                if (index % 6 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        } catch (error) {
            if (!state.cancelRequested) {
                state.imageFailures.push({
                    url: '(image scan)', error: String(error?.message || error)
                });
            }
        } finally {
            state.running = false;
            state.imageComplete = !state.cancelRequested && !state.imageCapped &&
                !state.imageFailures.length;
            state.status = (state.cancelRequested ? 'Image scan cancelled' :
                state.imageComplete ? 'Image scan complete' : 'Partial image scan') +
                ' · ' + state.imageFiles.size + ' saved · ' +
                state.imageFailures.length + ' failures';
            state.finishedAt = Date.now();
            updateUI();
        }
    }

    function imageIndex() {
        const sprites = [], items = [], balls = [];
        for (const image of state.imageFiles.values()) {
            for (const mapping of image.mappings) {
                const entry = {
                    id: mapping.id, icon: image.url,
                    name: mapping.name, evidence: mapping.evidence
                };
                if (mapping.kind === 'pokemon' && image.format === 'png') {
                    sprites.push(entry);
                } else if (mapping.kind === 'item') {
                    items.push(entry);
                } else if (mapping.kind === 'ball') {
                    balls.push(entry);
                }
            }
        }
        const sorted = list => list.sort((a, b) => a.id - b.id);
        return {
            schema: 1, generatedAt: new Date().toISOString(),
            note: 'Only IDs explicitly present in public catalogs are mapped. Native Pokémon sprite import requires PNG.',
            sprites: sorted(sprites), items: sorted(items), balls: sorted(balls)
        };
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
            imageFileCount: state.imageFiles.size,
            imageBytes: imageTotalBytes(),
            imageCandidateCount: state.imageCandidates.size,
            imageAttemptedCount: state.imageAttempted,
            imageScanComplete: state.imageComplete,
            imageScanCapped: state.imageCapped,
            unmappedImageCount: [...state.imageFiles.values()]
                .filter(image => !image.mappings.length).length,
            unsupportedImageHosts: [...state.externalImages].sort(),
            complete: (!state.startedAt || state.complete) &&
                (!state.imageDiscovered || state.imageComplete),
            textScanComplete: state.complete,
            cancelled: state.cancelRequested,
            observedStaticAssetCount: observedAssets.size,
            unresolvedDynamicPaths: [...state.unresolvedDynamicPaths].sort(),
            coverage: 'public client files and images observed or explicitly listed in public catalogs; unloaded/dynamic assets may remain unlisted',
            attemptedCount: state.attempted,
            discoveredCount: state.discovered,
            limits: {
                maxFiles: MAX_FILES,
                maxDiscovered: MAX_DISCOVERED,
                maxFileBytes: MAX_TEXT_BYTES,
                maxTotalBytes: MAX_TOTAL_BYTES,
                maxImageFiles: MAX_IMAGE_FILES,
                maxImageDiscovered: MAX_IMAGE_DISCOVERED,
                maxImageBytes: MAX_IMAGE_BYTES,
                maxImageTotalBytes: MAX_IMAGE_TOTAL_BYTES,
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
            images: [...state.imageFiles.values()].map(image => ({
                path: image.path, url: image.url, format: image.format,
                bytes: image.bytes.length, sha256: image.sha256,
                sources: image.sources, mappings: image.mappings
            })).sort((a, b) => a.path.localeCompare(b.path)),
            imageIndex: imageIndex(),
            skipped: state.errors,
            skippedImages: state.imageFailures
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
            60000
        );
    }

    function exportManifest() {
        if (!state.files.size && !state.imageFiles.size) {
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
            ...[...state.imageFiles.values()].map(image => ({
                path: image.path,
                bytes: image.bytes
            })),
            {
                path: 'upstream/image-index.json',
                bytes: encoder.encode(JSON.stringify(imageIndex(), null, 2) + '\n')
            },
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
        if (!state.files.size && !state.imageFiles.size) {
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
                width:min(460px,calc(100vw - 24px))!important;
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
                grid-template-columns:repeat(5,minmax(0,1fr));
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
                min-width:0;
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
                <div><b data-mus-files>0</b><span>text files</span></div>
                <div><b data-mus-size>0 KB</b><span>text</span></div>
                <div><b data-mus-images>0</b><span>images</span></div>
                <div><b data-mus-image-size>0 KB</b><span>artwork</span></div>
                <div><b data-mus-errors>0</b><span>skipped</span></div>
            </div>

            <div class="mus-actions">
                <button type="button" data-mus-scan>Scan source</button>
                <button type="button" data-mus-images-scan>Download images</button>
                <button type="button" data-mus-cancel disabled>Cancel</button>
                <button type="button" data-mus-tar disabled>Export TAR</button>
                <button type="button" data-mus-manifest disabled>Manifest</button>
            </div>
            <div class="mus-hint">Run Scan source first for image references inside game files. Download images also inspects live game images and the public item catalog. Export TAR includes binary artwork, checksums and verified ID mappings. Missing sprites are reported, never guessed.</div>

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
            '[data-mus-images-scan]',
            root
        ).addEventListener(
            'click',
            scanImages
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

        q('[data-mus-images]', root).textContent = String(state.imageFiles.size);
        q('[data-mus-image-size]', root).textContent = prettyBytes(imageTotalBytes());
        q(
            '[data-mus-errors]',
            root
        ).textContent =
            String(
                state.errors.length + state.unresolvedDynamicPaths.size +
                state.imageFailures.length
            );

        const scan =
            q(
                '[data-mus-scan]',
                root
            );

        scan.disabled =
            state.running;
        q('[data-mus-images-scan]', root).disabled = state.running;

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
                (!state.files.size && !state.imageFiles.size);
        }

        const errors =
            q(
                '[data-mus-error-list]',
                root
            );

        errors.innerHTML =
            [...state.errors, ...state.imageFailures]
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
            '[PokéIdle Upstream Scraper] v1.3.0 loaded'
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
