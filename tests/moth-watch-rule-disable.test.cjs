'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'addons', 'moth-watch');
const script = fs.readFileSync(path.join(root, 'moth-watch.user.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(root, 'src', 'rules-section.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'src', 'orders-section.js'), 'utf8');
const codeBetween = (source, first, next) => {
    const start = source.indexOf(first), end = source.indexOf(next, start + first.length);
    assert.ok(start >= 0 && end > start, 'missing code block: ' + first);
    return source.slice(start, end);
};

const configCode = codeBetween(script, '    function normalizeConfig(', '    function emptyBaseline(');
const ruleLookup = codeBetween(ordersSource, '    function activeRuleById(', '    function remainingBudget(');
const ruleMatch = codeBetween(ordersSource, '    function currentRuleMatches(', '    function freshQuote(');
const buyCode = codeBetween(script, '    function tryBuy(', '    function controllerResult(');
const defaults = {
    enabled: true, fixedRulesEnabled: false, purchasesPaused: false,
    fixedItemRules: [], anyItemRules: [], pokemonBuyRules: []
};
const fixed = { id: 'fixed-abc', itemId: 12, currency: 'gold', buyMax: 100, buyEnabled: true };
const item = { kind: 'item', key: 'listing', listingId: 123, itemId: 12, currency: 'gold',
    price: 10, qty: 1, name: 'Stone', seller: 'another player' };

function runtime(storage) {
    const sent = [];
    const state = {
        orderJournal: { sessionId: 'session', accountKey: 'account', orders: [] },
        gameSocket: { readyState: 1 },
        pendingBuys: new Map(), attemptedListings: new Map(),
        lastPurchaseSendAt: 0, rateLimitedUntil: 0
    };
    const context = {
        DEFAULTS: defaults, CONFIG_KEY: 'settings', config: null,
        lastSavedConfigText: undefined, configSaveFailed: false,
        localStorage: {
            getItem() { if (storage.failRead) throw Error('unreadable'); return storage.value; },
            setItem(key, value) { if (storage.failWrite) throw Error('unwritable'); storage.value = value; }
        },
        state, Date, Map, Number, JSON,
        console: { warn() {} }, setTimeout() {},
        SNATCH_RETRY_MS: 150, MAX_PENDING_BUYS: 5,
        MAX_SNATCH_BURST_PENDING: 40, MAX_SNATCH_PENDING_PER_LISTING: 3,
        BUY_DISPATCH_GAP_MS: 120,
        freshQuote() { return true; }, snatchReleaseQuote() { return false; },
        diagnosticOutcome() {}, pokemonCurrencyAllowed() { return true; },
        serverNow() { return Date.now(); }, orderAccountKey() { return 'account'; },
        purchaseQuantity() { return 1; },
        reserveOrder(order) { state.orderJournal.orders.push(order); return true; },
        balanceFor() { return 1000; }, orderDay() { return '2026-10-27'; },
        send(packet) { sent.push(packet); return true; },
        saveOrderJournal() {}, queueRender() {}, addLog() {}, num(v) { return String(v); }
    };
    const source = rulesSource + '\n' + configCode + '\n' + ruleLookup + '\n' +
        ruleMatch + '\n' + buyCode +
        '\nconfig = loadConfig(); return {' +
        ' sync: syncConfigFromStorage, save: saveConfig,' +
        ' mutate: fn => fn(config), ruleById: activeRuleById,' +
        ' tryBuy, enabled: () => config.fixedItemRules[0]?.buyEnabled' +
        '};';
    const evaluated = new Function(...Object.keys(context), source)(...Object.values(context));
    return { ...evaluated, sent };
}

function savedSettings(patch = {}) {
    return { value: JSON.stringify({
        ...defaults, fixedRulesEnabled: true, fixedItemRules: [{ ...fixed }], ...patch
    }) };
}

test('a fixed rule with no explicit opt-in remains disabled after migration', () => {
    const legacy = { ...fixed };
    delete legacy.buyEnabled;
    const worker = runtime(savedSettings({ fixedItemRules: [legacy] }));
    assert.equal(worker.enabled(), false);
    assert.equal(worker.ruleById(fixed.id), null);
    assert.equal(worker.tryBuy(item, false, null, fixed), false);
    assert.equal(worker.sent.length, 0);
});

