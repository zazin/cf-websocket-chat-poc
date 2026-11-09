import assert from 'node:assert/strict';
import WebSocket from 'ws';
const [frontend, backend] = process.argv.slice(2);
if (!frontend || !backend) throw new Error('Usage: npm run test:integration -- FRONTEND_URL BACKEND_URL');
for (const value of [frontend, backend]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use HTTPS URLs (HTTP allowed only for local tests).');
}
const sockets = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function client(base, room, name) {
  const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('room', room); url.searchParams.set('name', name);
  const ws = new WebSocket(url); sockets.push(ws);
  const inbox = []; ws.on('message', raw => inbox.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Open timeout')), 10000); ws.once('open', () => { clearTimeout(t); resolve(); }); ws.once('error', e => { clearTimeout(t); reject(e); }); });
  ws.on('error', () => {});
  return { ws, inbox, async wait(predicate) {
    const until = Date.now() + 10000;
    while (Date.now() < until) { const i = inbox.findIndex(predicate); if (i >= 0) return inbox.splice(i, 1)[0]; await pause(20); }
    throw new Error(`Message timeout: ${predicate}`);
  } };
}
const room = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
try {
  for (const base of [frontend, backend]) {
    const response = await fetch(new URL('/health', base)); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    assert.equal((await fetch(new URL('/ws?room=INVALID&name=test', base))).status, 400);
    assert.equal((await fetch(new URL('/ws?room=valid&name=' + 'x'.repeat(33), base))).status, 400);
  }
  const asset = await fetch(frontend); assert.equal(asset.status, 200); assert.match(await asset.text(), /afterglow/);
  const a = await client(frontend, room, 'Alice');
  const b = await client(backend, room, 'Bob');
  const isolated = await client(frontend, `${room}-other`, 'Other');
  await Promise.all([a.wait(x => x.type === 'history'), b.wait(x => x.type === 'history'), isolated.wait(x => x.type === 'history')]);
  const presence = await a.wait(x => x.type === 'presence' && x.name === 'Bob'); assert.equal(presence.count, 2);
  a.ws.send(JSON.stringify({ type: 'chat', text: 'hello from Alice' }));
  const sent = await a.wait(x => x.type === 'chat'); assert.equal(sent.text, 'hello from Alice');
  assert.equal((await b.wait(x => x.type === 'chat')).id, sent.id);
  b.ws.send(JSON.stringify({ type: 'chat', text: 'hello from Bob' }));
  assert.equal((await a.wait(x => x.type === 'chat')).text, 'hello from Bob');
  await b.wait(x => x.type === 'chat');
  a.ws.send('{'); assert.equal((await a.wait(x => x.type === 'error')).code, 'invalid_json');
  a.ws.send(JSON.stringify({ type: 'chat', text: 'x'.repeat(2001) })); assert.equal((await a.wait(x => x.type === 'error')).code, 'too_large');
  a.ws.send(JSON.stringify({ type: 'chat', text: 123 })); assert.equal((await a.wait(x => x.type === 'error')).code, 'invalid_message');
  await new Promise(resolve => { b.ws.once('close', resolve); b.ws.close(); });
  assert.equal((await a.wait(x => x.type === 'presence' && x.event === 'leave')).count, 1);
  const reconnected = await client(frontend, room, 'Bob');
  const history = await reconnected.wait(x => x.type === 'history');
  assert.deepEqual(history.messages.map(x => x.text), ['hello from Alice', 'hello from Bob']);
  await pause(400); assert.equal(isolated.inbox.filter(x => x.type === 'chat').length, 0);
  for (let i = 0; i < 11; i++) reconnected.ws.send('{}');
  await reconnected.wait(x => x.type === 'error' && x.code === 'rate_limit');
  console.log('PASS: both health endpoints, validation, frontend asset, bidirectional broadcast, presence, room isolation, reconnect history, malformed JSON, invalid payload, oversize rejection, rate limit.');
} finally { for (const ws of sockets) ws.terminate(); }
