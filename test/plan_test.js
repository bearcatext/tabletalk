const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={setAttribute(){},removeAttribute(){},hidden:false,id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject(),navigator:{}};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s,R=G('ALL_RECIPES');
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

// amount parsing
const pa=ctx.parseAmount;
eq('parses grams',pa('400g'),{qty:400,unit:'g'});
eq('kg converts to g',pa('1.5kg'),{qty:1500,unit:'g'});
eq('litres convert to ml',pa('1.2 litres'),{qty:1200,unit:'ml'});
eq('parses tbsp',pa('4 tbsp'),{qty:4,unit:'tbsp'});
eq('parses bare count',pa('8'),{qty:8,unit:''});
eq('parses fraction',pa('⅓ cup'),{qty:1/3,unit:'cup'});
eq('rejects freeform',pa('large handful'),null);
eq('rejects unknown unit word',pa('4 medium'),null);

// aggregation
S('plan',new Set());S('pantry',new Set());S('swaps',{});
const a=R.find(r=>r.ing.some(i=>/^400g$/.test(i.amt)));
const b=R.find(r=>r.id!==a.id&&r.ing.some(i=>ctx.normIng(i.n)===ctx.normIng(a.ing.find(x=>/^400g$/.test(x.amt)).n)));
G('plan').add(a.id); if(b) G('plan').add(b.id);
const list=ctx.shoppingList();
eq('list is populated',list.length>0,true);
eq('sorted by name',list.map(i=>i.name).slice().sort((x,y)=>x.localeCompare(y)),list.map(i=>i.name));
eq('each item names its recipes',list.every(i=>i.recipes.length>0),true);

// same-unit amounts are summed
S('plan',new Set());S('pantry',new Set());
const fake=[{id:9001,t:'A',c:'X',mins:1,cals:1,e:'x',desc:'',ing:[{n:'Olive oil',amt:'4 tbsp',emoji:'x',core:true}],steps:[{t:'a',s:'b'}]},
            {id:9002,t:'B',c:'X',mins:1,cals:1,e:'x',desc:'',ing:[{n:'Olive oil',amt:'3 tbsp',emoji:'x',core:true}],steps:[{t:'a',s:'b'}]}];
G('generated').push(...fake);ctx.rebuildCatalogue();
G('plan').add(9001);G('plan').add(9002);
const oil=ctx.shoppingList().find(i=>/olive oil/i.test(i.name));
eq('same units are summed',oil.amount,'7 tbsp');
eq('both recipes credited',oil.recipes.sort(),['A','B']);

// mixed units are listed rather than fudged
G('generated').push({id:9003,t:'C',c:'X',mins:1,cals:1,e:'x',desc:'',ing:[{n:'Olive oil',amt:'a good glug',emoji:'x',core:true}],steps:[{t:'a',s:'b'}]});
ctx.rebuildCatalogue();G('plan').add(9003);
const oil2=ctx.shoppingList().find(i=>/olive oil/i.test(i.name));
eq('unparseable amount preserved verbatim',/a good glug/.test(oil2.amount),true);
eq('summed part still present',/7 tbsp/.test(oil2.amount),true);

// pantry subtraction
G('pantry').add('Olive oil');ctx.clearDietCache();
eq('pantry items are excluded',ctx.shoppingList().some(i=>/olive oil/i.test(i.name)),false);
G('pantry').clear();

// applied swaps are honoured
S('plan',new Set([9001]));
const target=G('ALL_RECIPES').find(r=>r.id===9001);
S('swaps',{'9001-0':{n:'Rapeseed oil',amt:'4 tbsp',note:'x'}});
eq('swap replaces the ingredient',ctx.shoppingList()[0].name,'Rapeseed oil');
S('swaps',{});

// text export
S('plan',new Set([9001,9002]));
const txt=ctx.shoppingListText();
eq('checkbox syntax for Notes/Keep',/^- \[ \] /m.test(txt),true);
eq('names the meals',/For: /.test(txt),true);
eq('states the meal count',/2 meals/.test(txt),true);

// export availability is feature-detected
eq('no share button without the API',G('canShareList')(),false);
ctx.globalThis.navigator.share=()=>Promise.resolve();
eq('share offered when supported',G('canShareList')(),true);
delete ctx.globalThis.navigator.share;

