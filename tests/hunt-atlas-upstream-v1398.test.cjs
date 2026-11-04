'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,
    '../addons/hunt-atlas/hunt-atlas.user.js'),'utf8');
const moveTable=source.split('\n').find(line=>
    line.trimStart().startsWith('const UPSTREAM_V1398_MOVESETS='));
assert.ok(moveTable,'bundled latest upstream move table must exist');
const cooldownStart=source.indexOf('    function xpCooldownFromPower(');
const cooldownEnd=source.indexOf('    // Without directly observed attack intervals',cooldownStart);
const hydrateStart=source.indexOf('    function applyUpstreamV1398Moves(');
const hydrateEnd=source.indexOf('    function speciesCombatMeta(',hydrateStart);
assert.ok(cooldownStart>=0&&cooldownEnd>cooldownStart);
assert.ok(hydrateStart>=0&&hydrateEnd>hydrateStart);
const api=vm.runInNewContext(moveTable+'\n'+
    source.slice(cooldownStart,cooldownEnd)+'\n'+
    source.slice(hydrateStart,hydrateEnd)+
    '\n({table:UPSTREAM_V1398_MOVESETS,hydrate:applyUpstreamV1398Moves,'+
    'cooldown:xpCooldownFromPower})');

test('latest move table has the same 989 species and 11,250 moves as Controller',()=>{
    assert.equal(Object.keys(api.table).length,989);
    assert.equal(Object.values(api.table).reduce((count,line)=>
        count+line.split('|').length,0),11250);
    for(const id of [3,6,3006,9006,3970,3718])
        assert.ok(api.table[id], 'missing latest attacks for species '+id);
});

test('Mega signature is no longer fabricated at 600 power / 30 seconds',()=>{
    assert.equal(api.cooldown(600),60000);
    const meta={attacks:[{name:'Mega Inferno',type:'FIRE',
        power:600,cooldownMs:30000}]};
    api.hydrate(meta,9006);
    assert.equal(meta.upstreamV1398MovesApplied,true);
    assert.ok(meta.attacks.length>=12);
    assert.ok(meta.attacks.some(move=>move.power===600&&
        move.cooldownMs===60000));
    assert.ok(!meta.attacks.some(move=>move.cooldownMs===30000&&
        move.power===600),'no retired 30-second Mega signature');
    const count=meta.attacks.length;
    api.hydrate(meta,9006);
    assert.equal(meta.attacks.length,count,'lazy hydration is idempotent');
});

test('new Mega Glimmora and ordinary Pokémon use their true categories',()=>{
    const glimmora={attacks:[]};
    api.hydrate(glimmora,3970);
    assert.equal(glimmora.attacks.length,12);
    assert.ok(glimmora.attacks.some(move=>move.type==='POISON'&&
        move.category==='SPECIAL'&&move.power===600));
    const charizard={attacks:[]};
    api.hydrate(charizard,6);
    assert.ok(charizard.attacks.length>=12);
    assert.ok(charizard.attacks.every(move=>move.learnLevel===1));
    assert.equal(api.hydrate({attacks:[]},999999).attacks.length,0,
        'species without a sheet override retain their original catalog');
});

test('Top Catch still uses the native forecast and observed capture ranking',()=>{
    assert.match(source,/const nativePace = nativeCombatForecast\(hunt\)/);
    assert.match(source,/const plan = speciesId === null \? null :\s*capturePlanForSpecies/);
    assert.match(source,/const combat = huntXpEstimate\(hunt\)/);
    assert.match(source,/state\.nativeGeometry\.clear\(\)/);
    assert.match(source,/nativeRememberFieldGeometry\(message\)/);
    assert.doesNotMatch(source,/sinnoh\?30:65/);
});
