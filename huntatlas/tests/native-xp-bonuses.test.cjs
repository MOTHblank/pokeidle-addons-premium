'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const start=src.indexOf('    // HA MILESTONE B PURE BEGIN:');
const end=src.indexOf('    // HA MILESTONE B PURE END.',start);
assert.ok(start>=0&&end>start,'native XP test needs embedded production helpers');
const model=vm.runInNewContext(src.slice(start,end)+'\n({'+[
    'nativeXpBonusDelta','nativeXpBonusReading','nativeXpBonusScope'
].join(',')+'})');

const close=(got,expected)=>assert.ok(Math.abs(got-expected)<1e-10,
    String(got)+' != '+String(expected));

test('the game fields detected by Moth Controller yield separate trainer and Pokémon factors',()=>{
    const game=model.nativeXpBonusDelta({},{
        twitch:{pctAtual:15,assistindoEm:['one','two']},
        evento:{xpTreinadorPct:20,xpPokemonPct:30},
        guildBonusPct:10,
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

test('Twitch available is not credited unless the game reports watching',()=>{
    const game=model.nativeXpBonusDelta({},{twitch:{
        pctAtual:17.5,assistindoEm:[]}},true);
    const bonus=model.nativeXpBonusReading(game,250);
    assert.equal(bonus.trainer,1);
    assert.equal(bonus.pokemon,1);
    assert.equal(bonus.knownFactors,false);
    assert.equal(bonus.unknown[0],'twitchAvailable');
    const unknown=model.nativeXpBonusReading(
        model.nativeXpBonusDelta({},{twitch:{pctAtual:17.5}},true),250);
    assert.ok(unknown.unknown.includes('twitch'));
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
        loja:{boosts:{xp:{until:100000}},atrasados:{alvo:1000,mult:10}},
        guildBonusPct:10
    },true);
    const result=model.nativeXpBonusReading(game,500);
    close(result.trainer,1.1);
    close(result.pokemon,1.1);
    assert.ok(result.unknown.includes('shop'));
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