// plan membership
S('plan',new Set());
ctx.togglePlan(1);
eq('adds to plan',ctx.inPlan(1),true);
eq('plan persists',JSON.parse(store[ctx.pkey('dw_plan')]),[1]);
ctx.togglePlan(1);
eq('removes from plan',ctx.inPlan(1),false);
G('plan').add(1);G('plan').add(2);ctx.clearPlan();
eq('clear empties the plan',G('plan').size,0);

console.log('-- one ingredient, one line --');
// Four spellings of the same tin used to produce four shopping-list entries.
const key=n=>ctx.normIng(n);
eq('drained is a prep note, not a different item',key('Black beans, drained'),key('Black beans'));
eq('rinsed likewise',key('Lentils, rinsed'),key('Lentils'));
eq('drained variants collapse',key('Chickpeas, drained'),key('Chickpeas'));
eq('but canned stays distinct on purpose — canned and fresh tomatoes differ',
  key('Canned chickpeas')!==key('Chickpeas'),true);
eq('the catalogue uses a single chickpea name',
  new Set(R.flatMap(r=>r.ing).map(i=>i.n).filter(n=>/chickpea/i.test(n))).size,1);
eq('and a single black bean name',
  new Set(R.flatMap(r=>r.ing).map(i=>i.n).filter(n=>/^black beans/i.test(n))).size,1);
eq('and a single white wine name',
  new Set(R.flatMap(r=>r.ing).map(i=>i.n).filter(n=>/white wine/i.test(n))).size,1);
eq('a plan of chickpea recipes yields one line',(function(){
  G('plan').clear();
  R.filter(r=>r.ing.some(i=>/chickpea/i.test(i.n))).forEach(r=>ctx.togglePlan(r.id));
  return ctx.shoppingList().filter(x=>/chickpea/i.test(x.name)).length;})(),1);
eq('and it sums the tins into a single amount',(function(){
  const amt=ctx.shoppingList().find(x=>/chickpea/i.test(x.name)).amount;
  const p=ctx.parseAmount(amt);
  return !!p&&p.unit==='can'&&p.qty>1&&amt.indexOf('+')<0;})(),true);
eq('swaps offering white wine were left alone',
  R.flatMap(r=>r.ing).flatMap(i=>i.swaps||[]).some(s=>s.n==='White wine'),true);
G('plan').clear();

console.log('-- us equivalents --');
eq('grams gain ounces',ctx.withUS('80g'),'80g (2.8 oz)');
eq('big weights switch to pounds',ctx.withUS('800g'),'800g (1.8 lb)');
eq('kg resolves through grams',ctx.withUS('2kg'),'2kg (4.4 lb)');
eq('ml gains fluid ounces',ctx.withUS('200ml'),'200ml (6.8 fl oz)');
eq('bigger volumes switch to cups',ctx.withUS('300ml'),'300ml (1.3 cups)');
eq('exactly one cup is singular',ctx.withUS('240ml').indexOf('1 cup')>0,true);
eq('spoons are left alone',ctx.withUS('2 tbsp'),'2 tbsp');
eq('counts are left alone',ctx.withUS('3 cloves'),'3 cloves');
eq('cans are left alone',ctx.withUS('2 cans'),'2 cans');
eq('unparseable is returned unchanged',ctx.withUS('large handful'),'large handful');
eq('no volume is ever asserted for a mass',ctx.usEquiv(100,'tbsp'),null);

console.log('-- amounts add up --');
eq('descriptor and count split out',ctx.parseLoose('2 whole'),{qty:2,label:'whole'});
eq('prep after a comma is dropped',ctx.parseLoose('1 large, finely diced'),{qty:1,label:'large'});
eq('fractions parse',ctx.parseLoose('½ large').qty,0.5);
eq('unmeasured text has no count',ctx.parseLoose('large handful').qty,null);
eq('size words are stripped',ctx.looseStem('large'),'');
eq('so large and medium are the same countable thing',ctx.looseStem('medium'),ctx.looseStem('large'));
eq('leading size words come off a noun',ctx.looseStem('large handful'),'handful');
eq('plural and singular share a stem',ctx.looseStem('peppers'),ctx.looseStem('pepper'));
eq('a yolk is an egg when you are buying it',ctx.looseStem('yolks'),'');
eq('so whole and yolks land together',ctx.looseStem('whole'),ctx.looseStem('yolks'));
eq('but a real noun is still a real noun',ctx.looseStem('peppers'),'pepper');
eq('and slices are not sizes',ctx.looseStem('slices'),'slice');

