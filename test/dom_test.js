// The other suites stub getElementById so that every id manufactures an element.
// That is convenient, and it means a lookup for something the page does not have
// can never fail — which is how "Add a recipe" shipped opening on a blank page
// with 49 tests passing over it. This harness answers only for ids that are
// really in the document, exactly as a browser does.
const fs=require('fs'),vm=require('vm'),path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const code=html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";

// every id="..." written in the markup, minus the script block
const markup=html.slice(0,html.indexOf('<script'))+html.slice(html.lastIndexOf('</script>'));
const REAL_IDS=new Set();
markup.replace(/\bid="([^"]+)"/g,(m,id)=>{REAL_IDS.add(id);return m});

function boot(){
  const els={};
  const make=id=>({id,setAttribute(){},removeAttribute(){},hidden:false,innerHTML:'',
    className:'',style:{},value:'',textContent:'',scrollTop:0,scrollHeight:1,scrollWidth:1,
    clientWidth:1,scrollLeft:0,offsetLeft:0,
    classList:{add(){},remove(){},toggle(){},contains:()=>false},
    querySelector:()=>null,querySelectorAll:()=>[],focus(){},select(){},
    appendChild(){},remove(){},closest:()=>null,getBoundingClientRect:()=>({width:0,height:0})});
  const store={};
  const ctx={localStorage:{getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    document:{
      // this is the whole point of the suite
      getElementById:id=>REAL_IDS.has(id)?(els[id]||(els[id]=make(id))):null,
      querySelectorAll:()=>[],addEventListener(){},
      createElement:()=>make('created'),
      head:make('head'),body:make('body')},
    location:{href:'https://example.test/tabletalk.html',hash:'',pathname:'/tabletalk.html',search:''},
    history:{replaceState(){}},
    window:{addEventListener(){}},console:{log(){},warn(){},error(){}},
    fetch:()=>Promise.reject(new Error('no net')),confirm:()=>true};
  ctx.globalThis=ctx; vm.createContext(ctx);
  new vm.Script(code).runInContext(ctx);
  return {ctx,G:ctx.__g,S:ctx.__s,els};
}

let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok?pass++:fail++};
const noThrow=(n,fn)=>{try{fn();eq(n,true,true)}catch(e){eq(n+'  ['+e.message+']',false,true)}};

console.log('-- the ids the code asks for are ids the page has --');
{
  const {G}=boot();
  eq('the markup really was parsed',REAL_IDS.size>5,true);
  eq('and holds the pages',['pg-discover','pg-favorites','pg-plan','pg-build']
    .every(id=>REAL_IDS.has(id)),true);
  eq('the builder has no nav tab, which is the trap',REAL_IDS.has('t-build'),false);
}

console.log('-- every page opens --');
{
  const {ctx}=boot();
  ['discover','favorites','plan','build'].forEach(pg=>{
    noThrow('showPg("'+pg+'") does not throw',()=>ctx.showPg(pg));
  });
}

console.log('-- Add a recipe actually draws the form --');
{
  const {ctx,els}=boot();
  noThrow('startNewRecipe does not throw',()=>ctx.startNewRecipe());
  eq('the builder page was asked for',!!els['pg-build'],true);
  const body=els['build-body'];
  eq('and the form was drawn into it',!!(body&&body.innerHTML.length>200),true);
}

console.log('-- editing an existing recipe too --');
{
  const {ctx,G,els}=boot();
  const own=ctx.saveOwnRecipe?null:null;
  noThrow('editRecipe on a catalogue recipe does not throw',
    ()=>ctx.editRecipe(G('ALL_RECIPES')[0].id));
}

console.log('-- the rest of the render path survives a real document --');
{
  const {ctx}=boot();
  noThrow('renderCuisineRow',()=>ctx.renderCuisineRow());
  noThrow('renderCards',()=>ctx.renderCards());
  noThrow('renderPantryPanel',()=>ctx.renderPantryPanel());
  noThrow('renderFavorites',()=>ctx.renderFavorites());
  noThrow('renderPlan',()=>ctx.renderPlan());
  noThrow('renderSearchBar',()=>ctx.renderSearchBar());
  noThrow('renderMarco',()=>ctx.renderMarco());
  noThrow('renderWho',()=>ctx.renderWho());
  noThrow('renderWhoBtn',()=>ctx.renderWhoBtn());
  noThrow('updateFavBadge',()=>ctx.updateFavBadge());
  noThrow('updatePlanBadge',()=>ctx.updatePlanBadge());
}

console.log('-- anything hidden by the hidden attribute really goes away --');
// The profile sheet shipped with display:flex on its class, which beats the
// browser's own [hidden]{display:none}. The attribute was set, the element was
// laid out anyway, and a full-page half-black layer at z-index 400 sat over the
// app swallowing every tap. Every test passed. This is the check that would
// have caught it, and it needs no browser: it is a specificity question.
{
  const style=(html.match(/<style>([\s\S]*?)<\/style>/)||[,''])[1];
  const carriers=[];
  html.replace(/<[a-z]+[^>]*\bhidden\b[^>]*>/gi,function(tag){
    const cls=(tag.match(/class="([^"]*)"/)||[,''])[1];
    cls.split(/\s+/).filter(Boolean).forEach(function(c){
      if(carriers.indexOf(c)<0) carriers.push(c)});
    return tag;
  });
  eq('there are elements hidden this way to check',carriers.length>0,true);

  const globalGuard=/\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(style);
  const unsafe=carriers.filter(function(c){
    // does any plain class rule give it a display?
    const re=new RegExp('\\.'+c+'\\{([^}]*)\\}','g');
    let m,sets=false;
    while((m=re.exec(style))) if(/display\s*:/.test(m[1])) sets=true;
    if(!sets) return false;
    if(globalGuard) return false;
    // then it needs its own [hidden] rule to win
    return !new RegExp('\\.'+c+'\\[hidden\\]').test(style);
  });
  eq('none of them can outrank [hidden] and stay on screen',unsafe,[]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
