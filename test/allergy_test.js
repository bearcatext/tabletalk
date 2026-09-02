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
const off=()=>{S('allergyMode',false);ctx.clearDietCache()};
const on =()=>{S('allergyMode',true); ctx.clearDietCache()};

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
