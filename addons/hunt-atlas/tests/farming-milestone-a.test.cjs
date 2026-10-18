'use strict';
// Exercises the actual embedded milestone-A pure functions in the distributed userscript.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../hunt-atlas.user.js'), 'utf8');
const from = source.indexOf('    // HA MILESTONE A PURE BEGIN.');
const to = source.indexOf('    // HA MILESTONE A PURE END.', from);
assert.ok(from >= 0 && to > from, 'Missing embedded farming core');
const core = source.slice(from, to);
const api = vm.runInNewContext(core + '\n({' + [
    'farmingXpForLevel','farmingGoldForLevel','farmingLootChance','farmingTier',
    'farmingShinyEggChance','farmingChanceAtLeastOne','farmingConfidence',
    'normalizeFarmingEvent','normalizeFarmingSnapshot','farmingEventEvidence',
    'makeFarmingLedger','farmingSpawn','acceptFarmingEvent','appendFarmingKill',
    'farmingObservedRates','recordFarmingEvidence'
].join(',') + '})', {});

test('upstream XP curve has correct low and threshold anchors', () => {
    assert.equal(api.farmingXpForLevel(1), 8);
    assert.equal(api.farmingXpForLevel(150), 13508);
    assert.equal(api.farmingXpForLevel(151), Math.round(13500 * (151/150)**1.25));
});

test('kill Coins formula is capped, distinct from NPC sell value', () => {
    for (const [level, expected] of [
        [1,36], [5000,6000], [25000,15776], [160300,15776]
    ]) assert.equal(api.farmingGoldForLevel(level), expected);
});

test('encoded loot chance and probability units are fractions', () => {
    assert.equal(api.farmingLootChance(5000), 0.05);
    assert.equal(api.farmingLootChance(0.5), 0.000005);
    assert.equal(api.farmingLootChance(-1), null);
    assert.equal(api.farmingLootChance(100001), null);
    assert.equal(api.farmingChanceAtLeastOne(0.000005, 0), 0);
    assert.equal(api.farmingChanceAtLeastOne(1, 0), 0);
    assert.equal(api.farmingChanceAtLeastOne(1, 1), 1);
    assert.ok(Math.abs(api.farmingChanceAtLeastOne(0.0005, 2000) - 0.6322) < 0.001);
});

test('eight Outland tiers gate unlocks and multiply only rare chances', () => {
    const gates = [150,1000,2000,4000,8000,16000,24000,36000];
    const multipliers = [1,1.25,1.5,2,3,4,6,8];
    for (let index=0; index < gates.length; index++) {
        assert.equal(api.farmingTier(index+1, gates[index]-1), null);
        assert.equal(api.farmingTier(index+1, gates[index]).rareMultiplier, multipliers[index]);
    }
    assert.equal(api.farmingTier(9, 1000000), null);
    assert.equal(0.0005 * api.farmingTier(8,36000).rareMultiplier, 0.004);
    assert.equal(0.000005 * api.farmingTier(8,25000).rareMultiplier, 0.00004);
});

test('Shiny Egg uses a frozen ladder, not inserted hunt count', () => {
    assert.equal(api.farmingShinyEggChance(4999), 0);
    assert.equal(api.farmingShinyEggChance(5000), 0.0000375);
    assert.equal(api.farmingShinyEggChance(5150), 0.0000375);
    assert.equal(api.farmingShinyEggChance(5400), 0.000039);
    assert.equal(api.farmingShinyEggChance(160300), 0.000081);
    assert.equal(api.farmingShinyEggChance(160300,true), 0);
});

test('kill receipts keep XP streams and auto-sale separate, without raw identity', () => {
    const packet = {k:'morte', quem:'selvagem', slot:4, xpTreinador:20,
        xpPokemon:40, ouro:100, ouroVendaAuto:25, idConta:'SECRET',
        token:'SECRET', drops:[{itemId:70017,qtd:2}]};
    const normalized = api.normalizeFarmingEvent(packet);
    assert.equal(normalized.trainerXp,20);
    assert.equal(normalized.pokemonXp,40);
    assert.equal(normalized.killCoins,100);
    assert.equal(normalized.autoSaleCoins,25);
    assert.ok(!JSON.stringify(normalized).includes('SECRET'));
    assert.equal(api.normalizeFarmingEvent({k:'morte',quem:'jogador',slot:4}),null);
    const missing = api.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:2,xp:123});
    assert.equal(missing.trainerXp,null);
    assert.equal(missing.pokemonXp,null);
    assert.equal(api.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:2,ouro:-5}).killCoins,null);
});

