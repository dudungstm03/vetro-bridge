const http = require('http');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.BRIDGE_SECRET || 'vetro-secret-key';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

let queue = [], outputs = [], lastSeen = null, chatHistory = [];

const j = (res, code, data) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
const readBody = req => new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b))}catch{r({})} }); });
const auth = req => req.headers['x-secret'] === SECRET;

const askClaude = (messages) => new Promise((resolve, reject) => {
  const recentOutputs = outputs.slice(0,3).map(o=>`CMD: ${o.cmd}\nOUT: ${(o.output||'').slice(0,200)}`).join('\n---\n');
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `Kamu adalah VETRO AI — dev assistant untuk project Android VETRO NEXUS V2.
Kamu bisa kasih perintah terminal dan bantu debug.
Stack: Android Java, NDK C++, Shizuku, Gradle 8.14.4, AndroidIDE-Pro di HP.
Project: /storage/emulated/0/VETRO-V2/DATA VETRO/VETRO NEXUS
APK sudah build sukses 6.2MB. Issue: gradle permission denied dari bash, auth server down.
Output terminal terbaru:\n${recentOutputs || 'belum ada'}
Jawab bahasa Indonesia, singkat, teknikal, to the point. Kalau kasih command terminal, format dengan backtick.`,
    messages
  });
  const opts = { hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)} };
  const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d).content[0].text)}catch(e){reject(e)} }); });
  r.on('error', reject); r.write(body); r.end();
});

