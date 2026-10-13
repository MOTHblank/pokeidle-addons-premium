'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
function section(a,b){const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
    assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
const blocks=section('// HA MILESTONE A PURE BEGIN.','// HA MILESTONE A PURE END.')+
    section('// HA MILESTONE D PURE BEGIN','// HA MILESTONE D PURE END.')+
    section('// HA MILESTONE E PURE BEGIN','// HA MILESTONE E PURE END.');
const names=['captureRarityFromCatalog','captureWikiChance','captureBallCatalog',
    'captureMysticChance','captureAppend','captureObservedWindow',
    'captureHuntChance','captureForecast','captureSpeciesForecast','CAPTURE_BALLS',
    'normalizeFarmingEvent','acceptFarmingEvent','makeFarmingLedger','farmingSpawn'];
const h=vm.runInNewContext(blocks+'\n({' + names.join(',') + '})',{});
const example={especies:[{pokeId:1,pontos:2},{pokeId:2,pontos:1}],area:'kanto',nivel:100};
const known=new Map([[1,100],[2,10000]]);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9, a+' != '+b);
test('species economic rarity never borrows capped Pokémon sell prices or specimen MKT/RMT',()=>{
    assert.equal(h.captureRarityFromCatalog({catalogSellValue:100,huntLevel:50}),100);
    assert.equal(h.captureRarityFromCatalog({priceNpc:10000,huntLevel:50}),10000);
    assert.equal(h.captureRarityFromCatalog({huntLevel:5000,catalogSellValue:90000}),
        Math.round(12000*(5000/150)**.6));
    assert.equal(h.captureRarityFromCatalog({huntLevel:0,priceNpc:0}),null);
    assert.equal(h.captureRarityFromCatalog(null),null);
});
test('on a defeated body wiki Ultra is x4 and Beast is x8 before caps',()=>{
    near(h.captureWikiChance(100,1),.009916666666666666);
    near(h.captureWikiChance(100,4),.03966666666666666);
    near(h.captureWikiChance(100,8),.07933333333333333);
    near(h.captureWikiChance(10000,4),.016227272727272728);
    assert.equal(h.captureWikiChance(100,100),.1);
    assert.equal(h.captureWikiChance(10000000000,1),.003);
    assert.equal(h.captureWikiChance(null,4),null);
    assert.equal(h.captureWikiChance(100,4,-1),null);
    assert.ok(h.captureWikiChance(100,8)/h.captureWikiChance(100,4)<2.01);
});
test('ball catalog uses runtime evidence before wiki conditional defaults, Beast never has Coins',()=>{
    const map=h.captureBallCatalog([{id:4,catchRate:4,priceGold:130},
        {id:5,catchRate:8,priceDiamond:3},
        {id:3,catchRate:0}]);
    assert.equal(map.get(4).efficiency,4);
    assert.equal(map.get(4).coins,130);
    assert.equal(map.get(5).coins,null);
    assert.equal(map.get(3).efficiency,null);
    assert.equal(h.CAPTURE_BALLS.find(x=>x.id===5).defaultCoins,null);
});
test('unknown species value invalidates comparison rather than shifting weights',()=>{
    const p=h.captureHuntChance(example,known,4);
    near(p.chance,(2*h.captureWikiChance(100,4)+h.captureWikiChance(10000,4))/3);
    assert.equal(p.coverage,100);
    known.delete(2);
    assert.equal(h.captureHuntChance(example,known,4).chance,null);
    assert.equal(h.captureHuntChance(example,known,4).coverage,67);
});
test('accepted-throw throughput is kill limited, and unmeasured cross-hunt is a ceiling',()=>{
    const full=new Map([[1,100],[2,10000]]);
    const forecast=h.captureForecast(example,full,600,4,{coinPrice:130});
    assert.equal(forecast.acceptedH,600);
    assert.match(forecast.acceptedSource,/upper-bound/);
    near(forecast.catchesH,600*forecast.chance);
    near(forecast.coinsPerCapture,130/forecast.chance);
    const measured=h.captureForecast(example,full,600,4,
        {acceptedFraction:.25,coinPrice:130});
    assert.equal(measured.acceptedH,150);
    near(measured.catchesH,forecast.catchesH/4);
    assert.equal(h.captureForecast(example,full,null,4).acceptedH,null);
});
test('Shiny is rolled on accepted attempts, never presumed per kill',()=>{
    const base=h.captureForecast(example,new Map([[1,100],[2,100]]),600,4,
        {acceptedFraction:.5});
    near(base.shinySeenH,300/24000);
    near(base.shinyCaughtH,base.catchesH/24000);
    assert.ok(base.shinyCaughtH<base.shinySeenH);
    near(base.shinyCaught24hChance,
        1-(1-(base.chance/24000))**(24*300));
    const lure=h.captureForecast(example,new Map([[1,100],[2,100]]),
        600,4,{acceptedFraction:.5,hypotheticalLure:true});
    near(lure.shinyCaughtH,base.shinyCaughtH*2);
    const outland=h.captureForecast({...example,area:'outland'},
        new Map([[1,100],[2,100]]),600,4);
    assert.equal(outland.shinyEligible,null);
    assert.equal(outland.shinySeenH,null);
    assert.equal(outland.shinyCaughtH,null);
});
test('accepted server events, not 100ms script ticks, determine throw sample rate',()=>{
    let ledger=h.makeFarmingLedger(),window=null;
    for(let i=0;i<6;i++){
        const slot=String(i),at=100000+i*25000;
        h.farmingSpawn(ledger,slot);
        const kill=h.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot,
            pokeId:1,ouro:36});
        assert.equal(h.acceptFarmingEvent(ledger,kill),true);
        window=h.captureAppend(window,kill,at,1);
        if(i%2===0){
            const ball=h.normalizeFarmingEvent({k:'bola',slot,ballId:4,
                sucesso:i===0,shiny:i===0,chance:3.96});
            assert.equal(h.acceptFarmingEvent(ledger,ball),true);
            window=h.captureAppend(window,ball,at+500,1);
            if(i===0){
                const caught=h.normalizeFarmingEvent({k:'capturado',slot,
                    pokemon:{shiny:true}});
                assert.equal(h.acceptFarmingEvent(ledger,caught),true);
                window=h.captureAppend(window,caught,at+700,1);
                assert.equal(h.acceptFarmingEvent(ledger,caught),false);
            }
        }
    }
    const obs=h.captureObservedWindow(window,90000,230000);
    assert.equal(obs.kills,6);
    assert.equal(obs.throws,3);
    assert.equal(obs.captures,1);
    assert.equal(obs.shinySeen,1);
    assert.equal(obs.shinyCaught,1);
    near(obs.targetableFraction,.5);
    assert.equal(obs.byBall[4],3);
    assert.equal(h.captureObservedWindow(window,90000,500000),null);
});
test('Mystic Arena probabilities are distinct and ticket-gated by contract',()=>{
    near(h.captureMysticChance(1),.001);
    near(h.captureMysticChance(4),.004);
    near(h.captureMysticChance(5),.005);
    near(h.captureMysticChance(5,2),.01);
    assert.equal(h.captureMysticChance(10),null);
    assert.match(source,/if \(!hunting\)/);
    assert.match(source,/Boss and supplies are session events/);
});
test('UI retains Ultra default, independent Beast and hypothetical shiny lure toggles',()=>{
    assert.match(source,/captureBall: 'ultra'/);
    assert.match(source,/shinyLurePreview: false/);
    assert.match(source,/data-mha-capture-ball/);
});

