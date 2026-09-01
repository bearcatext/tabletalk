const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{_c:new Set(),add(c){this._c.add(c)},remove(c){this._c.delete(c)},
    toggle(c,on){on?this._c.add(c):this._c.delete(c)},contains(c){return this._c.has(c)}},
  querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject(),navigator:{}};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s,R=G('ALL_RECIPES');
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':'  got='+JSON.stringify(g)+' want='+JSON.stringify(w)));ok?pass++:fail++};
const sm=ctx.searchMatches;

console.log('-- matching --');
eq('empty query matches nothing',sm(''),[]);
eq('whitespace matches nothing',sm('   '),[]);
eq('nonsense matches nothing',sm('zzzqqq'),[]);
eq('finds by title word',sm('carbonara').length>0,true);
eq('case insensitive',sm('CARBONARA').length,sm('carbonara').length);
eq('finds by cuisine',sm('thai').length>0,true);
eq('finds by ingredient',sm('gochujang').length>0,true);
const chicken=sm('chicken');
eq('common ingredient returns many',chicken.length>5,true);
eq('title matches sort before ingredient-only matches',(function(){
  const isT=chicken.map(r=>/chicken/i.test(r.t));
  const firstNon=isT.indexOf(false), lastT=isT.lastIndexOf(true);
  return firstNon===-1||lastT<firstNon;})(),true);
eq('all terms must match',(function(){
  return sm('chicken thai').every(function(r){
    const hay=(r.t+' '+r.c+' '+r.desc+' '+r.ing.map(i=>i.n).join(' ')).toLowerCase();
    return hay.indexOf('chicken')>=0&&hay.indexOf('thai')>=0;});})(),true);
eq('impossible pair returns none',sm('carbonara gochujang').length,0);
eq('no duplicates in results',(function(){const ids=chicken.map(r=>r.id);return ids.length===new Set(ids).size})(),true);

console.log('-- hidden and own recipes --');
const victim=sm('chicken')[0];
G('hidden').add(victim.id);
eq('hidden recipe drops out',sm('chicken').some(r=>r.id===victim.id),false);
S('searchQuery','chicken');
eq('pool(search) also excludes it',ctx.pool('search').some(r=>r.id===victim.id),false);
G('hidden').delete(victim.id);
eq('unhiding brings it back',sm('chicken').some(r=>r.id===victim.id),true);

ctx.startNewRecipe();
const d=G('draft');
d.t='Zanzibar Pepper Pot';d.c='Tanzanian';d.mins='30';d.cals='420';d.e='X';d.desc='A test dish.';
d.ing[0]={n:'Pilipili peppers',amt:'3',emoji:'X',core:true,swaps:[]};
d.ing[1]={n:'Coconut milk',amt:'200ml',emoji:'X',core:true,swaps:[]};
d.steps[0]={t:'Simmer',s:'Simmer everything gently.',tip:''};
d.steps[1]={t:'Serve',s:'Serve hot with rice.',tip:''};
ctx.saveRecipe();
eq('own recipe findable by title',sm('zanzibar').length,1);
eq('own recipe findable by ingredient',sm('pilipili').length,1);
eq('own recipe findable by cuisine',sm('tanzanian').length,1);

console.log('-- diet and quick filters --');
const sf=ctx.searchFilters;
// assert the fields that matter, not the whole shape, so adding a filter
// later does not break these
eq('plain query has no filters',(function(){const f=sf('chicken');
  return [f.cats,f.quick,f.easy,f.terms]})(),[[],false,false,['chicken']]);
eq('vegan is read as a diet',sf('vegan').cats,['vgn']);
eq('hyphenated diet name',sf('dairy-free').cats,['df']);
eq('spaced diet name is the same',sf('dairy free').cats,sf('dairy-free').cats);
eq('two-word diet name',sf('heart healthy').cats,['hh']);
eq('diet name is removed from the terms',sf('vegan curry').terms,['curry']);
eq('quick is read as a filter',sf('quick').quick,true);
eq('quick plus a term',(function(){const f=sf('quick chicken');
  return [f.cats,f.quick,f.terms]})(),[[],true,['chicken']]);
eq('diet and quick together',(function(){const f=sf('quick vegan');
  return [f.cats,f.quick,f.terms]})(),[['vgn'],true,[]]);
eq('every diet category is recognised',
  G('DIET_CATS').every(c=>sf(c.short).cats.length===1&&sf(c.short).cats[0]===c.id),true);
eq('vegan search returns only vegan food',
  sm('vegan').every(r=>ctx.dietStatus(r,'vgn').ok),true);
eq('vegan search returns a real number of recipes',sm('vegan').length>10,true);
eq('quick search returns only quick food',
  sm('quick').every(r=>r.mins<=G('QUICK_MINS')),true);
eq('quick search finds far more than the word ever would',sm('quick').length>50,true);
eq('combining narrows rather than widens',
  sm('quick vegan').length<=Math.min(sm('quick').length,sm('vegan').length),true);
