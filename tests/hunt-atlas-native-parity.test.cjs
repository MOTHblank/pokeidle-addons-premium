'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../addons/hunt-atlas/hunt-atlas.user.js'),'utf8');
const start=source.indexOf('    // Moth Controller native_atlas_combat.rs parity port');
const end=source.indexOf('    function rawPredictedKillMs(',start);
assert.ok(start>=0 && end>start,'native parity port must be present');
const code=source.slice(start,end);

function harness() {
    const lead={
        speciesId:1,level:350,speedIV:32,
        stats:{hp:6000,atk:20000,def:12000,spAtk:22000,spDef:12000},
        tipos:['FIRE'],maxHp:6000,
        attacks:[{name:'Flame',type:'FIRE',category:'SPECIAL',
            power:250,cooldownMs:30000,learnLevel:1,runtimeMove:false}]
    };
    const meta=new Map([
        [1,{baseSpeed:130,baseHp:100,baseAtk:100,baseDef:100,
            baseSpAtk:100,baseSpDef:100,type1:'FIRE'}],
        [2,{baseSpeed:90,baseHp:100,baseAtk:100,baseDef:90,
            baseSpAtk:100,baseSpDef:100,type1:'GRASS',attacks:[]}],
        [3,{baseSpeed:90,baseHp:500,baseAtk:100,baseDef:170,
            baseSpAtk:100,baseSpDef:170,type1:'WATER',attacks:[]}],
        [4,{baseSpeed:90,baseHp:100,baseAtk:5000000,baseDef:90,
            baseSpAtk:100,baseSpDef:100,type1:'NORMAL',attacks:[]}]
    ]);
    const state={filters:{nativeAoeForecast:false},
        typesBySpecies:new Map()};
    const ctx={
        state,leadPokemon:()=>lead,
        speciesCombatMeta:id=>meta.get(Number(id))||null,
        battleLeadTypes:()=>['FIRE'],
        battleMovesForLead:()=>lead.attacks,
        battleStat:v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):null,
        xpCooldownFromPower:p=>p*100,
        huntEffectiveness:(type,defenders)=>
            type==='FIRE'&&defenders.includes('GRASS')?2.5:
            type==='FIRE'&&defenders.includes('WATER')?1/3:
            1,
        battleDamage:(level,power,attack,defense,type,attackerTypes,foeTypes)=>{
            if(!(level>0)||!(power>0)||!(attack>0)||!(defense>0)||
                !type||!foeTypes.length)return null;
            const eff=type==='FIRE'&&foeTypes.includes('GRASS')?2.5:
                type==='FIRE'&&foeTypes.includes('WATER')?1/3:1;
            return (((2*level/5+2)*power*attack/defense)/50+2)*
                (attackerTypes.includes(type)?1.5:1)*eff*.925;
        }
    };
    const api=vm.runInNewContext(code+'\n({nativeIvCooldown,nativeMoveCooldown,'+
        'nativeWildStat,nativeMeanTtk,nativeReplenishmentCap,'+
        'nativeSingleTargetKills,nativeAoeKills,nativeCombatForecast})',ctx);
    const hunt=(id=2,level=150)=>({
        slug:'hunt-'+id,nivel:level,area:'kanto',
        especies:[{pokeId:id,pontos:16}]
    });
    return {api,lead,meta,state,hunt};
}

test('controller Speed IV and base Speed cooldown formulas are identical',()=>{
    const h=harness();
    assert.equal(h.api.nativeIvCooldown(900,h.lead),580);
    assert.equal(h.api.nativeIvCooldown(500,h.lead),400);
    assert.equal(h.api.nativeMoveCooldown(60000,130,
        {...h.lead,speedIV:16}),58125);
});
test('controller samples all 32 wild HP IVs with 12x and 5x wild health',()=>{
    const h=harness();
    const hp=Array.from({length:32},(_,i)=>
        Math.max(24,Math.round(h.api.nativeWildStat(100,150,i+1)*12))*5);
    assert.equal(hp.length,32);
    assert.equal(hp[0],9180);
    assert.equal(hp[31],14760);
});
test('controller move readiness persists through consecutive kills',()=>{
    const h=harness();
    const ttk=h.api.nativeMeanTtk([
        {damage:100,cooldown:4},{damage:50,cooldown:1}],
        {damage:10,cooldown:2},.9,Array(32).fill(120),1);
    assert.ok(ttk>0 && ttk<5);
});
test('controller high-level per-slot replenishment caps apply',()=>{
    const h=harness();
    const kanto=h.hunt(2,1000);
    const sinnoh={...kanto,area:'sinnoh'};
    const d=Array(16).fill(20.6);
    assert.equal(h.api.nativeReplenishmentCap(kanto,16),16*3600/65);
    assert.equal(h.api.nativeReplenishmentCap(sinnoh,16),16*3600/30);
    assert.ok(h.api.nativeSingleTargetKills(d,1.8,kanto)<=16*3600/65);
    assert.ok(h.api.nativeAoeKills(d,.01,sinnoh)<=16*3600/30);
});
test('native forecast reduces kills/hour for tougher enemies',()=>{
    const h=harness();
    const easy=h.api.nativeCombatForecast(h.hunt(2));
    const hard=h.api.nativeCombatForecast(h.hunt(3));
    assert.ok(easy && hard);
    assert.ok(easy.killsH>hard.killsH,
        'HP/defense/resistance must change the actual native rate');
    assert.ok(easy.secondsPerKill<hard.secondsPerKill);
});
test('native survival and deaths reduce dangerous matchups',()=>{
    const h=harness();
    const safe=h.api.nativeCombatForecast(h.hunt(2));
    const deadly=h.api.nativeCombatForecast(h.hunt(4));
    assert.ok(safe && deadly);
    assert.equal(deadly.oneHit,true);
    assert.ok(deadly.deathsH>0);
    assert.ok(deadly.killsH<safe.killsH);
});
test('native explicit AoE scenario never underperforms solo',()=>{
    const h=harness();
    const hunt=h.hunt(2,1000);
    const solo=h.api.nativeCombatForecast(hunt);
    h.state.filters.nativeAoeForecast=true;
    const aoe=h.api.nativeCombatForecast(hunt);
    assert.ok(solo && aoe);
    assert.equal(aoe.aoe,true);
    assert.ok(aoe.killsH>=solo.killsH);
});
test('missing combat reference does not invent kills/hour',()=>{
    const h=harness();
    assert.equal(h.api.nativeCombatForecast(h.hunt(9999)),null);
    h.lead.stats.spDef=null;
    assert.equal(h.api.nativeCombatForecast(h.hunt(2)),null);
});
test('main premium forecast uses native simulator, not legacy optimistic timer',()=>{
    assert.match(source,/const nativePace = nativeCombatForecast\(hunt\)/);
    assert.match(source,/nativePace\?\.killsH>0/);
    assert.match(source,/source: 'moth-controller-native-model'/);
    assert.match(source,/data-mha-native-aoe/);
    assert.match(source,/dexAutoReplanMeasuredHunt\(hunt, Date\.now\(\)\)/);
});
