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
  'huntCombatCoverage', 'xpTargetHpForEncounter', 'xpDamageRollFactor',
  'sampledHuntHpValues', 'xpPacedKillMs', 'rawPredictedKillMs', 'savedObservedRates'];
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
    UPSTREAM_GLOBAL_ATTACK_MS:900,
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
  // This is a same-level hunt: the shared Charizard fixture is level 1800
  // and would swamp a level-150 lead regardless of ability cooldown.
  const target = {...charizard, nivel:150};
  const longCooldown = ctx.rawPredictedKillMs(target);
  ctx.leadPokemon().attacks[0].cooldownMs = 2000;
  const shortCooldown = ctx.rawPredictedKillMs(target);
  assert.ok(longCooldown > shortCooldown,
    'more frequent effective skill use must improve sustained throughput');
});

test('missing Sp.Def or ability category is unknown, not a deceptive basic model', () => {
  const ctx = makeContext();
  ctx.state.speciesCombat.get(2).baseSpDef = null;
  assert.equal(ctx.rawPredictedKillMs(xatu), null);
  ctx.state.speciesCombat.get(2).baseSpDef = 150;
  ctx.leadPokemon().attacks[0].category = 'UNSPECIFIED';
  assert.equal(ctx.rawPredictedKillMs(xatu), null);
});

test('premium integration preserves controller metrics and private distribution', () => {
  for (const symbol of [
    'function controllerMetrics(', 'metrics: controllerMetrics',
    'function captureRarityForSpecies(', 'function savedObservedRates(',
    'state.modelRevision', 'function deterministicSpeciesCombat(',
    '@homepageURL  https://github.com/MOTHblank/pokeidle-addons-premium/tree/main/addons/hunt-atlas'
  ]) assert.ok(source.includes(symbol), 'missing integration: ' + symbol);
});

test('special-form capture rarity respects direct data and known Orre fallback', () => {
  const sandbox = {
    outlandNormalizeSpeciesId: id => id
  };
  vm.createContext(sandbox);
  vm.runInContext(functionBody('captureRarityForSpecies'), sandbox);
  const rarities = new Map([[122, 5000], [13033, 8000]]);
  assert.equal(sandbox.captureRarityForSpecies(rarities, 13122), 5000);
  assert.equal(sandbox.captureRarityForSpecies(rarities, 13033), 8000);
  assert.equal(sandbox.captureRarityForSpecies(rarities, 13177), null);
});

test('controller metrics still exports current-hunt XP, economy and capture coverage', () => {
  const hunt = {slug:'kanto', nivel:150, area:'kanto',
    especies:[{pokeId:122,pontos:10}]};
  const observed = {kills:80,throws:30,captures:3,byBall:{4:20,5:10},
    byBallCaught:{4:2,5:1},windowMs:120000,bySpecies:{}};
  const uses = [];
  const sandbox = {
    state: {combatCatalogStatus:'ready', combatCatalogError:null,
      hunts:[hunt],huntSceneKnown:true,activeSocket:{},
      captureRarities:new Map([[122,5000]]),
      captureBallRates:new Map([[4,{}]]),
      playerLevel:250,outlandTierSeen:false,farmingSnapshot:{outlandTier:1}},
    currentHunt:()=>hunt,
    huntXpEstimate:()=>({value:46e6,observed:false,killsH:120}),
    captureObservedForHunt:()=>observed,
    huntEconomyEstimate:(h,x,o)=>{
      uses.push(o===observed);return {realizedH:null,killCoinsH:100000};
    },
    capturePlanForHunt:(h,ball,x,o)=>{
      uses.push(o===observed);
      return {chance:ball===4?.1:.2,catchesH:15,
        ballsPerCapture:10,shinyCaughtH:.03};
    },
    outlandNormalizeSpeciesId:id=>id,
    rareForHunt:()=>null,
    outlandNativeTier:x=>x,
    syncFromControllerBridge:()=>{throw new Error('unnecessary bridge refresh');},
    ensureCombatCatalog:()=>{throw new Error('unnecessary catalog refresh');}
  };
  vm.createContext(sandbox);
  vm.runInContext(functionBody('captureRarityForSpecies'), sandbox);
  const start = source.indexOf('    function controllerMetrics(');
  const end = source.indexOf('    page.__mothHuntAtlasControllerV1', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), sandbox);
  const result = sandbox.controllerMetrics();
  assert.equal(result.xpH,46e6);
  assert.equal(result.coinsH,100000);
  assert.equal(result.capturesH,15);
  assert.equal(result.ultraChance,.1);
  assert.equal(result.beastChance,.2);
  assert.equal(result.captureInputs.coveredSpecies,1);
  assert.ok(uses.length===3 && uses.every(Boolean));
});