console.log('-- the shopping list gives one number --');
// A shopping list is not a recipe: no line should print the same thing twice.
eq('no line repeats an identical fragment',(function(){
  G('plan').clear();
  R.forEach(r=>ctx.togglePlan(r.id));
  const bad=ctx.shoppingList().filter(function(i){
    const parts=i.amount.split(' + ').map(function(s){return s.trim()});
    return parts.length!==new Set(parts).size;});
  return bad.length;})(),0);
// the US equivalent sits in parentheses and must not count as a second unit
const stripParens=function(s){
  let out='',depth=0;
  for(const ch of s){
    if(ch==='(') depth++;
    else if(ch===')') depth--;
    else if(!depth) out+=ch;
  }
  return out;
};
eq('no volume unit survives beside another volume unit',(function(){
  const V=['tbsp','tsp','cup','ml'];
  return ctx.shoppingList().filter(function(i){
    const parts=stripParens(i.amount).split(' + ');
    const hit=V.filter(function(u){return parts.some(function(p){return p.indexOf(u)>=0})});
    return hit.length>1;}).length;})(),0);
eq('butter folds its spoons into grams',(function(){
  const b=ctx.shoppingList().find(function(i){return ctx.normIng(i.name)==='butter'});
  return !b||(b.amount.indexOf('tbsp')<0&&b.amount.indexOf('tsp')<0);})(),true);
eq('peanut butter is not treated as butter',ctx.normIng('Peanut butter')!=='butter',true);
eq('butter lettuce is not treated as butter',ctx.normIng('Butter lettuce')!=='butter',true);
G('plan').clear();

console.log('-- temperatures give both scales --');
eq('every step naming a temperature names both',(function(){
  const F='°F', C='°C';
  const bad=[];
  R.forEach(function(r){r.steps.forEach(function(s){
    [s.s,s.tip||''].forEach(function(t){
      if((t.indexOf(F)>=0)!==(t.indexOf(C)>=0)) bad.push(r.t);});});});
  return bad;})(),[]);

console.log('-- eggs are eggs --');
eq('yolks and eggs are one shopping line',(function(){
  G('plan').clear();
  ['Quiche Lorraine','Spaghetti carbonara','Caesar salad from scratch','Steak frites with béarnaise']
    .forEach(function(t){const r=R.find(function(x){return x.t===t});if(r)ctx.togglePlan(r.id)});
  return ctx.shoppingList().filter(function(i){return /egg/i.test(i.name)}).length;})(),1);
eq('and they add up to a plain count',(function(){
  const e=ctx.shoppingList().find(function(i){return /egg/i.test(i.name)});
  return e.amount;})(),'15');
eq('compound amounts are summed, not printed',(function(){
  const e=ctx.shoppingList().find(function(i){return /egg/i.test(i.name)});
  return e.amount.indexOf('+')<0&&e.amount.indexOf('yolk')<0;})(),true);
eq('egg noodles are not eggs',ctx.normIng('Egg noodles')!=='egg',true);
eq('aubergine is not eggs',ctx.normIng('Eggplant')!=='egg',true);
eq('century eggs stay their own thing',ctx.normIng('Century eggs')!=='egg',true);
G('plan').clear();

console.log('-- onions name their type --');
eq('no untyped onion is left in the catalogue',
  R.flatMap(function(r){return r.ing}).map(function(i){return i.n})
   .filter(function(n){return /^onions?$/i.test(n)}).length,0);
eq('the four kinds are distinct purchases',(function(){
  const k=['Yellow onion','Red onion','White onion','Spring onions'].map(ctx.normIng);
  return new Set(k).size;})(),4);
eq('yellow is the one the cooked recipes use',(function(){
  return R.flatMap(function(r){return r.ing}).filter(function(i){
    return ctx.normIng(i.n)==='yellow onion'}).length>=25;})(),true);
