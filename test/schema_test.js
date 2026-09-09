// The recipe schema uses one-letter keys, so the field descriptions are the only
// thing telling the model what they mean. tools/generate.js once carried its own
// copy with the descriptions stripped: "c" arrived as an unlabelled letter and
// came back as "Noodles" and "Main" instead of the cuisine, and three generated
// recipes were paid for and thrown away by validation.
//
// So: one copy, and every key that could be guessed wrong has to say what it is.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { RECIPE_SCHEMA } = require(path.join(ROOT, 'tools', 'recipe-schema.js'));

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

const recipe = RECIPE_SCHEMA.properties.recipes.items;

console.log('-- the short keys say what they are --');
// these are the ones a model cannot infer from a single letter
[['c', /cuisine/i], ['e', /emoji/i], ['t', /name|dish/i], ['desc', /line|character/i]]
  .forEach(([key, wants]) => {
    const d = (recipe.properties[key] || {}).description || '';
    eq(`"${key}" is described`, d.length > 0, true);
    eq(`and the description says what it means`, wants.test(d), true);
  });
eq('the cuisine field insists on matching the request',
  /match(es)? the requested/i.test(recipe.properties.c.description), true);

console.log('-- the nested ones too --');
{
  const ing = recipe.properties.ing.items.properties;
  eq('core explains itself', /essential|substitut/i.test(ing.core.description || ''), true);
  eq('swaps say when they are required', /core|empty/i.test(ing.swaps.description || ''), true);
  const swap = ing.swaps.items.properties;
  eq('a swap amount says not to copy the original',
    /adjust|not copied/i.test(swap.amt.description || ''), true);
  const step = recipe.properties.steps.items.properties;
  eq('a step title is described', (step.t.description || '').length > 0, true);
  eq('a step body is described', (step.s.description || '').length > 0, true);
}

console.log('-- the shape matches what the app will accept --');
{
  eq('every field the app requires is required',
    recipe.required.slice().sort(),
    ['c', 'cals', 'desc', 'e', 'ing', 'mins', 'rating', 'steps', 't'].sort());
  eq('nothing else may be sent', recipe.additionalProperties, false);
  eq('recipes come back in an array', RECIPE_SCHEMA.properties.recipes.type, 'array');
}

console.log('-- there is exactly one copy of it --');
{
  // A second declaration is how the descriptions got lost the first time.
  const others = ['marco-proxy.js', 'tools/generate.js'].filter(rel => {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return /^const RECIPE_SCHEMA\s*=\s*\{/m.test(body);
  });
  eq('nobody declares their own', others, []);
  ['marco-proxy.js', 'tools/generate.js'].forEach(rel => {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    eq(rel + ' requires the shared one', /require\(['"][./]*(tools\/)?recipe-schema\.js['"]\)/.test(body), true);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
