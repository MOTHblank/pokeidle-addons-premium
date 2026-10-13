'use strict';
// Run with node --test tests/*.test.cjs. Tests ACTUAL userscript helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../hunt-atlas.user.js'), 'utf8');
function extract(begin, end) {
    const i = source.indexOf(begin);
    const j = source.indexOf(end, i + begin.length);
    assert.ok(i >= 0 && j > i, 'missing source slice ' + begin);
    return source.slice(i, j);
}
const a = extract('// HA MILESTONE A PURE BEGIN.', '// HA MILESTONE A PURE END.');
const b = extract('// HA MILESTONE B PURE BEGIN:', '// HA MILESTONE B PURE END.');
const names = [
    'xpBonusSnapshot', 'xpBonusScope', 'xpBonusTimeScope', 'xpRewardReceipt',
    'xpGlobalAttackFloor', 'xpCooldownFromPower', 'xpMoveCooldown',
    'xpPredictionBand', 'xpCompareForecasts', 'xpForecastResidual',
    'observeXpTransition', 'appendFarmingKill', 'farmingObservedRates'
];
const helpers = vm.runInNewContext(a + b + '\n({' + names.join(',') + '})', {});

test('XP streams are independent and missing event XP stays unknown', () => {
    const empty = helpers.xpRewardReceipt({trainerXp:null, pokemonXp:null});
    assert.equal(empty.trainerXp, null);
    assert.equal(empty.pokemonXp, null);
    const onlyTrainer = helpers.xpRewardReceipt({trainerXp:42, pokemonXp:null});
    assert.equal(onlyTrainer.trainerXp, 42);
    assert.equal(onlyTrainer.pokemonXp, null);
    let window = null;
    for(let n=0;n<7;n++) window = helpers.appendFarmingKill(window, {
        at:100000 + n*10000, trainerXp:100,
        pokemonXp:n===3 ? null : 25, gold:5
    });
    const observed = helpers.farmingObservedRates(window, 170000);
    assert.equal(observed.samples,7);
    assert.ok(observed.trainerXpH > 0);
    assert.equal(observed.pokemonXpH,null);
    assert.equal(observed.trainerKnown,7);
    assert.equal(observed.pokemonKnown,6);
});

test('bonuses are safely scoped, without interpreting stacks as valid multipliers', () => {
    assert.equal(helpers.xpBonusSnapshot({guildId:123,authToken:'never'}),null);
    const one = helpers.xpBonusSnapshot({
        xpBoost: true, bonuses:{vip:{active:true,expiresAt:789}},
        streamBonusPct: 15, catchupBoost: {unverifiedPayload:'SECRET'}
    });
    assert.equal(one.vip.active,true);
    assert.equal(one.catchupBoost,'unverified');
    assert.ok(!helpers.xpBonusScope(one).includes('SECRET'));
    const same = {catchupBoost:'unverified',streamBonusPct:15,
        vip:{active:true,expiresAt:789},xpBoost:true};
    assert.equal(helpers.xpBonusScope(one),helpers.xpBonusScope(same));
    assert.notEqual(helpers.xpBonusScope(one),
        helpers.xpBonusScope({...same,xpBoost:false}));
});

test('catch-up-like transition is detected but never labeled a verified catch-up bonus', () => {
    const record = {lastTrainerBonusRatio:null,lastPokemonBonusRatio:null};
    helpers.observeXpTransition(record,'trainer',100,100,1000);
    helpers.observeXpTransition(record,'trainer',1000,100,1100);
    helpers.observeXpTransition(record,'pokemon',200,100,1200);
    assert.equal(record.xpBonusTransitions.length,1);
    assert.equal(record.xpBonusTransitions[0].channel,'trainer');
    assert.match(record.xpBonusTransitions[0].reason,/unverified/);
    assert.equal(record.lastPokemonBonusRatio,2);
});

test('speed IV affects global attack and skill cooldown by distinct formulas', () => {
    assert.equal(helpers.xpGlobalAttackFloor(undefined),900);
    assert.equal(helpers.xpGlobalAttackFloor(32),580);
    assert.equal(helpers.xpGlobalAttackFloor(16),740);
    assert.equal(helpers.xpMoveCooldown(60000,130,16),58125);
    assert.equal(helpers.xpMoveCooldown(60000,160,32),55800);
    assert.equal(helpers.xpMoveCooldown(60000,30,32),59100);
    assert.equal(helpers.xpMoveCooldown(30000,160,32,true),30000);
    assert.equal(helpers.xpMoveCooldown(60000,160,null),null);
});

test('shared power cooldown curve does not overwrite known fixed-CD exception', () => {
    assert.equal(helpers.xpCooldownFromPower(15),10000);
    assert.equal(helpers.xpCooldownFromPower(100),30000);
    assert.equal(helpers.xpCooldownFromPower(600),60000);
    assert.equal(helpers.xpCooldownFromPower(2800),192000);
    // 600-power Mega explicitly 30s, TM Elemental 2800-power 60s.
    assert.notEqual(helpers.xpCooldownFromPower(600),30000);
    assert.notEqual(helpers.xpCooldownFromPower(2800),60000);
});

test('uncertainty bands are heuristics and ranking prefers solid evidence within noise', () => {
    const measured = {value:950,observed:true,samples:30,windowMs:300000};
    const weak = {value:1000,observed:false,source:'baseline model',samples:0,
        coverage:0};
    const ma = helpers.xpPredictionBand(measured);
    assert.equal(ma.kind,'heuristic');
    assert.ok(ma.width < helpers.xpPredictionBand(weak).width);
    assert.ok(helpers.xpCompareForecasts(measured,weak)<0);
    assert.ok(helpers.xpCompareForecasts({value:500},{value:2000})>0);
    assert.equal(helpers.xpPredictionBand({value:0}),null);
});

test('forecast residual is bounded with signed error, invalid values rejected', () => {
    assert.equal(helpers.xpForecastResidual(0,100),null);
    const exact = helpers.xpForecastResidual(1000,1000);
    assert.equal(exact.ratio,1);
    assert.equal(exact.errorPct,0);
    assert.equal(helpers.xpForecastResidual(2000,1000).ratio, .5);
    assert.equal(helpers.xpForecastResidual(500,1000).ratio,2);
});

// Integration: source contract prevents importing past measured XP multipliers
// into a cold-start prediction (regression for HA-05).
test('model path no longer multiplies generic per-lead observed XP bonuses', () => {
    const start=source.indexOf('    function huntXpEstimate(');
    const end=source.indexOf('    function rankedUnlockedHunts(',start);
    const section=source.slice(start,end);
    assert.match(section,/const trainerXpPerKill = baseXp;/);
    assert.match(section,/const pokemonXpPerKill = baseXp;/);
    assert.doesNotMatch(section,/baseXp\s*\*\s*\(\s*Number\(profile\?\.trainerXpMult/);
    assert.match(section,/recordForecastResidual/);
    assert.match(section,/bonusSource: 'unboosted-upstream-shared'/);
});

test('verified millisecond expiration transitions profile scope without a new packet', () => {
    const snapshot={vip:{expiresAt:1790000000000,active:true}};
    const before=helpers.xpBonusTimeScope(snapshot,1789999999000);
    const after=helpers.xpBonusTimeScope(snapshot,1790000001000);
    assert.notEqual(before,after);
    assert.equal(helpers.xpBonusTimeScope({vip:{expiresAt:1234}},10000),
        helpers.xpBonusTimeScope({vip:{expiresAt:1234}},20000));
    // Unknown timestamp units do not get interpreted as a trusted expiry.
});
