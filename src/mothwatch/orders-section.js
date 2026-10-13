    function orderAccountKey() {
        // Storage keys never include the actual nickname.
        const name = normalize(state.nick || '');
        if (!name) return null;
        // Stable 64-bit FNV-1a for local partitioning, not authentication.
        let hash = 0xcbf29ce484222325n;
        for (const char of name) {
            hash = (hash ^ BigInt(char.codePointAt(0))) * 0x100000001b3n &
                0xffffffffffffffffn;
        }
        return hash.toString(16).padStart(16, '0');
    }

    function orderSessionId() {
        try {
            const accountKey = orderAccountKey();
            if (!accountKey) return null;
            const storageKey = ORDER_SESSION_KEY + ':' + accountKey;
            let id = sessionStorage.getItem(storageKey);
            if (!id) {
                id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
                sessionStorage.setItem(storageKey, id);
            }
            return id;
        } catch { return null; }
    }

    function loadOrderJournal() {
        const accountKey = orderAccountKey();
        if (!accountKey) return null;
        let rows = [];
        try {
            const data = JSON.parse(localStorage.getItem(ORDER_JOURNAL_KEY + ':' + accountKey) || 'null');
            if (data?.version === 1 && Array.isArray(data.orders)) rows = data.orders;
        } catch {}
        const now = Date.now();
        const orders = rows.filter(o =>
            o && Number.isSafeInteger(o.listingId) && o.listingId > 0 &&
            ['gold', 'orb'].includes(o.currency) &&
            Number.isSafeInteger(o.sentAt) && o.sentAt > 0 && o.sentAt <= now + 60000 &&
            Number.isSafeInteger(o.qty) && o.qty > 0 &&
            Number.isSafeInteger(o.spend) && o.spend > 0 &&
            ['prepared', 'submitted', 'confirmed', 'refused', 'unknown'].includes(o.status) &&
            (o.status !== 'refused' && o.status !== 'confirmed' || now - o.sentAt < 3 * 86400000)
        ).map(o => ({
            listingId: o.listingId, currency: o.currency, sentAt: o.sentAt,
            qty: o.qty, spend: o.spend, ruleId: String(o.ruleId || ''),
            kind: String(o.kind || ''), sessionId: String(o.sessionId || ''),
            day: String(o.day || ''),
            status: ['prepared', 'submitted'].includes(o.status) ? 'unknown' : o.status
        })).slice(-2500);
        return { version: 1, accountKey, sessionId: orderSessionId(), orders };
    }

    function saveOrderJournal() {
        state.exposureCache?.clear();
        if (!state.orderJournal?.sessionId ||
            state.orderJournal.accountKey !== orderAccountKey()) return false;
        try {
            localStorage.setItem(ORDER_JOURNAL_KEY + ':' + state.orderJournal.accountKey,
                JSON.stringify(state.orderJournal));
            return true;
        } catch { return false; }
    }

    function orderDay(timestamp) {
        return new Date(timestamp).toISOString().slice(0, 10); // UTC day
    }

    function unresolvedListing(id) {
        return !!state.orderJournal?.orders.some(order =>
            order.listingId === id && order.status === 'unknown');
    }

    function unverifiedOrdersExist() {
        return !!state.orderJournal?.orders.some(order => order.status === 'unknown');
    }

    // Confirmed orders are charged at the quoted maximum for safety when
    // the acknowledgement omits actual settlement price or filled quantity.
    function orderExposure(scope, currency = null, ruleId = '') {
        const cache = state.exposureCache || (state.exposureCache = new Map());
        const key = scope + ':' + (currency || '*') + ':' + ruleId + ':' + orderDay(Date.now());
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 1000) return hit.value;
        let spent = 0, count = 0, quantity = 0;
        for (const o of state.orderJournal?.orders || []) {
            if (o.status === 'refused' || currency && o.currency !== currency ||
                ruleId && o.ruleId !== ruleId ||
                scope === 'day' && o.day !== orderDay(Date.now()) ||
                scope === 'session' && o.sessionId !== state.orderJournal.sessionId) continue;
            spent += o.spend; count++; quantity += o.qty;
        }
        const value = { spent, count, quantity };
        cache.set(key, { at: Date.now(), value });
        return value;
    }

    function activeRuleById(id) {
        if (!id || !config.enabled || !config.fixedRulesEnabled || config.purchasesPaused) return null;
        const fixed = sanitizeFixedItemRules(config.fixedItemRules).find(r => r.id === id);
        if (fixed?.buyEnabled) return { ...fixed, type: 'fixed' };
        const any = sanitizeAnyItemRules(config.anyItemRules).find(r => r.id === id);
        if (any?.buyEnabled) return { ...any, type: 'any' };
        const pokemon = sanitizePokemonBuyRules(config.pokemonBuyRules).find(r => r.id === id);
        return pokemon?.buyEnabled ? { ...pokemon, type: 'pokemon' } : null;
    }

    function remainingBudget(currency, ruleId = '') {
        const limits = [
            [currency === 'orb' ? config.maxGemsPerSession : config.maxCoinsPerSession,
                orderExposure('session', currency).spent],
            [currency === 'orb' ? config.maxGemsPerDay : config.maxCoinsPerDay,
                orderExposure('day', currency).spent]
        ];
        const rule = ruleId ? activeRuleById(ruleId) : null;
        if (ruleId && !rule) return { spend: 0, quantity: 0 };
        if (rule) {
            limits.push([rule.maxSpendSession, orderExposure('session', currency, ruleId).spent],
                [rule.maxSpendDay, orderExposure('day', currency, ruleId).spent]);
        }
        let spend = Infinity;
        for (const [cap, used] of limits) {
            if (Number(cap) > 0) spend = Math.min(spend, Math.max(0, cap - used));
        }
        const session = orderExposure('session'), own = rule && orderExposure('session', null, ruleId);
        const maxCount = Math.min(
            Number(config.maxPurchasesPerSession) > 0
                ? Math.max(0, config.maxPurchasesPerSession - session.count) : Infinity,
            rule?.maxPurchasesSession > 0
                ? Math.max(0, rule.maxPurchasesSession - own.count) : Infinity
        );
        const quantity = Math.min(
            Number(config.maxQuantityPerSession) > 0
                ? Math.max(0, config.maxQuantityPerSession - session.quantity) : Infinity,
            rule?.maxQuantitySession > 0
                ? Math.max(0, rule.maxQuantitySession - own.quantity) : Infinity
        );
        return { spend: maxCount > 0 ? spend : 0, quantity };
    }

    function reserveOrder(order) {
        if (!state.orderJournal?.sessionId || state.orderJournal.orders.length >= 2500) return false;
        state.orderJournal.orders.push(order);
        if (saveOrderJournal()) return true;
        state.orderJournal.orders.pop();
        return false;
    }

    function settleOrder(order, status) {
        if (!order || !['confirmed', 'refused', 'unknown'].includes(status) ||
            ['confirmed', 'refused'].includes(order.status)) return false;
        order.status = status;
        saveOrderJournal();
        state.lastPurchaseOutcome = status;
        if (status === 'confirmed') {
            state.attemptedListings.set(order.listingId, Date.now() + 30 * 60000);
            addLog('Purchase confirmed · listing #' + order.listingId);
        } else if (status === 'refused') {
            state.attemptedListings.set(order.listingId, Date.now() + 5000);
        } else {
            state.attemptedListings.set(order.listingId, Number.MAX_SAFE_INTEGER);
            addLog('Purchase outcome unverified · listing #' + order.listingId);
        }
        queueRender();
        return true;
    }

    function resolveOrder(listingId, status) {
        if (state.pendingBuy?.listingId === listingId) {
            finishPendingBuy(status === 'confirmed' ? 'server-confirmed' : 'refused');
            return true;
        }
        const order = [...(state.orderJournal?.orders || [])].reverse().find(o =>
            o.listingId === listingId && o.status === 'unknown');
        if (order) return settleOrder(order, status);
        return false;
    }

    function currentRuleMatches(rule, candidate, price) {
        if (!rule || rule.currency !== candidate.currency || price > rule.buyMax) return false;
        if (rule.type === 'fixed') return candidate.kind === 'item' && candidate.itemId === rule.itemId;
        if (rule.type === 'any') return candidate.kind === 'item';
        return candidate.kind === 'pokemon' &&
            pokemonRuleMatches(rule, candidate.ficha, candidate.currency);
    }

    function freshQuote(candidate, manual) {
        const id = Number(candidate?.listingId), price = Number(candidate?.unitPrice || candidate?.price);
        const qty = Number(candidate?.qty), age = Date.now() - Number(candidate?.seenAt);
        return Number.isSafeInteger(id) && id > 0 &&
            ['gold', 'orb'].includes(candidate.currency) &&
            Number.isSafeInteger(price) && price > 0 &&
            Number.isSafeInteger(qty) && qty > 0 &&
            Number.isFinite(age) && age >= 0 && age <= QUOTE_MAX_AGE_MS &&
            !!state.nick && typeof candidate.seller === 'string' &&
            !!candidate.seller.trim() && candidate.seller !== '—' &&
            !isOwnListing({ vendedor: candidate.seller }) &&
            !(candidate.retainedUntil > serverNow()) && !unresolvedListing(id) &&
            (manual || candidate.kind !== 'pokemon' ||
                candidate.ficha && typeof candidate.ficha.shiny === 'boolean' &&
                Number.isSafeInteger(Number(candidate.ficha.potencia)) &&
                Number(candidate.ficha.potencia) >= 1 && Number(candidate.ficha.potencia) <= 5);
    }
