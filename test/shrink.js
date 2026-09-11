#!/usr/bin/env node
// Does the suite still pass when the catalogue changes underneath it?
//
//   node test/shrink.js            drop every 7th recipe, run everything
//   node test/shrink.js 3          drop every 3rd
//
// The suites used to name the dishes they tested with — "Spaghetti carbonara"
// in nine places, scallops as the ingredient nobody cooks with. That works
// until someone renames a recipe or writes the dish the test assumed did not
// exist, and then the failure reads "cannot read properties of undefined" in a
// suite that has nothing to do with the change. Six assertions broke the day
// three scallop recipes were added.
//
// So the fixtures are found by property now, and this is what proves it: build
// a catalogue with a chunk of the recipes removed and run the lot against it.
// Anything that still depends on a particular dish existing fails here, at the
// cost of one command, rather than in three weeks.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const every = Number(process.argv[2]) || 7;
const NL = '\n';

const lines = fs.readFileSync(path.join(ROOT, 'tabletalk.html'), 'utf8').split(NL);
const out = [];
let i = 0, seen = 0, dropped = 0;
while (i < lines.length) {
  if (/^  \{id:\d+,e:/.test(lines[i])) {
    seen++;
    // an entry runs to its closing "   ]}," line
    let j = i;
    while (j < lines.length && lines[j].indexOf('   ]},') !== 0) j++;
    if (seen % every === 0) { dropped++; i = j + 1; continue; }
  }
  out.push(lines[i++]);
}

const tmp = path.join(ROOT, 'shrunk-tmp.html');
fs.writeFileSync(tmp, out.join(NL));
console.log(`dropped ${dropped} of ${seen} recipes (every ${every}th)\n`);

let code = 0;
try {
  const res = execFileSync(process.execPath, [path.join(__dirname, 'run.js'), tmp],
    { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(res.split(NL).slice(-6).join(NL));
} catch (e) {
  process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
  console.log('\nA suite depends on a recipe that is no longer there.');
  console.log('Find the fixture by name and replace it with test/pick.js.');
  console.log('\nOne kind of failure here is not a bug: assertions about the');
  console.log('catalogue being big enough — "the category is worth having" —');
  console.log('are meant to fail when it really does shrink. A deep cut trips');
  console.log('those honestly. The default of every 7th does not.');
  code = 1;
} finally {
  fs.unlinkSync(tmp);
}
process.exit(code);
