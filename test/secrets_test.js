// The repository is public, and bots scrape public repositories for API keys
// within minutes of a push. A key committed here is a key spent by strangers.
//
// So: every tracked file is read, and anything shaped like a credential fails
// the suite before it can be pushed. This runs with the rest of the tests, so
// the check happens whether or not anyone remembers to think about it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

// what a credential looks like, without writing one down
const PATTERNS = [
  ['an Anthropic key',   /sk-ant-[A-Za-z0-9_-]{20,}/ ],
  ['an OpenAI key',      /sk-[A-Za-z0-9]{32,}/ ],
  ['an AWS access key',  /AKIA[0-9A-Z]{16}/ ],
  ['a GitHub token',     /gh[pousr]_[A-Za-z0-9]{30,}/ ],
  ['a private key file', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ ],
  ['a bearer token',     /Bearer\s+[A-Za-z0-9._-]{40,}/ ],
];

let files = [];
try {
  files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch (e) {
  files = [];
}

console.log('-- nothing in the repository looks like a credential --');
eq('there are tracked files to read', files.length > 5, true);

const found = [];
files.forEach(rel => {
  const full = path.join(ROOT, rel);
  let body;
  try {
    if (fs.statSync(full).size > 4 * 1024 * 1024) return;
    body = fs.readFileSync(full, 'utf8');
  } catch (e) { return; }
  PATTERNS.forEach(([what, re]) => {
    const m = body.match(re);
    // The test itself carries the patterns, so it is allowed to match them.
    if (m && rel !== 'test/secrets_test.js') found.push(`${rel}: ${what}`);
  });
});
eq('no tracked file carries one', found, []);

console.log('-- the key is only ever read from the environment --');
['marco-proxy.js', 'tools/generate.js'].forEach(rel => {
  const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  eq(rel + ' takes it from process.env', /process\.env\.ANTHROPIC_API_KEY/.test(body), true);
  eq(rel + ' refuses to run without it', /ANTHROPIC_API_KEY is not set/.test(body), true);
  // A key that reaches a log reaches a CI transcript, which is public too.
  // Naming the variable in a message is fine; passing the identifier is not, so
  // this looks for a bare API_KEY rather than the word inside a string.
  const leaks = body.split('\n').filter(line =>
    /console\./.test(line) && /(?<!['"\w])API_KEY\b/.test(line));
  eq(rel + ' never prints the key itself', leaks, []);
});

console.log('-- the app itself has no way to hold one --');
{
  const app = fs.readFileSync(path.join(ROOT, 'tabletalk.html'), 'utf8');
  eq('tabletalk.html never mentions an api key field',
    /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i.test(app), false);
  eq('and talks to the proxy rather than the API',
    /api\.anthropic\.com/.test(app), false);
}

console.log('-- the workflow keeps it in secrets --');
{
  const wf = path.join(ROOT, '.github', 'workflows', 'recipes.yml');
  if (fs.existsSync(wf)) {
    const body = fs.readFileSync(wf, 'utf8');
    eq('the workflow reads it from secrets', /secrets\.ANTHROPIC_API_KEY/.test(body), true);
    eq('and opens a pull request rather than pushing to main',
      /gh pr create/.test(body) && !/git push origin main/.test(body), true);
  } else {
    eq('no workflow to check', true, true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
