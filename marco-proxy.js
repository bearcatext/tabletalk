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

const MODEL = 'claude-opus-5';
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
const SWAP = {
  type: 'object',
  properties: {
    n: { type: 'string', description: 'Substitute ingredient name.' },
    amt: { type: 'string', description: 'Amount, adjusted for the substitute — not copied from the original.' },
    note: { type: 'string', description: 'Honest effect, e.g. "hotter, deeply smoky" or "lighter, less rich".' },
  },
  required: ['n', 'amt', 'note'],
  additionalProperties: false,
};
const INGREDIENT = {
  type: 'object',
  properties: {
    n: { type: 'string' },
    amt: { type: 'string' },
    emoji: { type: 'string', description: 'One common food emoji. Avoid emoji added after 2019.' },
    core: { type: 'boolean', description: 'True if essential to the dish and not substitutable.' },
    swaps: { type: 'array', description: 'Empty when core is true, otherwise 2-3 substitutes.', items: SWAP },
  },
  required: ['n', 'amt', 'emoji', 'core', 'swaps'],
  additionalProperties: false,
};
const STEP = {
  type: 'object',
  properties: {
    t: { type: 'string', description: 'Short step title.' },
    s: { type: 'string', description: 'The instruction.' },
    tip: { type: 'string', description: 'Optional chef tip, or an empty string.' },
  },
  required: ['t', 's', 'tip'],
  additionalProperties: false,
};
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          e: { type: 'string', description: 'One food emoji for the dish.' },
          t: { type: 'string', description: 'Dish name.' },
          c: { type: 'string', description: 'Cuisine — must match the requested one exactly.' },
          mins: { type: 'integer' },
          cals: { type: 'integer' },
          rating: { type: 'number' },
          desc: { type: 'string', description: 'One line, under 90 characters.' },
          ing: { type: 'array', items: INGREDIENT },
          steps: { type: 'array', items: STEP },
        },
        required: ['e', 't', 'c', 'mins', 'cals', 'rating', 'desc', 'ing', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
};

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

    try {
      const { status, json } = await callAnthropic({
        model: MODEL,
        // Recipes are long; chat replies are not.
        max_tokens: gen ? 32000 : MAX_TOKENS,
        // Low effort keeps a chat reply fast. Thinking stays on: disabling it
        // on Opus 5 can leak <thinking> tags into the visible answer.
        output_config: {
          effort: gen ? 'medium' : 'low',
          format: { type: 'json_schema', schema: gen ? RECIPE_SCHEMA : REPLY_SCHEMA },
        },
        system: incoming.system,
        messages: incoming.messages,
      });

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
        `${tag} ok  in=${u.input_tokens ?? 0}  ` +
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
  console.log(`  model ${MODEL} · max_tokens ${MAX_TOKENS} · effort low`);
  console.log('  routes: /marco (chat) · /generate (new recipes)');
  console.log('  cache_read > 0 on the second message means caching is working.\n');
});
