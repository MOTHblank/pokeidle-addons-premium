// Run: node --test tests/hunt-atlas-pokedex.test.cjs
// Exercise the actual Hunt Atlas session Top Catch routing without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'addons',
    'hunt-atlas.user.js'), 'utf8');

function functionBody(name) {
    const start = src.indexOf('    function ' + name + '(');
    assert.ok(start >= 0, 'missing production function: ' + name);
    const next = src.indexOf('\n    function ', start + 1);
    return src.slice(start, next < 0 ? src.length : next);
}

const hunts = [
    {slug:'l10-a',nome:'Level 10 A',nivel:10,especies:[{pokeId:3}]},
    {slug:'l1-b',nome:'Level 1 B',nivel:1,especies:[{pokeId:2}]},
    {slug:'l1-a',nome:'Level 1 A',nivel:1,especies:[{pokeId:1}]},
    {slug:'l20-a',nome:'Level 20 A',nivel:20,especies:[{pokeId:3}]}
];

function harness(catalog=hunts) {
    const auto = {
        active:true, mode:'hunting', caught:new Set(), receipts:new Set(),
        targetSlug:'l1-a', lastTravelAt:0, week:null
    };
    let advances = 0;
    const state = {
        hunts:catalog,
        currentHuntSlug:'l1-a',
        farmingLedger:{slots:new Map([['7', {speciesId:1}]])},
        pokedexAuto:auto
    };
    const ctx = {
        state,
        outlandNormalizeSpeciesId: id => {
            const n=Number(id);
            return n>=10501&&n<10548?n-8500:id;
        },
        isHuntHere: slug => state.currentHuntSlug === slug,
        farmingReceiptIdentity: event => event.receiptId || null,
        stepPokedexAuto: () => { advances++; },
        queueRender: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext([
        'dexAutoSpecies', 'dexAutoKey', 'dexAutoWeek', 'dexAutoSyncWeek',
        'dexAutoNextHunt', 'recordPokedexAutoCatch'
    ].map(functionBody).join('\n'), ctx);
    return {...ctx, auto, advances:() => advances};
}

test('one-species hunts are selected in ascending level regardless of catalog order', () => {
    const ctx=harness();
    const allowed=()=>true;
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed).slug,'l1-a');
    ctx.auto.caught.add(1);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed).slug,'l1-b');
    ctx.auto.caught.add(2);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed).slug,'l10-a');
    ctx.auto.caught.add(3);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed),null);
});

test('multi-species, Safari and Mystic Arena are never routed as ordinary hunts', () => {
    const catalog=[
        {slug:'ticket',nivel:1,especies:[{pokeId:4},{pokeId:5}]},
        {slug:'safari',nivel:1,especies:[{pokeId:6}]},
        {slug:'arena_mistica',nivel:1,especies:[{pokeId:7}]},
        {slug:'normal',nivel:10,especies:[{pokeId:8}]}
    ];
    const ctx=harness(catalog);
    assert.equal(ctx.dexAutoSpecies(catalog[0]),null);
    assert.equal(ctx.dexAutoSpecies(catalog[1]),null);
    assert.equal(ctx.dexAutoSpecies(catalog[2]),null);
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,()=>true).slug,'normal');
    ctx.auto.caught.add(8);
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,()=>true),null);
});

test('locked one-species hunts are skipped, without skipping later accessible levels', () => {
    const ctx=harness();
    const allowed=hunt => hunt.slug!=='l1-a';
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed).slug,'l1-b');
    ctx.auto.caught.add(2);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,allowed).slug,'l10-a');
});

test('contest identity deduplicates Orre clones, preserving Outland and form IDs', () => {
    const ctx=harness();
    assert.equal(ctx.dexAutoKey(13252),252);
    assert.equal(ctx.dexAutoKey(252),252);
    assert.equal(ctx.dexAutoKey(10501),2001);
    assert.equal(ctx.dexAutoKey(2014),2014);
    assert.equal(ctx.dexAutoKey(4019),4019);
    const catalog=[
        {slug:'orre',nivel:1,especies:[{pokeId:13252}]},
        {slug:'hoenn',nivel:10,especies:[{pokeId:252}]},
        {slug:'outland',nivel:150,especies:[{pokeId:2014}]}
    ];
    ctx.auto.caught.add(252);
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,()=>true).slug,'outland');
});

test('only confirmed captured event updates the session list, never reading Pokédex', () => {
    const ctx=harness();
    Object.defineProperty(ctx.state,'pokedex',{get(){throw Error('read Pokédex');}});
    Object.defineProperty(ctx.state,'ownedSpecies',{get(){throw Error('read owned');}});
    ctx.auto.week=ctx.dexAutoWeek();
    assert.equal(ctx.recordPokedexAutoCatch({k:'bola',pokemon:{id:99,speciesId:1}},true),false);
    assert.equal(ctx.auto.caught.size,0);
    const receipt={k:'capturado',slot:'7',pokemon:{id:99,speciesId:1}};
    assert.equal(ctx.recordPokedexAutoCatch(receipt,false),true);
    assert.equal(ctx.auto.caught.has(1),true);
    assert.equal(ctx.auto.targetSlug,null);
    assert.equal(ctx.advances(),1);
    ctx.auto.targetSlug='l1-a';
    assert.equal(ctx.recordPokedexAutoCatch(receipt,false),false);
    assert.equal(ctx.advances(),1);
});

test('wrong species and anonymous non-deduplicated events never advance', () => {
    const ctx=harness();
    ctx.auto.week=ctx.dexAutoWeek();
    assert.equal(ctx.recordPokedexAutoCatch({
        k:'capturado',slot:'7',pokemon:{id:55,speciesId:55}
    },true),false);
    assert.equal(ctx.recordPokedexAutoCatch({
        k:'capturado',slot:'7',pokemon:{speciesId:1}
    },false),false);
    assert.equal(ctx.auto.caught.size,0);
    assert.equal(ctx.advances(),0);
});

test('slot-only confirmed capture is accepted when receipt is already deduplicated', () => {
    const ctx=harness();
    ctx.auto.week=ctx.dexAutoWeek();
    assert.equal(ctx.recordPokedexAutoCatch({k:'capturado',slot:'7'},true),true);
    assert.equal(ctx.auto.caught.has(1),true);
    assert.equal(ctx.advances(),1);
});

test('weekly reset happens exactly Sunday midnight Brasília (03:00 UTC)', () => {
    const ctx=harness();
    const before=Date.parse('2026-10-25T02:59:59Z');
    const after=Date.parse('2026-10-25T03:00:00Z');
    assert.equal(ctx.dexAutoWeek(before),'2026-10-18');
    assert.equal(ctx.dexAutoWeek(after),'2026-10-25');
    ctx.dexAutoSyncWeek(before);
    ctx.auto.caught.add(1);
    ctx.auto.receipts.add('pokemon:999');
    ctx.auto.targetSlug='l1-a';
    assert.equal(ctx.dexAutoSyncWeek(after),true);
    assert.equal(ctx.auto.caught.size,0);
    assert.equal(ctx.auto.receipts.size,0);
    assert.equal(ctx.auto.targetSlug,null);
    assert.equal(ctx.dexAutoSyncWeek(after+1000),false);
});

test('both premium entry points have identical functional code', () => {
    const mirror=fs.readFileSync(path.join(__dirname,'..','addons',
        'hunt-atlas','hunt-atlas.user.js'),'utf8');
    assert.equal(src.split('// ==/UserScript==')[1],
        mirror.split('// ==/UserScript==')[1]);
});
