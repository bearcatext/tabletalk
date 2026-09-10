const fs=require('fs'),vm=require('vm'),path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const code=html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";

function boot(seed){
  const store=Object.assign({},seed||{});
  const els={};
  const stub=id=>els[id]||(els[id]={id,setAttribute(){},removeAttribute(){},hidden:false,
    innerHTML:'',className:'',style:{},value:'',textContent:'',scrollTop:0,scrollHeight:1,
    classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),
    querySelectorAll:()=>[],focus(){},select(){}});
  const ctx={localStorage:{getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    // A real document always has a body, and code that reaches for it is not
    // doing anything exotic — cook mode locks page scrolling through it. A stub
    // without one turns an ordinary line into a crash that reads like a bug in
    // the app.
    document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},
      body:stub('body')},
    location:{href:'https://example.test/tabletalk.html',hash:'',pathname:'/tabletalk.html',search:''},
    history:{replaceState(){}},
    window:{scrollTo(){},scrollY:0},console:{log(){},warn(){},error(){}},fetch:()=>Promise.reject(new Error('no net')),
    confirm:()=>true};
  ctx.globalThis=ctx; vm.createContext(ctx);
  new vm.Script(code).runInContext(ctx);
  return {ctx,store,G:ctx.__g,S:ctx.__s};
}

let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok?pass++:fail++};

console.log('-- a recipe travels in the link --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  eq('marked as sharing',ctx.isShared(r.id),true);
  const url=ctx.shareLink();
  eq('the link carries a payload',url.indexOf('#s=')>0,true);
  const offer=ctx.readShareLink(url.slice(url.indexOf('#')));
  eq('it reads back',!!offer,true);
  eq('with one recipe',offer.recipes.length,1);
  eq('the same one',offer.recipes[0].t,r.t);
  eq('its ingredients survive',offer.recipes[0].ing.length,r.ing.length);
  eq('its steps survive',offer.recipes[0].steps.length,r.steps.length);
  eq('and it is stamped with who sent it',offer.recipes[0].sharedBy,'You');
  eq('reading does not add anything',G('received').length,0);
}

console.log('-- nothing arrives until it is accepted --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  const url=ctx.shareLink();
  const before=G('ALL_RECIPES').length;
  const offer=ctx.readShareLink(url.slice(url.indexOf('#')));
  eq('the catalogue is untouched by looking',G('ALL_RECIPES').length,before);
  eq('accepting adds it',ctx.acceptShare(offer),1);
  eq('the catalogue grew',G('ALL_RECIPES').length,before+1);
  eq('it is in the received list',G('received').length,1);
  eq('and it is not one of your own',G('ownRecipes')().length,0);
  eq('the same link twice does not double it',ctx.acceptShare(
    ctx.readShareLink(url.slice(url.indexOf('#')))),0);
}

console.log('-- a shared recipe is a category, not a star --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  const url=ctx.shareLink();
  ctx.acceptShare(ctx.readShareLink(url.slice(url.indexOf('#'))));
  eq('it did not star itself',G('favorites').length,0);
  eq('it shows under shared',ctx.pool('shared').length,1);
  const got=G('receivedRecipes')()[0];
  eq('and it knows who sent it',got.sharedBy,'You');
  ctx.toggleFav(got.id);
  eq('the person can star it themselves',G('favorites'),[got.id]);
  eq('it is still shared as well',ctx.pool('shared').length,1);
}

