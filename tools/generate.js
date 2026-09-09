#!/usr/bin/env node
/**
 * Tabletalk — write new recipes into the catalogue, without a browser.
 *
 *   node tools/generate.js --cuisine Korean --count 3
 *   node tools/generate.js --thinnest            (whichever cuisine has fewest)
 *   node tools/generate.js --thinnest --dry-run  (write nothing, just report)
 *
 * The key comes from the environment and is never written, logged or echoed:
 *
 *   PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."
 *   Git Bash:    export ANTHROPIC_API_KEY="sk-ant-..."
 *
 * The prompt, the schema and the validation all come from tabletalk.html
 * itself, loaded the same way the test suites load it. That is deliberate: a
 * generator with its own copy of the rules drifts away from the app within a
 * month, and then writes recipes the app quietly rejects.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');
const calories = require('./calories.js');

const APP = path.join(__dirname, '..', 'tabletalk.html');
const MODEL = 'claude-opus-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
const DRY = !!flag('dry-run', false);

if (!API_KEY) {
  console.error('\n  ANTHROPIC_API_KEY is not set.\n');
  console.error('  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."');
  console.error('  Git Bash:    export ANTHROPIC_API_KEY="sk-ant-..."\n');
  process.exit(1);
}

// ── the app, loaded so its own rules are the ones that apply ─────────────────
const vm = require('vm');
const html = fs.readFileSync(APP, 'utf8');
const code = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + '\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+"=v")};';
const els = {};
const stub = id => els[id] || (els[id] = { id, setAttribute() {}, removeAttribute() {},
  hidden: false, innerHTML: '', className: '', style: {}, value: '', textContent: '',
  scrollTop: 0, scrollHeight: 1, scrollWidth: 1, clientWidth: 1, scrollLeft: 0, offsetLeft: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelector: () => stub('x'), querySelectorAll: () => [], focus() {}, select() {} });
const ctx = {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: stub, querySelectorAll: () => [], addEventListener() {} },
  location: { href: 'x', hash: '', pathname: '/', search: '' },
  history: { replaceState() {} }, window: { addEventListener() {} },
  console: { log() {}, warn() {}, error() {} },
  fetch: () => Promise.reject(new Error('no net')), confirm: () => true,
};
ctx.globalThis = ctx; vm.createContext(ctx); new vm.Script(code).runInContext(ctx);
const G = ctx.__g;
const RECIPES = G('ALL_RECIPES');

// ── which cuisine ────────────────────────────────────────────────────────────
let cuisine = flag('cuisine', null);
if (flag('thinnest', false) || !cuisine) {
  const counts = {};
  G('CUISINES').filter(c => c.id !== 'all').forEach(c => { counts[c.id] = 0 });
  RECIPES.forEach(r => { if (r.c in counts) counts[r.c]++ });
  cuisine = Object.keys(counts).sort((a, b) => counts[a] - counts[b])[0];
  console.log(`thinnest cuisine: ${cuisine} (${counts[cuisine]} recipes)`);
}
if (!G('CUISINES').some(c => c.id === cuisine)) {
  console.error(`unknown cuisine "${cuisine}"`);
  process.exit(1);
}
const want = Number(flag('count', G('MAX_GEN_PER_CALL'))) || G('MAX_GEN_PER_CALL');

// ── ask ──────────────────────────────────────────────────────────────────────
function callAnthropic(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(payload),
      },
    }, res => {
      let out = '';
      res.on('data', d => { out += d });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(out) }); }
        catch (e) { reject(new Error(`HTTP ${res.statusCode}: unparseable body`)); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

// The same schema the proxy sends. Kept in one file because it was kept in two:
// with the field descriptions stripped, "c" reached the model as an unlabelled
// letter and came back as "Noodles".
const { RECIPE_SCHEMA } = require('./recipe-schema.js');

(async () => {
  const prompt = ctx.generatePrompt(cuisine, null)
    .replace(/Write \d+ new/, `Write ${want} new`);
  console.log(`asking for ${want} ${cuisine} recipes...`);

  const { status, json } = await callAnthropic({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    system: [{ type: 'text', text: G('GENERATE_SYSTEM') }],
    messages: [{ role: 'user', content: prompt }],
  });

  if (status !== 200) {
    console.error(`API ${status}: ${(json && json.error && json.error.message) || 'unknown'}`);
    process.exit(1);
  }
  if (json.stop_reason === 'refusal') { console.error('the model declined'); process.exit(1); }
  if (json.stop_reason === 'max_tokens') console.error('warning: output hit max_tokens');

  const raw = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { console.error('the reply was not JSON'); process.exit(1); }

  // ── the app's own validator decides ───────────────────────────────────────
  const accepted = [], rejected = [], warnings = [];
  (parsed.recipes || []).forEach(o => {
    const v = ctx.validateGenerated(o, cuisine);
    if (!v.ok) { rejected.push(`${(o && o.t) || 'untitled'} — ${v.why}`); return; }
    // Validation checks the shape of a recipe, and a calorie figure is the
    // right shape whatever it says. Three recipes arrived with figures roughly
    // double what their own ingredients came to, and every check we had passed
    // them. This one does arithmetic instead.
    const cal = calories.check(o);
    if (!cal.ok) { rejected.push(`${o.t} — ${cal.why}`); return; }
    const r = ctx.normaliseGenerated(o, ctx.nextRecipeId());
    delete r.gen;                       // it is joining the catalogue, not a session
    RECIPES.push(r);                    // so nextRecipeId and duplicate checks see it
    accepted.push(r);
    if (cal.level === 'warn') warnings.push(`${r.id} ${r.t} — ${cal.why}`);
  });

  console.log(`\naccepted ${accepted.length}, rejected ${rejected.length}`);
  accepted.forEach(r => console.log(`  + ${r.id}  ${r.t}  (${r.mins} min, ${r.cals} cal, ${r.ing.length} ing)`));
  rejected.forEach(m => console.log(`  - ${m}`));
  if (warnings.length) {
    // Not a verdict — something for whoever reads the pull request. The
    // estimate does not know about bones, shells or trimming, so it is wrong
    // often enough that it must not be allowed to throw work away this close in.
    console.log('\ncalories worth a second look:');
    warnings.forEach(m => console.log(`  ? ${m}`));
  }

  if (!accepted.length) { console.log('\nnothing to write'); process.exit(rejected.length ? 1 : 0); }
  if (DRY) { console.log('\ndry run — nothing written'); process.exit(0); }

  // ── write them into the catalogue ─────────────────────────────────────────
  // JSON.stringify quotes its keys. Every other entry in the catalogue does
  // not, and tools/verify.js reads the file with a regex that expects the house
  // style — so three recipes written the JSON way were invisible to it, and it
  // went on reporting a next free id that was already taken.
  const str = s => JSON.stringify(String(s));
  const kv = o => Object.keys(o).map(k => k + ':' +
    (typeof o[k] === 'number' ? o[k] :
     typeof o[k] === 'boolean' ? o[k] : str(o[k]))).join(',');
  const line = r => {
    const head = `  {id:${r.id},e:${str(r.e)},t:${str(r.t)},c:${str(r.c)},` +
      `mins:${r.mins},cals:${r.cals},rating:${r.rating},serves:${r.serves},desc:${str(r.desc)},`;
    const ing = r.ing.map(i => {
      const base = `{n:${str(i.n)},amt:${str(i.amt)},emoji:${str(i.emoji)},core:${!!i.core}`;
      const sw = (i.swaps || []).length
        ? ',swaps:[' + i.swaps.map(s => '{' + kv({ n: s.n, amt: s.amt, note: s.note }) + '}').join(',') + ']'
        : '';
      return '     ' + base + sw + '}';
    }).join(',' + '\n');
    const steps = r.steps.map(s => {
      const o = { t: s.t, s: s.s };
      if (s.tip) o.tip = s.tip;
      const tail = s.ahead ? ',ahead:true' : '';
      return '     {' + kv(o) + tail + '}';
    }).join(',' + '\n');
    return head + '\n   ing:[\n' + ing + ',\n   ],\n   steps:[\n' + steps + ',\n   ]},';
  };
  const lines = accepted.map(line);
  let src = fs.readFileSync(APP, 'utf8');
  const anchor = '\nconst CUISINES=[';
  const close = src.lastIndexOf('];', src.indexOf(anchor));
  if (close < 0) { console.error('could not find the end of BASE_RECIPES'); process.exit(1); }
  src = src.slice(0, close) + lines.join('\n') + '\n' + src.slice(close);
  fs.writeFileSync(APP, src);
  console.log(`\nwritten into ${path.basename(APP)}`);
  console.log('now run:  node test/check.js tabletalk.html && node test/run.js && node tools/verify.js && node tools/pasta.js');
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