test('lead must be confirmed active; strongest owned is NOT a hunting lead', () => {
  const ctx = {
    state: {
      activePokemonId: 42,
      pokemons: new Map([[42,{id:42,speciesId:8,name:'Actual lead'}]]),
      lastLeadPokemon:null,
      strongestPokemon:{id:99,speciesId:150,name:'Stronger but inactive'}
    }
  };
  vm.createContext(ctx);
  vm.runInContext(functionBody('leadPokemon'),ctx);
  assert.equal(ctx.leadPokemon()?.id, 42);
  ctx.state.activePokemonId = null;
  assert.equal(ctx.leadPokemon()?.id, 42,
    'transient null retains the last confirmed active lead');
  ctx.state.lastLeadPokemon = null;
  assert.equal(ctx.leadPokemon(), null,
    'unknown active must NOT fall back to strongest owned Pokémon');
  ctx.state.activePokemonId = 999;
  assert.equal(ctx.leadPokemon(), null,
    'unresolved known activeId must not silently use old lead');
  assert.ok(source.includes('state.lastLeadPokemon = null;'),
    'hunt/session transitions clear previous confirmed lead');
});

test('upstream action pacing reduces unrealistic one-hit farming speed', () => {
  const ctx = makeContext();
  const diag = {};
  ctx.leadPokemon().stats.atk = 1e8;
  ctx.leadPokemon().stats.spAtk = 1e8;
  ctx.rawPredictedKillMs(xatu, ctx.huntCombatCoverage(xatu), diag);
  assert.equal(diag.allOneHit, true);
  assert.ok(diag.pacingAllowanceMs >= 2000);
  assert.ok(diag.idealKillMs > 0);
  const adjusted = ctx.xpPacedKillMs(diag.idealKillMs,16,32);
  assert.equal(Math.round(adjusted),Math.round(diag.idealKillMs + diag.pacingAllowanceMs));
  assert.equal(ctx.xpPacedKillMs(1_342.5,16,32),3_662.5,
    'upstream Hunt Analyser pace accounts for average action downtime');
  const hard = ctx.xpPacedKillMs(10_000,16,32);
  const easy = ctx.xpPacedKillMs(5_000,16,32);
  assert.ok(hard > easy,'different combat difficulty must stay differentiated');
});

test('a 46m predicted vs 13m measured miss is decomposed without clipping', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(functionBody('xpForecastAudit'), context);
  const before = {
    killMs: 1_800, trainerXpPerKill: 23_000, modelVersion:'1.9.25'
  };
  const actual = {killMs: 6_000, trainerXpH:13_000_000};
  const audit = context.xpForecastAudit(before,actual);
  assert.ok(audit);
  assert.ok(Math.abs(audit.modeledTrainerXpH - 46e6) < 1);
  assert.equal(audit.measuredTrainerXpH,13e6);
  assert.ok(audit.xpRateOverestimate > 3.5 && audit.xpRateOverestimate < 3.6);
  assert.ok(Math.abs(audit.killRateOverestimate - 6_000 / 1_800) < 1e-8);
  assert.equal(audit.modeledXpPerKill,23_000);
  assert.equal(audit.measuredXpPerKill,13e6 / 600);
  assert.equal(context.xpForecastAudit({killMs:0},actual),null);
});


