    function requestHistoryPage() {
        const fetch = state.historyFetch;
        if (!fetch) return;
        if (fetch.waitingSince && Date.now() - fetch.waitingSince < 12000) return;
        if (q('#cm-hist-corpo') || communityMarketIsOpen()) {
            setTimeout(requestHistoryPage, 1500);
            return;
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            setTimeout(requestHistoryPage, delay + 25);
            return;
        }

        const currency = fetch.currencies[fetch.currencyIndex];
        if (!marketReplyAvailable()) {
            setTimeout(requestHistoryPage, 600);
            return;
        }
        if (!sendBackground({
            t: 'market.historicoGlobal',
            pagina: fetch.page,
            tipo: 'pokemon',
            moeda: currency
        })) {
            setTimeout(requestHistoryPage, BACKGROUND_MIN_GAP_MS);
            return;
        }
        fetch.waitingSince = Date.now();
        setTimeout(() => {
            if (state.historyFetch === fetch && fetch.waitingSince &&
                Date.now() - fetch.waitingSince >= 12000) requestHistoryPage();
        }, 12100);
    }

    function gameIsLoading() {
        const loading = q('#carregando');
        if (!loading) return false;
        if (
            loading.hidden ||
            loading.classList.contains('hidden') ||
            loading.getAttribute('aria-hidden') === 'true'
        ) {
            return false;
        }
        return loading.getClientRects().length > 0;
    }

    function ensurePokemonHistory(force) {
        if (!config.scanPokemon) return;
        // Do not compete with the game's own boot-time data and asset loading.
        // The normal scan timer will retry after the loading overlay disappears.
        if (gameIsLoading()) {
            state.pokemonStatus = 'waiting for game';
            return;
        }
        if (state.historyFetch) return;

        const age = Date.now() - Number(state.pokemonReference.capturedAt || 0);
        const maxAge = Math.max(5, Number(config.pokemonHistoryRefreshMinutes || 60)) * 60 * 1000;
        if (!force && state.pokemonReference.capturedAt && age < maxAge) {
            state.pokemonStatus = 'history cached';
            return;
        }

        state.historyFetch = {
            currencies: ['gold', 'orb'],
            currencyIndex: 0,
            page: 0,
            working: new Map(),
            waitingSince: 0
        };
        state.pokemonStatus = 'loading history';
        requestHistoryPage();
        queueRender();
    }

    function handlePokemonHistory(message) {
        const fetch = state.historyFetch;
        if (!fetch || message.aba !== 'historicoGlobal' || !fetch.waitingSince ||
            Date.now() - fetch.waitingSince > 12000 ||
            (message.tipo && message.tipo !== 'pokemon') ||
            (message.pagina != null && Number(message.pagina) !== fetch.page) ||
            (message.moeda && message.moeda !== fetch.currencies[fetch.currencyIndex])) return false;

        const expectedCurrency = fetch.currencies[fetch.currencyIndex];
        const lines = Array.isArray(message.linhas) ? message.linhas : [];
        const foreign = lines.some(line =>
            line && line.tipo && line.tipo !== 'pokemon' ||
            line && line.moeda && line.moeda !== expectedCurrency
        );
        if (foreign || !Array.isArray(message.linhas) ||
            (!lines.length && (message.moeda !== expectedCurrency || Number(message.pagina) !== fetch.page)) ||
            (!message.moeda && lines.some(line => line?.moeda !== expectedCurrency))) return false;
        fetch.waitingSince = 0;

        for (const line of lines) addPokemonHistorySample(line, fetch.working);

        const maxPages = Math.max(1, Math.min(50, Number(config.pokemonHistoryPages || 12)));
        if (message.temMais && fetch.page + 1 < maxPages) {
            fetch.page++;
            setTimeout(requestHistoryPage, 100);
            return true;
        }

        if (fetch.currencyIndex + 1 < fetch.currencies.length) {
            fetch.currencyIndex++;
            fetch.page = 0;
            setTimeout(requestHistoryPage, 100);
            return true;
        }

        const working = fetch.working;
        state.historyFetch = null;
        finalizePokemonHistory(working);
        return true;
    }

    function recentPokemonRequest(currency, page = 0, order = 'recentes') {
        return {
            t: 'market.listar',
            tipo: 'pokemon',
            moeda: currency,
            busca: '',
            ordem: order,
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
            pagina: page,
            especieId: 0
        };
    }

    function startPokemonScan() {
        if ((!config.scanPokemon && !activePokemonRules().length) || state.pokemonScan) return;

        /*
         * Bot requests share the game's WebSocket. A background market.listar
         * response is also seen by PokéIdle's own handler and can redraw the
         * normal Pokémon market. Moth Watch may scan while its own panel hides
         * that view, but otherwise leave interactive browsing alone.
         */
        if (q('.cm-topo') && !state.watchOpen) {
            state.pokemonStatus = 'paused while browsing';
            return;
        }

        if (!state.pokemonReference.capturedAt && !activePokemonRules().length) {
            ensurePokemonHistory(false);
            return;
        }
        state.pokemonScan = {
            queue: [{currency: 'gold', page: 0}, {currency: 'orb', page: 0}],
            waiting: null,
            sentAt: 0,
            // A bounded page window avoids scanning hundreds of listings
            // and disturbing the game's own market interaction.
            maxPages: activePokemonRules().length ? 3 : 1
        };
        pumpPokemonScan();
    }

    function pumpPokemonScan() {
        const scan = state.pokemonScan;
        if (!scan || scan.waiting) return;
        if (communityMarketIsOpen() || (q('.cm-topo') && !state.watchOpen)) {
            state.pokemonScan = null;
            state.pokemonStatus = 'paused while browsing';
            return;
        }
        const job = scan.queue[0];
        if (!job) {
            state.pokemonScan = null;
            state.pokemonStatus = 'watching';
            queueRender();
            return;
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            setTimeout(pumpPokemonScan, delay + 25);
            return;
        }

        if (!marketReplyAvailable()) {
            setTimeout(pumpPokemonScan, 500);
            return;
        }
        if (!sendBackground(recentPokemonRequest(job.currency, job.page,
            activePokemonRules().length ? 'baratos' : 'recentes'))) {
            setTimeout(pumpPokemonScan, BACKGROUND_MIN_GAP_MS);
            return;
        }

        scan.queue.shift();
        state.marketReply = { kind: 'pokemon', currency: job.currency,
            page: job.page, sentAt: Date.now() };
        scan.waiting = job;
        scan.sentAt = Date.now();
        state.pokemonStatus = 'scanning ' + (job.currency === 'orb' ? 'gems' : 'coins');
        setTimeout(() => {
            if (state.pokemonScan === scan && scan.waiting === job && Date.now() - scan.sentAt >= 2500) {
                scan.waiting = null;
                pumpPokemonScan();
            }
        }, 2600);
    }

    // One outstanding vitrine scan at a time. An empty untyped response
    // cannot be safely attributed to the Pokémon or Diamond scanner.
    function marketReplyAvailable() {
        if (!state.marketReply) return true;
        if (Date.now() - state.marketReply.sentAt < 6500) return false;
        state.marketReply = null; // timeout is not evidence of an empty page
        return true;
    }

    function marketReplyMatches(message, kind) {
        const pending = state.marketReply;
        if (!pending || pending.kind !== kind || message.aba !== 'vitrine' ||
            communityMarketIsOpen()) return false;
        const rows = Array.isArray(message.linhas) ? message.linhas : null;
        if (!rows) return false;
        if (message.pagina != null && Number(message.pagina) !== pending.page) return false;
        if (message.moeda && message.moeda !== pending.currency) return false;
        if (message.tipo && message.tipo !== kind) return false;
        if (!rows.length) {
            // No row evidence: every discriminator must be explicit.
            return message.tipo === kind && message.moeda === pending.currency &&
                Number(message.pagina) === pending.page;
        }
        if (message.pagina == null && pending.page !== 0) return false;
        const shape = rows.every(row => row && (
            kind === 'pokemon'
                ? !!row.ficha && (!row.tipo || row.tipo === 'pokemon')
                : !row.ficha && row.itemId == null && (!row.tipo || row.tipo === 'diamante')
        ));
        const currency = !!message.moeda || rows.every(row => row.moeda === pending.currency);
        return shape && currency;
    }

    function handleDiamondListings(message) {
        const currency = state.marketReply?.currency;
        if (!currency || !marketReplyMatches(message, 'diamante')) return;
        state.marketReply = null;
        const lines = Array.isArray(message.linhas) ? message.linhas : [];

        if (message.mediaDiamante && typeof message.mediaDiamante === 'object') {
            state.liveDiamondAverages = message.mediaDiamante;
        }

        const activePrices = lines
            .map(listing => Number(listing && listing.preco))
            .filter(price => Number.isFinite(price) && price > 0);
        const avgRow = state.liveDiamondAverages
            ? state.liveDiamondAverages[currency]
            : null;
        let average = avgRow && Number(avgRow.media) > 0
            ? Number(avgRow.media)
            : 0;
        const samples = avgRow ? Math.max(0, Number(avgRow.unidades) || 0) : 0;
        let referenceSource = average > 0 ? 'live-7d' : 'none';

        /*
         * When three or more active offers exist, a lower active median caps
         * an inflated historical reference. Offers remain visible without history.
         */
        if (average > 0 && activePrices.length >= 3) {
            const activeMedian = median(activePrices);
            if (activeMedian > 0 && activeMedian < average) {
                average = activeMedian;
                referenceSource = 'active-median';
            }
        }

        const group = 'diamond:' + currency + ':';
        removeCandidateGroup(group);

        for (const listing of lines) {
            if (!listing || isOwnListing(listing)) continue;
            if (listing.moeda && listing.moeda !== currency) continue;

            const price = Number(listing.preco);
            const qty = Number(listing.qtd);
            if (!Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue;

            addCandidate({
                key: group + listing.id,
                kind: 'diamond',
                listingId: Number(listing.id),
                itemId: 0,
                name: 'Diamonds',
                currency: currency,
                price: price,
                average: average,
                samples: samples,
                referenceSource: referenceSource,
                ratio: average > 0 ? price / average : 1,
                qty: qty,
                seller: String(listing.vendedor || '—'),
                retainedUntil: retentionUntil(listing),
                firstSeenAt: Date.now(),
                seenAt: Date.now()
            });
        }

        state.diamondPendingCurrency = null;
        state.diamondPendingAt = 0;
        state.diamondStatus = 'live · ' + (currency === 'orb' ? 'Gems' : 'Coins');
        queueRender();
    }

    function handlePokemonListings(message) {
        const scan = state.pokemonScan;
        if (!scan || !scan.waiting || !marketReplyMatches(message, 'pokemon')) return false;
        const {currency, page} = scan.waiting;
        if (Number(message.pagina || 0) !== page ||
            (message.moeda && message.moeda !== currency) ||
            (message.tipo && message.tipo !== 'pokemon')) return false;
        const lines = Array.isArray(message.linhas) ? message.linhas : [];
        const looksLikeOurResponse = !lines.length || lines.every(a =>
            (!a.tipo || a.tipo === 'pokemon') &&
            (!a.moeda || a.moeda === currency)
        );
        if (!looksLikeOurResponse) return false;

        const older = page > 0 ? state.pokemonAutoOffers.get(currency)?.offers || [] : [];
        const uniqueOffers = new Map();
        for (const offer of [...older, ...lines]) {
            if (Number.isSafeInteger(Number(offer?.id))) uniqueOffers.set(Number(offer.id), offer);
        }
        state.pokemonAutoOffers.set(currency, {
            offers: Array.from(uniqueOffers.values()).slice(0, 300),
            updatedAt: Date.now()
        });
        const group = 'pokemon:' + currency + ':';
        if (page === 0) removeCandidateGroup(group);
        const scanRatio = discoveryRatio();

        for (const listing of lines) {
            if (!listing || !listing.ficha || isOwnListing(listing)) continue;
            if (!pokemonCurrencyAllowed(listing.ficha, currency)) continue;
            const price = Number(listing.preco);
            if (!Number.isSafeInteger(Number(listing.qtd)) || Number(listing.qtd) !== 1) continue;
            if (!Number.isFinite(price) || price <= 0) continue;

            const ref = pokemonReferenceFor(listing.ficha, currency);
            // An ungraded or overly broad comparator is context, never a bargain signal.
            if (!ref || !(ref.value > 0) || !ref.actionable) continue;

            const ratio = price / ref.value;
            if (ratio > scanRatio) continue;

            addCandidate({
                key: group + listing.id,
                kind: 'pokemon',
                listingId: Number(listing.id),
                pokemonId: Number(listing.pokemonId || listing.ficha.id || 0),
                ficha: listing.ficha,
                name: pokemonListingName(listing.ficha),
                currency: currency,
                price: price,
                unitPrice: Number(listing.preco),
                average: ref.value,
                arithmeticAverage: ref.average,
                samples: ref.samples,
                pokemonValuation: ref,
                ratio: ratio,
                qty: 1,
                seller: String(listing.vendedor || '—'),
                retainedUntil: retentionUntil(listing),
                firstSeenAt: Date.now(),
                seenAt: Date.now()
            });
        }

        state.marketReply = null;
        if (message.temMais === true && page + 1 < scan.maxPages) {
            scan.queue.push({currency, page: page + 1});
        }
        scan.waiting = null;
        setTimeout(pumpPokemonScan, 100);
        queueRender();
        return true;
    }
