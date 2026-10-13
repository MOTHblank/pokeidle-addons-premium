    // Snatch uses the same buy journal and verified, fresh market quotes as
    // manual/rule purchases. One wake-up timer, no per-frame market polling.
    const SNATCH_KEY = 'moth-pokeidle-snatch-v1';
    const SNATCH_LIMIT = 40;
    const SNATCH_ACTIVE_MS = 30 * 60000;
    const SNATCH_RETRY_MS = 400;
    const SNATCH_MAX_QUOTE_AGE_MS = 3 * 60000;
    // Fast initial attempts, then progressive backoff on repeated refusals.
    // Do not silently abandon an existing listing after only 120 refusals.
    function snatchRetryDelay(attempts) {
        return attempts < 30 ? SNATCH_RETRY_MS : attempts < 90 ? 1500 : 5000;
    }
    function snatchKey(kind, currency, id) {
        return kind + ':' + currency + ':' + id;
    }

    // Previously observed *held* quotes remain usable at release even when
    // ordinary 30-second fresh quote checks expire. ID, price and hold time
    // are server-derived; a purchase is still authoritatively validated.
    function snatchReleaseQuote(candidate) {
        if (!candidate || !['item','pokemon'].includes(candidate.kind)) return false;
        const id = Number(candidate.listingId), price = Number(candidate.price);
        const age = Date.now() - Number(candidate.seenAt);
        const retained = Number(candidate.retainedUntil);
        return Number.isSafeInteger(id) && id > 0 &&
            ['gold','orb'].includes(candidate.currency) &&
            Number.isSafeInteger(price) && price > 0 &&
            Number.isSafeInteger(candidate.qty) && candidate.qty > 0 &&
            Number.isFinite(age) && age >= 0 && age <= SNATCH_MAX_QUOTE_AGE_MS &&
            Number.isFinite(retained) && retained > 0 && retained <= serverNow() &&
            !!state.nick && !!candidate.seller && candidate.seller !== '—' &&
            !isOwnListing({vendedor:candidate.seller}) && !unresolvedListing(id) &&
            (candidate.kind !== 'pokemon' || candidate.qty === 1 &&
                typeof candidate.ficha?.shiny === 'boolean' &&
                Number.isSafeInteger(Number(candidate.ficha?.potencia)) &&
                Number(candidate.ficha.potencia) >= 1 && Number(candidate.ficha.potencia) <= 5);
    }

    function snatchRestore() {
        const account = orderAccountKey();
        if (state.snatchWake) clearTimeout(state.snatchWake);
        state.snatchManual = new Map();
        state.snatchObserved = new Map();
        state.snatchRecoverAt = new Map();
        state.snatchNativeOffers = new Map();
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
        snatchSchedule(25);
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
        const until = Number(offer.compravelEm);
        const held = Number.isFinite(until) && until > serverNow();
        // Most listings are never targeted. Avoid per-offer rule matching
        // and sanitization for unheld, unmarked, untracked rows.
        if (!manual && !held && !state.snatchObserved.has(key)) return;
        const rule = snatchMatchingRule(kind,currency,itemId,offer);
        if (!manual && !rule && !state.snatchObserved.has(key)) return;
        if (!state.snatchObserved.has(key) && state.snatchObserved.size >= SNATCH_LIMIT) {
            const disposable = [...state.snatchObserved.keys()].find(k=>!state.snatchManual.has(k));
            if (!disposable) return;
            state.snatchObserved.delete(disposable);
        }
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
            for (const offer of Array.isArray(message.linhas) ? message.linhas.slice(0,120) : []) {
                const id=Number(offer?.id),itemId=Number(message.itemId);
                if (Number.isSafeInteger(id)&&id>0 && Number.isSafeInteger(itemId)&&itemId>0)
                    state.snatchNativeOffers.set(snatchKey('item',message.moeda,id),{...offer,itemId});
                snatchObserve('item',message.moeda,offer,itemId);
            }
        } else if (message.aba === 'vitrine' && Array.isArray(message.linhas)) {
            for (const offer of message.linhas.slice(0,120)) {
                const kind = offer?.ficha ? 'pokemon' : offer?.tipo === 'item' ? 'item' : null;
                const currency = offer?.moeda || message.moeda;
                if (kind && ['gold','orb'].includes(currency)) {
                    const id=Number(offer?.id);
                    if (Number.isSafeInteger(id)&&id>0)
                        state.snatchNativeOffers.set(snatchKey(kind,currency,id),offer);
                    snatchObserve(kind,currency,offer,Number(offer.itemId || 0));
                }
            }
        }
        while (state.snatchNativeOffers.size > 240)
            state.snatchNativeOffers.delete(state.snatchNativeOffers.keys().next().value);
    }

    function snatchMark(kind, currency, id, itemId = 0) {
        const key = snatchKey(kind,currency,id);
        if (state.snatchManual.has(key)) {
            state.snatchManual.delete(key);
            snatchSave(); snatchSchedule(); queueRender(); return true;
        }
        if (state.snatchManual.size >= SNATCH_LIMIT) return false;
        const obs = state.snatchObserved.get(key);
        const itemOffer = kind === 'item' ?
            state.itemOfferDetails.get(itemId + ':' + currency)?.offers?.find(o=>Number(o.id)===id) : null;
        const pokemonOffer = kind === 'pokemon' ?
            state.pokemonAutoOffers.get(currency)?.offers?.find(o=>Number(o.id)===id) : null;
        const offer = itemOffer || pokemonOffer || state.snatchNativeOffers?.get(key);
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
        const now = Date.now();
        for (const [key, target] of [...state.snatchManual]) {
            if (target.expiresAt <= now) { snatchStop(key, 'expired'); continue; }
            if (state.snatchObserved.has(key) || now - Number(state.snatchRecoverAt?.get(key)||0)<10000) continue;
            state.snatchRecoverAt.set(key,now);
            if (target.kind === 'item' && target.itemId > 0 && !communityMarketIsOpen()) {
                state.ruleItemKeys.add(target.itemId + ':' + target.currency);
                queueItemDetail(target.itemId,target.currency);
            } else if (target.kind === 'pokemon' && !communityMarketIsOpen() &&
                !state.pokemonScan?.waiting) startPokemonScan();
        }
        if (!state.orderJournal?.accountKey || !config.enabled || config.purchasesPaused ||
            !state.gameSocket || state.gameSocket.readyState !== 1 ||
            state.pendingBuy || unverifiedOrdersExist() || gameIsLoading()) {
            snatchSchedule(10000); return;
        }
        const server = serverNow();
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
            if (entry.releaseAt > server) {
                // Do not fill the wire with scans immediately before unlock.
                if (entry.releaseAt - server > 5000 &&
                    now - Number(c.seenAt||0) > SNATCH_MAX_QUOTE_AGE_MS - 12000)
                    snatchRefresh(entry,now);
                continue;
            }
            if (!freshQuote(c,!!manual) && !snatchReleaseQuote(c)) {
                // Missing a current quote must not create a 35ms busy loop.
                entry.retryAt = now + 1000;
                snatchRefresh(entry,now);
                continue;
            }
            if (now < entry.retryAt || Number(state.attemptedListings.get(c.listingId)||0)>now) continue;
            if (Number(state.rateLimitedUntil||0)>now) {
                entry.retryAt = Number(state.rateLimitedUntil);
                continue;
            }
            if (!manual && entry.releaseAt > 0 &&
                server - entry.releaseAt > SNATCH_ACTIVE_MS) {
                snatchStop(key,'rule target expired'); continue;
            }
            if (entry.ruleId && !manual && (!rule || !currentRuleMatches(rule,c,c.price))) {
                state.snatchObserved.delete(key); continue;
            }
            const activeRule = manual ? null : rule;
            if (purchaseQuantity(c,activeRule?.id || '') < 1) {
                entry.retryAt = now + 1000;
                continue;
            }
            // No refresh request is made before the scheduled first buy.
            entry.retryAt = now + SNATCH_RETRY_MS;
            if (tryBuy(c,!!manual,1,activeRule || false,true)) {
                entry.attempts++;
                queueRender();
                break;
            }
            // An unsent attempt was not accepted as an order. Avoid spinning.
            entry.retryAt = now + 1000;
        }
        snatchSchedule();
    }

    function snatchCriticalWindow() {
        const now=serverNow();
        for (const entry of state.snatchObserved.values()) {
            if ((state.snatchManual.has(snatchKey(entry.candidate.kind,
                    entry.candidate.currency,entry.candidate.listingId)) ||
                activeRuleById(entry.ruleId)) &&
                entry.releaseAt > 0 && entry.releaseAt-now < 1500 &&
                entry.releaseAt-now > -10000 &&
                (!state.pendingBuy || state.pendingBuy.listingId === entry.candidate.listingId)) return true;
        }
        return false;
    }

    function snatchSchedule(override = 0) {
        if (state.snatchWake) clearTimeout(state.snatchWake);
        state.snatchWake = null;
        if (!(state.snatchManual?.size || state.snatchObserved?.size)) return;
        const server = serverNow();
        let wait = override || (state.snatchObserved.size ? 30000 : 10000);
        if (!override) {
            for (const entry of state.snatchObserved.values()) {
                const until = entry.releaseAt || 0;
                if (until > server + 18000) wait = Math.min(wait,Math.max(50,until-server-18000));
                else if (until > server) wait = Math.min(wait,until-server);
                else wait = Math.min(wait,Math.max(35,entry.retryAt-Date.now()));
            }
        }
        // A single timer for all snatches. No permanently fast interval.
        state.snatchWake = setTimeout(snatchTick,Math.max(25,Math.min(30000,wait)));
    }

    function snatchOutcome(listingId,status) {
        for (const [key,entry] of [...state.snatchObserved]) {
            if (entry.candidate.listingId !== listingId) continue;
            if (status === 'confirmed' || status === 'unknown') {
                snatchStop(key,status); continue;
            }
            entry.retryAt = Date.now() + snatchRetryDelay(entry.attempts);
            state.attemptedListings.set(listingId,entry.retryAt);
            // Retry on the next release timer, not on a bulk market scan.
            // Targeted listing reconciliation happens separately, when idle.
        }
        snatchSchedule();
    }

    function snatchConfirmItemListingSet(itemId,currency,offers) {
        if (!Array.isArray(offers) || offers.length >= 120) return;
        const present = new Set(offers.map(o=>Number(o?.id)));
        for (const [key,entry] of [...state.snatchObserved]) {
            if (entry.candidate.kind !== 'item' ||
                entry.candidate.itemId !== itemId || entry.candidate.currency !== currency) continue;
            entry.missing = present.has(entry.candidate.listingId) ? 0 : (entry.missing||0)+1;
            if (entry.missing >= 2 && serverNow() >= entry.releaseAt)
                snatchStop(key,'listing no longer available');
        }
    }

    function snatchEnhanceNativeMarket() {
        const list=q('#cm-lista');
        if (!list || !communityMarketIsOpen()) return;
        // Native markup is not a stable public contract. Only attach to rows
        // with an explicit matching listing ID and a verified market packet.
        for (const row of list.querySelectorAll('[data-anuncio-id],[data-listing-id]')) {
            const id=Number(row.getAttribute('data-anuncio-id') ||
                row.getAttribute('data-listing-id'));
            if (!Number.isSafeInteger(id)||id<=0||row.querySelector('[data-moth-native-snatch]'))
                continue;
            const entry=[...state.snatchNativeOffers.entries()].find(([key])=>
                key.endsWith(':'+id));
            if (!entry) continue;
            const [key,offer]=entry;
            const [kind,currency]=key.split(':');
            const marker=row.querySelector('.cm-tempo,.cm-retencao,.cm-contagem,[data-compravel-em]') ||
                row.querySelector('button');
            if (!marker || !offer || !['item','pokemon'].includes(kind)) continue;
            const button=document.createElement('button');
            button.type='button'; button.className='moth-mw-btn';
            button.dataset.mothNativeSnatch=key;
            button.dataset.mothSnatchItem=String(Number(offer.itemId)||0);
            button.textContent=tr(state.snatchManual.has(key)?'Cancel snatch':'Snatch');
            button.style.marginInlineStart='0.4rem';
            button.addEventListener('click',event=>{
                event.preventDefault(); event.stopPropagation();
                const accepted=snatchMark(kind,currency,id,Number(offer.itemId)||0);
                if (accepted) {
                    button.textContent=tr(state.snatchManual.has(key)?'Cancel snatch':'Snatch');
                    button.setAttribute('aria-pressed',state.snatchManual.has(key)?'true':'false');
                } else addLog('Snatch not armed · load the listing again');
            });
            button.setAttribute('aria-pressed',state.snatchManual.has(key)?'true':'false');
            marker.insertAdjacentElement('afterend',button);
        }
    }

    function snatchQueueHtml() {
        const rows=[...state.snatchManual.entries()].slice(0,SNATCH_LIMIT);
        if (!rows.length) return '<p class="moth-mw-rule-hint">' +
            escapeHtml(tr('No snatches armed.')) + '</p>';
        return rows.map(([key,target]) => {
            const observation=state.snatchObserved.get(key);
            const count=observation?.releaseAt>serverNow()
                ? tr('Held · {seconds}s', {seconds:Math.max(1,Math.ceil((observation.releaseAt-serverNow())/1000))})
                : observation ? tr('Waiting for purchase') : tr('Waiting for a fresh listing');
            return '<div class="moth-mw-offer-row"><b>#'+num(target.id)+'</b> · ' +
                escapeHtml(tr(target.kind==='pokemon'?'Pokémon':'Items')) +
                ' · ' + money(target.maxPrice,target.currency) + ' · ' + escapeHtml(count) +
                snatchButton(target.kind,target.currency,target.id,target.itemId) + '</div>';
        }).join('');
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
