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

const UI = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VETRO BRIDGE</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0c;color:#fff;font-family:'Courier New',monospace;padding:16px}
h1{color:#00ffaa;text-align:center;font-size:20px;margin-bottom:4px;letter-spacing:3px}
.sub{color:#555;text-align:center;font-size:11px;margin-bottom:20px}
.status-bar{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.badge{background:#15151a;border:1px solid #2a2a35;border-radius:8px;padding:8px 14px;font-size:12px;flex:1;min-width:100px}
.badge span{color:#00ffaa;font-weight:bold}
.card{background:#15151a;border:1px solid #2a2a35;border-radius:12px;padding:16px;margin-bottom:16px}
.card h3{color:#00ffaa;font-size:13px;margin-bottom:12px;letter-spacing:1px}
input{width:100%;background:#1e1e28;border:1px solid #2a2a35;border-radius:8px;color:#fff;padding:10px 14px;font-family:'Courier New',monospace;font-size:13px;margin-bottom:10px}
input:focus{outline:none;border-color:#00ffaa}
button{width:100%;background:#00ffaa;color:#000;border:none;border-radius:8px;padding:12px;font-weight:bold;font-size:13px;cursor:pointer;letter-spacing:1px}
button:hover{background:#00dd88}
button.danger{background:#ff1744;color:#fff}
button.secondary{background:#2a2a35;color:#00ffaa}
.terminal{background:#0d0d10;border:1px solid #1a1a25;border-radius:8px;padding:12px;height:350px;overflow-y:auto;font-size:12px;line-height:1.7}
.cmd-line{color:#00ffaa}
.out-line{color:#ccc}
.err-line{color:#ff4444}
.info-line{color:#555}
.quick-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.quick-btns button{padding:8px;font-size:11px;background:#1e1e28;color:#00ffaa;border:1px solid #2a2a35;border-radius:8px}
.quick-btns button:hover{background:#2a2a35}
#queueBadge{background:#ff1744;border-radius:50%;padding:2px 6px;font-size:10px;margin-left:4px;display:none}
</style>
</head>
<body>
<h1>⚡ VETRO BRIDGE</h1>
<div class="sub">AndroidIDE Terminal Controller</div>

<div class="status-bar">
  <div class="badge">Status: <span id="statusDot">●</span> <span id="statusText">Checking...</span></div>
  <div class="badge">HP: <span id="lastSeen">Never</span></div>
  <div class="badge">Queue: <span id="queueCount">0</span> | Out: <span id="outputCount">0</span></div>
</div>

<div class="card">
  <h3>🔑 SECRET</h3>
  <input type="password" id="secretInput" placeholder="Secret key..." value="vetro-secret-key">
</div>

<div class="card">
  <h3>▶ COMMAND <span id="queueBadge">0</span></h3>
  <div class="quick-btns">
    <button onclick="quick('pwd && ls')">pwd + ls</button>
    <button onclick="quick('java -version 2>&1')">java ver</button>
    <button onclick="quick('ls -lh /sdcard/VETRO_NEXUS.apk')">cek APK</button>
    <button onclick="quick('cat /sdcard/vetro_log.txt | tail -20')">lihat log</button>
    <button onclick="quick('bash vetro-build.sh fix')">build fix</button>
    <button onclick="quick('bash vetro-build.sh release')">build release</button>
    <button onclick="quick('df -h /sdcard')">disk space</button>
    <button onclick="quick('ps aux | grep gradle')">cek gradle</button>
  </div>
  <input type="text" id="cmdInput" placeholder="Ketik command..." onkeydown="if(event.key==='Enter')sendCmd()">
  <button onclick="sendCmd()">⚡ SEND COMMAND</button>
</div>

<div class="card">
  <h3>📟 TERMINAL OUTPUT</h3>
  <div class="terminal" id="terminal"><div class="info-line">⏳ Menunggu output dari HP...</div></div>
  <br>
  <div style="display:flex;gap:8px">
    <button class="secondary" onclick="fetchOutput()">🔄 Refresh</button>
    <button class="danger" onclick="clearAll()">🗑 Clear</button>
  </div>
</div>

<script>
const BASE=window.location.origin;
function getSecret(){return document.getElementById('secretInput').value}

async function checkStatus(){
  try{
    const d=await(await fetch(BASE+'/status')).json();
    document.getElementById('statusDot').style.color='#00ffaa';
    document.getElementById('statusText').textContent='Online';
    document.getElementById('queueCount').textContent=d.queue;
    document.getElementById('outputCount').textContent=d.outputs;
    document.getElementById('lastSeen').textContent=d.lastSeen?new Date(d.lastSeen).toLocaleTimeString():'Never';
    const qb=document.getElementById('queueBadge');
    if(d.queue>0){qb.style.display='inline';qb.textContent=d.queue}else{qb.style.display='none'}
  }catch{
    document.getElementById('statusDot').style.color='#ff4444';
    document.getElementById('statusText').textContent='Offline';
  }
}

async function sendCmd(){
  const cmd=document.getElementById('cmdInput').value.trim();
  if(!cmd)return;
  try{
    const d=await(await fetch(BASE+'/cmd',{method:'POST',headers:{'Content-Type':'application/json','x-secret':getSecret()},body:JSON.stringify({command:cmd})})).json();
    if(d.ok){addLine('cmd','$ '+cmd);addLine('info','⏳ Terkirim, tunggu output HP...');document.getElementById('cmdInput').value=''}
    else addLine('err','❌ '+JSON.stringify(d));
  }catch(e){addLine('err','❌ '+e.message)}
}

function quick(cmd){document.getElementById('cmdInput').value=cmd;sendCmd()}

async function fetchOutput(){
  try{
    const d=await(await fetch(BASE+'/output',{headers:{'x-secret':getSecret()}})).json();
    if(d.outputs&&d.outputs.length>0){
      const term=document.getElementById('terminal');
      term.innerHTML='';
      [...d.outputs].reverse().forEach(o=>{
        const ts=o.ts?new Date(o.ts).toLocaleTimeString():'';
        addLine('cmd','$ '+o.cmd+'  ['+ts+']');
        (o.output||'').split('\\n').forEach(l=>{if(l.trim())addLine(o.exit==0?'out':'err',l)});
        addLine('info','── exit:'+o.exit+' pwd:'+( o.pwd||'')+' ──');
      });
    }
  }catch(e){addLine('err','Fetch error: '+e.message)}
  checkStatus();
}

async function clearAll(){
  await fetch(BASE+'/clear',{method:'DELETE',headers:{'x-secret':getSecret()}});
  document.getElementById('terminal').innerHTML='<div class="info-line">🗑 Cleared.</div>';
  checkStatus();
}

function addLine(type,text){
  const term=document.getElementById('terminal');
  const d=document.createElement('div');
  d.className=type==='cmd'?'cmd-line':type==='err'?'err-line':type==='info'?'info-line':'out-line';
  d.textContent=text;
  term.appendChild(d);
  term.scrollTop=term.scrollHeight;
}

setInterval(fetchOutput,4000);
checkStatus();fetchOutput();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const path = req.url.split('?')[0];
    const method = req.method;

    if (method === 'GET' && path === '/') return html(res, UI);

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
    console.log('✅ VETRO BRIDGE running on :' + PORT);
});
