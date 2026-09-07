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
    document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){}},
    location:{href:'https://example.test/tabletalk.html',hash:'',pathname:'/tabletalk.html',search:''},
    history:{replaceState(){}},
    window:{},console:{log(){},warn(){},error(){}},fetch:()=>Promise.reject(new Error('no net')),
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
{
  const {ctx,G}=boot();
  const nasty={v:1,by:'<img src=x onerror=alert(1)>',r:[{
    e:'\u{1F372}',t:'<script>alert(1)</script>Soup',c:'Italian',mins:20,cals:300,serves:4,
    desc:'Nice <b>soup</b>',
    ing:[{n:'Water <i>x</i>',amt:'1L',emoji:'\u{1F4A7}',core:true}],
    steps:[{t:'Boil <br>',s:'Boil the water <script>x</script>'}]}]};
  const offer=ctx.readShareLink('#s='+encodeURIComponent(JSON.stringify(nasty)));
  eq('it still reads',!!offer,true);
  const one=offer.recipes[0];
  eq('no angle brackets in the sender',/[<>]/.test(offer.by),false);
  eq('nor in the title',/[<>]/.test(one.t),false);
  eq('nor the description',/[<>]/.test(one.desc),false);
  eq('nor an ingredient',/[<>]/.test(one.ing[0].n),false);
  eq('nor a step',/[<>]/.test(one.steps[0].s),false);
  eq('the readable words survive',/Soup/.test(one.t),true);
}
{
  const {ctx}=boot();
  const junk=['#s=not-json','#s=%7B%7D','#s='+encodeURIComponent('{"v":1,"r":[]}'),
    '#s='+encodeURIComponent('{"v":1,"r":"nope"}'),'#nothing','',
    '#s='+encodeURIComponent(JSON.stringify({v:1,r:[{t:'No ingredients',ing:[],steps:[]}]})),
    '#s='+encodeURIComponent(JSON.stringify({v:1,r:[{t:'No steps',ing:[{n:'a',amt:'1'}],steps:[]}]}))];
  junk.forEach(function(h,i){
    eq('rubbish link '+i+' is refused, not thrown at',ctx.readShareLink(h),null);
  });
}
{
  const {ctx,G}=boot();
  // a payload claiming more ingredients than the app allows
  const many=[];for(let i=0;i<40;i++)many.push({n:'Thing '+i,amt:'1',core:true});
  const o={v:1,by:'X',r:[{t:'Too much',c:'Italian',mins:5,cals:5,ing:many,
    steps:[{t:'Do',s:'It'}]}]};
  eq('an oversized recipe is refused',
    ctx.readShareLink('#s='+encodeURIComponent(JSON.stringify(o))),null);
}
{
  const {ctx,G}=boot();
  const one={t:'Fine',c:'Italian',mins:5,cals:5,serves:4,
    ing:[{n:'Water',amt:'1L',core:true}],steps:[{t:'Boil',s:'Water'}]};
  const o={v:1,by:'X',r:[one,one,one,one,one,one,one,one]};
  const offer=ctx.readShareLink('#s='+encodeURIComponent(JSON.stringify(o)));
  eq('a link is capped',offer.recipes.length,G('SHARE_MAX'));
}
{
  const {ctx}=boot();
  const o={v:1,by:'X',r:[{t:'Silly numbers',c:'Italian',mins:-99,cals:9e9,serves:0,
    ing:[{n:'Water',amt:'1L',core:true}],steps:[{t:'Boil',s:'Water'}]}]};
  const one=ctx.readShareLink('#s='+encodeURIComponent(JSON.stringify(o))).recipes[0];
  eq('a negative time is brought back into range',one.mins>0,true);
  eq('an absurd calorie count is clamped',one.cals<=5000,true);
  eq('and servings cannot be zero',one.serves>=1,true);
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

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
