'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../hunt-atlas.user.js'), 'utf8');
const start = source.indexOf('    // TOP CATCH AUTO BEGIN.');
const end = source.indexOf('    // TOP CATCH AUTO END.', start);
assert.ok(start >= 0 && end > start, 'Top Catch code block exists');
const code = source.slice(start, end);

function harness(storage = new Map(), clock = {now: Date.parse('2026-10-26T12:00:00Z')}) {
    const dom = {keys:null, textContent:''};
    const sent=[];
    const control={autoTravel:true, fastTimers:new Map(), nextTimer:1};
    const state = {
        pokedexAuto: {active:false, mode:'idle', caught:new Set(), receipts:new Set(),
            targetSlug:null, lastTravelAt:0, week:null, accountKey:'profile', serverSynced:false},
        hunts: [
            {slug:'bulbasaur', nivel:1, especies:[{pokeId:1}]},
            {slug:'squirtle', nivel:5, especies:[{pokeId:7}]},
            {slug:'safari', nivel:6, especies:[{pokeId:25}]},
            {slug:'multi', nivel:8, especies:[{pokeId:2},{pokeId:3}]}
        ],
        currentHuntSlug:'bulbasaur', farmingLedger:{slots:new Map()}, pendingTravel:null,
        huntScene:{noCentro:false,casaDentro:null,bossArena:null,mistico:false},
        huntSwitchGate:{combatUntil:0,entryUntil:0,serverOffset:0,
            wave:0,combatWave:0,lastAttackAt:0},
        activeSocket:{send:packet=>sent.push(JSON.parse(packet))}
    };
    class ClockDate extends Date {static now(){return clock.now;}}
    const localStorage = {
        getItem:key=>storage.has(key)?storage.get(key):null,
        setItem:(key,value)=>storage.set(key,String(value))
    };
    const context = {
        state, localStorage, Date:ClockDate,
        DEX_AUTO_STORE_KEY:'moth-pokeidle-hunt-atlas-top-catch-v1',
        q:selector=>selector==='#tc-grade' && dom.keys!==null ? dom : null,
        setInterval:(callback,ms)=>{const id=control.nextTimer++;
            control.fastTimers.set(id,{callback,ms});return id;},
        clearInterval:id=>control.fastTimers.delete(id),
        qa:(selector,root)=>selector==='.tc-card' && root===dom
            ? dom.keys.map(key=>({getAttribute:name=>name==='data-chave'?key:null})) : [],
        outlandNormalizeSpeciesId:id=>id,
        farmingReceiptIdentity:event=>event.receiptId || null,
        queueRender:()=>{},
        socketReady:()=>true,
        isUnlocked:()=>true,
        isHuntHere:(slug=state.currentHuntSlug)=>
            !state.huntScene.noCentro && state.currentHuntSlug===slug,
        currentHunt:()=>state.hunts.find(h=>h.slug===state.currentHuntSlug)||null,
        sendHuntSelect:hunt=>{sent.push({t:'hunt.select',slug:hunt.slug});
            if(control.autoTravel)state.currentHuntSlug=hunt.slug;
            return true;}
    };
    const api=vm.runInNewContext(code+'\n({dexAutoWeek,dexAutoSyncWeek,dexAutoSetAccount,'+
        'dexAutoReconcileTopCatch,dexAutoObserveState,dexAutoNextHunt,'+
        'recordPokedexAutoCatch,startPokedexAuto,stopPokedexAuto,dexAutoSyncFromDom,'+
        'dexAutoObserveGate,dexAutoOnBattleEvent,dexAutoSwitchGate,'+
        'stepPokedexAuto})',context);
    return {api,state,storage,clock,dom,control,sent};
}

function syncSettledGrid(h) {
    // First read observes a candidate; second read confirms a stable list.
    h.api.dexAutoSyncFromDom();
    h.clock.now += 750;
    return h.api.dexAutoSyncFromDom();
}

function capture(id, speciesId) {
    return {k:'capturado',pokemon:{id, speciesId}};
}

test('Sunday 00:00 Brasília is the weekly boundary, not UTC midnight',()=>{
    const {api}=harness();
    assert.equal(api.dexAutoWeek(Date.parse('2026-11-01T02:59:59Z')),'2026-10-25');
    assert.equal(api.dexAutoWeek(Date.parse('2026-11-01T03:00:00Z')),'2026-11-01');
    assert.equal(api.dexAutoWeek(Date.parse('2026-10-26T12:00:00Z')),'2026-10-25');
});

