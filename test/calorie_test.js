// The calorie checker is a second opinion on a number nothing else was reading.
// Three generated recipes arrived with figures roughly double what their own
// ingredients came to, and every check we had passed them, because validation
// looks at shape and a number is the right shape whatever it says.
//
// Most of what follows is a guard against a bug this file actually had. The
// first version flagged 48% of the hand-written catalogue, and each round of
// digging turned up another ingredient being read as something it was not.
// Those cases are the tests.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const cal = require(path.join(ROOT, 'tools', 'calories.js'));

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};
// most of these are "within a sensible range", because the estimate is rough
// by design and pinning it to an exact number would test the arithmetic rather
// than the judgement
const near = (n, got, lo, hi) => {
  const ok = got >= lo && got <= hi;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${got}, wanted ${lo}-${hi}`));
  ok ? pass++ : fail++;
};

const one = (name, amt) => cal.estimate({ serves: 1, ing: [{ n: name, amt }], steps: [] }).perServing;

console.log('-- an ingredient is read as itself --');
// Every one of these matched the wrong row and moved a dish by thousands of
// calories before the table was reordered.
near('butter beans are beans, not butter', one('Butter beans', '800g'), 700, 1200);
near('chicken broth is stock, not chicken', one('Chicken broth', '1.5 litres'), 100, 300);
near('beef broth is stock, not beef', one('Beef broth', '2 litres'), 150, 400);
near('flour tortillas are bread, not flour', one('Flour tortillas', '8 small'), 700, 1100);
// A steak is not always beef. The same word had salmon classed as red meat and
// shut out of Heart healthy on the other side of the app.
near('a white fish steak is fish, not beef', one('Firm white fish steaks', '600g'), 450, 750);
near('and beef steak is still beef', one('Beef sirloin steak', '600g'), 1200, 1800);
eq('peanut butter is a nut, not a fat', one('Peanut butter', '100g'), 600);

console.log('-- plurals are the same food --');
// "Eggs" missed /\begg\b/ forty times over, "Potatoes" thirteen, "Spring
// onions" twenty-nine — a third of some ingredient lists silently dropped.
['Eggs', 'Potatoes', 'Spring onions', 'Tomatoes', 'Chillies', 'Lentils', 'Anchovy fillets']
  .forEach(n => eq(`"${n}" is recognised`, cal.lookup(n) !== null, true));
// The bare -s rule must not eat the second s of a double: "sea bass fillets"
// became "sea bas fillet" and every sea bass in the catalogue went unrecognised.
eq('sea bass survives singularising', cal.normalise('Sea bass fillets'), 'sea bass fillet');
eq('lemongrass keeps both its esses', cal.normalise('Lemongrass'), 'lemongrass');
eq('and a plural is still cut', cal.normalise('Eggs'), 'egg');
// Shape names take endings the way Italian does; spelling out whole words
// missed the 400g of pasta that was most of the arrabbiata.
['Rigatoncini', 'Bucatini', 'Orecchiette', 'Pappardelle', 'Spaghettini']
  .forEach(n => eq(`"${n}" is pasta`, (cal.lookup(n) || {}).cal, 360));

console.log('-- a quantity is read as what it says --');
eq('grams', cal.grams('400g', 80), 400);
eq('kilograms', cal.grams('1.5kg', 80), 1500);
eq('millilitres', cal.grams('200ml', 80), 200);
eq('litres', cal.grams('2 litres', 80), 2000);
// "l" must be the whole word: allowing it a suffix turned "6 large eggs" into
// six litres of egg, and made a shakshuka read as 2,363 calories a serving.
eq('"6 large" is six of them, not six litres', cal.grams('6 large', 55), 330);
eq('tablespoons', cal.grams('3 tbsp', 15), 45);
// A plain substitution turned 1½ tsp of pepper into 52g of it.
eq('one and a half is not ten and a half', cal.grams('1½ tsp', 5), 7.5);
eq('a bare half still works', cal.grams('½ tsp', 5), 2.5);
// The re-test for small units used \b, and every one of these units is written
// in the plural: garlic was counted as four whole bulbs, prosciutto as 480g.
eq('four cloves is not four bulbs', cal.grams('4 cloves', 60), 32);
eq('eight slices is not eight joints', cal.grams('8 slices', 60), 64);
// An adjective is allowed between the number and the unit.
eq('"2 large handfuls" is a quantity, not a count', cal.grams('2 large handfuls', 100), 60);
// A head or a piece is the whole of one thing; filing them under the small
// units gave a dish 48g of chicken thigh.
eq('six pieces of chicken is six whole thighs', cal.grams('6 pieces', 90), 540);
// "4 x 150g" is four portions; taken at face value four salmon fillets weighed
// 150g between them.
eq('four times 150g is 600g', cal.grams('4 x 150g', 120), 600);
eq('a range takes the lower end', cal.grams('2-3 tbsp', 15), 30);
// The unit can live in the name rather than the amount: twelve lasagne sheets
// were weighed as twelve portions of dry pasta, 960g of it.
eq('twelve sheets are sheets',
  cal.estimate({ serves: 1, steps: [], ing: [{ n: 'Lasagne sheets', amt: '12' }] }).parts[0].g, 180);

console.log('-- dry and cooked are different weights --');
// Rice triples in weight absorbing water; pricing it dry put 1,420 calories of
// rice into four onigiri.
const dry = one('Short-grain rice', '400g'), wet = one('Short-grain rice, cooked', '400g');
eq('cooked rice is lighter work than dry', wet < dry / 2, true);
eq('and dry rice is unchanged', dry, 1420);
eq('cooked chicken is not discounted', one('Cooked chicken', '400g'), 660);

console.log('-- the unlisted pan of oil --');
// Plenty of recipes fry without listing the oil, and the oil is most of the
// calories. Left alone, every stir-fry looked like an overclaim and buried the
// real ones.
const stir = { serves: 4, ing: [{ n: 'Aubergine', amt: '700g' }],
  steps: [{ t: 'Fry', s: 'Fry the aubergine until collapsed.' }] };
const boil = { serves: 4, ing: [{ n: 'Aubergine', amt: '700g' }],
  steps: [{ t: 'Boil', s: 'Simmer the aubergine until soft.' }] };
eq('frying without listed fat gets an allowance', cal.estimate(stir).total > cal.estimate(boil).total + 200, true);
eq('simmering does not', cal.estimate(boil).total, 210);
const oiled = { serves: 4, ing: [{ n: 'Aubergine', amt: '700g' }, { n: 'Olive oil', amt: '3 tbsp' }],
  steps: [{ t: 'Fry', s: 'Fry the aubergine.' }] };
eq('and a recipe that lists its oil is not charged twice',
  cal.estimate(oiled).parts.some(p => /unlisted/.test(p.n)), false);

console.log('-- the verdict --');
const mk = (cals, ing) => ({ cals, serves: 4, ing, steps: [] });
const pasta = [{ n: 'Spaghetti', amt: '400g' }, { n: 'Olive oil', amt: '3 tbsp' },
  { n: 'Garlic', amt: '4 cloves' }, { n: 'Parsley', amt: 'handful' }];
eq('a sound figure passes quietly', cal.check(mk(480, pasta)).level, undefined);
eq('a figure well outside anything is refused', cal.check(mk(2400, pasta)).ok, false);
eq('and refused in the other direction too', cal.check(mk(40, pasta)).ok, false);
eq('a doubtful one warns without blocking', cal.check(mk(900, pasta)).level, 'warn');
eq('a warning is still accepted', cal.check(mk(900, pasta)).ok, true);
// The estimate does not know about bones, shells or trimming, so it must keep
// quiet rather than guess when it has not recognised enough to have a view.
const mystery = mk(400, [{ n: 'Blibbet' }, { n: 'Wozzle' }, { n: 'Spaghetti', amt: '400g' }]);
eq('too little recognised means no opinion', cal.check(mystery).skipped, true);
eq('and no opinion is not a rejection', cal.check(mystery).ok, true);

console.log('-- it agrees with the catalogue it did not write --');
// The real test. A checker that disagrees with 284 hand-written recipes is the
// thing that is wrong, and the first version of this file flagged half of them.
{
  const code = fs.readFileSync(path.join(ROOT, 'tabletalk.html'), 'utf8')
    .match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/)[1] + "\n;globalThis.__g=n=>eval(n);";
  const els = {}, store = {};
  const stub = id => els[id] || (els[id] = { setAttribute() {}, removeAttribute() {}, hidden: false,
    innerHTML: '', className: '', style: {}, value: '', classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => stub('x'), querySelectorAll: () => [], focus() {} });
  const ctx = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v) },
    document: { getElementById: stub, querySelectorAll: () => [], addEventListener() {},
      createElement: () => ({ getContext: () => ({ font: '', measureText: () => ({ width: 20 }) }) }) },
    window: {}, console: { log() {}, warn() {}, error() {} }, fetch: () => Promise.reject(new Error('x')) };
  ctx.globalThis = ctx; vm.createContext(ctx); new vm.Script(code).runInContext(ctx);
  const R = ctx.__g('BASE_RECIPES');

  eq('there are recipes to check against', R.length > 200, true);   // canary
  const judged = R.map(r => cal.check(r)).filter(v => !v.skipped);
  near('nearly all of them can be judged', judged.length, R.length - 15, R.length);
  const refused = judged.filter(v => !v.ok);
  near('and hardly any are refused', refused.length, 0, 8);
  const ratios = judged.map(v => v.ratio).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  near('the estimate is centred on the catalogue, not off to one side', median, 0.8, 1.2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
