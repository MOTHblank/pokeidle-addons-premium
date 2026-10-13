'use strict';

// Run with node --test addons/moth-watch/tests/automation.test.cjs.
// These tests exercise userscript code without a live game or real orders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'moth-watch.user.js'), 'utf8');
const protocolFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'market-protocol.json'), 'utf8'));


function section(start, end) {
    const a = script.indexOf(start), b = script.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, 'missing section: ' + start);
    return script.slice(a, b);
}
const match = script.match(/const DEFAULTS = Object.freeze\((\{[\s\S]*?\})\);/);
assert.ok(match);
const defaults = new Function('return ' + match[1])();

test('New profiles default to no automated purchases, and old mechanisms cannot submit sales', () => {
    assert.equal(defaults.fixedRulesEnabled, false);
    assert.deepEqual(defaults.fixedItemRules, []);
    for (const old of ['autoBuy', 'autoBuyPercent', 'autoBuyItems', 'autoBuyPokemon', 'autoBuyDiamonds',
        'buyCoins', 'buyGems', 'autoSellEnabled', 'autoSellRules']) {
        assert.equal(Object.hasOwn(defaults, old), false, old);
    }
    assert.doesNotMatch(script, /market\.criar/);
    assert.doesNotMatch(script, /candidateCanAutoBuy|sendItemSale|sanitizeAutoSellRules|maybeAutoBuy/);
});

test('Existing fixed rules retain buying parameters but never restore selling or percentage options', () => {
    const storage = {
        value: JSON.stringify({
            fixedRulesEnabled: true, autoBuy: true, autoBuyPercent: 90,
            autoSellEnabled: true, autoSellRules: [{ itemId: 106, enabled: true }],
            fixedItemRules: [{ id: 'old', itemId: 106, currency: 'gold', buyEnabled: true,
                buyMax: 30000, sellEnabled: true, sellPrice: 45000, keepQty: 2 }]
        }),
        getItem() { return this.value; }, setItem(_, v) { this.value = v; }
    };
    const src = section('    function sanitizeRuleCaps(', '    function emptyBaseline(');
    const fn = new Function('localStorage', 'DEFAULTS', 'CONFIG_KEY', src +
        '\nreturn { sanitizeFixedItemRules, loadConfig };')(storage, defaults, 'settings');
    const loaded = fn.loadConfig();
    assert.equal(loaded.fixedRulesEnabled, true);
    assert.equal(loaded.fixedItemRules.length, 1);
    assert.equal(loaded.fixedItemRules[0].buyMax, 30000);
    assert.equal(loaded.fixedItemRules[0].buyEnabled, true);
    for (const key of ['sellEnabled', 'sellPrice', 'keepQty']) {
        assert.equal(Object.hasOwn(loaded.fixedItemRules[0], key), false, key);
    }
    for (const key of ['autoBuy', 'autoBuyPercent', 'autoSellEnabled', 'autoSellRules']) {
        assert.equal(Object.hasOwn(loaded, key), false, key);
    }
});

test('Rule matching directly examines fresh item listings, skips attempted and retained offers', () => {
    const now = Date.now();
    const state = {
        itemOfferDetails: new Map([['106:gold', { updatedAt: now, offers: [
            { id: 11, preco: 18000, qtd: 2, vendedor: 'other' },
            { id: 12, preco: 24000, qtd: 3, vendedor: 'other' },
            { id: 13, preco: 5000, qtd: 4, vendedor: 'self' },
            { id: 14, preco: 6000, qtd: 4, vendedor: 'other', compravelEm: now + 60000 },
            { id: 15, preco: 65000, qtd: 4, vendedor: 'other' }
        ] }]]),
        attemptedListings: new Map([[11, now + 60000]])
    };
    const fn = new Function('state', 'isOwnListing', 'retentionUntil', 'serverNow',
        'itemReference', 'catalogName', 'unresolvedListing', section('    function fixedRuleCandidate(', '    function runMarketAutomation(') +
        '\nreturn fixedRuleCandidate;')(state, offer => offer.vendedor === 'self',
        offer => Number(offer.compravelEm || 0) > now ? offer.compravelEm : 0,
        () => now, () => null, () => 'Cocoon Stone', id => state.unknownListings?.has(id) || false);
    const rule = { itemId: 106, currency: 'gold', buyMax: 30000 };
    assert.equal(fn(rule).listingId, 12, 'An already attempted cheap offer must not block the next one');
    assert.equal(fn(rule).price, 24000);
    assert.equal(fn(rule).average, 0, 'No reference data should be required');
    state.attemptedListings.delete(11);
    assert.equal(fn(rule).listingId, 11);
    state.itemOfferDetails.get('106:gold').updatedAt = now - 50000;
    assert.equal(fn(rule), null, 'Very old listings require a refresh');
});

test('Purchase quantity honors the whole available offer, balance, reserves and transaction caps', () => {
    const src = section('    function purchaseQuantity(', '    function tryBuy(');
    const create = new Function('balanceFor', 'reserveFor', 'maxSpendFor', 'pokemonCurrencyAllowed', 'remainingBudget',
        src + '\nreturn purchaseQuantity;');
    const fn = create(() => 100000, () => 10000, () => 30000, () => true,
        () => ({ spend: Infinity, quantity: Infinity }));
    assert.equal(fn({ kind: 'item', currency: 'gold', price: 5000, qty: 20 }), 6);
    assert.equal(fn({ kind: 'item', currency: 'gold', price: 5000, qty: 3 }), 3);
    assert.equal(fn({ kind: 'item', currency: 'gold', price: 35000, qty: 3 }), 0);
    assert.equal(create(() => 100000, () => 10000, () => 0, () => true,
        () => ({ spend: Infinity, quantity: Infinity }))
        ({ kind: 'item', currency: 'gold', price: 5000, qty: 100 }), 18);
});

test('Multiple fixed rules are checked fairly, including after an unaffordable rule', () => {
    const state = { socket: { readyState: 1 }, pendingBuy: null, automationLastRunAt: 0, ruleItemKeys: new Set(), detailQueue: [] };
    const rules = [
        { itemId: 106, currency: 'gold', buyMax: 30000, buyEnabled: true },
        { itemId: 107, currency: 'orb', buyMax: 50, buyEnabled: true }
    ];
    const config = { enabled: true, fixedRulesEnabled: true, fixedItemRules: rules };
    const requested = [], bought = [];
    const fn = new Function('config', 'state', 'gameIsLoading', 'q', 'communityMarketIsOpen', 'unverifiedOrdersExist', 'sanitizeFixedItemRules',
        'automationDetail', 'fixedRuleCandidate', 'purchaseQuantity', 'tryBuy',
        'hasAnyBuyingRules', 'activeAnyItemRules', 'activePokemonRules',
        'anyItemRuleTargets', 'anyItemRuleCandidate', 'pokemonRuleCandidate',
        'snatchCriticalWindow',
        section('    function runMarketAutomation(', '    function runScan(force)') + '\nreturn runMarketAutomation;')(
        config, state, () => false, () => null, () => false, () => false, v => v,
        id => { requested.push(id); }, rule => ({ listingId: rule.itemId, name: String(rule.itemId) }),
        candidate => candidate.listingId === 106 ? 0 : 1,
        candidate => { bought.push(candidate.listingId); return true; },
        () => config.enabled && config.fixedRulesEnabled,
        () => [], () => [], () => [], () => null, () => null, () => false
    );
    fn();
    assert.deepEqual(requested, [106, 107]);
    assert.deepEqual(bought, [107], 'Later eligible rules must still execute');
    config.fixedRulesEnabled = false;
    state.automationLastRunAt = 0;
    fn();
    assert.deepEqual(bought, [107], 'Master switch off must prevent orders');
});

test('Rule requests get ahead of background scans without displacing manual item inspections', () => {
    const state = {
        detailPending: null, detailQueue: [
            { key: '105:gold' }, { key: '999:gold' }
        ], detailQueued: new Set(), ruleItemKeys: new Set(['105:gold', '106:gold']),
        selectedItemFocus: null, sellRecommendationKey: null,
        lastDetailRequest: new Map()
    };
    const fn = new Function('state', 'config', 'scheduleItemDetailPump', 'MAX_DETAIL_QUEUE',
        section('    function queueItemDetail(', '    function scheduleItemDetailPump(') +
        '\nreturn queueItemDetail;')(state, {scanSeconds:5}, () => {}, 24);
    fn(106,'gold');
    assert.deepEqual(state.detailQueue.map(x => x.key), ['105:gold','106:gold','999:gold']);
    state.selectedItemFocus = { key:'107:orb' };
    fn(107,'orb');
    assert.equal(state.detailQueue[0].key, '107:orb');
});

test('Only buying controls are rendered, with a visible explanation of activation prerequisites', () => {
    const helpers = section('    function ruleNumber(', '    function renderWatch(');
    const fixedRulesHtml = new Function('config', 'sanitizeFixedItemRules', 'escapeHtml', 'tr',
        'catalogName', 'fixedRuleStatus', 'ruleCurrencyUnused', 'automationItemOptions', 'configField',
        helpers + '\nreturn fixedRulesHtml;')(
        { fixedItemRules: [{id:'a',itemId:106,currency:'gold',buyEnabled:true,buyMax:30000}] },
        v => v, String, v => v, () => 'Cocoon Stone', () => 'Monitoring',
        null, () => '<option>106</option>', () => '<label>OFF</label>');
    const html = fixedRulesHtml();
    assert.match(html, /moth-fixed-buy/);
    assert.match(html, /data-moth-fixed-field="buyMax"/);
    for(const obsolete of ['moth-fixed-sell','moth-fixed-keep','moth-add-auto-sell','moth-auto-sell',
        'moth-mw-cfg-autoBuyPercent']) assert.equal(html.includes(obsolete), false, obsolete);
    assert.match(script, /No other buying switches are required/);
    assert.match(script, /Rule-based buying is on, but no Buy rules are active/);
});

test('Userscript version and monitor attribute match, with valid syntax and Portuguese guidance', () => {
    const version = script.match(/\/\/ @version\s+([\d.]+)/)?.[1];
    const marker = script.match(/data-moth-addon-version-market-bot', '([\d.]+)'/)?.[1];
    assert.ok(version);
    assert.equal(version, marker);
    assert.doesNotThrow(() => new Function(script));
    const pt = section('    const PT_BR = Object.freeze(', '    function tr(');
    const dict = new Function(pt + '\nreturn PT_BR;')();
    assert.ok(dict['Enable rule-based buying']);
    assert.ok(dict['Rule-based buying is on, but no Buy rules are active. Create or enable a rule first.']);
});


test('General scans use 15-second refreshes while background rule buying is active', () => {
    let clock = 100000;
    const state = {
        socket: { readyState: 1 }, watchOpen: false, lastScanAt: 0,
        ruleItemKeys: new Set(['106:gold'])
    };
    const config = {
        enabled: true, fixedRulesEnabled: true, scanSeconds: 5,
        scanItems: true, scanPokemon: true, scanDiamonds: true
    };
    const calls = [];
    const runScan = new Function('state', 'config', 'Date', 'BACKGROUND_SCAN_WITH_RULES_MS',
        'gameIsLoading', 'requestItemSummary', 'ensurePokemonHistory',
        'startPokemonScan', 'requestDiamondListings', 'pruneCandidates', 'queueRender',
        'hasAnyBuyingRules', 'activeAnyItemRules', 'activePokemonRules',
        section('    function runScan(force)', '    function pruneCandidates(') +
        '\nreturn runScan;')(state, config, {now: () => clock}, 15000,
        () => false, () => calls.push('items'), () => calls.push('history'),
        () => calls.push('pokemon'), () => calls.push('diamond'),
        () => calls.push('prune'), () => calls.push('render'),
        () => config.fixedRulesEnabled && state.ruleItemKeys.size > 0, () => [], () => []);
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 1);
    clock += 10000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 1, 'Closed buying mode throttles general scans');
    clock += 5000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 2);
    state.watchOpen = true;
    clock += 5000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 3, 'Opening Watch restores configured interval');
    state.watchOpen = false;
    config.fixedRulesEnabled = false;
    clock += 5000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 4, 'Watch-only mode preserves configured speed');
    config.fixedRulesEnabled = true;
    clock += 1000;
    runScan(true);
    assert.equal(calls.filter(x => x === 'items').length, 5, 'Manual scan always bypasses throttle');
    state.ruleItemKeys.clear();
    clock += 5000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 6, 'No active rules does not impose throttle');
});

