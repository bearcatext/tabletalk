const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={setAttribute(){},removeAttribute(){},hidden:false,id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){}});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject()};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s,R=G('ALL_RECIPES');
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};
// strictness lives per category now, not in one global flag
const STRICT={df:'strict',gf:'strict',nf:'strict',vgn:'strict',veg:'strict'};
const off=()=>{S('dietTier',{});ctx.clearDietCache()};
const on =()=>{S('dietTier',Object.assign({},STRICT));ctx.clearDietCache()};

// hard fixes: these are made with dairy, not "may contain"
off();
eq('brioche is hard dairy',ctx.violates('df','Brioche buns'),true);
eq('ranch dressing is hard dairy',ctx.violates('df','Ranch dressing'),true);
eq('brioche not merely uncertain',ctx.mayContain('df','Brioche buns'),false);

// the uncertain tier
eq('panko uncertain',ctx.mayContain('df','Panko breadcrumbs'),true);
eq('flour tortilla uncertain',ctx.mayContain('df','Small flour tortillas'),true);
eq('corn tortilla NOT uncertain',ctx.mayContain('df','Corn tortillas'),false);
eq('lean bread NOT uncertain',ctx.mayContain('df','Rustic sourdough'),false);
eq('vegetable stock NOT a veg risk',ctx.mayContain('veg','Vegetable stock'),false);
eq('stock cube is a gluten risk',ctx.mayContain('gf','Chicken stock'),true);

// preference mode: uncertain ingredients still qualify, but are surfaced
eq('preference mode ignores uncertainty',ctx.violates('df','Panko breadcrumbs'),false);
const risky=R.find(r=>ctx.dietStatus(r,'df').ok&&ctx.riskyIngredients(r,'df').length);
eq('a dairy-free recipe carries a label warning',!!risky,true);
S('sel',{cuisines:[],diets:['df'],efforts:[]});S('mode',null);S('started',true);
eq('warning names the ingredient',ctx.dietHintHtml(risky).includes(ctx.riskyIngredients(risky,'df')[0]),true);
eq('warning is styled as a caution',/diet-hint warn/.test(ctx.dietHintHtml(risky)),true);

// allergy mode: uncertainty counts against
on();
eq('allergy mode rejects uncertain',ctx.violates('df','Panko breadcrumbs'),true);
eq('allergy mode still accepts corn tortillas',ctx.violates('df','Corn tortillas'),false);
eq('no label warning in allergy mode',!/diet-hint warn/.test(ctx.dietHintHtml(risky)),true);
const dfOn=R.filter(r=>ctx.dietStatus(r,'df').ok).length;
off();
const dfOff=R.filter(r=>ctx.dietStatus(r,'df').ok).length;
eq('allergy mode is stricter',dfOn<dfOff,true);

// a recipe with a safe swap is demoted, not hidden
on();
const tacos=R.find(r=>r.t==='Corn and black bean tacos');
const st=ctx.dietStatus(tacos,'df');
eq('demoted rather than excluded',{ok:st.ok,fixable:st.fixable},{ok:false,fixable:true});
eq('still reachable in the pool',ctx.pool('df').some(r=>r.id===tacos.id),true);
const idx=tacos.ing.findIndex(i=>/flour tortilla/i.test(i.n));
const safe=tacos.ing[idx].swaps.findIndex(s=>!ctx.violates('df',s.n));
eq('offers a genuinely safe swap',tacos.ing[idx].swaps[safe].n,'Corn tortillas');
off();

// toggle persists and re-runs the classifier
eq('starts off',G('allergyMode'),false);
ctx.toggleAllergyMode();
eq('toggles on',G('allergyMode'),true);
eq('persisted',JSON.parse(store[ctx.pkey('dw_allergy')]),true);
ctx.toggleAllergyMode();
eq('toggles back',G('allergyMode'),false);


console.log('-- lactose is not milk protein --');
off();
// Butter and ghee are nearly all fat; a hard cheese loses its lactose to the
// ageing. All are usually fine lactose intolerant, none are safe milk allergic.
[['Butter',false],['Ghee',false],['Parmesan',false],['Aged cheddar',false],
 ['Pecorino',false],['Gruyere',false]].forEach(function(p){
  eq('lactose-free keeps '+p[0],ctx.violatesBase('lac',p[0]),p[1]);
  eq('dairy-free still excludes '+p[0],ctx.violatesBase('df',p[0]),true);
});
[['Milk',true],['Double cream',true],['Greek yoghurt',true],['Buttermilk',true],
 ['Ricotta',true],['Mascarpone',true],['Creme fraiche',true]].forEach(function(p){
  eq('lactose-free excludes '+p[0],ctx.violatesBase('lac',p[0]),p[1]);
});
eq('plant milks are not dairy at all',ctx.violatesBase('lac','Coconut milk'),false);
eq('peanut butter is not butter',ctx.violatesBase('lac','Peanut butter'),false);
eq('buttermilk is not butter',ctx.violatesBase('lac','Buttermilk'),true);
eq('a vegan still avoids every dairy',ctx.violatesBase('vgn','Parmesan'),true);
eq('and butter',ctx.violatesBase('vgn','Butter'),true);

