'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const start=src.indexOf('    // HA MILESTONE B PURE BEGIN:');
const end=src.indexOf('    // HA MILESTONE B PURE END.',start);
assert.ok(start>=0&&end>start,'native XP test needs embedded production helpers');
const model=vm.runInNewContext(src.slice(start,end)+'\n({'+[
    'nativeXpBonusDelta','nativeXpBonusReading','nativeXpBonusScope',
    'nativeLiveCaptureBonuses','nativeRaidFarmPct'
].join(',')+'})');

const close=(got,expected)=>assert.ok(Math.abs(got-expected)<1e-10,
    String(got)+' != '+String(expected));

test('the game fields detected by Moth Controller yield separate trainer and Pokémon factors',()=>{
    const game=model.nativeXpBonusDelta({},{
        twitch:{pctAtual:15,assistindoEm:['one','two']},
        evento:{xpTreinadorPct:20,xpPokemonPct:30},
        guildBonusPct:10,guild:{boostAte:0},
        loja:{boosts:{},atrasados:null}
    },true);
    const bonus=model.nativeXpBonusReading(game,250);
    close(bonus.trainer,1.15*1.2*1.1);
    close(bonus.pokemon,1.15*1.3*1.1);
    assert.equal(bonus.sources.length,3);
    assert.equal(bonus.complete,true);
    assert.equal(bonus.unknown.length,0);
    assert.ok(!JSON.stringify(game).includes('one'));
    assert.ok(!JSON.stringify(game).includes('two'));
});

test('Twitch availability is not credited without an active XP redemption',()=>{
    const game=model.nativeXpBonusDelta({},{twitch:{
        pctAtual:17.5,assistindoEm:[],bonus:{xp:0}}},true);
    const bonus=model.nativeXpBonusReading(game,250);
    assert.equal(bonus.trainer,1);
    assert.equal(bonus.pokemon,1);
    assert.equal(bonus.knownFactors,false);
});

test('server bonusXp is authoritative, expiry-aware and carries Raid farm separately',()=>{
    const now=1750000000000;
    const game=model.nativeXpBonusDelta({},{
        bonusXp:{tr:1.65,pk:1.32,partes:[
            {id:'event',tr:1.5,pk:1.2,ate:now+5000},
            {id:'raid',tr:1.1,pk:1.1,ate:now+3000,farmPct:2}
        ]},
        twitch:{pct:15,bonus:{captura:now+5000,shiny:now+5000}},
        kick:{pct:15,bonus:{captura:now+5000}}
    },true);
    const before=model.nativeXpBonusReading(game,200,now);
    close(before.trainer,1.65);
    close(before.pokemon,1.32);
    assert.equal(before.authoritative,true);
    const live=model.nativeLiveCaptureBonuses(game,now);
    close(live.capture,1.15*1.15);
    close(live.shiny,1.15);
    close(model.nativeRaidFarmPct(game,now),2);
    const after=model.nativeXpBonusReading(game,200,now+6000);
    // The total remainder is preserved while expired timed parts fall out.
    close(after.trainer,1.65/(1.5*1.1));
    close(after.pokemon,1.32/(1.2*1.1));
    assert.equal(model.nativeRaidFarmPct(game,now+6000),0);
    assert.notEqual(model.nativeXpBonusScope(game,now),
        model.nativeXpBonusScope(game,now+6000));
});

test('Seasonal and Gym podium snapshots are sanitized and scoped',()=>{
    const game=model.nativeXpBonusDelta({},{
        tipoSazonal:'fire',
        ginasiosPodio:{FIRE:2,FLYING:3,INVALID:1}
    },true);
    assert.equal(game.seasonalType,'FIRE');
    assert.deepEqual(JSON.parse(JSON.stringify(game.gymPodium)),{FIRE:2,FLYING:3});
    const changed=model.nativeXpBonusDelta(game,{tipoSazonal:'water'},false);
    assert.notEqual(model.nativeXpBonusScope(game),model.nativeXpBonusScope(changed));
});

test('delta packets retain unrelated fields, explicit null clears a field',()=>{
    const original=model.nativeXpBonusDelta({},{
        guildBonusPct:10,evento:{xpTreinadorPct:30,xpPokemonPct:20}},true);
    const partial=model.nativeXpBonusDelta(original,{guildBonusPct:15},false);
    assert.equal(partial.evento.trainer,30);
    assert.notEqual(model.nativeXpBonusScope(original),
        model.nativeXpBonusScope(partial));
    const cleared=model.nativeXpBonusDelta(partial,{evento:null},false);
    assert.equal(cleared.evento,null);
    const full=model.nativeXpBonusDelta(cleared,{guildBonusPct:4},true);
    assert.equal(Object.hasOwn(full,'evento'),false);
});

