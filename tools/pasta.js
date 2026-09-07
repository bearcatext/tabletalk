// Checks every pasta dish against Evan Funke's four rules.
//
//   1. Salt the water     until it tastes like mild seawater — it seasons the
//                         pasta from the inside out, and it is the only chance.
//   2. Ditch the cream    a traditional sauce binds on the starch coming off
//                         the pasta, not on dairy fat.
//   3. Toss hard          working the pasta into the sauce is what pulls the
//                         starch out and turns fat and water into an emulsion.
//   4. Undercook          pull it early; it finishes in the pan and takes the
//                         flavour of the sauce with it.
//
// Run: node tools/pasta.js [build.html]
//
// Dishes where the pasta cooks in the pot it is served from are exempt from
// 1, 3 and 4: there is no separate water to salt, nothing is drained, and the
// starch goes straight into the dish. The rules are about a pasta that moves
// from water to pan, and these never do.
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

// pasta cooked in the dish itself, or never boiled at all
const ONE_POT=/cook the pasta in the pot|add pasta directly|tip the dry pasta straight in|straight into the pot/i;
const boils=r=>/\bboil|cook (the )?(pasta|spaghetti|linguine|penne|ziti|macaroni)/i
  .test(r.steps.map(s=>s.s).join(' '));

let issues=0;
const dishes=R.filter(r=>r.ing.some(i=>SHAPES.test(i.n)));
console.log('pasta dishes: '+dishes.length+'\n');

dishes.forEach(r=>{
  const steps=r.steps.map(s=>s.t+' '+s.s+' '+(s.tip||'')).join(' ').toLowerCase();
  const onePot=ONE_POT.test(steps)||!boils(r);
  const cream=r.ing.filter(i=>CREAM.test(i.n)&&!NOT_CREAM.test(i.n)).map(i=>i.n);
  const fails=[];
  if(cream.length) fails.push('rule 2: cream in the sauce ('+cream.join(', ')+')');
  if(!onePot){
    if(!/salt(ed)? (like|until)|well-salted|salted water|salt.{0,40}water|water.{0,40}salt/.test(steps))
      fails.push('rule 1: never says to salt the water');
    if(!/toss|stir(ring)? (vigorous|hard|constant|rapid)|vigorous|beat/.test(steps))
      fails.push('rule 3: never says to toss it into the sauce');
    if(!/(minute|min)s? (less|early|shy|short)|short of al dente|shy of al dente|less than the pack|short of the pack|undercook|under-cook/.test(steps))
      fails.push('rule 4: never says to pull it early');
  }
  if(fails.length){
    issues+=fails.length;
    console.log('  '+r.id+'  '+r.t);
    fails.forEach(f=>console.log('        '+f));
  }
});

const exempt=dishes.filter(r=>{
  const steps=r.steps.map(s=>s.t+' '+s.s).join(' ').toLowerCase();
  return ONE_POT.test(steps)||!boils(r);
});
console.log((issues?'\n':'')+(issues?issues+' to fix':'all pasta dishes follow the rules'));
console.log('exempt (pasta cooks in the dish, or is never boiled): '
  +(exempt.length?exempt.map(r=>r.t).join(', '):'none'));
if(issues) process.exit(1);
