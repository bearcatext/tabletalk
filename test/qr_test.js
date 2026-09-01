const fs=require('fs'),vm=require('vm');
const path=require('path');
const APP=process.argv[2]||path.join(__dirname,'..','tabletalk.html');
let QR=null;   // optional dev oracle: npm install, then it cross-checks every matrix
try{QR=require('qrcode')}catch(e){}
const code=fs.readFileSync(APP,'utf8').match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const store={};const els={};
const stub=id=>els[id]||(els[id]={id,innerHTML:'',className:'',style:{},value:'',scrollTop:0,scrollHeight:1,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},querySelector:()=>stub('x'),querySelectorAll:()=>[],focus(){},textContent:''});
const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},
  document:{getElementById:stub,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},
    createElement:()=>({getContext:()=>({font:'',measureText:()=>({width:20})})})},
  window:{},console:{log(){},warn(){},error(){}},setTimeout:()=>0,fetch:()=>Promise.reject(),navigator:{}};
ctx.globalThis=ctx;vm.createContext(ctx);new vm.Script(code).runInContext(ctx);
const G=ctx.__g;
let pass=0,fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':`  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));ok?pass++:fail++};

const qrMatrix=ctx.qrMatrix, qrSvg=ctx.qrSvg;

// ── the inlined encoder still agrees with the reference ──
if(QR){
console.log('\n-- encoder vs reference --');
const fixed=['a','Shopping list','Milk, 2 pints\nEggs, 6','àéîöü — smart “quotes”','x'.repeat(300),'y'.repeat(1200)];
let m=0,d=0;
for(const s of fixed)for(const ecl of ['M','L']){
  const mine=qrMatrix(s,ecl),ref=QR.create([{data:s,mode:'byte'}],{errorCorrectionLevel:ecl});
  const n=mine.size;let diff=n!==ref.modules.size?1:0;
  if(!diff)for(let y=0;y<n;y++)for(let x=0;x<n;x++)if((mine.matrix[y][x]?1:0)!==(ref.modules.data[y*n+x]?1:0))diff++;
  diff?d++:m++;
}
eq('fixed vectors all match reference',[m,d],[fixed.length*2,0]);

const CH='abcdefghij0123456789 ,.-\nABC';let seed=4242;
const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let fm=0,fd=0;
for(let i=0;i<120;i++){
  const len=1+Math.floor(rnd()*1000);let s='';
  for(let j=0;j<len;j++)s+=CH[Math.floor(rnd()*CH.length)];
  const ecl=rnd()<0.5?'M':'L';
  const mine=qrMatrix(s,ecl),ref=QR.create([{data:s,mode:'byte'}],{errorCorrectionLevel:ecl});
  const n=mine.size;let diff=n!==ref.modules.size?1:0;
  if(!diff)for(let y=0;y<n;y++)for(let x=0;x<n;x++)if((mine.matrix[y][x]?1:0)!==(ref.modules.data[y*n+x]?1:0))diff++;
  diff?fd++:fm++;
}
eq('120 fuzz cases all match reference',[fm,fd],[120,0]);
} else {
  console.log('  SKIP  encoder vs reference — run `npm install` in the project root to enable');
}

// ── structural invariants ──
console.log('\n-- structure --');
const q=qrMatrix('Shopping list','M');
eq('size is 4v+17',q.size,q.version*4+17);
// 7x7: dark border, light ring, dark 3x3 centre
const fin=(ox,oy)=>q.matrix[oy][ox]===1&&q.matrix[oy+6][ox]===1&&
  q.matrix[oy+1][ox+1]===0&&q.matrix[oy+3][ox+3]===1;
eq('three finder patterns',[fin(0,0),fin(q.size-7,0),fin(0,q.size-7)],[true,true,true]);
eq('dark module set',q.matrix[q.size-8][8],1);
eq('timing row alternates',[q.matrix[6][8],q.matrix[6][9]],[1,0]);
eq('falls back to L when M will not fit',qrMatrix('z'.repeat(2500),'M').ecl,'L');
eq('returns null past 2953 bytes',qrMatrix('z'.repeat(3000),'M'),null);

