const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={innerHTML:'',className:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject(new Error('no net'))};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

// --- unseen-first rotation over one cuisine ---
S('seen',{});S('cooked',{});
ctx.selectCuisine('Thai');
const seenIds=new Set(G('shownIds'));
eq('first page marks 5 seen',Object.keys(G('seen')).length,5);
const thaiTotal=ctx.pool('Thai').length;
const pages=Math.ceil(thaiTotal/5);
for(let i=0;i<pages-1;i++){ctx.cycleFive();G('shownIds').forEach(id=>seenIds.add(id));}
eq('cycling covers every Thai recipe',seenIds.size,thaiTotal);
eq('all of them recorded as seen',Object.keys(G('seen')).length,thaiTotal);
eq('no unseen left',ctx.unseenIn('Thai'),0);

// --- exhaustion resets rather than silently looping ---
S('freshNotice',null);
ctx.cycleFive();
eq('reset notice raised',G('freshNotice')&&G('freshNotice').type,'reset');
eq('reset re-seeds the pool',ctx.unseenIn('Thai')>0,true);

// --- replenish trigger ---
S('seen',{});S('freshNotice',null);
ctx.selectCuisine('Thai');
eq('no prompt while plenty unseen',ctx.needsReplenish(),false);
const thai=G('ALL_RECIPES').filter(r=>r.c==='Thai');
thai.slice(0,thai.length-3).forEach(r=>{G('seen')[r.id]={n:1,last:1}});
eq('prompt appears under one page',ctx.needsReplenish(),true);
eq('prompt names the cuisine',/Thai/.test(ctx.freshNoticeHtml()),true);
eq('prompt offers generation',/generateRecipes\(\)/.test(ctx.freshNoticeHtml()),true);

// hiding pulls the trigger sooner
S('seen',{});S('hidden',new Set());
ctx.selectCuisine('Thai');
const before=ctx.unseenIn('Thai');
G('ALL_RECIPES').filter(r=>r.c==='Thai').slice(0,6).forEach(r=>ctx.hideRecipe(r.id));
eq('hiding shrinks the unseen pool',ctx.unseenIn('Thai')<before,true);

// --- cooking is recorded separately from seeing ---
S('seen',{});S('cooked',{});
const r0=G('ALL_RECIPES')[0];
ctx.startCook(r0.id);
eq('cook recorded',G('cooked')[r0.id].n,1);
eq('cook count persists',JSON.parse(store['dw_cooked'])[r0.id].n,1);
ctx.startCook(r0.id);
eq('cook count increments',G('cooked')[r0.id].n,2);
eq('cooking does not mark seen',G('seen')[r0.id],undefined);

// --- every selection path records what it showed ---
const paths={
  'selectCuisine':()=>ctx.selectCuisine('French'),
  'cycleFive':()=>{ctx.selectCuisine('Italian');ctx.cycleFive()},
  'diet category':()=>ctx.selectCuisine('hh'),
  // one ingredient is no longer enough to reach anything, so stock it properly
  'pantry':()=>{['Olive oil','Garlic','Salt','Black pepper','Spaghetti','Canned tomatoes','Eggs','Yellow onion','Butter','Lemon'].forEach(x=>G('pantry').add(x));ctx.selectCuisine('pantry')},
  'jumpToRecipe':()=>ctx.jumpToRecipe(G('ALL_RECIPES')[10].id),
};
Object.entries(paths).forEach(([name,fn])=>{
  S('seen',{});fn();
  const ids=G('shownIds');
  eq(name+' marks its page seen',ids.length>0&&ids.every(id=>G('seen')[id]),true);
});

eq('seen persists',typeof JSON.parse(store['dw_seen']),'object');
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
