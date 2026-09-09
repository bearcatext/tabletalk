#!/usr/bin/env node
/**
 * Tabletalk — Chef Marco local API proxy.
 *
 * Why this exists: tabletalk.html is opened straight from disk, so any API key
 * pasted into it is readable by anyone who opens the file, and
 * anthropic-dangerous-direct-browser-access would expose it to every script on
 * the page. This proxy keeps the key in the server process instead.
 *
 *   1. set the key in your shell (never in a file you share):
 *        Windows PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."
 *        Git Bash / macOS:    export ANTHROPIC_API_KEY="sk-ant-..."
 *   2. node marco-proxy.js
 *   3. open tabletalk.html and talk to Marco
 *
 * The client sends only { system, messages }. Model, token ceiling, effort,
 * response schema, and caching are pinned here so a stray page on localhost
 * cannot spend the key on an arbitrary model or an unbounded request.
 */

const http = require('http');
const https = require('https');

const PORT = Number(process.env.MARCO_PORT || 8787);
const HOST = '127.0.0.1';                 // loopback only — never 0.0.0.0
const API_KEY = process.env.ANTHROPIC_API_KEY;

// Two jobs, two engines.
//
// Writing a recipe is reasoning: ingredient ratios, step order, honest swaps,
// a calorie estimate, all inside an eight-ingredient cap. That is worth Opus.
//
// A chat reply is two or three sentences over recipes the app has already
// found for itself — the retrieval never needed a model at all. Haiku answers
// that several times faster, which is the difference between a reply and a
// wait. Override either to compare them:
//
//   $env:MARCO_CHAT_MODEL = 'claude-opus-5'
const CHAT_MODEL = process.env.MARCO_CHAT_MODEL || 'claude-haiku-4-5-20251001';
const GEN_MODEL  = process.env.MARCO_GEN_MODEL  || 'claude-opus-5';
const MAX_TOKENS = 8192;   // thinking is ON by default on Opus 5 and shares this
                           // ceiling with the reply — 500 would truncate mid-answer
const MAX_BODY_BYTES = 2 * 1024 * 1024;

if (!API_KEY) {
  console.error('\n  ANTHROPIC_API_KEY is not set.\n');
  console.error('  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."');
  console.error('  Git Bash:    export ANTHROPIC_API_KEY="sk-ant-..."\n');
  process.exit(1);
}

// Marco answers with a short reply plus recipe ids. A schema removes the
// ```json fencing / parse-retry dance the old client-side code needed.
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Marco’s reply, 2–3 sentences.' },
    recipe_ids: {
      type: 'array',
      description: 'Up to 4 recipe ids that answer the question. Empty if none fit.',
      items: { type: 'integer' },
    },
    // Lets Marco escalate from "nothing matches" to "I can write you one".
    suggest_generate: {
      type: 'boolean',
      description:
        'True only when the user wanted a specific dish or style and nothing in the list genuinely fits. False when recipe_ids answers them, or when they were not asking for a recipe.',
    },
    generate_brief: {
      type: 'string',
      description:
        'When suggest_generate is true: one line naming the dish to write and any constraint the user gave. Empty string otherwise.',
    },
    generate_cuisine: {
      type: 'string',
      description:
        'When suggest_generate is true: the cuisine the dish belongs to, e.g. Vietnamese. Empty string otherwise.',
    },
  },
  required: ['text', 'recipe_ids', 'suggest_generate', 'generate_brief', 'generate_cuisine'],
  additionalProperties: false,
};

// Recipe generation. Every field is required (no optionals) because structured
// outputs are strictest that way; the client drops empty `tip`/`swaps` after.
// Note: minItems/maxItems/minLength are NOT supported by structured outputs —
// count and length rules live in the prompt instead, and the client re-checks.
// Shared with tools/generate.js so the two cannot drift. They did once, and it
// cost three recipes.
const { RECIPE_SCHEMA } = require('./tools/recipe-schema.js');

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',   // file:// pages send Origin: null
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(body);
}

const { makeReader } = require('./tools/stream-text.js');