test('an already-running tab cannot buy after another tab disables its rule', () => {
    const storage = savedSettings(), olderTab = runtime(storage), settingsTab = runtime(storage);
    assert.equal(olderTab.tryBuy(item, false, null, olderTab.ruleById(fixed.id)), true);
    assert.equal(olderTab.sent.length, 1);
    settingsTab.mutate(config => { config.fixedItemRules[0].buyEnabled = false; });
    assert.equal(settingsTab.save(), true);
    assert.equal(olderTab.tryBuy({ ...item, listingId: 124 }, false, null, fixed), false);
    assert.equal(olderTab.enabled(), false);
    assert.equal(olderTab.sent.length, 1);
});

test('master and pause switches take effect before dispatch', () => {
    for (const key of ['fixedRulesEnabled', 'enabled', 'purchasesPaused']) {
        const storage = savedSettings(), olderTab = runtime(storage), settingsTab = runtime(storage);
        settingsTab.mutate(config => { config[key] = key === 'purchasesPaused'; });
        settingsTab.save();
        assert.equal(olderTab.tryBuy(item, false, null, fixed), false, key);
        assert.equal(olderTab.sent.length, 0, key);
    }
});

test('changes to price limit and broad-rule opt-ins take effect before dispatch', () => {
    const storage = savedSettings(), olderTab = runtime(storage), settingsTab = runtime(storage);
    settingsTab.mutate(config => { config.fixedItemRules[0].buyMax = 5; });
    settingsTab.save();
    assert.equal(olderTab.tryBuy(item, false, null, fixed), false);
    assert.equal(olderTab.sent.length, 0);

    for (const kind of ['any', 'pokemon']) {
        const rule = { id: kind + '-1', currency: 'gold', buyMax: 100,
            buyEnabled: true, ...(kind === 'pokemon' ? { kind: 'any' } : {}) };
        const name = kind === 'any' ? 'anyItemRules' : 'pokemonBuyRules';
        const shared = savedSettings({ fixedItemRules: [], [name]: [rule] });
        const active = runtime(shared), disabled = runtime(shared);
        assert.ok(active.ruleById(rule.id));
        disabled.mutate(config => { config[name][0].buyEnabled = false; });
        disabled.save();
        const candidate = kind === 'pokemon'
            ? { ...item, kind: 'pokemon', ficha: { shiny: false, potencia: 2 } }
            : item;
        assert.equal(active.tryBuy(candidate, false, null, rule), false, kind);
        assert.equal(active.sent.length, 0, kind);
    }
});

test('corrupt, unreadable or unsaved settings fail closed', () => {
    for (const failure of ['invalid', 'read', 'write']) {
        const storage = savedSettings(), worker = runtime(storage);
        if (failure === 'invalid') storage.value = '{broken';
        if (failure === 'read') storage.failRead = true;
        if (failure === 'write') {
            storage.failWrite = true;
            assert.equal(worker.save(), false);
        }
        assert.equal(worker.tryBuy(item, false, null, fixed), false, failure);
        assert.equal(worker.sent.length, 0, failure);
    }
});

test('generated buyer and Snatch sections match the maintained sources', () => {
    for (const [name, file] of [
        ['RULES', 'rules-section.js'], ['ORDERS', 'orders-section.js'],
        ['AUTO_SCANNER', 'automation-scanner-section.js'], ['SNATCH', 'snatch-section.js']
    ]) {
        const fromSource = fs.readFileSync(path.join(root, 'src', file), 'utf8').trimEnd();
        const fromBundle = codeBetween(script,
            '    // BEGIN MOTHWATCH ' + name + ' GENERATED\n',
            '\n    // END MOTHWATCH ' + name + ' GENERATED');
        assert.equal(fromBundle.slice(('    // BEGIN MOTHWATCH ' + name + ' GENERATED\n').length).trim(), fromSource.trim(), name);
    }
});

test('order journal shows authorization provenance and script defines its own logger', () => {
    assert.match(script, /function addLog\(message\)/);
    assert.match(script, /ruleType: rule\?\.type/);
    assert.match(script, /source: snatchRelease \?/);
    assert.match(script, /state\.buyLog\.unshift/);
    assert.match(script, /moth-mw-order-audit/);
    assert.match(script, /An enabled Any item rule can buy an item even when its specific item rule is OFF/);
    const block = codeBetween(script,
        '    // BEGIN MOTHWATCH UI_RENDER GENERATED\n',
        '\n    // END MOTHWATCH UI_RENDER GENERATED');
    assert.equal(block.slice('    // BEGIN MOTHWATCH UI_RENDER GENERATED\n'.length).trim(), fs.readFileSync(path.join(root, 'src', 'ui-render-section.js'), 'utf8').trim());
});
