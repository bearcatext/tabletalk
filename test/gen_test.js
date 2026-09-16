const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={setAttribute(){},removeAttribute(){},hidden:false,innerHTML:'',className:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){}});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},
    createElement:()=>({getContext:()=>({font:'',measureText:t=>({width:t==='\uFFFF'?10:(t==='\u{1FAD9}'?10:20)})})})},
  window:{scrollTo(){},scrollY:0},console:{log(){},warn(){},error(){}},fetch:()=>Promise.reject(new Error('no net'))};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

const good=()=>({e:'🍝',t:'Totally New Dish',c:'Italian',mins:20,cals:400,serves:4,rating:4.6,desc:'A test dish.',
  ing:[{n:'Pasta',amt:'400g',emoji:'🍝',core:true,swaps:[]},
       {n:'Butter',amt:'50g',emoji:'🧈',core:false,swaps:[{n:'Olive oil',amt:'40ml',note:'lighter, less rich'}]}],
  steps:[{t:'Boil',s:'Boil the pasta.',tip:''},{t:'Toss',s:'Toss together.',tip:'Work fast.'}]});

eq('valid recipe accepted',ctx.validateGenerated(good(),'Italian').ok,true);
// Servings are what the stepper scales from. Three generated recipes reached
// the catalogue without them because nothing asked: not the schema, not the
// validator, and not the Add a recipe form either.
eq('a recipe with no servings is refused',
  ctx.validateGenerated(Object.assign(good(),{serves:undefined}),'Italian').why,'bad serves');
eq('nor will it take nonsense',
  ctx.validateGenerated(Object.assign(good(),{serves:0}),'Italian').ok,false);
eq('nor a banquet',
  ctx.validateGenerated(Object.assign(good(),{serves:200}),'Italian').ok,false);
eq('and every recipe in the catalogue has them',
  G('ALL_RECIPES').filter(function(r){return !r.serves}).length,0);
const w=(m,f)=>{const o=good();f(o);const v=ctx.validateGenerated(o,'Italian');return v.ok};
eq('rejects cuisine mismatch',w('',o=>o.c='Thai'),false);
eq('rejects empty ingredients',w('',o=>o.ing=[]),false);
eq('rejects too many ingredients',w('',o=>o.ing=Array(9).fill(good().ing[0])),false);
eq('rejects no steps',w('',o=>o.steps=[]),false);
eq('rejects missing amount',w('',o=>o.ing[0].amt=''),false);
eq('rejects non-core without swaps',w('',o=>o.ing[1].swaps=[]),false);
eq('rejects incomplete swap',w('',o=>o.ing[1].swaps=[{n:'X',amt:'',note:'y'}]),false);
eq('rejects bad mins',w('',o=>o.mins=0),false);
const dupTitle=G('ALL_RECIPES')[0].t;
eq('rejects duplicate title',w('',o=>o.t=dupTitle),false);
eq('rejects case-insensitive duplicate',w('',o=>o.t=dupTitle.toUpperCase()),false);

// emoji safety: the stub reports U+1FAD9 as tofu-width
eq('unsupported emoji replaced',G('safeEmoji')('\u{1FAD9}','🥄'),'🥄');
eq('supported emoji kept',G('safeEmoji')('🍝','🥄'),'🍝');
const norm=ctx.normaliseGenerated(good(),999);
eq('normalise strips empty tip',norm.steps[0].tip,undefined);
eq('normalise keeps real tip',norm.steps[1].tip,'Work fast.');
eq('normalise drops swaps on core',norm.ing[0].swaps,undefined);
eq('normalise keeps swaps on non-core',norm.ing[1].swaps.length,1);
eq('normalise marks as generated',norm.gen,true);

// catalogue growth
const base=G('BASE_RECIPES').length;
eq('catalogue starts at base',G('ALL_RECIPES').length,base);
const id=ctx.nextRecipeId();
// One past the highest id, not one past the count. Those are the same number
// only while the ids run unbroken from 1, which stops being true the first time
// a recipe is removed.
eq('next id is max+1',id,
  G('ALL_RECIPES').reduce(function(m,r){return Math.max(m,r.id)},0)+1);
G('generated').push(ctx.normaliseGenerated(good(),id));
ctx.rebuildCatalogue();
eq('catalogue grew',G('ALL_RECIPES').length,base+1);
eq('generated recipe findable',!!G('ALL_RECIPES').find(r=>r.id===id),true);
eq('appears in its cuisine pool',ctx.pool('Italian').some(r=>r.id===id),true);
eq('duplicate now rejected',ctx.validateGenerated(good(),'Italian').ok,false);

// hiding
const victim=G('BASE_RECIPES')[0].id;
S('shownIds',[victim]);ctx.hideRecipe(victim);
eq('hidden leaves pool',ctx.pool('all').some(r=>r.id===victim),false);
eq('hidden still resolvable by id',!!G('ALL_RECIPES').find(r=>r.id===victim),true);
eq('hidden dropped from favourites',G('favorites').includes(victim),false);
eq('hidden persisted',JSON.parse(store[ctx.pkey('dw_hidden')]).includes(victim),true);
ctx.unhideAll();
eq('unhide restores',ctx.pool('all').some(r=>r.id===victim),true);

// deleting a generated recipe
ctx.deleteGenerated(id);
eq('deleted leaves catalogue',!!G('ALL_RECIPES').find(r=>r.id===id),false);
eq('catalogue back to base',G('ALL_RECIPES').length,base);
eq('deletion persisted',JSON.parse(store[ctx.pkey('dw_generated')]).length,0);

