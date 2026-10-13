'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const a=src.indexOf('    // HA MILESTONE A PURE BEGIN.');
const b=src.indexOf('    // HA MILESTONE A PURE END.',a);
assert.ok(a>=0&&b>a);
const api=vm.runInNewContext(src.slice(a,b)+
    '\n({normalizeFarmingEvent,makeFarmingLedger,acceptFarmingEvent,farmingSpawn})',{});

test('explicit receipt IDs suppress retransmitted consumable events',()=>{
    const ledger=api.makeFarmingLedger();
    const heal=api.normalizeFarmingEvent({k:'cura',itemId:100,eventId:'use_5'});
    const revive=api.normalizeFarmingEvent({k:'revive',itemId:101,receiptId:'use_5'});
    assert.equal(api.acceptFarmingEvent(ledger,heal),true);
    assert.equal(api.acceptFarmingEvent(ledger,heal),false);
    assert.equal(api.acceptFarmingEvent(ledger,revive),true);
    assert.equal(ledger.totals.potions,1);
    assert.equal(ledger.totals.revives,1);
    assert.equal(ledger.diagnostics.duplicates,1);
});

test('identical uses without authoritative IDs are not falsely collapsed',()=>{
    const ledger=api.makeFarmingLedger();
    for(let i=0;i<3;i++) assert.equal(api.acceptFarmingEvent(ledger,
        api.normalizeFarmingEvent({k:'cura',itemId:100})),true);
    assert.equal(ledger.totals.potions,3);
});

test('delayed death with same explicit receipt ID stays deduped after slot respawn',()=>{
    const ledger=api.makeFarmingLedger();
    const kill=api.normalizeFarmingEvent({k:'morte',quem:'selvagem',
        slot:1,xpTreinador:22,eventId:'kill_9'});
    api.farmingSpawn(ledger,'1');
    assert.equal(api.acceptFarmingEvent(ledger,kill),true);
    api.farmingSpawn(ledger,'1');
    assert.equal(api.acceptFarmingEvent(ledger,kill),false);
    assert.equal(ledger.totals.kills,1);
    assert.equal(ledger.totals.trainerXp,22);
});

test('receipt identities are bounded and do not persist full packet values',()=>{
    const ledger=api.makeFarmingLedger();
    for(let i=1;i<350;i++){
        assert.equal(api.acceptFarmingEvent(ledger,
            api.normalizeFarmingEvent({k:'compra',receiptId:i,
                token:'PRIVATE',nickname:'PRIVATE'})),true);
    }
    assert.ok(ledger.receipts.size<=256);
    assert.ok(!JSON.stringify([...ledger.receipts]).includes('PRIVATE'));
    assert.equal(api.normalizeFarmingEvent({k:'cura',itemId:1,eventId:'bad id'}).eventId,null);
});