// The same request, held open. onDelta gets the words of the reply as they
// arrive; the promise resolves with the whole thing once it has.
//
// This exists for one reason: waiting several seconds looking at nothing is a
// worse experience than waiting the same several seconds watching an answer
// appear. The reply is no faster. It just stops feeling like a wait.
function streamAnthropic(payload, onDelta) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.assign({}, payload, { stream: true }));
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (r) => {
      if (r.statusCode !== 200) {
        let err = '';
        r.on('data', (c) => (err += c));
        r.on('end', () => {
          let j = null;
          try { j = JSON.parse(err) } catch (e) {}
          resolve({ status: r.statusCode, json: j || { error: { message: 'API error' } } });
        });
        return;
      }
      const reader = makeReader();
      let pending = '', stop = null, usage = {};
      r.setEncoding('utf8');
      r.on('data', (chunk) => {
        pending += chunk;
        // SSE frames are separated by a blank line; a frame split across two
        // packets has to wait rather than be parsed in half.
        let cut;
        while ((cut = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, cut);
          pending = pending.slice(cut + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()) } catch (e) { continue }
          if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
            const words = reader.push(ev.delta.text);
            if (words) onDelta(words);
          } else if (ev.type === 'message_delta') {
            if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
            if (ev.usage) usage = Object.assign(usage, ev.usage);
          } else if (ev.type === 'message_start' && ev.message && ev.message.usage) {
            usage = Object.assign(usage, ev.message.usage);
          } else if (ev.type === 'error') {
            reject(new Error((ev.error && ev.error.message) || 'stream error'));
          }
        }
      });
      r.on('end', () => {
        let json;
        try { json = JSON.parse(reader.raw()) }
        catch (e) { return reject(new Error('the streamed reply was not whole')) }
        resolve({ status: 200, json: json, stop_reason: stop, usage: usage });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
      },
      (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode, json: JSON.parse(data) });
          } catch (e) {
            reject(new Error(`bad JSON from API (HTTP ${r.statusCode})`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const ROUTES = ['/marco', '/generate'];

// Server-sent events, because the browser has to POST a conversation to start
// one and EventSource cannot. Each frame is one line of JSON:
//
//   {"d":"..."}    more of the reply
//   {"end":{...}}  the whole structured object, once it is whole
//   {"error":""}   something went wrong; the app falls back to a local answer
async function streamChat(res, ask, tag) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const frame = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
  try {
    const out = await streamAnthropic(ask, (words) => frame({ d: words }));
    if (out.status !== 200) {
      const msg = (out.json && out.json.error && out.json.error.message) || 'API error';
      console.error(`${tag} API ${out.status}: ${msg}`);
      frame({ error: msg });
      return res.end();
    }
    if (out.stop_reason === 'refusal') {
      console.error(`${tag} refused`);
      frame({ error: 'The model declined this request.' });
      return res.end();
    }
    const u = out.usage || {};
    console.log(
      `${tag} ok  ${CHAT_MODEL}  in=${u.input_tokens ?? 0}  ` +
        `cache_read=${u.cache_read_input_tokens ?? 0}  out=${u.output_tokens ?? 0}`
    );
    frame({ end: out.json });
    res.end();
  } catch (e) {
    console.error(`${tag} ` + e.message);
    frame({ error: 'upstream request failed' });
    res.end();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' || !ROUTES.includes(req.url)) {
    return send(res, 404, { error: 'POST /marco or /generate' });
  }
  const route = req.url;

  let raw = '';
  let tooBig = false;
  req.on('data', (c) => {
    raw += c;
    if (raw.length > MAX_BODY_BYTES) {
      tooBig = true;
      req.destroy();
    }
  });

  req.on('end', async () => {
    if (tooBig) return send(res, 413, { error: 'request too large' });
    let incoming;
    try {
      incoming = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }
    if (!Array.isArray(incoming.messages) || incoming.messages.length === 0) {
      return send(res, 400, { error: 'messages[] required' });
    }

    const gen = route === '/generate';
    const tag = gen ? '[generate]' : '[marco]';

    const ask = {
      model: gen ? GEN_MODEL : CHAT_MODEL,
      // Recipes are long; chat replies are not.
      max_tokens: gen ? 32000 : MAX_TOKENS,
      // Low effort keeps a chat reply fast. Thinking stays on: disabling it
      // on Opus 5 can leak <thinking> tags into the visible answer, and the
      // generate route is still Opus.
      output_config: {
        effort: gen ? 'medium' : 'low',
        format: { type: 'json_schema', schema: gen ? RECIPE_SCHEMA : REPLY_SCHEMA },
      },
      system: incoming.system,
      messages: incoming.messages,
    };

    // Nobody watches a recipe being written — that runs on a schedule and opens
    // a pull request. Somebody is always watching a chat reply.
    if (!gen) return streamChat(res, ask, tag);

    try {
      const { status, json } = await callAnthropic(ask);

      if (status !== 200) {
        console.error(`${tag} API ${status}: ${json?.error?.message || 'unknown'}`);
        return send(res, status, { error: json?.error?.message || 'API error' });
      }
      // A refusal is HTTP 200 with an empty/partial body — check before reading.
      if (json.stop_reason === 'refusal') {
        console.error(`${tag} refused (${json.stop_details?.category || 'unknown'})`);
        return send(res, 422, { error: 'The model declined this request.' });
      }
      if (json.stop_reason === 'max_tokens') {
        console.error(`${tag} hit max_tokens — output truncated`);
        return send(res, 422, { error: 'Ran out of room. Try asking for fewer recipes.' });
      }

      const u = json.usage || {};
      console.log(
        `${tag} ok  ${gen ? GEN_MODEL : CHAT_MODEL}  in=${u.input_tokens ?? 0}  ` +
          `cache_write=${u.cache_creation_input_tokens ?? 0}  ` +
          `cache_read=${u.cache_read_input_tokens ?? 0}  ` +
          `out=${u.output_tokens ?? 0}`
      );
      return send(res, 200, json);
    } catch (e) {
      console.error(`${tag} ` + e.message);
      return send(res, 502, { error: 'upstream request failed' });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Chef Marco proxy → http://${HOST}:${PORT}/marco`);
  console.log(`  chat  ${CHAT_MODEL}  · max_tokens ${MAX_TOKENS} · effort low`);
  console.log(`  write ${GEN_MODEL}  · max_tokens 32000 · effort medium`);
  console.log('  routes: /marco (chat) · /generate (new recipes)');
  console.log('  cache_read > 0 on the second message means caching is working.\n');
});