test('Individual purchase rules reuse recent listing details', () => {
    let clock = 100000;
    const key = '106:gold', old = { updatedAt: clock - 25000, offers: [] };
    const state = { ruleItemKeys: new Set(), itemOfferDetails: new Map([[key, old]]) };
    const queued = [];
    const detail = new Function('state', 'Date', 'RULE_DETAIL_REFRESH_MS', 'queueItemDetail',
        section('    function automationDetail(', '    function fixedRuleCandidate(') +
        '\nreturn automationDetail;')(
        state, {now: () => clock}, 30000, (...params) => queued.push(params));
    assert.equal(detail(106, 'gold'), old);
    assert.deepEqual(queued, [], 'Recent details should not be fetched again');
    clock += 5001;
    detail(106, 'gold');
    assert.deepEqual(queued, [[106, 'gold']]);
    assert.ok(state.ruleItemKeys.has(key));
});

test('Closed-panel buying defers discovery-only item details, but not statistics or open-panel discovery', () => {
    const state = {
        itemSummary: {106: {anuncios: 1, minGold: 100, minOrb: 0}},
        liveItemAverages: {'106': {gold:{average:200}}},
        baseline: {items: {}}, ruleItemKeys: new Set(['106:gold']), watchOpen: false
    };
    const config = { watchPercent: 70, fixedRulesEnabled: true };
    const queued = [];
    const scan = new Function('state', 'config', 'itemReference', 'queueItemDetail',
        section('    function discoveryRatio(', '    function removeCandidateGroup(') +
        '\nreturn scanSuspiciousItemSummaries;')(
        state, config, (id, currency) => currency === 'gold' ? { average: 200 } : null,
        (...args) => queued.push(args));
    scan();
    assert.equal(state.itemScanStats.goldSuspicious, 1);
    assert.deepEqual(queued, [], 'Background discovery must not compete with rule lookups');
    state.watchOpen = true;
    scan();
    assert.deepEqual(queued, [[106,'gold']], 'Open panel continues regular discovery');
    state.watchOpen = false;
    config.fixedRulesEnabled = false;
    scan();
    assert.deepEqual(queued, [[106,'gold'],[106,'gold']], 'Watch-only mode keeps discovery');
});

test('Rule lookup gets a chance to send before general background requests', () => {
    const timerCode = section('        state.scanTimer = setInterval(() => {', '        /*\n         * Observe only the modal shell.');
    assert.ok(timerCode.indexOf('runMarketAutomation();') < timerCode.indexOf('runScan(false);'));
    assert.ok(timerCode.indexOf('pumpItemDetails();') < timerCode.indexOf('runScan(false);'));
    assert.match(timerCode, /!state\.detailPending/);
});


function createPokemonValuationHarness() {
    const state = { pokemonReference: { version: 3, capturedAt: 0, values: {} } };
    const config = { minPokemonSamples: 3 };
    const src = section('    function pokemonForm(', '    function requestHistoryPage()');
    const api = new Function('state', 'config', 'speciesIdOf', 'levelBand',
        'pokemonCurrencyAllowed', 'savePokemonReference', 'addLog', 'queueRender',
        'POKEMON_SALE_WINDOW_MS', 'POKEMON_HISTORY_FRESH_MS',
        src + '\nreturn { pokemonIVs, pokemonFacts, pokemonIdentityKey, pokemonComparableSales, ' +
        'addPokemonHistorySample, finalizePokemonHistory, pokemonReferenceFor, pokemonCombatRole };')(
        state, config, ficha => ficha?.speciesId || null,
        level => level < 100 ? 'lt100' : level < 500 ? '100-499' : '500+',
        (ficha, currency) => currency === 'orb' || !ficha?.shiny,
        () => {}, () => {}, () => {}, 90 * 86400000, 30 * 86400000);
    return { state, config, ...api };
}

function samplePokemon(overrides = {}) {
    return {
        speciesId: 25, formId: 'base', level: 100, nota: 3.55, qualidade: 1.25, potencia: 4,
        shiny: false, legendary:false, mythical:false, mega:false,
        tmElemental:false, tmAoe:false, heldItem:false,
        ivs: { hp: 20, atk: 32, def: 20, spAtk: 5, spDef: 20, speed: 29 },
        ...overrides
    };
}

test('V3 Pokémon references use dated graded sales, never pool N=3.5 with N=4.0', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    [100, 120, 140].forEach(price => h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', vendidoEm: Date.now()-86400000,
        bruto: price, ficha: samplePokemon()
    }, sales));
    h.finalizePokemonHistory(sales);
    const ref = h.pokemonReferenceFor(samplePokemon(), 'gold');
    assert.equal(h.state.pokemonReference.version, 3);
    assert.equal(ref.value, 120);
    assert.equal(ref.samples, 3);
    assert.equal(ref.confidence, 'high');
    assert.equal(ref.actionable, true);
    assert.equal(ref.low, 110);
    assert.equal(ref.high, 130);
    const higher = h.pokemonReferenceFor(samplePokemon({ nota: 4.05 }), 'gold');
    assert.equal(higher.actionable, false, 'Only species-level history remains, which is not an alert');
    assert.equal(h.pokemonReferenceFor(samplePokemon({potencia: 5}), 'gold'), null);
    assert.equal(h.pokemonReferenceFor(samplePokemon({potencia: undefined}), 'gold'), null,
        'Missing potency must not silently become P1');
    assert.equal(h.pokemonReferenceFor(samplePokemon({level: undefined}), 'gold').actionable, false,
        'Missing level must not match the lowest level band');
    assert.equal(h.pokemonReferenceFor(samplePokemon({shiny: true}), 'gold'), null);
    assert.equal(h.pokemonReferenceFor(samplePokemon(), 'orb'), null);
});

test('V3 downgrades confidence for different IV builds and missing game score', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    [100, 110, 120].forEach(price => h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', vendidoEm: Date.now()-86400000,
        preco: price, ficha: samplePokemon()
    }, sales));
    h.finalizePokemonHistory(sales);
    const oppositeBuild = samplePokemon({
        ivs: {hp: 20, atk: 5, def: 20, spAtk: 32, spDef: 20, speed: 29}
    });
    assert.equal(h.pokemonReferenceFor(oppositeBuild, 'gold').confidence, 'medium');
    assert.equal(h.pokemonReferenceFor(samplePokemon({nota: undefined}), 'gold').actionable, false);
    assert.equal(h.pokemonIVs({ivs: [20, 32, 20, 5, 20, 29]}), null,
        'Undocumented array ordering must not be inferred');
    assert.equal(h.pokemonFacts(samplePokemon({ivs: {total: 192}})).ivs, null);
    h.state.pokemonReference.version = 1;
    assert.equal(h.pokemonReferenceFor(samplePokemon(), 'gold'), null,
        'Never reuse ungraded v1 buckets');
});

test('V3 stores only non-identifying Pokémon sale traits and never creates an auto-buy rule', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', vendidoEm: Date.now()-86400000, bruto: 900,
        vendedor: 'secret-user', ficha: samplePokemon({id: 123456, nickname: 'secret'})
    }, sales);
    h.finalizePokemonHistory(sales);
    const snapshot = JSON.stringify(h.state.pokemonReference);
    assert.doesNotMatch(snapshot, /secret-user|secret|123456/);
    assert.doesNotMatch(script, /autoBuyPokemon\s*:\s*true/);
    assert.match(script, /if \(!ref \|\| !\(ref\.value > 0\) \|\| !ref\.actionable\) continue/);
});

test('Category rule defaults and currency constraints', () => {
    assert.deepEqual(defaults.anyItemRules, []);
    assert.deepEqual(defaults.pokemonBuyRules, []);
    assert.equal(defaults.fixedRulesEnabled, false);
    const helpers = new Function(section('    function sanitizeRuleCaps(', '    function sanitizeFixedItemRules(') +
        section('    function sanitizeAnyItemRules(', '    function loadConfig()') +
        '\nreturn {sanitizeAnyItemRules, sanitizePokemonBuyRules};')();
    const item = helpers.sanitizeAnyItemRules([{buyMax:10000}, {buyMax:0}]);
    assert.equal(item.length, 1);
    assert.equal(item[0].buyEnabled, false);
    const poke = helpers.sanitizePokemonBuyRules([
        {kind:'any',currency:'gold',buyMax:1000000,buyEnabled:true},
        {kind:'shiny',currency:'orb',buyMax:5,buyEnabled:true},
        {kind:'shiny',currency:'gold',buyMax:5,buyEnabled:true}
    ]);
    assert.deepEqual(poke.map(r => r.kind), ['any','shiny']);
});

test('Any-item summary gating uses currency-specific price ceiling', () => {
    const state = {itemSummary:{
        106:{anuncios:2,minGold:8000,minOrb:3},
        107:{anuncios:1,minGold:15000,minOrb:1},
        108:{anuncios:0,minGold:1,minOrb:1}
    }};
    const src = section('    function anyItemRuleTargets(', '    function runMarketAutomation(');
    const helpers = new Function('state','fixedRuleCandidate','pokemonCurrencyAllowed',
        'isOwnListing','retentionUntil','serverNow','pokemonListingName',
        src + '\nreturn {anyItemRuleTargets,anyItemRuleCandidate};')(
        state, rule => rule.itemId === 106 && rule.buyMax >= 9500
            ? {listingId:99,price:9500,currency:rule.currency} : null,
        () => true, () => false, () => 0, Date.now, () => 'Pokémon'
    );
    const targets = helpers.anyItemRuleTargets([{currency:'gold',buyMax:10000}]);
    assert.deepEqual(targets.map(v=>v.key),['106:gold']);
    assert.equal(helpers.anyItemRuleCandidate({currency:'gold',buyMax:10000},targets).listingId,99);
    assert.equal(helpers.anyItemRuleCandidate({currency:'gold',buyMax:9000},targets),null);
    assert.deepEqual(helpers.anyItemRuleTargets([{currency:'orb',buyMax:2}]).map(v=>v.key),['107:orb']);
});

test('Pokémon categories honor price, currency, retention, owner and repeated attempts', () => {
    const now=Date.now();
    const state={pokemonAutoOffers:new Map([
        ['gold',{updatedAt:now,offers:[
            {id:11,preco:900000,ficha:{shiny:false,potencia:1}},
            {id:12,preco:800000,ficha:{shiny:false,potencia:5}},
            {id:13,preco:400000,ficha:{shiny:true,potencia:5}}
        ]}],
        ['orb',{updatedAt:now,offers:[
            {id:14,preco:5,ficha:{shiny:true,potencia:2}},
            {id:15,preco:4,ficha:{shiny:true,potencia:5},compravelEm:now+60000},
            {id:16,preco:3,ficha:{shiny:true,potencia:5},vendedor:'self'}
        ]}]
    ]),attemptedListings:new Map()};
    const src=section('    function anyItemRuleTargets(', '    function runMarketAutomation(');
    const api=new Function('state','fixedRuleCandidate','pokemonCurrencyAllowed',
        'isOwnListing','retentionUntil','serverNow','pokemonListingName','unresolvedListing',
        src+'\nreturn {pokemonRuleMatches,pokemonRuleCandidate};')(
        state,()=>null,(pk,c)=>c==='orb'||!pk.shiny,
        l=>l.vendedor==='self',l=>l.compravelEm||0,()=>now,()=> 'Poke',()=>false
    );
    assert.equal(api.pokemonRuleCandidate({kind:'any',currency:'gold',buyMax:1000000}).listingId,12);
    assert.equal(api.pokemonRuleCandidate({kind:'p5',currency:'gold',buyMax:1000000}).listingId,12);
    assert.equal(api.pokemonRuleCandidate({kind:'shiny',currency:'orb',buyMax:5}).listingId,14);
    assert.equal(api.pokemonRuleCandidate({kind:'shiny',currency:'gold',buyMax:1000000}),null);
    state.attemptedListings.set(14,now+50000);
    assert.equal(api.pokemonRuleCandidate({kind:'shiny',currency:'orb',buyMax:5}),null);
    state.pokemonAutoOffers.get('gold').updatedAt=now-50000;
    assert.equal(api.pokemonRuleCandidate({kind:'any',currency:'gold',buyMax:1000000}),null);
});

