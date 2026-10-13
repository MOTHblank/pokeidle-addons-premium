'use strict';
// Deterministic tests execute embedded helpers extracted from the real userscript.
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const portion=(start,end)=>{
    const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,start+' / '+end);return src.slice(a,b);
};
const code=portion('// HA MILESTONE A PURE BEGIN.','// HA MILESTONE A PURE END.')+
    portion('// HA MILESTONE D PURE BEGIN','// HA MILESTONE D PURE END.');
const keys=['farmingTier','farmingShinyEggChance','farmingChanceAtLeastOne',
    'outlandNativeTier','outlandNormalizeSpeciesId','outlandTierSnapshot',
    'rareForHunt','rareHorizon','rareMarketEvidence',
    'RARE_OUTLAND_DROPS','RARE_EGG_DROP','normalizeFarmingEvent',
    'makeFarmingLedger','acceptFarmingEvent','farmingSpawn'];
const h=vm.runInNewContext(code+'\n({' + keys.join(',') + '})',{});
const outland={area:'outland',nivel:150,especies:[{pokeId:2001,pontos:1}]};
const unova={area:'unova',nivel:5000};
const near={area:'kalos',nivel:7500};
function probabilityFor(tier,key,level=25000,killsH=600) {
    const result=h.rareForHunt(outland,tier,level,killsH);
    return result.drops.find(item=>item.key===key);
}
test('exact eight tier gates and fractional multipliers, lock state is not bypassed',()=>{
    assert.equal(h.RARE_OUTLAND_DROPS.length,4);
    assert.equal(h.farmingTier(2,499),null);
    assert.equal(h.farmingTier(2,500).rareMultiplier,1.25);
    assert.equal(h.farmingTier(8,25000).rareMultiplier,8);
    assert.equal(h.farmingTier(9,100000),null);
    assert.equal(h.rareForHunt(outland,8,24999,600).reason,'locked-tier');
    assert.equal(h.outlandNativeTier(8,1000),3);
    assert.equal(h.outlandNativeTier(100,25000),1);
});
test('authoritative tier decoder accepts only eight discrete values',()=>{
    assert.equal(h.outlandTierSnapshot({tierOutland:8}),8);
    assert.equal(h.outlandTierSnapshot({outland_tier:'3'}),3);
    assert.equal(h.outlandTierSnapshot({outlandTier:9}),null);
    assert.equal(h.outlandTierSnapshot({outlandTier:0}),null);
    assert.equal(h.outlandTierSnapshot({huntSlug:'outland'}),null);
    assert.equal(h.outlandNormalizeSpeciesId(10501),2001);
    assert.equal(h.outlandNormalizeSpeciesId(10547),2047);
    assert.equal(h.outlandNormalizeSpeciesId(10548),10548);
    assert.equal(h.outlandNormalizeSpeciesId(10001),10001);
});
test('Outland 1 to 8 scales each rare roll but not ordinary drops or XP',()=>{
    for(const key of ['token','key','stone','bicycle']) {
        const first=probabilityFor(1,key),last=probabilityFor(8,key);
        assert.ok(Math.abs(last.probability/first.probability-8)<1e-9);
    }
    assert.equal(probabilityFor(1,'token').probability,.0005);
    assert.equal(probabilityFor(8,'token').probability,.004);
    assert.equal(probabilityFor(8,'key').probability,.00004);
    assert.match(probabilityFor(8,'bicycle').source,/unverified/);
    assert.ok(!h.rareForHunt(outland,8,25000,600).drops.some(x=>x.key==='egg'));
});
test('non-Outland shiny egg fixed ladder handles intermediate levels',()=>{
    const start=h.rareForHunt(unova,1,25000,1000).drops[0];
    assert.equal(start.id,70017);
    assert.equal(start.probability,.0000375);
    assert.equal(h.rareForHunt(near,1,25000,1000).drops[0].probability,.0000435);
    assert.equal(h.rareForHunt({area:'alola',nivel:160300},8,25000,1000).drops[0].probability,.000081);
    assert.equal(h.rareForHunt({area:'kanto',nivel:100},1,25000,1000).drops.length,0);
    assert.equal(h.rareForHunt({area:'outland',nivel:160300},1,25000,1000).drops[0].key,'token');
});
test('rare per-hour, mean hours and ≥1 event horizons use proper probability units',()=>{
    const token=probabilityFor(1,'token',150,600);
    assert.equal(token.unitsH,.3);
    assert.ok(Math.abs(token.meanHours-10/3)<1e-8);
    const fragment=probabilityFor(1,'key',150,600);
    assert.equal(fragment.unitsH,.003);
    assert.ok(Math.abs(fragment.craftHours-10/.003)<1e-8);
    assert.ok(Math.abs(token.chance1h-(1-(1-.0005)**600))<1e-12);
    assert.ok(fragment.chance24h>fragment.chance1h);
    assert.ok(fragment.chance24h<1);
    const idle=h.rareForHunt(outland,1,150,0);
    assert.equal(idle.drops[0].meanHours,null);
    assert.equal(idle.drops[0].chance24h,0);
    assert.equal(h.rareForHunt(outland,1,150,null).reason,'unknown-kill-rate');
});
test('crafting mean hours is separate from incubation delay',()=>{
    const result=h.rareForHunt({area:'unova',nivel:5000},1,25000,1000);
    assert.equal(result.eggIncubationHours,168);
    assert.equal(result.drops[0].craft,10);
    assert.equal(result.drops[0].craftHours,10/result.drops[0].unitsH);
});
test('rare roll counts ingest server drops without conflating item classes',()=>{
    const ledger=h.makeFarmingLedger();
    h.farmingSpawn(ledger,'2');
    const receipt=h.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:'2',
        drops:[{itemId:70000,qtd:1},{nome:'Bicycle Fragment',qtd:2},
               {itemId:70017,qtd:1}]});
    assert.equal(h.acceptFarmingEvent(ledger,receipt),true);
    assert.equal(ledger.items.get(70000),1);
    assert.equal(ledger.items.get(70013),2);
    assert.equal(ledger.items.get(70017),1);
    assert.equal(h.acceptFarmingEvent(ledger,receipt),false);
    assert.equal(ledger.items.get(70013),2);
});
test('read-only market references require completed sale, sufficient sample and currency',()=>{
    const item=probabilityFor(1,'key',150);
    assert.equal(h.rareMarketEvidence(item,{source:'listing',currency:'gold',price:1000,samples:50,sampledAt:123}),null);
    assert.equal(h.rareMarketEvidence(item,{source:'completed-sale',currency:'gold',price:1000,samples:2,sampledAt:123}),null);
    assert.equal(h.rareMarketEvidence(item,{source:'completed-sale',currency:'diamond',price:1000,samples:3,sampledAt:123}),null);
    const result=h.rareMarketEvidence(item,{source:'completed-sale',currency:'orb',price:1000,samples:3,sampledAt:123});
    assert.equal(result.expectedMarketValueH,item.unitsH*1000);
    assert.equal(result.currency,'orb');
    assert.match(result.source,/not-realized/);
});
test('preview is independent of saved hunt and in-game tier changes',()=>{
    assert.match(src,/outlandPreviewTier: 1/);
    assert.match(src,/data-mha-outland-preview/);
    assert.match(src,/t:'outland\.tier',tier:requested/);
    assert.match(src,/state\.pendingOutlandTier/);
    assert.match(src,/farmingSnapshot\.outlandTier === state\.pendingOutlandTier\.tier/);
    assert.ok(!/tier:\s*state\.filters\.outlandPreviewTier/.test(src.slice(
        src.indexOf('function requestOutlandTier('),
        src.indexOf('function huntEconomyEstimate('))));
});