console.log('-- lactose-free is a wider catalogue than dairy-free --');
{
  const lac=R.filter(function(r){return ctx.dietStatus(r,'lac').ok}).length;
  const df =R.filter(function(r){return ctx.dietStatus(r,'df').ok}).length;
  eq('and it is genuinely wider',lac>df,true);
  eq('every dairy-free recipe is also lactose-free',
    R.filter(function(r){return ctx.dietStatus(r,'df').ok})
     .every(function(r){return ctx.dietStatus(r,'lac').ok}),true);
}

console.log('-- strictness is per category --');
off();
S('dietTier',{gf:'strict'});ctx.clearDietCache();
eq('the strict category tightens',ctx.violates('gf','Oats'),true);
eq('an untouched one does not',ctx.violates('df','Chocolate'),false);
eq('tierOf reports each separately',[ctx.tierOf('gf'),ctx.tierOf('df')],['strict','avoid']);
S('dietTier',{df:'strict'});ctx.clearDietCache();
eq('the other way round too',ctx.violates('df','Chocolate'),true);
eq('and gluten relaxes',ctx.violates('gf','Oats'),false);
off();

console.log('-- only some categories have a second level --');
eq('dairy does',G('hasTiers')('df'),true);
eq('gluten does',G('hasTiers')('gf'),true);
eq('nuts do',G('hasTiers')('nf'),true);
eq('vegan does, for rennet and fish sauce',G('hasTiers')('vgn'),true);
eq('heart healthy has nothing uncertain to tighten',G('hasTiers')('hh'),false);
eq('nor does lactose-free',G('hasTiers')('lac'),false);
eq('an allergen is named as one',ctx.tierLabel('gf'),'Allergy');
eq('vegan is not called an allergy',ctx.tierLabel('vgn'),'Strict');
eq('a category without tiers renders no control',ctx.tierRowHtml('hh'),'');
eq('one with tiers does',/tier-seg/.test(ctx.tierRowHtml('df')),true);

console.log('-- the strictness a recipe was judged at is not cached over --');
off();
{
  // find a recipe the two levels actually disagree about rather than assuming
  // one exists: a stale cache would make every verdict identical
  const okLoose=R.filter(function(r){return ctx.dietStatus(r,'gf').ok});
  S('dietTier',{gf:'strict'});ctx.clearDietCache();
  const demoted=okLoose.filter(function(r){return !ctx.dietStatus(r,'gf').ok});
  eq('tightening demotes some recipes',demoted.length>0,true);
  off();
  eq('and relaxing brings them all back',
    demoted.every(function(r){return ctx.dietStatus(r,'gf').ok}),true);
}

console.log('-- carrying over the old single switch --');
{
  const fresh=require('child_process');
  eq('a saved allergy setting becomes strict everywhere',(function(){
    S('allergyMode',true);S('dietTier',{});
    ctx.toggleAllergyMode();          // off
    ctx.toggleAllergyMode();          // on again, seeding every tier
    return G('TIERED_CATS').every(function(c){return ctx.tierOf(c)==='strict'});
  })(),true);
  off();S('allergyMode',false);
}

console.log('-- pasta is wheat whatever it is called --');
// Naming a few shapes let rigatoni, ziti, lasagne sheets and gnocchi through,
// and three wheat dishes were being offered to coeliacs as gluten-free.
['Rigatoncini','Rigatoni','Ziti','Lasagne sheets','Gnocchi','Potato gnocchi',
 'Bucatini','Tagliatelle','Fettuccine','Orecchiette','Farfalle','Fusilli',
 'Pappardelle','Paccheri','Trofie','Conchiglie','Cannelloni','Ravioli',
 'Tortellini','Spaghetti','Penne rigate','Linguine','Ditalini','Elbow macaroni'
].forEach(function(n){
  eq(n+' counts as gluten',ctx.violatesBase('gf',n),true);
});
eq('but gluten-free pasta does not',ctx.violatesBase('gf','Gluten-free penne'),false);
eq('nor rice noodles',ctx.violatesBase('gf','Rice noodles'),false);

console.log('-- no pasta dish is offered as gluten-free --');
{
  const SHAPES=/(spaghetti|linguine|penne|rigatoni|rigatoncini|bucatini|tagliatelle|fettuccine|orecchiette|farfalle|fusilli|pappardelle|macaroni|ziti|paccheri|casarecce|trofie|ditalini|orzo|lasagne|lasagna|gnocchi|tagliolini|tonnarelli|cavatelli|gemelli|conchiglie)/i;
  const wheat=R.filter(function(r){
    return r.ing.some(function(i){return SHAPES.test(i.n)&&!/gluten-free/i.test(i.n)})});
  eq('there are wheat pasta dishes to check',wheat.length>5,true);
  eq('and not one of them passes as gluten-free',
    wheat.filter(function(r){return ctx.dietStatus(r,'gf').ok}).map(function(r){return r.t}),[]);
}

