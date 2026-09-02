#!/usr/bin/env node
// Runs every suite against the app and reports one total.
//
//   node test/run.js                  — test ../tabletalk.html
//   node test/run.js path/to/app.html — test a specific build
//
// check.js runs first and is a hard gate: if the single <script> block does not
// parse, every other suite would fail for the same uninteresting reason.
const {execFileSync} = require('child_process');
const path = require('path');
const fs = require('fs');

const APP = process.argv[2] || path.join(__dirname, '..', 'tabletalk.html');
if (!fs.existsSync(APP)) {
  console.error('app not found: ' + APP);
  process.exit(2);
}

const SUITES = ['test', 'picker_test', 'profile_test', 'gen_test', 'fresh_test', 'marco_test',
  'diet2_test', 'allergy_test', 'plan_test', 'own_test', 'qr_test', 'search_test'];

const run = f => execFileSync(process.execPath, [path.join(__dirname, f), APP],
  {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

console.log('app: ' + path.relative(process.cwd(), APP));

// gate
try {
  const out = run('check.js');
  process.stdout.write(out);
  if (!/OK \(/.test(out)) { console.error('\ncheck.js did not report OK — stopping.'); process.exit(1); }
} catch (e) {
  console.error('check.js failed:\n' + (e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}
console.log('');

let passed = 0, failed = 0, broke = [];
for (const name of SUITES) {
  let out;
  try {
    out = run(name + '.js');
  } catch (e) {
    // a suite that exits non-zero still printed its results; keep them
    out = (e.stdout || '') + (e.stderr || '');
  }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (!m) {
    broke.push(name);
    console.log(name.padEnd(14) + 'NO RESULT');
    console.log(out.split('\n').slice(-6).map(l => '    ' + l).join('\n'));
    continue;
  }
  const p = +m[1], f = +m[2];
  passed += p; failed += f;
  const skipped = (out.match(/ {2}SKIP {2}/g) || []).length;
  console.log(name.padEnd(14) + `${p} passed, ${f} failed` + (skipped ? `, ${skipped} skipped` : ''));
  if (f) out.split('\n').filter(l => l.indexOf('  FAIL  ') >= 0).forEach(l => console.log('    ' + l.trim()));
}

console.log('\n' + '-'.repeat(46));
console.log(`${passed} passed, ${failed} failed across ${SUITES.length} suites`);
if (broke.length) console.log('suites that produced no result: ' + broke.join(', '));
process.exitCode = (failed || broke.length) ? 1 : 0;
