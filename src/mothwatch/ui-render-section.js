    // Avoid rebuilding the 120-item inventory HTML on every unrelated socket
    // notification. Cache only for the current view and invalidate on meaningful
    // summary, catalog, focused-offer or locale changes.
    function inventoryViewSnapshot() {
        const focus = state.selectedItemFocus?.key || '';
        const current = focus ? state.itemOfferDetails.get(focus) : null;
        const pending = state.detailPending?.key === focus;
        const queued = focus && (state.detailQueued.has(focus) ||
            state.detailQueue.some(job => job.key === focus));
        const previous = state.itemInventoryMemo;
        const same = previous &&
            previous.accountKey === state.orderJournal?.accountKey &&
            previous.itemSummary === state.itemSummary &&
            previous.catalog === state.catalog &&
            previous.itemNamesSize === state.itemNames.size &&
            previous.focus === focus &&
            previous.offerDetail === current &&
            previous.offerStatus === state.itemDetailStatus &&
            previous.pending === pending &&
            previous.queued === !!queued &&
            previous.collapsed === state.itemInventoryCollapsed &&
            previous.locale === currentLocale();
        if (same) return previous;
        const snapshot = {
            accountKey: state.orderJournal?.accountKey,
            itemSummary: state.itemSummary,
            catalog: state.catalog,
            itemNamesSize: state.itemNames.size,
            focus, offerDetail: current, offerStatus: state.itemDetailStatus,
            pending, queued: !!queued, collapsed: state.itemInventoryCollapsed,
            locale: currentLocale(),
            html: renderItemInventory()
        };
        state.itemInventoryMemo = snapshot;
        return snapshot;
    }

    function renderWatch(forceViewBuild = false) {
        const panel = q('#moth-market-watch-panel');
        if (!panel || !state.watchOpen) return;
        const locale = currentLocale();
        if (state.lastLocale !== locale) {
            state.lastLocale = locale;
            if (panel.dataset.mothWatchShell) delete panel.dataset.mothWatchShell;
            forceViewBuild = true;
        }
        const views = ['opportunities', 'inventory', 'pricing', 'economy', 'snatches', 'automation', 'activity'];
        if (!views.includes(state.watchView)) state.watchView = 'opportunities';

        if (!panel.dataset.mothWatchShell) {
            panel.innerHTML =
                '<div class="moth-mw-head"><div><h3>Moth Watch</h3><span class="moth-mw-status" id="moth-mw-status"></span></div>' +
                '<span class="moth-mw-spacer"></span><button type="button" class="moth-mw-btn" id="moth-mw-scan">' + escapeHtml(tr('Scan now')) + '</button></div>' +
                '<div class="moth-mw-overview" id="moth-mw-overview"></div>' +
                '<nav class="moth-mw-tabs" aria-label="' + escapeHtml(tr('Moth Watch views')) + '">' +
                '<button type="button" class="moth-mw-tab" data-moth-view="opportunities">' + escapeHtml(tr('Opportunities')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="inventory">' + escapeHtml(tr('Market inventory')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="pricing">' + escapeHtml(tr('Pokémon price evidence')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="economy">' + escapeHtml(tr('Economy & holdings')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="snatches" id="moth-mw-snatch-tab">' + escapeHtml(tr('Snatch queue')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="automation">' + escapeHtml(tr('Automation & budget')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="activity">' + escapeHtml(tr('Activity & references')) + '</button></nav>' +
                '<div class="moth-mw-workspace"><div id="moth-mw-view-content"></div></div>';
            panel.dataset.mothWatchShell = '1';
            bindWatchEvents(panel);
        }

        const baseline = state.watchView === 'activity' ? baselineStats() : null;
        const currencyFilter = ['gold', 'orb'].includes(config.viewCurrency) ? config.viewCurrency : 'all';
        const kindFilter = ['item', 'pokemon', 'diamond'].includes(config.viewKind) ? config.viewKind : 'all';
        const searchTerm = normalize(state.opportunitySearch);
        const candidates = Array.from(state.candidates.values()).filter(c => {
            if (searchTerm && ![c.name, c.seller, c.kind, c.listingId].some(value => normalize(value).includes(searchTerm))) return false;
            const manuallyLoaded = c.kind === 'item' && state.loadedItemKeys.has(String(c.itemId) + ':' + c.currency);
            // Unreferenced diamonds remain inspectable. Referenced diamonds must meet the watch threshold.
            // A missing or invalid reference is not evidence that a listing is
            // overpriced. Keep such offers visible for manual inspection.
            const referenceMissing = !(Number(c.average) > 0) || !Number.isFinite(Number(c.ratio));
            const visibleWithoutReference = manuallyLoaded || referenceMissing;
            return (visibleWithoutReference || c.ratio <= Math.max(0.01, Number(config.watchPercent) / 100)) && candidateVisible(c);
        });
        // Other tabs still display the matching-listing count, but do not pay
        // for sorting or price-reference formatting they never render.
        if (state.watchView === 'opportunities') candidates.sort(candidateSort);
        const captured = state.watchView === 'activity'
            ? (state.baseline.capturedAt ? new Date(state.baseline.capturedAt).toLocaleString(locale)
                : tr('no reference captured yet')) : '';

        const status = q('#moth-mw-status', panel);
        const statusText = tr('Items: {items} · Pokémon: {pokemon} · Diamonds: {diamonds}', {
            items: displayStatus(state.itemStatus), pokemon: displayStatus(state.pokemonStatus), diamonds: displayStatus(state.diamondStatus)
        });
        if (status && status.textContent !== statusText) status.textContent = statusText;

        const overview = q('#moth-mw-overview', panel);
        const countLabel = tr(candidates.length === 1 ? '1 matching listing' : '{count} matching listings', { count: num(candidates.length) });
        const snatchCounts = snatchQueueCounts();
        const armedTotal = snatchCounts.manual + snatchCounts.automatic;
        const snatchTab = q('#moth-mw-snatch-tab', panel);
        if (snatchTab) {
            const tabText = tr('Snatch queue · {count}', {count:num(armedTotal)});
            if (snatchTab.textContent !== tabText) snatchTab.textContent = tabText;
        }
        const overviewHtml = '<b>' + escapeHtml(countLabel) + '</b>' +
            '<span>' + num(state.gold) + ' ' + escapeHtml(tr('Coins')) + ' · ' + num(state.orbs) + ' ' + escapeHtml(tr('Gems')) + '</span>' +
            '<span>' + escapeHtml(tr('Watch threshold: {value}% of reference', { value: num(config.watchPercent) })) + '</span>' +
            '<span class="moth-mw-overview-automation">' + escapeHtml(tr('Automation: {summary}', { summary: automationOverviewSummary() })) + '</span>' +
            (armedTotal ? '<span class="moth-mw-overview-snatch">' + escapeHtml(tr('Snatches armed: {count}', {count:num(armedTotal)})) + '</span>' : '');
        if (overview && overview.innerHTML !== overviewHtml) overview.innerHTML = overviewHtml;

        for (const button of qa('[data-moth-view]', panel)) {
            button.setAttribute('aria-selected', button.dataset.mothView === state.watchView ? 'true' : 'false');
        }

        const content = q('#moth-mw-view-content', panel);
        const viewChanged = content.dataset.view !== state.watchView;
        const settingsSignature = state.watchView === 'automation'
            ? JSON.stringify(Object.keys(DEFAULTS).sort().map(key => [key, config[key]])) : '';
        const settingsChanged = state.watchView === 'automation' && !viewChanged &&
            content.dataset.settingsSignature !== settingsSignature &&
            !(content.contains(document.activeElement) && document.activeElement.matches('input, select, textarea'));
        if (forceViewBuild || viewChanged || settingsChanged) {
            content.dataset.view = state.watchView;
            if (state.watchView === 'opportunities') {
                content.innerHTML =
                    '<div class="moth-mw-filters" id="moth-mw-opportunity-filters">' +
                    '<input type="search" id="moth-mw-search" aria-label="' + escapeHtml(tr('Search listings')) + '" placeholder="' + escapeHtml(tr('Search item, Pokémon, seller…')) + '" value="' + escapeHtml(state.opportunitySearch) + '">' +
                    '<div class="moth-mw-filter-group"><span class="moth-mw-filter-label">' + escapeHtml(tr('Currency')) + '</span>' +
                    filterButton('All', 'currency', 'all', currencyFilter === 'all', '') +
                    filterButton('Coins', 'currency', 'gold', currencyFilter === 'gold', '/assets/site/assets/ui/moeda-ouro.png') +
                    filterButton('Gems', 'currency', 'orb', currencyFilter === 'orb', '/img/moeda-gema.png') + '</div>' +
                    '<div class="moth-mw-filter-group"><span class="moth-mw-filter-label">' + escapeHtml(tr('Type')) + '</span>' +
                    filterButton('All', 'kind', 'all', kindFilter === 'all', '') +
                    filterButton('Items', 'kind', 'item', kindFilter === 'item', '/assets/site/assets/ui/menu-bolsa.png') +
                    filterButton('Pokémon', 'kind', 'pokemon', kindFilter === 'pokemon', '/assets/site/assets/ui/ball-poke.png') +
                    filterButton('Diamonds', 'kind', 'diamond', kindFilter === 'diamond', '/img/moeda-gema.png') + '</div>' +
                    sortSelect() + '</div>' +
                    '<div class="moth-mw-inventory-note">' +
                    escapeHtml(tr('Showing discounted offers and listings without reliable price references. This is not the full market; use Market inventory to inspect other items. Shiny Pokémon require Gems.')) +
                    '</div>' +
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Opportunities')) + '</h4><span id="moth-mw-opportunity-count"></span></div>' +
                    '<div class="moth-mw-list" id="moth-mw-opportunity-list"></div>';
            } else if (state.watchView === 'inventory') {
                content.innerHTML = '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Market inventory')) + '</h4><span>' +
                    escapeHtml(tr('Browse item types, then load the offers for a selected currency.')) + '</span></div><div id="moth-mw-inventory-content"></div>';
            } else if (state.watchView === 'pricing') {
                content.innerHTML = '<div class="moth-mw-section-title"><h4>' +
                    escapeHtml(tr('Pokémon price evidence')) + '</h4><span>' +
                    escapeHtml(tr('Read-only completed-sale comparisons. No purchase authorization.')) +
                    '</span></div><div id="moth-mw-pricing-list"></div>';
            } else if (state.watchView === 'economy') {
                content.innerHTML = '<div class="moth-mw-section-title"><h4>' +
                    escapeHtml(tr('Economy & holdings')) + '</h4><span>' +
                    escapeHtml(tr('Read-only fees, market eligibility, and recorded purchase exposure.')) +
                    '</span></div><div id="moth-mw-economy"></div>';
            } else if (state.watchView === 'snatches') {
                content.innerHTML =
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Snatch queue')) +
                    '</h4><span>' + escapeHtml(tr('Pre-armed purchases · no scan required at unlock')) + '</span></div>' +
                    '<p class="moth-mw-snatch-explainer">' +
                    escapeHtml(tr('Click Snatch beside a market listing to authorize one exact listing at or below its shown price. A matching enabled buying rule can also arm held listings automatically.')) +
                    '</p>' +
                    '<p class="moth-mw-snatch-feedback" id="moth-mw-snatch-feedback" role="status" aria-live="polite"></p>' +
                    '<div id="moth-mw-snatch-list" aria-live="off"></div>' +
                    '<p class="moth-mw-rule-hint">' +
                    escapeHtml(tr('The game tab must remain connected. The server decides availability; competing buyers may win. Unknown purchase outcomes block retries.')) +
                    '</p>';
            } else if (state.watchView === 'automation') {
                content.innerHTML =
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Automation status')) + '</h4><span>' +
                    escapeHtml(tr('Review the systems that can place market orders, then set spending safeguards and advanced monitoring.')) + '</span></div>' +
                    automationNoticeHtml() + automationStatusPanelHtml() +
                    '<section class="moth-mw-settings-card moth-mw-budget-card"><h4>' + escapeHtml(tr('Optional spending limits')) + '</h4>' +
                    '<p class="moth-mw-rule-hint">' +
                    escapeHtml(tr('Your explicit price rules decide which listings to buy. A cumulative limit of 0 adds no cap.')) +
                    '</p><div class="moth-mw-config">' +
                    configField('Keep Coins in reserve', 'goldReserve', 'number', '') +
                    configField('Keep Gems in reserve', 'gemReserve', 'number', '') +
                    configField('Maximum Coins per purchase', 'maxCoinsPerBuy', 'number', '0 = no extra cap') +
                    configField('Maximum Gems per purchase', 'maxGemsPerBuy', 'number', '0 = no extra cap') +
                    configField('Maximum Coins per session', 'maxCoinsPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Gems per session', 'maxGemsPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Coins per UTC day', 'maxCoinsPerDay', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Gems per UTC day', 'maxGemsPerDay', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum purchases per session', 'maxPurchasesPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum units per session', 'maxQuantityPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Pause all purchases (kill switch)', 'purchasesPaused', 'checkbox') +
                    '</div><p class="moth-mw-rule-hint">' + escapeHtml(tr('Includes reserved unverified orders. 0 means unlimited; per-purchase caps are separate.')) +
                    '</p></section>' +
                    fixedRulesHtml() + categoryRulesHtml('any') + categoryRulesHtml('pokemon') +
                    '<details class="moth-mw-advanced"><summary>' + escapeHtml(tr('Advanced monitoring & references')) +
                    '</summary><div class="moth-mw-advanced-body"><p class="moth-mw-advanced-note">' +
                    escapeHtml(tr('Scanning controls only. Price thresholds for suggestions never authorize or restrict your explicit buying rules.')) +
                    '</p><div class="moth-mw-settings-grid"><section class="moth-mw-settings-card"><h4>' + escapeHtml(tr('Watch rules')) +
                    '</h4><div class="moth-mw-config">' + configField('Watch price threshold', 'watchPercent', 'range', '%') +
                    configField('Scan interval', 'scanSeconds', 'number', 'seconds') + configField('Watch items', 'scanItems', 'checkbox') +
                    configField('Watch Pokémon', 'scanPokemon', 'checkbox') + configField('Watch diamonds', 'scanDiamonds', 'checkbox') +
                    '</div></section></div></div></details>';
            } else {
                content.innerHTML =
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Price references')) + '</h4><span>' +
                    escapeHtml(tr('Inspect market-price evidence independently of your buying rules.')) + '</span></div>' +
                    '<section class="moth-mw-settings-card"><h4>' + escapeHtml(tr('Valuation sample settings (not buying limits)')) +
                    '</h4><p class="moth-mw-rule-hint">' + escapeHtml(tr('These settings affect price estimates and deal discovery only. Rules such as “buy any item below 10,000 Coins” never require historical sales.')) +
                    '</p><div class="moth-mw-config">' +
                    configField('Sold item units for estimate confidence', 'minItemUnits', 'number', '') +
                    configField('Comparable Pokémon sales for price estimates', 'minPokemonSamples', 'number', '') +
                    configField('Pokémon history pages', 'pokemonHistoryPages', 'number', '') +
                    '</div></section>' +
                    '<div class="moth-mw-reference-tools" id="moth-mw-reference-tools"></div>' +
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Recent activity')) + '</h4><span>' +
                    escapeHtml(tr('Purchase attempts, confirmations, and errors.')) + '</span></div>' +
                    '<div class="moth-mw-log" id="moth-mw-activity-log"></div>' +
                    '<p class="moth-mw-rule-hint">' +
                    escapeHtml(tr('Armed targets have moved to the Snatch queue tab.')) +
                    ' <button type="button" class="moth-mw-btn" data-moth-goto="snatches">' +
                    escapeHtml(tr('Open Snatch queue')) + '</button></p>' +
                    '<section class="moth-mw-automation-block"><h4>' + escapeHtml(tr('Redacted diagnostics (opt-in)')) + '</h4>' +
                    '<p class="moth-mw-rule-hint">' +
                    escapeHtml(tr('Disabled by default. When on, keeps only 64 schema/count samples in memory. Never records packet values, seller names, listing IDs, credentials or private settings.')) +
                    '</p><div class="moth-mw-rule-add-actions">' +
                    '<button type="button" class="moth-mw-btn" id="moth-mw-diagnostics-toggle"></button>' +
                    '<button type="button" class="moth-mw-btn" id="moth-mw-diagnostics-copy">' +
                    escapeHtml(tr('Copy sanitized report')) + '</button>' +
                    '<button type="button" class="moth-mw-btn" id="moth-mw-diagnostics-reset">' +
                    escapeHtml(tr('Reset counters')) + '</button></div>' +
                    '<p id="moth-mw-diagnostics-summary" class="moth-mw-rule-hint"></p></section>';
            }
            if (state.watchView === 'automation') content.dataset.settingsSignature = settingsSignature;
        }

        if (state.watchView === 'opportunities') {
            const filterHost = q('#moth-mw-opportunity-filters', content);
            for (const button of qa('[data-moth-filter]', filterHost)) {
                const active = (button.dataset.mothFilter === 'currency' ? currencyFilter : kindFilter) === button.dataset.mothValue;
                button.classList.toggle('on', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            const sort = q('#moth-mw-sort', content);
            if (sort && sort.value !== config.viewSort) sort.value = config.viewSort;
            const count = q('#moth-mw-opportunity-count', content);
            if (count) count.textContent = tr('{count} matching listings · purchases are serialized while awaiting server confirmation', { count: num(candidates.length) });
            const list = q('#moth-mw-opportunity-list', content);
            updateCandidateRows(list, candidates);
        } else if (state.watchView === 'inventory') {
            const host = q('#moth-mw-inventory-content', content);
            const snapshot = inventoryViewSnapshot();
            if (host && (viewChanged || forceViewBuild ||
                state.lastInventoryPaint !== snapshot)) {
                const oldScroller = q('.moth-mw-inventory-list', host);
                const scrollTop = oldScroller ? oldScroller.scrollTop : 0;
                host.innerHTML = snapshot.html;
                state.lastInventoryPaint = snapshot;
                const newScroller = q('.moth-mw-inventory-list', host);
                if (newScroller) newScroller.scrollTop = scrollTop;
            }
        } else if (state.watchView === 'pricing') {
            const host = q('#moth-mw-pricing-list', content);
            const html = renderPokemonPriceEvidence();
            if (host && host.innerHTML !== html) host.innerHTML = html;
        } else if (state.watchView === 'economy') {
            const host = q('#moth-mw-economy', content);
            const html = renderEconomyDashboard();
            if (host && host.innerHTML !== html && !host.contains(document.activeElement)) host.innerHTML = html;
        } else if (state.watchView === 'automation') {
            refreshAutomationLive(content);
        } else if (state.watchView === 'snatches') {
            const feedback = q('#moth-mw-snatch-feedback', content);
            if (feedback && feedback.textContent !== state.snatchNotice)
                feedback.textContent = state.snatchNotice;
            const snatchHost = q('#moth-mw-snatch-list', content);
            if (snatchHost) {
                const snatchHtml = snatchQueueHtml();
                if (snatchHost.innerHTML !== snatchHtml) {
                    const focused = snatchHost.contains(document.activeElement)
                        ? document.activeElement.getAttribute('data-moth-snatch') : null;
                    const scroll = snatchHost.scrollTop;
                    snatchHost.innerHTML = snatchHtml;
                    snatchHost.scrollTop = scroll;
                    if (focused) {
                        const restored = qa('[data-moth-snatch]', snatchHost)
                            .find(button => button.dataset.mothSnatch === focused);
                        if (restored) restored.focus({preventScroll:true});
                        else q('#moth-mw-snatch-tab', panel)?.focus({preventScroll:true});
                    }
                }
            }
        } else if (state.watchView === 'activity') {
            const refs = q('#moth-mw-reference-tools', content);
            const html = '<div class="moth-mw-reference-info"><b>' + escapeHtml(tr('Item references:')) + '</b> ' +
                escapeHtml(tr('live server 7-day averages with a saved fallback captured')) + ' ' + escapeHtml(captured) + '. ' +
                num(baseline.items) + escapeHtml(tr(' item types; ')) + num(baseline.gold) + escapeHtml(tr(' Coin references; ')) +
                num(baseline.orb) + escapeHtml(tr(' Gem references.')) + '<br>' + escapeHtml(tr('Suspicious prices: ')) +
                num(state.itemScanStats.goldSuspicious) + '/' + num(state.itemScanStats.goldChecked) + escapeHtml(tr(' Coin · ')) +
                num(state.itemScanStats.orbSuspicious) + '/' + num(state.itemScanStats.orbChecked) + escapeHtml(tr(' Gem.')) + '</div>' +
                '<button type="button" class="moth-mw-btn" id="moth-mw-refresh-baseline">' + escapeHtml(tr('Refresh saved fallback')) + '</button>' +
                '<button type="button" class="moth-mw-btn" id="moth-mw-export-baseline">' + escapeHtml(tr('Copy reference data')) + '</button>';
            if (refs && refs.innerHTML !== html) refs.innerHTML = html;
            const log = q('#moth-mw-activity-log', content);
            const logHtml = state.buyLog.length ? state.buyLog.map(row =>
                '<div>' + new Date(row.at).toLocaleTimeString(currentLocale()) + ' · ' + escapeHtml(translateLog(row.text)) + '</div>').join('') :
                '<div>' + escapeHtml(tr('No purchase attempts recorded this session.')) + '</div>';
            if (log && log.innerHTML !== logHtml) log.innerHTML = logHtml;
            const diagButton = q('#moth-mw-diagnostics-toggle', content);
            if (diagButton) diagButton.textContent = tr(state.diagnostics?.enabled
                ? 'Stop diagnostics' : 'Start diagnostics');
            const diagText = q('#moth-mw-diagnostics-summary', content);
            if (diagText) diagText.textContent = tr('Diagnostic packets: {count} · recent shapes: {samples} · collection: {status}', {
                count: num(state.diagnostics?.count || 0),
                samples: num(state.diagnostics?.samples?.length || 0),
                status: tr(state.diagnostics?.enabled ? 'ON' : 'OFF')
            });
        }
    }
