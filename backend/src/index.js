import { DurableObject } from 'cloudflare:workers';

const ROOM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const TTL = 24 * 60 * 60 * 1000;
function validate(url) {
  const room = url.searchParams.get('room');
  const name = url.searchParams.get('name')?.trim();
  if (!room || !ROOM.test(room)) return 'Room must be 1–48 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.';
  if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) return 'Name must be 1–32 characters without control characters.';
  return null;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'chat-backend' });
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const error = validate(url);
    if (error) return Response.json({ error }, { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(url.searchParams.get('room'))).fetch(request);
  },
};

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.history = (await ctx.storage.get('history')) || [];
    });
  }
  sockets() { return this.ctx.getWebSockets().filter(ws => !ws.deserializeAttachment()?.closed); }
  send(ws, data) { try { ws.send(JSON.stringify(data)); } catch { /* Close callback handles presence. */ } }
  broadcast(data) { for (const ws of this.sockets()) this.send(ws, data); }
  presence(event, name) { this.broadcast({ type: 'presence', event, name, count: this.sockets().length }); }
  async fetch(request) {
    const url = new URL(request.url);
    const error = validate(url);
    if (error) return new Response(error, { status: 400 });
    if (this.sockets().length >= 100) return new Response('Room is full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    const name = url.searchParams.get('name').trim();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name, window: Date.now(), count: 0, closed: false });
    await this.ctx.storage.setAlarm(Date.now() + TTL);
    this.send(server, { type: 'history', messages: this.history, count: this.sockets().length });
    this.presence('join', name);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    const attachment = ws.deserializeAttachment();
    if (!attachment || attachment.closed) return;
    const now = Date.now();
    if (now - attachment.window >= 10000) { attachment.window = now; attachment.count = 0; }
    attachment.count++;
    ws.serializeAttachment(attachment);
    const fail = (code, message) => this.send(ws, { type: 'error', code, message });
    if (attachment.count > 10) return fail('rate_limit', 'Limit: 10 frames per 10 seconds.');
    if (typeof raw !== 'string') return fail('invalid_message', 'Only JSON text frames are supported.');
    if (raw.length > 16000) return fail('too_large', 'Message frame is too large.');
    let data;
    try { data = JSON.parse(raw); } catch { return fail('invalid_json', 'Malformed JSON.'); }
    if (!data || Array.isArray(data) || data.type !== 'chat' || typeof data.text !== 'string') return fail('invalid_message', 'Expected {type:"chat",text:"..."}.');
    if (data.text.length > 2000) return fail('too_large', 'Text exceeds 2000 characters.');
    const text = data.text.trim();
    if (!text) return fail('invalid_message', 'Text cannot be empty.');
    const message = { type: 'chat', id: crypto.randomUUID(), name: attachment.name, text, timestamp: now };
    // Serialize history updates across storage awaits, including simultaneous senders.
    await this.ctx.blockConcurrencyWhile(async () => {
      this.history = [...this.history, message].slice(-50);
      await this.ctx.storage.put('history', this.history);
      await this.ctx.storage.setAlarm(Date.now() + TTL);
      this.broadcast(message);
    });
  }
  webSocketClose(ws, code) {
    this.depart(ws);
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* Already closed. */ }
  }
  webSocketError(ws) { this.depart(ws); try { ws.close(1011, 'Connection error'); } catch {} }
  depart(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.closed) return;
    ws.serializeAttachment({ ...a, closed: true });
    this.presence('leave', a.name);
  }
  async alarm() {
    // Remove idle room history; connected rooms retain only their bounded history.
    if (this.sockets().length) { await this.ctx.storage.setAlarm(Date.now() + TTL); return; }
    await this.ctx.storage.deleteAll();
    this.history = [];
  }
}
