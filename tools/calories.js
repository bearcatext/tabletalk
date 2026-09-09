// A second opinion on a calorie figure.
//
// The model is asked for calories per serving and it is confidently, roughly
// doubly, wrong: 420 for a fish braise that adds up to 225, 330 for prawns that
// add up to 140. Nothing caught it, because nothing was checking — validation
// looked at shape, and a number is the right shape whatever it says.
//
// This is not a nutrition database and it is not trying to be. It adds up what
// it recognises and says whether the claim is in the same country as the
// ingredients. It is deliberately built to be quiet: the first version flagged
// half the hand-written catalogue, which is a checker nobody would read twice.
// A figure out by a factor of two is worth a human looking at; one out by a
// third is not, because cuts and portion sizes move further than that on their
// own.
//
// The figure matters beyond accuracy: under 500 a serving is one of the tests
// for Heart healthy, so an inflated number quietly removes a dish from a
// category it belongs in, and a deflated one puts it somewhere it does not.

// Each row is [what it matches, calories per 100g, grams if it is counted
// rather than weighed]. The third number is what "2 onions" or "4 eggs" is
// worth; without it everything counted was read as 80g, and eight tortillas
// came out as 640g of bread.
const FOODS = [
  // Stock comes first, before any meat. "Chicken broth" was matching the
  // chicken row and a litre and a half of it was priced as 2.5kg of breast;
  // "Beef broth" put five thousand calories into a bowl of pho.
  [/\b(stock|broth|dashi|bouillon|water|vinegar|juice)\b/, 12, 250],

  // Beans and nuts come before the fats on purpose. "Butter beans" matched the
  // butter row and 800g of them were priced as 720 cal/100g of fat — one
  // ingredient carrying 5,760 calories on its own. Peanut butter would have
  // gone the same way.
  [/\b(dried .*(bean|chickpea|lentil|pea)|gigantes)\b/, 330, 100],
  [/\b(lentil|chickpea|butter bean|black bean|kidney bean|cannellini|borlotti|haricot|broad bean|bean|dal|dhal|split pea|edamame)\b/, 120, 100],
  [/\b(almond|cashew|walnut|pecan|peanut|pistachio|hazelnut|pine nut|nut butter|nut|sesame|tahini)\b/, 600, 15],

  // fats — small amounts, huge numbers, so worth getting right
  [/\b(olive oil|vegetable oil|sunflower oil|groundnut oil|rapeseed oil|sesame oil|chilli oil|olio|oil)\b/, 880, 15],
  [/\b(butter|ghee|lard|dripping|beef tallow)\b/, 720, 15],
  [/\b(mayonnaise|aioli)\b/, 680, 15],

  // meat and fish
  [/\b(pork belly|duck|lamb|sausage|chorizo|bacon|pancetta|guanciale|salami|prosciutto|lardon)\b/, 340, 60],
  // an escalope is a cutlet beaten flat, not a steak — eight of them feed four
  [/\b(escalope|cutlet|medallion|schnitzel)\b/, 220, 90],
  // Fish before beef, because a steak is not always beef. "Firm white fish
  // steaks" matched the beef row and the leanest thing in the catalogue was
  // priced at 250 cal/100g — the same word that once had salmon classed as red
  // meat and shut out of Heart healthy.
  [/\b(salmon|mackerel|tuna|sardine|trout|anchov\w*|eel)\b/, 200, 120],
  [/\b(prawn|shrimp|squid|octopus|scallop|mussel|clam|crab|lobster|oyster)\b/, 95, 15],
  [/\b(cod|haddock|pollock|hake|sea bass|bream|snapper|tilapia|halibut|monkfish|white fish|fish)\b/, 95, 150],
  [/\b(beef|steak|brisket|short rib|oxtail|veal|mince|minced|ground)\b/, 250, 150],
  [/\b(pork|gammon|ham|meatball)\b/, 250, 30],
  [/\b(chicken thigh|chicken leg|chicken wing|turkey thigh|drumstick)\b/, 210, 90],
  [/\b(chicken breast|turkey breast|turkey|chicken)\b/, 165, 170],

  // dairy and eggs
  [/\b(paneer|halloumi|cheddar|parmesan|parmigiano|pecorino|gruy|manchego|provolone|feta|mozzarella|cheese)\b/, 370, 30],
  [/\b(double cream|heavy cream|creme fraiche|mascarpone|clotted)\b/, 400, 15],
  [/\b(cream)\b/, 300, 15],
  [/\b(yoghurt|yogurt|ricotta|cottage cheese|labneh|soured cream|sour cream)\b/, 100, 30],
  [/\b(coconut milk|coconut cream)\b/, 190, 400],
  [/\b(milk|buttermilk|kefir)\b/, 55, 250],
  [/\b(egg)\b/, 145, 55],

  // starches — listed by dry weight, which is how recipes write them
  // Shape names take endings the way Italian does — rigatoni becomes
  // rigatoncini — so these match on the stem. Spelling out whole words missed
  // the 400g of pasta that was most of the arrabbiata, and the dish read as a
  // bowl of sauce.
  [/\b(pasta|spaghett|linguin|tagliatell|pappardell|fettuccin|penn[ae]|rigaton|bucatin|fusill|farfall|orecchiett|conchigli|paccher|cavatell|trofie|casarecc|strozzapret|garganell|mafaldin|capellin|vermicell|ziti|orzo|macaroni|lasagn|cannellon|raviol|tortellin|gnocchi|noodle|udon|soba|somen|couscous|bulgur|fregola|pastina)\w*/, 360, 80],
  // A gyoza wrapper weighs about six grams and a sheet of rice paper about ten.
  // Counted as bread at 40g each, thirty of them came to 1.2kg and the dish
  // read as four times its real size.
  [/\b(wrapper|rice paper|skin)\b/, 300, 7],
  // Breads before grains: "Flour tortillas" was matching flour, and eight small
  // ones were weighed as 640g of dry flour.
  [/\b(tortilla|tostada|pita|flatbread|naan|roti|paratha|wrap|bun|roll|baguette|brioche|sourdough|dough|pastry|phyllo|filo|bread)\b/, 280, 40],
  [/\b(rice|quinoa|barley|farro|oat|flour|semolina|polenta|cornmeal|masa)\b/, 355, 80],
  [/\b(breadcrumb|panko|crouton|cracker|crisp)\b/, 380, 30],
  [/\b(rice cake|tteok|mochi)\b/, 230, 100],
  [/\b(potato|sweet potato|yam|plantain|cassava|taro)\b/, 85, 180],

  // everything else that carries real calories
  [/\b(tofu|tempeh|seitan|soy curl|fish cake)\b/, 145, 200],
  [/\b(sugar|honey|maple|jaggery|molasses|golden syrup|palm sugar)\b/, 380, 12],
  [/\b(chocolate|cocoa|nutella)\b/, 500, 20],
  [/\b(avocado|olive)\b/, 160, 150],
  [/\b(coconut, |desiccated coconut|shredded coconut)\b/, 350, 20],
  [/\b(raisin|sultana|date|apricot|prune|dried fruit|dried cranberr)\b/, 290, 8],
  [/\b(wine|beer|sake|shaoxing|sherry|vermouth|mirin|rum|brandy|ouzo)\b/, 85, 15],

  // sauces and pastes: strong flavours in small amounts
  [/\b(fish sauce|soy sauce|tamari|worcestershire|shoyu|liquid amino)\b/, 60, 15],
  [/\b(miso|gochujang|doenjang|hoisin|oyster sauce|chunjang|black bean sauce|tamarind|ketchup|barbecue sauce)\b/, 180, 15],
  [/\b(curry paste|harissa|chipotle|adobo|tomato pur|tomato paste|pesto|mustard|pico de gallo|sriracha|sambal|gochugaru|doubanjiang|chilli paste|hot sauce|bbq sauce|salsa|caper|pickle|paste|sauce)\b/, 150, 15],
  [/\b(canned tomato|chopped tomato|passata|plum tomato|san marzano|crushed tomato)\b/, 30, 400],

  // seasonings — the amounts are small, so the exact figure barely matters, but
  // leaving them unrecognised was dropping half the ingredient list on a curry
  // and making the estimate meaningless
  [/\b(salt|pepper flakes|black pepper|white pepper|peppercorn)\b/, 0, 5],
  [/\b(cumin|coriander seed|turmeric|paprika|masala|cinnamon|cardamom|clove|star anise|fennel seed|mustard seed|nutmeg|saffron|sumac|za'atar|zaatar|curry powder|five spice|oregano|thyme|rosemary|bay lea\w*|herbe de provence|chilli powder|chili powder|spice|seasoning|yeast|baking powder|bicarbonate|cornflour|cornstarch|gelatin)\b/, 300, 3],

  // vegetables, herbs, aromatics. Nearly free, but they have to be recognised
  // or the estimate is built on too little to mean anything.
  [/\b(onion|shallot|spring onion|scallion|leek|garlic|ginger|galangal|lemongrass|celery|carrot)\b/, 40, 60],
  [/\b(tomatillo|tomato|pepper|capsicum|chilli|chili|chile|jalape|serrano|habanero|poblano|guajillo|ancho)\b/, 30, 90],
  [/\b(courgette|zucchini|aubergine|eggplant|squash|pumpkin|cucumber|radish|turnip|beetroot|swede|parsnip)\b/, 30, 200],
  [/\b(mushroom|cabbage|kimchi|sauerkraut|spinach|kale|chard|greens|lettuce|pak choi|bok choy|broccoli|cauliflower|green bean|pea|corn|sprout|asparagus|okra|fennel)\b/, 35, 100],
  [/\b(lime|lemon)\b/, 30, 60],
  [/\b(orange|apple|pear|mango|pineapple|banana|berry|berries|peach|plum|grape|melon|papaya|tamarind)\b/, 50, 150],
  [/\b(basil|coriander|cilantro|parsley|mint|dill|chive|tarragon|sage|shiso|perilla|curry lea|herb|garnish|leaf|leaves|salad|seaweed|nori|kombu|wakame|sprouts)\b/, 30, 20],
];

// Plurals were the single biggest hole: "Eggs" missed /\begg\b/ forty times
// over, "Potatoes" thirteen, "Spring onions" twenty-nine. Rather than write
// every plural into every pattern, names are singularised before matching —
// the same trick rx() plays for the diet rules.
function normalise(name) {
  return String(name || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')                       // "(optional)", "(about 2)"
    .split(/[,;]/)[0]                               // "Onions, finely sliced"
    .replace(/\b(\w*[^aeious])ies\b/g, '$1i')       // chillies -> chilli
    .replace(/\b(\w+(?:ch|sh|ss|x|o))es\b/g, '$1')  // tomatoes -> tomato
    // The bare -s rule must not eat the second s of a double: "sea bass fillets"
    // became "sea bas fillet" and every sea bass in the catalogue went
    // unrecognised. Nor may it touch a word that ends in -ss to begin with.
    .replace(/\b(\w{2,}[^s])s\b/g, '$1')             // eggs -> egg
    .trim();
}

// Grams a quantity is worth. A row is either a fixed weight per unit, or one
// of two tags meaning "a fraction of one whole item" — a clove is not a bulb,
// a sprig is not a bunch of thyme.
//
// The sizing tag lives on the row rather than being re-tested against the text
// afterwards, because the re-test used \b and every one of these units is
// written in the plural: "4 cloves" and "8 slices" both failed it, so garlic
// was counted as four whole bulbs and prosciutto as 480g of ham.
// An adjective is allowed to sit between the number and the unit: "2 large
// handfuls" was reading as a bare 2 and multiplying by the whole-item weight.
const SMALL = 'small', BIG = 'big';
const ADJ = String.raw`(?:\s+(?:large|small|medium|big|generous|heaped|level|thin|thick|whole|good|scant|packed|dried|fresh))*\s*`;
const u = (unit, mult) => [new RegExp(String.raw`(\d+(?:\.\d+)?)` + ADJ + unit), mult];
const UNITS = [
  u(String.raw`kg\b`, 1000),
  u(String.raw`(?:g|gram)s?\b`, 1),
  u(String.raw`(?:ml|millilit)`, 1),
  // "l" must be the whole word. Allowing it a suffix turned "6 large eggs"
  // into six litres of egg.
  u(String.raw`(?:l|litres?|liters?)\b`, 1000),
  u('tbsp', 15),
  u('tsp', 5),
  u('cup', 200),
  u('(?:can|tin|jar)', 400),
  u('(?:clove|sprig|stick|stalk|sheet|slice|rasher|leaf|leaves)', SMALL),
  // A bunch or a handful is part of something; a head or a piece is the whole
  // of one. Filing "6 pieces chicken thighs" under the small units gave the
  // dish 48g of chicken.
  u('(?:bunch|handful)', BIG),
  u('(?:head|piece|fillet|breast|thigh)', 'each'),
];

// Units that live in the ingredient's name rather than its amount: "Lasagne
// sheets, 12" is twelve sheets, not twelve portions. Without this a lasagne
// weighed 960g of pasta and came out at two and a half times its real size.
const SMALL_IN_NAME = /\b(sheet|clove|slice|rasher|sprig|leaf|leaves|stick|stalk)s?\b/i;

function grams(amt, each, name) {
  const t = String(amt || '').toLowerCase()
    // "1½" is one and a half, not ten and a half — a plain substitution turned
    // 1½ tsp of pepper into 52g of it.
    .replace(/(\d)\s*½/g, '$1.5').replace(/(\d)\s*¼/g, '$1.25').replace(/(\d)\s*¾/g, '$1.75')
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/(\d)\s*[-–]\s*\d+/g, '$1');           // "2-3 chillies" -> 2
  // "4 x 150g" is four portions, not one. Taken at face value the first number
  // was ignored and four salmon fillets weighed 150g between them.
  const mult2 = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (mult2) {
    const scale = { kg: 1000, g: 1, ml: 1, l: 1000 }[mult2[3]];
    return parseFloat(mult2[1]) * parseFloat(mult2[2]) * scale;
  }
  for (const [re, mult] of UNITS) {
    const m = t.match(re);
    if (!m) continue;
    const n = parseFloat(m[1]);
    if (mult === SMALL) return n * Math.min(each, 8);
    if (mult === BIG) return n * Math.min(each, 30);
    if (mult === 'each') return n * each;
    return n * mult;
  }
  const bare = t.match(/(\d+(?:\.\d+)?)/);          // "4", "2 large", "1 whole"
  if (bare) {
    const per = SMALL_IN_NAME.test(name || '') ? Math.min(each, 15) : each;
    return parseFloat(bare[1]) * per;
  }
  if (/handful|bunch|small|few/.test(t)) return Math.min(each, 30);
  if (/to taste|pinch|dash|drizzle|splash|garnish/.test(t)) return 3;
  return each;
}

// Grains, pasta and pulses are listed by dry weight nine times in ten, and the
// table is priced for that. When a recipe says "2 cups cooked rice" it means
// something that has already tripled in weight by absorbing water, and pricing
// it dry put 1,420 calories of rice into four onigiri.
const DRY = /\b(pasta|spaghett|rigaton|noodle|rice|quinoa|barley|farro|couscous|bulgur|lentil|chickpea|bean|dal)/i;
const COOKED = /\bcooked\b/i;

function lookup(name, amt) {
  const n = normalise(name);
  for (const [re, cal, each] of FOODS) {
    if (!re.test(n)) continue;
    const wet = COOKED.test(`${name} ${amt || ''}`) && DRY.test(n);
    return { cal: wet ? Math.round(cal * 0.35) : cal, each };
  }
  return null;
}

const FAT = /\b(oil|butter|ghee|lard|dripping|tallow|bacon|pancetta|guanciale|coconut milk|cream)\b/i;
const FRYING = /\b(fry|fries|fried|frying|sauté|saute|sear|sizzl|shallow|deep-fr|stir-fr|toss the pan|hot pan|smoking)\b/i;

// Returns the estimate and what it could not place, so a wrong answer can be
// argued with rather than only disbelieved.
function estimate(recipe) {
  let total = 0;
  const unknown = [], parts = [];
  (recipe.ing || []).forEach((i) => {
    const f = lookup(i.n, i.amt);
    if (!f) { unknown.push(i.n); return; }
    const g = grams(i.amt, f.each, i.n);
    const c = (g / 100) * f.cal;
    total += c;
    parts.push({ n: i.n, amt: i.amt, g: Math.round(g), cal: Math.round(c) });
  });

  // Plenty of recipes fry in a pan without listing the oil — the stir-fries and
  // the aubergine dishes especially, where the oil is most of the calories. Left
  // alone, every one of them looked like an overclaim and buried the real ones.
  // Two tablespoons is the smallest honest allowance for a pan.
  const listsFat = (recipe.ing || []).some(i => FAT.test(i.n));
  const fries = (recipe.steps || []).some(s => FRYING.test(`${s.t} ${s.s}`));
  if (!listsFat && fries) {
    total += 265;
    parts.push({ n: '(unlisted cooking oil)', amt: '2 tbsp', g: 30, cal: 265 });
  }

  const serves = Number(recipe.serves) || 4;
  const n = (recipe.ing || []).length;
  return {
    perServing: Math.round(total / serves),
    total: Math.round(total),
    unknown, parts,
    recognised: n - unknown.length,
    coverage: n ? (n - unknown.length) / n : 0,
  };
}

// Two thresholds, because one cannot do both jobs.
//
// Both are set from the spread of the 284 recipes already in the catalogue,
// where the middle of the distribution sits at 0.93 and the p95 at 1.95. REJECT
// is past anything the catalogue does — it throws out 4 of 284, and a figure
// that far out is not defensible. WARN is a note for whoever reads the pull
// request, not a verdict.
//
// Being straight about what this buys: of the two wrong figures that prompted
// it, the checker would have warned on one (Ca kho to, claimed 420 against an
// estimate of 220) and let the other through (Tom rim, claimed 330 against 220
// — a ratio of 1.50, which is inside what ordinary recipes vary by). Pulling
// WARN down far enough to catch that one flags a quarter of the catalogue,
// which is a warning nobody would read twice. So this catches gross errors and
// raises an eyebrow at the rest; it does not make the number trustworthy.
const REJECT = 3;
const WARN = 1.6;

// Below this much of the ingredient list recognised, the estimate is built on
// too little to argue with anything.
const MIN_COVERAGE = 0.8;

function check(recipe) {
  const est = estimate(recipe);
  const claimed = Number(recipe.cals);
  const n = (recipe.ing || []).length;
  if (est.coverage < MIN_COVERAGE || est.recognised < 3) {
    return { ok: true, skipped: true, est,
      why: `only ${est.recognised} of ${n} ingredients recognised — no opinion` };
  }
  if (!est.perServing || !claimed) {
    return { ok: true, skipped: true, est, why: 'nothing to weigh against' };
  }
  const ratio = claimed / est.perServing;
  const out = Math.max(ratio, 1 / ratio);
  const why = `claims ${claimed} cal a serving; the ingredients come to about ${est.perServing}`;
  if (out >= REJECT) return { ok: false, level: 'reject', est, ratio, why };
  if (out >= WARN) return { ok: true, level: 'warn', est, ratio, why };
  return { ok: true, est, ratio };
}

module.exports = { estimate, check, grams, lookup, normalise, REJECT, WARN, MIN_COVERAGE };