test('Category rules have UI editors and respect the master enable switch', () => {
    const ui = section('    function categoryRuleStatus(', '    function renderWatch(');
    assert.match(ui, /data-moth-remove-/);
    assert.match(ui, /buyEnabled/);
    assert.match(ui, /buyMax/);
    assert.match(ui, /moth-pokemon-kind/);
    assert.match(script, /categoryRulesHtml\('any'\) \+ categoryRulesHtml\('pokemon'\)/);
    assert.match(script, /function hasAnyBuyingRules/);
    assert.match(script, /maxGemsPerBuy/);
    assert.doesNotMatch(script, /market\.criar/);
});

test('Broad item purchasing refreshes summaries even if passive item watch is disabled', () => {
    const config = {
        enabled:true, scanItems:false, scanPokemon:false, scanDiamonds:false,
        fixedRulesEnabled:true, scanSeconds:5
    };
    const state = {socket:{readyState:1}, watchOpen:false,
        lastScanAt:0, ruleItemKeys:new Set()};
    const requested=[];
    const runner = new Function('state','config','Date','BACKGROUND_SCAN_WITH_RULES_MS',
        'gameIsLoading','requestItemSummary','ensurePokemonHistory',
        'startPokemonScan','requestDiamondListings','pruneCandidates','queueRender',
        'hasAnyBuyingRules','activeAnyItemRules','activePokemonRules',
        section('    function runScan(force)', '    function pruneCandidates(') +
        '\nreturn runScan;')(
        state, config, {now:()=>100000}, 30000,
        ()=>false, forced=>requested.push(forced),
        ()=>{}, ()=>{}, ()=>{}, ()=>{}, ()=>{},
        ()=>true, ()=>[{buyEnabled:true,buyMax:10000,currency:'gold'}], ()=>[]
    );
    runner(true);
    assert.deepEqual(requested, [true]);
});

test('Automated Pokémon orders require master permission and remain serialized', () => {
    const config = {enabled:true,fixedRulesEnabled:false,fixedItemRules:[],
        anyItemRules:[],pokemonBuyRules:[{id:'p',kind:'shiny',currency:'orb',buyMax:5,buyEnabled:true}]};
    const state = {socket:{readyState:1},ruleItemKeys:new Set(),itemSummary:{},
        detailQueue:[],detailPending:null,pendingBuy:null,automationLastRunAt:0};
    const submitted=[];
    const candidate={key:'rule:pokemon:7',kind:'pokemon',listingId:7,currency:'orb',
        price:5,unitPrice:5,qty:1,ficha:{shiny:true,potencia:5}};
    const runner=new Function('config','state','gameIsLoading','q','communityMarketIsOpen','unverifiedOrdersExist',
        'hasAnyBuyingRules','sanitizeFixedItemRules','activeAnyItemRules',
        'activePokemonRules','anyItemRuleTargets','automationDetail',
        'fixedRuleCandidate','anyItemRuleCandidate','pokemonRuleCandidate',
        'purchaseQuantity','tryBuy','snatchCriticalWindow',
        section('    function runMarketAutomation(', '    function runScan(force)') +
        '\nreturn runMarketAutomation;')(
        config,state,()=>false,()=>null,()=>false,()=>false,
        ()=>config.enabled && config.fixedRulesEnabled,
        ()=>[],()=>[],()=>config.pokemonBuyRules,()=>[],()=>{},
        ()=>null,()=>null,()=>candidate,()=>1,
        item=>{submitted.push(item.listingId);state.pendingBuy=item;return true;},
        ()=>false
    );
    runner();
    assert.deepEqual(submitted,[]);
    config.fixedRulesEnabled=true;
    runner();
    runner();
    assert.deepEqual(submitted,[7]);
});


test('Milestone A: all new buying limits opt out by default and do not enable automation', () => {
    for (const key of ['maxCoinsPerSession', 'maxGemsPerSession', 'maxCoinsPerDay',
        'maxGemsPerDay', 'maxPurchasesPerSession', 'maxQuantityPerSession']) {
        assert.equal(defaults[key], 0, key + ' must be unlimited unless configured');
    }
    assert.equal(defaults.purchasesPaused, false);
    assert.equal(defaults.fixedRulesEnabled, false);
    assert.match(script, /Pause all purchases \(kill switch\)/);
    assert.match(script, /Rule cumulative limits/);
    assert.match(script, /purchasesPaused: !!config\.purchasesPaused/);
});

test('Milestone A: market vitrine responses use explicit currency, kind and page on empty packets', () => {
    const src = section('    function marketReplyAvailable(', '    function handleDiamondListings(');
    const state = { marketReply: {kind:'pokemon',currency:'gold',page:1,sentAt:Date.now()} };
    const { marketReplyMatches, marketReplyAvailable } =
        new Function('state','communityMarketIsOpen',src +
            '\nreturn {marketReplyMatches,marketReplyAvailable};')(state,()=>false);
    assert.equal(marketReplyMatches({aba:'vitrine',linhas:[]},'pokemon'),false);
    assert.equal(marketReplyMatches({aba:'vitrine',tipo:'pokemon',moeda:'orb',pagina:1,linhas:[]},'pokemon'),false);
    assert.equal(marketReplyMatches({aba:'vitrine',tipo:'diamante',moeda:'gold',pagina:1,linhas:[]},'pokemon'),false);
    assert.equal(marketReplyMatches({aba:'vitrine',tipo:'pokemon',moeda:'gold',pagina:0,linhas:[]},'pokemon'),false);
    assert.equal(marketReplyMatches({aba:'vitrine',tipo:'pokemon',moeda:'gold',pagina:1,linhas:[]},'pokemon'),true);
    state.marketReply = {kind:'diamante',currency:'orb',page:0,sentAt:Date.now()};
    assert.equal(marketReplyMatches({aba:'vitrine',linhas:[]},'diamante'),false);
    assert.equal(marketReplyMatches({aba:'vitrine',tipo:'diamante',moeda:'orb',pagina:0,linhas:[]},'diamante'),true);
    assert.equal(marketReplyAvailable(),false);
    state.marketReply.sentAt -= 7000;
    assert.equal(marketReplyAvailable(),true);
    assert.equal(state.marketReply,null);
});

test('Milestone A: stale/missing/held/self/unverified quotes fail closed', () => {
    const state = { nick:'me' };
    let unresolved = false;
    const source = section('    function freshQuote(', '    function loadConfig()');
    const check = new Function('state','QUOTE_MAX_AGE_MS','isOwnListing','serverNow','unresolvedListing',
        source + '\nreturn freshQuote;')(
        state,30000,offer => offer.vendedor === 'me',() => Date.now(),
        () => unresolved);
    const valid = {listingId:12, kind:'item', currency:'gold',price:10,qty:2,
        seller:'someone',seenAt:Date.now(),retainedUntil:0};
    assert.equal(check(valid,false),true);
    assert.equal(check({...valid,qty:undefined},false),false);
    assert.equal(check({...valid,price:0},false),false);
    assert.equal(check({...valid,seller:'me'},false),false);
    assert.equal(check({...valid,seenAt:Date.now()-32000},false),false);
    assert.equal(check({...valid,retainedUntil:Date.now()+5000},false),false);
    assert.equal(check({...valid,kind:'pokemon',ficha:{shiny:undefined,potencia:5}},false),false);
    unresolved=true;
    assert.equal(check(valid,true),false);
});

test('Milestone A: session/day caps account for outstanding unknown orders across reload', () => {
    const disk = new Map(), memory = new Map();
    const storage = {getItem:key => disk.get(key)||null,setItem:(key,val)=>disk.set(key,val)};
    const session = {getItem:key => memory.get(key)||null,setItem:(key,val)=>memory.set(key,val)};
    const config = {maxCoinsPerSession:250,maxGemsPerSession:0,
        maxCoinsPerDay:220,maxGemsPerDay:0,
        maxPurchasesPerSession:2,maxQuantityPerSession:3,
        fixedRulesEnabled:false};
    const state = {nick:'synthetic-alice',attemptedListings:new Map(),pendingBuy:null,lastPurchaseOutcome:'idle'};
    const source = section('    function orderAccountKey(', '    function loadConfig()');
    const log = [];
    const api = new Function('state','config','localStorage','sessionStorage',
        'ORDER_JOURNAL_KEY','ORDER_SESSION_KEY','normalize','addLog','queueRender',
        'sanitizeFixedItemRules','sanitizeAnyItemRules','sanitizePokemonBuyRules','snatchOutcome',
        source + '\nreturn {orderAccountKey,loadOrderJournal,saveOrderJournal,reserveOrder,settleOrder,'+
        'resolveOrder,unresolvedListing,remainingBudget,orderExposure};')(
        state,config,storage,session,'orders','session',text=>text.toLowerCase(),text=>log.push(text),
        ()=>{},()=>[],()=>[],()=>[],()=>{});
    state.orderJournal=api.loadOrderJournal();
    const at=Date.now();
    const order={listingId:77,currency:'gold',sentAt:at,spend:120,qty:2,
        ruleId:'',kind:'item',sessionId:state.orderJournal.sessionId,
        day:new Date(at).toISOString().slice(0,10),status:'prepared'};
    assert.equal(api.reserveOrder(order),true);
    assert.equal(api.remainingBudget('gold').spend,100);
    assert.equal(api.remainingBudget('gold').quantity,1);
    order.status='submitted';api.saveOrderJournal();
    state.orderJournal=api.loadOrderJournal(); // reload converts in-flight to unknown
    assert.equal(state.orderJournal.orders[0].status,'unknown');
    assert.equal(api.unresolvedListing(77),true);
    assert.equal(api.remainingBudget('gold').spend,100);
    assert.equal(api.resolveOrder(88,'confirmed'),false);
    assert.equal(api.resolveOrder(77,'confirmed'),true);
    assert.equal(api.resolveOrder(77,'confirmed'),false,'duplicate ack is idempotent');
    assert.equal(api.remainingBudget('gold').spend,100,
        'confirmed purchases retain quoted upper bound');
    assert.equal(api.unresolvedListing(77),false);
    assert.equal(api.remainingBudget('orb').spend,Infinity);
    state.nick='synthetic-bob';
    state.orderJournal=api.loadOrderJournal();
    assert.equal(state.orderJournal.orders.length,0,'different game accounts must not share buys');
    state.nick='synthetic-alice';
    state.orderJournal=api.loadOrderJournal();
    assert.equal(state.orderJournal.orders[0].status,'confirmed');
    assert.ok([...disk.keys()].every(key=>!key.includes('synthetic-alice')),
        'raw nickname must never enter the stored journal key');
});

test('Milestone A: per-rule spend and quantity limits are independent of global caps', () => {
    const state = {orderJournal:{sessionId:'s',orders:[{
        listingId:1,currency:'gold',sentAt:Date.now(),qty:2,spend:80,
        ruleId:'fixed-1',status:'unknown',sessionId:'s',
        day:new Date().toISOString().slice(0,10)
    }]}};
    const config = {enabled:true,fixedRulesEnabled:true,purchasesPaused:false,
        maxCoinsPerSession:300,maxCoinsPerDay:300,
        maxPurchasesPerSession:4,maxQuantityPerSession:5,
        fixedItemRules:[{id:'fixed-1',itemId:106,currency:'gold',buyEnabled:true,buyMax:100,
            maxSpendSession:100,maxSpendDay:90,maxPurchasesSession:2,maxQuantitySession:3}]};
    const src = section('    function orderExposure(', '    function currentRuleMatches(');
    const api = new Function('state','config','sanitizeFixedItemRules','sanitizeAnyItemRules',
        'sanitizePokemonBuyRules','orderDay',
        src+'\nreturn {remainingBudget,orderExposure};')(
        state,config,values => values.map(r=>({...r})),()=>[],()=>[],
        at=>new Date(at).toISOString().slice(0,10));
    assert.equal(api.remainingBudget('gold','fixed-1').spend,10);
    assert.equal(api.remainingBudget('gold','fixed-1').quantity,1);
    assert.equal(api.remainingBudget('gold').spend,220);
});


