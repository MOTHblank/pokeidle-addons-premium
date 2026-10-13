'use strict';

// Run: node --test tests/accuracy.test.cjs
// Executes the actual userscript functions, not copied test equivalents.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '../hunt-atlas.user.js'), 'utf8'
);

function portion(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + 1);
    assert.ok(from >= 0 && to > from, 'Missing source: ' + start);
    return source.slice(from, to);
}

function model(hp, damage) {
    const context = {
        targetHpEstimate: id => hp.get(id),
        damagePerAttackAgainst: id => damage.get(id),
        UPSTREAM_GLOBAL_ATTACK_MS: 900,
        UPSTREAM_WAVE_MS: 2600
    };
    return vm.runInNewContext(
        portion('    function huntCombatCoverage(',
                '    function predictionCalibration(') +
        '\n({huntCombatCoverage, rawPredictedKillMs})',
        context
    );
}

function castHelpers() {
    return vm.runInNewContext(
        portion('    // A transient, bounded cast ledger.',
                '    function recordAttackEvent(') +
        '\n({identifyAttackCast, explicitAttackCastId})',
        {}
    );
}

const hunt = {
    nivel: 100,
    especies: [{pokeId: 1, pontos: 2}, {pokeId: 3, pontos: 8}]
};
const profile = {
    moveSamples: 5,
    hpScale: 1,
    movementMs: 600,
    cadenceMs: 900
};

test('missing damage weights coverage by spawn points, not species count', () => {
    const functions = model(new Map([[1, 100], [3, 100]]),
                            new Map([[1, 25]]));
    const coverage = functions.huntCombatCoverage(hunt, profile);
    assert.equal(coverage.total, 10);
    assert.equal(coverage.covered, 2);
    assert.equal(coverage.percentage, 20);
    assert.equal(coverage.missingDamage, 8);
    assert.equal(functions.rawPredictedKillMs(hunt, profile), null);
});

test('missing HP and entirely missing combat data do not produce a partial model', () => {
    const functions = model(new Map([[1, 100]]),
                            new Map([[1, 25], [3, 25]]));
    assert.equal(functions.huntCombatCoverage(hunt, profile).missingHp, 8);
    assert.equal(functions.rawPredictedKillMs(hunt, profile), null);
    assert.equal(functions.huntCombatCoverage(hunt, null).percentage, 0);
    assert.equal(functions.rawPredictedKillMs({nivel: 1, especies: []}, profile), null);
});

test('complete model predicts and known immunity still blocks the hunt', () => {
    const damage = new Map([[1, 25], [3, 25]]);
    const functions = model(new Map([[1, 100], [3, 100]]), damage);
    assert.equal(functions.huntCombatCoverage(hunt, profile).percentage, 100);
    assert.ok(Number.isFinite(functions.rawPredictedKillMs(hunt, profile)));
    damage.set(3, 0);
    assert.equal(functions.rawPredictedKillMs(hunt, profile), Infinity);
});

test('delayed AoE and repeated slots are grouped conservatively', () => {
    const {identifyAttackCast: identify} = castHelpers();
    const record = {};
    const a = identify(record, {}, 1000, 's1', 'blast', 'FIRE');
    const b = identify(record, {}, 1310, 's2', 'blast', 'FIRE');
    assert.equal(a, b); // delayed by 310ms (old 125ms failed)
    assert.equal(a.hits, 2);
    const c = identify(record, {}, 1312, 's1', 'blast', 'FIRE');
    assert.notEqual(a, c); // repeated slot is a new cast
    const d = identify(record, {}, 1800, 's3', 'blast', 'FIRE');
    assert.notEqual(c, d);
});

test('unnamed events require a real cast ID to be merged', () => {
    const {identifyAttackCast: identify, explicitAttackCastId: id} = castHelpers();
    const record = {};
    const a = identify(record, {}, 1000, 's1', null, 'WATER');
    const b = identify(record, {}, 1100, 's2', null, 'WATER');
    assert.notEqual(a, b);
    const c = identify(record, {castId: 'one'}, 2000, 's1', null, 'WATER');
    const d = identify(record, {castId: 'one'}, 2950, 's2', null, 'WATER');
    const e = identify(record, {castId: 'two'}, 2960, 's3', null, 'WATER');
    assert.equal(c, d); // delayed even beyond the heuristic window
    assert.notEqual(d, e);
    assert.equal(id({golpeId: 17, ataqueId: 22}), null);
});

test('the actual event handler creates cast-averaged observations and counts', () => {
    const state = {
        currentHuntSlug: 'test',
        combatTargets: new Map(),
        battleDiagnostics: {
            playerEvents: 0, namedEvents: 0, unnamedEvents: 0,
            lastUnnamedKeys: [], lastSeenAt: 0,
            explicitCastEvents: 0, heuristicGroupedEvents: 0,
            unnamedGroupedEvents: 0
        }
    };
    const record = {
        attacks: 0, damage: 0, moveDamage: {}, attackObservations: [],
        lastAttackAt: 0, lastAttackSlot: null
    };
    const sandbox = {
        state,
        performanceRecord: () => record,
        touchRecord: () => {},
        combatSlot: event => String(event.slot),
        namedMoveFromAttack: event => event.golpe || null,
        moveNameKey: name => String(name).toLowerCase(),
        pushSample: (record, key, value) => (record[key] ||= []).push(value),
        currentHunt: () => ({nivel: 100}),
        recordTargetHp: () => {}
    };
    const handler = vm.runInNewContext(
        portion('    // A transient, bounded cast ledger.',
                '    function recordDeathEvent(') + '\nrecordAttackEvent',
        sandbox
    );
    const hit = (castId, slot, damage, name = 'Blast') =>
        ({por: 'jogador', castId, slot, tipo: 'FIRE',
          dano: damage, ef: 1, golpe: name});

    handler(hit('cast1', 1, 100));
    handler(hit('cast1', 2, 300));
    assert.equal(record.attacks, 1);
    assert.equal(record.attackObservations.length, 1);
    assert.equal(record.attackObservations[0].hits, 2);
    assert.equal(record.attackObservations[0].neutralDamage, 200);
    assert.equal(record.moveDamage.FIRE.count, 1);
    assert.equal(record.moveDamage.FIRE.neutralSamples[0], 200);

    handler(hit('cast2', 1, 50));
    assert.equal(record.attacks, 2);
    assert.equal(record.attackObservations.length, 2);

    handler(hit('cast3', 3, 20, null));
    handler(hit('cast3', 4, 60, null));
    assert.equal(record.attacks, 3);
    assert.equal(record.attackObservations.length, 3);
    assert.equal(record.attackObservations[2].neutralDamage, 40);
    assert.equal(record.attackObservations[2].name, null);
});
