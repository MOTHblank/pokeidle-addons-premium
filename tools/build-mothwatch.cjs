'use strict';
// Assemble independently reviewed source sections into one Violentmonkey userscript.
// Usage: node tools/build-mothwatch.cjs [--check] (no bundler, runtime imports, or network).
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'addons','market-bot.user.js');
const parts=[
  ['RULES','rules-section.js'],
  ['ORDERS','orders-section.js'],
  ['TRANSPORT','transport-section.js'],
  ['PRICING','pricing-section.js'],
  ['ECONOMY','economy-section.js'],
  ['RULE_SAFETY','rule-safety-section.js'],
  ['DIAGNOSTICS','diagnostics-section.js'],
  ['ITEM_SCANNER','item-scanner-section.js'],
  ['POKEMON_SCANNER','pokemon-scanner-section.js'],
  ['AUTO_SCANNER','automation-scanner-section.js'],
  ['SOCKET','socket-section.js'],
  ['UI_STYLE','ui-style-section.js'],
  ['UI_BROWSER','ui-browser-section.js'],
  ['UI_RULES','ui-rules-section.js'],
  ['UI_RENDER','ui-render-section.js'],
  ['UI_EVENTS','ui-events-section.js']
];
let output=fs.readFileSync(file,'utf8');
for(const [id,name] of parts) {
  const source=fs.readFileSync(path.join(root,'src','mothwatch',name),'utf8').trimEnd();
  const begin='    // BEGIN MOTHWATCH '+id+' GENERATED';
  const end='    // END MOTHWATCH '+id+' GENERATED';
  const i=output.indexOf(begin),j=output.indexOf(end,i+begin.length);
  if(i<0||j<0||output.indexOf(begin,i+begin.length)>=0||
      output.indexOf(end,j+end.length)>=0)
    throw Error('Expected exactly one '+id+' generated section');
  output=output.slice(0,i)+begin+'\n'+source+'\n'+output.slice(j);
}
if(process.argv.includes('--check')) {
  if(output!==fs.readFileSync(file,'utf8')) {
    process.stderr.write('Generated MothWatch userscript is out of sync. Run node tools/build-mothwatch.cjs\n');
    process.exitCode=1;
  } else process.stdout.write('All '+parts.length+' userscript modules are in sync.\n');
} else {
  fs.writeFileSync(file,output);
  process.stdout.write('Updated '+path.relative(root,file)+' from '+parts.length+' modules.\n');
}