// ── svg ──
console.log('\n-- svg --');
const s=qrSvg('Shopping list — milk, eggs','M');
eq('svg produced',!!s.svg,true);
eq('viewBox has a 4-module quiet zone each side',
  new RegExp('viewBox="0 0 '+(s.size+8)+' '+(s.size+8)+'"').test(s.svg),true);
eq('has a background rect',/<rect width="\d+" height="\d+" fill="#fdfaf2"\/>/.test(s.svg),true);
eq('has a dark path',/<path d="M[^"]+" fill="#2f2a22"\/>/.test(s.svg),true);
eq('crispEdges set',/shape-rendering="crispEdges"/.test(s.svg),true);
eq('no runs escape the matrix',(s.svg.match(/M(\d+) (\d+)h(\d+)/g)||[]).every(t=>{
  const [,x,y,w]=t.match(/M(\d+) (\d+)h(\d+)/).map(Number);
  return x>=4&&y>=4&&x+w<=s.size+4;}),true);
eq('oversized list yields null',qrSvg('z'.repeat(3000),'M'),null);

// ── wiring into the plan page ──
console.log('\n-- plan wiring --');
const R=G('ALL_RECIPES');
ctx.togglePlan(R[0].id);ctx.togglePlan(R[1].id);
eq('starts closed',G('qrOpen'),false);
ctx.renderPlan();
eq('button present',/onclick="toggleQr\(\)"/.test(stub('plan-body').innerHTML),true);
eq('panel hidden while closed',/qr-panel/.test(stub('plan-body').innerHTML),false);
eq('closed label',/Scan to phone/.test(stub('plan-body').innerHTML),true);
ctx.toggleQr();
eq('toggles open',G('qrOpen'),true);
const html=stub('plan-body').innerHTML;
eq('panel rendered',/qr-panel/.test(html),true);
eq('svg embedded',/<svg viewBox=/.test(html),true);
eq('open label',/Hide QR/.test(html),true);
eq('meta line shown',/modules · version \d+ · level [ML]/.test(html),true);
// the panel must encode the compact payload, not the full pasteable text
eq('panel encodes the compact payload',html.includes(qrSvg(ctx.shoppingListCompact(),'M').svg),true);
eq('compact differs from full text',ctx.shoppingListCompact()!==ctx.shoppingListText(),true);
eq('compact drops checkbox prefixes',/- \[ \]/.test(ctx.shoppingListCompact()),false);
eq('compact keeps every item',ctx.shoppingListCompact().split('\n').length-1,ctx.shoppingList().length);
ctx.toggleQr();
eq('toggles closed again',G('qrOpen'),false);

// a plan too big for a QR still renders a useful message
console.log('\n-- overflow --');
R.slice(0,40).forEach(r=>{if(!ctx.inPlan(r.id))ctx.togglePlan(r.id)});
ctx.toggleQr();
const big=stub('plan-body').innerHTML;
const tooLong=Buffer.byteLength(ctx.shoppingListCompact(),'utf8')>2953;
eq('big plan renders panel or overflow note',/qr-panel/.test(big),true);
if(tooLong) eq('overflow message shown',/qr-too-long/.test(big),true);
else eq('still fits, svg shown',/<svg viewBox=/.test(big),true);

// the too-long branch, forced rather than hoped for
eq('too-long branch renders the note',(()=>{
  const real=ctx.shoppingListCompact;
  ctx.shoppingListCompact=()=>'z'.repeat(3000);
  const out=ctx.qrPanelHtml();
  ctx.shoppingListCompact=real;
  return /qr-too-long/.test(out)&&!/<svg/.test(out);})(),true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode=fail?1:0;