test('captured species persist across a new page/session and Stop/Start',()=>{
    const first=harness();
    first.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{}}});
    first.api.startPokedexAuto();
    assert.equal(first.state.pokedexAuto.targetSlug,'bulbasaur');
    assert.equal(first.api.recordPokedexAutoCatch(capture(101,1),false),true);
    assert.equal(first.state.pokedexAuto.targetSlug,'squirtle');
    assert.deepEqual([...first.state.pokedexAuto.caught],[1]);
    first.api.stopPokedexAuto();
    first.api.startPokedexAuto();
    assert.equal(first.state.pokedexAuto.targetSlug,'squirtle');
    const second=harness(first.storage);
    second.api.startPokedexAuto();
    assert.equal(second.state.pokedexAuto.targetSlug,'squirtle',
        'reloaded automation must not travel back to Bulbasaur');
    assert.deepEqual([...second.state.pokedexAuto.caught],[1]);
    assert.equal(second.api.recordPokedexAutoCatch(capture(999,7),false),true);
    assert.equal(second.state.pokedexAuto.mode,'done');
    second.api.startPokedexAuto();
    assert.equal(second.state.pokedexAuto.mode,'done',
        'a completed same-week route is not erased by Start');
});

test('confirmed normal-hunt capture is recorded even while automation is stopped',()=>{
    const h=harness();
    h.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{}}});
    assert.equal(h.state.pokedexAuto.active,false);
    assert.equal(h.api.recordPokedexAutoCatch(capture(200,1),false),true);
    assert.deepEqual([...h.state.pokedexAuto.caught],[1]);
    const resumed=harness(h.storage);
    resumed.api.startPokedexAuto();
    assert.equal(resumed.state.pokedexAuto.targetSlug,'squirtle');
});

test('the server Top Catch {s,e} ledger contributes prior weekly captures',()=>{
    const h=harness();
    h.api.dexAutoSyncWeek();
    assert.equal(h.api.dexAutoReconcileTopCatch({
        topCatch:{s:'2026-10-25',e:{'1':120,'25':140}}
    }),true);
    assert.deepEqual([...h.state.pokedexAuto.caught].sort((a,b)=>a-b),[1,25]);
    assert.equal(h.state.pokedexAuto.serverSynced,true);
    const reload=harness(h.storage);
    reload.api.startPokedexAuto();
    assert.equal(reload.state.pokedexAuto.targetSlug,'squirtle');
    assert.equal(reload.state.pokedexAuto.caught.has(25),true);
    // A stale week must never be imported, and Pokédex c counters are not Top Catch.
    assert.equal(reload.api.dexAutoReconcileTopCatch({
        topCatch:{s:'2026-10-18',e:{'7':4}},pokedex:{'7':{c:99}}
    }),false);
    assert.equal(reload.state.pokedexAuto.caught.has(7),false);
});

test('weekly reset discards last-week species only when Sunday begins',()=>{
    const h=harness();
    h.api.dexAutoSyncWeek();
    h.api.recordPokedexAutoCatch(capture(300,1),false);
    assert.equal(h.state.pokedexAuto.caught.size,1);
    h.clock.now=Date.parse('2026-11-01T02:59:59Z');
    assert.equal(h.api.dexAutoSyncWeek(),false);
    assert.equal(h.state.pokedexAuto.caught.size,1);
    h.clock.now=Date.parse('2026-11-01T03:00:00Z');
    assert.equal(h.api.dexAutoSyncWeek(),true);
    assert.equal(h.state.pokedexAuto.week,'2026-11-01');
    assert.equal(h.state.pokedexAuto.caught.size,0);
    assert.equal(h.state.pokedexAuto.serverSynced,false);
    const reloaded=harness(h.storage,h.clock);
    reloaded.api.dexAutoSyncWeek();
    assert.equal(reloaded.state.pokedexAuto.caught.size,0);
});

test('authenticated account ledgers stay separate in the same browser profile',()=>{
    const h=harness();
    h.api.dexAutoSetAccount('id-123');
    h.api.recordPokedexAutoCatch(capture(111,1),false);
    h.api.dexAutoSetAccount('id-456');
    assert.equal(h.state.pokedexAuto.caught.has(1),false);
    h.api.recordPokedexAutoCatch(capture(222,7),false); // different hunt
    assert.equal(h.state.pokedexAuto.caught.has(7),false);
    h.api.dexAutoObserveState({userId:123});
    assert.equal(h.state.pokedexAuto.accountKey,'id-123');
    assert.equal(h.state.pokedexAuto.caught.has(1),true);
    assert.ok([...h.storage.values()].every(value=>!value.includes('token')));
});

test('invalid or unconfirmed captures do not pollute the weekly log',()=>{
    const h=harness();
    h.api.dexAutoSyncWeek();
    assert.equal(h.api.recordPokedexAutoCatch({k:'bola',pokemon:{speciesId:1}},true),false);
    assert.equal(h.api.recordPokedexAutoCatch({k:'capturado',pokemon:{speciesId:1}},false),false);
    assert.equal(h.api.recordPokedexAutoCatch(capture(2,7),false),false);
    assert.equal(h.state.pokedexAuto.caught.size,0);
    assert.doesNotMatch(code,/state\.pokedex\b|ownedSpecies/);
});


