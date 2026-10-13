    // Source module: src/mothwatch/diagnostics-section.js
    // Disabled by default. No raw market data, IDs, seller names or credentials.
    const DIAG_FAMILIES = new Set(['welcome', 'estado', 'market:vitrine',
        'market:itens', 'market:item', 'market:historicoGlobal',
        'market:other', 'batalha', 'erro', 'other']);
    const DIAG_SAFE_KEYS = ['t', 'aba', 'tipo', 'moeda', 'pagina', 'itemId',
        'linhas', 'resumo', 'medias', 'mediaDiamante', 'temMais', 'estado',
        'mercado', 'catalogo', 'ev', 'chave', 'listingId', 'anuncioId',
        'vendaId', 'servidorAgora'];
    const DIAG_MAX_EVENTS = 64;

    function diagnosticReset(enabled = false) {
        state.diagnostics = {
            enabled: !!enabled, since: Date.now(), lastAt: 0, count: 0,
            families: {}, samples: [], outcomes: {},
            outbound: {}, largestGapMs: 0
        };
        return state.diagnostics;
    }

    function diagnosticProtocol(message) {
        const stats = state.diagnostics;
        if (!stats?.enabled || !message || typeof message !== 'object') return;
        const rawFamily = message.t === 'market' ?
            'market:' + (['vitrine', 'itens', 'item', 'historicoGlobal'].includes(message.aba)
                ? message.aba : 'other') :
            ['welcome', 'estado', 'batalha', 'erro'].includes(message.t) ? message.t : 'other';
        const family = DIAG_FAMILIES.has(rawFamily) ? rawFamily : 'other';
        const now = Date.now();
        if (stats.lastAt) stats.largestGapMs = Math.max(stats.largestGapMs, now - stats.lastAt);
        stats.lastAt = now;
        stats.count++;
        stats.families[family] = (stats.families[family] || 0) + 1;
        // Key names from a fixed allowlist, never untrusted keys or packet values.
        const keys = DIAG_SAFE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(message, k));
        const lines = Array.isArray(message.linhas) ? message.linhas.length : null;
        const sample = {
            atSeconds: Math.floor((now - stats.since) / 1000),
            family, keys, lineCount: lines,
            empty: lines === 0
        };
        if (stats.samples.length >= DIAG_MAX_EVENTS) stats.samples.shift();
        stats.samples.push(sample);
    }

    function diagnosticOutcome(label) {
        const stats = state.diagnostics;
        if (!stats?.enabled || !['prepared', 'submitted', 'confirmed',
            'refused', 'unknown', 'quote-rejected', 'background-sent',
            'rate-limit'].includes(label)) return;
        stats.outcomes[label] = (stats.outcomes[label] || 0) + 1;
    }

    function diagnosticOutbound(payload) {
        const stats = state.diagnostics;
        if (!stats?.enabled || !payload || typeof payload !== 'object') return;
        const kind = ['market.listar', 'market.item', 'market.itens',
            'market.historicoGlobal'].includes(payload.t) ? payload.t : 'other';
        stats.outbound[kind] = (stats.outbound[kind] || 0) + 1;
    }

    function diagnosticReport() {
        const stats = state.diagnostics || diagnosticReset(false);
        return {
            format: 'mothwatch-redacted-v1',
            generatedAt: new Date().toISOString(),
            addonVersion: '0.7.0',
            enabled: !!stats.enabled,
            sessionSeconds: Math.max(0, Math.floor((Date.now() - stats.since) / 1000)),
            inboundPackets: stats.count,
            inboundFamilies: {...stats.families},
            outboundKinds: {...stats.outbound},
            purchaseOutcomes: {...stats.outcomes},
            largestInboundGapSeconds: Math.round(stats.largestGapMs / 1000),
            recentShapes: stats.samples.slice(-DIAG_MAX_EVENTS).map(row => ({
                atSeconds: row.atSeconds, family: row.family,
                keys: row.keys.slice(), lineCount: row.lineCount, empty: row.empty
            })),
            operationalCounts: {
                candidates: state.candidates?.size || 0,
                itemDetailsCached: state.itemOfferDetails?.size || 0,
                itemRequestsQueued: state.detailQueue?.length || 0,
                pendingOrders: state.pendingBuy ? 1 : 0,
                unknownOrderCount: (state.orderJournal?.orders || []).filter(o => o.status === 'unknown').length
            },
            warnings: [
                'Keys and counts only; never includes packet values, player identities, listing IDs or rule prices.',
                'Runtime resource use and real purchase outcomes require owner-led verification.'
            ]
        };
    }

