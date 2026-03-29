const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.BRIDGE_SECRET || 'vetro-secret-key';

let commandQueue = [];
let outputStore  = [];
let lastSeen     = null;

const json = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

const html = (res, content) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
};

const readBody = (req) => new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
});

const auth = (req) => req.headers['x-secret'] === SECRET;

// ── Web UI HTML ────────────────────────────────────────────
const UI = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VETRO BRIDGE</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0c; color:#fff; font-family:'Courier New',monospace; padding:16px; }
  h1 { color:#00ffaa; text-align:center; font-size:20px; margin-bottom:4px; letter-spacing:3px; }
  .sub { color:#555; text-align:center; font-size:11px; margin-bottom:20px; }
  .status-bar { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  .badge { background:#15151a; border:1px solid #2a2a35; border-radius:8px; padding:8px 14px; font-size:12px; flex:1; min-width:100px; }
  .badge span { color:#00ffaa; font-weight:bold; }
  .card { background:#15151a; border:1px solid #2a2a35; border-radius:12px; padding:16px; margin-bottom:16px; }
  .card h3 { color:#00ffaa; font-size:13px; margin-bottom:12px; letter-spacing:1px; }
  input, select { width:100%; background:#1e1e28; border:1px solid #2a2a35; border-radius:8px;
    color:#fff; padding:10px 14px; font-family:'Courier New',monospace; font-size:13px; margin-bottom:10px; }
  input:focus { outline:none; border-color:#00ffaa; }
  .secret-row { display:flex; gap:8px; }
  .secret-row input { margin-bottom:0; }
  button { width:100%; background:#00ffaa; color:#000; border:none; border-radius:8px;
    padding:12px; font-weight:bold; font-size:13px; cursor:pointer; letter-spacing:1px; }
  button:hover { background:#00dd88; }
  button.danger { background:#ff1744; color:#fff; }
  button.secondary { background:#2a2a35; color:#00ffaa; }
  .terminal { background:#0d0d10; border:1px solid #1a1a25; border-radius:8px;
    padding:12px; height:320px; overflow-y:auto; font-size:12px; line-height:1.6; }
  .cmd-line { color:#00ffaa; }
  .out-line { color:#ccc; }
  .err-line { color:#ff4444; }
  .info-line { color:#888; }
  .ts { color:#444; font-size:10px; }
  .quick-btns { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
  .quick-btns button { padding:8px; font-size:11px; background:#1e1e28; color:#00ffaa; border:1px solid #2a2a35; }
  .quick-btns button:hover { background:#2a2a35; }
  #queueBadge { background:#ff1744; border-radius:50%; padding:2px 6px; font-size:10px; margin-left:4px; display:none; }
</style>
</head>
<body>

<h1>⚡ VETRO BRIDGE</h1>
<div class="sub">Claude ↔ AndroidIDE Terminal</div>

<div class="status-bar">
  <div class="badge">Status: <span id="statusDot">●</span> <span id="statusText">Checking...</span></div>
  <div class="badge">HP Last Seen: <span id="lastSeen">-</span></div>
  <div class="badge">Queue: <span id="queueCount">0</span> | Output: <span id="outputCount">0</span></div>
</div>

<div class="card">
  <h3>🔑 SECRET KEY</h3>
  <div class="secret-row">
    <input type="password" id="secretInput" placeholder="Secret key..." value="vetro-secret-key">
  </div>
</div>

<div class="card">
  <h3>▶ KIRIM COMMAND <span id="queueBadge">0</span></h3>
  <div class="quick-btns">
    <button onclick="quick('pwd && ls')">pwd + ls</button>
    <button onclick="quick('java -version')">java version</button>
    <button onclick="quick('gradle --version')">gradle version</button>
    <button onclick="quick('ls app/build/outputs/apk/')">cek APK</button>
    <button onclick="quick('bash vetro-build.sh fix')">build fix</button>
    <button onclick="quick('bash vetro-build.sh release')">build release</button>
    <button onclick="quick('df -h /sdcard')">disk space</button>
    <button onclick="quick('cat /sdcard/vetro_log.txt | tail -30')">lihat log</button>
  </div>
  <input type="text" id="cmdInput" placeholder="Ketik command..." onkeydown="if(event.key==='Enter')sendCmd()">
  <button onclick="sendCmd()">SEND COMMAND</button>
</div>

<div class="card">
  <h3>📟 OUTPUT TERMINAL</h3>
  <div class="terminal" id="terminal">
    <div class="info-line">⏳ Menunggu output dari HP...</div>
  </div>
  <br>
  <div style="display:flex;gap:8px">
    <button class="secondary" onclick="fetchOutput()">🔄 Refresh</button>
    <button class="danger" onclick="clearAll()">🗑 Clear All</button>
  </div>
</div>

<script>
const BASE = window.location.origin;
let autoRefresh = true;

function getSecret() {
  return document.getElementById('secretInput').value;
}

async function checkStatus() {
  try {
    const r = await fetch(BASE + '/status');
    const d = await r.json();
    document.getElementById('statusDot').style.color = '#00ffaa';
    document.getElementById('statusText').textContent = 'Online';
    document.getElementById('queueCount').textContent = d.queue;
    document.getElementById('outputCount').textContent = d.outputs;
    const ls = d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString() : 'Never';
    document.getElementById('lastSeen').textContent = ls;

    const qb = document.getElementById('queueBadge');
    if (d.queue > 0) { qb.style.display='inline'; qb.textContent=d.queue; }
    else { qb.style.display='none'; }
  } catch {
    document.getElementById('statusDot').style.color = '#ff4444';
    document.getElementById('statusText').textContent = 'Offline';
  }
}

async function sendCmd() {
  const cmd = document.getElementById('cmdInput').value.trim();
  if (!cmd) return;
  try {
    const r = await fetch(BASE + '/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret': getSecret() },
      body: JSON.stringify({ command: cmd })
    });
    const d = await r.json();
    if (d.ok) {
      addToTerminal('cmd', '$ ' + cmd);
      addToTerminal('info', '⏳ Command dikirim, menunggu output HP...');
      document.getElementById('cmdInput').value = '';
    } else {
      addToTerminal('err', '❌ Gagal: ' + JSON.stringify(d));
    }
  } catch(e) {
    addToTerminal('err', '❌ Error: ' + e.message);
  }
}

function quick(cmd) {
  document.getElementById('cmdInput').value = cmd;
  sendCmd();
}

async function fetchOutput() {
  try {
    const r = await fetch(BASE + '/output', { headers: { 'x-secret': getSecret() } });
    const d = await r.json();
    if (d.outputs && d.outputs.length > 0) {
      const term = document.getElementById('terminal');
      term.innerHTML = '';
      d.outputs.reverse().forEach(o => {
        const ts = o.ts ? new Date(o.ts).toLocaleTimeString() : '';
        addToTerminal('cmd', '$ ' + o.cmd + '  ' + ts);
        const lines = (o.output || '').split('\\n');
        lines.forEach(l => {
          if (l.trim()) addToTerminal(o.exit == 0 ? 'out' : 'err', l);
        });
        addToTerminal('info', '── exit: ' + o.exit + ' | pwd: ' + (o.pwd||'') + ' ──');
      });
    }
  } catch(e) {
    addToTerminal('err', 'Fetch error: ' + e.message);
  }
  checkStatus();
}

async function clearAll() {
  await fetch(BASE + '/clear', { method: 'DELETE', headers: { 'x-secret': getSecret() } });
  document.getElementById('terminal').innerHTML = '<div class="info-line">🗑 Cleared.</div>';
  checkStatus();
}

function addToTerminal(type, text) {
  const term = document.getElementById('terminal');
  const div = document.createElement('div');
  div.className = type === 'cmd' ? 'cmd-line' : type === 'err' ? 'err-line' : type === 'info' ? 'info-line' : 'out-line';
  div.textContent = text;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}

// Auto refresh tiap 4 detik
setInterval(() => { if(autoRefresh) fetchOutput(); }, 4000);
checkStatus();
fetchOutput();
</script>
</body>
</html>`;

// ── Routes ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const path = req.url.split('?')[0];
    const method = req.method;

    // Web UI
    if (method === 'GET' && path === '/') return html(res, UI);

    // API Routes
    if (method === 'POST' && path === '/cmd') {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        const { command } = await readBody(req);
        if (!command) return json(res, 400, { error: 'command required' });
        const id = crypto.randomUUID().slice(0, 8);
        commandQueue.push({ id, command, ts: Date.now() });
        return json(res, 200, { ok: true, id, queued: commandQueue.length });
    }

    if (method === 'GET' && path === '/poll') {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        lastSeen = new Date().toISOString();
        if (commandQueue.length === 0) return json(res, 200, { cmd: null });
        return json(res, 200, commandQueue.shift());
    }

    if (method === 'POST' && path === '/output') {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readBody(req);
        outputStore.unshift({ ...body, ts: new Date().toISOString() });
        if (outputStore.length > 100) outputStore.pop();
        return json(res, 200, { ok: true });
    }

    if (method === 'GET' && path === '/output') {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        return json(res, 200, { outputs: outputStore.slice(0, 20), lastSeen });
    }

    if (method === 'GET' && path === '/status') {
        return json(res, 200, { status: 'online', queue: commandQueue.length, outputs: outputStore.length, lastSeen, uptime: Math.floor(process.uptime()) + 's' });
    }

    if (method === 'DELETE' && path === '/clear') {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        commandQueue = []; outputStore = [];
        return json(res, 200, { ok: true });
    }

    json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
    console.log(`✅ VETRO BRIDGE running on :${PORT}`);
    console.log(`🌐 Open: http://localhost:${PORT}`);
    console.log(`🔑 Secret: ${SECRET}`);
});        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        const { command } = await readBody(req);
        if (!command) return json(res, 400, { error: 'command required' });

        const id = crypto.randomUUID().slice(0, 8);
        commandQueue.push({ id, command, ts: Date.now() });
        json(res, 200, { ok: true, id, queued: commandQueue.length });
    },

    // HP poll — ambil command terbaru
    'GET /poll': (req, res) => {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        lastSeen = new Date().toISOString();

        if (commandQueue.length === 0) {
            return json(res, 200, { cmd: null });
        }

        const next = commandQueue.shift();
        json(res, 200, { cmd: next.id, command: next.command });
    },

    // HP kirim output balik
    'POST /output': async (req, res) => {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readBody(req);
        outputStore.unshift({ ...body, ts: new Date().toISOString() });
        if (outputStore.length > 50) outputStore.pop(); // max 50 entry
        json(res, 200, { ok: true });
    },

    // Claude ambil output terbaru
    'GET /output': (req, res) => {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        json(res, 200, { outputs: outputStore.slice(0, 10), lastSeen });
    },

    // Status bridge
    'GET /status': (req, res) => {
        json(res, 200, {
            status: 'online',
            queue: commandQueue.length,
            outputs: outputStore.length,
            lastSeen,
            uptime: Math.floor(process.uptime()) + 's'
        });
    },

    // Clear semua
    'DELETE /clear': (req, res) => {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
        commandQueue = []; outputStore = [];
        json(res, 200, { ok: true });
    }
};

// ── Server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const key = `${req.method} ${req.url.split('?')[0]}`;
    const handler = routes[key];
    if (handler) {
        await handler(req, res);
    } else {
        json(res, 404, { error: 'Not found', routes: Object.keys(routes) });
    }
});

server.listen(PORT, () => {
    console.log(`✅ VETRO BRIDGE SERVER running on port ${PORT}`);
    console.log(`🔑 Secret: ${SECRET}`);
});
