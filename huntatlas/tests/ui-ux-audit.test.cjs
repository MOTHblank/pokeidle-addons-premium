'use strict';
// This suite exercises the real UI filter helpers from the distributed script.
// Visual/layout certification still requires a running game in Firefox.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
function section(start,end){
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,start+' through '+end);
    return source.slice(a,b);
}
function makeContext(extra={}){
    const defaults={
        search:'',region:'all',minLevel:'',maxLevel:'',type:'all',
        weakness:[],weaknessMatchAll:false,availability:'unlocked',
        captured:'all',sort:'xp',sortDirection:'desc',
        outlandPreviewTier:1,captureBall:'ultra',
        rareSortItem:70000,detailOpen:false,referenceEnabled:false,
        referenceLoot:1,referenceShinyBoost:false
    };
    const filters={...defaults,...extra};
    const state={filters,resultLimit:240,searchRenderTimer:null};
    const saves=[];
    const ctx={
        state,FILTER_KEY:'huntatlas-ui-test',
        localStorage:{setItem:(key,value)=>saves.push({key,filters:JSON.parse(value)})},
        clearTimeout:id=>ctx.canceled=id,
        defaultFilters:()=>({...defaults,weakness:[]})
    };
    const helpers=vm.runInNewContext(
        section('    const SEARCH_FILTER_KEYS=', '    function setStatus(')+
        '\n({activeFilterCount,resetSearchFilters,SEARCH_FILTER_KEYS})',ctx);
    return {helpers,state,saves,ctx};
}

test('real list filters count, but previews, simulations and panels do not',()=>{
    const {helpers}=makeContext({
        outlandPreviewTier:8,captureBall:'beast',rareSortItem:70017,
        referenceEnabled:true,referenceLoot:8,detailOpen:true
    });
    assert.equal(helpers.activeFilterCount(),0);
    const changed=makeContext({
        search:'Mew',region:'outland',weakness:['FIRE','ICE'],
        weaknessMatchAll:true,availability:'all'
    });
    assert.equal(changed.helpers.activeFilterCount(),5);
});

test('Clear filters keeps Outland/ball/objective/reference choices',()=>{
    const {helpers,state,saves}=makeContext({
        search:'shiny',region:'unova',minLevel:'300',maxLevel:'1000',
        type:'FIRE',weakness:['WATER','ICE'],weaknessMatchAll:true,
        availability:'locked',captured:'uncaught',
        sort:'shinyCatch',sortDirection:'asc',outlandPreviewTier:7,
        captureBall:'beast',referenceEnabled:true,referenceLoot:3,
        detailOpen:true
    });
    assert.equal(helpers.activeFilterCount(),9);
    helpers.resetSearchFilters();
    assert.equal(helpers.activeFilterCount(),0);
    assert.equal(state.resultLimit,120);
    assert.equal(state.filters.sort,'shinyCatch');
    assert.equal(state.filters.sortDirection,'asc');
    assert.equal(state.filters.outlandPreviewTier,7);
    assert.equal(state.filters.captureBall,'beast');
    assert.equal(state.filters.referenceEnabled,true);
    assert.equal(state.filters.referenceLoot,3);
    assert.equal(state.filters.detailOpen,true);
    assert.equal(state.filters.weakness.length,0);
    assert.equal(saves.length,1);
});

test('Clear cancels any scheduled search redraw before resetting',()=>{
    const {helpers,state,ctx}=makeContext({search:'Mew'});
    state.searchRenderTimer=42;
    helpers.resetSearchFilters();
    assert.equal(ctx.canceled,42);
    assert.equal(state.searchRenderTimer,null);
});

test('compact/mobile filter panel is reversible and labelled for accessibility',()=>{
    assert.match(source,/filtersExpanded: null/);
    assert.match(source,/state\.filtersExpanded=window\.innerWidth>620/);
    assert.match(source,/data-mha-filter-toggle/);
    assert.match(source,/aria-controls="mha-filter-grid"/);
    assert.match(source,/aria-expanded=/);
    assert.match(source,/<section class="mha-xp-details" id="mha-best-results"/);
    assert.match(source,/\$\{bestRows\}/);
    assert.doesNotMatch(source,/data-mha-xp-toggle/);
    assert.doesNotMatch(source,/xpDetailsOpen/);
    assert.match(source,/<div class="mha-best-row" role="listitem">/);
    assert.match(source,/\$\{bestRows \? '' :/);
    assert.match(source,/document.activeElement\?\.isContentEditable/);
    assert.match(source,/\.mha-filters\[hidden\] \{ display: none !important; \}/);
    assert.match(source,/grid\.hidden=!state\.filtersExpanded/);
    assert.match(source,/max-height: min\(50dvh, 440px\)/);
});

test('empty results recovery and typeahead do not reset scenario choices',()=>{
    assert.match(source,/data-mha-empty-reset/);
    assert.match(source,/resetSearchFilters\(\);/);
    assert.match(source,/if\(\['search','minLevel','maxLevel'\]\.includes\(key\)\)/);
    assert.match(source,/state\.searchRenderTimer=setTimeout/);
    assert.match(source,/\},160\)/);
});

test('rerender retains recommendation focus and weakness button nodes',()=>{
    assert.match(source,/const focusAttr=host\.contains\(active\)/);
    assert.match(source,/match\?\.focus\(\{preventScroll:true\}\)/);
    assert.match(source,/weaknessOptions\.children\.length!==STANDARD_TYPES\.length/);
    assert.match(source,/button\.setAttribute\('aria-pressed',String\(selected\)\)/);
});

test('quick Outland switch reports true state and timeout without claiming success',()=>{
    assert.match(source,/data-mha-quick-tier-apply/);
    assert.match(source,/activateTier\?'':'disabled '/);
    assert.match(source,/outland\.quickDisconnected/);
    assert.match(source,/outland\.quickWaiting/);
    assert.match(source,/outland\.quickTimedOut/);
    assert.match(source,/state\.outlandTierLastOutcome=\{/);
    assert.match(source,/status:'timeout'/);
    assert.match(source,/state\.farmingSnapshot\.outlandTier === state\.pendingOutlandTier\.tier/);
    assert.match(source,/data-mha-quick-outland/);
});