test('shop and catch-up effects are detected but not incorrectly multiplied',()=>{
    const game=model.nativeXpBonusDelta({},{
        loja:{boosts:{xp:Date.now()+600000},atrasados:{alvo:1000,mult:10}},
        guildBonusPct:10
    },true);
    const result=model.nativeXpBonusReading(game,500);
    close(result.trainer,1.1);
    close(result.pokemon,1.1);
    assert.ok(result.unknown.includes('shopTrainer'));
    assert.ok(!result.sources.some(row=>row.kind==='shopTrainer'));
    assert.ok(result.unknown.includes('catchup'));
    assert.equal(result.complete,false);
    assert.ok(!result.unknown.includes('twitch'));
    const targetReached=model.nativeXpBonusReading(game,1100);
    assert.ok(!targetReached.unknown.includes('catchup'));
});

test('invalid bonus fields cannot produce phantom multipliers',()=>{
    const state=model.nativeXpBonusDelta({},{
        twitch:{pctAtual:'50',assistindoEm:['x']},
        evento:{xpTreinadorPct:-100,xpPokemonPct:Infinity},
        guildBonusPct:100000
    },true);
    const b=model.nativeXpBonusReading(state,1);
    close(b.trainer,1);
    close(b.pokemon,1);
    assert.equal(b.knownFactors,false);
});

test('model projections include native known XP factors but measured values do not',()=>{
    assert.match(src,/const trainerXpPerKill = baseXp \* nativeBonus\.trainer/);
    assert.match(src,/const pokemonXpPerKill = baseXp \* nativeBonus\.pokemon/);
    assert.match(src,/if \(observed && observed\.trainerXpH !== null\)/);
    assert.match(src,/bonusSource: nativeBonus\.knownFactors/);
    assert.match(src,/state\.nativeXpContext = nativeXpBonusDelta/);
    assert.match(src,/nativeXpBonusScope\(state\.nativeXpContext\)/);
    assert.match(src,/\$\{nativeBonusHtml\}/);
});

test('upstream VIP and guild bank XP boosts follow native expiry timestamps',()=>{
    const now=1750000000000;
    const state=model.nativeXpBonusDelta({},{
        loja:{vipAte:now+5000,boosts:{}},
        guild:{boostAte:now+3000}
    },true);
    const before=model.nativeXpBonusReading(state,300,now);
    close(before.trainer,1.5*1.1);
    close(before.pokemon,1.5*1.1);
    assert.ok(before.sources.some(row=>row.kind==='vip'));
    assert.ok(before.sources.some(row=>row.kind==='guildBank'));
    const after=model.nativeXpBonusReading(state,300,now+6000);
    close(after.trainer,1);
    assert.notEqual(model.nativeXpBonusScope(state,now),
        model.nativeXpBonusScope(state,now+6000));
});
test('upstream XP Boost and Pokémon XP Boost are separate, catalog-scoped multipliers',()=>{
    const now=1750000000000;
    const state=model.nativeXpBonusDelta({},{
        loja:{boosts:{xp:now+5000,pokexp:now+5000}},
        tiposBoost:[{chave:'xp',mult:1.5},{chave:'pokexp',mult:1.8}]
    },true);
    const r=model.nativeXpBonusReading(state,200,now);
    close(r.trainer,1.5);
    close(r.pokemon,1.8);
    assert.ok(r.sources.some(x=>x.kind==='shopTrainer'));
    assert.ok(r.sources.some(x=>x.kind==='shopPokemon'));
    const expired=model.nativeXpBonusReading(state,200,now+6000);
    close(expired.trainer,1);
    close(expired.pokemon,1);
});
test('boost catalog is read from game welcome, never synthesized for unknown shop boosts',()=>{
    assert.match(src,/message\.tiposBoost/);
    const now=1750000000000;
    const noCatalog=model.nativeXpBonusDelta({},{
        loja:{boosts:{xp:now+5000}}
    },true);
    const b=model.nativeXpBonusReading(noCatalog,200,now);
    close(b.trainer,1);
    assert.ok(b.unknown.includes('shopTrainer'));
});
