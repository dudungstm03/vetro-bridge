const http = require('http');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.BRIDGE_SECRET || 'vetro-secret-key';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

let queue = [];
let outputs = [];
let lastSeen = null;
let chatHistory = [];

const j = (res, code, data) => {
  res.writeHead(code, {'Content-Type':'application/json'});
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise(resolve => {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); }});
});

const ok = req => req.headers['x-secret'] === SECRET;

// Call Anthropic API
const askClaude = (messages) => new Promise((resolve, reject) => {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `Kamu adalah VETRO AI - asisten developer untuk project Android VETRO NEXUS. 
Kamu punya akses ke terminal HP user via bridge system.
Output terminal terbaru: ${JSON.stringify(outputs.slice(0,3))}
Project path: /storage/emulated/0/VETRO-V2/DATA VETRO/VETRO NEXUS
Stack: Android Java, NDK C++, Shizuku, Gradle 8.14.4
Jawab dalam bahasa Indonesia, singkat dan teknikal.`,
    messages
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed.content[0].text);
      } catch(e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

// Web UI
const UI = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VETRO BRIDGE</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0c;color:#fff;font-family:'Courier New',monospace;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.header{padding:12px 16px;border-bottom:1px solid #1a1a25;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.header h1{color:#00ffaa;font-size:16px;letter-spacing:2px}
.badge{font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid #2a2a35;color:#00ffaa}
.main{display:flex;flex:1;overflow:hidden}
/* Terminal Panel */
.terminal-panel{flex:1;display:flex;flex-direction:column;border-right:1px solid #1a1a25}
.panel-title{padding:8px 14px;font-size:11px;color:#555;letter-spacing:1px;border-bottom:1px solid #1a1a25;flex-shrink:0}
.terminal{flex:1;overflow-y:auto;padding:12px;font-size:12px;line-height:1.7}
.cmd-line{color:#00ffaa}
.out-line{color:#ccc}
.err-line{color:#ff4444}
.info-line{color:#444;font-size:11px}
.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;border-top:1px solid #1a1a25;flex-shrink:0}
.qbtn{background:#1a1a25;border:1px solid #2a2a35;color:#00ffaa;padding:6px;font-size:11px;border-radius:6px;cursor:pointer;font-family:'Courier New',monospace}
.qbtn:hover{background:#2a2a35}
.cmd-input-row{display:flex;gap:6px;padding:10px;border-top:1px solid #1a1a25;flex-shrink:0}
.cmd-input-row input{flex:1;background:#1a1a25;border:1px solid #2a2a35;color:#fff;padding:8px 12px;border-radius:6px;font-family:'Courier New',monospace;font-size:13px}
.cmd-input-row input:focus{outline:none;border-color:#00ffaa}
.cmd-input-row button{background:#00ffaa;color:#000;border:none;padding:8px 14px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px}
/* Chat Panel */
.chat-panel{width:45%;display:flex;flex-direction:column}
.chat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6;max-width:90%}
.msg.user{background:#1a1a25;border:1px solid #2a2a35;align-self:flex-end;color:#fff}
.msg.claude{background:#0d2018;border:1px solid #004433;align-self:flex-start;color:#00ffaa}
.msg.system{background:#1a1208;border:1px solid #332200;align-self:center;color:#ffaa00;font-size:11px}
.typing{color:#555;font-size:12px;padding:0 14px}
.chat-input-row{display:flex;gap:6px;padding:10px;border-top:1px solid #1a1a25;flex-shrink:0}
.chat-input-row input{flex:1;background:#1a1a25;border:1px solid #2a2a35;color:#fff;padding:8px 12px;border-radius:6px;font-family:'Courier New',monospace;font-size:13px}
.chat-input-row input:focus{outline:none;border-color:#00ffaa}
.chat-input-row button{background:#aa00ff;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#00ffaa;display:inline-block;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
</style>
</head>
<body>
<div class="header">
  <h1>⚡ VETRO BRIDGE</h1>
  <span class="badge"><span class="status-dot"></span><span id="hpStatus">Checking...</span></span>
</div>

<div class="main">
  <!-- Terminal -->
  <div class="terminal-panel">
    <div class="panel-title">📟 TERMINAL — <span id="termStatus">idle</span></div>
    <div class="terminal" id="terminal"><div class="info-line">⏳ Menunggu output...</div></div>
    <div class="quick-grid">
      <button class="qbtn" onclick="send('pwd && ls')">pwd + ls</button>
      <button class="qbtn" onclick="send('ls -lh /sdcard/VETRO_NEXUS.apk')">cek APK</button>
      <button class="qbtn" onclick="send('bash vetro-build.sh fix')">build fix</button>
      <button class="qbtn" onclick="send('bash vetro-build.sh release')">build release</button>
      <button class="qbtn" onclick="send('df -h /sdcard')">disk space</button>
      <button class="qbtn" onclick="send('cat /sdcard/vetro_log.txt | tail -20')">lihat log</button>
      <button class="qbtn" onclick="send('find . -name "*.java" | wc -l')">count java</button>
      <button class="qbtn" onclick="clearAll()">🗑 clear</button>
    </div>
    <div class="cmd-input-row">
      <input id="cmdIn" placeholder="$ ketik command..." onkeydown="if(event.key==='Enter')send()">
      <button onclick="send()">▶ RUN</button>
    </div>
  </div>

  <!-- Chat -->
  <div class="chat-panel">
    <div class="panel-title">🤖 VETRO AI — Claude Sonnet</div>
    <div class="chat-messages" id="chatBox">
      <div class="msg system">VETRO AI siap! Tanya apapun soal project kamu.</div>
    </div>
    <div class="typing" id="typing"></div>
    <div class="chat-input-row">
      <input id="chatIn" placeholder="Tanya Claude..." onkeydown="if(event.key==='Enter')chat()">
      <button onclick="chat()">SEND</button>
    </div>
  </div>
</div>

<script>
const BASE = window.location.origin;
const SECRET = 'vetro-secret-key';

// Terminal
async function send(cmd) {
  const input = document.getElementById('cmdIn');
  cmd = cmd || input.value.trim();
  if (!cmd) return;
  addTerm('cmd', '$ ' + cmd);
  await fetch(BASE+'/cmd', {method:'POST', headers:{'Content-Type':'application/json','x-secret':SECRET}, body:JSON.stringify({command:cmd})});
  if (!cmd.startsWith('bash') && document.getElementById('cmdIn').value) input.value = '';
  document.getElementById('termStatus').textContent = 'waiting...';
}

function addTerm(type, text) {
  const t = document.getElementById('terminal');
  const d = document.createElement('div');
  d.className = type+'-line';
  d.textContent = text;
  t.appendChild(d);
  t.scrollTop = t.scrollHeight;
}

async function fetchOutput() {
  try {
    const d = await (await fetch(BASE+'/output', {headers:{'x-secret':SECRET}})).json();
    if (d.outputs && d.outputs.length > 0) {
      const t = document.getElementById('terminal');
      t.innerHTML = '';
      [...d.outputs].reverse().forEach(o => {
        addTerm('cmd', '$ '+o.cmd+' ['+( o.ts?new Date(o.ts).toLocaleTimeString():'')+']');
        (o.output||'').split('\\n').filter(l=>l.trim()).forEach(l => addTerm(o.exit==0?'out':'err', l));
        addTerm('info', '── exit:'+o.exit+' ──');
      });
      document.getElementById('termStatus').textContent = 'updated '+new Date().toLocaleTimeString();
    }
    const s = await (await fetch(BASE+'/status')).json();
    document.getElementById('hpStatus').textContent = s.lastSeen ? 'HP: '+new Date(s.lastSeen).toLocaleTimeString() : 'HP offline';
  } catch(e) {}
}

async function clearAll() {
  await fetch(BASE+'/clear', {method:'DELETE', headers:{'x-secret':SECRET}});
  document.getElementById('terminal').innerHTML = '<div class="info-line">🗑 Cleared.</div>';
}

// Chat
async function chat() {
  const input = document.getElementById('chatIn');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addChat('user', msg);
  document.getElementById('typing').textContent = '⏳ Claude sedang ngetik...';
  try {
    const r = await fetch(BASE+'/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-secret':SECRET},
      body: JSON.stringify({message: msg})
    });
    const d = await r.json();
    document.getElementById('typing').textContent = '';
    addChat('claude', d.reply || d.error || 'Error');
  } catch(e) {
    document.getElementById('typing').textContent = '';
    addChat('claude', '❌ Error: '+e.message);
  }
}

function addChat(role, text) {
  const box = document.getElementById('chatBox');
  const d = document.createElement('div');
  d.className = 'msg '+role;
  d.textContent = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

setInterval(fetchOutput, 3000);
fetchOutput();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const p = req.url.split('?')[0];
  const m = req.method;

  if (m === 'GET' && p === '/') { res.writeHead(200,{'Content-Type':'text/html'}); return res.end(UI); }

  if (m === 'GET' && p === '/status') return j(res,200,{status:'online',queue:queue.length,outputs:outputs.length,lastSeen,uptime:Math.floor(process.uptime())+'s'});

  if (m === 'POST' && p === '/cmd') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    const {command} = await readBody(req);
    if (!command) return j(res,400,{error:'command required'});
    const id = crypto.randomUUID().slice(0,8);
    queue.push({id,command,ts:Date.now()});
    return j(res,200,{ok:true,id,queued:queue.length});
  }

  if (m === 'GET' && p === '/poll') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    lastSeen = new Date().toISOString();
    if (!queue.length) return j(res,200,{cmd:null});
    return j(res,200,queue.shift());
  }

  if (m === 'POST' && p === '/output') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    const body = await readBody(req);
    outputs.unshift({...body,ts:new Date().toISOString()});
    if (outputs.length > 100) outputs.pop();
    return j(res,200,{ok:true});
  }

  if (m === 'GET' && p === '/output') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    return j(res,200,{outputs:outputs.slice(0,20),lastSeen});
  }

  if (m === 'POST' && p === '/chat') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    const {message} = await readBody(req);
    if (!message) return j(res,400,{error:'message required'});
    chatHistory.push({role:'user',content:message});
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    try {
      const reply = await askClaude(chatHistory);
      chatHistory.push({role:'assistant',content:reply});
      return j(res,200,{reply});
    } catch(e) {
      return j(res,500,{error:'Claude API error: '+e.message});
    }
  }

  if (m === 'DELETE' && p === '/clear') {
    if (!ok(req)) return j(res,401,{error:'Unauthorized'});
    queue=[]; outputs=[];
    return j(res,200,{ok:true});
  }

  j(res,404,{error:'Not found'});
});

server.listen(PORT, () => console.log('VETRO BRIDGE v2 :'+PORT));
