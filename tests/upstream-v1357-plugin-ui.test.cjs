'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const addon=name=>fs.readFileSync(path.join(__dirname,'../addons',name),'utf8');

test('Twitch scanner mounts in the automation header, not beside new Backpack icon',()=>{
    const src=addon('stream-auto-open.user.js');
    assert.match(src,/@version\s+7\.2\.3/);
    assert.doesNotMatch(src,/inventory\.insertAdjacentElement\('afterend'/);
    assert.doesNotMatch(src,/INVENTORY_ID\s*=/);
    const begin=src.indexOf('    function ensureScannerStyle()');
    const end=src.indexOf('    function start()',begin);
    assert.ok(begin>=0&&end>begin);
    // Execute the production installer with a minimal game DOM harness.
    const elements=new Map();
    const make=tag=>({
        tagName:tag,children:[],parentElement:null,attributes:{},
        setAttribute(k,v){this.attributes[k]=String(v)},
        appendChild(child){this.children.push(child);child.parentElement=this;elements.set(child.id,child)},
        addEventListener(event,handler){(this.events??={})[event]=handler}
    });
    const header=make('div'),toggle=make('button');
    toggle.id='btn-auto-toggle';
    header.appendChild(toggle);
    header.querySelector=selector=>selector==='#btn-auto-toggle'?toggle:null;
    header.insertBefore=function(node,before){
        this.children=this.children.filter(x=>x!==node);
        const index=this.children.indexOf(before);
        this.children.splice(index<0?this.children.length:index,0,node);
        node.parentElement=this;elements.set(node.id,node);
    };
    const head=make('head');
    const document={
        querySelector:selector=>selector==='#p-auto .painel-cab-auto'?header:null,
        getElementById:id=>elements.get(id)||null,
        createElement:make,
        head,documentElement:head
    };
    const sandbox={document,BUTTON_ID:'moth-scan-live-streams',
        window:{setTimeout(){}},runLiveScan:async()=>({twitchChannels:2,opened:false})};
    const installer=vm.runInNewContext(src.slice(begin,end)+
        '\nensureButton; ',sandbox);
    installer();
    const button=elements.get('moth-scan-live-streams');
    assert.ok(button,'scanner icon added');
    assert.equal(button.parentElement,header);
    assert.equal(header.children[0],button);
    assert.equal(header.children[1],toggle);
    assert.equal(button.children[0].textContent,'↻');
    assert.ok(button.attributes['aria-label']);
    installer();
    assert.equal(header.children.filter(x=>x.id===button.id).length,1);
});

test('Performance+ preserves native Economy Mode and does not break the collapsed rail',()=>{
    const src=addon('performance.user.js');
    assert.match(src,/@version\s+5\.5\.5/);
    assert.match(src,/html\.moth-ui-performance #palco > :not\(#caidos\):not\(#eco-painel\)/);
    assert.match(src,/html\.modo-economia\.moth-ui-performance #eco-painel/);
    assert.match(src,/html\.dir-min #\$\{TRIGGER_ID\} \{ display:none !important; \}/);
    assert.match(src,/const compact = !isEnabled\(\) \? 'Perf OFF'/);
    assert.match(src,/setAttribute\('aria-label', forcedOn/);
});

test('Scraper stays small in desktop nav and remains reachable on mobile',()=>{
    const src=addon('upstream-scraper/scraper-exporter.user.js');
    assert.match(src,/@version\s+1\.3\.1/);
    assert.match(src,/const mobile=document\.documentElement\.classList\.contains\('mobile'\)/);
    assert.match(src,/q\('#p-auto \.painel-cab-auto'\)/);
    assert.match(src,/button\.textContent\s*=\s*'⇩'/);
    assert.match(src,/aria-label', 'Open upstream scraper and exporter'/);
    assert.match(src,/\.mus-actions \{ flex-wrap:wrap; \}/);
});

test('unchanged Auto Catch+ UI anchors are still present in v1.357.3 app.html',()=>{
    // Verified against the upstream app.html in the source review.
    const src=addon('autocatch.user.js');
    for(const id of ['#auto-corpo','#caidos-lista','#caidos-bolas',
        '#auto-ball-opts','#auto-potion-opts','#auto-revive-opts'])
        assert.ok(src.includes(id),'expected game selector: '+id);
    assert.match(src,/host\.prepend\(panel\)/);
});