test('Milestone A: fixture families cover positive, empty, missing and conflicting packets', () => {
    const fixtures = protocolFixtures;
    assert.equal(fixtures.provenance.kind, 'synthetic-only');
    assert.equal(fixtures.item.positive.linhas[0].preco, 90);
    assert.equal(fixtures.item.empty.linhas.length, 0);
    assert.equal(fixtures.item.missingItemId.itemId, undefined);
    assert.equal(fixtures.pokemonHistory.empty.linhas.length, 0);
    assert.equal(fixtures.pokemonHistory.ambiguousEmpty.moeda, undefined);
    assert.equal(fixtures.acknowledgement.missingListingId.ev[0].listingId, undefined);
    const state = {marketReply:{kind:'pokemon',currency:'gold',page:0,sentAt:Date.now()}};
    const api = new Function('state','communityMarketIsOpen',
        section('    function marketReplyAvailable(', '    function handleDiamondListings(') +
        '\nreturn {marketReplyMatches};')(state,()=>false);
    assert.equal(api.marketReplyMatches(fixtures.pokemonVitrine.positive,'pokemon'),true);
    assert.equal(api.marketReplyMatches(fixtures.pokemonVitrine.empty,'pokemon'),true);
    assert.equal(api.marketReplyMatches(fixtures.pokemonVitrine.ambiguousEmpty,'pokemon'),false);
    assert.equal(api.marketReplyMatches(fixtures.pokemonVitrine.wrongPage,'pokemon'),false);
    assert.equal(api.marketReplyMatches(fixtures.diamondVitrine.empty,'pokemon'),false);
    state.marketReply={kind:'diamante',currency:'orb',page:0,sentAt:Date.now()};
    assert.equal(api.marketReplyMatches(fixtures.diamondVitrine.positive,'diamante'),true);
    assert.equal(api.marketReplyMatches(fixtures.diamondVitrine.empty,'diamante'),true);
    assert.equal(api.marketReplyMatches(fixtures.diamondVitrine.wrongCurrency,'diamante'),false);
});

test('Explicit-price automation does not require historical-sale sample minimums', () => {
    const automation = section('    function fixedRuleCandidate(', '    function runScan(force)');
    const rules = section('    function sanitizeRuleCaps(', '    function emptyBaseline(');
    const purchase = section('    function tryBuy(', '    function controllerResult(');
    for (const code of [automation, rules, purchase]) {
        assert.doesNotMatch(code, /config\.minItemUnits|config\.minPokemonSamples/,
            'configured buy rules must not depend on valuation thresholds');
    }
    assert.match(automation, /price <= rule\.buyMax/);
    assert.match(automation, /unitPrice > rule\.buyMax/);
    assert.match(script, /Minimum comparable completed Pokémon sales for read-only price estimates/);
    assert.match(script, /Does not restrict buying rules/);
});

test('Price-estimate controls are separate from the automatic buying editor', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/ui-render-section.js'), 'utf8');
    const automation = source.slice(source.indexOf("state.watchView === 'automation') {"),
        source.indexOf('            } else {\n                content.innerHTML =', source.indexOf("state.watchView === 'automation') {")));
    assert.doesNotMatch(automation, /minItemUnits|minPokemonSamples/);
    assert.match(source, /Valuation sample settings \(not buying limits\)/);
    assert.match(source, /Rules such as “buy any item below 10,000 Coins” never require historical sales/);
    const events = fs.readFileSync(path.join(__dirname, '..', 'src/ui-events-section.js'), 'utf8');
    assert.doesNotMatch(events, /key === 'minPokemonSamples'\) ensurePokemonHistory\(true\)/);
});

