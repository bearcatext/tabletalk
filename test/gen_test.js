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
  window:{},console:{log(){},warn(){},error(){}},fetch:()=>Promise.reject(new Error('no net'))};
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
eq('next id is max+1',id,base+1);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
