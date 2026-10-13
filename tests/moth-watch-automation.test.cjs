'use strict';

// Run with node --test tests/moth-watch-automation.test.cjs.
// These tests exercise userscript code without a live game or real orders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'addons', 'market-bot.user.js'), 'utf8');
const protocolFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'moth-watch-market-protocol.json'), 'utf8'));


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
        'itemReference', 'catalogName', section('    function fixedRuleCandidate(', '    function runMarketAutomation(') +
        '\nreturn fixedRuleCandidate;')(state, offer => offer.vendedor === 'self',
        offer => Number(offer.compravelEm || 0) > now ? offer.compravelEm : 0,
        () => now, () => null, () => 'Cocoon Stone');
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
        section('    function runMarketAutomation(', '    function runScan(force)') + '\nreturn runMarketAutomation;')(
        config, state, () => false, () => null, () => false, () => false, v => v,
        id => { requested.push(id); }, rule => ({ listingId: rule.itemId, name: String(rule.itemId) }),
        candidate => candidate.listingId === 106 ? 0 : 1,
        candidate => { bought.push(candidate.listingId); return true; },
        () => config.enabled && config.fixedRulesEnabled,
        () => [], () => [], () => [], () => null, () => null
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


test('General scans slow to 30 seconds only while background rule buying is active', () => {
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
        '\nreturn runScan;')(state, config, {now: () => clock}, 30000,
        () => false, () => calls.push('items'), () => calls.push('history'),
        () => calls.push('pokemon'), () => calls.push('diamond'),
        () => calls.push('prune'), () => calls.push('render'),
        () => config.fixedRulesEnabled && state.ruleItemKeys.size > 0, () => [], () => []);
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 1);
    clock += 20000;
    runScan(false);
    assert.equal(calls.filter(x => x === 'items').length, 1, 'Closed buying mode throttles general scans');
    clock += 10000;
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
    const state = { pokemonReference: { version: 2, capturedAt: 0, values: {} } };
    const config = { minPokemonSamples: 3 };
    const src = section('    function pokemonIdentityKey(', '    function requestHistoryPage()');
    const api = new Function('state', 'config', 'speciesIdOf', 'levelBand',
        'pokemonCurrencyAllowed', 'savePokemonReference', 'addLog', 'queueRender',
        src + '\nreturn { pokemonIVs, pokemonFacts, pokemonIdentityKey, pokemonComparableSales, ' +
        'addPokemonHistorySample, finalizePokemonHistory, pokemonReferenceFor };')(
        state, config, ficha => ficha?.speciesId || null,
        level => level < 100 ? 'lt100' : level < 500 ? '100-499' : '500+',
        (ficha, currency) => currency === 'orb' || !ficha?.shiny,
        () => {}, () => {}, () => {});
    return { state, config, ...api };
}

function samplePokemon(overrides = {}) {
    return {
        speciesId: 25, level: 100, nota: 3.55, qualidade: 1.25, potencia: 4,
        shiny: false,
        ivs: { hp: 20, atk: 32, def: 20, spAtk: 5, spDef: 20, speed: 29 },
        ...overrides
    };
}

test('V2 Pokémon references use comparable graded sales, never pool N=3.5 with N=4.0', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    [100, 120, 140].forEach(price => h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', bruto: price, ficha: samplePokemon()
    }, sales));
    h.finalizePokemonHistory(sales);
    const ref = h.pokemonReferenceFor(samplePokemon(), 'gold');
    assert.equal(h.state.pokemonReference.version, 2);
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

test('V2 downgrades confidence for different IV builds and missing game score', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    [100, 110, 120].forEach(price => h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', preco: price, ficha: samplePokemon()
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

test('V2 stores only non-identifying Pokémon sale traits and never creates an auto-buy rule', () => {
    const h = createPokemonValuationHarness(), sales = new Map();
    h.addPokemonHistorySample({
        tipo: 'pokemon', moeda: 'gold', bruto: 900,
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
        'isOwnListing','retentionUntil','serverNow','pokemonListingName',
        src+'\nreturn {pokemonRuleMatches,pokemonRuleCandidate};')(
        state,()=>null,(pk,c)=>c==='orb'||!pk.shiny,
        l=>l.vendedor==='self',l=>l.compravelEm||0,()=>now,()=> 'Poke'
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
        'purchaseQuantity','tryBuy',
        section('    function runMarketAutomation(', '    function runScan(force)') +
        '\nreturn runMarketAutomation;')(
        config,state,()=>false,()=>null,()=>false,()=>false,
        ()=>config.enabled && config.fixedRulesEnabled,
        ()=>[],()=>[],()=>config.pokemonBuyRules,()=>[],()=>{},
        ()=>null,()=>null,()=>candidate,()=>1,
        item=>{submitted.push(item.listingId);state.pendingBuy=item;return true;}
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
        'sanitizeFixedItemRules','sanitizeAnyItemRules','sanitizePokemonBuyRules',
        source + '\nreturn {orderAccountKey,loadOrderJournal,saveOrderJournal,reserveOrder,settleOrder,'+
        'resolveOrder,unresolvedListing,remainingBudget,orderExposure};')(
        state,config,storage,session,'orders','session',text=>text.toLowerCase(),text=>log.push(text),
        ()=>{},()=>[],()=>[],()=>[]);
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

test('Milestone A: orders remain blocked after uncertain outcome even across listing IDs', () => {
    const body = section('    function tryBuy(', '    function controllerResult(');
    assert.match(body, /unverifiedOrdersExist\(\)/);
    const runner = section('    function runMarketAutomation(', '    function runScan(force)');
    assert.match(runner, /unverifiedOrdersExist\(\)/);
});
