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


    // This is a mathematical comparison, not a historical-price prediction.
    function pokemonValuationExplanation(ref) {
        if (!ref) return escapeHtml(tr('A monetary estimate needs at least one price for this species in the same currency. The relative math alone has no Coin or Gem unit.'));
        return escapeHtml(tr('Relative valuation from {asks} live asking prices and {sales} older completed sales of this species.', {
            asks: num(ref.currentCount), sales: num(ref.saleCount)
        })) + ' ' + escapeHtml(tr('Model index: {factor}', {
            factor: ref.index.toFixed(2)
        })) + '. ' + escapeHtml(ref.method) +
            (ref.assumed.length ? ' ' + escapeHtml(tr('Assumed/unknown: {fields}', {
                fields: ref.assumed.join(', ')
            })) : '');
    }

    function pokemonValueLabel(ficha, currency, excludeListingId = null) {
        if (currency === 'gold' && ficha?.shiny === true)
            return '<b>—</b><small>' + escapeHtml(tr('Shiny Pokémon use Gems only.')) + '</small>';
        const ref = pokemonRelativeValue(ficha, currency, excludeListingId);
        if (!ref) return '<b>—</b><small>' +
            escapeHtml(tr('No same-currency species price anchor yet.')) + '</small>';
        return '<strong>' + money(ref.value, currency) + '</strong>' +
            '<small>' + escapeHtml(tr('Model range: {low}–{high}', {
                low: num(ref.low), high: num(ref.high)
            })) + '</small><small>' +
            escapeHtml(tr('Relative estimate · {asks} market listings · {sales} sales', {
                asks: num(ref.currentCount), sales: num(ref.saleCount)
            })) + '</small>' +
            '<small>' + escapeHtml(tr(ref.confidence === 'modeled'
                ? 'Stat-adjusted market model; not a guaranteed sale price'
                : 'Rough estimate; some stats or comparable prices are missing')) + '</small>';
    }

    function pokemonEvidenceCard(listing, currency, observedAt) {
        const ficha = listing?.ficha;
        const ref = pokemonRelativeValue(ficha, currency, listing?.id);
        const price = Number(listing?.preco);
        const validPrice = Number.isSafeInteger(price) && price > 0;
        const delta = ref?.value > 0 && validPrice
            ? Math.round(100 * (price / ref.value - 1)) : null;
        const fresh = Date.now() - observedAt <= QUOTE_MAX_AGE_MS;
        return '<article class="moth-mw-evidence-card"><h5>' +
            escapeHtml(pokemonListingName(ficha)) + '</h5>' +
            '<p class="moth-mw-evidence-meta">' +
            escapeHtml(tr('Market asking price')) + ': ' +
            (validPrice ? money(price, currency) : escapeHtml(tr('Unknown'))) +
            ' · ' + escapeHtml(tr(fresh ? 'Recent listing observation' : 'Stale listing observation')) + '</p>' +
            '<div class="moth-mw-value-output"><span>' +
            escapeHtml(tr('Estimated sale value')) + '</span>' +
            pokemonValueLabel(ficha, currency, listing?.id) + '</div>' +
            (delta == null ? '' : '<p>' + escapeHtml(tr('Asking price is {percent}% {direction} the estimate', {
                percent: num(Math.abs(delta)), direction: tr(delta > 0 ? 'above' : delta < 0 ? 'below' : 'from')
            })) + '</p>') +
            '<details class="moth-mw-value-details"><summary>' + escapeHtml(tr('How was this valued?')) + '</summary>' +
            '<p>' + pokemonValuationExplanation(ref) + '</p>' +
            '<p>' + escapeHtml(tr('Potency, grade, quality, combat IVs and level adjust relative value; live asks anchor the currency. Estimates are heuristic, not transaction guarantees.')) + '</p>' +
            '<p>' + escapeHtml(tr('Missing fields: {fields}', {
                fields: pokemonFacts(ficha).missing.join(', ') || tr('None')
            })) + '</p>' +
            '<p>' + escapeHtml(tr('Rule preview (not permission): {preview}', {
                preview: pokemonRulePreview(listing, currency).map(row => row.status).join(', ') ||
                    tr('No matching configured Pokémon rule')
            })) + '</p></details>' +
            (retentionUntil(listing) > serverNow()
                ? snatchButton('pokemon',currency,Number(listing?.id)) : '') +
            '</article>';
    }

    function renderPokemonPriceEvidence() {
        const signature = JSON.stringify({
            locale: currentLocale(), history: state.pokemonReference?.capturedAt,
            listings: ['gold','orb'].map(currency => state.pokemonAutoOffers.get(currency)?.updatedAt || 0),
            samples: config.minPokemonSamples
        });
        if (state.pokemonEvidenceMemo?.signature === signature &&
            Date.now() - state.pokemonEvidenceMemo.at < 2000) return state.pokemonEvidenceMemo.html;
        const offers = [];
        for (const currency of ['gold', 'orb']) {
            const record = state.pokemonAutoOffers.get(currency);
            if (!Array.isArray(record?.offers)) continue;
            for (const offer of record.offers.slice(0, 35))
                if (offer?.ficha) offers.push({currency, offer, updatedAt:record.updatedAt});
        }
        const html = offers.length
            ? offers.slice(0, 50).map(({currency, offer, updatedAt}) =>
                pokemonEvidenceCard(offer, currency, updatedAt)).join('')
            : '<div class="moth-mw-empty">' +
                escapeHtml(tr('No sampled Pokémon listings yet. Scan Pokémon to see example valuations. You can also use Moth valuation directly on a Pokémon sheet.')) +
                '</div>';
        state.pokemonEvidenceMemo = {signature, at:Date.now(), html};
        return html;
    }

    // Read only facts that the visible game sheet explicitly supplies, or
    // facts from the exact market offer if a Pokémon id matches. If a sheet
    // omits Shiny, form or grade, let the player fill it in; never assume.
    function pokemonSheetDraft(text, title, names) {
        const body = String(text || '').slice(0, 14000);
        const originalTitle = String(title || '').trim();
        const heading = originalTitle.replace(/^(?:ficha\s+(?:de|do|da)\s+)?(?:shiny\s+)?/i, '').trim();
        const idText = body.match(/(?:Pok[eé]dex|Species ID|Esp[eé]cie|Dex)\s*(?:#|n[º°]\.?\s*)?(\d{1,5})\b/i);
        let speciesId = idText ? Number(idText[1]) : null;
        if (!speciesId && names) {
            const normalizedHeading = normalize(heading);
            const exact = [...names].filter(([, name]) => normalize(name) === normalizedHeading);
            if (exact.length === 1) speciesId = Number(exact[0][0]);
            else {
                const words = [...names].filter(([, name]) => {
                    const key = normalize(name);
                    return key.length > 2 && (normalizedHeading.startsWith(key + ' ') ||
                        normalizedHeading.endsWith(' ' + key) ||
                        normalizedHeading.includes(' ' + key + ' '));
                });
                if (words.length === 1) speciesId = Number(words[0][0]);
            }
        }
        const potency = body.match(/(?:Pot[eê]ncia|Potency)\s*[:=]?\s*([1-5])\b/i) ||
            body.match(/\bP\s*[:=]?\s*([1-5])\b/i);
        const score = body.match(/(?:Nota|Grade|Score)\s*[:=]?\s*(\d+(?:[.,]\d{1,3})?)\b/i) ||
            body.match(/\bN\s*[:=]\s*(\d+(?:[.,]\d{1,3})?)\b/i);
        const quality = body.match(/(?:Qualidade|Quality|\bQ\b)\s*[:=]\s*(\d+(?:[.,]\d{1,3})?)\b/i);
        const level = body.match(/(?:N[ií]vel|Level|Lv\.?)\s*[:=#]?\s*(\d{1,7})\b/i);
        // In the game's native sheet a Shiny is visibly labelled. A sheet
        // without that badge is provisionally assumed ordinary, and the user
        // can correct this in the estimate controls.
        const shiny = /^shiny\b/i.test(heading) || /\bshiny\b/i.test(originalTitle) ||
            /(?:Shiny)\s*[:=]\s*(?:sim|yes|true)\b/i.test(body);
        return {
            speciesId: Number.isSafeInteger(speciesId) && speciesId > 0 ? speciesId : null,
            potencia: potency ? Number(potency[1]) : null,
            nota: score ? Number(score[1].replace(',', '.')) : null,
            qualidade: quality ? Number(quality[1].replace(',', '.')) : null,
            level: level ? Number(level[1]) : null,
            shiny, formId: null
        };
    }

    function pokemonSheetOffer(root) {
        const ids = new Set();
        for (const node of [root, ...root.querySelectorAll('[data-pokemon-id], [data-pokemonid]')]) {
            const id = Number(node.dataset?.pokemonId ?? node.dataset?.pokemonid);
            if (Number.isSafeInteger(id) && id > 0) ids.add(id);
        }
        if (ids.size !== 1) return null;
        const matches = [];
        for (const currency of ['gold','orb']) {
            for (const offer of state.pokemonAutoOffers.get(currency)?.offers || []) {
                if (ids.has(Number(offer?.pokemonId ?? offer?.ficha?.id)))
                    matches.push(offer.ficha);
            }
        }
        return matches.length && matches.every(f => f === matches[0]) ? matches[0] : null;
    }

    function pokemonSheetInputs(host) {
        const field = name => host.querySelector('[data-moth-sheet-field="' + name + '"]')?.value || '';
        const id = Number(field('speciesId'));
        const potency = Number(field('potencia'));
        const grade = Number(field('nota').replace(',', '.'));
        const quality = Number(field('qualidade').replace(',', '.'));
        const level = Number(field('level'));
        const shiny = field('shiny');
        return {
            speciesId: Number.isSafeInteger(id) && id > 0 ? id : null,
            potencia: Number.isSafeInteger(potency) && potency >= 1 && potency <= 5 ? potency : null,
            nota: field('nota') && Number.isFinite(grade) && grade >= 0 && grade <= 10 ? grade : null,
            qualidade: field('qualidade') && Number.isFinite(quality) && quality >= 0.8 && quality <= 1.8 ? quality : null,
            level: Number.isSafeInteger(level) && level > 0 ? level : null,
            shiny: shiny === 'yes' ? true : shiny === 'no' ? false : null,
            formId: field('formId').trim() || null
        };
    }

    function updatePokemonSheetValues(host) {
        const fields = pokemonSheetInputs(host);
        // Retain verified IVs, combat role, refinement and collectible flags from
        // the actual market ficha while applying any user-edited fields.
        const ficha = host.mothObservedFicha ? {...host.mothObservedFicha, ...fields} : fields;
        const output = host.querySelector('.moth-sheet-results');
        if (!output) return;
        const primary = ficha.shiny ? 'orb' : 'gold';
        let valueHtml;
        if (ficha.potencia == null && ficha.speciesId && ficha.shiny != null) {
            const scenarios = [1, 2, 3, 4, 5].map(p => {
                const variant = {...ficha, potencia:p};
                const ref = pokemonRelativeValue(variant, primary);
                return '<div class="moth-sheet-scenario"><span>P' + p + '</span><b>' +
                    (ref ? money(ref.value, primary) : '—') + '</b></div>';
            }).join('');
            valueHtml = '<p>' + escapeHtml(tr('Potency is missing; select P to get one estimate. Scenarios below are not interchangeable.')) + '</p>' +
                '<div class="moth-sheet-scenarios">' + scenarios + '</div>';
        } else {
            valueHtml = pokemonValueLabel(ficha, primary);
        }
        const warnings = [];
        if (!ficha.speciesId) warnings.push(tr('Species not recognized; enter its Pokédex ID below.'));
        if (ficha.nota == null) warnings.push(tr('N missing: model uses the ordinary N=3.5 reference. Set the actual grade below.'));
        if (ficha.qualidade == null) warnings.push(tr('Q missing: model uses typical Q=1.2.'));
        if (host.dataset.mothShinyAssumed === '1' && ficha.shiny === false)
            warnings.push(tr('No Shiny badge detected: assumed ordinary. Correct below if needed.'));
        output.innerHTML = '<div class="moth-sheet-currencies"><div><span>' +
            escapeHtml(tr(primary === 'orb' ? 'Gem market model' : 'Coin market model')) +
            '</span>' + valueHtml + '</div></div>' +
            (warnings.length ? '<p class="moth-sheet-warning">' +
                escapeHtml(warnings.join(' ')) + '</p>' : '') +
            '<p>' + escapeHtml(tr('No automatic Coin ↔ Gem conversion. The stat model needs a live listing or past sale of the species to set a currency scale; earlier sales are secondary.')) + '</p>';
        host.dataset.mothReferenceAt = [
            state.pokemonReference?.capturedAt || 0,
            state.pokemonAutoOffers.get('gold')?.updatedAt || 0,
            state.pokemonAutoOffers.get('orb')?.updatedAt || 0
        ].join(':');
    }

    function ensurePokemonSheetValuation() {
        const sheet = q('#ficha');
        if (!sheet || sheet.classList.contains('hidden') || sheet.getAttribute('aria-hidden') === 'true')
            return;
        const body = q('#ficha-corpo', sheet);
        if (!body) return;
        let host = q('#moth-sheet-valuation', body);
        const title = q('#ficha-titulo', sheet)?.textContent || '';
        const nativeText = [...body.childNodes].filter(node => node !== host)
            .map(node => node.textContent || '').join(' ');
        const key = title + '|' + nativeText.slice(0, 1600) + '|catalog:' + state.creatureNames.size;
        if (host?.dataset.mothSheetKey === key) {
            const referenceKey = [
                state.pokemonReference?.capturedAt || 0,
                state.pokemonAutoOffers.get('gold')?.updatedAt || 0,
                state.pokemonAutoOffers.get('orb')?.updatedAt || 0
            ].join(':');
            if (host.dataset.mothReferenceAt !== referenceKey)
                updatePokemonSheetValues(host);
            return;
        }
        const observed = pokemonSheetOffer(sheet);
        const parsed = pokemonSheetDraft(nativeText, title, state.creatureNames);
        // An exact market ficha is more complete than DOM text; preserve its
        // verified stats rather than throwing away Q/IVs when a field is edited.
        const draft = observed ? {
            ...parsed,
            speciesId: speciesIdOf(observed) || parsed.speciesId,
            potencia: Number(observed.potencia) || parsed.potencia,
            nota: pokemonScore(observed) ?? parsed.nota,
            qualidade: pokemonQuality(observed) ?? parsed.qualidade,
            level: Number(observed.level) || parsed.level,
            shiny: typeof observed.shiny === 'boolean' ? observed.shiny : parsed.shiny,
            formId: pokemonForm(observed)
        } : parsed;
        if (!host) {
            host = document.createElement('section');
            host.id = 'moth-sheet-valuation';
            host.className = 'moth-sheet-valuation';
            // The sheet can be several screens tall. Put the estimate first,
            // not below all the native stats where nobody sees it.
            body.prepend(host);
        }
        const field = (name, label, value, type, extra = '') =>
            '<label><span>' + escapeHtml(tr(label)) + '</span><input data-moth-sheet-field="' +
            name + '" type="' + type + '" value="' + escapeHtml(value == null ? '' : String(value)) +
            '" ' + extra + '></label>';
        const shinyValue = draft.shiny === true ? 'yes' : draft.shiny === false ? 'no' : '';
        host.innerHTML = '<div class="moth-sheet-heading"><b>Moth valuation</b><small>' +
            escapeHtml(tr('Relative stat + market estimate · read-only')) + '</small></div>' +
            '<div class="moth-sheet-results" aria-live="polite"></div>' +
            '<details><summary>' + escapeHtml(tr('Edit Pokémon details / see how it works')) + '</summary>' +
            '<p>' + escapeHtml(tr('These fields are taken from the sheet when identifiable. Fill blanks if the game does not expose them. Unknown form stays separate from confirmed forms.')) + '</p>' +
            '<div class="moth-sheet-fields">' +
            field('speciesId', 'Species ID', draft.speciesId, 'number', 'min="1" step="1"') +
            field('potencia', 'Potency (P)', draft.potencia, 'number', 'min="1" max="5" step="1"') +
            field('nota', 'Grade (N)', draft.nota, 'text', 'inputmode="decimal"') +
            field('qualidade', 'Quality (Q)', draft.qualidade, 'text', 'inputmode="decimal"') +
            field('level', 'Level', draft.level, 'number', 'min="1" step="1"') +
            field('formId', 'Form ID (if known)', draft.formId, 'text') +
            '<label><span>' + escapeHtml(tr('Shiny?')) + '</span><select data-moth-sheet-field="shiny">' +
            [['','Unknown'],['no','No'],['yes','Yes']].map(([value,label]) =>
                '<option value="' + value + '"' + (shinyValue === value ? ' selected' : '') + '>' +
                escapeHtml(tr(label)) + '</option>').join('') +
            '</select></label></div><p>' +
            escapeHtml(tr('Relative strength uses P bonus and scarcity, N, Q, IVs, level and refinement. Current species listings set the price scale; sparse data means a wide, indicative range.')) +
            '</p></details>';
        host.mothObservedFicha = observed || null;
        host.dataset.mothShinyAssumed = observed ? '0' : !parsed.shiny ? '1' : '0';
        host.dataset.mothSheetKey = key;
        if (!host.dataset.mothBound) {
            host.dataset.mothBound = '1';
            host.addEventListener('click', event => event.stopPropagation());
            host.addEventListener('input', () => updatePokemonSheetValues(host));
            host.addEventListener('change', () => updatePokemonSheetValues(host));
        }
        updatePokemonSheetValues(host);
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
