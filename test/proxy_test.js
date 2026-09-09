// Drives the proxy end to end against a stand-in for the Anthropic API, so the
// streaming path is exercised without a key and without spending anything.
//
// api.anthropic.com is redirected to a local server by overriding the hostname
// the proxy dials. That is the only thing faked: the SSE framing, the partial
// JSON, the chunk boundaries and the proxy's own responses are all real.
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

// ── a stand-in upstream that streams a reply in awkward pieces ───────────────
const REPLY = '{"text":"Two minutes short of al dente \\u2014 it finishes in the pan.","recipe_ids":[86],"suggest_generate":false,"generate_brief":"","generate_cuisine":""}';

function sseFrames(body, pieces) {
  const out = ['event: message_start\ndata: ' + JSON.stringify({
    type: 'message_start', message: { usage: { input_tokens: 8250, cache_read_input_tokens: 8200 } } }) + '\n\n'];
  const size = Math.ceil(body.length / pieces);
  for (let i = 0; i < body.length; i += size) {
    out.push('event: content_block_delta\ndata: ' + JSON.stringify({
      type: 'content_block_delta', delta: { type: 'text_delta', text: body.slice(i, i + size) } }) + '\n\n');
  }
  out.push('event: message_delta\ndata: ' + JSON.stringify({
    type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 24 } }) + '\n\n');
  return out;
}

function startFakeApi(frames, status) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d });
      req.on('end', () => {
        seen.push(JSON.parse(body));
        if (status && status !== 200) {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'nope' } }));
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // one frame at a time, so the proxy has to cope with real boundaries
        let i = 0;
        const tick = () => {
          if (i >= frames.length) return res.end();
          res.write(frames[i++]);
          setTimeout(tick, 1);
        };
        tick();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
let seen = [];

// ── the proxy, pointed at it ─────────────────────────────────────────────────
function startProxy(apiPort, port, env) {
  const src = fs.readFileSync(path.join(ROOT, 'marco-proxy.js'), 'utf8')
    .replace(/hostname: 'api\.anthropic\.com'/g, `hostname: '127.0.0.1', port: ${apiPort}`)
    .replace(/const https = require\('https'\);/, "const https = require('http');");
  const tmp = path.join(ROOT, '.proxy-under-test.js');
  fs.writeFileSync(tmp, src);
  const cp = require('child_process');
  const p = cp.spawn(process.execPath, [tmp], {
    env: Object.assign({}, process.env, { ANTHROPIC_API_KEY: 'test-key', MARCO_PORT: String(port) }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise(resolve => {
    let out = '';
    p.stdout.on('data', d => { out += d; if (/routes:/.test(out)) resolve({ p, tmp, banner: out }) });
    setTimeout(() => resolve({ p, tmp, banner: out }), 2500);
  });
}

function post(port, route, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => {
        const frames = [];
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', c => {
          buf += c;
          let cut;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, cut); buf = buf.slice(cut + 2);
            const d = line.split('\n').find(l => l.startsWith('data:'));
            if (d) { try { frames.push(JSON.parse(d.slice(5).trim())) } catch (e) {} }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], frames, raw: buf }));
      });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

(async () => {
  console.log('-- a chat reply arrives in pieces --');
  {
    seen = [];
    const api = await startFakeApi(sseFrames(REPLY, 7));
    const { p, tmp } = await startProxy(api.address().port, 8791);
    const r = await post(8791, '/marco', {
      system: [{ type: 'text', text: 'persona' }],
      messages: [{ role: 'user', content: 'how long do I boil it' }],
    });
    eq('the response is a stream', /text\/event-stream/.test(r.type || ''), true);
    const deltas = r.frames.filter(f => 'd' in f);
    eq('the words came through in more than one piece', deltas.length > 1, true);
    eq('and reassemble into the reply',
      deltas.map(f => f.d).join(''), 'Two minutes short of al dente — it finishes in the pan.');
    const end = r.frames.find(f => f.end);
    eq('the structured object arrives whole at the end', !!end, true);
    eq('with the recipe it picked', end && end.end.recipe_ids, [86]);
    eq('the unicode escape survived', /—/.test(deltas.map(f => f.d).join('')), true);
    p.kill(); api.close(); fs.unlinkSync(tmp);
  }

  console.log('-- the request the proxy actually sends --');
  {
    eq('it asked for a stream', seen[0].stream, true);
    eq('chat uses the chat model', /haiku/i.test(seen[0].model), true);
    eq('at low effort', seen[0].output_config.effort, 'low');
    eq('the cache breakpoint is passed through untouched',
      JSON.stringify(seen[0].system), JSON.stringify([{ type: 'text', text: 'persona' }]));
  }

  console.log('-- writing recipes is not streamed --');
  {
    seen = [];
    const api = await startFakeApi([], 500);       // status only; body unused
    const { p, tmp } = await startProxy(api.address().port, 8792);
    await post(8792, '/generate', { system: [], messages: [{ role: 'user', content: 'write one' }] });
    eq('it did not ask for a stream', !seen[0].stream, true);
    eq('and used the writing model', /opus/i.test(seen[0].model), true);
    eq('at medium effort', seen[0].output_config.effort, 'medium');
    p.kill(); api.close(); fs.unlinkSync(tmp);
  }

  console.log('-- when the API says no --');
  {
    seen = [];
    const api = await startFakeApi([], 429);
    const { p, tmp } = await startProxy(api.address().port, 8793);
    const r = await post(8793, '/marco', { system: [], messages: [{ role: 'user', content: 'hi' }] });
    const err = r.frames.find(f => f.error);
    eq('the app is told rather than left hanging', !!err, true);
    eq('and the stream is closed', r.frames.length > 0, true);
    p.kill(); api.close(); fs.unlinkSync(tmp);
  }

  console.log('-- the model can be swapped to compare them --');
  {
    seen = [];
    const api = await startFakeApi(sseFrames(REPLY, 3));
    const { p, tmp } = await startProxy(api.address().port, 8794, { MARCO_CHAT_MODEL: 'claude-opus-5' });
    await post(8794, '/marco', { system: [], messages: [{ role: 'user', content: 'hi' }] });
    eq('the override is honoured', seen[0].model, 'claude-opus-5');
    p.kill(); api.close(); fs.unlinkSync(tmp);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
