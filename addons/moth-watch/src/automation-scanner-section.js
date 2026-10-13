    function finishPendingBuy(reason, listingId = state.pendingBuy?.listingId, expected = null) {
        const queue = state.pendingBuys?.get(Number(listingId));
        const pending = expected || queue?.[0] ||
            (state.pendingBuy?.listingId === Number(listingId) ? state.pendingBuy : null);
        if (!pending || expected && queue && !queue.includes(expected)) return;
        if (queue) {
            queue.splice(queue.indexOf(pending), 1);
            if (!queue.length) state.pendingBuys.delete(Number(listingId));
            state.pendingBuy = [...state.pendingBuys.values()][0]?.[0] || null;
        } else state.pendingBuy = null;
        const status = reason === 'server-confirmed' ? 'confirmed' :
            reason === 'refused' ? 'refused' : 'unknown';
        settleOrder(pending.order, status);
        diagnosticOutcome(status);
        if (status === 'confirmed') {
            state.candidates.delete(pending.candidateKey);
            state.itemInventoryMemo = null;
        }
        // A confirmed order can expose another eligible listing immediately.
        // Refresh just that market rather than enqueueing a full summary and
        // Pokémon scan after every purchase (which starved rule detail traffic).
        if (status === 'confirmed' && !snatchCriticalWindow() && hasAnyBuyingRules()) {
            if (pending.kind === 'item' && pending.itemId > 0) {
                const key = pending.itemId + ':' + pending.currency;
                state.ruleItemKeys.add(key);
                state.lastDetailRequest.delete(key);
                queueItemDetail(pending.itemId, pending.currency);
            } else if (pending.kind === 'pokemon' && activePokemonRules().length) {
                setTimeout(startPokemonScan, 250);
            }
        }
        queueRender();
        if (reason !== 'disconnect' && reason !== 'account-refresh' &&
            hasAnyBuyingRules() && !config.purchasesPaused) {
            // Do not wait for the next one-second scanner tick after a server
            // acknowledgement. Give any just-unlocked Snatch the first chance,
            // then immediately buy the next distinct eligible listing.
            setTimeout(() => {
                if (state.snatchObserved?.size) snatchTick();
                runMarketAutomation(true);
            }, 0);
        }
    }

    function requestItemSummary(forceForAutomation = false) {
        if (!config.enabled || (!config.scanItems && !forceForAutomation)) return false;

        const delay = backgroundDelayMs();
        if (delay > 0) {
            state.itemStatus = 'queued';
            if (!state.itemSummaryRetryTimer) {
                state.itemSummaryRetryTimer = setTimeout(() => {
                    state.itemSummaryRetryTimer = null;
                    requestItemSummary(forceForAutomation);
                }, delay + 25);
            }
            return true;
        }

        state.itemStatus = 'scanning';
        return sendBackground({ t: 'market.itens' });
    }

    function communityMarketIsOpen() {
        const list = q('#cm-lista');
        if (!list) return false;

        const modal = q('#modal');
        if (!modal || modal.classList.contains('hidden')) return false;

        const shell = q('#modal .modal-caixa');
        if (shell && shell.dataset.modal && shell.dataset.modal !== 'community') return false;

        // Moth Watch reuses the market modal shell. Do not let background diamond
        // requests repaint the native market while the Watch panel is active.
        if (q('#modal-corpo.moth-watch-active') || q('.cm-corpo.moth-watch-active')) {
            return false;
        }
        return true;
    }

    function requestDiamondListings() {
        if (!config.enabled || !config.scanDiamonds) {
            state.diamondStatus = 'disabled';
            return false;
        }
        if (gameIsLoading() || communityMarketIsOpen() || !marketReplyAvailable()) return false;
        if (!state.socket || state.socket.readyState !== 1) return false;

        const now = Date.now();
        if (state.diamondPendingCurrency) {
            if (now - Number(state.diamondPendingAt || 0) < 15000) return false;
            state.diamondPendingCurrency = null;
            state.diamondPendingAt = 0;
            state.diamondStatus = 'retrying after timeout';
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            if (!state.diamondScanTimer) {
                state.diamondScanTimer = setTimeout(() => {
                    state.diamondScanTimer = null;
                    requestDiamondListings();
                }, delay + 25);
            }
            return true;
        }

        const currency = state.nextDiamondCurrency === 'orb' ? 'orb' : 'gold';
        const sent = sendBackground({
            t: 'market.listar',
            tipo: 'diamante',
            moeda: currency,
            busca: '',
            ordem: 'baratos',
            criterios: [],
            elemento: '',
            categoria: '',
            soShiny: false,
            soP5: false,
            soTmElemental: false,
            soTmAoe: false,
            semOutland: false,
            nivelMin: '',
            nivelMax: '',
            potenciaMin: '',
            potenciaMax: '',
            ivMin: '',
            ivMax: '',
            qualidadeMin: '',
            qualidadeMax: '',
            notaMin: '',
            notaMax: '',
            pagina: 0,
            especieId: 0
        });

        if (sent) {
            state.diamondPendingCurrency = currency;
            state.diamondPendingAt = Date.now();
            state.marketReply = { kind: 'diamante', currency, page: 0, sentAt: Date.now() };
            state.nextDiamondCurrency = currency === 'gold' ? 'orb' : 'gold';
            state.diamondStatus = 'scanning · ' + (currency === 'orb' ? 'Gems' : 'Coins');
        }
        return sent;
    }


    function automationDetail(itemId, currency) {
        const key = String(itemId) + ':' + currency;
        state.ruleItemKeys.add(key);
        const detail = state.itemOfferDetails.get(key);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > RULE_DETAIL_REFRESH_MS) queueItemDetail(itemId, currency);
        return detail;
    }

    function fixedRuleCandidate(rule) {
        const detail = state.itemOfferDetails.get(String(rule.itemId) + ':' + rule.currency);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > 45000) return null;
        // Read listings directly, bypassing the opportunity/reference-% filters.
        const available = detail.offers.filter(offer => {
            const id = Number(offer?.id), price = Number(offer?.preco);
            return Number.isSafeInteger(id) && id > 0 &&
                Number.isFinite(price) && price > 0 && price <= rule.buyMax &&
                Number.isSafeInteger(Number(offer.qtd)) && Number(offer.qtd) > 0 &&
                !isOwnListing(offer) && !unresolvedListing(id) &&
                !(retentionUntil(offer) > serverNow()) &&
                Number(state.attemptedListings.get(id) || 0) <= Date.now();
        }).sort((a, b) => Number(a.preco) - Number(b.preco) || Number(a.id) - Number(b.id));
        const offer = available[0];
        if (!offer) return null;
        const ref = itemReference(rule.itemId, rule.currency);
        const average = Number(ref?.average || 0);
        return {
            key: 'rule:' + rule.itemId + ':' + rule.currency + ':' + offer.id,
            kind: 'item', listingId: Number(offer.id), itemId: rule.itemId,
            name: catalogName(rule.itemId), currency: rule.currency,
            price: Number(offer.preco), qty: Number(offer.qtd),
            seller: String(offer.vendedor || ''), seenAt: detail.updatedAt,
            average, ratio: average > 0 ? Number(offer.preco) / average : 1,
            retainedUntil: retentionUntil(offer)
        };
    }


    // Summary minima only nominate item types; only fresh offer details
    // authorize an actual order.
    function anyItemRuleTargets(rules) {
        const signature = JSON.stringify(rules.map(r => [r.currency, r.buyMax]));
        const cached = state.anyItemTargetsCache;
        if (cached && cached.summaryAt === state.itemSummaryAt &&
            cached.signature === signature && Date.now() - cached.at < 30000) return cached.targets;
        const targets = [];
        for (const [key, row] of Object.entries(state.itemSummary || {})) {
            const itemId = Number(key);
            if (!Number.isSafeInteger(itemId) || itemId <= 0 || !row?.anuncios) continue;
            for (const currency of ['gold', 'orb']) {
                const minimum = Number(currency === 'orb' ? row.minOrb : row.minGold);
                if (!Number.isFinite(minimum) || minimum <= 0) continue;
                if (rules.some(rule => rule.currency === currency && minimum <= rule.buyMax)) {
                    targets.push({ itemId, currency, key: itemId + ':' + currency, minimum });
                }
            }
        }
        targets.sort((a, b) => a.minimum - b.minimum || a.itemId - b.itemId);
        state.anyItemTargetsCache = { targets, signature, summaryAt: state.itemSummaryAt, at: Date.now() };
        return targets;
    }

    function anyItemRuleCandidate(rule, targets) {
        let best = null;
        for (const target of targets) {
            if (target.currency !== rule.currency || target.minimum > rule.buyMax) continue;
            const candidate = fixedRuleCandidate({
                itemId: target.itemId, currency: rule.currency, buyMax: rule.buyMax
            });
            if (candidate && (!best || candidate.price < best.price ||
                (candidate.price === best.price && candidate.listingId < best.listingId))) {
                best = candidate;
            }
        }
        return best;
    }

    function pokemonRuleMatches(rule, ficha, currency) {
        if (!ficha || !rule || rule.currency !== currency ||
            !pokemonCurrencyAllowed(ficha, currency)) return false;
        if (rule.kind === 'shiny') return ficha.shiny === true && currency === 'orb';
        if (rule.kind === 'p5') return Number(ficha.potencia) === 5;
        return rule.kind === 'any';
    }

    function pokemonRuleCandidate(rule) {
        const record = state.pokemonAutoOffers.get(rule.currency);
        if (!record || Date.now() - record.updatedAt > 45000) return null;
        let best = null;
        for (const listing of record.offers) {
            const id = Number(listing?.id), unitPrice = Number(listing?.preco);
            if (!Number.isSafeInteger(id) || id <= 0 ||
                !Number.isSafeInteger(unitPrice) || unitPrice <= 0 ||
                unitPrice > rule.buyMax || Number(listing.qtd || 1) !== 1 ||
                !pokemonRuleMatches(rule, listing.ficha, rule.currency) ||
                typeof listing.ficha.shiny !== 'boolean' ||
                !Number.isSafeInteger(Number(listing.ficha.potencia)) ||
                Number(listing.ficha.potencia) < 1 || Number(listing.ficha.potencia) > 5 ||
                isOwnListing(listing) || unresolvedListing(id) ||
                retentionUntil(listing) > serverNow() ||
                Number(state.attemptedListings.get(id) || 0) > Date.now()) continue;
            if (!best || unitPrice < best.price || (unitPrice === best.price && id < best.listingId)) {
                best = {
                    key: 'rule:pokemon:' + id,
                    kind: 'pokemon', listingId: id,
                    pokemonId: Number(listing.pokemonId || listing.ficha.id || 0),
                    ficha: listing.ficha, name: pokemonListingName(listing.ficha),
                    currency: rule.currency, price: unitPrice, unitPrice, qty: 1,
                    average: 0, ratio: 1, retainedUntil: retentionUntil(listing),
                    seller: String(listing.vendedor || ''), seenAt: record.updatedAt
                };
            }
        }
        return best;
    }

    function runMarketAutomation(justSettled = false) {
        if (!hasAnyBuyingRules() || gameIsLoading()) {
            state.ruleItemKeys.clear();
            return;
        }
        if (!state.socket || state.socket.readyState !== 1) return;
        // A hidden native-market sheet may remain mounted in #modal. Its
        // mere DOM presence must not disable all background automation.
        // Browsing the native market must not pause authorized purchases.
        // Only background requests that could repaint it are restricted.
        if (config.purchasesPaused) return;
        const now = Date.now();
        if (!justSettled && now - Number(state.automationLastRunAt || 0) < 250) return;
        state.automationLastRunAt = now;
        const fixed = sanitizeFixedItemRules(config.fixedItemRules)
            .filter(rule => rule.buyEnabled && rule.buyMax > 0);
        const broad = activeAnyItemRules();
        const pokemon = activePokemonRules();
        const targets = anyItemRuleTargets(broad);
        state.ruleItemKeys = new Set([
            ...fixed.map(rule => rule.itemId + ':' + rule.currency),
            ...state.detailQueue.map(job => job.key),
            ...(state.detailPending ? [state.detailPending.key] : [])
        ]);
        for (const rule of fixed) automationDetail(rule.itemId, rule.currency);
        if (broad.length && targets.length && state.detailQueue.length + (state.detailPending ? 1 : 0) < 12) {
            let count = 0;
            while (count < Math.min(8, targets.length)) {
                const target = targets[state.anyItemScanCursor % targets.length];
                state.anyItemScanCursor = (state.anyItemScanCursor + 1) % targets.length;
                count++;
                automationDetail(target.itemId, target.currency);
            }
        }
        // Ordinary buying is not paused by Snatch's short background-traffic
        // quiet window. A due Snatch gets priority after each acknowledged buy.
        // The bounded in-flight queue shares balances, reserves, caps and
        // listing-specific cooldowns. Do not block on unrelated acknowledgements.
        for (const rule of fixed) {
            const candidate = fixedRuleCandidate(rule);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
        for (const rule of broad) {
            const candidate = anyItemRuleCandidate(rule, targets);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
        for (const rule of pokemon) {
            const candidate = pokemonRuleCandidate(rule);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
    }

    function runScan(force) {
        if (!config.enabled) return;
        // The game opens its WebSocket before the client finishes booting.
        // Wait for the loading overlay to disappear before sending market scans.
        if (gameIsLoading()) {
            state.itemStatus = 'waiting for game';
            state.pokemonStatus = 'waiting for game';
            return;
        }
        if (!state.socket || state.socket.readyState !== 1) return;

        const now = Date.now();
        const userInterval = Math.max(1, Number(config.scanSeconds || 5)) * 1000;
        // Only slow general scans in closed-panel buying mode. User-selected
        // scan frequency and manual scan commands stay intact otherwise.
        const interval = !state.watchOpen && hasAnyBuyingRules()
            ? Math.max(userInterval, BACKGROUND_SCAN_WITH_RULES_MS)
            : userInterval;
        if (!force && now - state.lastScanAt < interval) return;
        state.lastScanAt = now;

        if (config.scanItems || activeAnyItemRules().length) requestItemSummary(activeAnyItemRules().length > 0);
        if (config.scanPokemon) ensurePokemonHistory(false);
        if (config.scanPokemon || activePokemonRules().length) startPokemonScan();
        if (config.scanDiamonds) requestDiamondListings();

        pruneCandidates();
        queueRender();
    }

    function pruneCandidates() {
        const cutoff = Date.now() - Math.max(30000, Number(config.scanSeconds || 5) * 6000);
        const nowServer = serverNow();
        for (const [key, candidate] of state.candidates) {
            if (candidate.retainedUntil && candidate.retainedUntil > nowServer) continue;
            if (candidate.seenAt < cutoff) {
                state.candidates.delete(key);
                state.itemInventoryMemo = null;
            }
        }
        pruneDetailCache();
        for (const [id, until] of state.attemptedListings) {
            if (until < Date.now()) state.attemptedListings.delete(id);
        }
        for (const [key, seen] of state.firstSeenCache) {
            if (nowServer - Number(seen.lastSeenAt || 0) > 60 * 60 * 1000) state.firstSeenCache.delete(key);
        }
    }
