const fs=require('fs'),vm=require('vm'),path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
const html=fs.readFileSync(APP,'utf8');
const code=html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";

// A fresh browser, plus whatever was already saved before profiles existed.
function boot(seed){
  const store=Object.assign({},seed||{});
  const els={};
  const stub=id=>els[id]||(els[id]={id,setAttribute(){},removeAttribute(){},hidden:false,
    innerHTML:'',className:'',style:{},value:'',textContent:'',scrollTop:0,scrollHeight:1,
    classList:{add(){},remove(){},toggle(){}},querySelector:()=>stub('x'),
    querySelectorAll:()=>[],focus(){}});
  const ctx={localStorage:{getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){}},
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

console.log('-- a first run --');
{
  const {ctx,store,G}=boot();
  eq('one profile is created',G('profiles').length,1);
  eq('and it is the active one',G('activeProfile'),G('profiles')[0].id);
  eq('with no PIN',G('profiles')[0].pin,null);
  eq('the profile list is written down',typeof store['tt_profiles'],'string');
}

console.log('-- data saved before profiles existed is adopted, not stranded --');
{
  // someone has been using the app already: a pantry and two starred recipes
  const {ctx,G}=boot({dw_pantry:JSON.stringify(['Miso paste','Gochujang']),
                      dw_favs:JSON.stringify([1,2])});
  eq('their pantry survives',[...G('pantry')].sort(),['Gochujang','Miso paste']);
  eq('their stars survive',G('favorites'),[1,2]);
  eq('filed under the first profile',ctx.pkey('dw_pantry'),'p'+G('activeProfile')+'_dw_pantry');
}

console.log('-- two people do not share a pantry --');
{
  const {ctx,G,S}=boot();
  const first=G('activeProfile');
  G('pantry').add('Anchovies'); ctx.save();
  const r=ctx.addProfile('Sam','🥕',null);
  eq('the second person is created',r.ok,true);
  ctx.applyProfile(r.id);
  eq('who is cooking changed',G('activeProfile'),r.id);
  eq('and they start with an empty pantry',[...G('pantry')],[]);
  G('pantry').add('Tahini'); ctx.save();
  ctx.applyProfile(first);
  eq('the first pantry is still there',[...G('pantry')],['Anchovies']);
  ctx.applyProfile(r.id);
  eq('and so is the second',[...G('pantry')],['Tahini']);
}

console.log('-- stars, plan and hidden recipes are personal too --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  ctx.toggleFav(1); G('plan').add(2); G('hidden').add(3); ctx.save();
  const r=ctx.addProfile('Alex',null,null);
  ctx.applyProfile(r.id);
  eq('no inherited stars',G('favorites'),[]);
  eq('no inherited plan',[...G('plan')],[]);
  eq('no inherited hidden list',[...G('hidden')],[]);
  ctx.applyProfile(first);
  eq('the first person keeps their star',G('favorites'),[1]);
  eq('their plan',[...G('plan')],[2]);
  eq('and their hidden recipe',[...G('hidden')],[3]);
}

console.log('-- a PIN gates the switch --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  const r=ctx.addProfile('Jo',null,'1234');
  ctx.applyProfile(first);
  eq('a PIN is recorded',!!ctx.profileById(r.id).pin,true);
  eq('the wrong PIN is refused',ctx.switchProfile(r.id,'0000').ok,false);
  eq('and says so',/does not match/.test(ctx.switchProfile(r.id,'0000').err),true);
  eq('nobody moved',G('activeProfile'),first);
  eq('no PIN at all is refused',ctx.switchProfile(r.id,'').ok,false);
  eq('the right PIN gets in',ctx.switchProfile(r.id,'1234').ok,true);
  eq('and moves you',G('activeProfile'),r.id);
}

console.log('-- the PIN is not sitting there in the clear --');
{
  const {ctx,G,store}=boot();
  const r=ctx.addProfile('Kim',null,'4821');
  const raw=store['tt_profiles'];
  eq('it is not in the stored profiles',raw.indexOf('4821'),-1);
  eq('what is stored is a salted hash',
    typeof ctx.profileById(r.id).pin.h==='string'&&typeof ctx.profileById(r.id).pin.s==='string',true);
  const other=ctx.addProfile('Lee',null,'4821');
  eq('the same PIN twice hashes differently',
    ctx.profileById(r.id).pin.h===ctx.profileById(other.id).pin.h,false);
}

console.log('-- a PIN can be changed and removed --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  const r=ctx.addProfile('Ros',null,'1111');
  ctx.applyProfile(first);
  ctx.setPin(r.id,'2222');
  eq('the old PIN stops working',ctx.switchProfile(r.id,'1111').ok,false);
  eq('the new one works',ctx.switchProfile(r.id,'2222').ok,true);
  ctx.applyProfile(first);
  ctx.setPin(r.id,'');
  eq('clearing it removes the gate',ctx.profileById(r.id).pin,null);
  eq('and the switch is open',ctx.switchProfile(r.id).ok,true);
}

console.log('-- removing someone --');
{
  const {ctx,G,store}=boot();
  const first=G('activeProfile');
  const r=ctx.addProfile('Tem',null,null);
  ctx.applyProfile(r.id);
  G('pantry').add('Sumac'); ctx.save();
  eq('their pantry is on disk',typeof store['p'+r.id+'_dw_pantry'],'string');
  ctx.applyProfile(first);
  eq('removing works',ctx.removeProfile(r.id).ok,true);
  eq('they are gone from the list',ctx.profileById(r.id),null);
  eq('and their data goes with them',store['p'+r.id+'_dw_pantry'],undefined);
  eq('the last person cannot be removed',ctx.removeProfile(first).ok,false);
  eq('so there is always someone',G('profiles').length,1);
}

console.log('-- removing whoever is cooking hands over to someone else --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  const r=ctx.addProfile('Nel',null,null);
  ctx.applyProfile(r.id);
  eq('removing the active person succeeds',ctx.removeProfile(r.id).ok,true);
  eq('someone else is cooking',G('activeProfile'),first);
  eq('and they are a real profile',!!ctx.profileById(G('activeProfile')),true);
}

console.log('-- names --');
{
  const {ctx,G}=boot();
  eq('a blank name is refused',ctx.addProfile('  ',null,null).ok,false);
  const r=ctx.addProfile('Sam',null,null);
  eq('a duplicate name is refused',ctx.addProfile('sam',null,null).ok,false);
  eq('renaming works',ctx.renameProfile(r.id,'Samir').ok,true);
  eq('the new name sticks',ctx.profileById(r.id).name,'Samir');
  eq('renaming onto someone else is refused',
    ctx.renameProfile(r.id,G('profiles')[0].name).ok,false);
}

console.log('-- switching resets what is on screen --');
{
  const {ctx,G}=boot();
  const first=G('activeProfile');
  ctx.selectCuisine('Italian');
  eq('a filter is set',G('sel').cuisines,['Italian']);
  const r=ctx.addProfile('Pat',null,null);
  ctx.applyProfile(r.id);
  eq('the next person does not inherit the filter',G('sel').cuisines,[]);
  eq('nor the results',G('shownIds'),[]);
  eq('nor an open recipe',G('expandedId'),null);
}

console.log('-- a person survives a reload --');
{
  const {ctx,G,store}=boot();
  const r=ctx.addProfile('Rae','🍅','9999');
  ctx.applyProfile(r.id);
  G('pantry').add('Harissa'); ctx.save();
  const again=boot(store);            // same browser, new page load
  eq('still cooking as the same person',again.G('activeProfile'),r.id);
  eq('with their pantry',[...again.G('pantry')],['Harissa']);
  eq('and their PIN still set',!!again.ctx.profileById(r.id).pin,true);
  eq('which still accepts the right code',
    again.ctx.pinOk(again.ctx.profileById(r.id),'9999'),true);
  eq('and refuses the wrong one',
    again.ctx.pinOk(again.ctx.profileById(r.id),'8888'),false);
}

console.log('-- corrupt storage does not brick the app --');
{
  const {ctx,G}=boot({tt_profiles:'not json at all'});
  eq('it starts over rather than dying',G('profiles').length,1);
  eq('with someone cooking',!!ctx.currentProfile(),true);
}
{
  const {ctx,G}=boot({tt_profiles:JSON.stringify([{id:'9',name:'Gone',fl:'🍳',pin:null}]),
                      tt_active:'does-not-exist'});
  eq('a dangling active id falls back to a real one',G('activeProfile'),'9');
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
