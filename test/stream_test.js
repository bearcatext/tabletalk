// Reading a reply out of half-finished JSON, one packet at a time. The failure
// mode this guards is cosmetic but ugly: a chunk that ends mid-escape putting a
// stray backslash on screen, then correcting itself a moment later.
const path = require('path');
const { visibleTextSoFar, makeReader } = require(path.join(__dirname, '..', 'tools', 'stream-text.js'));

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

console.log('-- reading a reply that has not finished arriving --');
eq('nothing before the field starts', visibleTextSoFar('{"te'), null);
eq('empty once it does', visibleTextSoFar('{"text":"'), { text: '', done: false });
eq('the words so far', visibleTextSoFar('{"text":"Try the k'), { text: 'Try the k', done: false });
eq('and it knows when it is finished',
  visibleTextSoFar('{"text":"Try the korma.","recipe_ids":[1]}'),
  { text: 'Try the korma.', done: true });

console.log('-- escapes that land on a chunk boundary --');
eq('a lone trailing backslash waits', visibleTextSoFar('{"text":"line\\'), { text: 'line', done: false });
eq('a completed newline comes through', visibleTextSoFar('{"text":"line\\nnext'), { text: 'line\nnext', done: false });
eq('an escaped quote is not the end',
  visibleTextSoFar('{"text":"say \\"hi\\" back'), { text: 'say "hi" back', done: false });
eq('a half-written unicode escape waits',
  visibleTextSoFar('{"text":"caf\\u00'), { text: 'caf', done: false });
eq('and arrives whole', visibleTextSoFar('{"text":"caf\\u00e9"'), { text: 'café', done: true });

console.log('-- one packet at a time --');
{
  const whole = '{"text":"Two minutes short of al dente.","recipe_ids":[86],"suggest_generate":false,"generate_brief":""}';
  // every possible split point, to be sure none of them drops or repeats a letter
  for (let cut = 1; cut < whole.length; cut++) {
    const r = makeReader();
    const got = r.push(whole.slice(0, cut)) + r.push(whole.slice(cut));
    if (got !== 'Two minutes short of al dente.') {
      eq('split at ' + cut + ' reassembles', got, 'Two minutes short of al dente.');
      break;
    }
  }
  eq('every split point reassembles exactly', true, true);
}
{
  // and byte by byte, the worst case
  const whole = '{"text":"caf\\u00e9 \\"quoted\\"\\nnewline","recipe_ids":[]}';
  const r = makeReader();
  let got = '';
  for (const ch of whole) got += r.push(ch);
  eq('character by character, escapes and all', got, 'café "quoted"\nnewline');
}

console.log('-- only what is new --');
{
  const r = makeReader();
  eq('first packet', r.push('{"text":"Hello'), 'Hello');
  eq('second gives only the addition', r.push(' there'), ' there');
  eq('a packet with no new text gives nothing', r.push('","recipe_ids"'), '');
  eq('the raw buffer is kept for the final parse',
    JSON.parse(r.raw() + ':[7]}').recipe_ids, [7]);
}

console.log('-- a reply with no text field at all --');
{
  const r = makeReader();
  eq('yields nothing rather than throwing', r.push('{"recipe_ids":[1,2]}'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
