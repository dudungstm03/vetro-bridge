const http = require('http');
const crypto = require('crypto');

// ── Config ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SECRET = process.env.BRIDGE_SECRET || 'vetro-secret-key';

// ── In-memory store ────────────────────────────────────────
let commandQueue = [];   // command nunggu dieksekusi
let outputStore  = [];   // output dari HP
let lastSeen     = null; // kapan HP terakhir poll

// ── Helper ─────────────────────────────────────────────────
const json = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

const readBody = (req) => new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({}); }
    });
});

const auth = (req) => {
    return req.headers['x-secret'] === SECRET;
};

// ── Routes ─────────────────────────────────────────────────
const routes = {

    // Claude kirim command ke HP
    'POST /cmd': async (req, res) => {
        if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });
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