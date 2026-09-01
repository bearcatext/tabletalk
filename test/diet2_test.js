const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const els={};
const stub=id=>els[id]||(els[id]={id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){}});
const ctx={localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject()};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s,R=G('ALL_RECIPES'),lp=G('leanProtein');
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

// ── heart healthy leads with lean protein but does not demand it ──
// A vegetable dish can be heart healthy. Requiring a protein shut out 45
// recipes and left the category monotonous.
const hh=R.filter(r=>ctx.dietStatus(r,'hh').ok);
eq('a dish without a protein is allowed in',ctx.dietStatus(R.find(r=>r.t==='Bruschetta al pomodoro'),'hh').ok,true);
eq('the category carries a mix of proteins',(function(){
  const kinds=new Set(hh.map(function(r){return lp(r)||'none'}));
  return kinds.size>=4;})(),true);
eq('and plenty without one',hh.filter(function(r){return !lp(r)}).length>10,true);
// the rules that do still block
eq('red meat is still out',ctx.dietStatus(R.find(r=>r.t==='Chili con carne'),'hh').ok,false);
eq('and so is anything over the calorie cap',hh.every(function(r){return r.cals<=G('HH_CALORIE_CAP')}),true);

// seasonings must not count as the protein
const seasoningOnly={id:9001,t:'x',c:'Thai',mins:10,cals:200,ing:[{n:'Fish sauce',amt:'2 tbsp'},{n:'Rice',amt:'200g'}],steps:[{t:'a',s:'b'}]};
eq('fish sauce alone is not fish',lp(seasoningOnly),null);
eq('chicken stock alone is not poultry',lp({ing:[{n:'Chicken stock',amt:'1l'},{n:'Rice',amt:'200g'}]}),null);
eq('real fish still detected',lp({ing:[{n:'Salmon fillets',amt:'4'}]}),'fish');
eq('real chicken still detected',lp({ing:[{n:'Chicken thighs',amt:'800g'}]}),'poultry');
eq('legumes count as plant protein',lp({ing:[{n:'Red lentils',amt:'300g'}]}),'plant');

// ── ordering: fish and poultry lead ──
const order=ctx.pool('hh').filter(r=>ctx.dietStatus(r,'hh').ok).map(lp);
const rank={fish:0,poultry:1,plant:2,egg:3};
const rk=p=>rank[p]!==undefined?rank[p]:9;
eq('ranked fish, poultry, plant, egg, then the rest',order.every((p,i)=>i===0||rk(order[i-1])<=rk(p)),true);
eq('proteinless dishes sort to the back',rk(order[order.length-1]),9);
eq('first heart-healthy recipe is fish',order[0],'fish');

// ── the swap hint ──
S('activeCuisine','df');
const fixable=R.find(r=>{const s=ctx.dietStatus(r,'df');return s.fixable&&s.swapsNeeded===1});
const hint=ctx.dietHintHtml(fixable);
const blocker=fixable.ing.find((ing,i)=>ctx.violates('df',ing.n));
eq('hint names the blocking ingredient',hint.includes(blocker.n),true);
const rescue=blocker.swaps.find(s=>!ctx.violates('df',s.n));
eq('hint names the substitute',hint.includes(rescue.n),true);
eq('hint gives the substitute amount',hint.includes(rescue.amt),true);
eq('hint offers a one-click apply',/applySwap\(/.test(hint),true);

// applying it flips the verdict
const idx=fixable.ing.findIndex(i=>ctx.violates('df',i.n));
const opt=fixable.ing[idx].swaps.findIndex(s=>!ctx.violates('df',s.n));
ctx.applySwap(fixable.id,idx,opt);
eq('after applying, recipe qualifies',ctx.dietStatus(fixable,'df').ok,true);
eq('hint switches to confirmation',/diet-hint ok/.test(ctx.dietHintHtml(fixable)),true);
ctx.applySwap(fixable.id,idx,null);

// blocked-with-no-swap explains itself
const blocked=R.find(r=>{const s=ctx.dietStatus(r,'df');return !s.ok&&!s.fixable});
eq('unfixable recipe says why',/diet-hint no/.test(ctx.dietHintHtml(blocked)),true);
// no hint outside a diet category
S('activeCuisine','Italian');
eq('no hint when browsing a cuisine',ctx.dietHintHtml(fixable),'');

console.log('-- names that read as animal but are not --');
// An oyster mushroom is a fungus and a beefsteak tomato is a tomato. Both were
// being counted as meat, which quietly emptied the vegetarian category.
eq('oyster mushrooms are vegetarian',ctx.violates('veg','Oyster mushrooms'),false);
eq('and vegan',ctx.violates('vgn','Oyster mushrooms'),false);
eq('king oyster too',ctx.violates('veg','King oyster mushrooms'),false);
eq('beefsteak tomato is a tomato',ctx.violates('veg','Beefsteak tomatoes'),false);
eq('vegan worcestershire is vegetarian',ctx.violates('veg','Vegan Worcestershire sauce'),false);
eq('a duck egg is vegetarian',ctx.violates('veg','Salted duck egg'),false);
eq('but not vegan',ctx.violates('vgn','Salted duck egg'),true);
// the exceptions must not punch a hole in the real checks
eq('actual oysters still blocked',ctx.violates('veg','Oysters'),true);
eq('oyster sauce still blocked',ctx.violates('veg','Oyster sauce'),true);
eq('ordinary worcestershire still blocked',ctx.violates('veg','Worcestershire sauce'),true);
eq('duck breast still blocked',ctx.violates('veg','Duck breast'),true);
eq('beef still blocked',ctx.violates('veg','Beef sirloin'),true);

console.log('-- rice noodles are not wheat --');
eq('rice vermicelli is gluten free',ctx.violates('gf','Rice vermicelli'),false);
eq('rice sticks too',ctx.violates('gf','Rice stick noodles'),false);
eq('flat rice noodles too',ctx.violates('gf','Flat rice noodles'),false);
eq('but wheat vermicelli is not',ctx.violates('gf','Vermicelli'),true);
eq('and egg noodles are not',ctx.violates('gf','Egg noodles'),true);
eq('soy sauce still carries wheat',ctx.violates('gf','Soy sauce'),true);

console.log('-- no diet category is empty for any cuisine --');
eq('every cuisine and diet pair has at least one recipe',(function(){
  const empty=[];
  const cuisines=Array.from(new Set(R.map(function(r){return r.c})));
  cuisines.forEach(function(c){
    G('DIET_CATS').forEach(function(d){
      const n=R.filter(function(r){return r.c===c&&ctx.dietStatus(r,d.id).ok}).length;
      if(!n) empty.push(c+'+'+d.label);
    });
  });
  return empty;})(),[]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
