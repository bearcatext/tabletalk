#!/usr/bin/env node
/**
 * Tabletalk — write new recipes into the catalogue, without a browser.
 *
 *   node tools/generate.js --plan                 where the catalogue is thin
 *   node tools/generate.js --thinnest             write for the emptiest shelf
 *   node tools/generate.js --cuisine Korean --count 3
 *   node tools/generate.js --cuisine Chinese --diet vgn
 *   node tools/generate.js --brief "grilled scallops"
 *   node tools/generate.js --thinnest --dry-run   write nothing, just report
 *
 * --plan needs no key: where the catalogue is thin is a question about the
 * catalogue. --thinnest counts coverage the way the picker is used — a cuisine,
 * a diet, and a cuisine narrowed by a diet — rather than asking only which
 * cuisine has fewest, which stopped meaning anything once they all passed
 * twenty. A run aimed at a diet rejects recipes that miss it.
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
// Asking where the catalogue is thin is a question about the catalogue, so it
// does not need a key and should be answerable on any machine.
const PLAN = !!flag('plan', false);

if (!API_KEY && !PLAN) {
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
// A brief is a specific ask — "grilled scallops", "a pasta with clams" — and it
// is the point of the request queue: someone asked Marco for something the
// catalogue did not have, and this is where it gets written. Given one, the
// cuisine is optional and whoever writes the recipe picks what suits the dish.
let brief = flag('brief', null);
if (typeof brief === 'boolean') { console.error('--brief needs some words'); process.exit(1); }
let cuisine = flag('cuisine', null);
if (typeof cuisine === 'boolean') cuisine = null;
// The diet the run is aimed at, if any. Recipes that miss it are rejected:
// a run aimed at a hole that does not fill it has been paid for twice.
let needDiet = flag('diet', null);
if (typeof needDiet === 'boolean') needDiet = null;
let dietRule = '';

if (!cuisine && brief) {
  cuisine = '';                         // the writer chooses
} else if (flag('thinnest', false) || !cuisine) {
  // "Thinnest cuisine" stopped being a useful question once every cuisine
  // passed twenty: it tops up whichever is marginally smallest while the real
  // holes are elsewhere. Coverage is counted the way the picker is used —
  // cuisine, diet, and a cuisine narrowed by a diet — and the emptiest wins.
  const { coverage, thinnest } = require('./coverage.js');
  const next = thinnest(ctx, G);
  if (!next) {
    console.log('every shelf is above its target — nothing to top up');
    process.exit(0);
  }
  if (!PLAN) console.log(`aiming at the emptiest shelf: ${next.why}`);
  cuisine = next.cuisine;
  if (next.brief) { brief = next.brief; needDiet = next.diet; dietRule = next.rule; }
}
if (needDiet && !dietRule) {
  const { dietBrief } = require('./coverage.js');
  dietRule = dietBrief(G, needDiet);
}
if (needDiet && !G('DIET_CATS').some(c => c.id === needDiet)) {
  console.error(`unknown diet "${needDiet}"`);
  process.exit(1);
}
if (cuisine && !G('CUISINES').some(c => c.id === cuisine)) {
  console.error(`unknown cuisine "${cuisine}"`);
  process.exit(1);
}
const want = Number(flag('count', G('MAX_GEN_PER_CALL'))) || G('MAX_GEN_PER_CALL');

if (PLAN) {
  const { coverage } = require('./coverage.js');
  const report = coverage(ctx, G);
  console.log(`\n${report.recipes} recipes, ${report.gaps.length} shelves below target\n`);
  report.gaps.forEach(g => console.log(
    `  ${String(g.have).padStart(3)}/${g.want}  ${g.kind.padEnd(8)}${g.what}`));
  console.log(`\nnext run would write ${want} ${cuisine || 'any-cuisine'}` +
    (brief ? ` ${brief}` : ' recipes'));
  process.exit(0);
}

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
  let prompt = ctx.generatePrompt(cuisine, brief, want);
  // Spelled out rather than named. "Vegan" on its own comes back with honey in
  // it, or fish sauce, and the hole the run was aimed at is still there.
  if (dietRule) prompt += `\n\nEvery one of these must be ${dietRule}.`;
  console.log(`asking for ${want} ${cuisine || 'any-cuisine'} recipes` +
    (brief ? `: ${brief}` : '') + '...');

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
    // The run was aimed at a hole. A recipe that does not sit in it is not a
    // bad recipe, but it does not close the gap, and accepting it means the
    // shelf stays empty and next week aims at the same place again. The app's
    // own classifier decides, not the model's word for it.
    if (needDiet) {
      // dietStatus memoises on the recipe id, and nextRecipeId only moves when
      // a recipe is accepted — so a rejected candidate hands its id, and its
      // cached verdict, to the next one. One dish with cheese in it therefore
      // failed the whole batch: three rejected, nothing written, exit 1. The
      // cache has to be cleared before each candidate is judged.
      ctx.clearDietCache();
      const st = ctx.dietStatus(r, needDiet);
      if (!st.ok) {
        // Named "blockers", and reaching for st.blocking meant the one line
        // that says which ingredient did it was quietly left off.
        const why = st.fixable ? 'only with a swap' : 'not at all';
        rejected.push(`${r.t} — asked for ${needDiet}, ${why}` +
          (st.blockers && st.blockers.length ? `: ${st.blockers.join(', ')}` : ''));
        return;
      }
    }
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

  if (!accepted.length) {
    // Say what to do about it. "Nothing to write" on its own, under a red
    // cross, tells whoever opens the run only that something went wrong.
    console.log('\nnothing to write — every recipe was refused above.');
    if (needDiet) {
      console.log(`The run was aimed at ${needDiet}. If the refusals all name the`);
      console.log('same ingredient, the rule in tools/coverage.js needs to say so');
      console.log('plainly; if they name different ones, ask again.');
    }
    process.exit(rejected.length ? 1 : 0);
  }
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
    // The day it was written. Without it a recipe that arrives on a Monday is
    // indistinguishable from one that shipped in the first commit, and the
    // weekly drip lands silently — which is what it did for the first batch.
    const head = `  {id:${r.id},e:${str(r.e)},t:${str(r.t)},c:${str(r.c)},` +
      `mins:${r.mins},cals:${r.cals},rating:${r.rating},serves:${r.serves},` +
      `added:${str(r.added || new Date().toISOString().slice(0, 10))},desc:${str(r.desc)},`;
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
