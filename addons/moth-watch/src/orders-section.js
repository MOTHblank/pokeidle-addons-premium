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
            status: ['prepared', 'submitted'].includes(o.status) ? 'unknown' : o.status,
            fillQty: Number.isSafeInteger(o.fillQty) && o.fillQty > 0 && o.fillQty <= o.qty ? o.fillQty : null,
            fillSpend: Number.isSafeInteger(o.fillSpend) && o.fillSpend > 0 && o.fillSpend <= o.spend ? o.fillSpend : null
        })).slice(-2500);
        // Aggregate settled purchases can be compacted without losing
        // per-day, per-session or per-rule budget exposure.
        let archived = {};
        try {
            const saved = JSON.parse(localStorage.getItem(ORDER_JOURNAL_KEY + ':' + accountKey) || 'null');
            if (saved?.version === 1 && saved.archived &&
                typeof saved.archived === 'object' && !Array.isArray(saved.archived))
                archived = saved.archived;
        } catch {}
        return { version: 1, accountKey, sessionId: orderSessionId(), orders, archived };
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
        for (const [key, archived] of Object.entries(state.orderJournal?.archived || {})) {
            let fields;
            try { fields = JSON.parse(key); } catch { continue; }
            if (!Array.isArray(fields) || fields.length !== 4) continue;
            const [session, day, unit, id] = fields;
            if (currency && unit !== currency || ruleId && id !== ruleId ||
                scope === 'day' && day !== orderDay(Date.now()) ||
                scope === 'session' && session !== state.orderJournal.sessionId) continue;
            const amount = Number(archived?.spent), times = Number(archived?.count),
                units = Number(archived?.quantity);
            if (Number.isSafeInteger(amount) && amount >= 0 &&
                Number.isSafeInteger(times) && times >= 0 &&
                Number.isSafeInteger(units) && units >= 0) {
                spent += amount; count += times; quantity += units;
            }
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

    function compactOrderJournal() {
        const journal = state.orderJournal;
        if (!journal || journal.orders.length < 2500) return;
        const keep = [];
        let drop = journal.orders.length - 1500;
        journal.archived ||= {};
        for (const o of journal.orders) {
            if (drop > 0 && (o.status === 'confirmed' || o.status === 'refused' ||
                o.status === 'unknown' && Date.now() - o.sentAt > 60000)) {
                // A timed-out purchase remains a *possible* spend. Preserve
                // exposure, but don't let old attempts block all new orders.
                if (o.status === 'confirmed' || o.status === 'unknown') {
                    const key = JSON.stringify([o.sessionId, o.day, o.currency, o.ruleId || '']);
                    const bucket = journal.archived[key] ||= {spent:0,count:0,quantity:0};
                    bucket.spent += o.spend;
                    bucket.count += 1;
                    bucket.quantity += o.qty;
                }
                drop--;
            } else keep.push(o);
        }
        journal.orders = keep;
        state.exposureCache?.clear();
    }

    function reserveOrder(order) {
        if (!state.orderJournal?.sessionId) return false;
        // A long-running buyer must not deadlock forever at 2500 receipts.
        // Unknown orders remain individually tracked; confirmed orders are
        // rolled into exact exposure totals before freeing journal space.
        compactOrderJournal();
        if (state.orderJournal.orders.length >= 2500) return false;
        state.orderJournal.orders.push(order);
        if (saveOrderJournal()) return true;
        state.orderJournal.orders.pop();
        return false;
    }

    // Only explicit, matching server receipt fields are usable as fill evidence.
    // Missing or ambiguous fields retain the quoted upper-bound exposure.
    function verifiedOrderFill(receipt, order) {
        if (!receipt || !order) return null;
        const quantity = Number(receipt.quantidadeComprada ?? receipt.qtdComprada ?? receipt.executedQuantity);
        const total = Number(receipt.totalPago ?? receipt.valorPago ?? receipt.executedTotal);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > order.qty ||
            !Number.isSafeInteger(total) || total < 1 || total > order.spend) return null;
        return { fillQty: quantity, fillSpend: total };
    }

    function settleOrder(order, status, receipt = null) {
        if (!order || !['confirmed', 'refused', 'unknown'].includes(status) ||
            ['confirmed', 'refused'].includes(order.status)) return false;
        if (status === 'confirmed') {
            const fill = verifiedOrderFill(receipt, order);
            if (fill) Object.assign(order, fill);
        }
        order.status = status;
        saveOrderJournal();
        state.lastPurchaseOutcome = status;
        if (status === 'confirmed') {
            // Items may be only partially filled and the upstream game does
            // not include a remaining-stock quantity in marketComprado.
            // Keep them buyable after a short retry gap; unique Pokémon remain
            // protected from duplicate acquisition attempts.
            const retryMs = order.kind === 'item' ? 400 : 30 * 60000;
            state.attemptedListings.set(order.listingId, Date.now() + retryMs);
            addLog('Purchase confirmed · listing #' + order.listingId);
        } else if (status === 'refused') {
            state.attemptedListings.set(order.listingId, Date.now() + 5000);
        } else {
            // Automatic item rules may retry after timeout using a fresh
            // listing quote. User-initiated buys and unique Pokémon still
            // require explicit acknowledgement before another request.
            state.attemptedListings.set(order.listingId,
                order.kind === 'item' && !!order.ruleId ? Date.now() + 400 : Number.MAX_SAFE_INTEGER);
            addLog('Purchase outcome unverified · listing #' + order.listingId);
        }
        snatchOutcome(order.listingId, status, order);
        queueRender();
        return true;
    }

    function resolveOrder(listingId, status, receipt = null) {
        // Several different listings, and bounded Snatch attempts for one
        // listing, can be waiting simultaneously. Resolve one server receipt
        // against one submitted attempt, never an unrelated order.
        const pending = state.pendingBuys?.get(listingId)?.[0] ||
            (state.pendingBuy?.listingId === listingId ? state.pendingBuy : null);
        if (pending) {
            if (status === 'confirmed' && receipt) {
                const fill = verifiedOrderFill(receipt, pending.order);
                if (fill) Object.assign(pending.order, fill);
            }
            finishPendingBuy(status === 'confirmed' ? 'server-confirmed' : 'refused',
                listingId, pending);
            return true;
        }
        const order = [...(state.orderJournal?.orders || [])].reverse().find(o =>
            o.listingId === listingId && o.status === 'unknown');
        if (order) return settleOrder(order, status, receipt);
        return false;
    }

    // The native game accepts marketComprado without requiring a listing ID.
    // Resolve an ID-less acknowledgement only when a *single listing* can
    // account for it; never infer which of several distinct concurrent buys
    // succeeded. An explicit but unmatched ID is not a fallback opportunity.
    function resolvePurchaseAcknowledgement(event) {
        if (event?.k !== 'marketComprado') return false;
        const ids = [event.listingId, event.anuncioId, event.vendaId,
            event.anuncio?.id, event.listing?.id];
        if (ids.some(id => id != null)) {
            for (const id of ids) {
                if (Number.isSafeInteger(Number(id)) && Number(id) > 0 &&
                    resolveOrder(Number(id), 'confirmed', event)) return true;
            }
            return false;
        }

        const pending = [...(state.pendingBuys?.values() || [])].flat();
        if (!pending.length && state.pendingBuy) pending.push(state.pendingBuy);
        const pendingIds = new Set(pending.map(order => Number(order?.listingId)));
        // Only the single pending listing (possibly with multiple Snatch sends)
        // is unambiguous. Prior unverified orders could also own this event.
        const now = Date.now();
        const recentUnknown = (state.orderJournal?.orders || []).filter(order =>
            order.status === 'unknown' && now >= Number(order.sentAt) &&
            now - Number(order.sentAt) <= 30000);
        if (pending.length) {
            if (pendingIds.size !== 1 || recentUnknown.length ||
                !pending.some(order => order?.order?.status === 'submitted')) return false;
            const [listingId] = pendingIds;
            return Number.isSafeInteger(listingId) && listingId > 0 &&
                resolveOrder(listingId, 'confirmed', event);
        }

        // An acknowledgement can arrive after the five-second timeout.
        // Reconcile it only if there is a single recent unverified attempt
        // and no other recently sent order that could have succeeded.
        if (recentUnknown.length !== 1) return false;
        const eligible = recentUnknown[0];
        if ((state.orderJournal?.orders || []).some(order =>
            order !== eligible && now >= Number(order.sentAt) &&
            now - Number(order.sentAt) <= 30000)) return false;
        return resolveOrder(eligible.listingId, 'confirmed', event);
    }

    function currentRuleMatches(rule, candidate, price) {
        if (!rule || rule.currency !== candidate.currency || price > rule.buyMax) return false;
        if (rule.type === 'fixed') return candidate.kind === 'item' && candidate.itemId === rule.itemId;
        if (rule.type === 'any') return candidate.kind === 'item';
        return candidate.kind === 'pokemon' &&
            pokemonRuleMatches(rule, candidate.ficha, candidate.currency);
    }

    function freshQuote(candidate, manual, allowSnatchRetry = false) {
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
            !(candidate.retainedUntil > serverNow()) &&
            (allowSnatchRetry || !unresolvedListing(id)) &&
            (manual || candidate.kind !== 'pokemon' ||
                candidate.ficha && typeof candidate.ficha.shiny === 'boolean' &&
                Number.isSafeInteger(Number(candidate.ficha.potencia)) &&
                Number(candidate.ficha.potencia) >= 1 && Number(candidate.ficha.potencia) <= 5);
    }
