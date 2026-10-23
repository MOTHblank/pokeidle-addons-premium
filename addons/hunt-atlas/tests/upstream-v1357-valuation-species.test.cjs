'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const release=fs.readFileSync(path.join(__dirname,'../../hunt-atlas.user.js'),'utf8');
function part(start,end){
    const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,'missing production section: '+start);
    return src.slice(a,b);
}
const source=[
    part('    const SELL_VALUE_ANCHOR_LEVEL =','    const BUTTON_ID ='),
    part('    function goldValueAtLevel(','    function touchRecord('),
    part('    // HA UPSTREAM V1357 SPECIES BEGIN.','    function mergeCombatCreature('),
    part('    function npcBaseSellValueForSpecies(','    function bestMatchupScore(')
].join('\n');
function harness(){
    const state={
        hunts:[],speciesCombat:new Map(),typesBySpecies:new Map(),
        captureStageCaps:new Map(),evolutionStages:new Map(),
        npcSellBases:new Map()
    };
    const mergeCombatCreature=raw=>{
        state.speciesCombat.set(raw.pokeId,{
            ...raw,id:raw.pokeId,
            catalogSellValue:raw.sellValue??null,
            captureLevelCeiling:raw.tetoCaptura??null
        });
        state.typesBySpecies.set(raw.pokeId,
            [raw.type1,raw.type2].filter(Boolean));
    };
    const h=vm.runInNewContext(source+
        '\n({goldValueAtLevel,normalizedNpcBaseFromCatalog,economicValueFromCatalog,'+
        'rebuildNpcSellBases,npcBaseSellValueForSpecies,npcSellValueAtLevel,'+
        'mergeUpstreamV1357Species,UPSTREAM_V1357_MEGAS,UPSTREAM_V1357_NEW_FORMS})',{
        state,mergeCombatCreature,capitalized:null,
        speciesCombatMeta:id=>state.speciesCombat.get(Number(id))??null,
        outlandNormalizeSpeciesId:id=>id,
        farmingXpForLevel:n=>n
    });
    return {state,mergeCombatCreature,h};
}

test('both install entry points have the same implementation and v1.9.29',()=>{
    const begin='(() => {';
    assert.equal(src.slice(src.indexOf(begin)),release.slice(release.indexOf(begin)));
    assert.match(src,/@version\s+1\.9\.29/);
    assert.match(release,/@version\s+1\.9\.29/);
});

test('upstream v1.357.3 species data adds all Megas and the nine new forms',()=>{
    const {h,state,mergeCombatCreature}=harness();
    assert.equal(h.UPSTREAM_V1357_MEGAS.length,93);
    assert.equal(new Set(h.UPSTREAM_V1357_MEGAS.map(row=>row[0])).size,93);
    assert.equal(h.UPSTREAM_V1357_NEW_FORMS.length,9);
    for(const id of [6,26,306,373,445,500,531,952]){
        mergeCombatCreature({pokeId:id,name:'Base',type1:'NORMAL',
            baseHp:100,baseAtk:100,baseDef:100,baseSpAtk:100,
            baseSpDef:100,baseSpeed:100,sellValue:3000,
            huntLevel:5000,attacks:[]});
    }
    h.mergeUpstreamV1357Species();
    const expected=[
        [3373,'DRAGON','FLYING',145,120],
        [3500,'FIRE','FIGHTING',148,75],
        [3531,'NORMAL','FAIRY',60,50],
        [3952,'GRASS','FIRE',138,75],
        [9026,'ELECTRIC',null,135,110],
        [9445,'DRAGON',null,130,151],
        [3306,'STEEL',null,140,50],
    ];
    for(const [id,t1,t2,atk,speed] of expected){
        const meta=state.speciesCombat.get(id);
        assert.ok(meta,'missing '+id);
        assert.equal(meta.type1,t1);
        assert.equal(meta.type2,t2);
        assert.equal(meta.baseAtk,atk);
        assert.equal(meta.baseSpeed,speed);
    }
    for(const id of [4053,8413,9413,8483,8484,8492,8555,9555,9646]){
        const meta=state.speciesCombat.get(id);
        assert.ok(meta,'missing form '+id);
        assert.ok(meta.type1);
        assert.ok(meta.baseHp>0);
    }
    // A live game species entry takes precedence over the embedded fallback.
    state.speciesCombat.get(8483).type1='LIVE';
    h.mergeUpstreamV1357Species();
    assert.equal(state.speciesCombat.get(8483).type1,'LIVE');
});

test('NPC pricing uses upstream 64,907 base cap, fixed specials and caught levels',()=>{
    const {h,state}=harness();
    const cap=h.goldValueAtLevel(2500);
    assert.equal(cap,64907);
    assert.equal(h.normalizedNpcBaseFromCatalog({
        id:212,huntLevel:100,catalogSellValue:110000,priceNpc:110000
    }),cap);
    assert.equal(h.normalizedNpcBaseFromCatalog({
        id:2006,huntLevel:150,catalogSellValue:60000,priceNpc:60000
    }),32000);
    const id=555;
    state.speciesCombat.set(id,{
        id,name:'High',huntLevel:5000,catalogSellValue:3000,priceNpc:3000
    });
    state.captureStageCaps.set(id,20);
    state.evolutionStages.set(id,{depth:0,length:1});
    h.rebuildNpcSellBases();
    assert.equal(h.npcBaseSellValueForSpecies({id}),cap);
    assert.equal(h.npcSellValueAtLevel({id},5000),90869);
    state.captureStageCaps.set(id,100);
    assert.equal(h.npcSellValueAtLevel({id},160300),194721);
    state.captureStageCaps.delete(id);
    assert.equal(h.npcSellValueAtLevel({id},160300),0,
        'missing captured-level data must not invent a price');
});

test('evolution-chain values remain below their evolution after MKT cap',()=>{
    const {h,state}=harness();
    state.speciesCombat.set(20,{
        id:20,name:'Base',huntLevel:100,catalogSellValue:150000,
        evolvesToId:21
    });
    state.speciesCombat.set(21,{
        id:21,name:'Evolution',huntLevel:100,catalogSellValue:10000
    });
    state.evolutionStages.set(20,{depth:0,length:2});
    state.evolutionStages.set(21,{depth:1,length:2});
    state.captureStageCaps.set(20,40);
    h.rebuildNpcSellBases();
    assert.equal(state.npcSellBases.get(20),5170);
    assert.equal(h.npcBaseSellValueForSpecies({id:20,lowestHuntLevel:5000}),
        5170,'hunt-level promotion must not undo the chain reduction');
    assert.equal(h.npcSellValueAtLevel({id:20},5000),9306);
});

test('Kanto catalog values are only elevated when all hunts are above 150',()=>{
    const {h,state}=harness();
    state.speciesCombat.set(99,{
        id:99,name:'Legacy',huntLevel:100,catalogSellValue:3000
    });
    state.evolutionStages.set(99,{depth:0,length:1});
    state.hunts=[{nivel:2000,especies:[{pokeId:99}]}];
    h.rebuildNpcSellBases();
    assert.equal(state.npcSellBases.get(99),h.goldValueAtLevel(2000));
    state.hunts.push({nivel:100,especies:[{pokeId:99}]});
    h.rebuildNpcSellBases();
    assert.equal(state.npcSellBases.get(99),3000);
});
