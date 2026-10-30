/**
 * [Entry Android Hardware] Node ↔ 안드로이드(Java) 통로
 *
 * Node 가 127.0.0.1:BRIDGE_PORT 에서 기다리고, 앱(Java)이 접속한다. 한 줄에 JSON 하나.
 * 처음 줄은 {"token": "..."} — 앱이 Node 를 켤 때 넘겨 준 값과 같아야 한다 (다른 앱이 끼어들지 못하게).
 *
 * Node → Java : {"id":1,"cmd":"list"} / open / write / set / update / close / openUrl / state
 * Java → Node : {"id":1,"ok":true,"result":…} 또는 {"id":1,"ok":false,"error":"…"}
 *               {"event":"data","path":"…","data":"base64"} · {"event":"disconnect","path":"…"}
 *               {"event":"launch","roomId":"…"} (엔트리가 연결 프로그램을 열었음)
 */
const net = require('net');
const EventEmitter = require('events');

class Bridge extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.seq = 0;
        this.pending = new Map();
        this.waiters = [];
    }

    listen(port, token) {
        this.token = token;
        const server = net.createServer((socket) => this._accept(socket));
        server.on('error', (e) => console.error('[bridge] server error', e.message));
        server.listen(port, '127.0.0.1', () => console.log(`[bridge] listening on 127.0.0.1:${port}`));
        this.server = server;
    }

    _accept(socket) {
        let authed = !this.token;
        let buf = '';
        socket.setNoDelay(true);
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) {
                    continue;
                }
                let msg;
                try {
                    msg = JSON.parse(line);
                } catch (e) {
                    continue;
                }
                if (!authed) {
                    if (msg.token === this.token) {
                        authed = true;
                        this._attach(socket);
                    } else {
                        socket.destroy();
                        return;
                    }
                    continue;
                }
                this._handle(msg);
            }
        });
        socket.on('error', () => undefined);
        socket.on('close', () => {
            if (this.socket === socket) {
                this.socket = null;
                // 끊긴 요청은 실패 처리
                this.pending.forEach(({ reject, timer }) => {
                    clearTimeout(timer);
                    reject(new Error('bridge closed'));
                });
                this.pending.clear();
                this.emit('detached');
            }
        });
        if (authed) {
            this._attach(socket);
        }
    }

    _attach(socket) {
        if (this.socket && this.socket !== socket) {
            this.socket.destroy();
        }
        this.socket = socket;
        console.log('[bridge] app attached');
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach((fn) => fn());
        this.emit('attached');
    }

    _handle(msg) {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject, timer } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            clearTimeout(timer);
            msg.ok ? resolve(msg.result) : reject(new Error(msg.error || 'failed'));
            return;
        }
        if (msg.event) {
            this.emit(msg.event, msg);
        }
    }

    /** 앱이 붙을 때까지 기다린다 (최대 ms) */
    ready(ms = 5000) {
        if (this.socket) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('android bridge is not connected')), ms);
            this.waiters.push(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    async request(cmd, payload = {}, timeout = 8000) {
        await this.ready();
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`bridge timeout: ${cmd}`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.write(`${JSON.stringify(Object.assign({ id, cmd }, payload))}\n`);
        });
    }

    /** 답이 필요 없는 알림 */
    notify(cmd, payload = {}) {
        if (this.socket) {
            this.socket.write(`${JSON.stringify(Object.assign({ cmd }, payload))}\n`);
        }
    }
}

module.exports = new Bridge();
