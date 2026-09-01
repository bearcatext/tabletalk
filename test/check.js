const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const m=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
console.log('script blocks: '+m.length);
m.forEach((s,i)=>{
  try{ new vm.Script(s[1]); console.log(`  block ${i}: OK (${s[1].split('\n').length} lines)`); }
  catch(e){ console.log(`  block ${i}: SYNTAX ERROR -> ${e.message}`); process.exitCode=1; }
});
