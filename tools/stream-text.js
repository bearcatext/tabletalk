// Marco replies as structured JSON, which does not stream in any useful way:
// half a JSON object parses as nothing at all. But "text" is the first field in
// REPLY_SCHEMA, so the reply itself arrives before anything else, and it can be
// read out of the half-finished buffer while the rest is still coming.
//
// That is the whole trick. Everything downstream just appends strings.
//
// The awkward part is escapes landing on a chunk boundary: a buffer ending in a
// lone backslash, or halfway through é. Emitting those raw would put a
// stray backslash on screen and then correct itself a moment later, which looks
// like a glitch. So a truncated escape stops the read and waits for more.

const KEY = '"text":"';

function visibleTextSoFar(buf) {
  const at = buf.indexOf(KEY);
  if (at < 0) return null;                    // the field has not started yet
  let out = '';
  for (let i = at + KEY.length; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\\') {
      const nxt = buf[i + 1];
      if (nxt === undefined) break;           // escape split across chunks
      if (nxt === 'u') {
        if (i + 5 >= buf.length) break;       // \uXXXX split across chunks
        const hex = buf.substr(i + 2, 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      out += nxt === 'n' ? '\n' : nxt === 't' ? '\t' : nxt === 'r' ? '\r' : nxt;
      i++;
      continue;
    }
    if (ch === '"') return { text: out, done: true };
    out += ch;
  }
  return { text: out, done: false };
}

// Feed it chunks, get back only what is newly visible. Returning the delta
// rather than the whole string keeps the caller from re-rendering the reply
// from scratch on every packet.
function makeReader() {
  let buf = '', sent = 0;
  return {
    push(chunk) {
      buf += chunk;
      const seen = visibleTextSoFar(buf);
      if (!seen) return '';
      const delta = seen.text.slice(sent);
      sent = seen.text.length;
      return delta;
    },
    raw() { return buf },
  };
}

module.exports = { visibleTextSoFar, makeReader };
