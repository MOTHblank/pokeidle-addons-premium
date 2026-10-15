// node --test addons/battle-trace/tests/battle-trace.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'battle-trace-30s.user.js'), 'utf8');

function harness() {
    let now = 0, downloads = 0, urlCreates = 0;
    let delayedFinish = null;
    const sockets = [];
    class Socket {
        constructor(url) { this.url = url; this.listeners = new Map(); sockets.push(this); }
        addEventListener(name, fn) { this.listeners.set(name, fn); }
        emit(data) { this.listeners.get('message')?.({data:JSON.stringify(data)}); }
    }
    const NativeURL = URL;
    const MockURL = class extends NativeURL {};
    MockURL.createObjectURL = () => { urlCreates++; return 'blob:mock-report'; };
    MockURL.revokeObjectURL = () => {};
    const document = {
        readyState: 'loading',
        addEventListener() {},
        body: {appendChild() {}},
        documentElement: {appendChild() {}},
        createElement: () => ({
            href:'', download:'', style:{}, click() { downloads++; }, remove() {}
        })
    };
    const page = { WebSocket: Socket };
    const sandbox = {
        window:page, unsafeWindow:page, performance:{now:()=>now},
        URL:MockURL,document,Blob:class Blob {constructor(body,opts){this.body=body;}},
        setInterval:()=>17, clearInterval:()=>{},
        setTimeout:(fn,ms)=>{if(ms===30000)delayedFinish=fn;return 17;},
        clearTimeout:()=>{}, Date,
        console:{warn() {},log(){}}
    };
    const instrumented = source.replace('    installHook();',
        '    page.__battleTraceTest = {start, finish, model, activeSnapshot};\n    installHook();');
    assert.notEqual(instrumented, source);
    vm.runInNewContext(instrumented, sandbox);
    return {
        page, sockets, document, get downloads() {return downloads;},
        get urlCreates() {return urlCreates;},
        advance(ms) {now += ms;},
        finishTimeout() { delayedFinish?.(); },
        model:page.__battleTraceTest.model,
        start:page.__battleTraceTest.start,
        finish:page.__battleTraceTest.finish
    };
}

