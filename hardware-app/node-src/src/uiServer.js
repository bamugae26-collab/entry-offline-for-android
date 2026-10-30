/**
 * [Entry Android Hardware] 앱 화면(WebView)용 서버 (127.0.0.1:23519)
 *
 * PC 연결 프로그램의 화면(React)을 그대로 쓰고, Electron 의 ipcRenderer ↔ ipcMain 을 이렇게 잇는다.
 *  - GET  /…               : 화면 파일 (ui/)
 *  - GET  /modules/…       : 하드웨어 그림 (modules/)
 *  - POST /ipc-sync        : ipcRenderer.sendSync  → { value }
 *  - socket.io 'ipc-send' / 'ipc-invoke' / 'ipc'(메인 → 화면)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const SocketIO = require('socket.io');
const electron = require('./electron');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
};

function serveFile(res, root, rel) {
    const target = path.normalize(path.join(root, rel));
    if (!target.startsWith(root)) {
        res.statusCode = 403;
        return res.end();
    }
    fs.stat(target, (err, st) => {
        if (err || !st.isFile()) {
            res.statusCode = 404;
            return res.end();
        }
        res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(target).pipe(res);
    });
}

/**
 * @param {{ port:number, uiDir:string, modulesDir:string, intercept:(kind:string, channel:string, args:any[]) => ({handled:boolean, value?:any}|undefined) }} options
 */
function startUiServer(options) {
    const { port, uiDir, modulesDir, intercept } = options;
    const { ipcMain } = electron;

    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || '/').split('?')[0]);
        if (req.method === 'POST' && url === '/ipc-sync') {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                let value;
                try {
                    const { channel, args = [] } = JSON.parse(body || '{}');
                    const r = intercept && intercept('sync', channel, args);
                    value = r && r.handled ? r.value : ipcMain.receiveSendSync(channel, args);
                } catch (e) {
                    console.error('[ui] ipc-sync error', e);
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ value: value === undefined ? null : value }));
            });
            return;
        }
        if (url.startsWith('/modules/')) {
            return serveFile(res, modulesDir, url.slice('/modules/'.length));
        }
        return serveFile(res, uiDir, url === '/' ? 'index.html' : url.slice(1));
    });

    const io = SocketIO(server, { serveClient: false, pingInterval: 5000 });
    io.on('connection', (socket) => {
        socket.on('ipc-send', (channel, args = []) => {
            try {
                const r = intercept && intercept('send', channel, args);
                if (!(r && r.handled)) {
                    ipcMain.receiveSend(channel, args);
                }
            } catch (e) {
                console.error('[ui] ipc-send error', channel, e);
            }
        });
        socket.on('ipc-invoke', async (channel, args = [], ack) => {
            try {
                const r = intercept && intercept('invoke', channel, args);
                if (r && r.handled) {
                    if (r.error) {
                        throw r.error;
                    }
                    return ack && ack({ value: await r.value });
                }
                const value = await ipcMain.receiveInvoke(channel, args);
                ack && ack({ value });
            } catch (e) {
                ack && ack({ error: (e && e.message) || String(e) });
            }
        });
    });
    electron.__onSend((channel, args) => {
        io.emit('ipc', channel, args);
    });

    server.on('error', (e) => console.error('[ui] listen error', e.message));
    server.listen(port, '127.0.0.1', () => console.log(`[ui] listening on 127.0.0.1:${port}`));
    return { server, io };
}

module.exports = startUiServer;
