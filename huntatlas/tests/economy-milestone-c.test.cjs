'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
function slice(start,end){const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,start);return code.slice(a,b);}
const a=slice('// HA MILESTONE A PURE BEGIN.','// HA MILESTONE A PURE END.');
const c=slice('// HA MILESTONE C PURE BEGIN:','// HA MILESTONE C PURE END.');
const names=['farmNpcPrice','farmLootValue','farmRebalanceLoot','farmGoldPrediction',
    'farmLootPrediction','farmNormalizePrices','farmAppendUse','farmCostRates',
    'farmFinancialSummary','farmingGoldForLevel','farmingLootChance'];
const h=vm.runInNewContext(a+c+'\n({' + names.join(',') + '})',{});

test('level-capped guaranteed gold uses weighted mob level, not sell value',()=>{
    const hunt={nivel:160300,especies:[{pokeId:1,pontos:1},
        {pokeId:2,pontos:3,level:5000}]};
    assert.equal(h.farmingGoldForLevel(25000),15776);
    assert.equal(h.farmingGoldForLevel(160300),15776);
    assert.equal(h.farmGoldPrediction(hunt,100),100*(15776+3*6000)/4);
    assert.equal(h.farmGoldPrediction({nivel:1,especies:[]},100),null);
    assert.equal(h.farmGoldPrediction(hunt,null),null);
});
test('NPC eligibility excludes evolution stones, purchase supplies, tokens and dead imports',()=>{
    const loot={id:1,name:'Bug Wing',category:'loot',npcPrice:150};
    assert.equal(h.farmNpcPrice(loot),150);
    assert.equal(h.farmNpcPrice({...loot,npcPrice:0}),0);
    assert.equal(h.farmNpcPrice({...loot,npcPrice:undefined}),null);
    assert.equal(h.farmNpcPrice({...loot,category:'stone'}),0);
    assert.equal(h.farmNpcPrice({...loot,name:'Rough Gemstone',category:'stone'}),null);
    assert.equal(h.farmNpcPrice({...loot,name:'Moon Stone'}),0);
    assert.equal(h.farmNpcPrice({...loot,id:70000},new Set(),new Set([70000])),0);
    assert.equal(h.farmNpcPrice(loot,new Set([1])),0);
    assert.equal(h.farmNpcPrice({...loot,category:'heal'}),0);
});
test('encoded loot chance, quantity, explicit unknown and non-NPC drop',()=>{
    const rows=[{name:'A',chance:5000,minCount:2,maxCount:4},
        {name:'stone',chance:100000,minCount:2,maxCount:2}];
    const price=name=>name==='A'?100:name==='stone'?0:null;
    const value=h.farmLootValue(rows,price);
    assert.equal(value.perKill,15);
    assert.equal(h.farmLootValue([...rows,{name:'uncertain',chance:100}],price).perKill,null);
    assert.equal(h.farmLootValue([{name:'A',chance:0}],price).perKill,0);
    assert.equal(h.farmLootValue([{name:'A',chance:100001}],price).perKill,null);
});
test('raw catalog rebalancing keeps positive loot probabilities and quantity limits',()=>{
    const prices=name=>({'Bug Wing':100,'Rare Pokémon Picture':5000,
        'Luck Medallion':1000})[name]??null;
    const raw={huntLevel:5000,type1:'BUG',
        loot:[{name:'Bug Wing',chance:5000,minCount:1,maxCount:1}]};
    const reb=h.farmRebalanceLoot(raw,prices);
    assert.equal(raw.loot[0].minCount,1); // never mutate raw asset
    assert.equal(reb[0].chance,5000);
    assert.ok(reb[0].maxCount<=20);
    assert.ok(reb.find(row=>row.name==='Rare Pokémon Picture'));
    const seed=h.farmRebalanceLoot({huntLevel:1,type1:'NORMAL',loot:[]},prices);
    assert.equal(seed[0].name,'Luck Medallion');
    assert.ok(seed[0].chance<=60000);
});
test('loot mixture requires complete species coverage, not renormalized optimistic EV',()=>{
    const hunt={especies:[{pokeId:1,pontos:9},{pokeId:2,pontos:1}]};
    const m=new Map([[1,{perKill:10}],[2,{perKill:100}]]);
    assert.equal(h.farmLootPrediction(hunt,m,100).perHour,1900);
    m.delete(2);
    const missing=h.farmLootPrediction(hunt,m,100);
    assert.equal(missing.perHour,null);
    assert.equal(missing.coverage,90);
});
test('runtime prices distinguish coins, diamonds and unknown without inventing prices',()=>{
    const balls=h.farmNormalizePrices([
        {id:1,priceGold:100},{id:8,priceDiamond:2},
        {id:9}], 'ball');
    assert.equal(balls.get(1).coins,100);
    assert.equal(balls.get(8).coins,null);
    assert.equal(balls.get(8).diamonds,2);
    assert.equal(balls.get(9).coins,null);
});
test('replacement cost uses accepted item events once and keeps currencies separate',()=>{
    const balls=h.farmNormalizePrices([{id:1,priceGold:100},
        {id:8,priceDiamond:2}], 'ball');
    const items=h.farmNormalizePrices([{id:200,npcPrice:50}], 'item');
    let win=null;
    for(const [kind,id,at] of [['bola',1,100000],['bola',8,110000],
        ['cura',200,120000]])win=h.farmAppendUse(win,{kind,itemId:id},at);
    const cost=h.farmCostRates(win,90000,180000,{balls,items},new Map());
    assert.equal(cost.coinsH,150*40);
    assert.equal(cost.diamondsH,2*40);
    assert.equal(cost.unknown,0);
    win=h.farmAppendUse(win,{kind:'revive',itemId:206},130000);
    assert.equal(h.farmCostRates(win,90000,180000,{balls,items}).coinsH,null);
});
test('realized vs net never double-counts NPC expected loot or inventory; no fake net on missing prices',()=>{
    const cost={coinsH:20,diamondsH:2};
    const result=h.farmFinancialSummary(100,400,600,100,5000,cost);
    assert.equal(result.killCoinsH,600);
    assert.equal(result.realizedH,700);
    assert.equal(result.netH,680);
    assert.equal(result.npcLootEvH,5000);
    assert.equal(result.diamondsH,2);
    assert.equal(h.farmFinancialSummary(100,400,null,null,5000,cost).netH,null);
    assert.equal(h.farmFinancialSummary(100,400,600,100,5000,
        {coinsH:null}).netH,null);
});
test('Coin sorting is a separate requested dimension, not XP in disguise',()=>{
    assert.match(code,/sort === 'coins' \|\| sort === 'netCoins'/);
    assert.match(code,/<option value="netCoins">/);
    assert.match(code,/const key = sort === 'coins' \? 'killCoinsH' : 'netH'/);
});