test('Unverified orders quarantine only their exact listing, not every unrelated rule', () => {
    const body = section('    function tryBuy(', '    function controllerResult(');
    const runner = section('    function runMarketAutomation(', '    function runScan(force)');
    assert.doesNotMatch(body, /unverifiedOrdersExist\(\)/);
    assert.doesNotMatch(runner, /unverifiedOrdersExist\(\)/);
    assert.doesNotMatch(runner, /q\('#modal \.cm-folha'\)/);
    assert.doesNotMatch(runner, /if \(communityMarketIsOpen\(\) \|\| state\.pendingBuy/);
    assert.doesNotMatch(runner, /snatchCriticalWindow\(\)/);
    assert.match(script, /!unresolvedListing\(id\)/);
    assert.match(script, /unresolvedListing\(candidate\.listingId\)/);
});


test('Milestone B: Pokémon identity requires observed species, form separation, shiny and P', () => {
    const h = createPokemonValuationHarness();
    assert.equal(h.pokemonIdentityKey(samplePokemon({shiny:undefined}), 'gold'), null);
    assert.equal(h.pokemonIdentityKey(samplePokemon({potencia:undefined}), 'gold'), null);
    assert.equal(h.pokemonIdentityKey(samplePokemon({potencia:5}), 'gold')
        .includes('|p:5'),true);
    assert.notEqual(h.pokemonIdentityKey(samplePokemon({formId:'mega'}),'gold'),
        h.pokemonIdentityKey(samplePokemon({formId:'base'}),'gold'));
    assert.notEqual(h.pokemonIdentityKey(samplePokemon({formId:undefined}),'gold'),
        h.pokemonIdentityKey(samplePokemon({formId:'base'}),'gold'));
    assert.notEqual(h.pokemonIdentityKey(samplePokemon(),'orb'),
        h.pokemonIdentityKey(samplePokemon(),'gold'));
    assert.equal(h.pokemonIdentityKey(samplePokemon({shiny:true}),'gold'),null);
    assert.equal(h.pokemonFacts(samplePokemon({nota:undefined})).score,null);
    assert.equal(h.pokemonFacts(samplePokemon({ivs:[20,20,20,20,20,20]})).ivs,null);
    assert.ok(h.pokemonFacts(samplePokemon({potencia:undefined})).missing.includes('potency'));
});

test('Milestone B: undated or old sales cannot be sold as recent bargains', () => {
    const h=createPokemonValuationHarness();
    const undated=new Map();
    [100,120,140].forEach(bruto=>h.addPokemonHistorySample({
        tipo:'pokemon',moeda:'gold',bruto,ficha:samplePokemon()
    },undated));
    h.finalizePokemonHistory(undated);
    const ref=h.pokemonReferenceFor(samplePokemon(),'gold');
    assert.equal(ref.value,120);
    assert.equal(ref.confidence,'low');
    assert.equal(ref.actionable,false);
    assert.equal(ref.ageDays,null);
    assert.equal(ref.dateCoverage,0);
    assert.ok(ref.limitations.includes('sale dates missing or stale'));

    const expired=new Map();
    h.addPokemonHistorySample({tipo:'pokemon',moeda:'gold',bruto:100,
        vendidoEm:Date.now()-95*86400000,ficha:samplePokemon()},expired);
    assert.equal(expired.size,0,'explicitly old sale omitted from current window');

    const recent=new Map();
    [100,120,140].forEach(bruto=>h.addPokemonHistorySample({tipo:'pokemon',
        moeda:'gold',bruto,vendidoEm:Date.now()-86400000,
        ficha:samplePokemon()},recent));
    h.finalizePokemonHistory(recent);
    assert.equal(h.pokemonReferenceFor(samplePokemon(),'gold').confidence,'high');
    assert.equal(h.pokemonReferenceFor(samplePokemon(),'gold').actionable,true);
});

test('Milestone B: broad comps, missing extras and dispersion downgrade confidence', () => {
    const h=createPokemonValuationHarness(), sales=new Map();
    [100,120,10000].forEach(bruto=>h.addPokemonHistorySample({
        tipo:'pokemon',moeda:'gold',bruto,vendidoEm:Date.now()-86400000,
        ficha:samplePokemon()
    },sales));
    h.finalizePokemonHistory(sales);
    const ref=h.pokemonReferenceFor(samplePokemon(),'gold');
    assert.equal(ref.actionable,false);
    assert.ok(ref.p90 > ref.p10);
    assert.ok(ref.dispersion > 1.75);
    assert.equal(ref.attemptedStages[0].matches,0,'no imputed refinement vector');
    assert.ok(ref.samples >= 3);
    assert.equal(h.pokemonReferenceFor(samplePokemon({nota:4.05}),'gold').actionable,false);
    assert.equal(h.pokemonReferenceFor(samplePokemon({legendary:undefined}),'gold').actionable,false);
    assert.equal(h.pokemonReferenceFor(samplePokemon({formId:undefined}),'gold'),null);
    assert.equal(h.pokemonReferenceFor(samplePokemon({potencia:5}),'gold'),null);
});

test('Milestone B: combat annotations require equipped moves or observed bases', () => {
    const h=createPokemonValuationHarness();
    const physical=h.pokemonCombatRole({equippedMoves:[
        {categoria:'PHYSICAL'},{categoria:'PHYSICAL'}]});
    assert.equal(physical.role,'physical');
    assert.equal(physical.confidence,'observed');
    assert.deepEqual(physical.focus,['atk','speed']);
    const mixed=h.pokemonCombatRole({movimentosEquipados:[
        {categoria:'PHYSICAL'},{categoria:'SPECIAL'}]});
    assert.equal(mixed.role,'mixed');
    const unverified=h.pokemonCombatRole({moves:[{name:'Thunder'}]});
    assert.equal(unverified.role,'unknown');
    const inferred=h.pokemonCombatRole({baseAtk:100,baseSpAtk:55});
    assert.equal(inferred.role,'physical');
    assert.equal(inferred.confidence,'indicative');
    assert.equal(h.pokemonCombatRole({equippedMoves:[{name:'move only'}]}).role,'unknown');
});

test('Milestone B: price inspection is read-only and cannot authorize market orders', () => {
    const inspect=section('    function pokemonRulePreview(', '    function renderCandidate(');
    assert.doesNotMatch(inspect,/market\.comprar|send\(|tryBuy\(|saveConfig\(/);
    assert.match(inspect,/Insufficient comparable sales/);
    assert.match(inspect,/No matching configured Pokémon rule/);
    assert.match(script,/No purchase authorization/);
    assert.match(script,/data-moth-view="pricing"/);
    const state={orderJournal:{},pendingBuy:null};
    const config={enabled:true,fixedRulesEnabled:true,purchasesPaused:false,pokemonBuyRules:[
        {id:'a',kind:'p5',buyMax:100,currency:'gold',buyEnabled:true},
        {id:'b',kind:'p5',buyMax:200,currency:'gold',buyEnabled:true}
    ]};
    const src=section('    function pokemonRulePreview(', '    function pokemonEvidenceCard(');
    const preview=new Function('state','config','sanitizePokemonBuyRules','pokemonRuleMatches',
        'isOwnListing','retentionUntil','serverNow','unresolvedListing',
        'remainingBudget','balanceFor','reserveFor',
        src+'\nreturn pokemonRulePreview;')(
        state,config,items=>items,
        (rule,ficha,currency)=>rule.kind==='p5'&&ficha?.potencia===5&&rule.currency===currency,
        ()=>false,()=>0,Date.now,()=>false,()=>({spend:1000}),()=>1000,()=>0
    );
    const listing={id:55,preco:150,qtd:1,ficha:{potencia:5,shiny:false}};
    assert.deepEqual(preview(listing,'gold').map(r=>r.status),
        ['Above price ceiling','Matches absolute-price rule']);
    config.fixedRulesEnabled=false;
    assert.ok(preview(listing,'gold').every(r=>r.status==='Rule paused'));
    assert.equal(config.pokemonBuyRules[0].buyEnabled,true,
        'inspection must not mutate authorization');
});


test('Milestone B: relevant IV and combat role matches are explanatory only', () => {
    const h=createPokemonValuationHarness(), work=new Map();
    const physical=samplePokemon({equippedMoves:[{categoria:'PHYSICAL'}]});
    [200,220,240].forEach(bruto=>h.addPokemonHistorySample({
        tipo:'pokemon',moeda:'gold',bruto,vendidoEm:Date.now()-86400000,
        ficha:physical
    },work));
    h.finalizePokemonHistory(work);
    const ref=h.pokemonReferenceFor(physical,'gold');
    assert.equal(ref.roleComparison.role,'physical');
    assert.equal(ref.roleComparison.observedRoleSales,3);
    assert.equal(ref.roleComparison.relevantIvGap,0);
    assert.equal(ref.value,220);
    const opposite=samplePokemon({equippedMoves:[{categoria:'SPECIAL'}]});
    const context=h.pokemonReferenceFor(opposite,'gold');
    assert.equal(context.roleComparison.observedRoleSales,0);
    assert.equal(context.roleComparison.relevantIvGap,null);
    assert.equal(context.value,220,'role annotation never adjusts sale price');
    assert.match(script,/Role-comparable sales/);
});


function economyHarness() {
    const state={nick:'tester',catalog:new Map([[106,{id:106,categoria:'Token'}],
        [107,{id:107,marketEligible:false}]]),
        liveItemAverages:{106:{gold:{media:1500,unidades:8},orb:{media:4,unidades:2}}},
        itemSummaryAt:Date.now(),economyHoldings:[],orderJournal:{accountKey:'one',orders:[]},
        economyInput:{itemId:106,quantity:1,currency:'gold',feeKind:'item',
            feeUnit:100,feeQuantity:1,holdingDays:1}};
    const page={}, kv=new Map();
    const storage={getItem:key=>kv.get(key)??null,setItem:(key,value)=>kv.set(key,value)};
    const src=section('    function itemProvenance(', '    function renderItemInventory()');
    const api=new Function('state','page','localStorage','ECONOMY_HOLDINGS_KEY',
        'ECONOMY_REFERENCE_FRESH_MS','ECONOMY_TELEMETRY_FRESH_MS','itemMediaFor',
        src+'\nreturn { itemProvenance, diamondProvenance, marketplaceFee, loadEconomyHoldings,'+
        'setEconomyHolding, heldItemReference, economyHoldingsSnapshot,'+
        'acquisitionLedgerSummary, readEconomyTelemetry };')(
        state,page,storage,'eco',24*3600000,10*60000,
        id=>state.liveItemAverages[id]||null);
    return {state,page,storage,kv,...api};
}

test('Milestone C: Gem fee follows exact marginal 500 and 5000 brackets', () => {
    const h=economyHarness();
    for(const [total,kind,commission,net] of [
        [3,'item',1,2],[500,'pokemon',65,435],[501,'pokemon',66,435],
        [5000,'pokemon',515,4485],[5001,'pokemon',516,4485],
        [10000,'pokemon',890,9110]]) {
        const fee=h.marketplaceFee(total,'orb',kind,1);
        assert.equal(fee.fee,commission,'commission');
        assert.equal(fee.sellerNet,net,'seller net');
        assert.equal(fee.buyerGross,total);
    }
    assert.equal(h.marketplaceFee(1200,'orb','diamond').fee,180);
    assert.equal(h.marketplaceFee(10000,'orb','pokemon',3).holdingCoins,300000);
    assert.equal(h.marketplaceFee(10000,'orb','item',3).holdingCoins,null);
});

test('Milestone C: Coin commission is a range until rounding is verified', () => {
    const h=economyHarness(), fee=h.marketplaceFee(101,'gold','item');
    assert.equal(fee.exact,false);
    assert.equal(fee.fee,null);
    assert.equal(fee.feeMin,15);
    assert.equal(fee.feeMax,16);
    assert.equal(fee.netMin,85);
    assert.equal(fee.netMax,86);
    assert.equal(h.marketplaceFee(10.5,'orb','pokemon'),null);
    assert.equal(h.marketplaceFee(-1,'gold','item'),null);
    assert.equal(h.marketplaceFee(100,'orb','house'),null);
});

test('Milestone C: market catalog is not proof of NPC or resale eligibility', () => {
    const h=economyHarness();
    assert.equal(h.itemProvenance(106).category,'Token');
    assert.equal(h.itemProvenance(106).source,'welcome.mercado.catalogo');
    assert.equal(h.itemProvenance(106).marketEligible,null);
    assert.equal(h.itemProvenance(106).npcSellable,null);
    assert.equal(h.itemProvenance(106).npcPrice,null);
    assert.equal(h.itemProvenance(107).marketEligible,false);
    assert.equal(h.itemProvenance(999).inMarketCatalog,false);
    assert.equal(h.diamondProvenance('market').eligibility,'not established for resale');
    assert.equal(h.diamondProvenance('pix').eligibility,'server verification required');
});

test('Milestone C: manual holdings are scoped to an account and a single currency', () => {
    const h=economyHarness();
    assert.equal(h.setEconomyHolding(999,10,'gold'),false);
    assert.equal(h.setEconomyHolding(106,2.3,'gold'),false);
    assert.equal(h.setEconomyHolding(106,4,'gold'),true);
    assert.equal(h.economyHoldingsSnapshot().gold,6000);
    assert.equal(h.economyHoldingsSnapshot().orb,0);
    assert.equal(h.setEconomyHolding(106,4,'orb'),true);
    assert.equal(h.state.economyHoldings.length,1);
    assert.equal(h.economyHoldingsSnapshot().unknown,1,'too few Gem sales');
    assert.equal(h.loadEconomyHoldings()[0].currency,'orb');
    h.state.orderJournal.accountKey='two';
    assert.deepEqual(h.loadEconomyHoldings(),[]);
    h.state.orderJournal.accountKey='one';
    assert.equal(h.setEconomyHolding(106,0,'gold'),true);
    assert.equal(h.state.economyHoldings.length,0);
});

test('Milestone C: live completed-sale source expires and cannot infer value', () => {
    const h=economyHarness();
    h.setEconomyHolding(106,4,'gold');
    h.state.itemSummaryAt=Date.now()-25*3600000;
    assert.equal(h.economyHoldingsSnapshot().unknown,1);
    h.state.itemSummaryAt=Date.now();
    h.state.catalog.delete(106);
    assert.equal(h.economyHoldingsSnapshot().unknown,1);
});

test('Milestone C: confirmed buy exposure is not realized seller revenue', () => {
    const h=economyHarness();
    h.state.orderJournal.orders=[
        {currency:'gold',spend:1000,status:'confirmed'},
        {currency:'gold',spend:300,status:'unknown'},
        {currency:'gold',spend:400,status:'refused'},
        {currency:'orb',spend:7,status:'confirmed'}];
    const summary=h.acquisitionLedgerSummary();
    assert.deepEqual(summary.gold,{confirmed:1000,uncertain:300,attempts:2});
    assert.deepEqual(summary.orb,{confirmed:7,uncertain:0,attempts:1});
    assert.equal(Object.hasOwn(summary.gold,'sellerProceeds'),false);
    assert.doesNotMatch(section('    function itemProvenance(', '    function renderItemInventory()'),
        /market\.comprar|market\.criar|sendBackground\(/);
});

test('Milestone C: optional session telemetry avoids duplicate NPC sales', () => {
    const h=economyHarness();
    assert.equal(h.readEconomyTelemetry(),null);
    h.page.MOTH_ECONOMY_TELEMETRY_V1={
        version:1,source:'session',capturedAt:Date.now(),windowMinutes:60,
        observed:{huntCoins:10000,npcSaleCoins:3000,ballsCoins:1000,
            potionsCoins:200,revivesCoins:100,rareDropsUnits:2},
        huntCoinsIncludesNpcSales:true,
        modeled:{rareDropExpectedUnitsPerHour:0.5}};
    assert.equal(h.readEconomyTelemetry().netCoins,8700);
    assert.equal(h.readEconomyTelemetry().rareExpectedPerHour,0.5);
    h.page.MOTH_ECONOMY_TELEMETRY_V1.huntCoinsIncludesNpcSales=false;
    assert.equal(h.readEconomyTelemetry().netCoins,11700);
    h.page.MOTH_ECONOMY_TELEMETRY_V1.huntCoinsIncludesNpcSales=undefined;
    assert.equal(h.readEconomyTelemetry().netCoins,null);
    h.page.MOTH_ECONOMY_TELEMETRY_V1.capturedAt=Date.now()-11*60000;
    assert.equal(h.readEconomyTelemetry(),null);
});

test('Milestone C: independent economy UI cannot start selling automation', () => {
    assert.match(script,/data-moth-view="economy"/);
    assert.match(script,/Read-only fees, market eligibility, and recorded purchase exposure/);
    assert.match(script,/@version\s+0\.6\.9/);
    assert.doesNotMatch(script,/market\.criar|autoSellRules|sendItemSale/);
});


function milestoneDSafetyHarness(overrides={}) {
    const config={
        maxCoinsPerSession:0,maxCoinsPerDay:0,maxGemsPerSession:0,maxGemsPerDay:0,
        maxPurchasesPerSession:0,maxQuantityPerSession:0,
        anyItemRules:[],pokemonBuyRules:[],...overrides
    };
    const confirmations=[];
    const browser={confirm(message){confirmations.push(message);return false;}};
    const src=section('    function broadRuleUnbounded(', '    function fixedRuleStatus(');
    const fn=new Function('config','window','sanitizeAnyItemRules',
        'sanitizePokemonBuyRules','tr','num',
        src+'\nreturn {broadRuleUnbounded,enabledUnboundedBroadRules,confirmUnboundedRule,'+
        'confirmUnboundedMaster,confirmRemovingLastBroadCap,ruleRiskSummary};')(
        config,browser,value=>value,value=>value,(key,params={})=>
            key.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??'')),String);
    return {config,confirmations,...fn};
}

test('Milestone D: configured uncapped buying is allowed without a blocking dialog', () => {
    const h=milestoneDSafetyHarness();
    const broad={kind:'any',currency:'gold',buyMax:10000,buyEnabled:true};
    assert.equal(h.broadRuleUnbounded(broad),true);
    assert.equal(h.confirmUnboundedRule(broad),true);
    assert.equal(h.confirmations.length,0);
    assert.equal(h.config.maxCoinsPerSession,0,'confirmation must not set or mutate limits');
    assert.equal(h.broadRuleUnbounded({...broad,buyEnabled:false}),false);
    assert.equal(h.confirmUnboundedRule({...broad,buyEnabled:false}),true);
    assert.equal(h.confirmations.length,0);
    const c=milestoneDSafetyHarness({maxCoinsPerDay:90000});
    assert.equal(c.broadRuleUnbounded(broad),false);
    assert.equal(c.confirmUnboundedRule(broad),true);
    const r=milestoneDSafetyHarness();
    assert.equal(r.broadRuleUnbounded({...broad,maxPurchasesSession:2}),false);
    assert.equal(r.broadRuleUnbounded({...broad,maxSpendDay:50000}),false);
});

test('Milestone D: master activation accepts configured uncapped categories', () => {
    const pokemon={kind:'p5',currency:'orb',buyMax:5,buyEnabled:true};
    const any={currency:'gold',buyMax:10000,buyEnabled:true};
    const h=milestoneDSafetyHarness({pokemonBuyRules:[pokemon],
        anyItemRules:[any]});
    assert.equal(h.enabledUnboundedBroadRules().length,2);
    assert.equal(h.confirmUnboundedMaster(),true);
    assert.equal(h.confirmations.length,0);
    const c=milestoneDSafetyHarness({pokemonBuyRules:[pokemon],
        anyItemRules:[{...any,buyEnabled:false}],maxGemsPerSession:100});
    assert.equal(c.enabledUnboundedBroadRules().length,0);
    assert.equal(c.confirmUnboundedMaster(),true);
    assert.equal(c.confirmations.length,0);
    assert.match(h.ruleRiskSummary(pokemon,'pokemon'),/per Pokémon/);
    assert.match(h.ruleRiskSummary(any,'any'),/detail offers/);
    assert.match(script,/confirmUnboundedMaster\(\)/);
    assert.match(script,/confirmUnboundedRule\(\{\.\.\.rule, buyEnabled: true\}\)/);
});

function milestoneDDiagnosticsHarness() {
    const state={diagnostics:null,candidates:new Map(),itemOfferDetails:new Map(),
        detailQueue:[],pendingBuy:null,orderJournal:{orders:[]}};
    const src=section('    // BEGIN MOTHWATCH DIAGNOSTICS GENERATED\n',
        '    // END MOTHWATCH DIAGNOSTICS GENERATED');
    const api=new Function('state',src+
        '\nreturn {diagnosticReset,diagnosticProtocol,diagnosticOutcome,'+
        'diagnosticOutbound,diagnosticReport};')(state);
    return {state,...api};
}

test('Milestone D: diagnostics source is synchronized with standalone userscript', () => {
    const source=fs.readFileSync(path.join(__dirname,'..','src',
        'diagnostics-section.js'),'utf8').trimEnd();
    const embedded=section('    // BEGIN MOTHWATCH DIAGNOSTICS GENERATED\n',
        '    // END MOTHWATCH DIAGNOSTICS GENERATED')
        .replace(/^    \/\/ BEGIN MOTHWATCH DIAGNOSTICS GENERATED\n/, '').trimEnd();
    assert.equal(embedded,source,'module must exactly match generated userscript section');
    const tool=fs.readFileSync(path.join(__dirname,'..','build.cjs'),'utf8');
    assert.match(tool,/--check/);
    assert.match(script,/@version\s+0\.6\.9/);
    assert.doesNotMatch(script,/^\s*\/\/\s*@(?:downloadURL|updateURL)/m,
        'private repo must not advertise inaccessible raw auto-update endpoints');
});

test('Milestone D: diagnostics remain opt-in, bounded and cannot export packet values', () => {
    const h=milestoneDDiagnosticsHarness(), secret='SECRET_PLAYER_AND_CREDENTIALS_XXXX';
    const packet={t:'market',aba:'item',moeda:'orb',pagina:1,
        nick:secret,senha:secret,vendedor:secret,listingId:88887777,
        linhas:[{nome:secret,vendedor:secret,id:999999,token:secret}],
        unknownDynamicKey:secret};
    h.diagnosticReset(false);
    h.diagnosticProtocol(packet);
    assert.equal(h.state.diagnostics.count,0,'disabled by default');
    h.diagnosticReset(true);
    for(let i=0;i<1000;i++)h.diagnosticProtocol(packet);
    h.diagnosticOutcome('confirmed');
    h.diagnosticOutcome('unknown');
    h.diagnosticOutcome('malicious:'+secret);
    h.diagnosticOutbound({t:'market.item',preco:12345,vendedor:secret});
    const report=h.diagnosticReport();
    const text=JSON.stringify(report);
    assert.equal(report.inboundPackets,1000);
    assert.equal(report.recentShapes.length,64,'bounded allocation even after long sessions');
    assert.equal(report.inboundFamilies['market:item'],1000);
    assert.equal(report.outboundKinds['market.item'],1);
    assert.equal(report.purchaseOutcomes.unknown,1);
    assert.equal(report.purchaseOutcomes.confirmed,1);
    for(const leakage of [secret,'88887777','999999','12345','unknownDynamicKey'])
        assert.equal(text.includes(leakage),false,'report leaked '+leakage);
    assert.ok(report.recentShapes.every(row=>row.keys.every(key=>
        ['t','aba','tipo','moeda','pagina','itemId','linhas','resumo','medias',
         'mediaDiamante','temMais','estado','mercado','catalogo','ev','chave',
         'listingId','anuncioId','vendaId','servidorAgora'].includes(key))));
    h.diagnosticReset(false);
    assert.equal(h.state.diagnostics.samples.length,0);
});

test('Milestone D: redacted replay keeps currency and empty-page distinction', () => {
    const h=milestoneDDiagnosticsHarness();
    h.diagnosticReset(true);
    const replay=[
        {t:'market',aba:'vitrine',tipo:'pokemon',moeda:'gold',pagina:0,linhas:[]},
        {t:'market',aba:'vitrine',tipo:'pokemon',moeda:'orb',pagina:0,linhas:[]},
        {t:'market',aba:'vitrine',linhas:[]},
        {t:'erro',chave:'limited-secret-should-not-export',anuncioId:123456},
        {t:'batalha',ev:[{k:'marketComprado',listingId:333}]}
    ];
    for(const pkt of replay)h.diagnosticProtocol(pkt);
    const report=h.diagnosticReport();
    assert.equal(report.inboundFamilies['market:vitrine'],3);
    assert.equal(report.inboundFamilies.erro,1);
    assert.equal(report.inboundFamilies.batalha,1);
    assert.equal(report.recentShapes[0].keys.includes('moeda'),true);
    assert.equal(report.recentShapes[2].keys.includes('moeda'),false);
    assert.equal(JSON.stringify(report).includes('limited-secret'),false);
    assert.equal(JSON.stringify(report).includes('333'),false);
    assert.equal(report.recentShapes[0].empty,true);
});


test('Milestone D: removing cumulative caps preserves intentional unlimited purchase authorization', () => {
    const capped=milestoneDSafetyHarness({
        maxCoinsPerSession:3000,
        anyItemRules:[{currency:'gold',buyMax:500,buyEnabled:true}]
    });
    assert.equal(capped.enabledUnboundedBroadRules().length,0);
    capped.config.maxCoinsPerSession=0;
    assert.equal(capped.enabledUnboundedBroadRules().length,1);
    assert.equal(capped.confirmRemovingLastBroadCap(),true);
    assert.equal(capped.confirmations.length,0);
    assert.match(script,/!previouslyUnbounded\s*&&\s*broadRuleUnbounded\(rule\)/);
    assert.match(script,/oldUnboundedCount\s*=\s*enabledUnboundedBroadRules\(\)\.length/);
    assert.match(script,/config\[key\]\s*=\s*oldValue/);
});

test('Milestone D: disabled rule statuses take precedence over exhausted budget', () => {
    const cfg={enabled:true,fixedRulesEnabled:true,purchasesPaused:false};
    const shared=['config','unverifiedOrdersExist','remainingBudget','state','gameIsLoading',
        'balanceFor','reserveFor','fixedRuleCandidate','purchaseQuantity','tr'];
    const source=section('    function fixedRuleStatus(', '    function ruleNumber(');
    const fn=new Function(...shared,source+'\nreturn fixedRuleStatus;')(
        cfg,()=>{throw Error('should not inspect journal for inactive rule')},
        ()=>{throw Error('should not inspect budget for inactive rule')},
        {},()=>false,()=>0,()=>0,()=>null,()=>0,x=>x);
    assert.equal(fn({currency:'gold',buyMax:10,buyEnabled:false}),'Rule paused');
    cfg.fixedRulesEnabled=false;
    assert.equal(fn({currency:'gold',buyMax:10,buyEnabled:true}),'Enable rule-based buying above');
});


test('Milestone D: stale rule quotes are never described as currently eligible', () => {
    const state={socket:{readyState:1},pendingBuy:null,
        itemOfferDetails:new Map([['106:gold',{updatedAt:Date.now()}]])};
    const cfg={enabled:true,fixedRulesEnabled:true,purchasesPaused:false};
    const src=section('    function fixedRuleStatus(', '    function ruleNumber(');
    const fn=new Function('config','state','unverifiedOrdersExist','remainingBudget',
        'gameIsLoading','balanceFor','reserveFor','fixedRuleCandidate',
        'purchaseQuantity','freshQuote','tr',
        src+'\nreturn fixedRuleStatus;');
    const make=fresh=>fn(cfg,state,()=>false,()=>({spend:Infinity}),
        ()=>false,()=>10000,()=>0,()=>({listingId:1,seenAt:Date.now()-45000}),
        ()=>1,()=>fresh,x=>x);
    const rule={id:'test',itemId:106,currency:'gold',buyEnabled:true,buyMax:50};
    assert.equal(make(false)(rule),'Checking listings…');
    assert.equal(make(true)(rule),'Eligible listing available');
    assert.match(script,/candidate \&\& freshQuote\(candidate, false\)/);
});


test('MothWatch v0.6.1: source sections match the single distributable userscript', () => {
    const parts = [
        ['RULES','rules-section.js'], ['ORDERS','orders-section.js'],
        ['TRANSPORT','transport-section.js'], ['PRICING','pricing-section.js'],
        ['ECONOMY','economy-section.js'], ['RULE_SAFETY','rule-safety-section.js'],
        ['DIAGNOSTICS','diagnostics-section.js'],
        ['ITEM_SCANNER','item-scanner-section.js'],
        ['POKEMON_SCANNER','pokemon-scanner-section.js'],
        ['AUTO_SCANNER','automation-scanner-section.js'],
        ['SOCKET','socket-section.js'], ['UI_STYLE','ui-style-section.js'],
        ['UI_BROWSER','ui-browser-section.js'], ['UI_RULES','ui-rules-section.js'],
        ['UI_RENDER','ui-render-section.js'], ['UI_EVENTS','ui-events-section.js']
    ];
    for (const [id, name] of parts) {
        const begin = '    // BEGIN MOTHWATCH ' + id + ' GENERATED\n';
        const end = '\n    // END MOTHWATCH ' + id + ' GENERATED';
        const a = script.indexOf(begin), b = script.indexOf(end, a + begin.length);
        assert.ok(a >= 0 && b > a, 'module markers: ' + id);
        const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8').trimEnd();
        assert.equal(script.slice(a + begin.length, b), moduleSource, 'generated parity: ' + id);
    }
    assert.match(script, /@version\s+0\.6\.9/);
    assert.doesNotMatch(script, /\bimport\s*\(|\brequire\s*\(/,
        'one Violentmonkey userscript must not require runtime module loading');
});

function inventoryMemoHarness() {
    const state = {
        selectedItemFocus: null,
        itemDetailStatus: null,
        itemOfferDetails: new Map(),
        itemSummary: {106: {minGold: 100}},
        itemNames: new Map(),
        catalog: new Map([[106, {id: 106}]]),
        itemInventoryCollapsed: false,
        detailQueued: new Set(),
        detailQueue: [],
        detailPending: null,
        itemInventoryMemo: null,
        orderJournal: {accountKey: 'profileA'}
    };
    let builds = 0, locale = 'pt-BR';
    const renderItemInventory = () => 'inventory-' + (++builds);
    const code = section('    function inventoryViewSnapshot(', '    function renderWatch(');
    const snapshot = new Function('state', 'currentLocale', 'renderItemInventory',
        code + '\nreturn inventoryViewSnapshot;')(state, () => locale, renderItemInventory);
    return {state, snapshot, builds: () => builds, setLocale: next => {locale = next;}};
}

test('MothWatch v0.6.1: inventory HTML cache ignores unrelated repeated telemetry updates', () => {
    const h = inventoryMemoHarness();
    const first = h.snapshot();
    assert.equal(first.html, 'inventory-1');
    for (let i = 0; i < 3000; i++) {
        assert.equal(h.snapshot(), first);
    }
    assert.equal(h.builds(), 1, 'no unnecessary rebuilding in long sessions');
    h.state.itemSummary = {106:{minGold: 99}};
    assert.notEqual(h.snapshot(), first);
    assert.equal(h.builds(), 2, 'changed summary must invalidate');

    h.state.selectedItemFocus = {key:'106:gold'};
    h.state.itemOfferDetails.set('106:gold', {updatedAt:1, offers:[]});
    const focused = h.snapshot();
    assert.equal(h.builds(), 3);
    h.state.itemOfferDetails.set('106:gold', {updatedAt:2, offers:[{id:7,preco:50}]});
    assert.notEqual(h.snapshot(), focused, 'updated offer details must invalidate');
    assert.equal(h.builds(), 4);
    h.state.itemDetailStatus = {key:'106:gold',status:'loaded'};
    h.snapshot();
    assert.equal(h.builds(), 5);
    h.state.detailPending = {key:'106:gold'};
    h.snapshot();
    assert.equal(h.builds(), 6);
    h.state.detailPending = null;
    h.snapshot();
    assert.equal(h.builds(), 7);
});

test('MothWatch v0.6.1: inventory memo invalidates across account, locale, collapse and queue transitions', () => {
    const h = inventoryMemoHarness();
    h.snapshot();
    h.state.orderJournal.accountKey = 'profileB';
    h.snapshot();
    h.setLocale('en');
    h.snapshot();
    h.state.itemInventoryCollapsed = true;
    h.snapshot();
    h.state.selectedItemFocus = {key:'106:gold'};
    h.snapshot();
    h.state.detailQueued.add('106:gold');
    h.snapshot();
    h.state.detailQueued.clear();
    h.snapshot();
    h.state.itemInventoryMemo = null;
    h.snapshot();
    assert.equal(h.builds(), 8);
    assert.match(script, /state\.itemInventoryMemo\s*=\s*null;\s*state\.lastInventoryPaint\s*=\s*null;\s*state\.catalog\.clear\(\)/,
        'new welcome catalog must invalidate memo despite stable Map identity');
});

test('MothWatch v0.6.1: off-tab view updates avoid candidate sorting and settings serialization', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src',
        'ui-render-section.js'), 'utf8');
    assert.match(src, /if \(state\.watchView === 'opportunities'\) candidates\.sort\(candidateSort\)/);
    assert.match(src, /const baseline = state\.watchView === 'activity' \? baselineStats\(\) : null/);
    assert.match(src, /const settingsSignature = state\.watchView === 'automation'/);
    assert.match(src, /state\.lastInventoryPaint !== snapshot/);
    assert.doesNotMatch(src, /host\.innerHTML !== html\)\s*\{\s*const oldScroller/,
        'do not serialize the entire inventory DOM every 250 ms');
});


test('MothWatch v0.6.1: cached Buy controls invalidate only for focused item quote changes', () => {
    const state = {
        candidates: new Map(), firstSeenCache: new Map(),
        releaseTimers: new Map(), itemInventoryMemo: {html:'old'},
        selectedItemFocus: {key:'106:gold'}, lastItem: null
    };
    const src = section('    function addCandidate(', '    function pruneDetailCache(');
    const insert = new Function('state','MAX_CANDIDATES','MAX_FIRST_SEEN',
        'scheduleCandidateRelease','queueRender',
        src + '\nreturn addCandidate;')(state, 600, 1800, () => {}, () => {});
    insert({key:'item:107:gold:1',kind:'item',itemId:107,currency:'gold',
        listingId:1,price:3,seenAt:Date.now()});
    assert.ok(state.itemInventoryMemo,'unrelated offer should not force large inventory redraw');
    insert({key:'item:106:gold:2',kind:'item',itemId:106,currency:'gold',
        listingId:2,price:3,seenAt:Date.now()});
    assert.equal(state.itemInventoryMemo,null,'selected item quote must redraw Buy actions');
    assert.match(script,/if \(status === 'confirmed'\) \{\s*state\.candidates\.delete\(pending\.candidateKey\);\s*state\.itemInventoryMemo = null;/);
});


function heldSnatchHarness() {
    let now = Date.now();
    let server=now-2000, purchaseCalls=[], refreshCalls=0, timers=[], pending=false,
        unknown=false, sentAt=0;
    const DateClock=class extends Date { static now() {return now;} };
    const state={
        nick:'buyer',orderJournal:{accountKey:'acct',sessionId:'sess',orders:[]},
        gameSocket:{readyState:1},pendingBuy:null,rateLimitedUntil:0,
        snatchWake:null,snatchManual:new Map(),snatchObserved:new Map(),
        snatchNativeOffers:new Map(),snatchRecoverAt:new Map(),
        attemptedListings:new Map(),detailQueue:[],detailQueued:new Set(),
        ruleItemKeys:new Set(),itemOfferDetails:new Map(),pokemonAutoOffers:new Map(),
        lastDetailRequest:new Map()
    };
    const config={enabled:true,fixedRulesEnabled:true,purchasesPaused:false};
    const src=fs.readFileSync(path.join(__dirname,'..','src','snatch-section.js'),'utf8');
    const api=new Function('state','config','Date','setTimeout','clearTimeout',
        'orderAccountKey','serverNow','isOwnListing','unresolvedListing',
        'activeRuleById','sanitizeFixedItemRules','sanitizeAnyItemRules',
        'sanitizePokemonBuyRules','activeAnyItemRules','activePokemonRules',
        'pokemonRuleMatches','pokemonListingName','catalogName','localStorage',
        'queueRender','addLog','tr','num','money','escapeHtml','gameIsLoading',
        'unverifiedOrdersExist','freshQuote','purchaseQuantity','backgroundDelayMs',
        'tryBuy','snatchRefresh','currentRuleMatches',
        // Shadowing source functions is not needed; fetch availability via stub.
        src+'\nreturn {snatchKey,snatchReleaseQuote,snatchTick,snatchSchedule,'+
        'snatchOutcome,snatchStop,snatchObserve,snatchMark,snatchQueueHtml,'+
        'snatchDisplayStatus,snatchQueueCounts,snatchButton};')(
        state,config,DateClock,(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},
        ()=>{},()=> 'acct',()=>server,
        ()=>false,()=>unknown,()=>null,()=>[],()=>[],()=>[],()=>[],()=>[],
        ()=>true,()=> 'Pokémon',()=> 'Item', {getItem:()=>null,setItem:()=>{}},
        ()=>{},()=>{},x=>x,String,String,String,()=>false,()=>unknown,
        ()=>false,()=>1,()=>0,(c,manual,qty,rule,release)=>{
            purchaseCalls.push({id:c.listingId,manual,qty,release});
            state.pendingBuy={listingId:c.listingId,sentAt:now};
            sentAt=server;return true;
        },()=>{refreshCalls++;},()=>true);
    const candidate={key:'snatch:item:gold:789',kind:'item',listingId:789,
        itemId:106,name:'Test',currency:'gold',price:100,unitPrice:100,
        qty:1,seller:'seller',seenAt:now,retainedUntil:now,average:0,ratio:1};
    const key=api.snatchKey('item','gold',789);
    state.snatchManual.set(key,{kind:'item',currency:'gold',id:789,itemId:106,
        maxPrice:100,expiresAt:now+500000});
    state.snatchObserved.set(key,{candidate,ruleId:'',releaseAt:now,
        retryAt:0,attempts:0,refreshedAt:now,observedAt:now});
    return {state,config,key,candidate,api,purchaseCalls,timers,
        setServer:t=>{server=t;},setUnknown:v=>{unknown=v;},
        advance:ms=>{now+=ms;server+=ms;},getSentAt:()=>sentAt};
}

test('Snatch: verified two-minute hold is prearmed; first buy needs no market scan', () => {
    const h=heldSnatchHarness();
    h.api.snatchSchedule();
    const first=h.timers.at(-1);
    assert.equal(first.ms,2000,'release timer must target actual server unlock');
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,0,'never purchase before retention expires');
    h.setServer(h.candidate.retainedUntil);
    assert.equal(h.api.snatchReleaseQuote(h.candidate),true);
    h.api.snatchTick();
    assert.deepEqual(h.purchaseCalls,[{id:789,manual:true,qty:1,release:true}]);
    assert.equal(h.getSentAt(),h.candidate.retainedUntil);
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,1,'one pending order at a time');
    h.setUnknown(true);
    h.state.pendingBuy=null;
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,1,'unknown result blocks duplicate');
});