// generate button availability
S('sel',{cuisines:['Italian'],diets:[],efforts:[]});S('mode',null);S('started',true);eq('generate offered for one cuisine',ctx.canGenerate(),true);
S('sel',{cuisines:[],diets:[],efforts:[]});S('mode',null);S('started',false);S('started',true);eq('not offered for all-cuisines',ctx.canGenerate(),false);
S('sel',{cuisines:[],diets:['hh'],efforts:[]});S('mode',null);S('started',true);eq('not offered for a diet category',ctx.canGenerate(),false);
S('mode','pantry');eq('not offered for pantry',ctx.canGenerate(),false);

console.log('-- the file reads the same way to every tool --');
// tools/verify.js reads the catalogue with a regex in the house style: keys
// unquoted, as every hand-written entry has them. The generator used
// JSON.stringify, which quotes them, so three recipes were invisible to the
// verifier and it went on reporting a next free id that was already taken.
{
  const src=require('fs').readFileSync(process.argv[2]||
    require('path').join(__dirname,'..','tabletalk.html'),'utf8');
  const houseStyle=[...src.matchAll(/\{id:(\d+),e:"/g)].length;
  const jsonStyle=[...src.matchAll(/\{"id":\d+,/g)].length;
  eq('no entry is written in the other style',jsonStyle,0);
  eq('and the verifier can see every recipe the app loads',
    houseStyle,G('ALL_RECIPES').filter(function(r){return !r.own&&!r.sharedBy}).length);

  // The workflow counts what was added by grepping the diff for the same
  // shape. It was still looking for the JSON one, so every pull request the
  // scheduled job opened would have been titled "New recipes: 0". Two
  // consumers have now been broken by this format in turn, which is enough to
  // make it something a test holds rather than something someone notices.
  const wf=require('fs').readFileSync(
    require('path').join(__dirname,'..','.github','workflows','recipes.yml'),'utf8');
  const grep=(wf.match(/grep -c '\^\+([^']*)'/)||[])[1];
  eq('the workflow greps for the style the generator writes',
    !!grep&&/\{id:/.test(grep),true);
  eq('and that pattern actually matches a catalogue line',
    grep?new RegExp('^'+grep.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
      .test('  {id:1,e:"x"'):false,true);
}

console.log('-- a recipe that arrived recently says so --');
// The weekly job puts recipes in the catalogue without anyone asking, and the
// first batch arrived completely silently: nothing carried a date, so Monday's
// three were indistinguishable from the original 284. "Unseen" was the nearest
// thing and it is not the same — a recipe from the first commit you have never
// scrolled to looks exactly like one that landed this morning.
{
  // Dates are computed, never written down: a literal would quietly stop being
  // recent and the test would start passing for the wrong reason.
  const daysAgo=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const at=d=>({id:9500,t:'x',added:d});
  const isNew=G('isNew');

  eq('written today is new',isNew(at(daysAgo(0))),true);
  eq('and so is a fortnight ago, just',isNew(at(daysAgo(13))),true);
  eq('but not a day past it',isNew(at(daysAgo(15))),false);
  eq('nor a month',isNew(at(daysAgo(40))),false);
  eq('a recipe with no date is not new',isNew({id:1,t:'x'}),false);
  eq('a future date is a typo, not news',isNew(at(daysAgo(-3))),false);
  eq('and nonsense is not a date',isNew(at('soon')),false);

  // The original catalogue predates the stamp, so absence has to mean "not new"
  // rather than "unknown" — otherwise every recipe shipped would be announced.
  eq('the recipes that shipped are not announced as new',
    G('BASE_RECIPES').filter(function(r){return !r.added}).every(function(r){
      return !isNew(r)}),true);

  const ns=G('newRecipes')();
  eq('there are recipes carrying a date',
    G('ALL_RECIPES').some(function(r){return r.added}),true);          // canary
  eq('newest first',ns.every(function(r,i){
    return i===0||ns[i-1].added>=r.added}),true);
  eq('and every one of them really is new',ns.every(isNew),true);
  // Hiding a recipe takes it out of every list; this one was written by hand
  // and forgot, which is the sort of thing a new pool quietly gets wrong.
  if(ns.length){
    G('hidden').add(ns[0].id);
    eq('a hidden recipe is not offered as new',
      G('newRecipes')().some(function(r){return r.id===ns[0].id}),false);
    G('hidden').delete(ns[0].id);
  }

  eq('they are reachable as their own category',ctx.pool('new').length,ns.length);
  eq('and the count says when, not just how many',
    /added (today|yesterday|\d+ days ago)$/.test(ctx.pickerCount('new')),true);

  // A recipe written in the app carries the day it was written, so the same
  // badge works whether it came from the weekly job or from Marco.
  eq('generating one in the app stamps it too',
    /^\d{4}-\d{2}-\d{2}$/.test(ctx.normaliseGenerated(good(),9600).added),true);
  eq('and it counts as new immediately',isNew(ctx.normaliseGenerated(good(),9601)),true);
}

console.log('-- and the writer puts the date in the file --');
{
  const gen=require('fs').readFileSync(
    require('path').join(__dirname,'..','tools','generate.js'),'utf8');
  eq('entries are written with it',/added:\$\{str\(r\.added/.test(gen),true);
  // verify.js reads the catalogue with a regex that stops at rating, so the
  // field has to sit after it or every recipe becomes invisible to the tool
  // that counts them — which is how three recipes once went missing.
  const src=require('fs').readFileSync(process.argv[2]||
    require('path').join(__dirname,'..','tabletalk.html'),'utf8');
  const seen=[...src.matchAll(/\{id:(\d+),e:"([^"]+)",t:"([^"]+)",c:"([^"]+)",mins:(\d+),cals:(\d+),rating:([\d.]+)/g)];
  eq('and the verifier can still see every recipe',
    seen.length,G('BASE_RECIPES').length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