test('installed diagnostic captures only pokeidle.io sockets, without send or fetching',()=>{
    const h=harness();
    assert.equal(h.page.__mothBattleTrace30s.status().hookInstalled,true);
    new h.page.WebSocket('wss://irc-ws.chat.twitch.tv');
    assert.equal(h.model.gameSockets,0);
    new h.page.WebSocket('wss://game.pokeidle.io/ws');
    assert.equal(h.model.gameSockets,1);
    assert.doesNotMatch(source,/\.send\s*\(/);
    assert.doesNotMatch(source,/\bfetch\s*\(/);
});

test('30s passive timeline exports allowlisted combat and anonymous slot/cast refs',()=>{
    const h=harness();
    const socket=new h.page.WebSocket('wss://pokeidle.io/ws');
    socket.emit({t:'welcome',hunts:[{slug:'kanto',nivel:150,
        especies:[{pokeId:6,pontos:8}]}],estado:{cheio:true,
        huntSlug:'kanto',activeId:999,
        pokemons:[{id:999,speciesId:9,level:150,
            nome:'SECRET_USER_POKEMON_NICKNAME',stats:{
                hp:500,atk:250,def:150,spAtk:300,spDef:200,speed:80},
            ivs:{speed:31},attacks:[{name:'Surf',type:'WATER',
                power:600,cooldownMs:60000,category:'SPECIAL'}]}]}});
    h.start();
    socket.emit({t:'batalha',ev:[
        {k:'hunt',slug:'kanto',nome:'SENSITIVE_PLAYER'},
        {k:'spawn',slot:'secret-user-slot-23941',speciesId:6,
            level:150,maxHp:12500,nome:'INTERNAL_NICKNAME'}
    ]});
    h.advance(1200);
    socket.emit({t:'batalha',ev:[{k:'ataque',por:'jogador',
        slot:'secret-user-slot-23941',dano:4000,hpAlvo:8500,
        ef:2,castId:'private-uuid-xyz',golpe:{name:'Surf',type:'WATER',
            power:600,category:'SPECIAL',cooldownMs:60000},
        nome:'PRIVATE_NICKNAME',sessionToken:'DO_NOT_SAVE',password:'DONT_SAVE'}]});
    h.advance(1600);
    socket.emit({t:'batalha',ev:[{k:'ataque',por:'jogador',
        slot:'secret-user-slot-23941',dano:8500,ef:1,
        hpAlvo:0,castId:'second-id',golpe:'Investida'}]});
    h.advance(500);
    socket.emit({t:'batalha',ev:[{k:'morte',quem:'selvagem',
        slot:'secret-user-slot-23941',speciesId:6,level:150,
        xpTreinador:13000,xpPokemon:14000,
        playerName:'PRIVATE_NAME',sessionToken:'BAD_AUTH_VALUE'}]});
    h.advance(26700);
    h.finishTimeout();
    assert.equal(h.model.phase,'done');
    assert.equal(h.model.report.targetDurationMs,30000);
    assert.equal(h.model.report.durationMs,30000);
    assert.equal(h.model.report.summary.wildKills,1);
    assert.equal(h.model.report.summary.totalTrainerXp,13000);
    assert.equal(h.model.report.summary.playerAttackEvents,2);
    assert.equal(h.model.report.contextAtStart.lead.speciesId,9);
    assert.equal(h.model.report.contextAtStart.hunt.level,150);
    assert.equal(h.model.report.timeline[1].slot,'T1');
    assert.equal(h.model.report.timeline[2].cast,'C1');
    assert.equal(h.model.report.timeline[2].move,'Surf');
    assert.equal(h.model.report.summary.trainerXpPerHourWindow,1560000);
    assert.equal(h.downloads,1);
    assert.equal(h.urlCreates,1);
    const exported=JSON.stringify(h.model.report);
    for(const privateText of ['DO_NOT_SAVE','DONT_SAVE','PRIVATE_NAME',
        'SECRET_USER_POKEMON_NICKNAME','secret-user-slot-23941',
        'private-uuid-xyz','BAD_AUTH_VALUE','SENSITIVE_PLAYER']) {
        assert.equal(exported.includes(privateText),false,
            'private information leaked: '+privateText);
    }
});

test('missing game traffic explicitly warns to reload before recording',()=>{
    const h=harness();
    h.start();
    h.advance(30000);
    h.finish();
    assert.ok(h.model.report.warnings.some(w => w.includes('No battle')));
    assert.equal(h.model.report.summary.trainerXpPerHourWindow,0);
});

test('battle hunt transition and later state delta update context without raw game state',()=>{
    const h=harness();
    const socket = new h.page.WebSocket('wss://pokeidle.io/ws');
    socket.emit({t:'welcome',hunts:[
        {slug:'kanto',nivel:10,especies:[]},
        {slug:'johto',nivel:20,especies:[]}
    ],estado:{cheio:true,huntSlug:'kanto',activeId:55,
        pokemons:[{id:55,speciesId:1,level:22,stats:{atk:75}}]}});
    h.start();
    h.advance(100);
    socket.emit({t:'batalha',ev:[{k:'hunt',slug:'johto'}]});
    h.advance(100);
    socket.emit({t:'estado',estado:{activeId:null,pkMud:[
        {id:55,speciesId:1,level:23,stats:{atk:77}}],secret:'BAD_VALUE'}});
    h.advance(29800);
    h.finish();
    assert.equal(h.model.report.contextAtStart.huntSlug,'kanto');
    assert.equal(h.model.report.contextAtEnd.huntSlug,'johto');
    assert.equal(h.model.report.contextAtEnd.lead.level,23);
    assert.ok(h.model.report.warnings.some(w => w.includes('Hunt changed')));
    assert.equal(JSON.stringify(h.model.report).includes('BAD_VALUE'),false);
});