test('Snatch: explicit refused order releases 400ms retry; success removes target', () => {
    const h=heldSnatchHarness();
    h.setServer(h.candidate.retainedUntil);
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,1);
    h.state.pendingBuy=null;
    h.api.snatchOutcome(789,'refused');
    const retryDelay=h.state.snatchObserved.get(h.key).retryAt-Date.now();
    assert.ok(retryDelay>0 && retryDelay<=400,'refusal schedules a short bounded retry');
    // The test clock stays fixed; advance retry deadline explicitly.
    h.state.snatchObserved.get(h.key).retryAt=0;
    h.state.attemptedListings.delete(789);
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,2,'retry must not wait for market refresh');
    h.api.snatchOutcome(789,'confirmed');
    assert.equal(h.state.snatchObserved.has(h.key),false);
    assert.equal(h.state.snatchManual.has(h.key),false);
});

test('Snatch: stale pre-release quotes fail closed and server backoff is observed', () => {
    const h=heldSnatchHarness();
    h.setServer(h.candidate.retainedUntil);
    h.state.rateLimitedUntil=Date.now()+15000;
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,0);
    h.state.rateLimitedUntil=0;
    h.candidate.seenAt=Date.now()-190000;
    assert.equal(h.api.snatchReleaseQuote(h.candidate),false);
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,0,'no speculative purchase from expired quote');
    const retryDelay=h.state.snatchObserved.get(h.key).retryAt-Date.now();
    assert.ok(retryDelay>0 && retryDelay<=1000,'stale quote retry is bounded without a spin');
});