test('without official weekly evidence the automation waits instead of restarting',()=>{
    const h=harness();
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.mode,'needsSync');
    assert.equal(h.state.pokedexAuto.targetSlug,null);
    assert.equal(h.state.currentHuntSlug,'bulbasaur');
    // An old v1.9.30 local record is useful but NOT proof of all weekly catches.
    const raw=[...h.storage.keys()][0];
    h.storage.set(raw,JSON.stringify({schema:1,week:'2026-10-25',caught:[69]}));
    const resumed=harness(h.storage);
    resumed.api.startPokedexAuto();
    assert.equal(resumed.state.pokedexAuto.mode,'needsSync');
});

test('real Top Catch card keys, including Bellsprout, skip already captured hunts',()=>{
    const h=harness();
    h.state.hunts=[
        {slug:'bellsprout',nivel:1,especies:[{pokeId:69}]},
        {slug:'bulbasaur',nivel:2,especies:[{pokeId:1}]},
        {slug:'squirtle',nivel:3,especies:[{pokeId:7}]}
    ];
    h.state.currentHuntSlug='bellsprout';
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.mode,'needsSync');
    // Captured "seg 00:38" and "seg 03:44" in the supplied Top Catch HTML:
    // <div id="tc-grade"><div class="tc-card" data-poke="69"
    // data-chave="69">Bellsprout</div><div class="tc-card"
    // data-poke="1" data-chave="1">Bulbasaur</div></div>
    h.dom.keys=['69','1'];
    assert.equal(syncSettledGrid(h),true);
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.targetSlug,'squirtle');
    assert.equal(h.state.pokedexAuto.caught.has(69),true);
    assert.equal(h.state.pokedexAuto.caught.has(1),true);
    const reloaded=harness(h.storage);
    reloaded.state.hunts=h.state.hunts;
    reloaded.state.currentHuntSlug='bellsprout';
    reloaded.api.startPokedexAuto();
    assert.equal(reloaded.state.pokedexAuto.targetSlug,'squirtle',
        'Bellsprout may never be visited again this week after a reload');
    assert.equal(reloaded.state.pokedexAuto.serverSynced,true);
});

test('partially rendered or malformed official grid does not authorize navigation',()=>{
    const h=harness();
    h.api.startPokedexAuto();
    h.dom.keys=[];
    assert.equal(h.api.dexAutoSyncFromDom(),false);
    assert.equal(h.state.pokedexAuto.serverSynced,false);
    h.dom.keys=['69',null];
    assert.equal(h.api.dexAutoSyncFromDom(),false);
    assert.equal(h.state.pokedexAuto.serverSynced,false);
    h.dom.keys=['69'];
    assert.equal(syncSettledGrid(h),true);
    assert.equal(h.state.pokedexAuto.serverSynced,true);
});

test('old mounted Top Catch grid cannot reauthorize captures after Sunday reset',()=>{
    const h=harness();
    h.dom.keys=['69'];
    assert.equal(syncSettledGrid(h),true);
    h.clock.now=Date.parse('2026-11-01T03:00:00Z');
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.mode,'needsSync',
        'a still-mounted old weekly grid must not be accepted');
    assert.equal(h.state.pokedexAuto.caught.size,0);
    h.dom.keys=['7'];
    assert.equal(syncSettledGrid(h),true);
    assert.equal(h.state.pokedexAuto.caught.has(69),false);
    assert.equal(h.state.pokedexAuto.caught.has(7),true);
});


test('a partially built Top Catch panel cannot skip validation before Bellsprout is appended',()=>{
    const h=harness();
    h.state.hunts=[
        {slug:'bellsprout',nivel:1,especies:[{pokeId:69}]},
        {slug:'squirtle',nivel:2,especies:[{pokeId:7}]}
    ];
    h.state.currentHuntSlug='bellsprout';
    h.api.startPokedexAuto();
    h.dom.keys=['76']; // Golem rendered first; Bellsprout later in the grid.
    assert.equal(h.api.dexAutoSyncFromDom(),false);
    h.clock.now+=300;
    h.dom.keys=['76','69'];
    assert.equal(h.api.dexAutoSyncFromDom(),false,
        'adding cards resets the stability wait');
    h.clock.now+=800;
    assert.equal(h.api.dexAutoSyncFromDom(),true);
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.targetSlug,'squirtle');
});


test('an explicitly empty official Top Catch can authorize a fresh week',()=>{
    const h=harness();
    h.dom.keys=[];
    h.dom.textContent='Nenhuma captura com bola nesta semana.';
    assert.equal(h.api.dexAutoSyncFromDom(),false);
    h.clock.now+=1600;
    assert.equal(h.api.dexAutoSyncFromDom(),true);
    assert.equal(h.state.pokedexAuto.serverSynced,true);
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.targetSlug,'bulbasaur');
});