test('30-second Furious Scyther trace retains the actual same-species HP distribution', () => {
  // Battle trace: 15 level-150 spawns at 7.381s. Even one species has
  // 6,480..12,060 HP (1.86x), and the session needed 23 attacks for 11 kills.
  const observedHp = [6840,10440,10260,7020,7740,9000,6480,10620,
    12060,9180,12060,8100,10080,10260,7740];
  const ctx = makeContext({type:'ROCK'});
  ctx.state.speciesCombat.set(2006, {
    baseHp:1192,baseAtk:90,baseDef:100,baseSpDef:100,
    type1:'BUG',type2:'FLYING'
  });
  ctx.leadPokemon().level = 327;
  ctx.leadPokemon().stats.atk = 1054;
  ctx.leadPokemon().stats.spAtk = 828;
  ctx.leadPokemon().speedIV = 27;
  ctx.leadPokemon().attacks = [{name:'Rock Slide',type:'ROCK',
    category:'PHYSICAL',power:80,cooldownMs:30000}];
  const hunt = {slug:'furious_scyther',nivel:150,
    especies:[{pokeId:2006,pontos:15}]};
  ctx.state.huntPerf.set('hp:furious_scyther', {
    hpSamples: observedHp.map(maxHp=>({speciesId:2006,level:150,maxHp}))
  });
  const coverage = ctx.huntCombatCoverage(hunt);
  assert.equal(coverage.percentage,100);
  assert.equal(coverage.entries[0].hp,9180,'median still available as fallback');
  assert.equal(coverage.entries[0].hpSamples.length,15);
  const visits=observedHp.map((_,i)=>
    ctx.xpTargetHpForEncounter(coverage.entries[0],i));
  assert.deepEqual(visits,observedHp);
  assert.equal(ctx.xpTargetHpForEncounter(coverage.entries[0],15),6840);
  const diag={};
  const ms=ctx.rawPredictedKillMs(hunt,coverage,diag);
  assert.ok(Number.isFinite(ms) && ms>0);
  assert.equal(diag.sampledHpFights,diag.sampledKills);
  assert.equal(ms,ctx.rawPredictedKillMs(hunt,coverage,{}),
    'forecast is deterministic, not Math.random-dependent');

  const other={...hunt,slug:'another_hunt'};
  assert.equal(ctx.huntCombatCoverage(other).entries[0].hpSamples,null,
    'local HP evidence must not transfer across hunts');
  assert.equal(ctx.sampledHuntHpValues(hunt,2006,151).length,0,
    'local HP evidence must match the exact level');
});

test('damage rolls account for near-threshold extra attacks without inventing cooldowns', () => {
  const ctx=makeContext();
  const rolls=[0,1,2,3].map(i=>ctx.xpDamageRollFactor(i,0)*0.925);
  for(let i=0;i<rolls.length;i++)
    assert.ok(Math.abs(rolls[i]-(0.85+i*0.05))<1e-10);
  const baseline=94;
  assert.ok(baseline*ctx.xpDamageRollFactor(0,0)<100,
    'low damage roll fails the nominal near-one-hit threshold');
  assert.ok(baseline*ctx.xpDamageRollFactor(3,0)>100,
    'high damage roll passes the same threshold');
  assert.equal(ctx.xpTargetHpForEncounter({hp:100,hpSamples:[50,200]},0),100,
    'fewer than six recorded spawns must not drive the forecast');
});


test('XP/hour must use only trainer XP, never the upstream combined streams', () => {
  const vmContext = {};
  vm.createContext(vmContext);
  vm.runInContext(functionBody('xpSingleStreamRate'), vmContext);
  const calc = vmContext.xpSingleStreamRate;

  // The supplied Furious Scyther trace carries BOTH XP channels at 18,574
  // per kill. Neither 18,574 + 18,574 nor the 37,148 combined reward is a
  // valid trainer XP/kill; separate channels must remain distinct.
  const kills = 1283;
  const trainerXp = 18574, pokemonXp = 18574;
  assert.equal(calc(kills, trainerXp), 23830442);
  assert.equal(calc(kills, pokemonXp), 23830442);
  assert.notEqual(calc(kills, trainerXp), calc(kills, trainerXp + pokemonXp));
  assert.equal(calc(0, trainerXp), 0);
  assert.equal(calc(Number.NaN, trainerXp), null);

  // The same symptom occurs for normal level-100 Scyther: modeled 20m/h
  // versus observed ~9.9m/h is a KPH/timing discrepancy, not 2 XP streams.
  assert.equal(calc(1200, 6008), 7209600);
  assert.equal(calc(2400, 6008), 14419200);
});

test('modeled one-hit cadence includes the upstream action pacing allowance', () => {
  const ctx=makeContext();
  // A 1.5-second modeled kill would give ~2.4k kills/h even if only the
  // trainer XP channel is used. A 16-mob wave must include action downtime.
  const paced=ctx.xpPacedKillMs(1500, 16, 27);
  assert.ok(paced > 3500, '1.5s old-model cadence cannot be trusted as KPH');
  assert.equal(ctx.xpPacedKillMs(1500,16,27),paced);
});

test('the public forecast has explicit, separate trainer and Pokemon formulas', () => {
  assert.ok(source.includes('value: xpSingleStreamRate(killsH, trainerXpPerKill)'));
  assert.ok(source.includes('pokemonValue: xpSingleStreamRate(killsH, pokemonXpPerKill)'));
  assert.ok(source.includes('trainerXpPerKill: xp?.trainerXpPerKill ?? null'));
  assert.ok(source.includes('// @version      1.9.25'));
});