test('Snatch UX: held, pending, paused, unknown and disconnected are distinct', () => {
    const h=heldSnatchHarness();
    const target=h.state.snatchManual.get(h.key);
    const observed=h.state.snatchObserved.get(h.key);
    let status=h.api.snatchDisplayStatus(target,observed);
    assert.equal(status.tone,'held');
    assert.match(status.text,/Unlocks in/);
    h.state.pendingBuy={listingId:789};
    status=h.api.snatchDisplayStatus(target,observed);
    assert.match(status.text,/awaiting server confirmation/);
    h.state.pendingBuy=null;
    h.setUnknown(true);
    status=h.api.snatchDisplayStatus(target,observed);
    assert.equal(status.tone,'warning');
    assert.match(status.text,/unverified purchase/);
    h.setUnknown(false);
    h.config.purchasesPaused=true;
    assert.match(h.api.snatchDisplayStatus(target,observed).text,/paused/);
    h.config.purchasesPaused=false;
    h.state.gameSocket=null;
    assert.match(h.api.snatchDisplayStatus(target,observed).text,/connection/);
    h.config.enabled=false;
    assert.match(h.api.snatchDisplayStatus(target,observed).text,/disabled/);
});

test('Snatch UX: queue displays exact listing, ceiling, origin and immediate cancellation', () => {
    const h=heldSnatchHarness();
    const html=h.api.snatchQueueHtml();
    assert.match(html, /moth-mw-snatch-entry/);
    assert.match(html, /Player-marked targets/);
    assert.match(html, /Maximum price:/);
    assert.match(html, /#789/);
    assert.match(html, /Cancel snatch/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /role="status"/);
    assert.equal(h.api.snatchQueueCounts().manual,1);
    h.state.snatchManual.clear();
    assert.equal(h.api.snatchQueueCounts().manual,0);
    assert.match(h.api.snatchQueueHtml(),/No snatches armed/);
    assert.match(h.api.snatchButton('item','gold',789,106),/data-moth-snatch="item:gold:789"/);
    assert.equal(h.api.snatchButton('diamond','gold',789,106),'');
});

test('Snatch UX: dedicated queue, focus recovery and responsive controls are wired', () => {
    const render=fs.readFileSync(path.join(__dirname,'..','src',
        'ui-render-section.js'),'utf8');
    const events=fs.readFileSync(path.join(__dirname,'..','src',
        'ui-events-section.js'),'utf8');
    const style=fs.readFileSync(path.join(__dirname,'..','src',
        'ui-style-section.js'),'utf8');
    const source=fs.readFileSync(path.join(__dirname,'..','src',
        'snatch-section.js'),'utf8');
    assert.match(render,/data-moth-view="snatches"/);
    assert.match(render,/moth-mw-snatch-tab/);
    assert.match(render,/snatchQueueCounts\(\)/);
    assert.match(render,/focused = snatchHost\.contains\(document\.activeElement\)/);
    assert.match(render,/restored\.focus\(\{preventScroll:true\}\)/);
    assert.match(events,/data-moth-goto/);
    assert.match(events,/Snatch armed for listing/);
    assert.match(source,/data-moth-snatch=/);
    assert.match(source,/aria-label/);
    assert.match(source,/snatchEnhanceNativeMarket/);
    assert.match(style,/moth-mw-snatch-entry-bottom/);
    assert.match(style,/max-width:600px/);
    assert.match(script,/moth-pokeidle-market-watch-view-v1/);
    const pt=section('    const PT_BR = Object.freeze(', '    function tr(');
    const dict=new Function(pt+'\nreturn PT_BR;')();
    for(const key of ['Snatch queue','Snatch','Cancel snatch',
        'Purchases are paused','Purchase sent · awaiting server confirmation',
        'Snatch armed for listing #{id}.','Competing for purchase'])
        assert.ok(dict[key],key+' must be translated to PT-BR');
});


test('Snatch hardening: progressive acknowledged-refusal retries and protected release window', () => {
    const source=fs.readFileSync(path.join(__dirname,'..','src','snatch-section.js'),'utf8');
    const body=section('    function snatchRetryDelay(', '    function snatchKey(');
    const retry=new Function('SNATCH_RETRY_MS',body+'\nreturn snatchRetryDelay;')(400);
    assert.deepEqual([0,29,30,89,90,250].map(retry),[400,400,1500,1500,5000,5000]);
    assert.doesNotMatch(source,/SNATCH_ATTEMPT_LIMIT/);
    assert.match(source,/releaseAt-now < 1200/);
    assert.match(source,/snatchRetryDelay\(entry\.attempts\)/);
    assert.match(source,/rule target expired/);
});


test('Throughput: native browsing does not suspend buys, but snatch release wins the slot', () => {
    const state = {socket:{readyState:1},pendingBuy:null,automationLastRunAt:0,
        ruleItemKeys:new Set(),detailQueue:[],detailPending:null};
    const config={enabled:true,fixedRulesEnabled:true,purchasesPaused:false,
        fixedItemRules:[{id:'rule',itemId:106,currency:'gold',buyMax:100,buyEnabled:true}]};
    let critical=false, bought=0;
    const run=new Function('state','config','gameIsLoading','communityMarketIsOpen',
        'hasAnyBuyingRules','sanitizeFixedItemRules','activeAnyItemRules','activePokemonRules',
        'anyItemRuleTargets','automationDetail','fixedRuleCandidate','purchaseQuantity',
        'tryBuy','anyItemRuleCandidate','pokemonRuleCandidate','snatchCriticalWindow',
        section('    function runMarketAutomation(', '    function runScan(force)')+
        '\nreturn runMarketAutomation;')(
        state,config,()=>false,()=>true,()=>true,v=>v,()=>[],()=>[],()=>[],
        ()=>{},()=>({listingId:201}),()=>1,()=>{bought++;return true;},
        ()=>null,()=>null,()=>critical);
    run();
    assert.equal(bought,1,'native community-market modal must not disable rule buys');
    critical=true;state.automationLastRunAt=0;
    run();
    assert.equal(bought,2,'ordinary buys must continue despite the Snatch quiet window');
});

test('Throughput: verified broad-rule details survive target rotation', () => {
    const source=fs.readFileSync(path.join(__dirname,'..','src',
        'item-scanner-section.js'),'utf8');
    const segment=source.slice(source.indexOf('    function processItemListingPayload('),
        source.indexOf('    function itemMediaFor('));
    const state={loadedItemKeys:new Set(),ruleItemKeys:new Set(),
        itemOfferDetails:new Map(),itemMarketCaps:new Map(),
        selectedItemFocus:null,sellRecommendationKey:null};
    const ingest=new Function('state','snatchConfirmItemListingSet','pruneDetailCache',
        'itemReference','queueRender','median',segment+
        '\nreturn processItemListingPayload;')(
        state,()=>{},()=>{},()=>null,()=>{},()=>0);
    ingest(106,'gold',[{id:201,preco:90,qtd:2,vendedor:'other'}]);
    assert.equal(state.itemOfferDetails.get('106:gold').offers[0].id,201,
        'rotation of ruleItemKeys must not discard an authenticated listing');
});

test('Throughput: native item detail is usable without an outgoing scan', () => {
    const src=section('    function handleItemListings(', '    function processItemListingPayload(');
    const state={detailPending:null}, accepted=[];
    let native=true;
    const receive=new Function('state','communityMarketIsOpen','finishItemDetailRequest',
        'processItemListingPayload',src+'\nreturn handleItemListings;')(
        state,()=>native,()=>{},(...args)=>accepted.push(args));
    receive({itemId:106,moeda:'gold',linhas:[{id:33,preco:90,qtd:1}]});
    assert.equal(accepted.length,1);
    native=false;
    receive({itemId:106,moeda:'gold',linhas:[{id:34,preco:80,qtd:1}]});
    assert.equal(accepted.length,1,'unattributed market packets are not treated as scans');
});

test('Throughput: native Pokemon price pages update rule evidence only when typed', () => {
    const source=fs.readFileSync(path.join(__dirname,'..','src',
        'pokemon-scanner-section.js'),'utf8');
    const part=source.slice(source.indexOf('    function handlePokemonListings('));
    const state={pokemonScan:null,pokemonAutoOffers:new Map()};
    const receive=new Function('state','communityMarketIsOpen','marketReplyMatches',
        part+'\nreturn handlePokemonListings;')(
        state,()=>true,()=>false);
    const row={id:301,preco:100,qtd:1,moeda:'gold',
        vendedor:'seller',ficha:{shiny:false,potencia:4}};
    receive({aba:'vitrine',tipo:'pokemon',moeda:'gold',pagina:0,linhas:[row]});
    assert.equal(state.pokemonAutoOffers.get('gold').offers[0].id,301);
    receive({aba:'vitrine',moeda:'gold',pagina:0,linhas:[]});
    assert.equal(state.pokemonAutoOffers.get('gold').offers.length,1,
        'untyped empty packets cannot erase valid purchase evidence');
});

test('Snatch: repeated server refusals generate multiple post-release orders', () => {
    const h=heldSnatchHarness();
    h.setServer(h.candidate.retainedUntil);
    for(let i=0;i<4;i++){
        h.api.snatchTick();
        assert.equal(h.purchaseCalls.length,i+1,
            'each acknowledged refusal permits another single guarded order');
        h.state.pendingBuy=null;
        h.api.snatchOutcome(789,'refused');
        assert.equal(h.state.snatchObserved.get(h.key).attempts,i+1);
        h.state.snatchObserved.get(h.key).retryAt=0;
        h.state.attemptedListings.delete(789);
    }
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,5,'snatch remains armed after several losses');
    h.api.snatchOutcome(789,'confirmed');
    assert.equal(h.state.snatchObserved.has(h.key),false);
});

