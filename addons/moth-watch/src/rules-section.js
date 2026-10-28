    function sanitizeRuleCaps(rule) {
        const number = key => {
            const n = Number(rule?.[key]);
            return Number.isSafeInteger(n) && n > 0 ? n : 0;
        };
        return {
            maxSpendSession: number('maxSpendSession'),
            maxSpendDay: number('maxSpendDay'),
            maxPurchasesSession: number('maxPurchasesSession'),
            maxQuantitySession: number('maxQuantitySession')
        };
    }

    function sanitizeFixedItemRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const itemId = Math.floor(Number(rule?.itemId));
            if (!(itemId > 0)) return null;
            return {
                id: String(rule?.id || ('fixed-' + index + '-' + itemId)),
                itemId,
                currency: rule?.currency === 'orb' ? 'orb' : 'gold',
                // Old saved rules without an explicit Buy opt-in must remain off.
                buyEnabled: rule?.buyEnabled === true && Number(rule?.buyMax) > 0,
                buyMax: Math.max(0, Math.floor(Number(rule?.buyMax) || 0)),
                ...sanitizeRuleCaps(rule),
            };
        }).filter(Boolean);
    }


    function sanitizeAnyItemRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const buyMax = Math.floor(Number(rule?.buyMax));
            if (!Number.isSafeInteger(buyMax) || buyMax <= 0) return null;
            return { id: String(rule?.id || 'any-item-' + index),
                currency: rule?.currency === 'orb' ? 'orb' : 'gold',
                buyMax, buyEnabled: rule?.buyEnabled === true, ...sanitizeRuleCaps(rule) };
        }).filter(Boolean);
    }

    function sanitizePokemonBuyRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const buyMax = Math.floor(Number(rule?.buyMax));
            const kind = ['any', 'shiny', 'p5'].includes(rule?.kind) ? rule.kind : null;
            const currency = rule?.currency === 'orb' ? 'orb' : 'gold';
            if (!Number.isSafeInteger(buyMax) || buyMax <= 0 || !kind ||
                (kind === 'shiny' && currency !== 'orb')) return null;
            return { id: String(rule?.id || 'pokemon-' + index), kind, currency,
                buyMax, buyEnabled: rule?.buyEnabled === true, ...sanitizeRuleCaps(rule) };
        }).filter(Boolean);
    }

    function activeAnyItemRules() {
        return config.enabled && config.fixedRulesEnabled
            ? sanitizeAnyItemRules(config.anyItemRules).filter(rule => rule.buyEnabled) : [];
    }

    function activePokemonRules() {
        return config.enabled && config.fixedRulesEnabled
            ? sanitizePokemonBuyRules(config.pokemonBuyRules).filter(rule => rule.buyEnabled) : [];
    }

    function hasAnyBuyingRules() {
        return config.enabled && config.fixedRulesEnabled &&
            (sanitizeFixedItemRules(config.fixedItemRules).some(rule => rule.buyEnabled && rule.buyMax > 0) ||
                activeAnyItemRules().length > 0 || activePokemonRules().length > 0);
    }


    // Account-profile-local journal; unknown orders are retained after reload.
    // Never infer success from a send(), an inventory delta, or a timeout.
