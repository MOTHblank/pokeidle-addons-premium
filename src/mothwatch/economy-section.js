    function itemProvenance(itemId) {
        const id = Number(itemId);
        const item = Number.isSafeInteger(id) && id > 0 ? state.catalog.get(id) : null;
        const rawCategory = item && (item.categoria ?? item.category ?? item.tipo);
        const category = typeof rawCategory === 'string' && rawCategory.trim()
            ? rawCategory.trim().slice(0, 60) : null;
        const observed = !!item;
        const declared = typeof item?.vendavelRmt === 'boolean' ? item.vendavelRmt :
            typeof item?.marketEligible === 'boolean' ? item.marketEligible : null;
        // Presence in a catalogue is proof of catalogue membership, not proof
        // of the game's current seller-side whitelist or NPC sell price.
        return {
            id: Number.isSafeInteger(id) && id > 0 ? id : null,
            category, source: observed ? 'welcome.mercado.catalogo' : 'none',
            inMarketCatalog: observed,
            marketEligible: declared === true ? true : declared === false ? false : null,
            npcSellable: typeof item?.vendavelNpc === 'boolean' ? item.vendavelNpc : null,
            npcPrice: item?.vendavelNpc === true &&
                Number.isSafeInteger(Number(item.npcPrice)) && Number(item.npcPrice) > 0
                ? Number(item.npcPrice) : null
        };
    }

    function diamondProvenance(origin) {
        // In-game eligibility is server-side provenance, not a quantity test.
        // A diamond purchased from another player is not automatically resellable.
        return origin === 'pix' || origin === 'card' ?
            { eligibility: 'server verification required', origin } :
            { eligibility: 'not established for resale', origin: origin || 'unknown' };
    }

    function marketplaceFee(gross, currency, kind, days = 0) {
        if (!Number.isSafeInteger(gross) || gross <= 0 ||
            !['gold', 'orb'].includes(currency) ||
            !['item', 'pokemon', 'diamond'].includes(kind)) return null;
        // Integer basis points, with ONE upward rounding of the entire fee.
        // BigInt prevents float-off-by-one errors at 500 / 5,000 Gem borders.
        const amount = BigInt(gross);
        const ceilBasisPoints = weightedBp => (weightedBp + 9999n) / 10000n;
        const exact = currency === 'orb';
        let cost = null;
        if (currency === 'orb') {
            if (kind === 'pokemon') {
                const first = amount < 500n ? amount : 500n;
                const second = amount > 500n
                    ? (amount - 500n < 4500n ? amount - 500n : 4500n) : 0n;
                const third = amount > 5000n ? amount - 5000n : 0n;
                cost = ceilBasisPoints(first * 1300n + second * 1000n + third * 750n);
            } else cost = ceilBasisPoints(amount * 1500n);
        }
        // Coin fee is 15% but exact server rounding remains unverified.
        const lowFee = exact ? Number(cost) : Number(amount * 1500n / 10000n);
        const highFee = exact ? Number(cost) :
            Number((amount * 1500n + 9999n) / 10000n);
        const validDays = kind === 'pokemon' && Number.isSafeInteger(days) && days >= 1 && days <= 30
            ? days : null;
        return {
            currency, kind, buyerGross: gross, listingGross: gross,
            fee: exact ? lowFee : null,
            feeMin: lowFee, feeMax: highFee,
            sellerNet: exact ? gross - lowFee : null,
            netMin: gross - highFee, netMax: gross - lowFee,
            exact, holdingCoins: validDays === null ? null : 100000 * validDays,
            holdingDays: validDays
        };
    }

    function loadEconomyHoldings() {
        if (!state.nick || !state.orderJournal?.accountKey) return [];
        try {
            const data = JSON.parse(localStorage.getItem(
                ECONOMY_HOLDINGS_KEY + ':' + state.orderJournal.accountKey) || 'null');
            if (!data || data.version !== 1 || !Array.isArray(data.items)) return [];
            return data.items.slice(0, 40).filter(row =>
                Number.isSafeInteger(row.itemId) && row.itemId > 0 &&
                Number.isSafeInteger(row.quantity) && row.quantity > 0 &&
                row.quantity <= 1000000000 && ['gold', 'orb'].includes(row.currency));
        } catch { return []; }
    }

    function saveEconomyHoldings() {
        if (!state.nick || !state.orderJournal?.accountKey) return false;
        try {
            localStorage.setItem(ECONOMY_HOLDINGS_KEY + ':' + state.orderJournal.accountKey,
                JSON.stringify({ version: 1, savedAt: Date.now(),
                    source: 'user-entered (not game inventory)', items: state.economyHoldings }));
            return true;
        } catch { return false; }
    }

    function setEconomyHolding(itemId, quantity, currency) {
        const id = Number(itemId), qty = Number(quantity);
        if (!state.nick || !state.orderJournal?.accountKey ||
            !Number.isSafeInteger(id) || id <= 0 ||
            !Number.isSafeInteger(qty) || qty < 0 || qty > 1000000000 ||
            !['gold', 'orb'].includes(currency)) return false;
        // No fake price for an item absent from the authenticated market catalog.
        if (qty > 0 && !itemProvenance(id).inMarketCatalog) return false;
        state.economyHoldings = state.economyHoldings.filter(row => row.itemId !== id);
        if (qty > 0) {
            if (state.economyHoldings.length >= 40) return false;
            state.economyHoldings.push({itemId:id, quantity:qty, currency});
        }
        return saveEconomyHoldings();
    }

    function heldItemReference(itemId, currency) {
        const provenance = itemProvenance(itemId);
        if (!provenance.inMarketCatalog || provenance.marketEligible === false ||
            !['gold', 'orb'].includes(currency)) return null;
        const live = itemMediaFor(itemId)?.[currency];
        const average = Number(live?.media), units = Number(live?.unidades);
        const age = Date.now() - state.itemSummaryAt;
        if (!(age >= 0 && age <= ECONOMY_REFERENCE_FRESH_MS) ||
            !Number.isFinite(average) || average <= 0 ||
            !Number.isSafeInteger(units) || units < 3) return null;
        // A completed-sale mean, never an ask or guaranteed liquidation quote.
        return { average, units, currency, source: 'market.itens.medias (7d completed-sales)',
            capturedAt: state.itemSummaryAt, ageMinutes: Math.floor(age / 60000) };
    }

    function economyHoldingsSnapshot() {
        const result = { gold: 0, orb: 0, estimated: 0, unknown: 0, entries: [] };
        for (const holding of state.economyHoldings.slice(0, 40)) {
            const ref = heldItemReference(holding.itemId, holding.currency);
            const total = ref ? ref.average * holding.quantity : null;
            const valid = Number.isFinite(total) && total > 0 && total <= Number.MAX_SAFE_INTEGER;
            const estimated = valid ? Math.round(total) : null;
            if (estimated == null) result.unknown++;
            else {
                result[holding.currency] += estimated;
                result.estimated++;
            }
            result.entries.push({ ...holding, provenance: itemProvenance(holding.itemId),
                reference: ref, estimated });
        }
        return result;
    }

    function acquisitionLedgerSummary() {
        const rows = state.orderJournal?.orders || [];
        const totals = {
            gold: { confirmed: 0, uncertain: 0, attempts: 0 },
            orb: { confirmed: 0, uncertain: 0, attempts: 0 }
        };
        for (const row of rows) {
            if (!totals[row.currency] || !Number.isSafeInteger(row.spend) || row.spend <= 0) continue;
            if (row.status === 'confirmed') {
                totals[row.currency].confirmed += row.spend;
                totals[row.currency].attempts++;
            } else if (['submitted', 'prepared', 'unknown'].includes(row.status)) {
                totals[row.currency].uncertain += row.spend;
                totals[row.currency].attempts++;
            }
        }
        // Quoted maximum spend, NOT settlement receipts or realized P&L.
        return totals;
    }

    function readEconomyTelemetry() {
        // Optional versioned bridge *read once on view render*. No observers,
        // additional socket subscriptions or market polling.
        let payload;
        try { payload = page.MOTH_ECONOMY_TELEMETRY_V1; } catch { return null; }
        if (!payload || payload.version !== 1 || payload.source !== 'session') return null;
        const age = Date.now() - Number(payload.capturedAt);
        const minutes = Number(payload.windowMinutes);
        if (!Number.isFinite(age) || age < 0 || age > ECONOMY_TELEMETRY_FRESH_MS ||
            !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) return null;
        const observed = payload.observed || {};
        const val = name => Number.isSafeInteger(observed[name]) && observed[name] >= 0
            ? observed[name] : null;
        const hunt = val('huntCoins'), npc = val('npcSaleCoins');
        const costs = ['ballsCoins', 'potionsCoins', 'revivesCoins'].map(val);
        // If the producer cannot tell whether NPC income is included,
        // we cannot safely compute a combined net amount.
        const includesNpc = payload.huntCoinsIncludesNpcSales;
        const net = hunt != null && costs.every(v => v != null) &&
            (includesNpc === true || includesNpc === false && npc != null)
            ? hunt + (includesNpc ? 0 : npc) - costs.reduce((a,b) => a+b,0) : null;
        const modeled = payload.modeled || {};
        const rareEv = Number.isFinite(modeled.rareDropExpectedUnitsPerHour) &&
            modeled.rareDropExpectedUnitsPerHour >= 0
            ? modeled.rareDropExpectedUnitsPerHour : null;
        return {
            source: 'opt-in session telemetry', ageMinutes: Math.floor(age / 60000),
            minutes, huntCoins:hunt, npcSaleCoins:npc, costs,
            netCoins:net, observedRareDrops:val('rareDropsUnits'),
            rareExpectedPerHour:rareEv
        };
    }

    function renderEconomyDashboard() {
        const stamp = JSON.stringify({
            account: state.orderJournal?.accountKey,
            updated: state.itemSummaryAt, config: state.economyInput,
            holdings: state.economyHoldings, orders: state.orderJournal?.orders?.length,
            language: currentLocale(), catalogSize: state.catalog.size,
            notice: state.economyNotice
        });
        if (state.economyUiCache?.stamp === stamp &&
            Date.now() - state.economyUiCache.at < 3000) return state.economyUiCache.html;
        const holdings = economyHoldingsSnapshot();
        const orders = acquisitionLedgerSummary();
        const input = state.economyInput;
        const feeGross = Number(input.feeUnit) * Number(input.feeQuantity);
        const fee = Number.isSafeInteger(feeGross) ? marketplaceFee(
            feeGross, input.feeCurrency, input.feeKind, input.holdingDays) : null;
        const currencyChoice = currency => ['gold','orb'].map(code =>
            '<option value="' + code + '"' + (code === currency ? ' selected' : '') + '>' +
            escapeHtml(tr(code === 'orb' ? 'Gems' : 'Coins')) + '</option>').join('');
        const field = (key,value,min=0) =>
            '<label class="moth-mw-economy-field"><span>' + escapeHtml(tr({
                quantity:'Quantity',feeUnit:'Unit price',feeQuantity:'Sale quantity',holdingDays:'Holding days'
            }[key] || key)) + '</span><input type="number" data-moth-economy-field="' + key + '" min="' + min +
            '" step="1" value="' + escapeHtml(value) + '"></label>';
        const live = readEconomyTelemetry();
        const ledgerRow = code => {
            const row = orders[code];
            return '<p>' + escapeHtml(tr(code === 'orb' ? 'Gems' : 'Coins')) +
                ': ' + num(row.confirmed) + ' ' + escapeHtml(tr('quoted confirmed purchase exposure')) +
                ' · ' + num(row.uncertain) + ' ' +
                escapeHtml(tr('unverified reserved exposure')) + '</p>';
        };
        const entries = holdings.entries.map(row =>
            '<div class="moth-mw-economy-entry"><b>' + escapeHtml(catalogName(row.itemId)) + '</b> ' +
            '×' + num(row.quantity) + ' · ' + escapeHtml(tr(row.currency === 'orb' ? 'Gems' : 'Coins')) +
            ' · ' + (row.estimated == null ? escapeHtml(tr('Unknown value (insufficient recent sales)'))
                : num(row.estimated) + ' ' + escapeHtml(tr('estimated asking-independent gross'))) +
            ' · ' + escapeHtml(tr('Catalog: {category}', {
                category: row.provenance.category || tr('unknown')
            })) + ' · ' + escapeHtml(tr('RMT sale eligibility: {status}', {
                status: tr(row.provenance.marketEligible === true ? 'verified from catalog' :
                    row.provenance.marketEligible === false ? 'excluded by catalog' : 'unverified')
            })) + ' · ' + escapeHtml(tr('NPC resale: {status}', {
                status: tr(row.provenance.npcSellable === true ? 'verified from catalog' :
                    row.provenance.npcSellable === false ? 'excluded by catalog' : 'unverified')
            })) + '<button class="moth-mw-btn" type="button" data-moth-holding-remove="' +
            row.itemId + '">' + escapeHtml(tr('Remove')) + '</button></div>'
        ).join('');
        const options = [...state.catalog.keys()].filter(id => Number.isSafeInteger(id) && id > 0)
            .slice(0, 1500).sort((a,b) => catalogName(a).localeCompare(catalogName(b), currentLocale()))
            .map(id => '<option value="' + id + '"' + (id === input.itemId ? ' selected' : '') +
                '>' + escapeHtml(catalogName(id)) + ' (#' + id + ')</option>').join('');
        const telemetry = !live ? '<p>' + escapeHtml(tr('No fresh versioned session telemetry connected. Farming profit remains unknown.')) + '</p>' :
            '<p>' + escapeHtml(tr('Observed {minutes} min session window · {age} min old', {
                minutes: num(live.minutes), age: num(live.ageMinutes)
            })) + '</p><p>' + escapeHtml(tr('Hunt Coins: {amount}', {
                amount: live.huntCoins == null ? '?' : num(live.huntCoins)
            })) + ' · ' + escapeHtml(tr('NPC auto-sales: {amount}', {
                amount: live.npcSaleCoins == null ? '?' : num(live.npcSaleCoins)
            })) + '</p><p>' + escapeHtml(tr('Consumables (balls/potions/revives): {amounts}', {
                amounts: live.costs.map(v => v == null ? '?' : num(v)).join(' / ')
            })) + ' · ' + escapeHtml(tr('Observed net: {amount} Coins', {
                amount: live.netCoins == null ? '?' : num(live.netCoins)
            })) + '</p><p>' + escapeHtml(tr('Observed rare drops: {count} units · Modeled EV: {rate} units/h', {
                count: live.observedRareDrops == null ? '?' : num(live.observedRareDrops),
                rate: live.rareExpectedPerHour == null ? '?' : live.rareExpectedPerHour.toFixed(2)
            })) + '</p>';
        const html = (state.economyNotice ? '<p class="moth-mw-rule-notice">' +
            escapeHtml(state.economyNotice) + '</p>' : '') +
            '<section class="moth-mw-economy-card"><h5>' +
            escapeHtml(tr('Recorded purchase exposure (not sale revenue)')) +
            '</h5>' + ledgerRow('gold') + ledgerRow('orb') +
            '<p>' + escapeHtml(tr('Confirmed means an authoritative buy acknowledgement; booked spend is the quoted maximum, not verified settlement.')) + '</p></section>' +
            '<section class="moth-mw-economy-card"><h5>' + escapeHtml(tr('User-entered holdings (optional)')) +
            '</h5><p>' + escapeHtml(tr('Manual quantities only. No inventory sync or automatic sale. Choose ONE valuation currency per item.')) +
            '</p><div class="moth-mw-economy-fields"><select id="moth-mw-holding-item">' +
            '<option value="0">' + escapeHtml(tr('Choose an item in the game market catalog')) + '</option>' +
            options + '</select>' + field('quantity',input.quantity,1) +
            '<select id="moth-mw-holding-currency">' + currencyChoice(input.holdingCurrency) + '</select>' +
            '<button type="button" class="moth-mw-btn" id="moth-mw-holding-save">' + escapeHtml(tr('Record quantity')) +
            '</button></div>' + (entries || '<p>' + escapeHtml(tr('No holdings entered.')) + '</p>') +
            '<p><b>' + num(holdings.gold) + '</b> ' + escapeHtml(tr('Coins')) + ' · <b>' +
            num(holdings.orb) + '</b> ' + escapeHtml(tr('Gems')) + ' · ' +
            escapeHtml(tr('{count} unknown-value assets', {count:holdings.unknown})) + '</p>' +
            '<p>' + escapeHtml(tr('Diamond resale is not inferred: purchased-from-player and reward Diamonds are not equivalent to server-verified eligible first-party Diamonds.')) + '</p>' +
            '<p>' + escapeHtml(tr('Separate hypothetical 7-day sold-price averages; NOT wallet balance, proceeds, NPC value or instant liquidity. Only live references with 3+ sold units and under 24h age qualify.')) +
            '</p></section>' +
            '<section class="moth-mw-economy-card"><h5>' + escapeHtml(tr('Seller fee simulator (read-only)')) +
            '</h5><div class="moth-mw-economy-fields"><select id="moth-mw-fee-kind">' +
            ['item','pokemon','diamond'].map(kind => '<option value="' + kind + '"' +
                (kind === input.feeKind ? ' selected' : '') + '>' +
                escapeHtml(tr(kind === 'pokemon' ? 'Pokémon' : kind === 'diamond' ? 'Diamonds' : 'Items')) +
                '</option>').join('') + '</select><select id="moth-mw-fee-currency">' +
            currencyChoice(input.feeCurrency) + '</select>' + field('feeUnit',input.feeUnit,1) +
            field('feeQuantity',input.feeQuantity,1) + field('holdingDays',input.holdingDays,1) +
            '<button type="button" class="moth-mw-btn" id="moth-mw-fee-calc">' +
            escapeHtml(tr('Calculate fee')) + '</button></div><p>' +
            (fee ? escapeHtml(tr('Buyer gross: {gross} · Seller fee: {fee} · Seller net: {net}', {
                gross: num(fee.buyerGross),
                fee: fee.exact ? num(fee.fee) : num(fee.feeMin) + '–' + num(fee.feeMax),
                net: fee.exact ? num(fee.sellerNet) : num(fee.netMin) + '–' + num(fee.netMax)
            })) + (fee.exact ? '' : ' · ' + escapeHtml(tr('Coin rounding unverified'))) +
            (fee.holdingCoins == null ? '' : ' · ' + escapeHtml(tr('Optional upfront Pokémon holding: {cost} Coins', {
                cost: num(fee.holdingCoins)
            }))) : escapeHtml(tr('Select a valid positive integer sale total'))) + '</p>' +
            '<p>' + escapeHtml(tr('Fees are deducted from seller proceeds, never added to the buyer price. Holding is paid up front in Coins. No sale is simulated or executed.')) +
            '</p></section>' +
            '<section class="moth-mw-economy-card"><h5>' + escapeHtml(tr('Farming context (optional telemetry)')) +
            '</h5>' + telemetry + '<p>' + escapeHtml(tr('Observed and modeled quantities are separate; no rare-drop EV, inventory value or NPC auto-sale is silently added to realized profit.')) +
            '</p></section>';
        state.economyUiCache = { stamp, at: Date.now(), html };
        return html;
    }
