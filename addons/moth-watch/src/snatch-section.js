    // Snatch uses the same buy journal and verified, fresh market quotes as
    // manual/rule purchases. One wake-up timer, no per-frame market polling.
    const SNATCH_KEY = 'moth-pokeidle-snatch-v1';
    const SNATCH_LIMIT = 40;
    const SNATCH_ACTIVE_MS = 30 * 60000;
    const SNATCH_RETRY_MS = 150;
    const SNATCH_WINDOW_MS = 4000;
    const SNATCH_BURST_SIZE = 8;
    const SNATCH_MAX_QUOTE_AGE_MS = 3 * 60000;
    const SNATCH_PREPARE_MS = 45000;
    const SNATCH_VERIFY_RETRY_MS = 8500;
    // All held-listing attempts compete in the same four-second window.
    // Afterwards only a separately confirmed live listing may be bought.
    function snatchRetryDelay() { return SNATCH_RETRY_MS; }
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
            Number.isFinite(age) && age >= 0 &&
            Number.isFinite(retained) && retained > 0 &&
            retained <= serverNow() && serverNow() < retained + SNATCH_WINDOW_MS &&
            !!state.nick && !!candidate.seller && candidate.seller !== '—' &&
            !isOwnListing({vendedor:candidate.seller}) &&
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
        state.snatchVerifyPending = null;
        state.snatchVerifyAt = new Map();
        if (!account) return;
        try {
            const data = JSON.parse(localStorage.getItem(SNATCH_KEY + ':' + account) || 'null');
            if (data?.version !== 1 || !Array.isArray(data.targets)) return;
            for (const entry of data.targets.slice(-SNATCH_LIMIT)) {
                if (!['item', 'pokemon'].includes(entry.kind) ||
                    !['gold', 'orb'].includes(entry.currency) ||
                    !Number.isSafeInteger(entry.id) || entry.id <= 0 ||
                    !Number.isSafeInteger(entry.maxPrice) || entry.maxPrice <= 0 ||
                    !Number.isSafeInteger(entry.itemId || 0) ||
                    !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= 0) continue;
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
            retainedUntil:held ? until : old?.releaseAt || 0, name:kind === 'item' ? catalogName(itemId) :
                pokemonListingName(offer.ficha), average:0, ratio:1
        };
        state.snatchObserved.set(key, {
            candidate, ruleId:rule?.id || old?.ruleId || '',
            releaseAt:held ? until : old?.releaseAt || 0,
            attempts:old?.attempts || 0, retryAt:old?.retryAt || 0,
            // Every authenticated listing response replaces the previous
            // quantity quote. No purchase ack implies a remaining-stock count.
            missing:0, needsVerification:false,
            lastVerifiedAt:old?.lastVerifiedAt || 0,
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
        snatchSchedule(25); queueRender(); return true;
    }

    function snatchStop(key, reason) {
        const wasManual = state.snatchManual.delete(key);
        state.snatchObserved.delete(key);
        state.snatchVerifyAt?.delete(key);
        if (state.snatchVerifyPending?.key === key) state.snatchVerifyPending = null;
        if (wasManual) snatchSave();
        if (reason) addLog('Snatch ' + reason);
        snatchSchedule(); queueRender();
    }

    // PokéIdle's own client uses market.anuncio to inspect a specific listing.
    // Unlike page-zero browsing, this can authoritatively report that #id is
    // sold/closed. Never infer deletion from a truncated market listing page.
    function snatchHandleSingleListing(message) {
        if (message?.aba !== 'anuncio') return false;
        const id = Number(message.id);
        const pending = state.snatchVerifyPending;
        if (!pending || id !== pending.id) return false;
        state.snatchVerifyPending = null;
        const target = state.snatchManual.get(pending.key);
        const entry = state.snatchObserved.get(pending.key);
        const listing = message.anuncio;
        if (!target && !entry) return true;
        if (!listing || listing.estado && listing.estado !== 'aberto' ||
            Number(listing.id) !== id) {
            snatchStop(pending.key, 'listing #' + id + ' no longer exists');
            return true;
        }
        const kind = listing.ficha ? 'pokemon' : listing.tipo === 'item' ? 'item' : target?.kind;
        const currency = listing.moeda || target?.currency || entry?.candidate?.currency;
        const itemId = Number(listing.itemId || target?.itemId || entry?.candidate?.itemId || 0);
        if (kind !== (target?.kind || entry?.candidate?.kind) ||
            currency !== (target?.currency || entry?.candidate?.currency) ||
            target && Number(listing.preco) > target.maxPrice) {
            snatchStop(pending.key, 'quote changed for #' + id);
            return true;
        }
        snatchObserve(kind, currency, listing, itemId);
        const refreshed = state.snatchObserved.get(pending.key);
        if (refreshed) {
            refreshed.lastVerifiedAt = Date.now();
            refreshed.needsVerification = false;
        }
        snatchSchedule(25);
        return true;
    }

    function snatchVerifyListing(key, target, entry, now) {
        if (state.snatchVerifyPending &&
            now - state.snatchVerifyPending.sentAt < 5500) return false;
        if (state.snatchVerifyPending) state.snatchVerifyPending = null;
        if (now - Number(state.snatchVerifyAt?.get(key) || 0) < SNATCH_VERIFY_RETRY_MS)
            return false;
        const id = Number(target?.id || entry?.candidate?.listingId);
        if (!Number.isSafeInteger(id) || id < 1) return false;
        if (!sendBackground({t:'market.anuncio',id})) return false;
        state.snatchVerifyPending = {id,key,sentAt:now};
        state.snatchVerifyAt.set(key,now);
        return true;
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
        const server = serverNow();
        if (!state.orderJournal?.accountKey || !config.enabled || config.purchasesPaused ||
            !state.gameSocket || state.gameSocket.readyState !== 1 || gameIsLoading()) {
            snatchSchedule(1000); return;
        }
        // Recover exact manual listing IDs. A general item/market page can
        // omit a listing that still exists; market.anuncio does not.
        for (const [key, target] of state.snatchManual) {
            if (state.snatchObserved.has(key)) continue;
            if (snatchVerifyListing(key, target, null, now)) break;
        }
        const entries = [...state.snatchObserved.entries()].sort((a,b) => {
            const aBurst = a[1].releaseAt > 0 && a[1].releaseAt <= server &&
                server < a[1].releaseAt + SNATCH_WINDOW_MS;
            const bBurst = b[1].releaseAt > 0 && b[1].releaseAt <= server &&
                server < b[1].releaseAt + SNATCH_WINDOW_MS;
            if (aBurst !== bBurst) return aBurst ? -1 : 1;
            // With 22 simultaneous targets, give each listing its FIRST shot
            // before spending the four seconds retrying the first listing.
            if (aBurst && a[1].attempts !== b[1].attempts)
                return a[1].attempts - b[1].attempts;
            return Number(a[1].releaseAt || 0) - Number(b[1].releaseAt || 0);
        });
        let sentThisTick = 0;
        for (const [key, entry] of entries) {
            const manual = state.snatchManual.get(key);
            const rule = entry.ruleId ? activeRuleById(entry.ruleId) : null;
            if (!manual && !rule) { state.snatchObserved.delete(key); continue; }
            const c = entry.candidate;
            if (manual && (c.price > manual.maxPrice ||
                c.itemId !== manual.itemId && c.kind === 'item')) {
                snatchStop(key, 'quote changed'); continue;
            }
            if (entry.releaseAt > server) {
                // Use spare time BEFORE unlock to verify held listings. Do
                // not compete with the four-second purchase burst.
                if (manual && (entry.needsVerification ||
                    now - Number(entry.lastVerifiedAt || 0) > 45000 &&
                    now - Number(c.seenAt || 0) > 15000))
                    snatchVerifyListing(key, manual, entry, now);
                continue;
            }
            const burst = entry.releaseAt > 0 &&
                server < entry.releaseAt + SNATCH_WINDOW_MS;
            if (!burst) {
                // Outside the four-second lottery, only try a recent positive
                // per-listing verification. Never pound a vanished offer.
                const verified = entry.lastVerifiedAt > 0 &&
                    now - entry.lastVerifiedAt < 15000;
                if (!verified || entry.needsVerification) {
                    snatchVerifyListing(key, manual, entry, now);
                    continue;
                }
            }
            if (!freshQuote(c, !!manual, true) &&
                !(burst && snatchReleaseQuote(c))) {
                entry.needsVerification = true;
                snatchVerifyListing(key, manual, entry, now);
                continue;
            }
            if (now < entry.retryAt ||
                Number(state.attemptedListings.get(c.listingId) || 0) > now)
                continue;
            if (Number(state.rateLimitedUntil || 0) > now) break;
            if (entry.ruleId && !manual && (!rule || !currentRuleMatches(rule,c,c.price))) {
                state.snatchObserved.delete(key); continue;
            }
            const activeRule = manual ? null : rule;
            if (purchaseQuantity(c,activeRule?.id || '') < 1) {
                entry.retryAt = now + 500;
                continue;
            }
            // The server accepts market.comprar on the exact listing ID.
            // Request the MAX affordable units each time; never decrement
            // the original lot quantity based on an ambiguous acknowledgement.
            entry.retryAt = now + (burst ? SNATCH_RETRY_MS : 1000);
            if (tryBuy(c,!!manual,null,activeRule || false,burst)) {
                entry.attempts++;
                if (!burst) entry.lastVerifiedAt = 0;
                sentThisTick++;
                if (sentThisTick >= SNATCH_BURST_SIZE) break;
            } else {
                entry.retryAt = now + (burst ? 100 : 500);
            }
        }
        snatchSchedule();
    }

    function snatchCriticalWindow() {
        const now=serverNow();
        for (const entry of state.snatchObserved.values()) {
            if ((state.snatchManual.has(snatchKey(entry.candidate.kind,
                    entry.candidate.currency,entry.candidate.listingId)) ||
                activeRuleById(entry.ruleId)) &&
                entry.releaseAt > 0 && entry.releaseAt-now < 2000 &&
                entry.releaseAt-now > -SNATCH_WINDOW_MS) return true;
        }
        return false;
    }

    function snatchSchedule(override = 0) {
        if (state.snatchWake) clearTimeout(state.snatchWake);
        state.snatchWake = null;
        if (!(state.snatchManual?.size || state.snatchObserved?.size)) return;
        const server = serverNow();
        const now = Date.now();
        let wait = override || 10000;
        if (!override) {
            if (state.snatchManual?.size) wait = Math.min(wait, 1000);
            if ([...state.snatchManual].some(([key]) => !state.snatchObserved.has(key)))
                wait = Math.min(wait, 500);
            if (state.snatchVerifyPending)
                wait = Math.min(wait, 600);
            for (const entry of state.snatchObserved.values()) {
                const until = Number(entry.releaseAt || 0);
                if (until > server + SNATCH_PREPARE_MS) {
                    wait = Math.min(wait,Math.max(100,until-server-SNATCH_PREPARE_MS));
                } else if (until > server) {
                    // During the 45-second warmup verify held listings,
                    // rather than sleeping right through to unlock.
                    wait = Math.min(wait, Math.max(120,
                        Math.min(1500, until-server)));
                } else if (until > 0 && server < until + SNATCH_WINDOW_MS) {
                    wait = Math.min(wait, 120);
                } else {
                    wait = Math.min(wait, Math.max(700,
                        Number(entry.retryAt || 0)-now));
                }
            }
        }
        state.snatchWake = setTimeout(snatchTick,Math.max(25,Math.min(30000,wait)));
    }

    function snatchOutcome(listingId,status,order=null) {
        for (const [key,entry] of [...state.snatchObserved]) {
            if (entry.candidate.listingId !== listingId) continue;
            if (status === 'confirmed') {
                if (entry.candidate.kind === 'pokemon') {
                    // Pokémon listings contain exactly one specimen.
                    snatchStop(key,'confirmed'); continue;
                }
                // The upstream marketComprado notification does not prove
                // that the whole item listing sold, even when qtd was large.
                // Ask for a new authenticated stock quote asynchronously but
                // never block the next maximum-quantity purchase on it.
                entry.refreshedAt = 0;
                snatchRefresh(entry, Date.now());
            }
            // Success, refusal and unknown all leave item stock uncertain.
            // Keep requesting the largest affordable quantity while the quote
            // is valid; the authoritative server decides what remains.
            entry.retryAt = Date.now() + snatchRetryDelay(entry.attempts);
            state.attemptedListings.set(listingId,entry.retryAt);
        }
        snatchSchedule();
    }

    function snatchConfirmItemListingSet(itemId,currency,offers) {
        if (!Array.isArray(offers)) return;
        const present = new Set(offers.map(o=>Number(o?.id)));
        for (const [key,entry] of state.snatchObserved) {
            if (entry.candidate.kind !== 'item' ||
                entry.candidate.itemId !== itemId || entry.candidate.currency !== currency) continue;
            if (present.has(entry.candidate.listingId)) {
                entry.missing = 0;
                entry.needsVerification = false;
            } else if (offers.length < 120) {
                entry.missing = (entry.missing || 0) + 1;
                // Not on the item detail page twice? Request this exact ID.
                // The answer removes closed listings instead of leaving a
                // permanent 30-minute "failing" Snatch in the queue.
                if (entry.missing >= 2) {
                    entry.needsVerification = true;
                    snatchSchedule(25);
                }
            }
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
            if (!marker || !offer || !['item','pokemon'].includes(kind) ||
                !(Number(offer.compravelEm) > serverNow())) continue;
            const button=document.createElement('button');
            button.type='button';
            button.dataset.mothNativeSnatch=key;
            button.dataset.mothSnatchItem=String(Number(offer.itemId)||0);
            const syncButton=()=>{
                const active=state.snatchManual.has(key);
                button.className='moth-mw-btn moth-mw-snatch-button'+(active?' is-armed':'');
                button.textContent=tr(active?'Cancel snatch':'Snatch');
                button.setAttribute('aria-pressed',active?'true':'false');
                const hint=tr(active
                    ? 'Cancel the armed purchase for listing #{id}'
                    : 'Arm an automatic purchase for listing #{id} at its displayed maximum price', {id});
                button.setAttribute('aria-label',hint);
                button.title=hint;
            };
            button.style.marginInlineStart='0.4rem';
            button.addEventListener('click',event=>{
                event.preventDefault(); event.stopPropagation();
                const wasArmed=state.snatchManual.has(key);
                const accepted=snatchMark(kind,currency,id,Number(offer.itemId)||0);
                if (accepted) {
                    state.snatchNotice=tr(wasArmed?'Snatch cancelled for listing #{id}.':
                        'Snatch armed for listing #{id}.', {id});
                    syncButton();
                } else {
                    state.snatchNotice=tr('Could not arm this target; load a current listing first.');
                    addLog('Snatch not armed · load the listing again');
                }
            });
            syncButton();
            marker.insertAdjacentElement('afterend',button);
        }
    }

    function snatchQueueCounts() {
        let automatic = 0;
        for (const [key, entry] of state.snatchObserved) {
            if (!state.snatchManual.has(key) && activeRuleById(entry.ruleId)) automatic++;
        }
        return {manual: state.snatchManual.size, automatic};
    }

    function snatchDisplayStatus(target, observation) {
        if (!config.enabled) return {tone:'muted', text:tr('Moth Watch is disabled')};
        if (config.purchasesPaused) return {tone:'muted', text:tr('Purchases are paused')};
        // Snatch is explicitly allowed to retry after an ambiguous result.
        // Ordinary Buy remains protected from repeated unverified orders.
        if (!state.gameSocket || state.gameSocket.readyState !== 1)
            return {tone:'warning', text:tr('Waiting for game connection')};
        if (state.pendingBuy?.listingId === target.id)
            return {tone:'pending', text:tr('Purchase sent · awaiting server confirmation')};
        if (!observation) return {tone:'muted', text:tr('Recovering listing')};
        if (observation.releaseAt > serverNow()) {
            const seconds=Math.max(1,Math.ceil((observation.releaseAt-serverNow())/1000));
            return {tone:'held',text:tr('Unlocks in {seconds}s',{seconds})};
        }
        if (observation.releaseAt > 0 &&
            serverNow() < observation.releaseAt + SNATCH_WINDOW_MS) {
            const remaining = Math.max(1,Math.ceil(
                (observation.releaseAt + SNATCH_WINDOW_MS-serverNow())/1000));
            return {tone:'ready',text:tr('Snatch burst · {seconds}s left',{seconds:remaining})};
        }
        if (observation.needsVerification ||
            !observation.lastVerifiedAt ||
            Date.now()-observation.lastVerifiedAt >= 15000)
            return {tone:'pending',text:tr('Checking exact listing status')};
        const retry = Math.ceil((Number(observation.retryAt||0)-Date.now())/1000);
        if (retry>0) return {tone:'pending',text:tr('Next attempt in {seconds}s',{seconds:retry})};
        if (!freshQuote(observation.candidate,true,true) && !snatchReleaseQuote(observation.candidate))
            return {tone:'warning',text:tr('Refreshing listing evidence')};
        return {tone:'ready',text:tr('Competing for purchase')};
    }

    function snatchQueueHtml() {
        const own=[...state.snatchManual.entries()]
            .sort(([keyA],[keyB])=>
                Number(state.snatchObserved.get(keyA)?.releaseAt || Infinity) -
                Number(state.snatchObserved.get(keyB)?.releaseAt || Infinity))
            .slice(0,SNATCH_LIMIT);
        const automatic=[...state.snatchObserved.entries()]
            .filter(([key,entry])=>!state.snatchManual.has(key) && activeRuleById(entry.ruleId))
            .slice(0,SNATCH_LIMIT);
        if (!own.length && !automatic.length) return '<div class="moth-mw-snatch-empty" role="status">' +
            '<b>' + escapeHtml(tr('No snatches armed.')) + '</b><p>' +
            escapeHtml(tr('Use Snatch beside a held item or Pokémon listing, or enable a matching buying rule.')) +
            '</p></div>';
        const entryHtml = (key,target,observation,manual) => {
            const candidate = observation?.candidate;
            const status = snatchDisplayStatus(target, observation);
            const itemName = candidate?.name || (target.kind === 'item' && target.itemId
                ? catalogName(target.itemId) : tr(target.kind==='pokemon'?'Pokémon':'Items'));
            const attempts = Math.max(0,Number(observation?.attempts||0));
            return '<article class="moth-mw-snatch-entry">' +
                '<div class="moth-mw-snatch-entry-head"><b>' + escapeHtml(itemName) + '</b>' +
                '<span class="moth-mw-snatch-id">#' + num(target.id) + '</span></div>' +
                '<div class="moth-mw-snatch-entry-meta">' +
                '<span>' + escapeHtml(tr(target.kind==='pokemon'?'Pokémon':'Items')) + '</span>' +
                '<span>' + escapeHtml(tr('Maximum price:')) + ' ' + money(target.maxPrice,target.currency) + '</span>' +
                '<span>' + escapeHtml(manual ? tr('Player-marked') : tr('Buying rule')) + '</span></div>' +
                '<div class="moth-mw-snatch-entry-bottom"><span role="status" class="moth-mw-snatch-status" data-status="' +
                escapeHtml(status.tone) + '">' + escapeHtml(status.text) + '</span>' +
                (attempts ? '<span class="moth-mw-snatch-attempts">' +
                    escapeHtml(tr('Attempts: {count}',{count:num(attempts)})) + '</span>':'') +
                (manual ? snatchButton(target.kind,target.currency,target.id,target.itemId) :
                    '<span class="moth-mw-snatch-rule-note">' +
                    escapeHtml(tr('Managed by the buying rule')) + '</span>') +
                '</div></article>';
        };
        return '<div class="moth-mw-snatch-queue">' +
            (own.length ? '<section class="moth-mw-snatch-group"><h5>' +
                escapeHtml(tr('Player-marked targets')) + '</h5>' +
                own.map(([key,target])=>entryHtml(key,target,state.snatchObserved.get(key),true)).join('') +
                '</section>' : '') +
            (automatic.length ? '<section class="moth-mw-snatch-group"><h5>' +
                escapeHtml(tr('Rule-triggered targets')) + '</h5>' +
                automatic.map(([key,entry])=>entryHtml(key,{
                    kind:entry.candidate.kind,currency:entry.candidate.currency,
                    id:entry.candidate.listingId,itemId:entry.candidate.itemId,
                    maxPrice:entry.candidate.price
                },entry,false)).join('') + '</section>' : '') + '</div>';
    }

    function snatchButton(kind,currency,id,itemId=0) {
        if (!Number.isSafeInteger(Number(id)) || Number(id)<=0 || !['item','pokemon'].includes(kind))
            return '';
        const key = snatchKey(kind,currency,id);
        const active = state.snatchManual.has(key);
        const label = tr(active ? 'Cancel snatch' : 'Snatch');
        const explanation = tr(active
            ? 'Cancel the armed purchase for listing #{id}'
            : 'Arm an automatic purchase for listing #{id} at its displayed maximum price', {id});
        return '<button type="button" class="moth-mw-btn moth-mw-snatch-button' +
            (active ? ' is-armed' : '') + '" data-moth-snatch="' +
            escapeHtml(key) + '" data-moth-snatch-item="' + Number(itemId||0) +
            '" aria-pressed="' + (active?'true':'false') +
            '" aria-label="' + escapeHtml(explanation) +
            '" title="' + escapeHtml(explanation) + '">' +
            escapeHtml(label) + '</button>';
    }
