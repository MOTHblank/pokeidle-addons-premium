    // Snatch uses the same buy journal and verified, fresh market quotes as
    // manual/rule purchases. One wake-up timer, no per-frame market polling.
    const SNATCH_KEY = 'moth-pokeidle-snatch-v1';
    const SNATCH_LIMIT = 40;
    const SNATCH_ACTIVE_MS = 30 * 60000;
    const SNATCH_RETRY_MS = 1200;
    function snatchKey(kind, currency, id) {
        return kind + ':' + currency + ':' + id;
    }

    function snatchRestore() {
        const account = orderAccountKey();
        state.snatchManual = new Map();
        state.snatchObserved = new Map();
        state.snatchWake = null;
        if (!account) return;
        try {
            const data = JSON.parse(localStorage.getItem(SNATCH_KEY + ':' + account) || 'null');
            if (data?.version !== 1 || !Array.isArray(data.targets)) return;
            const now = Date.now();
            for (const entry of data.targets.slice(-SNATCH_LIMIT)) {
                if (!['item', 'pokemon'].includes(entry.kind) ||
                    !['gold', 'orb'].includes(entry.currency) ||
                    !Number.isSafeInteger(entry.id) || entry.id <= 0 ||
                    !Number.isSafeInteger(entry.maxPrice) || entry.maxPrice <= 0 ||
                    !Number.isSafeInteger(entry.itemId || 0) ||
                    !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= now ||
                    entry.expiresAt > now + 2 * SNATCH_ACTIVE_MS) continue;
                state.snatchManual.set(snatchKey(entry.kind, entry.currency, entry.id), {
                    kind:entry.kind, currency:entry.currency, id:entry.id, itemId:entry.itemId || 0,
                    maxPrice:entry.maxPrice, expiresAt:entry.expiresAt
                });
            }
        } catch {}
    }

    function snatchSave() {
        const account = orderAccountKey();
        if (!account || state.orderJournal?.accountKey !== account) return false;
        try {
            localStorage.setItem(SNATCH_KEY + ':' + account, JSON.stringify({
                version:1, targets:[...state.snatchManual.values()].slice(-SNATCH_LIMIT)
            }));
            return true;
        } catch { return false; }
    }

    function snatchMatchingRule(kind, currency, itemId, offer) {
        if (!config.enabled || !config.fixedRulesEnabled || config.purchasesPaused) return null;
        const price = Number(offer?.preco);
        if (!Number.isSafeInteger(price) || price <= 0) return null;
        if (kind === 'item') {
            const rules = [
                ...sanitizeFixedItemRules(config.fixedItemRules).map(r=>({...r,type:'fixed'})),
                ...activeAnyItemRules().map(r=>({...r,type:'any'}))
            ];
            return rules.find(rule => rule.buyEnabled && rule.currency === currency &&
                rule.buyMax >= price && (rule.type !== 'fixed' || rule.itemId === itemId)) || null;
        }
        return activePokemonRules().map(r=>({...r,type:'pokemon'})).find(rule =>
            rule.currency === currency && rule.buyMax >= price &&
            pokemonRuleMatches(rule, offer.ficha, currency)) || null;
    }

    function snatchObserve(kind, currency, offer, itemId = 0) {
        const id = Number(offer?.id), price = Number(offer?.preco), qty = Number(offer?.qtd);
        if (!['item','pokemon'].includes(kind) || !['gold','orb'].includes(currency) ||
            !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(price) ||
            price <= 0 || !Number.isSafeInteger(qty) || qty <= 0 ||
            kind === 'pokemon' && (qty !== 1 || !offer.ficha) ||
            kind === 'item' && (!Number.isSafeInteger(itemId) || itemId <= 0) ||
            isOwnListing(offer)) return;
        const key = snatchKey(kind,currency,id);
        const manual = state.snatchManual.get(key);
        const rule = snatchMatchingRule(kind,currency,itemId,offer);
        const until = Number(offer.compravelEm);
        const held = Number.isFinite(until) && until > serverNow();
        if (!manual && (!rule || !held)) return;
        const old = state.snatchObserved.get(key);
        const candidate = {
            key:'snatch:' + key, kind, currency, listingId:id, itemId,
            ficha:kind === 'pokemon' ? offer.ficha : null, price, unitPrice:price,
            qty, seller:String(offer.vendedor || ''), seenAt:Date.now(),
            retainedUntil:held ? until : 0, name:kind === 'item' ? catalogName(itemId) :
                pokemonListingName(offer.ficha), average:0, ratio:1
        };
        state.snatchObserved.set(key, {
            candidate, ruleId:rule?.id || old?.ruleId || '',
            releaseAt:held ? until : old?.releaseAt || 0,
            attempts:old?.attempts || 0, retryAt:old?.retryAt || 0,
            observedAt:Date.now(), refreshedAt:old?.refreshedAt || 0
        });
        if (manual && price > manual.maxPrice) {
            snatchStop(key, 'Price changed beyond authorized ceiling');
            return;
        }
        snatchSchedule();
    }

    function snatchObservePacket(message) {
        if (!state.orderJournal?.accountKey || message?.t !== 'market') return;
        if (message.aba === 'item' && ['gold','orb'].includes(message.moeda) &&
            Number.isSafeInteger(Number(message.itemId))) {
            for (const offer of Array.isArray(message.linhas) ? message.linhas.slice(0,120) : [])
                snatchObserve('item',message.moeda,offer,Number(message.itemId));
        } else if (message.aba === 'vitrine' && Array.isArray(message.linhas)) {
            for (const offer of message.linhas.slice(0,120)) {
                const kind = offer?.ficha ? 'pokemon' : offer?.tipo === 'item' ? 'item' : null;
                const currency = offer?.moeda || message.moeda;
                if (kind && ['gold','orb'].includes(currency))
                    snatchObserve(kind,currency,offer,Number(offer.itemId || 0));
            }
        }
    }

    function snatchMark(kind, currency, id, itemId = 0) {
        const key = snatchKey(kind,currency,id);
        if (state.snatchManual.has(key)) {
            state.snatchManual.delete(key);
            snatchSave(); snatchSchedule(); queueRender(); return true;
        }
        const obs = state.snatchObserved.get(key);
        const itemOffer = kind === 'item' ?
            state.itemOfferDetails.get(itemId + ':' + currency)?.offers?.find(o=>Number(o.id)===id) : null;
        const pokemonOffer = kind === 'pokemon' ?
            state.pokemonAutoOffers.get(currency)?.offers?.find(o=>Number(o.id)===id) : null;
        const offer = itemOffer || pokemonOffer;
        if (!obs && offer) {
            // A direct player click is an explicit one-listing authorization;
            // initialize the same observation path even without a broad rule.
            state.snatchManual.set(key,{kind,currency,id,itemId,maxPrice:Number(offer.preco),
                expiresAt:Math.max(Date.now(),Number(offer.compravelEm)||0)+SNATCH_ACTIVE_MS});
            snatchObserve(kind,currency,offer,itemId);
        } else if (obs) {
            state.snatchManual.set(key,{kind,currency,id,itemId:itemId||obs.candidate.itemId,
                maxPrice:obs.candidate.price,
                expiresAt:Math.max(Date.now(),obs.releaseAt)+SNATCH_ACTIVE_MS});
        } else return false;
        if (!state.snatchManual.has(key) || !snatchSave()) {
            state.snatchManual.delete(key); return false;
        }
        snatchSchedule(); queueRender(); return true;
    }

    function snatchStop(key, reason) {
        const wasManual = state.snatchManual.delete(key);
        state.snatchObserved.delete(key);
        if (wasManual) snatchSave();
        if (reason) addLog('Snatch ' + reason);
        snatchSchedule(); queueRender();
    }

    function snatchRefresh(entry, now) {
        const c = entry.candidate;
        if (!c || now - entry.refreshedAt < 4000 ||
            gameIsLoading() || !state.socket || state.socket.readyState !== 1) return;
        entry.refreshedAt = now;
        if (c.kind === 'item') {
            // Reuse existing serialized detail queue and its server throttling.
            const key = c.itemId + ':' + c.currency;
            state.ruleItemKeys.add(key);
            state.lastDetailRequest.delete(key);
            queueItemDetail(c.itemId,c.currency);
        } else if (!state.pokemonScan?.waiting && !communityMarketIsOpen()) {
            startPokemonScan();
        }
    }

    function snatchTick() {
        state.snatchWake = null;
        if (!state.orderJournal?.accountKey || !config.enabled || config.purchasesPaused ||
            !state.gameSocket || state.gameSocket.readyState !== 1 ||
            state.pendingBuy || unverifiedOrdersExist() || gameIsLoading()) {
            snatchSchedule(1000); return;
        }
        const now = Date.now(), server = serverNow();
        const entries = [...state.snatchObserved.entries()].sort((a,b)=>
            Number(a[1].releaseAt || 0) - Number(b[1].releaseAt || 0));
        for (const [key, entry] of entries) {
            const manual = state.snatchManual.get(key);
            const rule = entry.ruleId ? activeRuleById(entry.ruleId) : null;
            if (!manual && !rule) { state.snatchObserved.delete(key); continue; }
            if (manual?.expiresAt <= now) { snatchStop(key, 'expired'); continue; }
            const c = entry.candidate;
            if (manual && (c.price > manual.maxPrice || c.itemId !== manual.itemId && c.kind==='item')) {
                snatchStop(key,'quote changed'); continue;
            }
            if (entry.releaseAt > server + 18000) continue;
            if (entry.releaseAt > server - 50 || !freshQuote(c,!!manual)) {
                snatchRefresh(entry,now);
                continue;
            }
            if (now < entry.retryAt || Number(state.attemptedListings.get(c.listingId)||0)>now) continue;
            if (entry.attempts >= 30) { snatchStop(key,'attempt limit'); continue; }
            if (entry.ruleId && !manual && (!rule || !currentRuleMatches(rule,c,c.price))) {
                state.snatchObserved.delete(key); continue;
            }
            const activeRule = manual ? null : rule;
            if (purchaseQuantity(c,activeRule?.id || '') < 1) continue;
            if (backgroundDelayMs()>0) continue;
            entry.retryAt = now + SNATCH_RETRY_MS;
            entry.attempts++;
            if (tryBuy(c,!!manual,1,activeRule || false)) {
                queueRender();
                break;
            }
        }
        snatchSchedule();
    }

    function snatchSchedule(override = 0) {
        if (state.snatchWake) clearTimeout(state.snatchWake);
        state.snatchWake = null;
        if (!(state.snatchManual?.size || state.snatchObserved?.size)) return;
        const server = serverNow();
        let wait = override || 30000;
        if (!override) {
            for (const entry of state.snatchObserved.values()) {
                const until = entry.releaseAt || 0;
                if (until > server + 18000) wait = Math.min(wait,Math.max(50,until-server-18000));
                else if (until > server) wait = Math.min(wait,until-server < 2000 ? Math.max(25,until-server+30) : 2000);
                else wait = Math.min(wait,Math.max(200,entry.retryAt-Date.now()));
            }
        }
        // A single timer for all snatches. No permanently fast interval.
        state.snatchWake = setTimeout(snatchTick,Math.max(25,Math.min(30000,wait)));
    }

    function snatchOutcome(listingId,status) {
        for (const [key,entry] of state.snatchObserved) {
            if (entry.candidate.listingId !== listingId) continue;
            if (status === 'confirmed' || status === 'unknown') {
                snatchStop(key,status); continue;
            }
            entry.retryAt = Date.now() + SNATCH_RETRY_MS;
            state.attemptedListings.set(listingId,entry.retryAt);
        }
        snatchSchedule();
    }

    function snatchButton(kind,currency,id,itemId=0) {
        if (!Number.isSafeInteger(Number(id)) || Number(id)<=0 || !['item','pokemon'].includes(kind))
            return '';
        const key = snatchKey(kind,currency,id);
        const active = state.snatchManual.has(key);
        return '<button type="button" class="moth-mw-btn" data-moth-snatch="' +
            escapeHtml(key) + '" data-moth-snatch-item="' + Number(itemId||0) +
            '" aria-pressed="' + (active?'true':'false') + '">' +
            escapeHtml(tr(active ? 'Cancel snatch' : 'Snatch')) + '</button>';
    }
