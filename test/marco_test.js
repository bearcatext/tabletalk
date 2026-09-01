const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:100,
  classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
let sent=null;
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:(f)=>{f&&f();return 0},
  fetch:(url,opt)=>{sent=JSON.parse(opt.body);
    return Promise.resolve({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({text:'Reply '+(sent.messages.filter(m=>m.role==='user').length),recipe_ids:[1]})}],usage:{}})})}};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g,S=ctx.__s;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

const ask=async(text,fromCook)=>{stub(fromCook?'cook-marco-in':'marco-in').value=text;await ctx.askMarco(fromCook)};

(async()=>{
  S('marcoHistory',[]);
  await ask('what can I make with eggs');
  eq('user + assistant recorded',G('marcoHistory').length,2);
  eq('user turn stored',G('marcoHistory')[0],{role:'user',content:'what can I make with eggs'});
  eq('assistant text stored',G('marcoHistory')[1].text,'Reply 1');
  eq('recipe ids stored',G('marcoHistory')[1].recipe_ids,[1]);

  await ask('something faster');
  eq('history grows',G('marcoHistory').length,4);
  eq('whole conversation resent',sent.messages.filter(m=>m.role==='user').length,2);
  eq('assistant turns resent',sent.messages.filter(m=>m.role==='assistant').length,1);
  eq('assistant sent as plain text',typeof sent.messages[1].content,'string');
  eq('history persisted',JSON.parse(store['dw_marco']).length,4);

  // caching prefix unchanged between turns
  eq('system still 2 blocks',sent.system.length,2);
  eq('catalogue still cached',!!sent.system[1].cache_control,true);
  eq('persona block not cached',!!sent.system[0].cache_control,false);
  eq('hidden recipes excluded from catalogue',/\[1\]/.test(sent.system[1].text),true);

  // cook-mode context as a mid-conversation system message
  S('cookRecipeId',null);S('marcoHistory',[]);
  await ask('hello');
  eq('no context when nothing is in play',sent.messages.some(m=>m.role==='system'),false);

  // recipe detail is attached for whatever is under discussion
  S('marcoHistory',[]);
  await ask('something with eggs');            // stub replies with recipe_ids:[1]
  await ask('how much garlic in that?');
  const det=sent.messages.filter(m=>m.role==='system')[0];
  const r1=G('ALL_RECIPES').find(x=>x.id===1);
  eq('detail attached for recommended recipe',!!det,true);
  eq('detail carries exact amounts',det.content.includes(r1.ing[0].amt+' '+r1.ing[0].n),true);
  eq('detail carries steps',det.content.includes(r1.steps[0].s),true);
  eq('detail carries swap amounts',/swaps for /.test(det.content),true);
  eq('detail capped',(det.content.match(/^[d+] /gm)||[]).length<=G('MARCO_DETAIL_MAX'),true);

  // named by title in the message
  S('marcoHistory',[]);
  await ask('tell me about '+r1.t);
  const byName=sent.messages.filter(m=>m.role==='system')[0];
  eq('detail attached when named by title',byName&&byName.content.includes(r1.t),true);
  const r=G('ALL_RECIPES').find(x=>x.steps.length>2);
  S('cookRecipeId',r.id);S('cookStepIdx',1);
  await ask('is it done yet');
  const sys=sent.messages.filter(m=>m.role==='system');
  eq('cook context added',sys.length,1);
  eq('context names the dish',sys[0].content.includes(r.t),true);
  eq('context names the step',sys[0].content.includes('step 2 of '+r.steps.length),true);
  eq('system message is last',sent.messages[sent.messages.length-1].role,'system');
  eq('system message follows a user turn',sent.messages[sent.messages.length-2].role,'user');
  eq('context not in the visible transcript',G('marcoHistory').slice(-2)[0].content,'is it done yet');

  // trimming
  S('marcoHistory',Array.from({length:60},(_,i)=>i%2?{role:'assistant',text:'a'+i,recipe_ids:[]}:{role:'user',content:'u'+i}));
  await ask('latest');
  eq('long history trimmed',sent.messages.filter(m=>m.role!=='system').length<=G('MARCO_MAX_TURNS'),true);
  eq('most recent turn survives trimming',sent.messages.filter(m=>m.role==='user').pop().content,'latest');

  // clear
  ctx.clearMarco();
  eq('clear empties history',G('marcoHistory').length,0);
  eq('clear persists',JSON.parse(store['dw_marco']).length,0);

  // transcript rendering
  S('marcoHistory',[{role:'user',content:'<script>x</script>'},{role:'assistant',text:'hi',recipe_ids:[1]}]);
  ctx.renderMarco();
  const html=stub('marco-reply-area-bar').innerHTML;
  eq('renders user turn',/marco-msg user/.test(html),true);
  eq('escapes user input',!/<script>x/.test(html),true);
// Marco's suggestions use the same card as the results grid, so they can be
// starred and added to the plan without leaving the conversation.
eq('renders a full recipe card',/recipe-card/.test(html),true);
eq('with a favourite button',/toggleFavCard/.test(html),true);
eq('with an add-to-plan button',/togglePlan/.test(html),true);
eq('showing time and calories',/ti-clock/.test(html)&&/ti-flame/.test(html),true);
eq('and clicking opens it in Discover',/jumpToRecipe/.test(html),true);
  eq('offers clear',/clearMarco/.test(html),true);

  // shared transcript in cook mode
  eq('cook area mirrors transcript',stub('cook-marco-area').innerHTML.length>0,true);

  // earlier tests leave cook mode running and a thread in history; both feed
  // recipesInPlay, so clear them or every assertion below inherits them
  S('cookRecipeId',null);S('cookStepIdx',0);S('marcoHistory',[]);
  console.log('-- naming a dish attaches its detail --');
  // Short names are how people refer to dishes. Requiring the whole title meant
  // the most obvious question got answered from a line with no amounts in it.
  eq('a short name finds the dish',ctx.recipesInPlay('how much guanciale in carbonara?')
    .map(function(r){return r.t}),['Spaghetti carbonara']);
  eq('the full name works too',ctx.recipesInPlay('spaghetti carbonara')
    .map(function(r){return r.t}),['Spaghetti carbonara']);
  eq('a short title matches whole',ctx.recipesInPlay('tell me about pad thai')
    .map(function(r){return r.t}),['Pad thai']);
  eq('one common word is not a reference',ctx.recipesInPlay('what can I make with chicken').length,0);
  eq('nor is a bare ingredient',ctx.recipesInPlay('chicken').length,0);
  eq('vague asks attach nothing',ctx.recipesInPlay('give me something quick').length,0);
  eq('never more than the cap',ctx.recipesInPlay('chicken korma katsu carbonara pad thai')
    .length<=G('MARCO_DETAIL_MAX'),true);

  console.log('-- he searches before offering to write --');
  eq('an exact match is reported as exact',ctx.marcoCandidates('chicken rice').exact,true);
  eq('and returns recipes',ctx.marcoCandidates('chicken rice').list.length>0,true);
  eq('a near miss falls back to closest',(function(){
    const c=ctx.marcoCandidates('moroccan lamb with apricots');
    return c.exact===false&&c.list.length>0;})(),true);
  eq('closest is capped',ctx.marcoCandidates('moroccan lamb with apricots').list.length<=G('MARCO_SHORTLIST'),true);
  eq('a genuine gap returns nothing at all',ctx.marcoCandidates('something for a hangover').list.length,0);
  eq('conversational phrasing finds what keywords find',
    ctx.marcoCandidates('what can I make with chicken and rice').list.length,
    ctx.marcoCandidates('chicken rice').list.length);

  console.log('-- the context says which he is looking at --');
  eq('exact matches are labelled so',/matching what they asked for/
    .test(ctx.marcoContextMessage('chicken rice').content),true);
  eq('near misses are labelled honestly',/come closest/
    .test(ctx.marcoContextMessage('moroccan lamb with apricots').content),true);
  eq('and he is told not to pretend they fit',/rather than pretending they fit/
    .test(ctx.marcoContextMessage('moroccan lamb with apricots').content),true);
  eq('a genuine gap adds no candidate list',ctx.marcoContextMessage('something for a hangover'),null);
  eq('a follow-up gets detail, not a shortlist',
    /use these exact amounts/.test(ctx.marcoContextMessage('how much guanciale in carbonara?').content),true);

  console.log('-- the persona orders his options --');
  eq('he is told to ask when the ask is vague',/ask ONE short question/.test(G('MARCO_PERSONA')),true);
  eq('and not to write while a match is sitting there',
    /never offer to write something new while a decent match/.test(G('MARCO_PERSONA')),true);
  eq('and to say what a close match misses',/name what they don/.test(G('MARCO_PERSONA')),true);

  console.log('-- Marco without a proxy --');
  // The retrieval was always local; only the phrasing needed the API. So when
  // there is no proxy, read the answer out instead of telling a stranger to run
  // a server they do not have.
  S('cookRecipeId',null);S('marcoHistory',[]);
  const la=q=>ctx.marcoLocalAnswer(q);
  const RM=G('ALL_RECIPES');

  eq('an amount comes back with the real figure',
    /150g/.test(la('how much guanciale in carbonara').text),true);
  eq('and names the dish it came from',
    /carbonara/i.test(la('how much guanciale in carbonara').text),true);
  eq('naming a dish scopes the answer to it',
    /does not list/.test(la('how much garlic in the korma').text),true);
  eq('rather than quoting an unrelated recipe',
    /teriyaki/i.test(la('how much garlic in the korma').text),false);
  eq('an ingredient inside the dish name still resolves',
    /chicken thighs/i.test(la('how much chicken in the korma').text),true);

  eq('substitutions come from the recipe',
    /pancetta/i.test(la('what can I use instead of guanciale').text),true);
  eq('and carry their amounts',
    /150g/.test(la('what can I use instead of guanciale').text),true);
  eq('a bare ingredient finds a recipe that has alternatives',
    la('what can I use instead of fish sauce').text.indexOf('Instead of')===0,true);

  eq('timing includes the make-ahead split',
    /can be done ahead/.test(la('how long does the korma take').text),true);
  eq('steps are listed in order',
    /1\. Cook the rice/.test(la('what are the steps for stuffed peppers').text),true);
  eq('ingredients can be listed',
    /cashews/i.test(la('whats in the korma').text),true);

  eq('an ingredient question returns recipes',
    la('what can I make with chicken and rice').recipe_ids.length>0,true);
  eq('and they are real ids',
    la('what can I make with chicken and rice').recipe_ids.every(function(id){
      return RM.some(function(r){return r.id===id})}),true);
  eq('filters still apply offline',
    la('something quick and vegan').recipe_ids.every(function(id){
      const r=RM.find(function(x){return x.id===id});
      return r.mins<=G('QUICK_MINS')&&ctx.dietStatus(r,'vgn').ok}),true);

  eq('it admits what it cannot do',la('something impressive for guests'),null);
  eq('rather than guessing',la('surprise me'),null);

  eq('the offline path no longer tells a stranger to run a server',(function(){
    const src=fs.readFileSync(APP,'utf8');
    return src.indexOf('marcoLocalAnswer(q)')>0;})(),true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode=fail?1:0;
})();
