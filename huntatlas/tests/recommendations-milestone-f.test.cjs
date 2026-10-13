'use strict';
// Milestone F regression math is extracted from shipped userscript, not duplicated.
const test=require('node:test'),assert=require('node:assert/strict'),
    fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
function section(a,b){
    const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
    assert.ok(i>=0&&j>i,a);return src.slice(i,j);
}
const helpers=section('// HA MILESTONE A PURE BEGIN.','// HA MILESTONE A PURE END.')+
    section('// HA MILESTONE D PURE BEGIN','// HA MILESTONE D PURE END.')+
    section('// HA MILESTONE F PURE BEGIN','// HA MILESTONE F PURE END.');
const names=['haMetricNumber','haMetricValue','haRankMetricRows','haMetricRare',
    'HA_RANK_METRICS','HA_RARE_SORT_IDS','rareForHunt'];
const h=vm.runInNewContext(helpers+'\n({' + names.join(',') + '})',{});
const row=(slug,score,level=100)=>({hunt:{slug,nivel:level},score});
test('explicit multiple real ranking dimensions, no implicit trainer XP substitution',()=>{
    assert.deepEqual(Array.from(h.HA_RANK_METRICS),[
        'xp','pokemonXp','coins','npcLoot','netCoins','rare',
        'capture','shinyCatch','ballEfficiency']);
    const data={xp:{value:100,pokemonValue:75},
        economy:{killCoinsH:4,npcLootEvH:20,netH:-2},
        rare:{unitsH:.04},
        capture:{catchesH:3,shinyCaughtH:.001,coinsPerCapture:200}};
    const expected={xp:100,pokemonXp:75,coins:4,npcLoot:20,
        netCoins:-2,rare:.04,capture:3,shinyCatch:.001,ballEfficiency:200};
    for(const [key,value] of Object.entries(expected))
        assert.equal(h.haMetricValue(key,data),value,key);
    assert.equal(h.haMetricValue('rare',{xp:{value:9999}}),null);
    assert.equal(h.haMetricValue('npcLoot',{xp:{value:9999}}),null);
    assert.equal(h.haMetricValue('pokemonXp',{xp:{value:9999}}),null);
    assert.equal(h.haMetricValue('shinyCatch',{capture:{catchesH:999}}),null);
    assert.equal(h.haMetricValue('netCoins',{economy:{netH:0}}),0);
    assert.equal(h.haMetricValue('netCoins',{economy:{netH:-12}}),-12);
    assert.equal(h.haMetricValue('xp',{xp:{value:NaN}}),null);
});
test('ranking respects selected direction and null last without allowing missing XP to win',()=>{
    const candidates=[row('high-xp-no-rare',null),row('rare-strong',.05),
        row('rare-weak',.0002),row('unknown',null)];
    const desc=Array.from(h.haRankMetricRows(candidates,'desc','rare'),x=>x.hunt.slug);
    const asc=Array.from(h.haRankMetricRows(candidates,'asc','rare'),x=>x.hunt.slug);
    assert.deepEqual(desc,['rare-strong','rare-weak',
        'high-xp-no-rare','unknown']);
    assert.deepEqual(asc,['rare-weak','rare-strong',
        'high-xp-no-rare','unknown']);
});
test('Coins/capture efficiency defaults cheapest known positive ratio, reverse on ascending',()=>{
    const candidates=[row('expensive',3000),row('cheap',1500),row('missing',null)];
    assert.equal(h.haRankMetricRows(candidates,'desc','ballEfficiency')[0].hunt.slug,'cheap');
    assert.equal(h.haRankMetricRows(candidates,'asc','ballEfficiency')[0].hunt.slug,'expensive');
    assert.equal(h.haRankMetricRows(candidates,'desc','ballEfficiency').at(-1).hunt.slug,'missing');
});
test('stable ties use level and slug, do not mutate input order or state',()=>{
    const rows=[row('z',10,200),row('a',10,200),row('x',10,300)];
    const sorted=h.haRankMetricRows(rows,'desc','coins');
    assert.deepEqual(Array.from(sorted,x=>x.hunt.slug),['x','a','z']);
    assert.equal(rows[0].hunt.slug,'z');
});
test('Outland rare preview must select actual desired item, validate tier gate and exclude eggs',()=>{
    const outland={area:'outland',nivel:150};
    const first=h.haMetricRare(outland,1,25000,1000,70000);
    const last=h.haMetricRare(outland,8,25000,1000,70000);
    assert.equal(first.unitsH,.5);
    assert.equal(last.unitsH,4);
    assert.equal(h.haMetricRare(outland,8,1000,1000,70000),null);
    assert.equal(h.haMetricRare(outland,1,25000,1000,70017),null);
    assert.equal(h.haMetricRare({area:'unova',nivel:5000},1,25000,1000,70000),null);
    assert.ok(h.haMetricRare({area:'unova',nivel:5000},1,25000,1000,70017));
    assert.deepEqual(Array.from(h.HA_RARE_SORT_IDS),[70000,70011,70012,70013,70017]);
});
test('UI selection, top five and species list use the real chosen metric',()=>{
    assert.match(src,/const objective=HA_RANK_METRICS.includes\(state.filters.sort\)/);
    assert.match(src,/const score=haMetricValue\(metric,\{xp,economy,rare,capture\}\)/);
    assert.match(src,/haRankMetricRows\(rows,state.filters.sortDirection,metric\)/);
    assert.match(src,/data-mha-rare-item/);
    assert.match(src,/data-mha-sort-outland-tier/);
    assert.match(src,/data-mha-sort-capture-ball/);
    assert.match(src,/const objectiveLabel=tr\('sort\.'\+objective\)/);
    assert.match(src,/value:formatRate\(row.score\)/);
    assert.match(src,/sort==='ballEfficiency'/);
    assert.match(src,/capturePlanForSpecies\(species,/);
    assert.match(src,/data-mha-hunt-detail/);
});
test('background budget: bounded event data and no 3s full Atlas scans in closed mode',()=>{
    assert.match(src,/state\.drawerRenderTimer=setTimeout/);
    assert.match(src,/if\(!state\.drawerOpen \|\| !state\.atlasEnabled \|\| arcade\.open/);
    assert.match(src,/Math\.max\(0,1500-\(Date\.now\(\)-state\.lastDrawerRenderAt\)\)/);
    assert.match(src,/Date\.now\(\)-state\.lastDrawerRenderAt>=12000/);
    assert.match(src,/if\(!wasOpen\) renderDrawer\(\)/);
    assert.match(src,/if\(rows\.length>33\)rows\.splice\(0,rows\.length-33\)/);
    assert.match(src,/if\(state\.openHuntDetails\.size>40\)/);
    assert.match(src,/data-mha-local-diagnostics/);
    assert.match(src,/state\.diagnosticsEnabled\?'checked'/);
    assert.match(src,/source:currentXp\?\.source/);
    assert.doesNotMatch(src,/fetch\(\s*['"]\/market\/rare/);
});
