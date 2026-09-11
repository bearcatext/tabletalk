// Fixtures found, not named.
//
// A test needs a recipe with a property — one that is a swap away from
// gluten-free, one with nothing that can be done ahead, one that is not easy.
// Writing `R.find(r => r.t === 'Spaghetti carbonara')` gets such a recipe today
// and ties the suite to the catalogue for ever: the day that dish is renamed or
// removed, `carb` is undefined and the failure reads "cannot read properties of
// undefined" somewhere unrelated.
//
// It is not hypothetical. Six marco_test assertions failed the moment three
// scallop recipes were added, because they had named scallops as the ingredient
// the catalogue did not have. The canary caught it, but the fix was to stop
// naming things.
//
// pick() says what it needs and fails saying so.
function pick(list, test, what) {
  const hits = (list || []).filter(test);
  if (!hits.length) throw new Error(`no recipe fits this test's premise: ${what}`);
  return hits[0];
}

// The same, when the test wants to know there are several.
function pickAll(list, test, what, least) {
  const hits = (list || []).filter(test);
  const need = least || 1;
  if (hits.length < need) {
    throw new Error(`needed ${need} recipes for: ${what} — found ${hits.length}`);
  }
  return hits;
}

// A word of the given kind that no recipe uses. Used to test what the app says
// when it has not got something: naming the ingredient outright means the test
// breaks the day someone cooks with it.
function absentWord(list, candidates, ok) {
  const inUse = w => (list || []).some(r =>
    new RegExp(w, 'i').test(r.t + ' ' + r.ing.map(i => i.n).join(' ')));
  const found = candidates.find(w => (!ok || ok(w)) && !inUse(w));
  if (!found) throw new Error('every candidate is now in the catalogue: ' + candidates.join(', '));
  return found;
}

module.exports = { pick, pickAll, absentWord };
