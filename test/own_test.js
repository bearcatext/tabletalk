const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject(),navigator:{}};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

// ── swap suggestions mined from the existing catalogue ──
const sug=ctx.suggestSwaps;
eq('suggests swaps for butter',sug('Butter').length>0,true);
eq('suggestions carry an amount',sug('Butter').every(s=>s.n&&s.amt&&s.note),true);
eq('olive oil is offered for butter',sug('Butter').some(s=>/olive oil/i.test(s.n)),true);
eq('matches a longer phrasing',sug('Chicken thighs, diced').length>0,true);
eq('unknown ingredient yields none',sug('Zzzzz nonsense'),[]);
eq('corpus is capped per ingredient',sug('Chicken thighs').length<=6,true);

// ── validation ──
const base=G('BASE_RECIPES').length;
const fill=()=>{ctx.startNewRecipe();
  const d=G('draft');
  d.t='My Test Bake';d.c='Italian';d.mins='25';d.cals='400';d.e='🥧';d.desc='A test.';
  d.ing[0]={n:'Flour',amt:'250g',emoji:'🌾',core:true,swaps:[]};
  d.ing[1]={n:'Butter',amt:'100g',emoji:'🧈',core:false,swaps:[{n:'Olive oil',amt:'75ml',note:'lighter'}]};
  d.steps[0]={t:'Mix',s:'Mix it all together.',tip:''};
  d.steps[1]={t:'Bake',s:'Bake for 20 minutes.',tip:'Watch the edges.'};
  return d;};
const err=()=>G('draftError');

fill();G('draft').t='';ctx.saveRecipe();
eq('rejects a missing name',/name/i.test(err()),true);
fill();G('draft').c='';ctx.saveRecipe();
eq('rejects a missing cuisine',/cuisine/i.test(err()),true);
fill();G('draft').mins='abc';ctx.saveRecipe();
eq('rejects bad minutes',/minutes/i.test(err()),true);
fill();G('draft').ing=[{n:'',amt:'',emoji:'x',core:true,swaps:[]}];ctx.saveRecipe();
eq('rejects no ingredients',/ingredient/i.test(err()),true);
fill();G('draft').steps=[{t:'',s:'',tip:''}];ctx.saveRecipe();
eq('rejects no steps',/step/i.test(err()),true);
fill();G('draft').t=G('BASE_RECIPES')[0].t;ctx.saveRecipe();
eq('rejects a duplicate name',/already have/i.test(err()),true);

// ── a good save ──
fill();ctx.saveRecipe();
eq('saved without error',err(),null);
eq('catalogue grew by one',G('ALL_RECIPES').length,base+1);
const mine=G('ownRecipes')();
eq('one own recipe',mine.length,1);
const r=mine[0];
eq('marked as own',r.own,true);
eq('not marked as generated',r.gen,undefined);
eq('title kept',r.t,'My Test Bake');
eq('numbers coerced',[r.mins,r.cals],[25,400]);
eq('core ingredient has no swaps',r.ing[0].swaps,undefined);
eq('swappable ingredient keeps them',r.ing[1].swaps.length,1);
eq('empty tip stripped',r.steps[0].tip,undefined);
eq('real tip kept',r.steps[1].tip,'Watch the edges.');
eq('persisted',JSON.parse(store['dw_generated']).some(x=>x.t==='My Test Bake'),true);

// ── findability ──
eq('appears in its cuisine',ctx.pool('Italian').some(x=>x.id===r.id),true);
eq('appears under My recipes',ctx.pool('mine').some(x=>x.id===r.id),true);
eq('classified for diets automatically',typeof ctx.dietStatus(r,'df').ok,'boolean');
eq('reachable by Marco',G('marcoCatalogue')().includes('My Test Bake'),true);
eq('picker counts it',ctx.pickerCount('mine'),'1 recipe');

// ── an ingredient with no usable swaps just becomes core ──
fill();G('draft').t='No Swap Dish';
G('draft').ing[1]={n:'Sugar',amt:'50g',emoji:'🍯',core:false,swaps:[{n:'',amt:'',note:''}]};
ctx.saveRecipe();
eq('blank swaps do not block saving',err(),null);
eq('it became core instead',G('ownRecipes')().find(x=>x.t==='No Swap Dish').ing[1].core,true);

// ── editing ──
const target=G('ownRecipes')().find(x=>x.t==='My Test Bake');
ctx.editRecipe(target.id);
eq('draft loaded for editing',G('draft').t,'My Test Bake');
eq('editing id set',G('editingId'),target.id);
G('draft').mins='40';ctx.saveRecipe();
eq('edit saved',err(),null);
eq('edit did not duplicate',G('ownRecipes')().filter(x=>x.t==='My Test Bake').length,1);
eq('edit applied',G('ownRecipes')().find(x=>x.t==='My Test Bake').mins,40);
eq('id preserved',G('ownRecipes')().find(x=>x.t==='My Test Bake').id,target.id);

// ── delete ──
ctx.deleteGenerated(target.id);
eq('deleted',G('ownRecipes')().some(x=>x.id===target.id),false);

// ── the rendered form ──
ctx.startNewRecipe();
G('draft').ing[0].n='Butter';
G('draft').ing[1].n='Chicken thighs';
ctx.renderBuilder();
const html=stub('build-body').innerHTML;
eq('form renders inputs',(html.match(/class="bld-in/g)||[]).length>8,true);
eq('has a name field',/placeholder="Recipe name"/.test(html),true);
eq('cuisine list offered',/id="cuisine-list"/.test(html),true);
eq('ingredient rows rendered',(html.match(/placeholder="Ingredient"/g)||[]).length,2);
eq('step rows rendered',(html.match(/placeholder="Step title"/g)||[]).length,2);
eq('offers corpus swap chips',/sugg-chip/.test(html),true);
eq('chips name a real alternative',/Olive oil/.test(html),true);
eq('save and cancel present',/saveRecipe\(\)/.test(html)&&/cancelBuild\(\)/.test(html),true);
ctx.addIng();
eq('add ingredient grows the form',G('draft').ing.length,3);
ctx.removeIng(2);
eq('remove ingredient shrinks it',G('draft').ing.length,2);
ctx.addStep();
eq('add step grows the form',G('draft').steps.length,3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