test('target species shiny catches/h accounts for encounter prevalence not just whole-hunt catch',()=>{
    const hunt={area:'kanto',nivel:100,especies:[
        {pokeId:1,pontos:9},{pokeId:2,pontos:1}]};
    const first=h.captureSpeciesForecast(hunt,1,100,4,1000,
        {acceptedFraction:.5});
    const second=h.captureSpeciesForecast(hunt,2,100,4,1000,
        {acceptedFraction:.5});
    near(first.targetFraction,.9);
    near(second.targetFraction,.1);
    near(first.catchesH/second.catchesH,9);
    near(first.shinyCaughtH,first.catchesH/24000);
    assert.ok(first.shiny24h>second.shiny24h);
    assert.equal(h.captureSpeciesForecast(hunt,3,100,4,1000),null);
});
test('representative measured species mix can replace theoretical spawn weights',()=>{
    const hunt={area:'kanto',nivel:100,especies:[
        {pokeId:1,pontos:9},{pokeId:2,pontos:1}]};
    const mix={1:{kills:10},2:{kills:90}};
    const one=h.captureSpeciesForecast(hunt,1,100,4,1000,{mix});
    near(one.targetFraction,.1);
    assert.match(one.source,/measured-species-mix/);
    assert.match(source,/mixKills===observed.kills/); // no partial sample normalization
    assert.match(source,/captureSortCache/);
});

test('absent shiny fields stay unknown, not falsely counted as non-shiny rolls',()=>{
    const ledger=h.makeFarmingLedger();
    h.farmingSpawn(ledger,'3');
    const kill=h.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:'3',pokeId:1});
    assert.ok(h.acceptFarmingEvent(ledger,kill));
    const ball=h.normalizeFarmingEvent({k:'bola',slot:'3',ballId:4});
    assert.equal(ball.shinySeen,null);
    assert.ok(h.acceptFarmingEvent(ledger,ball));
    const caught=h.normalizeFarmingEvent({k:'capturado',slot:'3',pokemon:{}});
    assert.equal(caught.shinyCaught,null);
    assert.ok(h.acceptFarmingEvent(ledger,caught));
    let window=null;
    for(let i=0;i<6;i++)
        window=h.captureAppend(window,{kind:'morte'},100000+i*25000,1);
    window=h.captureAppend(window,ball,230000,1);
    window=h.captureAppend(window,caught,230500,1);
    const obs=h.captureObservedWindow(window,90000,231000);
    assert.equal(obs.throws,1);
    assert.equal(obs.captures,1);
    assert.equal(obs.shinySeen,null);
    assert.equal(obs.shinyCaught,null);
});

test('confirmed capture can be linked to the accepted Ultra/Beast ball separately',()=>{
    const ledger=h.makeFarmingLedger();
    h.farmingSpawn(ledger,'unique');
    assert.ok(h.acceptFarmingEvent(ledger,h.normalizeFarmingEvent({
        k:'morte',quem:'selvagem',slot:'unique',pokeId:1
    })));
    assert.ok(h.acceptFarmingEvent(ledger,h.normalizeFarmingEvent({
        k:'bola',slot:'unique',ballId:5,shiny:false
    })));
    assert.equal(ledger.slots.get('unique').ballId,5);
    let window=null;
    for(let i=0;i<6;i++)
        window=h.captureAppend(window,{kind:'morte'},100000+i*25000,1);
    window=h.captureAppend(window,{
        kind:'bola',itemId:5,shinySeen:false},230000,1);
    window=h.captureAppend(window,{
        kind:'capturado',confirmedBallId:5,shinyCaught:false},230100,1);
    const stats=h.captureObservedWindow(window,90000,231000);
    assert.equal(stats.byBall[5],1);
    assert.equal(stats.byBallCaught[5],1);
    assert.equal(stats.byBall[4]??0,0);
    assert.equal(stats.shinySeen,0);
    assert.equal(stats.shinyCaught,0);
});
