const $ = id => document.getElementById(id);
let socket, timer, attempt = 0, generation = 0, current, seen = new Set();
const status = (text, state) => { $('status').textContent = text; $('status').dataset.state = state; };
function enabled(value) { $('message').disabled = !value; $('send').disabled = !value; }
function appendMessage(message) {
  if (seen.has(message.id)) return;
  seen.add(message.id);
  $('empty')?.remove();
  const article = document.createElement('article'); article.className = 'message';
  const meta = document.createElement('div'); meta.className = 'meta';
  const name = document.createElement('span'); name.className = 'author'; name.textContent = message.name;
  const time = document.createElement('time'); time.dateTime = new Date(message.timestamp).toISOString(); time.textContent = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('div'); text.className = 'bubble'; text.textContent = message.text;
  meta.append(name, time); article.append(meta, text); $('messages').append(article);
}
function trimAndScroll() {
  while ($('messages').children.length > 150) $('messages').firstChild.remove();
  // Keep duplicate tracking bounded as well as DOM memory.
  if (seen.size > 200) seen = new Set([...seen].slice(-100));
  $('messages').scrollTop = $('messages').scrollHeight;
}
function connect(token) {
  if (token !== generation) return;
  status(attempt ? 'Reconnecting…' : 'Connecting…', 'connecting'); enabled(false);
  const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('room', current.room); url.searchParams.set('name', current.name);
  const ws = socket = new WebSocket(url);
  ws.onopen = () => { if (token !== generation) return ws.close(); attempt = 0; status('Connected', 'online'); enabled(true); $('notice').textContent = ''; };
  ws.onmessage = event => {
    if (token !== generation) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'history') { data.messages.forEach(appendMessage); $('participants').textContent = `${data.count} connected`; }
    if (data.type === 'chat') appendMessage(data);
    if (data.type === 'presence') {
      $('participants').textContent = `${data.count} connected`;
      $('empty')?.remove(); const line = document.createElement('div'); line.className = 'system'; line.textContent = `${data.name} ${data.event === 'join' ? 'joined' : 'left'} the room`; $('messages').append(line);
    }
    if (data.type === 'error') $('notice').textContent = data.message;
    trimAndScroll();
  };
  ws.onerror = () => { if (token === generation) $('notice').textContent = 'Connection interrupted. Retrying automatically.'; };
  ws.onclose = () => {
    if (token !== generation) return;
    enabled(false); status('Reconnecting…', 'connecting'); $('participants').textContent = '— connected';
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 500;
    timer = setTimeout(() => connect(token), delay);
  };
}
$('join').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('name').value.trim(), room = $('room').value;
  if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) { $('notice').textContent = 'Choose a nickname of 1–32 characters without control characters.'; return; }
  generation++; clearTimeout(timer); socket?.close(1000, 'Switching room');
  current = { name, room }; seen.clear(); $('messages').replaceChildren(); $('room-title').textContent = `# ${room}`;
  $('join-button').firstChild.textContent = 'Switch room '; connect(generation);
});
$('message').addEventListener('input', () => { $('length').textContent = $('message').value.length; });
$('compose').addEventListener('submit', event => {
  event.preventDefault(); const text = $('message').value.trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'chat', text })); $('message').value = ''; $('length').textContent = '0';
});
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('compose').requestSubmit(); } });
window.addEventListener('online', () => { if (current && socket?.readyState === WebSocket.CLOSED) { clearTimeout(timer); connect(generation); } });
