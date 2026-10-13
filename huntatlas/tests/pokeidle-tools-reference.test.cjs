'use strict';
// Executes the actual production helpers rather than a reimplemented calculator.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../hunt-atlas.user.js'),'utf8');
const begin=src.indexOf('// HA MILESTONE A PURE BEGIN.');
const end=src.indexOf('// HA MILESTONE A PURE END.',begin);
assert.ok(begin>=0&&end>begin);
const pure=src.slice(begin,end);
const math=vm.runInNewContext(pure+'\n({referenceCapturePreview,referenceRarePreview,farmingChanceAtLeastOne})');
const close=(actual,expected,tol=1e-12)=>
    assert.ok(Math.abs(actual-expected)<tol,actual+' != '+expected);

test('disabled third-party assumptions do not change existing modeled capture/shiny',()=>{
    const p=math.referenceCapturePreview(.039,300,1/24000,{});
    close(p.catchChance,.039);
    close(p.shinyChance,1/24000);
    close(p.catchesH,11.7);
    close(p.shinyCaughtH,11.7/24000);
    close(p.shinyCaught24hChance,
        math.farmingChanceAtLeastOne(.039/24000,7200));
    close(p.shinyCaught24hChance+p.shinyNotCaught24hChance,1);
    assert.match(p.assumption,/not-server-observed/);
});

test('boost stacking follows reference site, with user-supplied percent not fixed guesses',()=>{
    const p=math.referenceCapturePreview(.02,600,1/24000,{
        shinyBoost:true,catchBoost:true,kickShiny:true,
        kickCatch:true,shinyEvent:20,catchEvent:25
    });
    close(p.catchChance,.02*1.5*1.25*1.15);
    close(p.shinyChance,(1/24000)*1.5*1.2*1.15);
    close(p.shinyCaughtH,600*p.catchChance*p.shinyChance);
    close(p.shinySeenH,600*p.shinyChance);
});

test('cap the final success probability and preserve unknown Outland shiny status',()=>{
    const capped=math.referenceCapturePreview(.9,10,.8,{
        catchBoost:true,shinyBoost:true,shinyEvent:1000
    });
    assert.equal(capped.catchChance,1);
    assert.equal(capped.shinyChance,1);
    assert.equal(capped.shinyCaught24hChance,1);
    const unknown=math.referenceCapturePreview(.04,300,null,{shinyBoost:true});
    assert.equal(unknown.catchChance,.04);
    assert.equal(unknown.shinyCaughtH,null);
    assert.equal(unknown.shinyCaught24hChance,null);
    assert.equal(unknown.shinyNotCaught24hChance,null);
    assert.equal(math.referenceCapturePreview(null,300,1/24000,{}),null);
    assert.equal(math.referenceCapturePreview(.02,-1,1/24000,{}),null);
});

test('rare-drop modifiers compose after the chosen Outland tier with site assumptions',()=>{
    // Bronze Token at Outland 2: .0005 * 1.25, from existing tier model.
    const original=.0005*1.25;
    const normal=math.referenceRarePreview(original,250,{});
    close(normal.chance,original);
    close(normal.unitsH,250*original);
    const boosted=math.referenceRarePreview(original,250,{
        loot:2,guild:1.5,event:3,kick:1.15
    });
    close(boosted.chance,original*2*1.5*3*1.15);
    close(boosted.unitsH,250*boosted.chance);
    close(boosted.expected24h,24*boosted.unitsH);
    close(boosted.chance24h+boosted.noDrop24h,1);
});

test('rare caps, impossibility and invalid input do not fabricate a forecast',()=>{
    assert.equal(math.referenceRarePreview(.7,10,{loot:2}).chance,1);
    const zero=math.referenceRarePreview(0,250,{});
    assert.equal(zero.chance24h,0);
    assert.equal(zero.noDrop24h,1);
    assert.equal(math.referenceRarePreview(.0005,250,{guild:0}),null);
    assert.equal(math.referenceRarePreview(.0005,250,{event:Infinity}),null);
    assert.equal(math.referenceRarePreview(.0005,null,{}),null);
    assert.equal(math.referenceCapturePreview(.02,500,1/24000,
        {catchEvent:-1}),null);
});

test('higher Outland tier is accessible in the main Atlas view, guarded by native state',()=>{
    assert.match(src,/quickOutlandHtml/);
    assert.match(src,/\$\{quickOutlandHtml\}/);
    assert.match(src,/data-mha-quick-outland/);
    assert.match(src,/data-mha-quick-tier-apply/);
    assert.match(src,/requestOutlandTier\(state\.filters\.outlandPreviewTier\)/);
    assert.match(src,/activateTier=Boolean\(tierInfo && state\.outlandTierSeen/);
    assert.match(src,/if\(!state\.outlandTierSeen \|\|/);
});
test('reference panel cannot alter core forecast or sort functions',()=>{
    assert.match(src,/data-mha-reference-setting/);
    assert.match(src,/referenceCapturePreview\(/);
    assert.match(src,/referenceRarePreview\(/);
    assert.match(src,/rankings, measured rates and default predictions stay unboosted/);
    assert.match(src,/referenceEnabled: false/);
    assert.match(src,/const refActive=state\.filters\.referenceEnabled/);
    assert.doesNotMatch(src,/referenceCapturePreview\([\s\S]{0,200}haMetricValue/);
});