eq('diet filter respects hidden',(function(){
  const v=sm('vegan')[0];G('hidden').add(v.id);
  const gone=!sm('vegan').some(r=>r.id===v.id);G('hidden').delete(v.id);return gone})(),true);

console.log('-- wiring --');
S('searchQuery','');S('preSearchCuisine',null);
ctx.selectCuisine('Italian');
eq('starts on a cuisine',G('activeCuisine'),'Italian');
ctx.runSearch('chicken');
eq('switches to search',G('activeCuisine'),'search');
eq('remembers where you were',G('preSearchCuisine'),'Italian');
ctx.runSearch('  chicken  ');
eq('query stored trimmed',G('searchQuery'),'chicken');
eq('shows matches, capped',G('shownIds').length,Math.min(sm('chicken').length,G('SEARCH_MAX')));
eq('every shown id is a match',(function(){
  const ids=new Set(sm('chicken').map(r=>r.id));return G('shownIds').every(i=>ids.has(i))})(),true);
eq('pickerCount reports matches',ctx.pickerCount('search'),sm('chicken').length+' matches');

console.log('-- search must not consume the rotation --');
const seenBefore=Object.keys(G('seen')).length;
ctx.runSearch('tomato');
eq('searching marks nothing as seen',Object.keys(G('seen')).length,seenBefore);
ctx.cycleFive();
eq('paging marks nothing as seen',Object.keys(G('seen')).length,seenBefore);

console.log('-- paging --');
S('searchQuery','chicken');S('searchPage',0);
const many=sm('chicken');
eq('enough matches to exercise paging',many.length>G('SEARCH_MAX'),true);
ctx.selectCuisine('search');
const p1=G('shownIds').slice();
ctx.cycleFive();
const p2=G('shownIds').slice();
eq('second page differs from first',JSON.stringify(p1)===JSON.stringify(p2),false);
eq('page index advanced',G('searchPage'),1);

console.log('-- clearing --');
S('preSearchCuisine',null);
ctx.selectCuisine('Italian');
ctx.runSearch('chicken');
ctx.runSearch('');
eq('clearing returns to previous cuisine',G('activeCuisine'),'Italian');
eq('query emptied',G('searchQuery'),'');
eq('memory released',G('preSearchCuisine'),null);

console.log('-- rendering --');
ctx.renderSearchBar();
const bar=stub('search-bar').innerHTML;
eq('input rendered',bar.indexOf('id="search-input"')>=0,true);
eq('calls runSearch on input',bar.indexOf('oninput="runSearch(this.value)"')>=0,true);
eq('clear button present',bar.indexOf('onclick="clearSearch()"')>=0,true);
eq('input carries no value attribute so typing keeps focus',
  /id="search-input"[^>]*\svalue=/.test(bar),false);
ctx.runSearch('carbonara');
ctx.renderCards();
eq('results label names the query',/match(es)? for/.test(stub('results-area').innerHTML),true);
ctx.runSearch('zzzqqq');
ctx.renderCards();
eq('empty state says so',/Nothing matches/.test(stub('results-area').innerHTML),true);

console.log('');
console.log('-- easy means something --');
// Counting ingredients cannot tell you this: 78% of the catalogue has exactly
// five. Technique is what separates a weeknight dish from a fiddly one.
eq('easy is selective',(function(){
  const n=R.filter(function(r){return ctx.isEasy(r)}).length;
  return n>40&&n<R.length*0.45;})(),true);
eq('and rarer than quick',(function(){
  const easy=R.filter(function(r){return ctx.isEasy(r)}).length;
  const quick=R.filter(function(r){return r.mins<=25}).length;
  return easy<quick;})(),true);
eq('a long recipe is never easy',R.filter(function(r){return ctx.isEasy(r)})
  .every(function(r){return r.mins<=G('EASY_MINS')}),true);
eq('nor is a fiddly one',(function(){
  const carb=R.find(function(x){return x.t==='Spaghetti carbonara'});
  return ctx.isEasy(carb);})(),false);
eq('a caramel braise is not easy',(function(){
  const t=R.find(function(x){return x.t==='Thit kho tau'});
  return !t||ctx.isEasy(t)===false;})(),true);
eq('easy is a search filter',ctx.searchFilters('easy').easy,true);
eq('so is simple',ctx.searchFilters('simple').easy,true);
eq('and it is lifted out of the terms',ctx.searchFilters('easy chicken').terms,['chicken']);
eq('searching easy returns only easy recipes',
  ctx.searchMatches('easy').every(function(r){return ctx.isEasy(r)}),true);
eq('and it combines with a diet',(function(){
  const m=ctx.searchMatches('easy vegan');
  return m.length>0&&m.every(function(r){return ctx.isEasy(r)&&ctx.dietStatus(r,'vgn').ok});})(),true);
