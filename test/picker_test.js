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

console.log('-- combining filters --');
const resetSel=()=>{S('sel',{cuisines:[],diets:[],efforts:[]});S('mode',null);S('started',false)};
const visIn=c=>G('ALL_RECIPES').filter(r=>r.c===c&&!G('hidden').has(r.id)).length;
const dietOkIn=(r,d)=>{const st=ctx.dietStatus(r,d);return st.ok||st.fixable};

resetSel();
ctx.selectCuisine('Mexican');
eq('one tap from a clean picker goes to the recipes',G('pickerOpen'),false);
ctx.togglePicker();
ctx.selectCuisine('df');
eq('a second filter keeps the first',G('sel').cuisines,['Mexican']);
eq('and adds its own',G('sel').diets,['df']);
eq('the picker stays open so a third is one tap',G('pickerOpen'),true);

const mexAll=visIn('Mexican'), both=ctx.selPool();
eq('combining narrows rather than replaces',both.length<mexAll,true);
eq('and still leaves something to cook',both.length>0,true);
eq('every result is Mexican',both.every(r=>r.c==='Mexican'),true);
eq('every result is dairy-free or one swap away',both.every(r=>dietOkIn(r,'df')),true);

// Regional is "either" — nothing is both Mexican and Thai, so "both" would
// always be empty.
resetSel();
ctx.selectCuisine('Mexican');ctx.selectCuisine('Thai');
eq('two cuisines mean either',G('sel').cuisines,['Mexican','Thai']);
eq('the pool is their union',ctx.selPool().length,visIn('Mexican')+visIn('Thai'));
eq('and holds nothing outside the two',
  ctx.selPool().every(r=>r.c==='Mexican'||r.c==='Thai'),true);

// Dietary is "both" — returning either would put food on screen that someone
// who tapped both cannot eat.
resetSel();
ctx.selectCuisine('vgn');
const vgnOnly=ctx.selPool().length;
ctx.selectCuisine('gf');
eq('two diets narrow rather than widen',ctx.selPool().length<vgnOnly,true);
eq('every result satisfies both',
  ctx.selPool().every(r=>dietOkIn(r,'vgn')&&dietOkIn(r,'gf')),true);

// effort combines with the rest
resetSel();
ctx.selectCuisine('Thai');ctx.selectCuisine('quick');
eq('effort narrows a cuisine',
  ctx.selPool().every(r=>r.c==='Thai'&&r.mins<=G('QUICK_MINS')),true);

resetSel();
ctx.selectCuisine('Italian');ctx.selectCuisine('Italian');
eq('tapping a lit pill clears it',G('sel').cuisines,[]);

resetSel();
ctx.selectCuisine('Italian');ctx.selectCuisine('all');
eq('all cuisines clears the group',G('sel').cuisines,[]);
eq('but the app knows you have started',ctx.selAny(),true);

// search, pantry and your own bring their own ordering, so they take over
resetSel();
ctx.selectCuisine('Italian');ctx.selectCuisine('pantry');
eq('a mode takes over',G('mode'),'pantry');
eq('and the pills stop reading as lit',ctx.selHas('Italian'),false);

// counts answer "what would I get if I tapped this"
resetSel();
ctx.selectCuisine('Mexican');
eq('a count reflects what is already chosen',ctx.countWith('df'),
  ctx.selPool({cuisines:['Mexican'],diets:['df'],efforts:[]}).length);
eq('a lit pill reports the current total',ctx.countWith('Mexican'),ctx.selPool().length);
eq('a dead end says so rather than showing a number',(()=>{
  resetSel();
  const combo=G('DIET_CATS').map(c=>c.id);
  combo.forEach(d=>ctx.selectCuisine(d));
  return ctx.selPool().length===0?/nothing with these filters/.test(ctx.pickerCount('Italian')):true;
})(),true);

resetSel();
ctx.selectCuisine('Mexican');ctx.selectCuisine('df');
eq('the label names both',ctx.selLabel(),'Mexican + Dairy-free');
resetSel();
eq('nothing selected reads as all cuisines',ctx.selLabel(),'All cuisines');
resetSel();


resetSel();
eq('all cuisines is not lit before you touch anything',ctx.selHas('all'),false);
ctx.selectCuisine('Italian');ctx.selectCuisine('all');
eq('but is once you clear the group yourself',ctx.selHas('all'),true);
resetSel();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
