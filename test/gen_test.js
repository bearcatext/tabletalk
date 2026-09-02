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

const good=()=>({e:'🍝',t:'Totally New Dish',c:'Italian',mins:20,cals:400,rating:4.6,desc:'A test dish.',
  ing:[{n:'Pasta',amt:'400g',emoji:'🍝',core:true,swaps:[]},
       {n:'Butter',amt:'50g',emoji:'🧈',core:false,swaps:[{n:'Olive oil',amt:'40ml',note:'lighter, less rich'}]}],
  steps:[{t:'Boil',s:'Boil the pasta.',tip:''},{t:'Toss',s:'Toss together.',tip:'Work fast.'}]});

eq('valid recipe accepted',ctx.validateGenerated(good(),'Italian').ok,true);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
