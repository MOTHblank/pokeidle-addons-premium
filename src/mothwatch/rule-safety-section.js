    function broadRuleUnbounded(rule) {
        if (!rule?.buyEnabled || !(Number(rule.buyMax) > 0) ||
            !['gold', 'orb'].includes(rule.currency)) return false;
        const currencyCaps = rule.currency === 'orb'
            ? [config.maxGemsPerSession, config.maxGemsPerDay]
            : [config.maxCoinsPerSession, config.maxCoinsPerDay];
        return ![...currencyCaps, config.maxPurchasesPerSession, config.maxQuantityPerSession,
            rule.maxSpendSession, rule.maxSpendDay,
            rule.maxPurchasesSession, rule.maxQuantitySession]
            .some(limit => Number.isFinite(Number(limit)) && Number(limit) > 0);
    }

    function enabledUnboundedBroadRules() {
        return [
            ...sanitizeAnyItemRules(config.anyItemRules),
            ...sanitizePokemonBuyRules(config.pokemonBuyRules)
        ].filter(broadRuleUnbounded);
    }

    function confirmUnboundedRule(rule) {
        if (!broadRuleUnbounded(rule)) return true;
        return window.confirm(tr('Warning: this broad rule has no cumulative spending or purchase-count limit. If enabled, it may repeatedly spend the available {currency}. Continue?', {
            currency: tr(rule.currency === 'orb' ? 'Gems' : 'Coins')
        }));
    }

    function confirmUnboundedMaster() {
        const rules = enabledUnboundedBroadRules();
        if (!rules.length) return true;
        return window.confirm(tr('Warning: enabling the master switch activates {count} broad buying rules without cumulative caps. Available balances may be spent repeatedly. Continue?', {
            count: rules.length
        }));
    }

    function ruleRiskSummary(rule, type) {
        const priceType = type === 'pokemon' ? 'per Pokémon' : 'per unit';
        const pages = type === 'pokemon'
            ? 'Up to three cheapest-price pages per currency when buying; not exhaustive.'
            : type === 'any'
                ? 'Market summary shortlists item types; detail offers are refreshed at a bounded rate.'
                : 'Only offers of this item in the chosen currency.';
        const cap = broadRuleUnbounded(rule)
            ? 'No cumulative cap: repeated purchases may exhaust available currency.'
            : 'Some cumulative spend/count limit is configured.';
        return tr('Maximum {amount} {currency} {unit}. {pages} {risk}', {
            amount: num(rule.buyMax), currency: tr(rule.currency === 'orb' ? 'Gems' : 'Coins'),
            unit: tr(priceType), pages: tr(pages), risk: tr(cap)
        });
    }
