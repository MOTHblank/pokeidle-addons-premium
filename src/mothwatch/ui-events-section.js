    function bindWatchEvents(panel) {
        if (panel.dataset.mothWatchEvents) return;
        panel.dataset.mothWatchEvents = '1';

        panel.addEventListener('click', event => {
            // Keep native market delegated handlers from processing Moth Watch clicks.
            event.stopPropagation();
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const button = target.closest('[data-moth-snatch]');
            if (button) {
                const parts = String(button.dataset.mothSnatch || '').split(':');
                if (parts.length !== 3) return;
                const [kind,currency,rawId] = parts;
                const ok = snatchMark(kind,currency,Number(rawId),
                    Number(button.dataset.mothSnatchItem || 0));
                if (ok) addLog('Snatch queue updated · listing #' + rawId);
                else addLog('Snatch not armed · load the listing again');
                state.itemInventoryMemo = null;
                state.pokemonEvidenceMemo = null;
                renderWatch(true); return;
            }
            const tab = target.closest('[data-moth-view]');
            if (tab) {
                const view = tab.dataset.mothView;
                if (!['opportunities', 'inventory', 'pricing', 'economy', 'automation', 'activity'].includes(view)) return;
                state.watchView = view;
                try { localStorage.setItem('moth-pokeidle-market-watch-view-v1', view); } catch {}
                renderWatch(true);
                return;
            }
            const holdingRemove = target.closest('[data-moth-holding-remove]');
            if (holdingRemove) {
                const ok = setEconomyHolding(Number(holdingRemove.dataset.mothHoldingRemove), 0, 'gold');
                state.economyNotice = ok ? tr('Holding removed.') : tr('Could not remove holding.');
                renderWatch(true); return;
            }
            if (target.closest('#moth-mw-holding-save')) {
                const itemId = Number(q('#moth-mw-holding-item', panel)?.value);
                const quantity = Number(q('[data-moth-economy-field="quantity"]', panel)?.value);
                const currency = q('#moth-mw-holding-currency', panel)?.value;
                const ok = setEconomyHolding(itemId, quantity, currency);
                state.economyNotice = ok ? tr('Holding quantity recorded.') : tr('Select a catalog item and a valid quantity.');
                if (ok) {
                    state.economyInput.itemId = itemId;
                    state.economyInput.quantity = quantity;
                    state.economyInput.holdingCurrency = currency;
                }
                renderWatch(true); return;
            }
            if (target.closest('#moth-mw-fee-calc')) {
                const kind = q('#moth-mw-fee-kind', panel)?.value;
                const currency = q('#moth-mw-fee-currency', panel)?.value;
                const unit = Number(q('[data-moth-economy-field="feeUnit"]', panel)?.value);
                const quantity = Number(q('[data-moth-economy-field="feeQuantity"]', panel)?.value);
                const days = Number(q('[data-moth-economy-field="holdingDays"]', panel)?.value);
                if (!['item','diamond','pokemon'].includes(kind) ||
                    !['gold','orb'].includes(currency) ||
                    !Number.isSafeInteger(unit) || unit <= 0 ||
                    !Number.isSafeInteger(quantity) || quantity < 1 ||
                    kind === 'pokemon' && quantity !== 1 ||
                    !Number.isSafeInteger(unit * quantity) ||
                    !Number.isSafeInteger(days) || days < 1 || days > 30) {
                    state.economyNotice = tr('Enter a valid positive price and quantity; Pokémon are indivisible.');
                    renderWatch(true);
                    return;
                }
                state.economyInput = { ...state.economyInput, feeKind: kind, feeCurrency:currency,
                    feeUnit: unit, feeQuantity: quantity, holdingDays: days };
                state.economyNotice = tr('Seller fee estimate updated.');
                renderWatch(true); return;
            }
            if (target.closest('#moth-mw-diagnostics-toggle')) {
                diagnosticReset(!state.diagnostics?.enabled);
                renderWatch(); return;
            }
            if (target.closest('#moth-mw-diagnostics-reset')) {
                diagnosticReset(!!state.diagnostics?.enabled);
                renderWatch(); return;
            }
            if (target.closest('#moth-mw-diagnostics-copy')) {
                void copyText(JSON.stringify(diagnosticReport(), null, 2)).then(ok => {
                    setAutomationNotice(tr(ok ? 'Sanitized report copied.' : 'Could not copy diagnostic report.'), ok ? 'ok' : 'warn');
                });
                return;
            }
            if (target.closest('#moth-mw-scan')) { runScan(true); return; }
            if (target.closest('#moth-mw-refresh-baseline')) {
                state.forceBaselineNext = true;
                state.baseline = emptyBaseline();
                saveBaseline();
                requestItemSummary();
                queueRender();
                return;
            }
            if (target.closest('#moth-mw-export-baseline')) {
                void copyText(exportBaselineText()).then(ok => {
                    addLog(ok ? 'Reference data copied to clipboard' : 'Could not copy reference data');
                    queueRender();
                });
                return;
            }

            for (const type of ['any', 'pokemon']) {
                if (!target.closest('#moth-add-' + type + '-rule')) continue;
                const pokemon = type === 'pokemon';
                const kind = pokemon ? q('#moth-pokemon-kind', panel)?.value : null;
                if (pokemon && !['any', 'shiny', 'p5'].includes(kind)) return;
                const currency = q('#moth-' + type + '-currency', panel)?.value === 'orb' ? 'orb' : 'gold';
                if (pokemon && kind === 'shiny' && currency !== 'orb') {
                    setAutomationNotice(tr('Shiny purchases require Gems.'), 'warn');
                    q('#moth-pokemon-currency', panel).value = 'orb'; return;
                }
                const buyMax = Number(q('#moth-' + type + '-buy', panel)?.value);
                if (!Number.isSafeInteger(buyMax) || buyMax <= 0) {
                    setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn'); return;
                }
                const key = pokemon ? 'pokemonBuyRules' : 'anyItemRules';
                const rules = pokemon ? sanitizePokemonBuyRules(config[key]) : sanitizeAnyItemRules(config[key]);
                if (rules.some(r => r.currency === currency && (!pokemon || r.kind === kind))) {
                    setAutomationNotice(tr('An equivalent rule already exists for this currency.'), 'warn'); return;
                }
                const rule = {id: newAutomationRuleId(type), currency, buyMax, buyEnabled: true};
                if (pokemon) rule.kind = kind;
                if (config.fixedRulesEnabled && !confirmUnboundedRule(rule)) {
                    setAutomationNotice(tr('Activation cancelled; no settings changed.'), 'warn'); return;
                }
                rules.push(rule);
                config[key] = rules; saveConfig();
                setAutomationNotice(tr(config.fixedRulesEnabled ? 'Rule added: {name}.' :
                    'Rule configured — buying remains off until master switch is enabled.',
                    {name: pokemon ? tr('Pokémon') : tr('Any item')}), 'ok');
                renderWatch(true); return;
            }
            for (const type of ['any', 'pokemon']) {
                const button = target.closest('[data-moth-remove-' + type + ']');
                if (!button) continue;
                const key = type === 'any' ? 'anyItemRules' : 'pokemonBuyRules';
                const id = button.getAttribute('data-moth-remove-' + type);
                config[key] = config[key].filter(rule => rule.id !== id);
                saveConfig(); renderWatch(true); return;
            }
            if (target.closest('#moth-add-fixed-rule')) {
                const itemId = Number(q('#moth-fixed-item', panel)?.value);
                if (!(itemId > 0)) { setAutomationNotice(tr('Choose an item before adding a rule.'), 'warn'); return; }
                const currency = q('#moth-fixed-currency', panel)?.value === 'orb' ? 'orb' : 'gold';
                const buyMax = Math.max(0, Math.floor(Number(q('#moth-fixed-buy', panel)?.value) || 0));
                if (!(buyMax > 0)) {
                    setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn'); return;
                }
                const rules = sanitizeFixedItemRules(config.fixedItemRules), name = catalogName(itemId);
                if (rules.some(r => r.itemId === itemId && r.currency === currency)) {
                    setAutomationNotice(tr('A rule for {name} in this currency already exists.', { name }), 'warn'); return;
                }
                rules.push({ id: newAutomationRuleId('fixed'), itemId, currency, buyEnabled: true, buyMax });
                config.fixedItemRules = rules; saveConfig();
                setAutomationNotice(tr(config.fixedRulesEnabled
                    ? 'Rule added: {name}.' : 'Rule saved: {name}. Turn on rule-based buying to start.', { name }), 'ok');
                renderWatch(true); return;
            }
            const removeFixed = target.closest('[data-moth-remove-fixed]');
            if (removeFixed) {
                const rules = sanitizeFixedItemRules(config.fixedItemRules);
                const removed = rules.find(r => r.id === removeFixed.dataset.mothRemoveFixed);
                config.fixedItemRules = rules.filter(r => r.id !== removeFixed.dataset.mothRemoveFixed);
                saveConfig(); setAutomationNotice(tr('Rule removed: {name}.', { name: removed ? catalogName(removed.itemId) : tr('Item') }), 'ok'); renderWatch(true); return;
            }
            const itemButton = target.closest('[data-moth-item-scan]');
            if (itemButton) {
                const itemId = Number(itemButton.dataset.mothItemScan);
                const currency = itemButton.dataset.mothItemCurrency === 'orb' ? 'orb' : 'gold';
                if (!(itemId > 0)) return;
                const key = String(itemId) + ':' + currency;
                state.selectedItemFocus = { itemId, currency, key };
                state.itemDetailStatus = { key, itemId, currency, status: 'loading', at: Date.now() };
                state.loadedItemKeys.add(key);
                state.lastDetailRequest.delete(key);
                queueItemDetail(itemId, currency);
                state.itemStatus = 'loading ' + catalogName(itemId) + ' offers';
                renderWatch(true);
                return;
            }
            if (target.closest('[data-moth-hide-offers]')) {
                state.selectedItemFocus = null;
                renderWatch(true);
                return;
            }
            const inventoryToggle = target.closest('#moth-mw-inventory-toggle');
            if (inventoryToggle) {
                state.itemInventoryCollapsed = !state.itemInventoryCollapsed;
                try { localStorage.setItem(ITEM_INVENTORY_COLLAPSED_KEY, state.itemInventoryCollapsed ? '1' : '0'); } catch {}
                const body = q('#moth-mw-inventory-body', panel);
                if (body) body.hidden = state.itemInventoryCollapsed;
                inventoryToggle.setAttribute('aria-expanded', state.itemInventoryCollapsed ? 'false' : 'true');
                const chevron = q('.moth-mw-inventory-chevron', inventoryToggle);
                if (chevron) chevron.textContent = state.itemInventoryCollapsed ? '▸' : '▾';
                return;
            }
            const filter = target.closest('[data-moth-filter]');
            if (filter) {
                const group = filter.dataset.mothFilter, value = filter.dataset.mothValue;
                if (group === 'currency' && ['all', 'gold', 'orb'].includes(value)) config.viewCurrency = value;
                else if (group === 'kind' && ['all', 'item', 'pokemon', 'diamond'].includes(value)) config.viewKind = value;
                else return;
                saveConfig();
                renderWatch();
                return;
            }
            const buy = target.closest('[data-moth-buy]');
            if (buy) {
                const candidate = state.candidates.get(buy.dataset.mothBuy);
                if (candidate && !tryBuy(candidate, true)) addLog('Purchase not sent; check balance, reserve, listing availability, and pending purchase status');
                queueRender();
            }
        });

        panel.addEventListener('input', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            if (target.matches('#moth-mw-search')) {
                state.opportunitySearch = target.value;
                try { localStorage.setItem('moth-pokeidle-market-watch-search-v1', state.opportunitySearch); } catch {}
                renderWatch();
                return;
            }
            if (target.matches('#moth-fixed-search')) { filterAutomationItemSelect(target, q('#moth-fixed-item', panel)); return; }
            if (target.matches('#moth-pokemon-buy') && Number(target.value) < 0) target.value = '0';

            if (target.matches('input[type="range"][data-moth-cfg]')) {
                const output = q('[data-moth-cfg-value="' + target.dataset.mothCfg + '"]', panel);
                if (output) output.textContent = target.value + '%';
            }
        });

        panel.addEventListener('change', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;

            for (const type of ['any', 'pokemon']) {
                const attr = 'data-moth-' + type + '-field';
                if (!target.hasAttribute(attr)) continue;
                const key = type === 'any' ? 'anyItemRules' : 'pokemonBuyRules';
                const sanitize = type === 'any' ? sanitizeAnyItemRules : sanitizePokemonBuyRules;
                const rules = sanitize(config[key]), rule = rules.find(r => r.id === target.dataset.ruleId);
                if (!rule) return;
                const previouslyUnbounded = broadRuleUnbounded(rule);
                const field = target.getAttribute(attr);
                if (['maxSpendSession', 'maxSpendDay', 'maxPurchasesSession', 'maxQuantitySession'].includes(field)) {
                    const cap = Number(target.value);
                    if (!Number.isSafeInteger(cap) || cap < 0) { renderWatch(true); return; }
                    rule[field] = cap;
                } else if (field === 'buyMax') {
                    const max = Number(target.value);
                    if (!Number.isSafeInteger(max) || max <= 0) {
                        setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn');
                        renderWatch(true); return;
                    }
                    rule.buyMax = max;
                } else if (field === 'buyEnabled') {
                    if (target.checked && !rule.buyEnabled &&
                        config.fixedRulesEnabled && !confirmUnboundedRule({...rule, buyEnabled: true})) {
                        setAutomationNotice(tr('Activation cancelled; no settings changed.'), 'warn');
                        renderWatch(true); return;
                    }
                    rule.buyEnabled = target.checked;
                }
                else if (field === 'currency') {
                    const currency = target.value === 'orb' ? 'orb' : 'gold';
                    if (type === 'pokemon' && rule.kind === 'shiny' && currency !== 'orb') {
                        setAutomationNotice(tr('Shiny purchases require Gems.'), 'warn');
                        renderWatch(true); return;
                    }
                    if (rules.some(r => r.id !== rule.id && r.currency === currency &&
                        (type === 'any' || r.kind === rule.kind))) {
                        setAutomationNotice(tr('An equivalent rule already exists for this currency.'), 'warn');
                        renderWatch(true); return;
                    }
                    rule.currency = currency;
                } else return;
                if (config.fixedRulesEnabled && !previouslyUnbounded &&
                    broadRuleUnbounded(rule) && !confirmRemovingLastBroadCap()) {
                    setAutomationNotice(tr('Activation cancelled; no settings changed.'), 'warn');
                    renderWatch(true); return;
                }
                config[key] = rules; saveConfig(); renderWatch(true); return;
            }
            if (target.matches('#moth-pokemon-kind')) {
                const currency = q('#moth-pokemon-currency', panel);
                if (currency) {
                    const shiny = target.value === 'shiny';
                    if (shiny) currency.value = 'orb';
                    const coin = currency.querySelector('option[value="gold"]');
                    if (coin) coin.disabled = shiny;
                }
                return;
            }
            if (target.matches('[data-moth-fixed-field]')) {
                const id = target.dataset.ruleId;
                const field = target.dataset.mothFixedField;
                const rules = sanitizeFixedItemRules(config.fixedItemRules);
                const rule = rules.find(entry => entry.id === id);
                if (!rule) return;
                if (field === 'currency') rule.currency = target.value === 'orb' ? 'orb' : 'gold';
                else if (field === 'buyEnabled') rule.buyEnabled = target.checked;
                else if (field === 'buyMax') rule.buyMax = Math.max(0, Math.floor(Number(target.value) || 0));
                else if (['maxSpendSession', 'maxSpendDay', 'maxPurchasesSession', 'maxQuantitySession'].includes(field)) {
                    const cap = Number(target.value);
                    if (!Number.isSafeInteger(cap) || cap < 0) { renderWatch(true); return; }
                    rule[field] = cap;
                }
                else return;
                config.fixedItemRules = rules;
                saveConfig();
                queueRender();
                return;
            }
            if (target.matches('[data-moth-cfg]')) {
                const key = target.dataset.mothCfg;
                if (!(key in DEFAULTS)) return;
                const nextValue = target.type === 'checkbox' ? target.checked :
                    normalizedConfigValue(key, target.value);
                if (key === 'fixedRulesEnabled' && nextValue && !config.fixedRulesEnabled &&
                    !confirmUnboundedMaster()) {
                    setAutomationNotice(tr('Activation cancelled; no settings changed.'), 'warn');
                    renderWatch(true); return;
                }
                const oldUnboundedCount = enabledUnboundedBroadRules().length;
                const oldValue = config[key];
                config[key] = nextValue;
                if (config.fixedRulesEnabled && !oldUnboundedCount &&
                    enabledUnboundedBroadRules().length > 0 &&
                    key !== 'fixedRulesEnabled' && !confirmRemovingLastBroadCap()) {
                    config[key] = oldValue;
                    setAutomationNotice(tr('Activation cancelled; no settings changed.'), 'warn');
                    renderWatch(true); return;
                }
                if (target.matches('input[type="range"]')) {
                    const output = q('[data-moth-cfg-value="' + key + '"]', panel);
                    if (output) output.textContent = config[key] + '%';
                }
                saveConfig();
                if (key === 'fixedRulesEnabled') {
                    if (!config.fixedRulesEnabled) state.ruleItemKeys.clear();
                    else if (!hasAnyBuyingRules()) {
                        setAutomationNotice(tr('Rule-based buying is on, but no Buy rules are active. Create or enable a rule first.'), 'warn');
                    } else {
                        setAutomationNotice(tr('Rule-based buying is on. No other purchase switches are required. Spending safeguards still apply.'), 'ok');
                    }
                }
                if (key === 'pokemonHistoryPages' || key === 'minPokemonSamples') ensurePokemonHistory(true);
                // Spending switches and numeric fields do not need a new market scan.
                // Only changes to scanning conditions should request fresh data.
                if (['scanItems', 'scanPokemon', 'scanDiamonds', 'scanSeconds', 'watchPercent'].includes(key)) {
                    runScan(true);
                }
                queueRender();
                return;
            }
            if (target.matches('#moth-mw-sort')) {
                config.viewSort = target.value;
                saveConfig();
                renderWatch();
            }
        });
    }

    function queueRender() {
        if (state.renderQueued) return;
        state.renderQueued = true;

        /*
         * The watch panel is a fairly large DOM tree. During live-market
         * activity several protocol events can arrive in the same second.
         * Rebuilding the whole panel once per animation frame is enough to
         * starve the game thread, especially with many retained listings.
         *
         * Keep the open panel responsive at a bounded refresh rate while
         * still allowing closed-state UI repair immediately.
         */
        const now = Date.now();
        const minInterval = state.watchOpen ? 250 : 0;
        const elapsed = now - Number(state.lastRenderAt || 0);
        const delay = Math.max(0, minInterval - elapsed);

        setTimeout(() => {
            requestAnimationFrame(() => {
                state.renderQueued = false;
                ensureUi();

                if (state.watchOpen) {
                    state.lastRenderAt = Date.now();
                }

                renderWatch();
            });
        }, delay);
    }

    function openWatch() {
        ensureUi();

        const body =
            q('#modal-corpo') ||
            q('.cm-corpo');

        if (!body) return false;

        state.watchOpen = true;
        body.classList.add('moth-watch-active');

        const button =
            q('#moth-market-watch-tab');

        if (button) button.classList.add('on');
        updateWatchButtonLabel(button);

        /*
         * Paint the UI first. Market/history requests can continue from the
         * normal scan timer without making the button click compete with the
         * initial panel construction.
         */
        renderWatch();
        setTimeout(() => {
            if (state.watchOpen) {
                runScan(true);
            }
        }, 0);
        return true;
    }

    function closeWatch() {
        state.watchOpen = false;
        state.itemInventoryMemo = null;
        state.lastInventoryPaint = null;

        /*
         * The native modal reuses #modal-corpo when navigating between RMT
         * and other screens. Clear every activation class, not just whichever
         * body querySelector happens to find first, or the next RMT render can
         * inherit the CSS rule that hides all of its children.
         */
        for (const body of qa('.moth-watch-active')) {
            body.classList.remove('moth-watch-active');
        }

        const button =
            q('#moth-market-watch-tab');

        if (button) button.classList.remove('on');
        updateWatchButtonLabel(button);
    }

    function updateWatchButtonLabel(button = q('#moth-market-watch-tab')) {
        if (!button) return;
        const label = button.querySelector('span');
        const text = tr(state.watchOpen ? 'Regular market' : 'Moth Watch');
        if (label && label.textContent !== text) label.textContent = text;
        button.title = tr(state.watchOpen ? 'Return to regular market' : 'Open Moth Watch');
        button.setAttribute('aria-pressed', state.watchOpen ? 'true' : 'false');
    }

    function installWatchButton(host) {
        if (!host) return null;

        let button =
            q('#moth-market-watch-tab');

        if (!button) {
            button = document.createElement('button');
            button.id =
                'moth-market-watch-tab';
            button.type = 'button';
            button.className =
                'cm-acao cm-atalho';
            button.innerHTML =
                '<i aria-hidden="true">M</i><span>Moth Watch</span>';
            button.title =
                'Underpriced listings and market sniper settings';
            button.setAttribute(
                'aria-pressed',
                state.watchOpen ? 'true' : 'false'
            );

            button.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    if (state.watchOpen) {
                        closeWatch();
                    } else {
                        openWatch();
                    }
                }
            );
        }

        if (button.parentElement !== host) {
            host.appendChild(button);
        }

        updateWatchButtonLabel(button);
        return button;
    }

    function ensureUi() {
        injectStyle();
        ensureSellPriceRecommendation();
        if (state.watchOpen && state.lastLocale !== currentLocale()) renderWatch(true);

        /*
         * Current PokéIdle: RMT is a normal top-menu entry that opens the
         * generic #modal. The old .cm-topo/.cm-corpo wrapper is only present
         * inside the community market renderer on older clients.
         *
         * Prefer the actual RMT modal action area. This prevents Moth Watch
         * from being mounted beside an unrelated menu element and makes its
         * button appear where it used to: inside RMT.
         */
        const modal =
            q('#modal');
        const modalBox =
            q('#modal .modal-caixa');
        const modalBody =
            q('#modal-corpo');

        const isCommunity =
            modal &&
            !modal.classList.contains('hidden') &&
            modalBox?.dataset?.modal ===
                'community';

        /*
         * Closing RMT or navigating to another modal must exit Watch mode.
         * The outer modal's inner content is replaced in place by PokéIdle,
         * so a class left on #modal-corpo survives and hides the new screen.
         */
        if (
            !isCommunity &&
            (state.watchOpen || qa('.moth-watch-active').length > 0)
        ) {
            closeWatch();
        }

        if (isCommunity && modalBody) {
            const communityTop =
                q('#modal-corpo .cm-topo');
            const watchHost =
                q('.cm-atalhos', communityTop) ||
                communityTop;

            if (watchHost) {
                installWatchButton(watchHost);
            }

            let panel =
                q('#moth-market-watch-panel');

            if (!panel) {
                panel =
                    document.createElement('section');
                panel.id =
                    'moth-market-watch-panel';
                modalBody.appendChild(panel);
            } else if (
                panel.parentElement !==
                modalBody
            ) {
                modalBody.appendChild(panel);
            }

            if (state.watchOpen) {
                modalBody.classList.add(
                    'moth-watch-active'
                );

                const button =
                    q('#moth-market-watch-tab');

                button?.classList.add('on');
                button?.setAttribute(
                    'aria-pressed',
                    'true'
                );
            }

            return true;
        }

        /*
         * Legacy client support. Keep the old structure working, but do not
         * search the whole document for a button whose text happens to be RMT.
         */
        const legacyTop =
            q('.cm-topo');
        const legacyBody =
            q('.cm-corpo');

        if (!legacyTop || !legacyBody) {
            return false;
        }

        const host =
            q('.cm-atalhos', legacyTop) ||
            legacyTop;

        const button =
            installWatchButton(host);

        let panel =
            q('#moth-market-watch-panel');

        if (!panel) {
            panel =
                document.createElement('section');
            panel.id =
                'moth-market-watch-panel';
            legacyBody.appendChild(panel);
        } else if (
            panel.parentElement !==
            legacyBody
        ) {
            legacyBody.appendChild(panel);
        }

        if (state.watchOpen) {
            legacyBody.classList.add(
                'moth-watch-active'
            );
            button?.classList.add('on');
        }

        return true;
    }
