'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');

function section(start,end){
    const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,'missing section: '+start);
    return src.slice(a,b);
}

test('rankings show rates and useful targets without raw source codes',()=>{
    const rows=section('        const bestRows =','        const economicHunt =');
    assert.equal(src.split("'rank.value': '{value}',").length-1,2);
    assert.ok(rows.includes('formatObjectiveValue(row.score,objective)'));
    assert.ok(rows.includes('row.target'));
    assert.ok(!rows.includes('source:row.source'));
    assert.ok(!rows.includes('rank.rarePreview'));
    assert.ok(!src.includes('rank.rarePreview'));
});

test('rare planner does not show raw drop sources or repeated tier selection',()=>{
    const details=section('        const moreSub=[','        const huntMarkup =');
    const rare=section('        const modelRows=model=>','        const captureHunt=');
    assert.ok(!details.includes('selectedRare.source'));
    assert.ok(!rare.includes('escapeHtml(row.source)'));
    assert.ok(!rare.includes('outlandModel.source'));
    assert.ok(!src.includes('rare.previewOnly'));
    // Provenance still exists for internal evidence and diagnostics.
    assert.ok(src.includes("source:'wiki+upstream-shared'"));
    assert.ok(src.includes("'named-move model'"));
});

test('capture evidence, confidence and fallback reasons use localized copy',()=>{
    const capture=section('        const capEvidence=chosen?',
        '        // Reference inputs are explicit manual scenarios');
    assert.ok(!capture.includes('chosen.source'));
    assert.ok(!capture.includes('chosen?.ball?.source'));
    assert.ok(!capture.includes('chosen.ball.priceSource'));
    assert.ok(!capture.includes('Diamonds price unknown'));
    assert.ok(!capture.includes('observed usage'));
    assert.ok(src.includes("tr('xp.fallback.'+estimate.fallbackReason)"));
    assert.ok(src.includes("tr('xp.confidence.'+(xpInfo?.confidence??'low'))"));
    assert.ok(src.includes('source:currentXp?xpSourceLabel(currentXp)'));
    assert.ok(src.includes("'catch.diamondsPerCapture': '{count} Diamantes/captura'"));
});