console.log('-- a link is untrusted input --');
// Build payloads the way the app writes them, so these exercise the checks
// rather than bouncing off an unrecognised format.
const mk=(ctx,o)=>'#s='+ctx.b64enc(ctx.utf8Bytes(JSON.stringify(o)));
const one=(over)=>Object.assign({e:'\u{1F372}',t:'Soup',c:'Italian',m:20,k:300,s:4,g:4.5,
  d:'A soup',i:[['Water','1L','\u{1F4A7}',1]],p:[['Boil','Boil the water']]},over||{});
{
  const {ctx}=boot();
  const offer=ctx.readShareLink(mk(ctx,{v:2,b:'<img src=x onerror=alert(1)>',r:[one({
    t:'<script>alert(1)</script>Soup',
    d:'Nice <b>soup</b>',
    i:[['Water <i>x</i>','1L','\u{1F4A7}',1]],
    p:[['Boil <br>','Boil the water <script>x</script>']]})]}));
  eq('it still reads',!!offer,true);
  const got=offer.recipes[0];
  eq('no angle brackets in the sender',/[<>]/.test(offer.by),false);
  eq('nor in the title',/[<>]/.test(got.t),false);
  eq('nor the description',/[<>]/.test(got.desc),false);
  eq('nor an ingredient',/[<>]/.test(got.ing[0].n),false);
  eq('nor a step',/[<>]/.test(got.steps[0].s),false);
  eq('the readable words survive',/Soup/.test(got.t),true);
}
{
  const {ctx}=boot();
  // fields the app never sends must not ride along
  const offer=ctx.readShareLink(mk(ctx,{v:2,b:'X',r:[one({own:true,gen:true,id:9999,
    sharedBy:'Someone else',evil:'payload'})]}));
  const got=offer.recipes[0];
  eq('an unexpected key is dropped',got.evil,undefined);
  eq('it cannot claim to be yours',got.own,undefined);
  eq('nor pick its own id',got.id===9999,false);
  eq('nor forge who sent it',got.sharedBy,'X');
}
{
  const {ctx}=boot();
  const junk=['#s=not-base64-at-all','#s=','#nothing','',
    mk(ctx,{v:2,b:'X',r:[]}),
    mk(ctx,{v:2,b:'X',r:'nope'}),
    mk(ctx,{v:2,b:'X',r:[one({i:[]})]}),
    mk(ctx,{v:2,b:'X',r:[one({p:[]})]}),
    mk(ctx,{v:2,b:'X',r:[one({t:''})]}),
    mk(ctx,{v:2,b:'X',r:[one({i:'not an array'})]}),
    mk(ctx,{v:2,b:'X',r:[one({i:[{n:'object not row'}]})]}),
    mk(ctx,{v:2,b:'X',r:[one({p:[['Only a title']]})]})];
  junk.forEach(function(h,i){
    eq('rubbish link '+i+' is refused, not thrown at',ctx.readShareLink(h),null);
  });
}
{
  const {ctx,G}=boot();
  const many=[];for(let i=0;i<40;i++)many.push(['Thing '+i,'1','\u{1F944}',1]);
  eq('an oversized recipe is refused',
    ctx.readShareLink(mk(ctx,{v:2,b:'X',r:[one({i:many})]})),null);
  const steps=[];for(let i=0;i<40;i++)steps.push(['Step '+i,'Do it']);
  eq('and one with too many steps',
    ctx.readShareLink(mk(ctx,{v:2,b:'X',r:[one({p:steps})]})),null);
}
{
  const {ctx,G}=boot();
  const offer=ctx.readShareLink(mk(ctx,{v:2,b:'X',
    r:[one(),one(),one(),one(),one(),one(),one(),one()]}));
  eq('a link is capped',offer.recipes.length,G('SHARE_MAX'));
}
{
  const {ctx}=boot();
  const got=ctx.readShareLink(mk(ctx,{v:2,b:'X',
    r:[one({m:-99,k:9e9,s:0})]})).recipes[0];
  eq('a negative time is brought back into range',got.mins>0,true);
  eq('an absurd calorie count is clamped',got.cals<=5000,true);
  eq('and servings cannot be zero',got.serves>=1,true);
}
{
  const {ctx}=boot();
  // a very long title should be cut, not carried
  const got=ctx.readShareLink(mk(ctx,{v:2,b:'X',
    r:[one({t:'x'.repeat(500),d:'y'.repeat(2000)})]})).recipes[0];
  eq('a runaway title is trimmed',got.t.length<=80,true);
  eq('and a runaway description',got.desc.length<=300,true);
}

