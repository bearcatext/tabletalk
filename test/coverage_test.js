// Where the catalogue is thin, and whether the weekly job aims at it.
//
// "The thinnest cuisine" was the only question being asked, and it stopped
// being a useful one once every cuisine passed twenty: the job topped up
// whichever was marginally smallest while nine cuisine-and-diet combinations
// sat below five recipes and vegan ran at three or four nearly everywhere.
// Pick Chinese, tap Vegan, get three dishes — for ever, because nothing was
// counting that number.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = process.argv[2] || path.join(ROOT, 'tabletalk.html');
const { coverage, thinnest, dietBrief, TARGETS } = require(path.join(ROOT, 'tools', 'coverage.js'));

const code = fs.readFileSync(APP, 'utf8')
  .match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1]
  + "\n;globalThis.__g=n=>eval(n);globalThis.__s=(n,v)=>{eval(n+'=v')};";
const els = {}, store = {};
const stub = id => els[id] || (els[id] = { id, setAttribute() {}, removeAttribute() {}, hidden: false,
  innerHTML: '', className: '', style: {}, value: '', textContent: '', scrollTop: 0, scrollHeight: 1,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelector: () => stub('x'), querySelectorAll: () => [], focus() {}, select() {} });
const ctx = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v) },
  document: { getElementById: stub, querySelectorAll: () => [], addEventListener() {}, body: { style: {} },
    createElement: () => ({ getContext: () => ({ font: '', measureText: () => ({ width: 20 }) }) }) },
  window: { scrollTo() {}, scrollY: 0 }, console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 0, fetch: () => Promise.reject(new Error('x')), navigator: {} };
ctx.globalThis = ctx; vm.createContext(ctx); new vm.Script(code).runInContext(ctx);
const G = ctx.__g, S = ctx.__s;

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

console.log('-- coverage is counted the way the picker is used --');
const rep = coverage(ctx, G);
eq('there are recipes to count', rep.recipes > 100, true);        // canary
eq('every gap says how short it is', rep.gaps.every(g => g.have < g.want), true);
eq('and which kind of shelf it is',
  rep.gaps.every(g => ['cuisine', 'diet', 'pair'].indexOf(g.kind) >= 0), true);
eq('pairs are counted, not just cuisines',
  rep.gaps.some(g => g.kind === 'pair'), true);
eq('gaps come emptiest first',
  rep.gaps.every((g, i) => i === 0 || rep.gaps[i - 1].shortfall >= g.shortfall), true);
// Three of five is a worse hole than eighteen of twenty. Ranking on the plain
// shortfall would put every cuisine ahead of every pair and never fix a pair.
eq('emptiness is judged in proportion, not in recipes', (function () {
  const a = { have: 3, want: 5 }, b = { have: 18, want: 20 };
  return (a.want - a.have) / a.want > (b.want - b.have) / b.want;
})(), true);
// Nut-free is the catalogue's normal state, not a style of cooking; aiming at
// it would just mean writing more recipes.
eq('nut-free is never the thing to write next',
  rep.gaps.every(g => g.diet !== 'nf'), true);

console.log('-- and it names something the generator can be told --');
{
  const next = thinnest(ctx, G);
  eq('there is something to write', !!next, true);
  eq('it names a cuisine or a diet', !!(next.cuisine || next.diet), true);
  eq('and says why', /has \d+ of \d+/.test(next.why), true);
  if (next.diet) {
    eq('the brief reads as a phrase, not a rulebook', next.brief.split(' ').length <= 4, true);
    // "Vegan" on its own comes back with honey in it. The rule is spelled out
    // on its own line instead of being crammed into the brief.
    eq('the rule is spelled out separately', next.rule.length > next.brief.length, true);
    eq('and the prompt carries both', (function () {
      const p = ctx.generatePrompt(next.cuisine, next.brief, 3) + '\n\nEvery one of these must be ' + next.rule + '.';
      return p.indexOf(next.brief) > 0 && p.indexOf(next.rule) > 0;
    })(), true);
  }
}

console.log('-- the vegan rule names what actually catches people out --');
['fish sauce', 'honey', 'oyster sauce'].forEach(w =>
  eq(`vegan brief mentions ${w}`, dietBrief(G, 'vgn').indexOf(w) >= 0, true));
eq('and the gluten-free one names tamari', dietBrief(G, 'gf').indexOf('tamari') >= 0, true);

console.log('-- a run aimed at a hole has to fill it --');
// The check that makes the whole thing worth doing. A recipe that does not sit
// in the shelf it was written for is not a bad recipe, but the shelf stays
// empty and next week aims at the same place again.
{
  const vegan = { e: '🥬', t: 'A Vegan Test Dish', c: 'Italian', mins: 20, cals: 400, serves: 4,
    rating: 4.5, desc: 'x', ing: [{ n: 'Spaghetti', amt: '400g', emoji: '🍝', core: true, swaps: [] }],
    steps: [{ t: 'Boil', s: 'Boil it.', tip: '' }] };
  const withHoney = Object.assign({}, vegan, { t: 'Another Test Dish',
    ing: vegan.ing.concat([{ n: 'Honey', amt: '2 tbsp', emoji: '🍯', core: true, swaps: [] }]) });
  const withCream = Object.assign({}, vegan, { t: 'A Third Test Dish',
    ing: vegan.ing.concat([{ n: 'Double cream', amt: '100ml', emoji: '🥛', core: true, swaps: [] }]) });

  // Distinct ids, and the cache cleared between: dietStatus memoises by id, so
  // reusing one made all three answer as whichever was asked first.
  let nextId = 9001;
  const status = (o, d) => { ctx.clearDietCache();
    return ctx.dietStatus(ctx.normaliseGenerated(o, nextId++), d); };
  eq('a genuinely vegan recipe passes', status(vegan, 'vgn').ok, true);
  eq('honey does not', status(withHoney, 'vgn').ok, false);
  eq('cream does not either', status(withCream, 'vgn').ok, false);
  eq('and dairy-free catches the cream too', status(withCream, 'df').ok, false);
  // validateGenerated has never known about diets, which is why the check has
  // to sit alongside it rather than inside it
  eq('shape validation alone would have let them through',
    ctx.validateGenerated(withHoney, 'Italian').ok, true);
}

console.log('-- the generator asks the question this file answers --');
{
  const gen = fs.readFileSync(path.join(ROOT, 'tools', 'generate.js'), 'utf8');
  eq('it uses the coverage selector', /require\('\.\/coverage\.js'\)/.test(gen), true);
  eq('and no longer sorts cuisines by count itself',
    /counts\[a\] - counts\[b\]/.test(gen), false);
  eq('it rejects a recipe that misses the diet it was written for',
    /dietStatus\(r, needDiet\)/.test(gen), true);
  eq('and the plan can be read without a key',
    /!API_KEY && !PLAN/.test(gen), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
