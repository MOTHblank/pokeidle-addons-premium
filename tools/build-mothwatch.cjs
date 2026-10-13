'use strict';
// Keeps a single Violentmonkey userscript while sourcing isolated diagnostics.
// Usage: node tools/build-mothwatch.cjs [--check]. Do not run in the browser.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'addons','market-bot.user.js');
const source=path.join(root,'src','mothwatch','diagnostics-section.js');
const begin='    // BEGIN MOTHWATCH DIAGNOSTICS GENERATED';
const end='    // END MOTHWATCH DIAGNOSTICS GENERATED';
const script=fs.readFileSync(file,'utf8');
const section=fs.readFileSync(source,'utf8').trimEnd();
const i=script.indexOf(begin),j=script.indexOf(end,i+begin.length);
if(i<0||j<0||script.indexOf(begin,i+1)>=0||script.indexOf(end,j+1)>=0) {
    throw Error('Expected exactly one generated diagnostics section');
}
const next=script.slice(0,i)+begin+'\n'+section+'\n'+script.slice(j);
if(process.argv.includes('--check')) {
    if(next!==script) {
        process.stderr.write('MothWatch userscript diagnostics section is out of sync. Run node tools/build-mothwatch.cjs\n');
        process.exitCode=1;
    } else process.stdout.write('MothWatch generated section is in sync.\n');
} else {
    fs.writeFileSync(file,next);
    process.stdout.write('Updated '+path.relative(root,file)+'\n');
}
