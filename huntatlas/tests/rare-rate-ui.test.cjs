'use strict';
// Execute the production formatting helpers extracted from the userscript.
// No game runtime or network required; forecasts/sort scores remain untouched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const start=src.indexOf('// HA RARE RATE UI PURE BEGIN.');
const end=src.indexOf('// HA RARE RATE UI PURE END.',start);
assert.ok(start>=0&&end>start,'formatting block is present');
const h=vm.runInNewContext(src.slice(start,end)+
    '\n({formatRate,formatEventRate,formatDurationHours,formatProbability,formatObjectiveValue})');

test('a real zero, a rare positive rate and unavailable evidence remain distinct',()=>{
    assert.equal(h.formatRate(0),'0');
    assert.equal(h.formatRate(null),'—');
    assert.equal(h.formatRate(NaN),'—');
    assert.equal(h.formatRate(-.42),'-.42');
    assert.equal(h.formatRate(-150),'-150');
    assert.notEqual(h.formatRate(.001),'0');
    assert.notEqual(h.formatEventRate(.0001),'0/h');
    assert.equal(h.formatEventRate(0),'0/h');
    assert.equal(h.formatEventRate(null),'—');
    assert.equal(h.formatEventRate(-1),'—');
});

test('event rates choose hours/days/years without rounded 0/h',()=>{
    assert.equal(h.formatEventRate(12),'12/h');
    assert.equal(h.formatEventRate(.125),'0.125/h');
    assert.equal(h.formatEventRate(.05),'1.2/d');
    assert.match(h.formatEventRate(.01),/^~1 \/ 4\.17 d$/);
    assert.match(h.formatEventRate(.0001),/^~1 \/ 1\.14 yr$/);
    assert.match(h.formatEventRate(.000001),/^~1 \/ 114\.16 yr$/);
});

test('long expected waits use appropriate units in either locale',()=>{
    assert.equal(h.formatDurationHours(12),'12 h');
    assert.equal(h.formatDurationHours(72),'3 d');
    assert.equal(h.formatDurationHours(8760),'1 yr');
    assert.equal(h.formatDurationHours(8760,true),'1 ano');
    assert.equal(h.formatDurationHours(null),'—');
});

test('positive very small probabilities are never presented as zero',()=>{
    assert.equal(h.formatProbability(0),'0%');
    assert.equal(h.formatProbability(.000005),'0.0005%');
    assert.equal(h.formatProbability(.0000000001),'1.00e-8%');
    assert.equal(h.formatProbability(null),'—');
    assert.equal(h.formatProbability(2),'—');
});

test('ranking units match selected objective, not a universal /h',()=>{
    assert.equal(h.formatObjectiveValue(.01,'rare'),'~1 / 4.17 d');
    assert.equal(h.formatObjectiveValue(.05,'shinyCatch'),'1.2/d');
    assert.equal(h.formatObjectiveValue(.05,'capture'),'1.2/d');
    assert.equal(h.formatObjectiveValue(2,'ballEfficiency',true),'2 Moedas/captura');
    assert.equal(h.formatObjectiveValue(2,'ballEfficiency',false),'2 Coins/capture');
    assert.equal(h.formatObjectiveValue(-3,'netCoins'),'-3/h');
    assert.equal(h.formatObjectiveValue(null,'xp'),'—');
});

test('user-facing templates do not double-append /h or percent markers',()=>{
    assert.match(src,/value:formatObjectiveValue\(row.score,objective,/);
    assert.match(src,/value:formatObjectiveValue\(best.score,objective,/);
    assert.match(src,/formatEventRate\(selectedRare\?\.unitsH\)/);
    assert.match(src,/formatEventRate\(chosen\.shinyCaughtH\)/);
    assert.match(src,/formatDurationHours\(1\/chosen\.shinyCaughtH/);
    assert.match(src,/formatProbability\(row\.chance1h\)/);
    assert.doesNotMatch(src,/'rank\.value': '\{value\}\/h/);
    assert.doesNotMatch(src,/'rare\.units': '\{value\} itens\/h/);
});

test('Top Five and bonus scenario inputs wrap rather than overflow',()=>{
    assert.match(src,/\.mha-best-row \.mha-xp-value/);
    assert.match(src,/overflow-wrap: anywhere/);
    assert.match(src,/\.mha-xp-summary \[data-mha-reference\] input\[type="number"\]/);
    assert.match(src,/@media \(max-width: 720px\)/);
});
