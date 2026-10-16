'use strict';
// Regression coverage for incremental improvements across the open roadmap.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
function block(start,end,api,extra={}){
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,'missing tested production block');
    return vm.runInNewContext(source.slice(a,b)+'\n({'+api.join(',')+'})',extra);
}
const farm=block('    // HA MILESTONE A PURE BEGIN.',
    '    // HA MILESTONE A PURE END.',
    ['makeFarmingLedger','normalizeFarmingEvent','farmingSpawn',
     'acceptFarmingEvent','farmingExpireCorpse']);
const xp=block('    // HA MILESTONE B PURE BEGIN:',
    '    // HA MILESTONE B PURE END.',
    ['xpForecastCastCadence','xpPredictionBand']);
const economy=block('    // HA MILESTONE C PURE BEGIN:',
    '    // HA MILESTONE C PURE END.',
    ['farmNpcPrice','farmLootPrediction','farmCostRates'],
    {outlandNormalizeSpeciesId:id=>id});
const catchModel=block('    // HA MILESTONE E PURE BEGIN',
    '    // HA MILESTONE E PURE END.',
    ['captureMeasuredChance','captureMysticChance']);

test('HA-02: event retransmissions deduplicate without merging legitimate uses',()=>{
    const ledger=farm.makeFarmingLedger();
    const heal=farm.normalizeFarmingEvent({k:'cura',itemId:5,eventId:'abc'});
    assert.equal(farm.acceptFarmingEvent(ledger,heal),true);
    assert.equal(farm.acceptFarmingEvent(ledger,heal),false);
    assert.equal(farm.acceptFarmingEvent(ledger,
        farm.normalizeFarmingEvent({k:'cura',itemId:5})),true);
    assert.equal(ledger.totals.potions,2);
});
test('HA-20: authoritative corpse expiry prevents late accepted throws',()=>{
    const ledger=farm.makeFarmingLedger();
    farm.farmingSpawn(ledger,'3');
    assert.equal(farm.acceptFarmingEvent(ledger,
        farm.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:3})),true);
    assert.equal(farm.farmingExpireCorpse(ledger,'3'),true);
    assert.equal(farm.acceptFarmingEvent(ledger,
        farm.normalizeFarmingEvent({k:'bola',slot:3,ballId:4})),false);
    farm.farmingSpawn(ledger,'3');
    assert.equal(farm.acceptFarmingEvent(ledger,
        farm.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:3})),true);
});
test('HA-11: accepted use without ball ID retains attempt but invalidates costs',()=>{
    const ledger=farm.makeFarmingLedger();
    farm.farmingSpawn(ledger,'1');
    farm.acceptFarmingEvent(ledger,farm.normalizeFarmingEvent(
        {k:'morte',quem:'selvagem',slot:1}));
    assert.equal(farm.acceptFarmingEvent(ledger,
        farm.normalizeFarmingEvent({k:'bola',slot:1})),true);
    assert.equal(ledger.totals.acceptedThrows,1);
    assert.equal(ledger.diagnostics.uncertainCosts,1);
});
test('HA-07: projected move cadence requires directly measured samples',()=>{
    assert.equal(xp.xpForecastCastCadence(
        {cadenceMs:600,cadenceMeasured:false},900,2000),2000);
    assert.equal(xp.xpForecastCastCadence(
        {cadenceMs:1200,cadenceMeasured:true},900,2000),1200);
});
test('HA-08: independent forecast errors widen but never shrink ranges',()=>{
    const baseline={value:100,observed:false,source:'combat model',
        samples:30,coverage:100};
    assert.equal(xp.xpPredictionBand(baseline).width,.3);
    assert.equal(xp.xpPredictionBand({...baseline,
        validationCount:2,validationErrorPct:90}).width,.3);
    assert.equal(xp.xpPredictionBand({...baseline,
        validationCount:3,validationErrorPct:90}).width,.9);
    assert.equal(xp.xpPredictionBand({...baseline,
        validationCount:3,validationErrorPct:5}).width,.3);
});
test('HA-10: explicitly stated native NPC sellability overrides heuristics',()=>{
    assert.equal(economy.farmNpcPrice({
        id:1,name:'Moon Stone',category:'stone',vendavelNpc:true,npcPrice:20}),20);
    assert.equal(economy.farmNpcPrice({
        id:2,category:'loot',vendavelNpc:false,npcPrice:100}),0);
});
test('HA-10/26: loot prediction uses representative mix and catalog-scoped cache',()=>{
    const hunt={especies:[{pokeId:1,pontos:9},{pokeId:2,pontos:1}]};
    const catalog=new Map([[1,{perKill:100}],[2,{perKill:0}]]);
    assert.equal(economy.farmLootPrediction(hunt,catalog,10).perHour,900);
    assert.equal(economy.farmLootPrediction(hunt,catalog,20).perHour,1800);
    assert.equal(economy.farmLootPrediction(hunt,catalog,10,{
        1:{kills:5},2:{kills:35}}).perHour,125);
    const newer=new Map([[1,{perKill:20}],[2,{perKill:0}]]);
    assert.equal(economy.farmLootPrediction(hunt,newer,10).perHour,180);
});
test('HA-11: ambiguous dual-currency replacement price is not double charged',()=>{
    const window={rows:[{at:60000,uses:{'ball:4':1}}]};
    const cost=economy.farmCostRates(window,0,3600000,{
        balls:new Map([[4,{coins:120,diamonds:2}]]),items:new Map()
    },new Map());
    assert.equal(cost.coinsH,null);
    assert.equal(cost.diamondsH,null);
    assert.equal(cost.unknown,1);
});
test('HA-11: a partial inventory delta never clears unrelated items',()=>{
    const state={inventoryForCosts:new Map([['item:1',5],['item:2',8]])};
    const slice=source.slice(source.indexOf('    function farmUpdateInventory('),
        source.indexOf('    function captureTrackReceipt(',source.indexOf('    function farmUpdateInventory(')));
    const update=vm.runInNewContext(slice+'\n farmUpdateInventory',
        {state,farmNum:x=>x==null?null:Number(x)});
    update({items:{1:4}},false);
    assert.equal(state.inventoryForCosts.get('item:2'),8);
    update({items:{2:null}},false);
    assert.equal(state.inventoryForCosts.has('item:2'),false);
    update({items:{1:3}},true);
    assert.equal(state.inventoryForCosts.size,1);
});
test('HA-19: success from accepted throws is not guessed from tiny samples',()=>{
    assert.equal(catchModel.captureMeasuredChance(29,2),null);
    assert.equal(catchModel.captureMeasuredChance(30,40),null);
    const measured=catchModel.captureMeasuredChance(40,4);
    assert.equal(measured.chance,.1);
    assert.ok(measured.low<.1&&measured.high>.1);
});
test('HA-23: Mystic probability stays isolated from ordinary wiki capture',()=>{
    assert.equal(catchModel.captureMysticChance(1),.001);
    assert.equal(catchModel.captureMysticChance(5),.005);
});

test('HA-19: the UI requires complete ball and outcome attribution',()=>{
    assert.match(source,/attributedThrows===observedCapture\.throws/);
    assert.match(source,/attributedCaptures===observedCapture\.captures/);
});
test('HA-23: the Mystic planner activates only with the arena slug',()=>{
    assert.match(source,/state\.currentHuntSlug === 'arena_mistica'/);
    assert.match(source,/CAPTURE_BALLS\.map\(ball=>/);
    assert.match(source,/item:70090/);
});
