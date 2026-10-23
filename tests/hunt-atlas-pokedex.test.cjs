// Run: node --test tests/hunt-atlas-pokedex.test.cjs
// Exercise the real Atlas routing and capture functions without a browser.
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
        active:true, mode:'hunting', caught:new Set(), visited:new Set(),
        receipts:new Set(), targetSlug:'l1-a', previousSlug:null, lastTravelAt:0
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
        outlandNormalizeSpeciesId: id => id,
        isHuntHere: slug => state.currentHuntSlug === slug,
        farmingReceiptIdentity: event => event.receiptId || null,
        stepPokedexAuto: () => { advances++; },
        queueRender: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext([
        'dexAutoSpecies', 'dexAutoNextHunt', 'recordPokedexAutoCatch'
    ].map(functionBody).join('\n'), ctx);
    return {...ctx, auto, advances:() => advances};
}

test('lowest hunt level completes before level 10, regardless of catalog order', () => {
    const ctx = harness();
    const allowed=() => true;
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,null).slug,'l1-a');
    ctx.auto.caught.add(1);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,'l1-a').slug,'l1-b');
    ctx.auto.caught.add(2);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,'l1-b').slug,'l10-a');
    ctx.auto.caught.add(3);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,null),null);
});

test('only accessible hunts are scheduled, and higher-level duplicates are skipped', () => {
    const ctx=harness();
    const allowed=hunt => hunt.slug!=='l1-a';
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,null).slug,'l1-b');
    ctx.auto.caught.add(2);
    assert.equal(ctx.dexAutoNextHunt(hunts,ctx.auto.caught,ctx.auto.visited,allowed,null).slug,'l10-a');
});

test('multi-species hunt is revisited at the same level until its species are caught', () => {
    const catalog=[
        {slug:'multi',nivel:1,especies:[{pokeId:4},{pokeId:5}]},
        {slug:'single',nivel:1,especies:[{pokeId:6}]},
        {slug:'ten',nivel:10,especies:[{pokeId:7}]}
    ];
    const ctx=harness(catalog);
    const allowed=()=>true;
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,ctx.auto.visited,allowed,null).slug,'multi');
    ctx.auto.caught.add(4);
    ctx.auto.visited.add('multi');
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,ctx.auto.visited,allowed,'multi').slug,'single');
    ctx.auto.caught.add(6);
    ctx.auto.visited.add('single');
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,ctx.auto.visited,allowed,'single').slug,'multi');
    ctx.auto.caught.add(5);
    assert.equal(ctx.dexAutoNextHunt(catalog,ctx.auto.caught,ctx.auto.visited,allowed,'multi').slug,'ten');
});

test('only server-confirmed capture updates the in-memory list; repeated receipt does not', () => {
    const ctx=harness();
    // Intentionally booby-trap Pokédex and ownership: neither may be consulted.
    Object.defineProperty(ctx.state,'pokedex',{get(){throw Error('read Pokédex');}});
    Object.defineProperty(ctx.state,'ownedSpecies',{get(){throw Error('read owned');}});
    assert.equal(ctx.recordPokedexAutoCatch({k:'bola',pokemon:{id:99,speciesId:1}},true),false);
    assert.equal(ctx.auto.caught.size,0);
    const receipt={k:'capturado',slot:'7',pokemon:{id:99,speciesId:1}};
    assert.equal(ctx.recordPokedexAutoCatch(receipt,false),true);
    assert.equal(ctx.auto.caught.has(1),true);
    assert.equal(ctx.auto.visited.has('l1-a'),true);
    assert.equal(ctx.auto.targetSlug,null);
    assert.equal(ctx.advances(),1);
    ctx.auto.targetSlug='l1-a';
    assert.equal(ctx.recordPokedexAutoCatch(receipt,false),false);
    assert.equal(ctx.advances(),1);
});

test('unknown species and unconfirmed anonymous capture do not advance', () => {
    const ctx=harness();
    assert.equal(ctx.recordPokedexAutoCatch({
        k:'capturado',slot:'7',pokemon:{id:55,speciesId:55}
    },true),false);
    assert.equal(ctx.recordPokedexAutoCatch({
        k:'capturado',slot:'7',pokemon:{speciesId:1}
    },false),false);
    assert.equal(ctx.auto.caught.size,0);
    assert.equal(ctx.advances(),0);
});

test('deduplicated slot-only confirmed capture works on older game packets', () => {
    const ctx=harness();
    assert.equal(ctx.recordPokedexAutoCatch({k:'capturado',slot:'7'},true),true);
    assert.equal(ctx.auto.caught.has(1),true);
    assert.equal(ctx.advances(),1);
});

test('mirror and canonical Atlas use identical post-header behavior', () => {
    const mirror = fs.readFileSync(path.join(__dirname,'..','addons',
        'hunt-atlas','hunt-atlas.user.js'),'utf8');
    assert.equal(src.split('// ==/UserScript==')[1],
        mirror.split('// ==/UserScript==')[1]);
});
