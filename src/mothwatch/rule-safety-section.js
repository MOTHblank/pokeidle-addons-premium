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
        return true; // Explicit per-listing price ceiling is the chosen authorization.
    }

    function confirmUnboundedMaster() {
        const rules = enabledUnboundedBroadRules();
        if (!rules.length) return true;
        return true; // The user explicitly opted into these configured rules.
    }

    function confirmRemovingLastBroadCap() {
        return true; // Zero cumulative cap is supported.
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
