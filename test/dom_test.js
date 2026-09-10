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
    className:'',value:'',textContent:'',scrollTop:0,scrollHeight:1,scrollWidth:1,
    style:{_p:{},setProperty(k,v){this._p[k]=v},getPropertyValue(k){return this._p[k]||''}},
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
      head:make('head'),body:make('body'),documentElement:make('html')},
    location:{href:'https://example.test/tabletalk.html',hash:'',pathname:'/tabletalk.html',search:''},
    history:{replaceState(){}},
    window:{addEventListener(){},scrollTo(){},scrollY:0},console:{log(){},warn(){},error(){}},
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

console.log('-- an open recipe marks the body, and lets go of it --');
// The phone layout hides the whole list behind this one class. If it is ever
// left on after the recipe closes, the list stays hidden and the app looks
// empty; if it is missing while one is open, the recipe renders halfway down a
// page of cards. Nine different places change expandedId, so the class is read
// off it in renderCards rather than set by each of them.
{
  const {G,S,ctx}=boot();
  const cls=[];
  ctx.document.body.classList.toggle=function(n,on){cls.length=0;if(on)cls.push(n);return on};
  ctx.document.body.classList.contains=n=>cls.indexOf(n)>=0;
  const open=()=>ctx.document.body.classList.contains('dp-open');

  ctx.selectCuisine(G('ALL_RECIPES')[0].c);
  const shown=G('shownIds');
  eq('there are cards on screen to open',shown.length>0,true);   // canary
  const id=shown[0];

  eq('nothing open to begin with',open(),false);
  ctx.toggleExpand(id);
  eq('opening a recipe marks the body',open(),true);
  ctx.toggleExpand(id);
  eq('closing it lets go',open(),false);

  // the paths that close a recipe without going through toggleExpand
  ctx.toggleExpand(id);
  eq('open again',open(),true);
  S('expandedId',null); ctx.renderCards();
  eq('and a redraw with nothing open clears it too',open(),false);

  // The class hides the whole list. Setting it for a recipe that is not being
  // drawn would leave a phone showing nothing at all, with no way back.
  const absent=G('ALL_RECIPES').map(r=>r.id).find(x=>shown.indexOf(x)<0);
  eq('there is a recipe that is not on screen',absent!==undefined,true);   // canary
  S('expandedId',absent); ctx.renderCards();
  eq('a recipe that is not on the page does not hide the page',open(),false);
}

console.log('-- the pages leave room for the bar Marco sits in --');
// Marco is fixed to the foot of the screen, so a page that does not end above
// him has its last line quietly buried. The room needed is not a constant —
// the bar is 83px empty and opens to nearly half the screen with a transcript —
// and getting it wrong fails silently, which is why it is measured.
{
  const {ctx,els}=boot();
  const style=(html.match(/<style>([\s\S]*?)<\/style>/)||[,''])[1];
  eq('the pages reserve room rather than guessing a number',
    /\.pg\{[^}]*padding:[^}]*var\(--marco-h\)/.test(style.replace(/\s*\n\s*/g,'')),true);
  eq('and there is a starting value before anything is measured',
    /:root\{[^}]*--marco-h:\s*\d+px/.test(style),true);

  const root=ctx.document.documentElement;
  const bar=ctx.document.getElementById('marco-wrap');
  eq('the bar is a real element on the page',!!bar,true);   // canary
  bar.getBoundingClientRect=()=>({width:390,height:212});   // a transcript is open
  ctx.renderMarco();
  eq('rendering Marco writes his real height',root.style.getPropertyValue('--marco-h'),'212px');

  bar.getBoundingClientRect=()=>({width:390,height:83});    // cleared again
  ctx.syncMarcoHeight();
  eq('and it comes back down when he does',root.style.getPropertyValue('--marco-h'),'83px');

  // A zero reading means the bar is not laid out yet — printing it would take
  // the reserved space away entirely.
  bar.getBoundingClientRect=()=>({width:0,height:0});
  ctx.syncMarcoHeight();
  eq('a bar that has not been laid out is ignored',root.style.getPropertyValue('--marco-h'),'83px');
}

console.log('-- cook mode comes down when the app moves on --');
// The cook overlay is fixed, inset:0, z-index 500, and it locks body scrolling.
// Only its close button used to take it down, so anything else that moved the
// app on left it covering the whole screen with nothing scrollable behind it —
// the same shape as the profile overlay that once swallowed every tap.
{
  const {G,S,ctx}=boot();
  const el=()=>ctx.document.getElementById('cook-overlay');
  const state=()=>({shown:el().style.display,lock:ctx.document.body.style.overflow,id:G('cookRecipeId')});
  const rid=G('ALL_RECIPES')[0].id;

  ctx.startCook(rid);
  eq('cooking puts the overlay up and locks the page',state(),{shown:'flex',lock:'hidden',id:rid});

  // switching person
  ctx.applyProfile(G('activeProfile'));
  eq('switching person takes it back down',state(),{shown:'none',lock:'',id:null});

  // changing page
  ctx.startCook(rid);
  ctx.showPg('plan');
  eq('changing page takes it back down',state(),{shown:'none',lock:'',id:null});

  // and the close button still works, twice, without throwing
  ctx.startCook(rid);
  ctx.closeCook();
  ctx.closeCook();
  eq('closing is safe to repeat',state(),{shown:'none',lock:'',id:null});
  eq('and safe when never opened',(function(){
    const b=boot();b.ctx.closeCook();
    return b.ctx.document.body.style.overflow;})(),'');
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
