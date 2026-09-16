// Where the catalogue is thin, measured the way people actually browse it.
//
// The weekly job has always asked for "the thinnest cuisine", and that stopped
// being a useful question once every cuisine passed twenty. It now tops up
// whichever is marginally smallest while the real holes sit somewhere else
// entirely: nine cuisine-and-diet combinations hold fewer than five recipes,
// and vegan runs at three or four in most cuisines. Someone who picks Chinese
// and then taps Vegan gets three dishes, for ever, because nothing was looking
// at that number.
//
// The picker offers three ways in — a cuisine, a diet, or a cuisine narrowed by
// a diet — so coverage is counted all three ways and the emptiest shelf wins.

// What "enough" looks like for each kind of shelf. A pair needs fewer than a
// whole cuisine does, but five is about where a category stops feeling broken.
const TARGETS = { cuisine: 20, diet: 40, pair: 5 };

// Diets nobody should be asked to write around. Nut-free is the catalogue's
// default state rather than a style of cooking, so topping it up specifically
// would just be writing more recipes.
const NOT_WORTH_TARGETING = ['nf'];

// ctx is the app loaded in a VM; G reaches its consts.
function coverage(ctx, G) {
  const recipes = G('ALL_RECIPES').filter(r => !r.own && !r.sharedBy);
  const cuisines = G('CUISINES').map(c => c.id).filter(c => c !== 'all');
  const diets = G('DIET_CATS').map(c => c.id);
  const label = id => (G('DIET_CATS').find(c => c.id === id) || {}).short || id;
  const ok = (r, d) => ctx.dietStatus(r, d).ok;

  const gaps = [];
  const note = (kind, have, opts) => {
    const want = TARGETS[kind];
    if (have >= want) return;
    gaps.push(Object.assign({
      kind, have, want,
      // How empty, not how many short: three of five is a worse hole than
      // eighteen of twenty, and without this every gap would be a cuisine gap.
      shortfall: (want - have) / want,
    }, opts));
  };

  cuisines.forEach(c => {
    const inC = recipes.filter(r => r.c === c);
    note('cuisine', inC.length, { cuisine: c, diet: null, what: c });
    diets.forEach(d => {
      if (NOT_WORTH_TARGETING.indexOf(d) >= 0) return;
      note('pair', inC.filter(r => ok(r, d)).length,
        { cuisine: c, diet: d, what: `${label(d)} ${c}` });
    });
  });
  diets.forEach(d => {
    if (NOT_WORTH_TARGETING.indexOf(d) >= 0) return;
    note('diet', recipes.filter(r => ok(r, d)).length,
      { cuisine: null, diet: d, what: label(d) });
  });

  gaps.sort((a, b) => b.shortfall - a.shortfall || a.have - b.have);
  return { gaps, recipes: recipes.length, targets: TARGETS };
}

// The one thing to write next, as something the generator can be told.
function thinnest(ctx, G) {
  const { gaps } = coverage(ctx, G);
  if (!gaps.length) return null;
  const g = gaps[0];
  const name = g.diet ? ((G('DIET_CATS').find(c => c.id === g.diet) || {}).short || g.diet) : '';
  return {
    cuisine: g.cuisine || '',
    diet: g.diet || '',
    brief: g.diet ? `${name} dishes` : '',
    // The rule goes on its own line in the prompt rather than into the brief,
    // where it would read as "dairy-free — no milk, cream... dishes".
    rule: g.diet ? dietBrief(G, g.diet) : '',
    why: `${g.what} has ${g.have} of ${g.want}`,
    gap: g,
  };
}

// Spelling out the rule beats naming the category: "vegan" alone invites a
// recipe with honey or fish sauce in it, and then the run has been paid for
// without closing the gap it was aimed at.
const DIET_BRIEFS = {
  vgn: 'strictly vegan — no meat, fish, shellfish, egg, dairy or honey, and no fish sauce, oyster sauce or shrimp paste',
  veg: 'vegetarian — no meat, fish or shellfish, and nothing with fish sauce, oyster sauce, shrimp paste or anchovy in it',
  gf:  'gluten-free — no wheat, barley or rye, and use tamari rather than soy sauce',
  df:  'dairy-free — no milk, cream, butter, yoghurt or cheese of any kind',
  hh:  'heart healthy — lean protein, under 500 calories a serving, nothing deep-fried and no red meat',
};
function dietBrief(G, id) {
  return DIET_BRIEFS[id] || ((G('DIET_CATS').find(c => c.id === id) || {}).short || id);
}

module.exports = { coverage, thinnest, dietBrief, TARGETS, NOT_WORTH_TARGETING };