eq('the badge renders on a card',(function(){
  const e=R.find(function(r){return ctx.isEasy(r)});
  return ctx.recipeCardHtml(e,{}).indexOf('tag te')>=0;})(),true);
eq('and not on one that is not easy',(function(){
  const h=R.find(function(r){return !ctx.isEasy(r)});
  return ctx.recipeCardHtml(h,{}).indexOf('tag te')<0;})(),true);

console.log('-- prep ahead --');
// Two things get called meal prep. This models the one where the finished dish
// does not keep but its components do — cook rice and turkey Sunday, stuff the
// peppers Wednesday.
const sp=R.find(function(r){return r.t==='Stuffed peppers'});
eq('the dish exists',!!sp,true);
eq('some of its steps are do-ahead',ctx.aheadSteps(sp).length,3);
eq('and some are not',ctx.aheadSteps(sp).length<sp.steps.length,true);
eq('the split adds back up',ctx.aheadMins(sp)+ctx.nightMins(sp),sp.mins);
eq('and the night is the shorter half',ctx.nightMins(sp)<sp.mins,true);
eq('a recipe with no ahead steps is not prep-ahead',(function(){
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  return ctx.hasAhead(carb);})(),false);
eq('and neither is one where every step is ahead',(function(){
  const fake={id:9999,mins:30,steps:[{t:'a',s:'x',ahead:true},{t:'b',s:'y',ahead:true}]};
  return ctx.hasAhead(fake);})(),false);
eq('a dish with no ahead steps reports zero',(function(){
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  return ctx.aheadMins(carb);})(),0);
eq('every prep-ahead recipe splits sanely',R.filter(function(r){return ctx.hasAhead(r)})
  .every(function(r){return ctx.aheadMins(r)>0&&ctx.nightMins(r)>0&&ctx.aheadMins(r)<r.mins}),true);

eq('meal prep is a search filter',ctx.searchFilters('meal prep').ahead,true);
eq('so is prep ahead',ctx.searchFilters('prep ahead').ahead,true);
eq('and make ahead',ctx.searchFilters('make ahead').ahead,true);
eq('the phrase is lifted out of the terms',ctx.searchFilters('meal prep chicken').terms,['chicken']);
eq('searching it returns only prep-ahead recipes',(function(){
  const m=ctx.searchMatches('meal prep');
  return m.length>0&&m.every(function(r){return ctx.hasAhead(r)});})(),true);
eq('the badge renders',ctx.recipeCardHtml(sp,{}).indexOf('tag ta')>=0,true);
eq('and not on a dish you cannot prep',(function(){
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  return ctx.recipeCardHtml(carb,{}).indexOf('tag ta')<0;})(),true);
eq('the steps tab labels both halves',(function(){
  const h=ctx.stepsTabHtml(sp);
  return h.indexOf('Do ahead')>=0&&h.indexOf('On the night')>=0;})(),true);
eq('and an ordinary recipe gets no headings',(function(){
  const carb=R.find(function(r){return r.t==='Spaghetti carbonara'});
  return ctx.stepsTabHtml(carb).indexOf('step-group')<0;})(),true);

console.log('-- a pan sauce is not make-ahead --');
// Same step title, opposite answer. Kung pao's sauce is mixed in a bowl and
// keeps; piccata's is built in the pan the chicken just left, on the fond.
// Flagging the second would send someone to make it on Sunday for nothing.
[['Chicken piccata','Make the sauce'],['Saltimbocca alla Romana','Make the sauce'],
 ['Butter chicken (Murgh makhani)','Make sauce'],['Turkey and herb meatballs','Make the sauce']]
  .forEach(function(pair){
    const r=R.find(function(x){return x.t===pair[0]});
    if(!r) return;
    const step=r.steps.find(function(s){return s.t===pair[1]});
    eq(pair[0]+': pan sauce not flagged',!!(step&&step.ahead),false);
  });
eq('but a bowl-mixed sauce is',(function(){
  const r=R.find(function(x){return x.t==='Kung pao chicken'});
  const step=r&&r.steps.find(function(s){return s.t==='Make sauce'});
  return !!(step&&step.ahead);})(),true);
eq('marinating always counts',(function(){
  const r=R.find(function(x){return x.t==='Chicken tikka masala'});
  const step=r&&r.steps.find(function(s){return s.t==='Marinate'});
  return !!(step&&step.ahead);})(),true);
eq('no recipe has every step flagged',R.every(function(r){
  return !r.steps.length||r.steps.filter(function(s){return s.ahead}).length<r.steps.length;}),true);
eq('the last step is never make-ahead',R.every(function(r){
  return !r.steps.length||!r.steps[r.steps.length-1].ahead;}),true);
eq('the category is worth having',R.filter(function(r){return ctx.hasAhead(r)}).length>50,true);

console.log(pass+' passed, '+fail+' failed');
process.exitCode=fail?1:0;