test('same-slot duplicate death is ignored until a new spawn, including delayed packets', () => {
    const ledger = api.makeFarmingLedger();
    const kill = api.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:1,
        xpTreinador:50,xpPokemon:100,ouro:20,ouroVendaAuto:10});
    api.farmingSpawn(ledger,'1');
    assert.equal(api.acceptFarmingEvent(ledger,kill),true);
    assert.equal(api.acceptFarmingEvent(ledger,kill),false);
    assert.equal(ledger.totals.kills,1);
    assert.equal(ledger.totals.killCoins,20);
    assert.equal(ledger.totals.autoSaleCoins,10);
    api.farmingSpawn(ledger,'1'); // a new corpse occupies the same slot
    assert.equal(api.acceptFarmingEvent(ledger,kill),true);
    assert.equal(ledger.totals.kills,2);
    assert.equal(ledger.diagnostics.duplicates,1);
});

test('server accepted throw is not a click; capture requires correlated accepted throw', () => {
    const ledger = api.makeFarmingLedger();
    api.farmingSpawn(ledger,'2');
    const kill = api.normalizeFarmingEvent({k:'morte',quem:'selvagem',slot:2});
    const ball = api.normalizeFarmingEvent({k:'bola',slot:2,ballId:4,shiny:true});
    const captured = api.normalizeFarmingEvent({k:'capturado',slot:2,pokemon:{shiny:true}});
    assert.equal(api.acceptFarmingEvent(ledger,ball),false);
    assert.equal(api.acceptFarmingEvent(ledger,captured),false);
    assert.equal(api.acceptFarmingEvent(ledger,kill),true);
    assert.equal(api.acceptFarmingEvent(ledger,ball),true);
    assert.equal(api.acceptFarmingEvent(ledger,ball),false);
    assert.equal(api.acceptFarmingEvent(ledger,captured),true);
    assert.equal(api.acceptFarmingEvent(ledger,captured),false);
    assert.equal(ledger.totals.acceptedThrows,1);
    assert.equal(ledger.totals.captures,1);
    assert.equal(ledger.totals.shinySeen,1);
    assert.equal(ledger.totals.shinyCaught,1);
});

test('bosses, expenses and redacted field-presence diagnostics stay separate', () => {
    const ledger = api.makeFarmingLedger();
    for (const packet of [
        {k:'bossMorto',ouro:10000}, {k:'cura',itemId:200},
        {k:'cura',itemId:200}, {k:'revive',itemId:205},
        {k:'compra',itemId:205,quantidade:10}
    ]) {
        api.recordFarmingEvidence(ledger,packet);
        assert.equal(api.acceptFarmingEvent(ledger,api.normalizeFarmingEvent(packet)),true);
    }
    assert.equal(ledger.totals.bossDeaths,1);
    assert.equal(ledger.totals.kills,0);
    assert.equal(ledger.totals.potions,2);
    assert.equal(ledger.totals.revives,1);
    assert.equal(ledger.totals.killCoins,0);
    assert.equal(ledger.fieldPresence.get('cura').seen,2);
    assert.equal(api.farmingEventEvidence({k:'bola',slot:1,authToken:'secret'}).fields.includes('authToken'),false);
    assert.equal(api.farmingEventEvidence({k:'morte',quem:'selvagem'}).missingSlot,true);
});

test('snapshot recognizes only explicit tiers; no guessed inventory/bonus state', () => {
    assert.equal(api.normalizeFarmingSnapshot({}).outlandTier,undefined);
    assert.equal(api.normalizeFarmingSnapshot({tierOutland:9}).outlandTier,null);
    assert.equal(api.normalizeFarmingSnapshot({outlandTier:3}).outlandTier,3);
    assert.equal(api.normalizeFarmingSnapshot({items:{},gold:100}).coinsPresent,true);
});

test('sustained measurement includes idle wall time and requires sample duration', () => {
    let window = null;
    for (let i=0; i<6; i++) {
        window = api.appendFarmingKill(window,
            {at:100000 + i*10000,trainerXp:200,pokemonXp:400,gold:20});
    }
    assert.equal(api.farmingObservedRates(window,150000),null);
    const rate = api.farmingObservedRates(window,160000);
    assert.equal(rate.samples,6);
    assert.equal(rate.denominator,'wall');
    assert.equal(rate.killsH,360);
    assert.equal(rate.trainerXpH,72000);
    assert.equal(rate.pokemonXpH,144000);
    assert.equal(rate.goldH,7200);
    const lower = api.farmingObservedRates(window,200000);
    assert.ok(lower.killsH < rate.killsH);
    assert.equal(api.farmingObservedRates(window,300001),null);
});

test('reconnect/long gap resets old bursts instead of reviving old high rates', () => {
    let window = null;
    for(let i=0;i<10;i++)
        window = api.appendFarmingKill(window,{at:100000+i*10000,trainerXp:100});
    assert.ok(api.farmingObservedRates(window,190000));
    window = api.appendFarmingKill(window,{at:400000,trainerXp:100});
    assert.equal(window.rows.length,1);
    assert.equal(api.farmingObservedRates(window,460000),null);
    const disconnected = api.makeFarmingLedger();
    assert.equal(disconnected.totals.kills,0);
});
