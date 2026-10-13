    function fixedRuleStatus(rule) {
        if (!rule.buyEnabled || !(rule.buyMax > 0)) return tr('Rule paused');
        if (!config.enabled) return tr('Moth Watch disabled');
        if (!config.fixedRulesEnabled) return tr('Enable rule-based buying above');
        if (config.purchasesPaused) return tr('Purchases paused');
        if (unverifiedOrdersExist()) return tr('Unknown purchase outcome');
        if (state.pendingBuy) return tr('Waiting for acknowledgement');
        if (remainingBudget(rule.currency, rule.id).spend < 1) return tr('Budget blocked');
        if (!state.socket || state.socket.readyState !== 1 || gameIsLoading()) return tr('Waiting for game connection');
        const spendable = Math.max(0, balanceFor(rule.currency) - reserveFor(rule.currency));
        if (spendable < 1) return tr('Insufficient spendable balance');
        const detail = state.itemOfferDetails.get(String(rule.itemId) + ':' + rule.currency);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > 45000) return tr('Checking listings…');
        const candidate = fixedRuleCandidate(rule);
        if (candidate && freshQuote(candidate, false) && purchaseQuantity(candidate) > 0)
            return tr('Eligible listing available');
        if (candidate && !freshQuote(candidate, false)) return tr('Checking listings…');
        if (candidate) return tr('Insufficient spendable balance');
        return tr('Monitoring · no eligible listing');
    }

    function ruleNumber(label, attrs, value, min = 0) {
        return `<label class="moth-mw-rule-field"><span>${escapeHtml(tr(label))}</span><input type="number" inputmode="numeric" min="${min}" step="1" value="${escapeHtml(String(value))}" ${attrs}></label>`;
    }

    function ruleCurrency(attrs, currency) {
        return `<label class="moth-mw-rule-field"><span>${escapeHtml(tr('Currency'))}</span><select ${attrs}>
            <option value="gold"${currency === 'gold' ? ' selected' : ''}>${escapeHtml(tr('Coins'))}</option>
            <option value="orb"${currency === 'orb' ? ' selected' : ''}>${escapeHtml(tr('Gems'))}</option>
        </select></label>`;
    }

    function ruleCapsHtml(type, rule) {
        const id = escapeHtml(rule.id);
        const field = name => 'data-moth-' + type + '-field="' + name + '" data-rule-id="' + id + '"';
        return '<details class="moth-mw-rule-caps"><summary>' + escapeHtml(tr('Rule cumulative limits')) + '</summary>' +
            '<p class="moth-mw-rule-hint">' + escapeHtml(tr('Spend cap is for the selected rule currency. 0 means unlimited.')) + '</p>' +
            ruleNumber('Session spend cap', field('maxSpendSession'), rule.maxSpendSession || 0) +
            ruleNumber('Daily spend cap (UTC)', field('maxSpendDay'), rule.maxSpendDay || 0) +
            ruleNumber('Purchases per session', field('maxPurchasesSession'), rule.maxPurchasesSession || 0) +
            ruleNumber('Units per session', field('maxQuantitySession'), rule.maxQuantitySession || 0) +
            '</details>';
    }

    function ruleSwitch(label, attrs, checked) {
        return `<label class="moth-mw-switch moth-mw-rule-toggle"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}><span>${escapeHtml(tr(label))}</span></label>`;
    }

    function fixedRulesHtml() {
        const rules = sanitizeFixedItemRules(config.fixedItemRules);
        const cards = rules.map(rule => {
            const id = escapeHtml(rule.id);
            return `<article class="moth-mw-rule-card fixed" data-moth-fixed-row="${id}">
                <div class="moth-mw-rule-card-head">
                    <div class="moth-mw-rule-title"><b>${escapeHtml(catalogName(rule.itemId))}</b>
                        <small data-moth-rule-status data-rule-type="fixed" data-rule-id="${id}">${escapeHtml(fixedRuleStatus(rule))}</small>
                    </div>
                    ${ruleCurrency(`data-moth-fixed-field="currency" data-rule-id="${id}"`, rule.currency)}
                </div>
                <div class="moth-mw-rule-compose">
                    <section class="moth-mw-rule-side buy">
                        <div class="moth-mw-rule-side-head">${ruleSwitch('Buy', `data-moth-fixed-field="buyEnabled" data-rule-id="${id}"`, rule.buyEnabled)}</div>
                        ${ruleNumber('Buy at or below', `data-moth-fixed-field="buyMax" data-rule-id="${id}"`, rule.buyMax)}
                        ${ruleCapsHtml('fixed', rule)}
                        <p class="moth-mw-rule-hint">${escapeHtml(tr('Buy every available unit affordable within reserves and purchase limits.'))}</p>
                    </section>
                </div>
                <div class="moth-mw-rule-card-foot">
                    <span class="moth-mw-rule-note">${escapeHtml(tr('Price per unit'))}</span>
                    <button type="button" class="moth-mw-btn danger" data-moth-remove-fixed="${id}">${escapeHtml(tr('Remove'))}</button>
                </div>
            </article>`;
        }).join('');
        return `<section class="moth-mw-automation-block primary">
            <div class="moth-mw-block-heading"><h4>${escapeHtml(tr('Fixed item rules'))}</h4>
                <p>${escapeHtml(tr('Set an item and its maximum unit price, for example Cocoon Stone at 30,000 Coins. Only matching offers can be purchased.'))}</p>
            </div>
            <div class="moth-mw-master-row">${configField('Enable rule-based buying', 'fixedRulesEnabled', 'checkbox')}</div>
            <div class="moth-mw-rule-add-card">
                <h5>${escapeHtml(tr('Create a fixed rule'))}</h5>
                <div class="moth-mw-rule-add-search">
                    <label class="moth-mw-rule-field"><span>${escapeHtml(tr('Find item'))}</span>
                        <input type="search" id="moth-fixed-search" placeholder="${escapeHtml(tr('Search items…'))}"></label>
                    <label class="moth-mw-rule-field"><span>${escapeHtml(tr('Item'))}</span><select id="moth-fixed-item">${automationItemOptions()}</select></label>
                    ${ruleCurrency('id="moth-fixed-currency"', 'gold')}
                </div>
                <div class="moth-mw-rule-compose">
                    <section class="moth-mw-rule-side buy">
                        <h6>${escapeHtml(tr('Buy'))}</h6>
                        ${ruleNumber('Buy at or below', 'id="moth-fixed-buy"', 0)}
                        <p class="moth-mw-rule-hint">${escapeHtml(tr('Buy every available unit affordable within reserves and purchase limits.'))}</p>
                    </section>
                </div>
                <p class="moth-mw-rule-hint">${escapeHtml(tr('Only a positive buy price activates a rule.'))}</p>
                <div class="moth-mw-rule-add-actions">
                    <span>${escapeHtml(tr('Adding a rule does not turn on rule-based buying; enable the switch above.'))}</span>
                    <button type="button" class="moth-mw-btn primary" id="moth-add-fixed-rule">${escapeHtml(tr('Add fixed rule'))}</button>
                </div>
            </div>
            <h5 class="moth-mw-rule-list-title">${escapeHtml(tr('Configured rules'))} (${rules.length})</h5>
            <div class="moth-mw-rule-list">${cards || `<div class="moth-mw-empty">${escapeHtml(tr('No fixed item rules configured.'))}</div>`}</div>
        </section>`;
    }


    function categoryRuleStatus(rule, type) {
        if (!rule.buyEnabled || !(rule.buyMax > 0)) return tr('Rule paused');
        if (!config.enabled) return tr('Moth Watch disabled');
        if (!config.fixedRulesEnabled) return tr('Enable rule-based buying above');
        if (config.purchasesPaused) return tr('Purchases paused');
        if (unverifiedOrdersExist()) return tr('Unknown purchase outcome');
        if (state.pendingBuy) return tr('Waiting for acknowledgement');
        if (remainingBudget(rule.currency, rule.id).spend < 1) return tr('Budget blocked');
        if (!state.socket || state.socket.readyState !== 1 || gameIsLoading()) return tr('Waiting for game connection');
        if (balanceFor(rule.currency) - reserveFor(rule.currency) < 1) return tr('Insufficient spendable balance');
        if (type === 'any') {
            const candidate = anyItemRuleCandidate(rule, anyItemRuleTargets([rule]));
            return tr(candidate && freshQuote(candidate, false) && purchaseQuantity(candidate) > 0
                ? 'Eligible listing available' : 'Checking listings…');
        }
        const candidate = pokemonRuleCandidate(rule);
        return tr(candidate && freshQuote(candidate, false) && purchaseQuantity(candidate) > 0
            ? 'Eligible listing available' : candidate ? 'Checking listings…' : 'Monitoring · no eligible listing');
    }

    function categoryRulesHtml(type) {
        const pokemon = type === 'pokemon';
        const rules = pokemon
            ? sanitizePokemonBuyRules(config.pokemonBuyRules)
            : sanitizeAnyItemRules(config.anyItemRules);
        const names = {any: 'Any Pokémon', shiny: 'Shiny Pokémon', p5: 'P5 Pokémon'};
        const cards = rules.map(rule => {
            const id = escapeHtml(rule.id);
            const title = pokemon ? names[rule.kind] : 'Any item';
            return '<article class="moth-mw-rule-card fixed"><div class="moth-mw-rule-card-head">' +
                '<div class="moth-mw-rule-title"><b>' + escapeHtml(tr(title)) + '</b>' +
                '<small data-moth-rule-status data-rule-type="' + type + '" data-rule-id="' + id + '">' +
                escapeHtml(categoryRuleStatus(rule, type)) + '</small></div></div>' +
                '<div class="moth-mw-rule-compose"><section class="moth-mw-rule-side buy">' +
                ruleSwitch('Buy', 'data-moth-' + type + '-field="buyEnabled" data-rule-id="' + id + '"', rule.buyEnabled) +
                ruleNumber('Buy at or below', 'data-moth-' + type + '-field="buyMax" data-rule-id="' + id + '"', rule.buyMax) +
                ruleCurrency('data-moth-' + type + '-field="currency" data-rule-id="' + id + '"', rule.currency) +
                ruleCapsHtml(type, rule) +
                '<p class="moth-mw-rule-hint">' + escapeHtml(ruleRiskSummary(rule, type)) + '</p>' +
                '</section></div><div class="moth-mw-rule-card-foot"><span>' +
                escapeHtml(tr(pokemon ? 'Price per Pokémon' : 'Price per unit')) +
                '</span><button type="button" class="moth-mw-btn danger" data-moth-remove-' + type + '="' + id + '">' +
                escapeHtml(tr('Remove')) + '</button></div></article>';
        }).join('');
        const label = pokemon ? 'Pokémon purchase rules' : 'Any item rules';
        const help = pokemon
            ? 'Purchase rules inspect up to three cheapest-price pages per currency, not the full market. Shiny requires Gems.'
            : 'Any-item rules inspect current offers selectively; large catalogs can take time.';
        const controls = pokemon ? '<label class="moth-mw-rule-field"><span>' +
            escapeHtml(tr('Pokémon category')) + '</span><select id="moth-pokemon-kind">' +
            '<option value="any">' + escapeHtml(tr('Any Pokémon')) + '</option>' +
            '<option value="shiny">' + escapeHtml(tr('Shiny Pokémon')) + '</option>' +
            '<option value="p5">' + escapeHtml(tr('P5 Pokémon')) + '</option></select></label>' : '';
        return '<section class="moth-mw-automation-block"><div class="moth-mw-block-heading"><h4>' +
            escapeHtml(tr(label)) + '</h4><p>' + escapeHtml(tr(help)) +
            '</p></div><div class="moth-mw-rule-add-card"><h5>' +
            escapeHtml(tr(pokemon ? 'Add Pokémon rule' : 'Add any-item rule')) +
            '</h5><div class="moth-mw-rule-add-search">' + controls +
            ruleCurrency('id="moth-' + type + '-currency"', 'gold') +
            ruleNumber('Buy at or below', 'id="moth-' + type + '-buy"', 0) +
            '</div><p class="moth-mw-rule-hint">' +
            escapeHtml(tr(pokemon
                ? 'Buy matching Pokémon at or below the absolute listing price per Pokémon; grade and value predictions never authorize buying.'
                : 'Buy any item at or below this price per unit.')) +
            '</p><button type="button" class="moth-mw-btn primary" id="moth-add-' + type + '-rule">' +
            escapeHtml(tr(pokemon ? 'Add Pokémon rule' : 'Add any-item rule')) +
            '</button></div><h5 class="moth-mw-rule-list-title">' +
            escapeHtml(tr('Configured rules')) + ' (' + rules.length + ')</h5>' +
            '<div class="moth-mw-rule-list">' +
            (cards || '<div class="moth-mw-empty">' +
                escapeHtml(tr(pokemon ? 'No Pokémon rules configured.' : 'No any-item rules configured.')) +
                '</div>') + '</div></section>';
    }