console.log('-- the dairy and lactose lists agree with each other --');
// Grana Padano and Manchego sat in the low-lactose list without ever being in
// the dairy one, so nothing asked whether they were dairy at all.
['Grana Padano','Manchego','Gouda','Asiago','Taleggio','Gorgonzola','Stilton',
 'Roquefort','Raclette','Quark','Kefir','Parmigiano Reggiano','Pecorino Romano'
].forEach(function(n){
  eq(n+' counts as dairy',ctx.violatesBase('df',n),true);
});
eq('every low-lactose cheese is recognised as dairy first',(function(){
  return ['Butter','Ghee','Parmesan','Pecorino','Grana Padano','Cheddar','Gruyere',
          'Comte','Emmental','Manchego','Provolone','Cotija','Gouda','Asiago']
    .every(function(n){return ctx.violatesBase('df',n)&&!ctx.violatesBase('lac',n)});
})(),true);

console.log('-- a wheat ingredient is offered a way out --');
// 97 recipes were shut out of gluten-free with no route back. Soy sauce alone
// blocked 30, and tamari is a straight one-for-one. The substitutes existed in
// the world; what was missing was the offer on the ingredient.
[['Soy sauce','Tamari'],['Dark soy sauce','Tamari'],['Gochujang','Gluten-free gochujang'],
 ['Spaghetti','Gluten-free spaghetti'],['Rigatoncini','Gluten-free rigatoncini'],
 ['Potato gnocchi','Gluten-free potato gnocchi'],['Panko breadcrumbs','Gluten-free panko'],
 ['Plain flour','Gluten-free plain flour'],['Oyster sauce','Gluten-free oyster sauce']
].forEach(function(p){
  const sub=ctx.glutenFreeSub(p[0]);
  eq(p[0]+' is offered '+p[1],sub&&sub.n,p[1]);
});
eq('something already gluten-free is offered nothing',ctx.glutenFreeSub('Rice noodles'),null);
eq('nor is a plain vegetable',ctx.glutenFreeSub('Carrot'),null);

console.log('-- every substitute is actually gluten-free --');
{
  const bad=[];
  R.forEach(function(r){r.ing.forEach(function(i){
    (i.swaps||[]).forEach(function(sw){
      if(/gluten-free|tamari|rice noodle|rice vermicelli|buckwheat soba|corn tortilla|quinoa/i.test(sw.n)
         && ctx.violatesBase('gf',sw.n)) bad.push(r.t+': '+sw.n);
    })})});
  eq('no substitute is itself made of wheat',bad,[]);
}

console.log('-- the amount carries over --');
{
  const off=[];
  R.forEach(function(r){r.ing.forEach(function(i){
    if(!ctx.violatesBase('gf',i.n)) return;
    (i.swaps||[]).forEach(function(sw){
      if(/^Gluten-free|^Tamari$|^Rice noodles$/.test(sw.n)&&sw.amt!==i.amt&&!/penne|rolls/i.test(sw.n))
        off.push(r.t+': '+i.n+' '+i.amt+' -> '+sw.n+' '+sw.amt);
    })})});
  eq('a like-for-like swap keeps the same quantity',off.slice(0,3),[]);
}

console.log('-- how much of the catalogue a coeliac can reach --');
{
  const ok=R.filter(function(r){return ctx.dietStatus(r,'gf').ok}).length;
  const fixable=R.filter(function(r){return ctx.dietStatus(r,'gf').fixable}).length;
  const shut=R.length-ok-fixable;
  eq('most of it is reachable one way or another',ok+fixable>R.length*0.9,true);
  eq('and very little is shut out',shut<25,true);
  eq('the sums add up',ok+fixable+shut,R.length);
}

console.log('-- what stays shut out, stays shut out honestly --');
// A gluten-free dumpling wrapper is not a dumpling wrapper, and seitan is
// gluten by definition. These are not offered a substitute that would quietly
// turn the dish into something else.
['Wonton wrappers','Gyoza wrappers','Dumpling wrappers','Seitan','Phyllo pastry']
  .forEach(function(n){
    eq('no pretend substitute for '+n,ctx.glutenFreeSub(n),null);
  });

console.log('-- a core ingredient can still be swapped --');
// status() has always counted swaps on core ingredients toward fixable, but the
// screen rendered core as a dead row, so it could promise a fix it would not
// let you make.
{
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  const pasta=carb.ing[carb.ing.findIndex(function(i){return /spaghetti/i.test(i.n)})];
  eq('the pasta is still core',pasta.core,true);
  eq('and it has a way out',(pasta.swaps||[]).length>0,true);
  S('openSwap',{rid:carb.id,idx:carb.ing.indexOf(pasta)});
  const h=ctx.ingTabHtml(carb);
  eq('the row is offered as swappable',/ing-row swappable/.test(h),true);
  eq('the substitute is on screen',/Gluten-free spaghetti/.test(h),true);
  eq('and there is a button to apply it',/applySwap\(/.test(h),true);
  S('openSwap',{});
}
{
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  eq('so carbonara is one swap from gluten-free',ctx.dietStatus(carb,'gf').fixable,true);
  eq('but never claimed to be gluten-free as written',ctx.dietStatus(carb,'gf').ok,false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