eq('shallots were not swept in',ctx.normIng('Shallots')!=='yellow onion',true);
eq('spring onions were not swept in',ctx.normIng('Spring onions')!=='yellow onion',true);
eq('swaps offering a plain onion are untouched',(function(){
  return R.flatMap(function(r){return r.ing}).flatMap(function(i){return i.swaps||[]})
    .some(function(s){return /^onions?$/i.test(s.n)});})(),false);

console.log('-- tomatoes name their type --');
eq('no untyped tomato is left in the catalogue',
  R.flatMap(function(r){return r.ing}).map(function(i){return i.n})
   .filter(function(n){return /^(ripe )?tomato(es)?$/i.test(n)}).length,0);
eq('the types are distinct purchases',(function(){
  const keys=['Roma tomatoes','Salad tomatoes','Cherry tomatoes','Canned tomatoes'].map(ctx.normIng);
  return new Set(keys).size;})(),4);
eq('roma tomatoes exist',R.flatMap(function(r){return r.ing}).some(function(i){return i.n==='Roma tomatoes'}),true);
eq('salad tomatoes exist',R.flatMap(function(r){return r.ing}).some(function(i){return i.n==='Salad tomatoes'}),true);
eq('paste and passata were not swept up',
  ['Tomato paste','Tomato passata','Tomato puree','Tomato ketchup'].every(function(n){
    return R.flatMap(function(r){return r.ing}).some(function(i){return i.n===n})}),true);

console.log('-- servings --');
eq('every recipe says how many it serves',R.every(function(r){return r.serves>0}),true);
eq('the catalogue is written for four',R.every(function(r){return ctx.baseServes(r)===4}),true);
// only the leading quantity scales; scaling every number would resize the pack
eq('weights scale',ctx.scaleAmount('400g',2),'800g');
eq('and round to something measurable',ctx.scaleAmount('150g, diced',1.5),'225g, diced');
eq('counts pluralise as they grow',ctx.scaleAmount('1 can (400g)',2),'2 cans (800g)');
eq('and singularise as they shrink',ctx.scaleAmount('2 cans (800g)',0.5),'1 can (400g)');
eq('a bracketed each is left alone',ctx.scaleAmount('2 cans (400ml each)',2),'4 cans (400ml each)');
eq('pack sizes are not resized',ctx.scaleAmount('4 x 150g',1.5),'6 x 150g');
eq('compound fractions read as one number',ctx.scaleAmount('1½ tsp',2),'3 tsp');
eq('and come back as fractions',ctx.scaleAmount('3 cloves',0.5),'1½ cloves');
eq('both halves of a compound amount scale',ctx.scaleAmount('4 yolks + 1 whole egg',2),'8 yolks + 2 whole egg');
eq('seasoning is never scaled',ctx.scaleAmount('to taste',4),'to taste');
eq('nor is a handful',ctx.scaleAmount('large handful',3),'large handful');
eq('scaling by one changes nothing',ctx.scaleAmount('400g',1),'400g');

eq('the shopping list buys for the servings you set',(function(){
  const carb=R.find(function(x){return x.t==='Spaghetti carbonara'});
  G('plan').clear();ctx.togglePlan(carb.id);
  const at4=ctx.shoppingList().find(function(i){return /spaghetti/i.test(i.name)}).amount;
  ctx.setServes(carb.id,8);
  const at8=ctx.shoppingList().find(function(i){return /spaghetti/i.test(i.name)}).amount;
  ctx.setServes(carb.id,4);
  return [at4.indexOf('400g')===0,at8.indexOf('800g')===0];})(),[true,true]);
eq('resetting to the base clears the override',(function(){
  const carb=R.find(function(x){return x.t==='Spaghetti carbonara'});
  ctx.setServes(carb.id,6);const set=G('serveCount')[carb.id];
  ctx.setServes(carb.id,4);return [set,G('serveCount')[carb.id]];})(),[6,undefined]);
eq('servings clamp to the allowed range',(function(){
  const r=R[0];ctx.setServes(r.id,99);const hi=ctx.servesOf(r);
  ctx.setServes(r.id,-5);const lo=ctx.servesOf(r);ctx.setServes(r.id,4);
  return [hi,lo];})(),[G('SERVES_MAX'),G('SERVES_MIN')]);
G('plan').clear();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
