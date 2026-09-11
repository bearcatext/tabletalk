# Tabletalk

A single-file recipe app. Browse 220 recipes by cuisine, diet, or what's already
in your cupboard; plan a week of dinners; take the shopping list to your phone.

## Running it

Open `tabletalk.html` in a browser. That's the whole app — no build step, no
server, no install. It works from `file://` and keeps your data in the browser's
local storage.

Everything except Chef Marco works this way: browsing, search, diets, pantry
matching, favourites, the weekly plan, the shopping list and its QR code, and
adding your own recipes.

## Chef Marco (optional)

Marco and the "New recipes" button call the Claude API. The key must not live in
`tabletalk.html` — the file is opened straight from disk, so anything in it is
readable by anyone who opens it. A small local proxy holds the key instead.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
node marco-proxy.js
```

On Windows PowerShell, set the key with `$env:ANTHROPIC_API_KEY = "sk-ant-..."`
instead. Then reload `tabletalk.html`.

The proxy listens on `127.0.0.1:8787` — loopback only, deliberately not
`0.0.0.0`, because it holds the key. Set `MARCO_PORT` to change the port. The
page sends only `{ system, messages }`; the model, token ceiling, effort and
response schema are pinned in the proxy so a stray page on localhost cannot
spend the key on an arbitrary model or an unbounded request.

If the proxy isn't running, the Marco and "New recipes" controls are still
shown — nothing probes for the proxy at load time. The failure surfaces when you
use them, as "Marco isn't running. Start the proxy first: node marco-proxy.js".
Everything else in the app works regardless.

## Getting the shopping list to your phone

Pick meals with the basket button, open **Plan**, then:

- **Scan to phone** — a QR code. Works with no network, no account and nothing
  installed; every modern phone camera reads one. A week of meals is comfortably
  within capacity.
- **Send to phone** — the OS share sheet (AirDrop, Messages, Notes). Only appears
  where the browser supports it, which is mostly phones and tablets.
- **Email**, **Copy**, **Print** — work everywhere.

## Layout

```
tabletalk.html     the entire app — markup, styles, data, logic
marco-proxy.js     local Claude proxy; holds the API key, loopback only
test/              19 suites, ~1,040 assertions
tools/verify.js    recipe catalogue checker (counts, duplicates, cuisine mismatches)
tools/calories.js  second opinion on a calorie figure, from the ingredients up
tools/pasta.js     every pasta dish against Funke's four rules
```

## Tests

```bash
npm test
```

Runs every suite against `tabletalk.html` and prints one total. `check.js` runs
first as a gate — if the script block doesn't parse, everything else would fail
for the same uninteresting reason.

Two tests in `qr_test.js` cross-check the inlined QR encoder, module for module,
against a reference implementation. That's an optional dev dependency, so those
are skipped unless you install it:

```bash
npm install
```

`test/qr-scan-test.html` renders real QR codes at three list sizes for checking
that a phone actually reads them — the one thing the suites cannot verify.

Run a single suite, or point any of them at a different build:

```bash
node test/search_test.js
node test/run.js some-other-build.html
```

### Fixtures are found, not named

A suite that does `R.find(r => r.t === 'Spaghetti carbonara')` gets a recipe
today and a broken build the day someone renames that dish. It is not
hypothetical: six assertions failed the moment three scallop recipes were
added, because they had named scallops as the ingredient the catalogue did not
have — and the failure surfaced in a suite that had nothing to do with the
change.

So tests ask for a recipe with a *property* — one that is a swap away from
gluten-free, one with nothing to do ahead — through `test/pick.js`, which
fails saying what it could not find rather than handing back `undefined`.

```bash
node test/shrink.js      # drop every 7th recipe, run everything against the rest
node test/shrink.js 3    # a harsher cut
```

Anything still tied to one dish fails here. A deep cut will also trip
assertions about the catalogue being *big enough* — those are meant to fail
when it really shrinks.

## The API key

One key, two places, and never in a file.

Make it at [console.anthropic.com](https://console.anthropic.com) under API
keys. Then:

- **For Marco, locally.** Put it in your shell, not in a file:

  ```bash
  export ANTHROPIC_API_KEY="sk-ant-..."   # PowerShell: $env:ANTHROPIC_API_KEY = "..."
  node marco-proxy.js
  ```

- **For the weekly recipes.** GitHub → Settings → Secrets and variables →
  Actions → New repository secret, named `ANTHROPIC_API_KEY`.

It never goes in `tabletalk.html`, never in a committed file, and never in a
message to anyone. **This repository is public**, and bots scrape public
repositories for keys within minutes of a push. `test/secrets_test.js` reads
every tracked file on every test run and fails the suite if anything shaped
like a credential appears.

If a key is ever exposed, revoke it in the console first and worry about the
git history second — rewriting history does not un-scrape it.

## Writing recipes

```bash
node tools/generate.js --thinnest --dry-run   # see what it would write
node tools/generate.js --cuisine Korean --count 3
```

The prompt, the schema and the validation all come from `tabletalk.html`
itself, loaded the way the test suites load it. A generator carrying its own
copy of the rules drifts away from the app within a month and then writes
recipes the app quietly rejects.

`.github/workflows/recipes.yml` runs it every Monday, puts the result through
every check the catalogue has, and **opens a pull request rather than pushing**.

### What the checks reach, and what they do not

The generated recipes were real dishes with the right names, the right
structure and the house spelling. What they got wrong was cooking: garlic into
bare caramel with no fat in the pan, 400g of pork seared "in one layer", a
dipping sauce at two parts fish sauce to four parts lime, and calorie figures
close to double what the ingredients came to. **Every automated check passed
all four**, because validation reads shape and all four were the right shape.

`tools/calories.js` closes the one of those that arithmetic can reach. It adds
up the ingredient list and refuses a figure three times out from the total,
warning in the middle ground rather than blocking — it knows nothing about
bones, shells or trimming, so it has to be allowed to be wrong. Calibrated
against the 284 hand-written recipes it sits at a median of 0.93 and objects to
seven of them. Being straight about the limit: of the two bad figures that
prompted it, it would have warned on one and let the other through at 1.50.

Heat, ratios and batch sizes are now spelled out in the generation prompt, with
the specific mistakes named. That is a prompt, not a check — **read the diff**.

## House rules for pasta

Evan Funke’s four, and every pasta dish in the catalogue follows them:

| Rule | What it means | Why |
| --- | --- | --- |
| Salt the water | Until it tastes like mild seawater | Seasons the pasta from the inside out. It is the only chance you get. |
| Ditch the cream | No heavy cream in a traditional sauce | The sauce binds on starch coming off the pasta, not on dairy fat. |
| Toss hard | Work it into the sauce, do not fold | Pulling the starch out is what turns fat and water into an emulsion. |
| Undercook | Pull it a minute or two early | It finishes in the pan and takes the flavour of the sauce with it. |

```bash
node tools/pasta.js
```

Nothing is exempt. What changes between dishes is the mechanism, not whether a
rule applies:

- **The water** is whatever liquid the pasta cooks in — a pot of it, the broth
  of a pasta e fagioli, or the ragu and bechamel a dry lasagne sheet swells into.
- **Stop it short** is satisfied by finishing in a pan, by resting off the heat,
  or by going into the oven still chalky.

## Still to build

Four areas to grow into, each with the same shape as the dinner catalogue —
ingredients, steps, swaps, servings that scale:

- **Cocktails** — the recipe shape mostly fits, but calories are close to
  meaningless, the diet classifier has little to say, and steps run to two or
  three lines. Likely its own mode rather than a cuisine.
- **Snacks** — fits the existing shape almost exactly.
- **Bread** — proving and resting are long waits rather than work, so the
  make-ahead model already in the app matters more here than anywhere else.
  "45 minutes" means something different when 40 of them are the dough sitting
  on its own.
- **Pasta** — making it, not cooking with it. Few ingredients, technique-heavy,
  so the weight falls on the step text rather than the ingredient list.

## Notes

Your data (favourites, pantry, plan, your own recipes, Marco's history) lives in
browser local storage under `dw_` keys. The prefix predates the rename and is
left alone deliberately — renaming it would orphan everything already saved.
