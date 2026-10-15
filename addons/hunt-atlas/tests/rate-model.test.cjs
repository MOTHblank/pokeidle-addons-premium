// Run with: node --test addons/hunt-atlas/tests/rate-model.test.cjs
// Extract production functions, rather than maintaining a second combat model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'hunt-atlas.user.js'), 'utf8');
const names = ['xpGlobalAttackFloor', 'xpMoveCooldown', 'xpCooldownFromPower',
  'targetHpEstimate', 'battleLeadTypes', 'battleMovesForLead', 'battleStat',
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
