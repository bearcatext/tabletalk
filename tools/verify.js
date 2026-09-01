const fs=require('fs');
const path=process.argv[2]||require('path').join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(path,'utf8');
const TARGET=20;
const recs=[...html.matchAll(/\{id:(\d+),e:"([^"]+)",t:"([^"]+)",c:"([^"]+)",mins:(\d+),cals:(\d+),rating:([\d.]+)/g)]
  .map(m=>({id:+m[1],e:m[2],t:m[3],c:m[4],mins:+m[5],cals:+m[6],rating:+m[7]}));
console.log(`file: ${path}   lines: ${html.split('\n').length}   recipes: ${recs.length}\n`);
const cuisBlock=html.slice(html.indexOf('CUISINES'),html.indexOf('CUISINES')+3000);
const CU=[...cuisBlock.matchAll(/\{id:'([^']+)'|\{id:"([^"]+)"/g)].map(m=>m[1]||m[2]).filter(c=>c!=='all');   // a picker entry, not a cuisine
const cnt={}; recs.forEach(r=>cnt[r.c]=(cnt[r.c]||0)+1);
const all=[...new Set([...Object.keys(cnt),...CU])].sort((a,b)=>(cnt[b]||0)-(cnt[a]||0));
all.forEach(c=>{const n=cnt[c]||0;console.log(`  ${c.padEnd(16)}${String(n).padStart(3)}   ${n>=TARGET?'OK':'need +'+(TARGET-n)}`)});
console.log(`\n  ${'TOTAL'.padEnd(16)}${String(recs.length).padStart(3)}   target ${TARGET*all.length}+\n`);
const dup=(arr)=>{const c={},d={};arr.forEach(x=>c[x]=(c[x]||0)+1);for(const k in c)if(c[k]>1)d[k]=c[k];return Object.keys(d).length?d:'none';};
console.log('duplicate ids:   ',dup(recs.map(r=>r.id)));
console.log('duplicate titles:',dup(recs.map(r=>r.t.toLowerCase())));
console.log('cuisine mismatch:',Object.keys(cnt).filter(c=>!CU.includes(c)).join(', ')||'none');
console.log('next free id:    ',Math.max(...recs.map(r=>r.id))+1);
const slow=recs.filter(r=>r.mins>30);
console.log('over 30 min:     ',slow.length,slow.slice(0,4).map(r=>`${r.t}(${r.mins})`).join(', '));