console.log('-- the link survives the round trip intact --');
{
  const {ctx,G}=boot();
  // a recipe with accents, emoji and swaps, which the encoding must not mangle
  const rich=G('ALL_RECIPES').find(function(r){
    return r.ing.some(function(i){return i.swaps&&i.swaps.length})&&/[^\x00-\x7F]/.test(r.t+r.desc)})
    ||G('ALL_RECIPES').find(function(r){return r.ing.some(function(i){return i.swaps&&i.swaps.length})});
  ctx.toggleShare(rich.id);
  const back=ctx.readShareLink('#'+ctx.shareLink().split('#')[1]).recipes[0];
  eq('the title comes back exactly',back.t,rich.t);
  eq('and the description',back.desc,rich.desc);
  eq('every ingredient name',back.ing.map(function(i){return i.n}),
    rich.ing.map(function(i){return i.n}));
  eq('every amount',back.ing.map(function(i){return i.amt}),
    rich.ing.map(function(i){return i.amt}));
  eq('the swaps survive',
    back.ing.reduce(function(n,i){return n+((i.swaps||[]).length)},0),
    rich.ing.reduce(function(n,i){return n+((i.swaps||[]).length)},0));
  eq('and the step text',back.steps.map(function(s){return s.s}),
    rich.steps.map(function(s){return s.s}));
}
{
  const {ctx,G}=boot();
  // the compact form is what makes a link sendable rather than a page of text
  const rs=G('ALL_RECIPES').slice(0,3);
  rs.forEach(function(r){ctx.toggleShare(r.id)});
  const url=ctx.shareLink();
  eq('three recipes stay well under 8000 characters',url.length<8000,true);
  eq('and the payload is base64, not a wall of percent signs',
    url.split('#s=')[1].indexOf('%'),-1);
}

console.log('-- letting one go --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  ctx.acceptShare(ctx.readShareLink(ctx.shareLink().split('#')[1]?'#'+ctx.shareLink().split('#')[1]:''));
  const got=G('receivedRecipes')()[0];
  ctx.toggleFav(got.id); G('plan').add(got.id);
  ctx.dropReceived(got.id);
  eq('it leaves the shared list',G('receivedRecipes')().length,0);
  eq('its star goes with it',G('favorites').indexOf(got.id),-1);
  eq('and it leaves the plan',G('plan').has(got.id),false);
  eq('it is out of the catalogue',G('ALL_RECIPES').some(x=>x.id===got.id),false);
}

console.log('-- shared recipes belong to a person --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  ctx.acceptShare(ctx.readShareLink('#'+ctx.shareLink().split('#')[1]));
  eq('one person has it',G('receivedRecipes')().length,1);
  const other=ctx.addProfile('Sam',null,null);
  ctx.applyProfile(other.id);
  eq('the other does not',G('receivedRecipes')().length,0);
  eq('nor do they inherit what you were sending',G('shared').length,0);
  ctx.applyProfile(first);
  eq('and it is still there when you come back',G('receivedRecipes')().length,1);
}

console.log('-- it survives a reload --');
{
  const {ctx,G,store}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  ctx.acceptShare(ctx.readShareLink('#'+ctx.shareLink().split('#')[1]));
  const got=G('receivedRecipes')()[0];
  ctx.toggleFav(got.id);
  const again=boot(store);
  eq('still received',again.G('receivedRecipes')().length,1);
  eq('with the sender remembered',again.G('receivedRecipes')()[0].sharedBy,'You');
  eq('and the star still points at it',
    again.G('favorites').indexOf(again.G('receivedRecipes')()[0].id)>=0,true);
  eq('and you are still offering yours',again.G('shared').length,1);
}

