const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const code=html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__get=n=>eval(n);globalThis.__set=(n,v)=>{eval(n+'=v')};";
const store={};
const stubEl=()=>({innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},querySelector:()=>stubEl(),querySelectorAll:()=>[],focus(){}});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:()=>stubEl(),querySelectorAll:()=>[],addEventListener(){}},
  window:{},console,fetch:()=>Promise.reject(new Error('no net'))};
ctx.globalThis=ctx; vm.createContext(ctx);
new vm.Script(code).runInContext(ctx);
const G=ctx.__get, S=ctx.__set;

let pass=0,fail=0;
const eq=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log(`${ok?'  PASS':'  FAIL'}  ${name}${ok?'':`\n          got=${JSON.stringify(got)}\n         want=${JSON.stringify(want)}`}`);ok?pass++:fail++;};
const pantry=G('pantry'), RECIPES=G('ALL_RECIPES');

console.log('\n-- normIng --');
eq('strips descriptors', ctx.normIng('2 finely chopped fresh garlic cloves'), 'garlic clove');
eq('parenthetical dropped', ctx.normIng('Chicken thighs (boneless)'), 'chicken thigh');
eq('plurals stemmed', ctx.normIng('Tomatoes'), 'tomato');

console.log('\n-- pantryHas --');
pantry.clear(); ['Olive oil','Garlic','Eggs','Chicken breast'].forEach(x=>pantry.add(x));
eq('exact', ctx.pantryHas('Garlic'), true);
eq('subset word match', ctx.pantryHas('Garlic cloves'), true);
eq('oil generalises', ctx.pantryHas('Extra virgin olive oil'), true);
eq('egg != eggplant', ctx.pantryHas('Eggplant'), false);
eq('absent item', ctx.pantryHas('Gochujang'), false);
eq('plural pantry vs singular ing', ctx.pantryHas('Egg'), true);

console.log('\n-- pantryMatch / ranking --');
const r=RECIPES[0];
const m=ctx.pantryMatch(r);
eq('match shape sane', m.have+m.missing===m.total && m.total===r.ing.length, true);
pantry.clear();
eq('empty pantry scores 0', ctx.pantryMatch(r).have, 0);
eq('badge hidden when pantry empty', ctx.matchBadgeHtml(r), '');
['Olive oil','Garlic','Salt','Black pepper','Pasta','Tomatoes','Canned tomatoes','Parmesan','Eggs','Onion'].forEach(x=>pantry.add(x));
const ranked=ctx.pantryRanked();
// the pantry now filters as well as sorts: only what you could actually cook
eq('ranked is a filter, not the whole catalogue', ranked.length<RECIPES.length, true);
eq('and everything in it is within reach',
  ranked.every(r=>ctx.pantryMatch(r).missing<=G('PANTRY_MAX_MISSING')), true);
eq('best match leads', ctx.pantryMatch(ranked[0]).missing<=ctx.pantryMatch(ranked[ranked.length-1]).missing, true);
const pcts=ranked.map(x=>ctx.pantryMatch(x).pct);
eq('ranked descending by pct', pcts.every((v,i)=>i===0||pcts[i-1]>=v), true);
console.log('    top 5:', ranked.slice(0,5).map(x=>{const q=ctx.pantryMatch(x);return `${x.t} ${q.have}/${q.total}`}).join(' | '));
eq('badge renders', /match-badge/.test(ctx.matchBadgeHtml(ranked[0])), true);

console.log('\n-- pantry paging --');
S('activeCuisine','pantry'); S('pantryPage',0);
S('shownIds',ranked.slice(0,5).map(x=>x.id));
const first=[...G('shownIds')];
ctx.cycleFive();
eq('page advances to new set', G('shownIds').some(id=>!first.includes(id)), true);
const pages=Math.ceil(ranked.length/5);
for(let i=1;i<pages;i++) ctx.cycleFive();
eq('wraps back to page 0', G('shownIds'), first);
const seen=new Set(); S('pantryPage',0); S('shownIds',ranked.slice(0,5).map(x=>x.id));
G('shownIds').forEach(id=>seen.add(id));
for(let i=1;i<pages;i++){ctx.cycleFive();G('shownIds').forEach(id=>seen.add(id));}
eq('paging reaches every recipe it offers', seen.size, ranked.length);

console.log('\n-- noteClass --');
eq('lighter beats richer', ctx.noteClass('lighter, less rich'), 'note-lighter');
eq('hotter', ctx.noteClass('hotter, deeply smoky'), 'note-hotter');
eq('same', ctx.noteClass('same effect, pantry-friendly'), 'note-same');
eq('tangier', ctx.noteClass('tangier, slightly denser crust'), 'note-tangier');
eq('smoky', ctx.noteClass('smokier, no added heat'), 'note-smoky');
eq('fallback', ctx.noteClass('completely unrelated wording'), 'note-neutral');
eq('empty', ctx.noteClass(''), 'note-neutral');

console.log('\n-- applySwap round-trip --');
S('swaps',{});
const rs=RECIPES.find(x=>x.ing.some(i=>i.swaps&&i.swaps.length));
const si=rs.ing.findIndex(i=>i.swaps&&i.swaps.length);
ctx.applySwap(rs.id,si,0);
const key=`${rs.id}-${si}`;
eq('swap stored as object', typeof G('swaps')[key], 'object');
eq('swap name matches data', G('swaps')[key].n, rs.ing[si].swaps[0].n);
eq('note carried through', G('swaps')[key].note, rs.ing[si].swaps[0].note||'');
eq('getIngName returns string', typeof ctx.getIngName(rs.id,si), 'string');
eq('getIngName reflects swap', ctx.getIngName(rs.id,si), rs.ing[si].swaps[0].n);
ctx.applySwap(rs.id,si,null);
eq('null clears swap', G('swaps')[key], undefined);

console.log('\n-- persistence --');
pantry.clear(); pantry.add('Miso paste'); ctx.save();
eq('pantry persisted', JSON.parse(store['dw_pantry']), ['Miso paste']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
