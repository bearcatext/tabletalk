// Checks every pasta dish against Evan Funke's four rules.
//
//   1. Salt the water     until it tastes like mild seawater — it seasons the
//                         pasta from the inside out, and it is the only chance.
//   2. Ditch the cream    a traditional sauce binds on the starch coming off
//                         the pasta, not on dairy fat.
//   3. Work the starch    tossing or stirring hard is what pulls it out and
//                         turns fat and liquid into an emulsion.
//   4. Stop it short      it keeps cooking after you stop, so pull it early.
//
// Run: node tools/pasta.js [build.html]
//
// The rules are universal. What changes between dishes is the mechanism, not
// whether they apply:
//
//   "the water"     is whatever liquid the pasta cooks in — a pot of water, the
//                   broth of a pasta e fagioli, or the ragu and bechamel that a
//                   dry lasagne sheet swells into.
//   "stop it short" is satisfied by finishing in a pan, by resting off the heat,
//                   or by going into an oven still chalky.
//
// An earlier version of this file exempted the one-pot dishes and lasagne from
// three of the four. That was wrong, and it was hiding real defects: pasta e
// ceci cooked its pasta in 800ml of unseasoned water, and neither lasagne sauce
// was ever salted. There are no exemptions here.
const fs=require('fs'),vm=require('vm'),path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const code=html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]+"\n;globalThis.__g=n=>eval(n);";
const els={};
const stub=id=>els[id]||(els[id]={id,setAttribute(){},removeAttribute(){},hidden:false,innerHTML:'',
  className:'',style:{},value:'',textContent:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),
  querySelectorAll:()=>[],focus(){},select(){}});
const ctx={localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){}},
  location:{href:'x',hash:'',pathname:'/',search:''},history:{replaceState(){}},
  window:{addEventListener(){}},console:{log(){},warn(){},error(){}},
  fetch:()=>Promise.reject(new Error('x')),confirm:()=>true};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const R=ctx.__g('ALL_RECIPES');

const SHAPES=/\b(spaghetti|linguine|penne|rigatoni|bucatini|tagliatelle|fettuccine|orecchiette|farfalle|fusilli|pappardelle|macaroni|ziti|paccheri|casarecce|trofie|ditalini|orzo|lasagne|lasagna|tagliolini|cavatelli|gemelli|conchiglie|pasta)\b/i;
const CREAM=/\b(double cream|heavy cream|single cream|cream)\b/i;
const NOT_CREAM=/coconut|sour cream|ice cream|cream cheese/i;

// however the liquid is described, it has to be seasoned before the pasta meets it
const SALTED=/salt(ed|s)? (it|them|the|like|until|generously|heavily|hard|properly)|well-salted|salted water|season (it|them|the|well|properly|generously|hard)|seasons? with salt|tastes like (mild )?seawater/i;
// tossed in a pan, or stirred hard enough to matter
const WORKED=/toss|stir(ring)? (often|hard|vigorous|constant|rapid|firmly)|vigorous|beat|whisk/i;
// pulled early, rested off the heat, or sent to the oven still short
const SHORT=/(minute|min)s? (less|early|shy|short)|(short|shy) of (al dente|the pack)|less than the pack|undercook|under-cook|still (has bite|firm|chalky)|off the heat while|rest will finish|finish(es)? in the (sauce|pan|oven|custard)|go(es)? in dry/i;

const RULES=[
  ['1  salt the water',  SALTED, 'nothing says to season the liquid the pasta cooks in'],
  ['3  work the starch', WORKED, 'nothing says to toss or stir it hard enough to matter'],
  ['4  stop it short',   SHORT,  'nothing says to stop it before it is done'],
];

let issues=0;
const dishes=R.filter(r=>r.ing.some(i=>SHAPES.test(i.n)));
console.log('pasta dishes: '+dishes.length+'\n');

dishes.forEach(r=>{
  const steps=r.steps.map(s=>s.t+' '+s.s+' '+(s.tip||'')).join(' ');
  const fails=[];
  const cream=r.ing.filter(i=>CREAM.test(i.n)&&!NOT_CREAM.test(i.n)).map(i=>i.n);
  if(cream.length) fails.push('2  ditch the cream — '+cream.join(', ')+' in the sauce');
  RULES.forEach(([name,re,why])=>{ if(!re.test(steps)) fails.push(name+' — '+why) });
  if(fails.length){
    issues+=fails.length;
    console.log('  '+r.id+'  '+r.t);
    fails.forEach(f=>console.log('        '+f));
  }
});

console.log(issues ? '\n'+issues+' to fix' : 'every pasta dish follows all four rules');
if(issues) process.exit(1);
