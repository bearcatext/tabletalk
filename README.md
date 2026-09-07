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
test/              12 suites, ~347 assertions
tools/verify.js    recipe catalogue checker (counts, duplicates, cuisine mismatches)
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