console.log('-- opening a link puts the offer on screen --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  const hash='#'+ctx.shareLink().split('#')[1];
  const fresh=boot();
  fresh.ctx.location.hash=hash;
  fresh.ctx.checkShareLink();
  eq('an offer is waiting',!!fresh.G('shareOffer'),true);
  eq('but nothing has been taken',fresh.G('received').length,0);
  eq('the sheet is showing it',fresh.G('whoView').mode,'offer');
  fresh.ctx.declineOffer();
  eq('declining takes nothing',fresh.G('received').length,0);
  eq('and clears the offer',fresh.G('shareOffer'),null);
}

console.log('-- a link tapped while the app is already open --');
{
  // changing only the fragment does not reload the page, so the offer has to
  // be picked up on hashchange as well as on load
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  ctx.toggleShare(r.id);
  const hash='#'+ctx.shareLink().split('#')[1];
  const fresh=boot();
  eq('the handler exists to be wired up',typeof fresh.ctx.checkShareLink,'function');
  fresh.ctx.location.hash=hash;
  fresh.ctx.checkShareLink();
  eq('and it finds the offer',!!fresh.G('shareOffer'),true);
  eq('without taking anything',fresh.G('received').length,0);
}

console.log('-- finding your way to a link --');
{
  const {ctx,G}=boot();
  const r=G('ALL_RECIPES')[0];
  // marking one from its own page should say so, not leave you on a dead end
  ctx.toggleShare(r.id);
  eq('a notice offers the next step',/get the link/.test(ctx.shareNoticeHtml()),true);
  eq('and says how many are waiting',/1 recipe ready to send/.test(ctx.shareNoticeHtml()),true);
  ctx.toggleShare(r.id);
  eq('unmarking the last one clears it',ctx.shareNoticeHtml(),'');
}
{
  const {ctx,G}=boot();
  // the Starred page is the front door
  ctx.toggleFav(G('ALL_RECIPES')[0].id);
  ctx.renderFavorites();
  const bar=ctx.document.getElementById('fav-share').innerHTML;
  eq('starring puts a send button on the page',/openShare/.test(bar),true);
  eq('which invites you before anything is picked',/Send recipes to someone/.test(bar),true);
  ctx.toggleShare(G('ALL_RECIPES')[0].id);
  ctx.renderFavorites();
  eq('and counts them once you have',
    /Send 1 recipe to someone/.test(ctx.document.getElementById('fav-share').innerHTML),true);
}
{
  const {ctx,G}=boot();
  // the sheet lists your stars so picking one is a single tap
  const a=G('ALL_RECIPES')[0], b=G('ALL_RECIPES')[1];
  ctx.toggleFav(a.id); ctx.toggleFav(b.id);
  ctx.whoGo('send');
  const sheet=ctx.document.getElementById('who-overlay').innerHTML;
  eq('both stars are offered',sheet.indexOf(a.t)>=0&&sheet.indexOf(b.t)>=0,true);
  eq('with nothing picked there is no link yet',/share-url/.test(sheet),false);
  ctx.toggleShare(a.id); ctx.whoGo('send');
  const after=ctx.document.getElementById('who-overlay').innerHTML;
  eq('picking one produces the link',/share-url/.test(after),true);
  eq('and the button counts it',/Copy the link for 1 recipe/.test(after),true);
}
{
  const {ctx,G}=boot();
  // nothing starred and nothing marked should still explain itself
  ctx.whoGo('send');
  eq('an empty sheet says what to do',
    /Star a recipe/.test(ctx.document.getElementById('who-overlay').innerHTML),true);
}
{
  const {ctx,G}=boot();
  const rs=G('ALL_RECIPES').slice(0,G('SHARE_MAX')+2);
  rs.forEach(function(r){ctx.toggleFav(r.id)});
  rs.slice(0,G('SHARE_MAX')).forEach(function(r){ctx.toggleShare(r.id)});
  ctx.whoGo('send');
  const sheet=ctx.document.getElementById('who-overlay').innerHTML;
  eq('a full link says so',/most a single link carries/.test(sheet),true);
  eq('and the ones you cannot add are disabled',/disabled/.test(sheet),true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