const UI = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>VETRO BRIDGE</title>
<style>
:root{--cyan:#00ffaa;--pink:#ff007f;--purple:#aa00ff;--bg:#08080a;--card:#111116;--border:#1e1e2a;--text:#e0e0e0;--muted:#555}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;height:100dvh;display:flex;flex-direction:column;overflow:hidden}

/* Header */
.hdr{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0;background:linear-gradient(180deg,#0d0d14 0%,var(--bg) 100%)}
.hdr-logo{display:flex;align-items:center;gap:8px}
.hdr-logo .dot{width:8px;height:8px;border-radius:50%;background:var(--cyan);animation:pulse 2s infinite;flex-shrink:0}
.hdr-logo h1{font-size:15px;letter-spacing:3px;color:var(--cyan);font-weight:bold}
.hdr-right{display:flex;align-items:center;gap:8px}
.hp-badge{font-size:10px;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:4px 10px;border-radius:20px}
.hp-badge.online{color:var(--cyan);border-color:#003322}

/* Tabs */
.tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg)}
.tab{flex:1;padding:11px 0;font-size:12px;letter-spacing:1px;text-align:center;color:var(--muted);cursor:pointer;border:none;background:none;font-family:'Courier New',monospace;position:relative;transition:color .2s}
.tab.active{color:var(--cyan)}
.tab.active::after{content:'';position:absolute;bottom:0;left:20%;right:20%;height:2px;background:var(--cyan);border-radius:2px}
.tab-chat.active{color:var(--purple)}
.tab-chat.active::after{background:var(--purple)}

/* Pages */
.page{flex:1;display:none;flex-direction:column;overflow:hidden}
.page.active{display:flex}

/* Terminal page */
.term-out{flex:1;overflow-y:auto;padding:12px 14px;font-size:12px;line-height:1.8;scroll-behavior:smooth}
.term-out::-webkit-scrollbar{width:3px}
.term-out::-webkit-scrollbar-thumb{background:var(--border)}
.tl-cmd{color:var(--cyan)}
.tl-out{color:#bbb}
.tl-err{color:#ff4455}
.tl-info{color:#333;font-size:11px}
.tl-ts{color:#2a2a3a;font-size:10px}

.quick-wrap{padding:10px 12px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;border-top:1px solid var(--border);flex-shrink:0}
.qb{background:var(--card);border:1px solid var(--border);color:var(--cyan);padding:7px 4px;font-size:10px;border-radius:8px;cursor:pointer;font-family:'Courier New',monospace;text-align:center;transition:all .15s}
.qb:active{background:#1a2a1a;transform:scale(.95)}
.qb.red{color:#ff4455;border-color:#2a1a1a}

.cmd-bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0}
.cmd-bar input{flex:1;background:var(--card);border:1px solid var(--border);color:#fff;padding:10px 14px;border-radius:10px;font-family:'Courier New',monospace;font-size:13px;outline:none;transition:border .2s}
.cmd-bar input:focus{border-color:var(--cyan)}
.cmd-bar button{background:var(--cyan);color:#000;border:none;padding:10px 16px;border-radius:10px;font-weight:bold;cursor:pointer;font-size:13px;transition:all .15s}
.cmd-bar button:active{transform:scale(.95)}

/* Chat page */
.chat-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.chat-msgs::-webkit-scrollbar{width:3px}
.chat-msgs::-webkit-scrollbar-thumb{background:var(--border)}
.msg{padding:11px 14px;border-radius:14px;font-size:13px;line-height:1.65;max-width:88%;white-space:pre-wrap;word-break:break-word}
.msg.user{background:#1a1a28;border:1px solid #2a2a40;align-self:flex-end;color:#ddd}
.msg.ai{background:#0c1f18;border:1px solid #003322;align-self:flex-start;color:#00ffaa}
.msg.sys{background:#1a1210;border:1px solid #2a1a00;align-self:center;color:#ffaa44;font-size:11px;max-width:100%;text-align:center}
.typing-ind{padding:0 14px 8px;font-size:12px;color:var(--muted);min-height:24px;flex-shrink:0}

.chat-bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0}
.chat-bar input{flex:1;background:var(--card);border:1px solid var(--border);color:#fff;padding:10px 14px;border-radius:10px;font-family:'Courier New',monospace;font-size:13px;outline:none;transition:border .2s}
.chat-bar input:focus{border-color:var(--purple)}
.chat-bar button{background:var(--purple);color:#fff;border:none;padding:10px 16px;border-radius:10px;font-weight:bold;cursor:pointer;font-size:13px;transition:all .15s}
.chat-bar button:active{transform:scale(.95)}

/* Status page */
.status-page{flex:1;overflow-y:auto;padding:16px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:12px}
.stat-card h3{color:var(--cyan);font-size:12px;letter-spacing:1px;margin-bottom:12px}
.stat-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}
.stat-row:last-child{border:none}
.stat-row .val{color:var(--cyan)}
.danger-btn{width:100%;background:#1a0a0a;border:1px solid #3a1a1a;color:#ff4455;padding:12px;border-radius:10px;font-family:'Courier New',monospace;font-size:13px;cursor:pointer;margin-top:8px}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.msg{animation:fadein .2s ease}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-logo">
    <div class="dot"></div>
    <h1>VETRO BRIDGE</h1>
  </div>
  <div class="hdr-right">
    <span class="hp-badge" id="hpBadge">HP offline</span>
  </div>
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('term',this)">📟 TERMINAL</button>
  <button class="tab tab-chat" onclick="showTab('chat',this)">🤖 VETRO AI</button>
  <button class="tab" onclick="showTab('stat',this)">⚙️ STATUS</button>
</div>

<!-- TERMINAL TAB -->
<div class="page active" id="page-term">
  <div class="term-out" id="terminal"><div class="tl-info">⏳ Menunggu output dari HP...</div></div>
  <div class="quick-wrap">
    <button class="qb" onclick="sc('pwd && ls')">pwd+ls</button>
    <button class="qb" onclick="sc('ls -lh /sdcard/VETRO_NEXUS.apk')">cek APK</button>
    <button class="qb" onclick="sc('df -h /sdcard')">disk</button>
    <button class="qb" onclick="sc('cat /sdcard/vetro_log.txt | tail -30')">log</button>
    <button class="qb" onclick="sc('bash vetro-build.sh fix')">fix</button>
    <button class="qb" onclick="sc('bash vetro-build.sh release')">build</button>
    <button class="qb" onclick="sc('ps aux | grep gradle | head -5')">gradle</button>
    <button class="qb red" onclick="clearAll()">clear</button>
  </div>
  <div class="cmd-bar">
    <input id="cmdIn" placeholder="$ command..." onkeydown="if(event.key==='Enter')runCmd()">
    <button onclick="runCmd()">▶</button>
  </div>
</div>

<!-- CHAT TAB -->
<div class="page" id="page-chat">
  <div class="chat-msgs" id="chatBox">
    <div class="msg sys">⚡ VETRO AI aktif — Claude Sonnet\nTanya soal project, minta debug, atau suruh kirim command terminal.</div>
  </div>
  <div class="typing-ind" id="typingInd"></div>
  <div class="chat-bar">
    <input id="chatIn" placeholder="Tanya VETRO AI..." onkeydown="if(event.key==='Enter')sendChat()">
    <button onclick="sendChat()">➤</button>
  </div>
</div>

<!-- STATUS TAB -->
<div class="page" id="page-stat">
  <div class="status-page">
    <div class="stat-card">
      <h3>🌐 SERVER</h3>
      <div class="stat-row"><span>Status</span><span class="val" id="srvStatus">-</span></div>
      <div class="stat-row"><span>Uptime</span><span class="val" id="srvUptime">-</span></div>
      <div class="stat-row"><span>Queue</span><span class="val" id="srvQueue">-</span></div>
      <div class="stat-row"><span>Outputs</span><span class="val" id="srvOutputs">-</span></div>
    </div>
    <div class="stat-card">
      <h3>📱 HP CLIENT</h3>
      <div class="stat-row"><span>Last Seen</span><span class="val" id="srvLastSeen">-</span></div>
      <div class="stat-row"><span>Poll Interval</span><span class="val">3s</span></div>
    </div>
    <div class="stat-card">
      <h3>🔧 PROJECT</h3>
      <div class="stat-row"><span>APK</span><span class="val">6.2MB ✅</span></div>
      <div class="stat-row"><span>NDK</span><span class="val">27.1.12297006</span></div>
      <div class="stat-row"><span>Gradle</span><span class="val">8.14.4</span></div>
      <div class="stat-row"><span>Min SDK</span><span class="val">30</span></div>
    </div>
    <button class="danger-btn" onclick="clearAll()">🗑 Clear All Data</button>
  </div>
</div>

<script>
const BASE = window.location.origin;
const SEC = 'vetro-secret-key';

function showTab(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  el.classList.add('active');
  if (name==='stat') fetchStatus();
}

// Terminal
async function runCmd() {
  const inp = document.getElementById('cmdIn');
  const cmd = inp.value.trim(); if(!cmd) return;
  inp.value = '';
  addT('cmd','$ '+cmd);
  await fetch(BASE+'/cmd',{method:'POST',headers:{'Content-Type':'application/json','x-secret':SEC},body:JSON.stringify({command:cmd})});
}
function sc(cmd) { document.getElementById('cmdIn').value=cmd; runCmd(); }
function addT(cls,txt) {
  const t=document.getElementById('terminal');
  const d=document.createElement('div'); d.className='tl-'+cls; d.textContent=txt; t.appendChild(d); t.scrollTop=t.scrollHeight;
}
async function fetchOutputs() {
  try {
    const d=await(await fetch(BASE+'/output',{headers:{'x-secret':SEC}})).json();
    if(d.outputs&&d.outputs.length){
      const t=document.getElementById('terminal'); t.innerHTML='';
      [...d.outputs].reverse().forEach(o=>{
        const ts=o.ts?new Date(o.ts).toLocaleTimeString():'';
        addT('cmd','$ '+o.cmd);
        addT('ts',ts+' | exit:'+o.exit);
        (o.output||'').split('\\n').filter(l=>l.trim()).forEach(l=>addT(o.exit==0?'out':'err',l));
        addT('info','─────────────────');
      });
    }
    const s=await(await fetch(BASE+'/status')).json();
    const badge=document.getElementById('hpBadge');
    if(s.lastSeen){
      const sec=Math.floor((Date.now()-new Date(s.lastSeen))/1000);
      badge.textContent='HP '+( sec<10?'live':sec+'s ago'); badge.className='hp-badge online';
    } else { badge.textContent='HP offline'; badge.className='hp-badge'; }
  } catch(e){}
}
async function clearAll(){
  await fetch(BASE+'/clear',{method:'DELETE',headers:{'x-secret':SEC}});
  document.getElementById('terminal').innerHTML='<div class="tl-info">🗑 Cleared.</div>';
}

// Chat
async function sendChat(){
  const inp=document.getElementById('chatIn');
  const msg=inp.value.trim(); if(!msg) return;
  inp.value='';
  addMsg('user',msg);
  document.getElementById('typingInd').textContent='⏳ VETRO AI ngetik...';
  try{
    const d=await(await fetch(BASE+'/chat',{method:'POST',headers:{'Content-Type':'application/json','x-secret':SEC},body:JSON.stringify({message:msg})})).json();
    document.getElementById('typingInd').textContent='';
    addMsg('ai', d.reply||d.error||'Error');
  }catch(e){document.getElementById('typingInd').textContent=''; addMsg('ai','❌ '+e.message);}
}
function addMsg(role,txt){
  const box=document.getElementById('chatBox');
  const d=document.createElement('div'); d.className='msg '+role; d.textContent=txt; box.appendChild(d); box.scrollTop=box.scrollHeight;
}

// Status
async function fetchStatus(){
  try{
    const s=await(await fetch(BASE+'/status')).json();
    document.getElementById('srvStatus').textContent=s.status;
    document.getElementById('srvUptime').textContent=s.uptime;
    document.getElementById('srvQueue').textContent=s.queue;
    document.getElementById('srvOutputs').textContent=s.outputs;
    document.getElementById('srvLastSeen').textContent=s.lastSeen?new Date(s.lastSeen).toLocaleTimeString():'Never';
  }catch(e){}
}

setInterval(fetchOutputs, 3000);
fetchOutputs();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  const p=req.url.split('?')[0], m=req.method;

  if(m==='GET'&&p==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(UI);}
  if(m==='GET'&&p==='/status') return j(res,200,{status:'online',queue:queue.length,outputs:outputs.length,lastSeen,uptime:Math.floor(process.uptime())+'s'});

  if(m==='POST'&&p==='/cmd'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    const{command}=await readBody(req); if(!command)return j(res,400,{error:'command required'});
    const id=crypto.randomUUID().slice(0,8); queue.push({id,command,ts:Date.now()});
    return j(res,200,{ok:true,id,queued:queue.length});
  }
  if(m==='GET'&&p==='/poll'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    lastSeen=new Date().toISOString();
    if(!queue.length)return j(res,200,{cmd:null});
    return j(res,200,queue.shift());
  }
  if(m==='POST'&&p==='/output'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    const body=await readBody(req); outputs.unshift({...body,ts:new Date().toISOString()});
    if(outputs.length>100)outputs.pop(); return j(res,200,{ok:true});
  }
  if(m==='GET'&&p==='/output'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    return j(res,200,{outputs:outputs.slice(0,20),lastSeen});
  }
  if(m==='POST'&&p==='/chat'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    const{message}=await readBody(req); if(!message)return j(res,400,{error:'message required'});
    chatHistory.push({role:'user',content:message});
    if(chatHistory.length>20)chatHistory=chatHistory.slice(-20);
    try{const reply=await askClaude(chatHistory); chatHistory.push({role:'assistant',content:reply}); return j(res,200,{reply});}
    catch(e){return j(res,500,{error:'Claude API error: '+e.message});}
  }
  if(m==='DELETE'&&p==='/clear'){
    if(!auth(req))return j(res,401,{error:'Unauthorized'});
    queue=[];outputs=[];return j(res,200,{ok:true});
  }
  j(res,404,{error:'Not found'});
});

server.listen(PORT,()=>console.log('VETRO BRIDGE v3 :'+PORT));
