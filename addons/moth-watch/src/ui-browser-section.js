    function renderItemInventory() {
        const entries = Object.entries(state.itemSummary || {})
            .map(([rawId, row]) => ({ itemId: Number(rawId), row: row || {}, name: catalogName(rawId) }))
            .filter(entry => Number.isFinite(entry.itemId) && entry.itemId > 0 && Number(entry.row.anuncios || 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

        const renderOffers = (entry, currency) => {
            const key = String(entry.itemId) + ':' + currency;
            if (state.selectedItemFocus?.key !== key) return '';
            const status = state.itemDetailStatus?.key === key ? state.itemDetailStatus.status : 'idle';
            const detail = state.itemOfferDetails.get(key);
            const queued = state.detailQueue.some(job => job.key === key) || state.detailQueued.has(key);
            const pending = state.detailPending?.key === key;
            const loading = status === 'loading' || queued || pending;
            const currencyName = tr(currency === 'orb' ? 'Gems' : 'Coins');
            let content = '';

            if (detail && detail.offers.length) {
                const offers = detail.offers.slice().sort((a, b) => {
                    const priceDiff = Number(a?.preco || 0) - Number(b?.preco || 0);
                    return priceDiff || Number(a?.id || 0) - Number(b?.id || 0);
                });
                content = '<div class="moth-mw-offer-list">' + offers.map(offer => {
                    const price = Number(offer && offer.preco);
                    if (!offer || !Number.isFinite(price) || price <= 0) return '';
                    const listingId = Number(offer.id);
                    const own = isOwnListing(offer);
                    // Direct Buy uses the quoted offer itself; a market
                    // opportunity is NOT required to buy available stock.
                    const qty = Math.max(1, Number(offer.qtd || 1));
                    const heldUntil = retentionUntil(offer);
                    const held = heldUntil > serverNow();
                    const snatch = !own && held && Number.isSafeInteger(listingId) && listingId > 0
                        ? snatchButton('item',currency,listingId,entry.itemId) : '';
                    const timerLabel = heldUntil > serverNow()
                        ? '<span class="moth-mw-offer-meta">' +
                            escapeHtml(tr('Held · {seconds}s', { seconds: Math.ceil((heldUntil-serverNow())/1000) })) +
                            '</span>' : '';
                    const action = own
                        ? '<span class="moth-mw-offer-meta">' + escapeHtml(tr('Own listing')) + '</span>'
                        : held ? ''
                        : Number.isSafeInteger(listingId) && listingId > 0
                            ? '<button type="button" class="moth-mw-btn primary" data-moth-offer-buy="' +
                                listingId + '" data-moth-offer-item="' + entry.itemId +
                                '" data-moth-offer-currency="' + currency + '">' +
                                escapeHtml(tr('Buy')) + '</button>'
                            : '';
                    return '<div class="moth-mw-offer-row">' +
                        '<span class="moth-mw-offer-seller" title="' + escapeHtml(String(offer.vendedor || '—')) + '">' + escapeHtml(String(offer.vendedor || '—')) + '</span>' +
                        '<span class="moth-mw-offer-meta">' + num(qty) + ' ' + escapeHtml(tr('units')) + '</span>' +
                        '<b>' + money(price, currency) + '</b>' +
                        '<span class="moth-mw-offer-meta moth-mw-offer-id">#' + (Number.isFinite(listingId) ? num(listingId) : '—') + '</span>' +
                        timerLabel + snatch + action + '</div>';
                }).filter(Boolean).join('') + '</div>';
            } else if (loading || status === 'idle') {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('Waiting for the market to return offers…')) + '</div>';
            } else if (status === 'timeout') {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('Market did not respond. Load offers again.')) + '</div>';
            } else {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('No offers found in this currency.')) + '</div>';
            }

            const statusText = loading && detail ? '<span>' + escapeHtml(tr('Refreshing offers…')) + '</span>' : '';
            return '<div class="moth-mw-item-offers">' +
                '<div class="moth-mw-item-offers-head"><b>' + escapeHtml(tr('Offers')) + ' · ' + escapeHtml(currencyName) +
                ' · ' + escapeHtml(tr('Offer count: {count}', { count: num(detail?.offers?.length || 0) })) + '</b>' +
                statusText +
                '<button type="button" class="moth-mw-btn" data-moth-hide-offers="1">' + escapeHtml(tr('Hide offers')) + '</button></div>' +
                content + '</div>';
        };

        const rows = entries.slice(0, 120).map(entry => {
            const row = entry.row, coinPrice = Number(row.minGold), gemPrice = Number(row.minOrb);
            const coinButton = Number.isFinite(coinPrice) && coinPrice > 0
                ? '<button type="button" class="moth-mw-btn" data-moth-item-scan="' + entry.itemId + '" data-moth-item-currency="gold">' + escapeHtml(tr('Load Coin offers')) + '</button>'
                : '<button type="button" class="moth-mw-btn" disabled>' + escapeHtml(tr('No Coin offers')) + '</button>';
            const gemButton = Number.isFinite(gemPrice) && gemPrice > 0
                ? '<button type="button" class="moth-mw-btn" data-moth-item-scan="' + entry.itemId + '" data-moth-item-currency="orb">' + escapeHtml(tr('Load Gem offers')) + '</button>'
                : '<button type="button" class="moth-mw-btn" disabled>' + escapeHtml(tr('No Gem offers')) + '</button>';
            const count = Number(row.anuncios) || 0;
            return '<div class="moth-mw-inventory-entry">' +
                '<div class="moth-mw-inventory-row"><div class="moth-mw-inventory-name"><b>' + escapeHtml(entry.name) + '</b><span>' +
                escapeHtml(tr(count === 1 ? '1 listing' : '{count} listings', { count: num(count) })) + '</span></div>' +
                '<div class="moth-mw-inventory-price">' + (coinPrice > 0 ? money(coinPrice, 'gold') : '<span class="moth-mw-meta">' + escapeHtml(tr('Coins')) + ' —</span>') +
                coinButton + '</div><div class="moth-mw-inventory-price">' +
                (gemPrice > 0 ? money(gemPrice, 'orb') : '<span class="moth-mw-meta">' + escapeHtml(tr('Gems')) + ' —</span>') + gemButton + '</div></div>' +
                renderOffers(entry, 'gold') + renderOffers(entry, 'orb') + '</div>';
        }).join('');
        const collapsed = Boolean(state.itemInventoryCollapsed);
        return '<div class="moth-mw-inventory"><div class="moth-mw-inventory-head">' +
            '<button type="button" class="moth-mw-inventory-toggle" id="moth-mw-inventory-toggle" aria-expanded="' + (!collapsed ? 'true' : 'false') + '">' +
            '<span class="moth-mw-inventory-chevron" aria-hidden="true">' + (collapsed ? '▸' : '▾') + '</span><b>' + escapeHtml(tr('Items for sale')) + '</b></button>' +
            '<span>' + num(entries.length) + ' ' + escapeHtml(tr(entries.length === 1 ? 'item type with active listings' : 'item types with active listings')) +
            (entries.length > 120 ? escapeHtml(tr(' · showing first {count}', { count: 120 })) : '') + '</span></div>' +
            '<div class="moth-mw-inventory-body" id="moth-mw-inventory-body"' + (collapsed ? ' hidden' : '') + '>' +
            '<div class="moth-mw-inventory-note">' + escapeHtml(tr('This summary shows the lowest active market price for every item. Use Load Coin/Gem offers to expand all current listings under the selected item. Loaded listings also remain available in Opportunities.')) + '</div>' +
            '<div class="moth-mw-inventory-list">' + (rows || '<div class="moth-mw-empty">' + escapeHtml(tr('No market item inventory has arrived yet.')) + '</div>') +
            '</div></div></div>';
    }

    // Inspection is pure/read-only: neither a median nor a preview can enable a
    // rule, change a spending limit, or submit a market.comprar request.
    function pokemonRulePreview(listing, currency) {
        const price = Number(listing?.preco);
        const results = [];
        for (const rule of sanitizePokemonBuyRules(config.pokemonBuyRules)) {
            if (rule.currency !== currency || !pokemonRuleMatches(rule, listing?.ficha, currency)) continue;
            let status = 'Rule paused';
            if (!rule.buyEnabled || !config.enabled || !config.fixedRulesEnabled ||
                config.purchasesPaused) status = 'Rule paused';
            else if (!Number.isSafeInteger(price) || price <= 0) status = 'Unverified listing price';
            else if (price > rule.buyMax) status = 'Above price ceiling';
            else if (typeof listing?.ficha?.shiny !== 'boolean' ||
                !Number.isSafeInteger(Number(listing?.ficha?.potencia)) ||
                Number(listing.ficha.potencia) < 1 || Number(listing.ficha.potencia) > 5)
                status = 'Unknown Pokémon traits';
            else if (!Number.isSafeInteger(Number(listing?.qtd)) || Number(listing.qtd) !== 1)
                status = 'Unverified quantity';
            else if (!Number.isSafeInteger(Number(listing?.id)) || Number(listing.id) <= 0)
                status = 'Unverified listing identity';
            else if (isOwnListing(listing)) status = 'Your own listing';
            else if (retentionUntil(listing) > serverNow()) status = 'Listing still held';
            else if (!state.orderJournal || unresolvedListing(Number(listing.id))) status = 'Awaiting reconciliation';
            else if (remainingBudget(currency, rule.id).spend < price) status = 'Budget blocked';
            else if (balanceFor(currency) - reserveFor(currency) < price)
                status = 'Insufficient spendable balance';
            else if (state.pendingBuy) status = 'Waiting for acknowledgement';
            else status = 'Matches absolute-price rule';
            results.push({ kind: rule.kind, status,
                buyMax: rule.buyMax, currency, ruleId: rule.id });
        }
        return results;
    }

    function pokemonEvidenceCard(listing, currency, observedAt) {
        const facts = pokemonFacts(listing?.ficha);
        const role = pokemonCombatRole(listing?.ficha);
        const ref = pokemonReferenceFor(listing?.ficha, currency);
        const price = Number(listing?.preco);
        const iv = facts.ivs;
        const flags = Object.entries(facts.traits).filter(([, flag]) => flag === true)
            .map(([name]) => tr(name));
        const unverifiedExtras = Object.values(facts.traits).some(value => value === null);
        const dateLabel = ref?.ageDays == null ? tr('Sale dates unverified')
            : tr('Newest comparable sale: {days} days ago', { days: ref.ageDays });
        const sourceLabel = ref
            ? tr('Completed sales · {count} matched of {total} · {confidence}', {
                count: num(ref.samples), total: num(ref.bucketSamples),
                confidence: tr(ref.confidence)
            }) : tr('Insufficient comparable sales');
        const priceLabel = ref
            ? tr('Median {median} · IQR {low}–{high} · P10–P90 {p10}–{p90}', {
                median: num(Math.round(ref.value)), low: num(Math.round(ref.low)),
                high: num(Math.round(ref.high)), p10: num(Math.round(ref.p10)),
                p90: num(Math.round(ref.p90))
            }) : tr('No defensible completed-sale price range');
        const roles = role.focus.length && iv
            ? role.focus.map(name => name.toUpperCase() + ' ' +
                (iv[{hp:0,atk:1,def:2,spAtk:3,spDef:4,speed:5}[name]] ?? '?')).join(' · ')
            : tr('Relevant IVs unknown');
        const preview = pokemonRulePreview(listing, currency);
        const ruleLabel = preview.length ? preview.map(row =>
            tr(row.kind === 'shiny' ? 'Shiny Pokémon' : row.kind === 'p5' ? 'P5 Pokémon' : 'Any Pokémon') +
            ': ' + tr(row.status) + ' (' + num(row.buyMax) + ')').join(' · ')
            : tr('No matching configured Pokémon rule');
        const age = Date.now() - observedAt;
        const status = Number.isFinite(age) && age >= 0 && age <= QUOTE_MAX_AGE_MS
            ? tr('Recent listing observation') : tr('Stale listing observation');
        const missing = facts.missing.length ? facts.missing.join(', ') : tr('None');
        const limitation = ref?.limitations?.length ? ref.limitations.map(key => tr(key)).join(', ') :
            tr('No verified completed-sale reference');
        const percent = ref && ref.value > 0 && Number.isFinite(price)
            ? tr('Asking/reference ratio: {percent}%', {
                percent: (100 * price / ref.value).toFixed(1)
            }) : tr('Asking/reference ratio unavailable');
        return '<article class="moth-mw-evidence-card"><h5>' +
            escapeHtml(pokemonListingName(listing?.ficha)) + '</h5>' +
            '<div class="moth-mw-evidence-meta"><b>' +
            (Number.isSafeInteger(price) && price > 0 ? money(price, currency) :
                escapeHtml(tr('Price unverified'))) + '</b> · ' + escapeHtml(status) + '</div>' +
            '<p>' + escapeHtml('N=' + (facts.score == null ? '?' : facts.score.toFixed(3)) +
                ' · P' + (facts.potency ?? '?') + ' · Q=' +
                (facts.quality == null ? '?' : facts.quality.toFixed(3)) +
                ' · IV ' + (iv ? iv.reduce((a,b)=>a+b,0) + '/192' : '?') +
                ' · ' + (facts.form == null ? tr('Form unknown') : 'Form ' + facts.form)) + '</p>' +
            '<p>' + escapeHtml(tr('Role: {role} ({source})', {
                role: tr(role.role), source: tr(role.source)
            })) + ' · ' + roles + '</p>' +
            '<p>' + escapeHtml(tr('Collectibles: {flags}', {
                flags: flags.length ? flags.join(', ') : tr('No confirmed flags')
            })) + (unverifiedExtras ? ' · ' + escapeHtml(tr('Other collectible flags unverified')) : '') + '</p>' +
            '<p><b>' + escapeHtml(sourceLabel) + '</b> · ' + escapeHtml(dateLabel) +
            (ref?.collectedAt ? ' · ' + escapeHtml(tr('History fetched: {date}', {
                date: new Date(ref.collectedAt).toLocaleString(currentLocale())
            })) : '') + '</p>' +
            '<p>' + escapeHtml(priceLabel) + ' · ' + escapeHtml(percent) + '</p>' +
            '<p>' + escapeHtml(tr('Role-comparable sales: {count} · relevant-IV difference: {gap}', {
                count: num(ref?.roleComparison?.observedRoleSales || 0),
                gap: ref?.roleComparison?.relevantIvGap == null ? '?' :
                    Number(ref.roleComparison.relevantIvGap).toFixed(1)
            })) + '</p>' +
            '<p>' + escapeHtml(tr('Comparison: {stage}', {
                stage: ref?.comparison ? tr(ref.comparison) : tr('None')
            })) + ' · ' + escapeHtml(tr('Limits: {details}', { details: limitation })) + '</p>' +
            '<p>' + escapeHtml(tr('Missing listing fields: {fields}', { fields: missing })) + '</p>' +
            '<p class="moth-mw-rule-hint">' + escapeHtml(tr('Rule preview (not permission): {preview}', {
                preview: ruleLabel
            })) + '</p>' +
            (retentionUntil(listing) > serverNow()
                ? snatchButton('pokemon',currency,Number(listing?.id)) : '') + '</article>';
    }

    function renderPokemonPriceEvidence() {
        const signature = JSON.stringify({
            language: currentLocale(),
            history: state.pokemonReference?.capturedAt,
            pages: ['gold','orb'].map(c => state.pokemonAutoOffers.get(c)?.updatedAt || 0),
            rules: config.pokemonBuyRules, enabled: config.enabled,
            fixed: config.fixedRulesEnabled, paused: config.purchasesPaused,
            pending: !!state.pendingBuy, unknown: unverifiedOrdersExist()
        });
        if (state.pokemonEvidenceMemo?.signature === signature &&
            Date.now() - state.pokemonEvidenceMemo.at < 2000) return state.pokemonEvidenceMemo.html;
        const offers = [];
        for (const currency of ['gold', 'orb']) {
            const record = state.pokemonAutoOffers.get(currency);
            if (!record || !Array.isArray(record.offers)) continue;
            for (const offer of record.offers.slice(0, 50)) {
                if (offer?.ficha) offers.push({ currency, offer, updatedAt: record.updatedAt });
            }
        }
        if (!offers.length) return '<div class="moth-mw-empty">' +
            escapeHtml(tr('No sampled Pokémon listings yet. Activate Pokémon Watch or scan now.')) +
            '</div>';
        return '<p class="moth-mw-evidence-intro">' +
            escapeHtml(tr('This is a bounded market sample, not every listing. Completed-sale evidence cannot authorize a purchase.')) +
            '</p>' + offers.slice(0, 60).map(({currency, offer, updatedAt}) =>
            pokemonEvidenceCard(offer, currency, updatedAt)).join('');
        state.pokemonEvidenceMemo = { signature, at: Date.now(), html };
        return html;
    }

    function renderCandidate(candidate) {
        const discount = Math.max(0, 1 - candidate.ratio);
        const retainedSeconds = candidate.retainedUntil > serverNow() ? Math.ceil((candidate.retainedUntil - serverNow()) / 1000) : 0;
        const attemptedUntil = Number(state.attemptedListings.get(candidate.listingId) || 0);
        const recentlyAttempted = attemptedUntil > Date.now();
        const canBuy = !state.pendingBuys?.has(candidate.listingId) && !config.purchasesPaused &&
            !unresolvedListing(candidate.listingId) && !recentlyAttempted && !retainedSeconds &&
            purchaseQuantity(candidate) > 0;
        const total = candidate.kind === 'item' || candidate.kind === 'diamond' ? candidate.price * candidate.qty : candidate.price;
        const pokemonIvs = candidate.kind === 'pokemon' ? pokemonIVs(candidate.ficha) : null;
        let referenceLabel;
        if (candidate.kind === 'item') {
            if (candidate.referenceSource === 'active-median') {
                referenceLabel = tr('Current market median · {count} listings', { count: num(candidate.activeReferenceListings) });
                if (candidate.serverAverage > candidate.average) referenceLabel += tr(' · server 7d avg {value} ignored', { value: num(Math.round(candidate.serverAverage)) });
            } else if (candidate.average > 0) {
                referenceLabel = tr(candidate.referenceSource === 'live-7d' ? 'live 7d avg / unit' : 'frozen fallback / unit') +
                    ' · ' + tr(candidate.samples === 1 ? '1 unit sold' : '{count} units sold', { count: num(candidate.samples) });
            } else referenceLabel = tr('no sale-price reference');
        } else if (candidate.kind === 'diamond') {
            referenceLabel = candidate.average > 0
                ? tr(candidate.referenceSource === 'active-median' ? 'active market median' : 'completed-sale reference') + ' · ' +
                    tr(candidate.samples === 1 ? '1 sale' : '{count} sales', { count: num(candidate.samples) })
                : tr('no completed-sale reference');
        } else referenceLabel = tr('comparable completed sales · {count}', { count: num(candidate.samples) }) +
            ' · ' + tr(candidate.pokemonValuation?.comparison || 'Broad species history only');

        const kind = candidate.kind === 'pokemon' ? tr('Pokémon') : candidate.kind === 'diamond' ? tr('Diamonds') : tr('Items');
        const quantityLabel = candidate.kind === 'diamond' ? tr('diamonds') : tr('units');
        const availableLabel = retainedSeconds ? tr('retained · {seconds}s', { seconds: retainedSeconds }) : tr('available');
        const buyLabel = config.purchasesPaused ? tr('Purchases paused') :
            unresolvedListing(candidate.listingId) ? tr('Unknown purchase outcome') :
            state.pendingBuy?.candidateKey === candidate.key ? tr('Buying…') :
            retainedSeconds ? tr('Wait') : recentlyAttempted ? tr('Tried recently') : tr('Buy');
        return '<div class="moth-mw-row">' +
            '<div class="moth-mw-name"><b><span class="moth-mw-kind">' + escapeHtml(kind) + '</span>' + escapeHtml(candidate.name) + '</b><span>' +
            ((candidate.kind === 'item' || candidate.kind === 'diamond')
                ? num(candidate.qty) + ' ' + escapeHtml(quantityLabel) + ' · ' + escapeHtml(tr('total')) + ' ' + num(total)
                : escapeHtml(tr('N={grade} · Q={quality} · {confidence} confidence', {
                    grade: pokemonScore(candidate.ficha) == null ? '?' : pokemonScore(candidate.ficha).toFixed(3),
                    quality: pokemonQuality(candidate.ficha) == null ? '?' : pokemonQuality(candidate.ficha).toFixed(3),
                    confidence: tr(candidate.pokemonValuation?.confidence || 'low')
                })) + ' · ' + escapeHtml(tr('sold-price middle range {low}–{high}', {
                    low: num(Math.round(candidate.pokemonValuation?.low || 0)),
                    high: num(Math.round(candidate.pokemonValuation?.high || 0))
                })) + (candidate.pokemonValuation?.missingIVs ? ' · ' + escapeHtml(tr('IV details unavailable')) : ''))
            + (pokemonIvs ? ' · ' + escapeHtml(tr('IV {total}/192 · ATK {atk} · Sp.Atk {spAtk} · Speed {speed}', {
                total: pokemonIvs.reduce((sum, iv) => sum + iv, 0),
                atk: pokemonIvs[1], spAtk: pokemonIvs[3], speed: pokemonIvs[5]
            })) : '')
            + '</span></div>' +
            '<div><div>' + money(candidate.price, candidate.currency) + '</div><div class="moth-mw-meta">' + escapeHtml(tr('listed')) +
            ((candidate.kind === 'item' || candidate.kind === 'diamond') && candidate.qty > 1 ? escapeHtml(tr(' / unit')) : '') + '</div></div>' +
            '<div class="moth-mw-ref"><div>' + money(Math.round(candidate.average), candidate.currency) + '</div><div class="moth-mw-meta">' + escapeHtml(referenceLabel) + '</div></div>' +
            '<div><div class="moth-mw-discount">−' + pct(discount) + '</div><div class="moth-mw-meta">' + escapeHtml(tr('watch range')) + '</div></div>' +
            '<div class="moth-mw-seller"><b>' + escapeHtml(tr('Seller: {seller}', { seller: candidate.seller })) + '</b><div class="moth-mw-meta">' + escapeHtml(availableLabel) + '</div></div>' +
            ((candidate.kind === 'item' || candidate.kind === 'pokemon') && retainedSeconds
                ? snatchButton(candidate.kind,candidate.currency,candidate.listingId,Number(candidate.itemId||0))
                : '') +
            '<button type="button" class="moth-mw-btn primary" data-moth-buy="' + escapeHtml(candidate.key) + '"' + (canBuy ? '' : ' disabled') + '>' +
            escapeHtml(buyLabel) + '</button></div>';
    }

    function updateCandidateRows(list, candidates) {
        if (!list) return;

        if (!candidates.length) {
            const empty = '<div class="moth-mw-empty">' +
                escapeHtml(tr('No matching opportunities. Try a wider watch threshold or inspect Market inventory.')) +
                '</div>';
            if (list.children.length !== 1 || !list.firstElementChild.classList.contains('moth-mw-empty') ||
                list.firstElementChild.outerHTML !== empty) {
                list.innerHTML = empty;
            }
            return;
        }

        const existing = new Map();
        for (const row of Array.from(list.children)) {
            const button = row.querySelector('[data-moth-buy]');
            const key = button?.dataset?.mothBuy;
            if (key && !existing.has(key)) {
                existing.set(key, row);
            } else {
                row.remove();
            }
        }

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const html = renderCandidate(candidate);
            const template = document.createElement('template');
            template.innerHTML = html.trim();
            const fresh = template.content.firstElementChild;
            if (!fresh) continue;

            let row = existing.get(candidate.key);
            if (!row) {
                row = fresh;
            } else {
                // Patch a row in place. In particular, preserve the Buy button
                // element/focus while its state changes to "Buying…" or "Tried recently".
                row.className = fresh.className;
                const oldChildren = Array.from(row.children);
                const newChildren = Array.from(fresh.children);
                if (oldChildren.length !== newChildren.length) {
                    row.innerHTML = fresh.innerHTML;
                } else {
                    for (let childIndex = 0; childIndex < oldChildren.length; childIndex += 1) {
                        const oldChild = oldChildren[childIndex];
                        const newChild = newChildren[childIndex];
                        if (oldChild.matches('[data-moth-buy]') && newChild.matches('[data-moth-buy]')) {
                            oldChild.className = newChild.className;
                            oldChild.disabled = newChild.disabled;
                            oldChild.dataset.mothBuy = newChild.dataset.mothBuy;
                            oldChild.textContent = newChild.textContent;
                            for (const attr of Array.from(oldChild.attributes)) {
                                if (!newChild.hasAttribute(attr.name) && attr.name !== 'data-moth-buy') {
                                    oldChild.removeAttribute(attr.name);
                                }
                            }
                            for (const attr of Array.from(newChild.attributes)) {
                                oldChild.setAttribute(attr.name, attr.value);
                            }
                        } else if (oldChild.innerHTML !== newChild.innerHTML) {
                            oldChild.innerHTML = newChild.innerHTML;
                        }
                    }
                }
            }

            const reference = list.children[index] || null;
            if (row !== reference) list.insertBefore(row, reference);
            existing.delete(candidate.key);
        }

        for (const row of existing.values()) row.remove();
    }

    function candidateVisible(candidate) {
        if (!candidate) return false;

        const currencyFilter = ['gold', 'orb'].includes(config.viewCurrency)
            ? config.viewCurrency
            : 'all';
        const kindFilter = ['item', 'pokemon', 'diamond'].includes(config.viewKind)
            ? config.viewKind
            : 'all';

        if (currencyFilter !== 'all' && candidate.currency !== currencyFilter) return false;
        if (kindFilter !== 'all' && candidate.kind !== kindFilter) return false;
        return true;
    }

    function candidateSort(a, b) {
        const mode = [
            'discount',
            'newest',
            'price-asc',
            'price-desc',
            'reference-desc',
            'quantity-desc',
            'name'
        ].includes(config.viewSort)
            ? config.viewSort
            : 'discount';

        /*
         * Raw Coin and Gem amounts are not comparable. For value-based sorts
         * with both currencies visible, keep currencies grouped first.
         */
        const currencyGroup = a.currency === b.currency
            ? 0
            : a.currency === 'gold' ? -1 : 1;

        if (mode === 'newest') {
            return Number(b.firstSeenAt || b.seenAt || 0) - Number(a.firstSeenAt || a.seenAt || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'price-asc') {
            return currencyGroup || Number(a.price || 0) - Number(b.price || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'price-desc') {
            return currencyGroup || Number(b.price || 0) - Number(a.price || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'reference-desc') {
            return currencyGroup || Number(b.average || 0) - Number(a.average || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'quantity-desc') {
            return Number(b.qty || 0) - Number(a.qty || 0) ||
                a.ratio - b.ratio ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'name') {
            return a.name.localeCompare(b.name) ||
                a.ratio - b.ratio;
        }

        return a.ratio - b.ratio ||
            Number(b.qty || 0) - Number(a.qty || 0) ||
            a.name.localeCompare(b.name);
    }

    function sortSelect() {
        const options = [
            ['discount', 'Biggest discount'], ['newest', 'Newest detected'], ['price-asc', 'Price: low → high'],
            ['price-desc', 'Price: high → low'], ['reference-desc', 'Reference: high → low'],
            ['quantity-desc', 'Quantity: high → low'], ['name', 'Name: A → Z']
        ];
        return '<label class="moth-mw-sort"><span class="moth-mw-filter-label">' + escapeHtml(tr('Sort')) + '</span><select id="moth-mw-sort">' +
            options.map(([value, label]) => '<option value="' + value + '"' + (config.viewSort === value ? ' selected' : '') + '>' +
                escapeHtml(tr(label)) + '</option>').join('') + '</select></label>';
    }
    function filterButton(label, group, value, active, icon) {
        return '<button type="button" class="moth-mw-filter' + (active ? ' on' : '') + '"' +
            ' data-moth-filter="' + escapeHtml(group) + '" data-moth-value="' + escapeHtml(value) + '"' +
            ' aria-pressed="' + (active ? 'true' : 'false') + '">' +
            (icon ? '<img src="' + escapeHtml(icon) + '" alt="">' : '') + escapeHtml(tr(label)) + '</button>';
    }



    function setAutomationNotice(text, kind = 'info') {
        state.automationNotice = { text: String(text || ''), kind, at: Date.now() };
        // Inline feedback stays visible next to the action that was just clicked.
        // The global notice at the top of this long page can be off-screen.
        const active = document.activeElement;
        const card = active?.closest?.('.moth-mw-rule-add-card');
        if (card) {
            let feedback = card.querySelector('.moth-mw-rule-inline-feedback');
            if (!feedback) {
                feedback = document.createElement('p');
                feedback.className = 'moth-mw-rule-notice moth-mw-rule-inline-feedback';
                feedback.setAttribute('role', 'status');
                feedback.setAttribute('aria-live', 'polite');
                card.appendChild(feedback);
            }
            feedback.className = 'moth-mw-rule-notice moth-mw-rule-inline-feedback ' + kind;
            feedback.textContent = String(text || '');
        }
        queueRender();
        setTimeout(() => {
            if (state.automationNotice && Date.now() - state.automationNotice.at >= 4200) {
                state.automationNotice = null;
                queueRender();
            }
        }, 4300);
    }

    function automationNoticeHtml() {
        const n = state.automationNotice;
        if (!n?.text) return '<div class="moth-mw-rule-notice" id="moth-mw-rule-notice" hidden></div>';
        return '<div class="moth-mw-rule-notice ' + escapeHtml(n.kind || 'info') +
            '" id="moth-mw-rule-notice" role="status">' + escapeHtml(n.text) + '</div>';
    }

    function fixedAutomationActiveCount() {
        if (!config.enabled || !config.fixedRulesEnabled) return 0;
        return sanitizeFixedItemRules(config.fixedItemRules)
            .filter(rule => rule.buyEnabled && rule.buyMax > 0).length +
            activeAnyItemRules().length + activePokemonRules().length;
    }

    function automationOverviewSummary() {
        const status = config.purchasesPaused ? 'Purchases paused'
            : fixedAutomationActiveCount() ? 'ON' : 'OFF';
        return tr('Rule-based buying: {status}', { status: tr(status) });
    }

    function automationStatusPanelHtml() {
        const active = fixedAutomationActiveCount();
        const unknown = (state.orderJournal?.orders || []).filter(o => o.status === 'unknown').length;
        const sessCoins = orderExposure('session', 'gold').spent;
        const sessGems = orderExposure('session', 'orb').spent;
        const dayCoins = orderExposure('day', 'gold').spent;
        const dayGems = orderExposure('day', 'orb').spent;
        return '<section class="moth-mw-automation-status" id="moth-mw-automation-status">' +
            '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Rule-based buying')) + '</h4><span>' +
            escapeHtml(active ? tr(active === 1 ? '{count} active rule' : '{count} active rules', { count: num(active) }) :
                tr('No automatic purchases enabled.')) + '</span></div>' +
            '<p class="moth-mw-rule-hint">' +
            escapeHtml(tr('Enable rule-based buying and at least one Buy rule with a maximum unit price. No other buying switches are required. Coin/Gem reserves and per-purchase caps still apply.')) +
            '</p><p class="moth-mw-rule-hint">' + escapeHtml(tr('Session exposure: {gold} Coins · {orb} Gems', { gold: num(sessCoins), orb: num(sessGems) })) +
            ' · ' + escapeHtml(tr('Daily exposure: {gold} Coins · {orb} Gems', { gold: num(dayCoins), orb: num(dayGems) })) +
            '</p>' + (unknown ? '<p class="moth-mw-budget-warning">' + escapeHtml(tr('Unverified orders: {count}', { count: num(unknown) })) +
            ' · ' + escapeHtml(tr('The affected listings remain blocked until authoritative reconciliation; other rules continue monitoring.')) + '</p>' : '') +
            '</section>';
    }

    function refreshAutomationLive(content) {
        if (!content) return;
        const statusHost = q('#moth-mw-automation-status', content);
        if (statusHost) {
            const tpl = document.createElement('template');
            tpl.innerHTML = automationStatusPanelHtml().trim();
            const fresh = tpl.content.firstElementChild;
            if (fresh && statusHost.innerHTML !== fresh.innerHTML) statusHost.innerHTML = fresh.innerHTML;
        }
        const fixed = new Map(sanitizeFixedItemRules(config.fixedItemRules).map(r => [r.id, r]));
        const broad = new Map(sanitizeAnyItemRules(config.anyItemRules).map(r => [r.id, r]));
        const pokemon = new Map(sanitizePokemonBuyRules(config.pokemonBuyRules).map(r => [r.id, r]));
        for (const node of qa('[data-moth-rule-status]', content)) {
            const type = node.dataset.ruleType, id = node.dataset.ruleId;
            const rule = type === 'fixed' ? fixed.get(id) : type === 'any' ? broad.get(id) : pokemon.get(id);
            if (!rule) continue;
            const next = type === 'fixed' ? fixedRuleStatus(rule) : categoryRuleStatus(rule, type);
            if (node.textContent !== next) node.textContent = next;
        }
        const host = q('#moth-mw-rule-notice', content), n = state.automationNotice;
        if (host) {
            if (!n?.text) {
                host.hidden = true; host.textContent = ''; host.className = 'moth-mw-rule-notice';
            } else {
                host.hidden = false; host.className = 'moth-mw-rule-notice ' + (n.kind || 'info'); host.textContent = n.text;
            }
        }
    }

    function filterAutomationItemSelect(input, select) {
        if (!input || !select) return;
        const term = normalize(input.value);
        let first = null;
        for (const option of Array.from(select.options)) {
            const visible = !term || normalize(option.textContent).includes(term);
            option.hidden = !visible;
            if (visible && !first && option.value) first = option;
        }
        if (select.selectedOptions?.[0]?.hidden && first) select.value = first.value;
    }

    function newAutomationRuleId(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 100000).toString(36);
    }

    function automationItemIds() {
        const ids = new Set();
        for (const id of state.catalog.keys()) if (Number(id) > 0) ids.add(Number(id));
        for (const id of Object.keys(state.itemSummary || {})) if (Number(id) > 0) ids.add(Number(id));
        return Array.from(ids).sort((a, b) => catalogName(a).localeCompare(catalogName(b), currentLocale()));
    }

    function automationItemOptions(selected = 0) {
        const ids = automationItemIds();
        if (!ids.length) return '<option value="">' + escapeHtml(tr('Market catalog is not loaded yet.')) + '</option>';
        return ids.map(itemId =>
            '<option value="' + itemId + '"' + (Number(selected) === itemId ? ' selected' : '') + '>' +
            escapeHtml(catalogName(itemId)) + '</option>'
        ).join('');
    }

    // Checking/confirming a newly activated broad rule changes no legacy
    // authorization; persisted options remain exactly as configured.
