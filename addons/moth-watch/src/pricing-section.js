    function levelBand(level) {
        const n = Number(level || 0);
        if (n < 100) return 'lt100';
        if (n < 500) return '100-499';
        if (n < 1000) return '500-999';
        if (n < 5000) return '1000-4999';
        if (n < 10000) return '5000-9999';
        if (n < 25000) return '10000-24999';
        return '25000+';
    }

    function speciesIdOf(ficha) {
        const id = Number(ficha && (ficha.speciesId != null ? ficha.speciesId : ficha.pokeId));
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    function pokemonSpeciesName(ficha) {
        const suppliedName = String(
            ficha && (
                ficha.nome ||
                ficha.name ||
                ficha.speciesName ||
                ficha.pokemonNome ||
                ficha.especie?.nome ||
                ficha.pokemon?.nome ||
                ficha.pokemon?.name
            ) || ''
        ).trim();
        if (suppliedName) return suppliedName;

        const speciesId = speciesIdOf(ficha);
        return (speciesId && state.creatureNames.get(speciesId)) ||
            'Pokémon #' + (speciesId || '?');
    }

    function pokemonListingName(ficha) {
        const shiny = ficha?.shiny === true ? 'Shiny ' : '';
        const facts = pokemonFacts(ficha);
        return shiny + pokemonSpeciesName(ficha) +
            ' · P' + (facts.potency ?? '?') +
            ' · Lv ' + (facts.level ?? '?');
    }

    // PokéIdle v1.269.5: shiny Pokémon cannot be listed for Coins.
    // Do not mix historical Coin sales into shiny price references.
    function pokemonCurrencyAllowed(ficha, currency) {
        return currency === 'orb' || !ficha?.shiny;
    }

    // Non-identifying valuation facts. Missing metadata stays unknown.
    // Explicit forms are separate; absent form information is not assumed base.
    function pokemonForm(ficha) {
        const raw = ficha?.formId ?? ficha?.formaId;
        return (typeof raw === 'string' || Number.isSafeInteger(raw)) &&
            /^[a-z0-9_-]{1,36}$/i.test(String(raw)) ? String(raw) : null;
    }

    function pokemonIdentityKey(ficha, currency) {
        if (!['gold', 'orb'].includes(currency) || !pokemonCurrencyAllowed(ficha, currency)) return null;
        const speciesId = speciesIdOf(ficha);
        const potency = Number(ficha?.potencia);
        // Missing shiny is *not* non-Shiny. Require explicit server facts.
        if (!speciesId || typeof ficha?.shiny !== 'boolean' ||
            !Number.isSafeInteger(potency) || potency < 1 || potency > 5) return null;
        const form = pokemonForm(ficha);
        return currency + '|s:' + speciesId + '|f:' + (form == null ? '?' : form) +
            '|sh:' + (ficha.shiny ? 1 : 0) + '|p:' + potency;
    }

    function pokemonScore(ficha) {
        const raw = ficha?.nota;
        if (raw == null || raw === '') return null;
        const score = Number(raw);
        return Number.isFinite(score) && score >= 0 && score <= 10
            ? Math.round(score * 1000) / 1000 : null;
    }

    function pokemonQuality(ficha) {
        const raw = ficha?.qualidade ?? ficha?.quality;
        if (raw == null || raw === '') return null;
        const quality = Number(raw);
        return Number.isFinite(quality) && quality >= 0.8 && quality <= 1.8
            ? quality : null;
    }

    function pokemonIVs(ficha) {
        const raw = ficha?.ivs ?? ficha?.IVs;
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') return null;
        const aliases = [
            ['hp', 'HP'], ['atk', 'attack', 'ataque'], ['def', 'defense', 'defesa'],
            ['spAtk', 'spa', 'sp_atk', 'specialAttack', 'atkEsp'],
            ['spDef', 'spd', 'sp_def', 'specialDefense', 'defEsp'],
            ['speed', 'spe', 'velocidade']
        ];
        const values = aliases.map(names => {
            const name = names.find(key => Object.prototype.hasOwnProperty.call(raw, key));
            return name == null ? NaN : Number(raw[name]);
        });
        return values.every(iv => Number.isInteger(iv) && iv >= 1 && iv <= 32) ? values : null;
    }

    function pokemonRefinement(ficha) {
        const raw = ficha?.refino;
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') return null;
        const keys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
        if (!keys.every(key => Number.isSafeInteger(Number(raw[key])) && Number(raw[key]) >= 0)) return null;
        return keys.map(key => Number(raw[key]));
    }

    function pokemonCollectibles(ficha) {
        const flag = (...keys) => {
            const value = keys.map(key => ficha?.[key]).find(v => typeof v === 'boolean');
            return typeof value === 'boolean' ? value : null;
        };
        return {
            legendary: flag('lendario', 'legendary'),
            mythical: flag('mitico', 'mythical'),
            mega: flag('mega'),
            tmElemental: flag('tmElemental', 'tmElementalEquipada'),
            tmAoe: flag('tmAoe', 'tmAoeEquipada'),
            held: flag('heldItem', 'itemEquipado')
        };
    }

    function pokemonFacts(ficha) {
        const level = Number(ficha?.level);
        const ivs = pokemonIVs(ficha);
        const missing = [];
        if (!speciesIdOf(ficha)) missing.push('species');
        if (pokemonForm(ficha) == null) missing.push('form');
        if (typeof ficha?.shiny !== 'boolean') missing.push('shiny');
        if (!Number.isInteger(Number(ficha?.potencia)) || Number(ficha?.potencia) < 1 ||
            Number(ficha?.potencia) > 5) missing.push('potency');
        if (pokemonScore(ficha) == null) missing.push('N');
        if (pokemonQuality(ficha) == null) missing.push('Q');
        if (!ivs) missing.push('six named IVs');
        if (!pokemonRefinement(ficha)) missing.push('refinement');
        if (!(ficha?.level != null && Number.isFinite(level) && level > 0)) missing.push('level');
        return {
            speciesId: speciesIdOf(ficha), form: pokemonForm(ficha),
            shiny: typeof ficha?.shiny === 'boolean' ? ficha.shiny : null,
            potency: Number.isSafeInteger(Number(ficha?.potencia)) &&
                Number(ficha?.potencia) >= 1 && Number(ficha?.potencia) <= 5
                ? Number(ficha.potencia) : null,
            level: ficha?.level != null && Number.isFinite(level) && level > 0 ? level : null,
            levelBand: ficha?.level != null && Number.isFinite(level) && level > 0
                ? levelBand(level) : null,
            score: pokemonScore(ficha), quality: pokemonQuality(ficha), ivs,
            refinement: pokemonRefinement(ficha),
            traits: pokemonCollectibles(ficha),
            combatRole: pokemonCombatRole(ficha), missing
        };
    }

    // Role is an annotation only: actual equipped move categories if provided,
    // otherwise explicitly supplied base attacking stats. Never infer from a name
    // or use this to set an absolute buy ceiling.
    function pokemonCombatRole(ficha) {
        const rows = Array.isArray(ficha?.movimentosEquipados) ? ficha.movimentosEquipados :
            Array.isArray(ficha?.equippedMoves) ? ficha.equippedMoves : null;
        const categories = rows?.map(move =>
            String(move?.categoria ?? move?.category ?? '').toUpperCase());
        if (categories?.length && categories.every(c => c === 'PHYSICAL' || c === 'SPECIAL')) {
            const physical = categories.filter(c => c === 'PHYSICAL').length;
            const special = categories.length - physical;
            const role = physical && special ? 'mixed' : physical ? 'physical' : 'special';
            return { role, source: 'equipped move categories', confidence: 'observed',
                focus: role === 'mixed' ? ['atk', 'spAtk', 'speed'] :
                    role === 'physical' ? ['atk', 'speed'] : ['spAtk', 'speed'] };
        }
        const atk = Number(ficha?.baseAtk), special = Number(ficha?.baseSpAtk);
        if (Number.isFinite(atk) && atk > 0 && Number.isFinite(special) && special > 0) {
            const ratio = atk / special;
            const role = ratio >= 1.4 ? 'physical' : ratio <= 1 / 1.4 ? 'special' : 'mixed';
            return { role, source: 'provided base stats; moves unverified',
                confidence: 'indicative', focus: role === 'mixed' ? ['atk', 'spAtk', 'speed'] :
                    role === 'physical' ? ['atk', 'speed'] : ['spAtk', 'speed'] };
        }
        return { role: 'unknown', source: 'no verified equipped moves or bases',
            confidence: 'unknown', focus: [] };
    }

    // Date aliases are hypotheses until verified against deployed packets.
    // Do not substitute listing creation time or the time we fetched history.
    function pokemonSaleTime(line) {
        const raw = line?.vendidoEm ?? line?.soldAt;
        const value = typeof raw === 'string' && !/^\d+$/.test(raw)
            ? Date.parse(raw) : Number(raw);
        const millis = value > 1e9 && value < 1e11 ? value * 1000 : value;
        return Number.isFinite(millis) && millis > 1451606400000 &&
            millis <= Date.now() + 300000 ? millis : null;
    }

    function median(values) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function percentile(values, p) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
        const lower = Math.floor(position), upper = Math.ceil(position);
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    }

    function addPokemonHistorySample(line, working) {
        if (!line || line.tipo !== 'pokemon' || !line.ficha ||
            !['gold', 'orb'].includes(line.moeda)) return;
        const key = pokemonIdentityKey(line.ficha, line.moeda);
        if (!key) return;
        const price = Number(line.bruto != null ? line.bruto : line.preco);
        if (!Number.isSafeInteger(price) || price <= 0) return;
        const soldAt = pokemonSaleTime(line);
        if (soldAt && Date.now() - soldAt > POKEMON_SALE_WINDOW_MS) return;
        let sales = working.get(key);
        if (!sales) {
            sales = []; working.set(key, sales);
        }
        if (sales.length < 200) {
            sales.push({ price, ...pokemonFacts(line.ficha), soldAt,
                observedAt: Date.now(), source: 'completed-sale packet' });
        }
    }

    function finalizePokemonHistory(working) {
        const values = {};
        for (const [key, sales] of working) if (sales.length) values[key] = sales;
        state.pokemonReference = { version: 3, capturedAt: Date.now(), values };
        savePokemonReference();
        state.pokemonStatus = 'history ready';
        addLog('Pokémon reference refreshed: ' + Object.keys(values).length + ' buckets');
        queueRender();
    }

    function pokemonComparableSales(sales, listing, options) {
        const { level = true, grade = true, quality = false, ivs = false, refinement = false,
            gradeTolerance = 0.125, qualityTolerance = 0.15, traits = true } = options;
        return sales.filter(sale => {
            if (sale.soldAt && (Date.now() - sale.soldAt > POKEMON_SALE_WINDOW_MS ||
                sale.soldAt > Date.now() + 300000)) return false;
            if (traits) {
                for (const [field, value] of Object.entries(listing.traits || {})) {
                    const soldValue = sale.traits?.[field];
                    if (value != null && soldValue != null && value !== soldValue) return false;
                }
            }
            if (level && (!sale.levelBand || !listing.levelBand ||
                sale.levelBand !== listing.levelBand)) return false;
            if (grade) {
                if (listing.score == null || sale.score == null) return false;
                // Never cross the N=3.5 / 4.0 boundary (or any half-point grade boundary).
                if (Math.floor(listing.score * 2) !== Math.floor(sale.score * 2)) return false;
                if (Math.abs(listing.score - sale.score) > gradeTolerance) return false;
            }
            if (quality) {
                if (listing.quality == null || sale.quality == null ||
                    Math.abs(listing.quality - sale.quality) > qualityTolerance) return false;
            }
            if (ivs) {
                if (!listing.ivs || !sale.ivs ||
                    sale.ivs.some((iv, index) => Math.abs(iv - listing.ivs[index]) > 5)) return false;
            }
            if (refinement) {
                if (!listing.refinement || !sale.refinement ||
                    sale.refinement.some((value, index) => value !== listing.refinement[index])) return false;
            }
            return true;
        });
    }

    /*
     * A relative, read-only market model. The mechanics (P multipliers, grade,
     * Q, IV and leveling) determine ratios between specimens; the currency
     * scale still requires a quote in THAT currency. Rarity premiums below
     * are deliberately conservative valuation heuristics, not game rules.
     * Never feed this model into purchase authorization or bargain alerts.
     */
    function pokemonRelativeIndex(facts) {
        const p = Number(facts?.potency);
        if (!Number.isInteger(p) || p < 1 || p > 5) return null;
        const power = [0, 1, 1.05, 1.10, 1.25, 2][p];
        // Scarcity matters, but cannot be priced at inverse spawn probability.
        const scarcity = [0, 1, 1.16, 1.50, 2.65, 7.0][p];
        const n = facts.score == null ? 3.5 : Number(facts.score);
        const grade = Math.exp(Math.max(-2, Math.min(5, n - 3.5)) * 0.52);
        // N already includes Q and IV. Their extra premiums are intentionally
        // small to avoid counting the same stat gain two or three times.
        const q = facts.quality == null ? 1.2 : Number(facts.quality);
        const quality = Math.pow(Math.max(0.8, Math.min(1.8, q)) / 1.2, 0.35);
        let build = 1;
        if (Array.isArray(facts.ivs) && facts.ivs.length === 6) {
            const role = facts.combatRole?.role;
            const focus = role === 'physical' ? [1, 5] :
                role === 'special' ? [3, 5] : [1, 3, 5];
            const useful = focus.reduce((sum, i) => sum + Number(facts.ivs[i]), 0) / focus.length;
            if (Number.isFinite(useful))
                build = 1 + Math.max(-0.14, Math.min(0.14, (useful - 16.5) / 110));
        }
        const level = facts.level == null ? 50 : Math.max(1, Number(facts.level));
        const training = 1 + Math.min(0.75,
            Math.max(0, Math.log10(Math.max(50, level) / 50) * 0.22));
        const refinement = Array.isArray(facts.refinement)
            ? 1 + Math.min(0.4, facts.refinement.reduce((sum, n) =>
                sum + Math.max(0, Number(n) || 0), 0) / 100) : 1;
        const index = power * scarcity * grade * quality * build * training * refinement;
        return Number.isFinite(index) && index > 0 ? index : null;
    }

    function pokemonRelativeValue(ficha, currency, excludeListingId = null) {
        if (!['gold', 'orb'].includes(currency) || !pokemonCurrencyAllowed(ficha, currency))
            return null;
        const target = pokemonFacts(ficha);
        if (!target.speciesId || typeof target.shiny !== 'boolean') return null;
        const factor = pokemonRelativeIndex(target);
        if (!(factor > 0)) return null;
        const compatible = facts => facts &&
            facts.speciesId === target.speciesId &&
            facts.shiny === target.shiny &&
            // Unknown forms are usable only as broad, indicative anchors.
            !(facts.form != null && target.form != null && facts.form !== target.form);
        const normalizePrice = (price, facts) => {
            const factorAtSale = pokemonRelativeIndex(facts);
            const number = Number(price);
            return factorAtSale > 0 && Number.isFinite(number) && number > 0
                ? number / factorAtSale : null;
        };
        const current = [];
        const live = state.pokemonAutoOffers.get(currency);
        const liveFresh = live && Date.now() - Number(live.updatedAt || 0) < 6 * 3600000;
        if (liveFresh) {
            for (const offer of live.offers || []) {
                if (!offer?.ficha || (excludeListingId != null &&
                    String(offer.id) === String(excludeListingId))) continue;
                const facts = pokemonFacts(offer.ficha);
                if (!compatible(facts)) continue;
                const normalized = normalizePrice(offer.preco, facts);
                if (normalized != null) current.push(normalized);
            }
        }
        const completed = [];
        if (state.pokemonReference?.version === 3) {
            const prefix = currency + '|s:' + target.speciesId + '|';
            for (const [key, sales] of Object.entries(state.pokemonReference.values || {})) {
                if (!key.startsWith(prefix) || !Array.isArray(sales)) continue;
                for (const sale of sales) {
                    if (!compatible(sale) || (sale.soldAt &&
                        Date.now() - sale.soldAt > POKEMON_SALE_WINDOW_MS)) continue;
                    const normalized = normalizePrice(sale.price, sale);
                    if (normalized != null) completed.push(normalized);
                }
            }
        }
        if (!current.length && !completed.length) return null;
        // A few unusual listings must not drown out common current quotes.
        // Active market anchors lead; history merely steadies sparse pages.
        const askBase = current.length ? percentile(current, 0.40) : null;
        const soldBase = completed.length ? median(completed) : null;
        const askWeight = askBase == null ? 0 :
            soldBase == null ? 1 : current.length >= 3 ? 0.85 : 0.65;
        const base = askBase == null ? soldBase : soldBase == null ? askBase :
            askBase * askWeight + soldBase * (1 - askWeight);
        const value = Math.round(base * factor);
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        const all = current.length ? current : completed;
        const low = Math.max(1, Math.round(percentile(all, 0.20) * factor * 0.72));
        const high = Math.max(value, Math.round(percentile(all, 0.80) * factor * 1.32));
        const assumed = target.missing.filter(label =>
            ['N', 'Q', 'six named IVs', 'refinement', 'level', 'form'].includes(label));
        const confidence = current.length >= 3 && !assumed.includes('N')
            ? 'modeled' : 'rough';
        return {
            value, low: Math.min(low, value), high,
            currentCount: current.length, saleCount: completed.length,
            index: factor, source: 'relative market model', confidence, assumed,
            method: 'Prices of this species are normalized by P, grade, Q, IV build, level and refinement; live Coin/Gem asking prices establish each currency separately. Rarity coefficients are heuristic.'
        };
    }

    function pokemonReferenceFor(ficha, currency) {
        const key = pokemonIdentityKey(ficha, currency);
        if (!key) return null;
        const sales = state.pokemonReference?.version === 3
            ? state.pokemonReference.values?.[key] : null;
        if (!Array.isArray(sales) || !sales.length) return null;
        const requestedSamples = Number(config.minPokemonSamples);
        const minSamples = Number.isFinite(requestedSamples) && requestedSamples >= 1
            ? Math.max(1, Math.floor(requestedSamples)) : 3;
        const listing = pokemonFacts(ficha);
        const stages = [
            { name: 'Grade, level, quality, IVs and refinement', confidence: 'high',
                options: { quality: true, ivs: true, refinement: true } },
            { name: 'Grade, level, quality and IVs', confidence: 'high',
                options: { quality: true, ivs: true } },
            { name: 'Grade, level and quality', confidence: 'medium',
                options: { quality: true } },
            { name: 'Grade and level only', confidence: 'low',
                options: {} },
            { name: 'Wider grade neighborhood', confidence: 'low',
                options: { level: false, gradeTolerance: 0.25 }, actionable: false },
            { name: 'Broad species history only', confidence: 'context',
                options: { level: false, grade: false }, actionable: false }
        ];
        const attemptedStages = [];
        for (const stage of stages) {
            const matches = pokemonComparableSales(sales, listing, stage.options);
            attemptedStages.push({ name: stage.name, matches: matches.length });
            if (matches.length < minSamples) continue;
            const prices = matches.map(sale => sale.price).filter(value => Number.isFinite(value) && value > 0);
            if (prices.length < minSamples) continue;
            const value = median(prices);
            if (!(value > 0)) continue;
            const low = percentile(prices, 0.25), high = percentile(prices, 0.75);
            const dated = matches.map(sale => sale.soldAt).filter(at => Number.isFinite(at) && at > 0);
            const newestSoldAt = dated.length ? Math.max(...dated) : null;
            const oldestSoldAt = dated.length ? Math.min(...dated) : null;
            const ageDays = newestSoldAt == null ? null :
                Math.max(0, Math.floor((Date.now() - newestSoldAt) / 86400000));
            const dateCoverage = dated.length / matches.length;
            const dispersion = low > 0 ? high / low : Infinity;
            const traitCoverage = listing.form != null &&
                Object.values(listing.traits || {}).every(flag => flag != null) &&
                matches.every(sale => Object.values(sale.traits || {}).length === 6 &&
                    Object.values(sale.traits).every(flag => flag != null));
            const snapshotFresh = Number.isFinite(state.pokemonReference.capturedAt) &&
                state.pokemonReference.capturedAt > 0 &&
                Date.now() - state.pokemonReference.capturedAt <= 24 * 3600000;
            const recent = snapshotFresh && dateCoverage === 1 && newestSoldAt != null &&
                Date.now() - newestSoldAt <= POKEMON_HISTORY_FRESH_MS;
            const gradeMatched = stage.options.grade !== false && listing.score != null;
            const role = listing.combatRole;
            const matchingRole = role.role === 'unknown' ? [] : matches.filter(sale =>
                sale.combatRole?.role === role.role &&
                sale.combatRole?.confidence === 'observed');
            const ivPositions = { hp: 0, atk: 1, def: 2, spAtk: 3, spDef: 4, speed: 5 };
            const relevantIvGaps = role.focus.length && listing.ivs
                ? matchingRole.filter(sale => sale.ivs).map(sale =>
                    role.focus.reduce((sum, stat) => sum + Math.abs(
                        sale.ivs[ivPositions[stat]] - listing.ivs[ivPositions[stat]]
                    ), 0) / role.focus.length) : [];
            const roleIVGap = relevantIvGaps.length ? median(relevantIvGaps) : null;
            // Incomplete or undated samples remain contextual, never bargain alerts.
            const actionable = stage.actionable !== false && gradeMatched &&
                recent && traitCoverage && dispersion <= 1.75;
            return {
                value, average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
                low, high, p10: percentile(prices, 0.1), p90: percentile(prices, 0.9),
                dispersion, samples: prices.length, bucketSamples: sales.length,
                key, comparison: stage.name, attemptedStages,
                confidence: recent && traitCoverage && dispersion <= 1.75
                    ? stage.confidence : stage.confidence === 'context' ? 'context' : 'low',
                actionable, missingScore: listing.score == null,
                missingIVs: !listing.ivs, collectedAt: state.pokemonReference.capturedAt,
                ageDays, dateCoverage, newestSoldAt, oldestSoldAt, source: 'completed sales',
                roleComparison: {
                    role: role.role, source: role.source, confidence: role.confidence,
                    observedRoleSales: matchingRole.length, relevantIvGap: roleIVGap
                },
                limitations: [
                    ...(!recent ? ['sale dates missing or stale'] : []),
                    ...(!traitCoverage ? ['collectible extras unverified'] : []),
                    ...(dispersion > 1.75 ? ['wide price dispersion'] : []),
                    ...(stage.confidence === 'context' ? ['broad species comparison'] : [])
                ]
            };
        }
        return null;
    }