// A released Snatch must not go to sleep for 10 seconds behind an unrelated
// pending purchase, and a server result must immediately resume the pipeline.
test('Snatch: unrelated pending purchases never block a due release', () => {
    const h=heldSnatchHarness();
    h.setServer(h.candidate.retainedUntil);
    h.state.pendingBuy={listingId:999,sentAt:Date.now()};
    h.api.snatchTick();
    assert.equal(h.purchaseCalls.length,1,
        'released Snatch dispatches without waiting for another order');
});

test('Throughput: settlement schedules another authorized buy without a 1s stall', () => {
    const src=section('    function finishPendingBuy(', '    function requestItemSummary(');
    const state={pendingBuy:{
        order:{listingId:201,status:'submitted'},listingId:201,candidateKey:'rule:201',
        kind:'item',itemId:106,currency:'gold'
    },candidates:new Map(),snatchObserved:new Map(),
        itemInventoryMemo:{},ruleItemKeys:new Set(),lastDetailRequest:new Map()};
    const config={purchasesPaused:false};
    const scheduled=[];
    let purchased=0, refreshed=0;
    const fn=new Function('state','config','settleOrder','diagnosticOutcome',
        'snatchCriticalWindow','hasAnyBuyingRules','activeAnyItemRules',
        'queueItemDetail','startPokemonScan','queueRender','setTimeout',
        'snatchTick','runMarketAutomation',src+'\nreturn finishPendingBuy;')(
        state,config,()=>{},()=>{},()=>false,()=>true,()=>[],
        ()=>refreshed++,()=>{},()=>{},(callback,ms)=>{scheduled.push({callback,ms});},
        ()=>{},()=>purchased++);
    fn('server-confirmed');
    assert.equal(state.pendingBuy,null);
    assert.equal(refreshed,1);
    assert.ok(scheduled.some(x=>x.ms===0),'next buy is scheduled immediately');
    scheduled.find(x=>x.ms===0).callback();
    assert.equal(purchased,1);
});

test('Snatch: retries repeatedly after release before any acknowledgement', () => {
    const h=heldSnatchHarness();
    h.setServer(h.candidate.retainedUntil);
    h.api.snatchTick();
    for (let count=2;count<=3;count++) {
        h.advance(400);
        h.api.snatchTick();
        assert.equal(h.purchaseCalls.length,count,
            'Snatch must reissue orders even while prior attempts await a response');
    }
    h.api.snatchOutcome(789,'unknown');
    assert.equal(h.state.snatchObserved.has(h.key),true,
        'missing acknowledgement is not evidence that the listing sold');
    h.api.snatchOutcome(789,'confirmed');
    assert.equal(h.state.snatchObserved.has(h.key),false,
        'a server-confirmed purchase immediately disarms the Snatch');
});

test('Snatch: multiple pending orders respect bounded same-listing burst', () => {
    const src=section('    function tryBuy(', '    function controllerResult(');
    let now=Date.now(),sent=[],tasks=[];
    const Clock=class extends Date {static now(){return now;}};
    const state={
        nick:'buyer',gameSocket:{readyState:1},
        orderJournal:{accountKey:'acct',sessionId:'sess',orders:[]},
        pendingBuy:null,pendingBuys:new Map(),lastPurchaseSendAt:0,
        attemptedListings:new Map(),rateLimitedUntil:0
    };
    const fn=new Function('state','config','Date','freshQuote','snatchReleaseQuote',
        'activeRuleById','currentRuleMatches','orderAccountKey','pokemonCurrencyAllowed',
        'serverNow','purchaseQuantity','orderDay','balanceFor','reserveOrder',
        'diagnosticOutcome','send','saveOrderJournal','addLog','num','queueRender',
        'setTimeout','runMarketAutomation','MAX_PENDING_BUYS',
        'MAX_SNATCH_PENDING_PER_LISTING','BUY_DISPATCH_GAP_MS','SNATCH_RETRY_MS',
        src+'\nreturn tryBuy;')(
        state,{purchasesPaused:false},Clock,()=>true,()=>true,
        ()=>null,()=>true,()=> 'acct',()=>true,()=>now,()=>1,
        ()=> '2026-10-13',()=>1000,
        order=>{state.orderJournal.orders.push(order);return true;},
        ()=>{},order=>{sent.push(order);return true;},()=>true,()=>{},String,()=>{},
        (callback,ms)=>{tasks.push({callback,ms});},()=>{},5,3,120,400);
    const c={kind:'item',listingId:789,key:'snatch:item:gold:789',
        itemId:106,name:'Item',currency:'gold',price:10,qty:1,
        seller:'other',seenAt:now,retainedUntil:0};
    assert.equal(fn(c,true,1,false,true),true);
    for(let i=0;i<2;i++){
        now+=400;
        assert.equal(fn(c,true,1,false,true),true);
    }
    now+=400;
    assert.equal(fn(c,true,1,false,true),false,
        'unacknowledged same-listing burst stops at three submissions');
    assert.equal(state.pendingBuys.get(789).length,3);
    assert.equal(state.orderJournal.orders.length,3,
        'every network attempt is recorded as a separate reserved order');
    assert.equal(fn({...c,listingId:790},true,1,false,true),true,
        'a different eligible listing may buy while Snatch requests are outstanding');
    assert.equal(sent.length,4);
    assert.equal(state.pendingBuys.get(790).length,1);
});