test('an old account grid cannot silently verify another account',()=>{
    const h=harness();
    h.dom.keys=['69'];
    assert.equal(syncSettledGrid(h),true);
    h.api.dexAutoSetAccount('id-123');
    assert.equal(h.api.dexAutoSyncFromDom(),false);
    h.clock.now+=800;
    assert.equal(h.api.dexAutoSyncFromDom(),false,
        'the previous account grid has not been rebuilt');
    h.api.startPokedexAuto();
    assert.equal(h.state.pokedexAuto.mode,'needsSync');
    // The next account opens its own Top Catch screen.
    h.dom.keys=['7'];
    assert.equal(syncSettledGrid(h),true);
    assert.equal(h.state.pokedexAuto.caught.has(69),false);
    assert.equal(h.state.pokedexAuto.caught.has(7),true);
});


test('10s entry lock and 3s combat lock are honored without a 7s retry pause',()=>{
    const h=harness();
    h.control.autoTravel=false;
    h.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{'1':20}}});
    h.state.huntSwitchGate.entryUntil=h.clock.now+10000;
    h.state.huntSwitchGate.combatUntil=h.clock.now+3000;
    h.api.startPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,0);
    h.clock.now+=9900;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,0);
    h.clock.now+=100;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,1);
    assert.equal(h.sent.at(-1).slug,'squirtle');
    assert.equal(h.control.fastTimers.size,1);
    h.state.currentHuntSlug='squirtle';
    h.api.stepPokedexAuto();
    assert.equal(h.control.fastTimers.size,0,
        'fast watcher must stop once target hunt is reached');
});

test('an open wave overrides the 3s combat lock but not the entry lock',()=>{
    const h=harness();
    h.control.autoTravel=false;
    h.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{'1':20}}});
    h.api.startPokedexAuto();
    h.sent.length=0;
    h.state.huntSwitchGate.combatUntil=h.clock.now+3000;
    h.state.huntSwitchGate.wave=4;
    h.state.huntSwitchGate.combatWave=3;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,0,
        'short throttle after the previous attempt still applies');
    h.clock.now+=400;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,1);
    h.state.huntSwitchGate.entryUntil=h.clock.now+5000;
    assert.equal(h.api.dexAutoSwitchGate().entryRemaining,5000);
    assert.equal(h.api.dexAutoSwitchGate().combatRemaining,0);
});

test('repeated damage preventing exit eventually gives up then heals at Center',()=>{
    const h=harness();
    h.control.autoTravel=false;
    h.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{'1':20}}});
    h.state.huntSwitchGate.entryUntil=h.clock.now+10000;
    h.api.startPokedexAuto();
    h.clock.now+=14000;
    h.api.dexAutoOnBattleEvent({k:'ataque'});
    h.api.stepPokedexAuto();
    assert.equal(h.sent.at(-1).t,'centro.desistir');
    assert.equal(h.state.pokedexAuto.mode,'recovering');
    // Await server-confirmed arrival; no hunt selection while in transit.
    const travelBefore=h.sent.filter(x=>x.t==='hunt.select').length;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.filter(x=>x.t==='hunt.select').length,travelBefore);
    h.state.huntScene.noCentro=true;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.at(-1).t,'centro.curar');
    assert.equal(h.state.pokedexAuto.mode,'healing');
    h.api.dexAutoOnBattleEvent({k:'joy',fala:'nocaute'});
    h.api.stepPokedexAuto();
    assert.equal(h.sent.at(-1).t,'centro.curar',
        'unhealed or failed Joy responses must not allow the next hunt');
    h.api.dexAutoOnBattleEvent({k:'curado'});
    h.api.stepPokedexAuto();
    assert.equal(h.sent.at(-1).t,'hunt.select');
    assert.equal(h.sent.at(-1).slug,'squirtle');
});

test('normal windows do not incur a knockout, and stopping disables fast timer',()=>{
    const h=harness();
    h.control.autoTravel=false;
    h.api.dexAutoReconcileTopCatch({topCatch:{s:'2026-10-25',e:{'1':20}}});
    h.state.huntSwitchGate.combatUntil=h.clock.now+3000;
    h.state.huntSwitchGate.lastAttackAt=h.clock.now;
    h.api.startPokedexAuto();
    h.clock.now+=3000;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.at(-1).t,'hunt.select');
    assert.equal(h.sent.some(x=>x.t==='centro.desistir'),false);
    h.api.stopPokedexAuto();
    assert.equal(h.control.fastTimers.size,0);
    h.clock.now+=30000;
    h.api.stepPokedexAuto();
    assert.equal(h.sent.some(x=>x.t==='centro.desistir'),false);
});
