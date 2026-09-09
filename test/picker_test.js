const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const els={};
const stub=id=>els[id]||(els[id]={setAttribute(){},removeAttribute(){},hidden:false,innerHTML:'',className:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){}});
const ctx={localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){}},window:{},console,fetch:()=>Promise.reject()};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};
const row=()=>stub('cuisine-row').innerHTML;

S('sel',{cuisines:[],diets:[],efforts:[]});S('mode',null);S('started',false);S('pickerOpen',true);ctx.renderCuisineRow();
eq('landing shows full grid',/picker-grid/.test(row()),true);
eq('landing has a section per grouping',(row().match(/picker-section/g)||[]).length,5);
eq('one card per cuisine, diet, effort, pantry and add-your-own',
  (row().match(/<button class="pcard/g)||[]).length,
  G('CUISINES').length+G('DIET_CATS').length+G('EFFORT_CATS').length+2);
eq('no collapsed bar on landing',/picker-bar/.test(row()),false);

ctx.selectCuisine('Thai');
eq('selecting collapses picker',G('pickerOpen'),false);
eq('collapsed shows bar',/picker-bar/.test(row()),true);
eq('collapsed hides grid',/picker-grid/.test(row()),false);
eq('bar names the choice',/Thai/.test(row()),true);
eq('bar shows count',new RegExp(ctx.pool('Thai').length+' recipes').test(row()),true);

ctx.togglePicker();
eq('Change reopens grid',/picker-grid/.test(row()),true);
eq('selection preserved',G('sel').cuisines,['Thai']);
eq('active card marked pressed',row().includes('aria-pressed="true"'),true);
eq('exactly one card pressed',(row().match(/aria-pressed="true"/g)||[]).length,1);

S('sel',{cuisines:[],diets:[],efforts:[]});S('mode',null);S('started',false);
eq('cuisine count',ctx.pickerCount('Italian'),ctx.pool('Italian').length+' recipes');
eq('all-cuisines count',ctx.pickerCount('all'),ctx.pool('all').length+' recipes');
eq('diet count mentions swaps',/with a swap/.test(ctx.pickerCount('hh')),true);
eq('empty pantry prompts',ctx.pickerCount('pantry'),'add your ingredients');

const errs=[];
[...G('CUISINES').map(c=>c.id),...G('DIET_CATS').map(c=>c.id),'pantry'].forEach(id=>{
  try{ctx.selectCuisine(id);ctx.renderCuisineRow();ctx.renderCards()}catch(e){errs.push(id+': '+e.message)}
});
eq('all 19 categories selectable',errs,[]);

console.log('-- mobile --');
// 25 stacked cards was 1,200px of buttons before the first recipe. Each group
// is now one strip you swipe sideways; the markup is shared and CSS does the
// switch, so there is no second code path to keep in step.
const css=fs.readFileSync(APP,'utf8').split('<style>')[1].split('</style>')[0];
eq('there is a phone breakpoint',css.indexOf('@media(max-width:700px)')>=0,true);
eq('the grid becomes a swipe strip',css.indexOf('.picker-grid{display:flex;flex-wrap:nowrap')>=0,true);
eq('cards become pills that do not squash',css.indexOf('.pcard{flex:0 0 auto')>=0,true);
eq('touch targets clear 44px',css.indexOf('min-height:44px')>=0,true);
eq('the recipe takes the whole screen',css.indexOf('.detail-panel{position:fixed;inset:0')>=0,true);
eq('and there is a way back',css.indexOf('.dp-back{display:none}')>=0,true);
// earlier tests picked a cuisine, which collapses the picker to its bar
S('pickerOpen',true);ctx.renderCuisineRow();
eq('the strips are named the way people say them',
  ['Regional','Dietary','Effort'].every(function(l){return row().indexOf('>'+l+'<')>=0}),true);
eq('and the old wording is gone',row().indexOf('Browse by')<0,true);
eq('the back button closes the recipe',(function(){
  const r=G('ALL_RECIPES')[0];
  return ctx.detailPanelHtml(r).indexOf('toggleExpand('+r.id+')')>=0;})(),true);
eq('every style brace is closed',(function(){
  let d=0;
  for(const ch of css){if(ch==='{')d++;if(ch==='}')d--;if(d<0)return false}
  return d===0;})(),true);

console.log('-- the picker asks one question --');
const resetSel=()=>{S('sel',{cuisines:[],diets:[],efforts:[]});S('mode',null);
  S('started',false);S('primaryGroup',null)};
const visIn=c=>G('ALL_RECIPES').filter(r=>r.c===c&&!G('hidden').has(r.id)).length;
const dietOkIn=(r,d)=>{const st=ctx.dietStatus(r,d);return st.ok||st.fixable};

resetSel();
ctx.selectCuisine('Mexican');
eq('one tap goes straight to the recipes',G('pickerOpen'),false);
eq('and that is the only thing chosen',G('sel'),{cuisines:['Mexican'],diets:[],efforts:[]});
eq('it remembers which group you chose from',G('primaryGroup'),'cuisines');
ctx.selectCuisine('Thai');
eq('choosing again replaces rather than adds',G('sel').cuisines,['Thai']);
ctx.selectCuisine('vgn');
eq('across groups too',G('sel'),{cuisines:[],diets:['vgn'],efforts:[]});
eq('and the group it came from moves with it',G('primaryGroup'),'diets');

console.log('-- what you narrow by is whatever you did not choose --');
resetSel();
ctx.selectCuisine('Mexican');
eq('choose a region, narrow by diet and effort',ctx.refineGroups(),['diets','efforts']);
ctx.selectCuisine('df');
eq('choose a diet, narrow by region and effort',ctx.refineGroups(),['cuisines','efforts']);
ctx.selectCuisine('quick');
eq('choose an effort, narrow by region and diet',ctx.refineGroups(),['cuisines','diets']);
ctx.selectCuisine('pantry');
eq('a mode has nothing to narrow from',ctx.refineGroups(),[]);

console.log('-- narrowing still combines the way it always did --');
resetSel();
ctx.selectCuisine('Mexican');
const mexAll=visIn('Mexican');
ctx.toggleRefine('df');
eq('the first choice is kept',G('sel').cuisines,['Mexican']);
eq('and the narrowing is added',G('sel').diets,['df']);
const both=ctx.selPool();
eq('it narrows rather than replaces',both.length<mexAll&&both.length>0,true);
eq('every result is still Mexican',both.every(r=>r.c==='Mexican'),true);
eq('and every one is dairy-free or a swap away',both.every(r=>dietOkIn(r,'df')),true);
eq('the label names both',ctx.selLabel(),'Mexican + Dairy');
ctx.toggleRefine('df');
eq('narrowing comes off again',G('sel').diets,[]);
eq('leaving what you chose',ctx.selPool().length,mexAll);

// Regional is still "either" and Dietary still "both", now reached by choosing
// a diet and narrowing by region.
resetSel();
ctx.selectCuisine('vgn');
ctx.toggleRefine('Mexican');ctx.toggleRefine('Thai');
eq('two regions mean either',G('sel').cuisines,['Mexican','Thai']);
eq('and nothing outside them',
  ctx.selPool().every(r=>r.c==='Mexican'||r.c==='Thai'),true);
eq('all of it still vegan',ctx.selPool().every(r=>dietOkIn(r,'vgn')),true);

resetSel();
ctx.selectCuisine('Italian');
ctx.toggleRefine('vgn');
const oneDiet=ctx.selPool().length;
ctx.toggleRefine('gf');
eq('two diets narrow rather than widen',ctx.selPool().length<=oneDiet,true);
eq('and every result satisfies both',
  ctx.selPool().every(r=>dietOkIn(r,'vgn')&&dietOkIn(r,'gf')),true);

resetSel();
ctx.selectCuisine('Thai');ctx.toggleRefine('quick');
eq('effort narrows a region',
  ctx.selPool().every(r=>r.c==='Thai'&&r.mins<=G('QUICK_MINS')),true);

console.log('-- the strip says what it is offering --');
resetSel();
ctx.selectCuisine('Japanese');
{
  const html=ctx.refineStripHtml();
  eq('there is a strip',/refine-scroll/.test(html),true);
  eq('it offers the diets',/toggleRefine\('df'\)/.test(html),true);
  eq('and the efforts',/toggleRefine\('quick'\)/.test(html),true);
  eq('but not the group you chose from',/toggleRefine\('Italian'\)/.test(html),false);
  ctx.toggleRefine('df');
  eq('a live one reads as pressed',/aria-pressed="true"/.test(ctx.refineStripHtml()),true);
}
eq('a dead end is offered but not tappable',(()=>{
  resetSel();
  ctx.selectCuisine('Italian');
  G('DIET_CATS').forEach(c=>{ if(ctx.countWith(c.id)===0) ctx.toggleRefine(c.id) });
  const html=ctx.refineStripHtml();
  return !/rf [a-z ]*none/.test(html)||/disabled/.test(html);
})(),true);
resetSel();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
