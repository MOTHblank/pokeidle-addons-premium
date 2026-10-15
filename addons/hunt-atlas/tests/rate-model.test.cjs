// Run with: node --test addons/hunt-atlas/tests/rate-model.test.cjs
// Extract production functions, rather than maintaining a second combat model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'hunt-atlas.user.js'), 'utf8');
const names = ['formatRate', 'formatXpRate', 'xpRatingOriginKey', 'xpGlobalAttackFloor', 'xpMoveCooldown', 'xpCooldownFromPower',
  'median', 'estimatedWildStat', 'sampledHuntHp', 'targetHpEstimate', 'battleLeadTypes', 'battleMovesForLead', 'battleStat',
  'estimatedWildDefense', 'battleDamage', 'deterministicSpeciesCombat',
  'huntCombatCoverage', 'rawPredictedKillMs', 'savedObservedRates'];
function functionBody(name) {
  const start = source.indexOf('    function ' + name + '(');
  assert.ok(start >= 0, 'production function missing: ' + name);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function makeContext({type = 'WATER'} = {}) {
  const lead = {
    speciesId: 1, level: 2200,
    stats: {atk: 12000, spAtk: 18000, def: 10000, spDef: 13000, hp: 16000},
    tipos: [type], speedIV: 32,
    attacks: [{name:'Surf', type, category:'SPECIAL', power:150, cooldownMs:33000}]
  };
  const creatures = new Map(Object.entries({
    1: {baseHp:105,baseSpeed:100,baseDef:100,baseSpDef:120,type1:type},
    2: {baseHp:160,baseAtk:80,baseDef:160,baseSpDef:150,
        type1:'PSYCHIC',type2:'FLYING'},
    3: {baseHp:90,baseAtk:85,baseDef:100,baseSpDef:70,
        type1:'FIRE',type2:'FLYING'}
  }).map(([k,v]) => [Number(k),v]));
  const ctx = {
    state: {speciesCombat:creatures, typesBySpecies:new Map(), huntPerf:new Map()},
    leadPokemon: () => lead,
    speciesCombatMeta: id => creatures.get(Number(id)) || null,
    performanceRecord: slug => ctx.state.huntPerf.get('hp:'+slug) || null,
    movesForLead: () => lead.attacks,
    huntEffectiveness: (move,types) =>
      move === 'GROUND' && types.includes('FLYING') ? 0 :
      move === 'WATER' && types.includes('FIRE') ? 2.5 : 1,
    UPSTREAM_FALLBACK_MOVE_MS:600, UPSTREAM_WAVE_MS:2600,
    leadSignature: () => 'lead@2200',
    farmingSnapshotScope: () => 'boost:1',
    farmingObservedRates: () => null
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(functionBody).join('\n'),ctx);
  return ctx;
}
const xatu = {slug:'xatu',nivel:1800,especies:[{pokeId:2,pontos:16}]};
const charizard = {slug:'charizard',nivel:1800,especies:[{pokeId:3,pontos:16}]};

test('same lead has different target-specific rates from HP, def and type', () => {
  const ctx = makeContext();
  const hard = ctx.rawPredictedKillMs(xatu);
  const easy = ctx.rawPredictedKillMs(charizard);
  assert.ok(Number.isFinite(hard) && Number.isFinite(easy));
  assert.ok(hard > easy, `xatu ${hard} should be slower than charizard ${easy}`);
});

test('an immune matchup does not become positive via damage fallback', () => {
  const ctx = makeContext({type:'GROUND'});
  assert.equal(ctx.rawPredictedKillMs(xatu), Infinity);
});

test('measured Xatu and Charizard remain independent and never recalibrate models', () => {
  const ctx = makeContext();
  const beforeX = ctx.rawPredictedKillMs(xatu);
  const beforeC = ctx.rawPredictedKillMs(charizard);
  for (const [slug,trainerXpH,measuredAt] of [
    ['xatu',10e6,10], ['charizard',25e6,20]
  ]) ctx.state.huntPerf.set(slug, {
    version:5, huntSlug:slug, signature:'lead@2200',snapshotScope:'boost:1',
    lastMeasured:{trainerXpH,killMs:36000,samples:30,windowMs:300000,measuredAt}
  });
  assert.equal(ctx.savedObservedRates(xatu).trainerXpH,10e6);
  assert.equal(ctx.savedObservedRates(charizard).trainerXpH,25e6);
  assert.equal(ctx.rawPredictedKillMs(xatu),beforeX);
  assert.equal(ctx.rawPredictedKillMs(charizard),beforeC);
});

test('missing enemy combat stats means unknown rather than shared baseline', () => {
  const ctx = makeContext();
  const unknown = {slug:'unknown',nivel:1800,especies:[{pokeId:999,pontos:16}]};
  assert.equal(ctx.rawPredictedKillMs(unknown),null);
  assert.equal(ctx.huntCombatCoverage(unknown).percentage,0);
});

test('measured records are not accidentally reused after changing lead/bonus identity', () => {
  const ctx = makeContext();
  ctx.state.huntPerf.set('x', {
    version:5,huntSlug:'xatu',signature:'different-lead',
    snapshotScope:'boost:1',lastMeasured:{
      trainerXpH:10e6,samples:30,windowMs:300000,measuredAt:50
    }
  });
  assert.equal(ctx.savedObservedRates(xatu),null);
});

test('XP list source tag is localized by caller and never appears for other metrics', () => {
  const ctx = makeContext();
  assert.equal(ctx.xpRatingOriginKey({observed:true},'xp'),'xp.ratingMeasured');
  assert.equal(ctx.xpRatingOriginKey({
    observed:true,source:'saved measurement'
  },'xp'),'xp.ratingMeasured');
  assert.equal(ctx.xpRatingOriginKey({observed:false},'xp'),'xp.ratingModel');
  assert.equal(ctx.xpRatingOriginKey({observed:false},'coins'),null);
  assert.equal(ctx.xpRatingOriginKey(null,'xp'),null);
});

test('XP display preserves meaningful differences above ten million/hour', () => {
  const ctx = makeContext();
  assert.equal(ctx.formatRate(46_123_456), '46m'); // legacy rounding
  assert.equal(ctx.formatXpRate(46_123_456), '46.12m');
  assert.equal(ctx.formatXpRate(46_345_678), '46.35m');
  assert.equal(ctx.formatXpRate(null), '—');
});

test('one-hit saturated matchups report the limitation instead of fictitious differences', () => {
  const ctx = makeContext();
  // Both sampled enemies fall in exactly one hit at this damage ceiling.
  ctx.leadPokemon().stats.atk = 1e8;
  ctx.leadPokemon().stats.spAtk = 1e8;
  const xatuSim = {}, charizardSim = {};
  const xatuRate = ctx.rawPredictedKillMs(xatu, ctx.huntCombatCoverage(xatu), xatuSim);
  const charizardRate = ctx.rawPredictedKillMs(
    charizard, ctx.huntCombatCoverage(charizard), charizardSim);
  assert.ok(Number.isFinite(xatuRate) && xatuRate > 0);
  assert.equal(xatuSim.allOneHit, true);
  assert.equal(charizardSim.allOneHit, true);
  assert.equal(xatuSim.oneHitKills, xatuSim.sampledKills);
  assert.equal(charizardSim.oneHitKills, charizardSim.sampledKills);
  assert.equal(xatuRate, charizardRate);
});

test('normal differing combat matchups are not misclassified as all one-hit', () => {
  const ctx = makeContext();
  const diagnostics = {};
  ctx.rawPredictedKillMs(xatu, ctx.huntCombatCoverage(xatu), diagnostics);
  assert.ok(diagnostics.sampledKills > 0);
  assert.equal(diagnostics.allOneHit, false);
});

test('wild neutral-IV estimate includes the 2*IV term and 5x HP', () => {
  const ctx = makeContext();
  assert.equal(ctx.estimatedWildStat(100, 150), 198);
  assert.equal(ctx.targetHpEstimate(2, 150), (160 + 32) * 1.5 * 5);
  assert.equal(ctx.estimatedWildDefense(ctx.state.speciesCombat.get(2), 150, true),
    (150 + 32) * 1.5);
});

test('observed HP only applies to the same hunt and exact spawn species/level', () => {
  const ctx = makeContext();
  ctx.state.huntPerf.set('hp:xatu', {
    hpSamples: [
      {speciesId:2,level:1800,maxHp:20000},
      {speciesId:2,level:1800,maxHp:22000},
      {speciesId:2,level:1801,maxHp:900000},
      {speciesId:3,level:1800,maxHp:900000}
    ]
  });
  assert.equal(ctx.targetHpEstimate(2, 1800, xatu), 21000);
  assert.notEqual(ctx.targetHpEstimate(2, 1800, {
    ...xatu, slug:'other-hunt'
  }), 21000);
  assert.notEqual(ctx.targetHpEstimate(3, 1800, xatu), 900000);
});

test('strong typed skill on 60s cooldown cannot one-hit every encounter', () => {
  const ctx = makeContext();
  ctx.leadPokemon().level = 150;
  ctx.leadPokemon().stats.atk = 175;
  ctx.leadPokemon().stats.spAtk = 280;
  ctx.leadPokemon().attacks = [{
    name:'Cyclonic Tide', type:'WATER', category:'SPECIAL',
    power:600, cooldownMs:60000
  }];
  const resistant = {slug:'resistant',nivel:150,
    especies:[{pokeId:2,pontos:16}]};
  const vulnerable = {slug:'vulnerable',nivel:150,
    especies:[{pokeId:3,pontos:16}]};
  const hard = {}, easy = {};
  const hardMs = ctx.rawPredictedKillMs(resistant,
    ctx.huntCombatCoverage(resistant), hard);
  const easyMs = ctx.rawPredictedKillMs(vulnerable,
    ctx.huntCombatCoverage(vulnerable), easy);
  assert.ok(Number.isFinite(hardMs) && Number.isFinite(easyMs));
  assert.ok(hardMs > easyMs,
    'type + HP/defense must make the tougher hunt slower to farm');
  assert.ok(hard.hitsPerKill > 1, 'strongest move must not be used each kill');
  assert.ok(hard.basicHitShare > 0, 'basic fallback must carry attacks during cooldown');
  assert.ok(hard.skillHitShare < 1, 'ultimate must not be cast continuously');
  assert.ok(hard.oneHitKills < hard.sampledKills);
});

test('ready skill cooldown changes the predicted fight difficulty', () => {
  const ctx = makeContext();
  ctx.leadPokemon().level = 150;
  ctx.leadPokemon().stats.atk = 175;
  ctx.leadPokemon().stats.spAtk = 280;
  ctx.leadPokemon().attacks = [{
    name:'Cyclonic Tide', type:'WATER', category:'SPECIAL',
    power:600, cooldownMs:60000
  }];
  const longCooldown = ctx.rawPredictedKillMs(charizard);
  ctx.leadPokemon().attacks[0].cooldownMs = 2000;
  const shortCooldown = ctx.rawPredictedKillMs(charizard);
  assert.ok(longCooldown > shortCooldown,
    'more frequent effective skill use must improve sustained throughput');
});
