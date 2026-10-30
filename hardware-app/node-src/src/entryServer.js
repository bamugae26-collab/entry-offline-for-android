/**
 * [Entry Android Hardware] 엔트리 작업 화면과 통신하는 서버 (127.0.0.1:23518)
 *
 * PC 연결 프로그램은 별도 서버 프로그램(entry-hw-server)이 이 역할을 한다. 안드로이드판은 한 기기 안에서만 쓰므로
 * 그중 '단일 서버' 동작만 같은 규약으로 만든다 (socket.io 2):
 *  - 엔트리 → 'message' { data, … }   : router.handleServerData
 *  - 서버  → 'message' { data }       : router.send
 *  - 하드웨어 연결 해제 알림          : 'message' { data: 'disconnectHardware' }
 */
const http = require('http');
const EventEmitter = require('events');
const SocketIO = require('socket.io');

const PORT = 23518;

class AndroidEntryServer extends EventEmitter {
    constructor() {
        super();
        this.clients = [];
        this.router = undefined;
    }

    setRouter(router) {
        this.router = router;
    }

    open() {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 200;
            res.end('hello entry');
        });
        server.on('error', (e) => console.error('[entryServer] listen error', e.message));
        server.listen(PORT, '127.0.0.1', () => console.log(`[entryServer] listening on 127.0.0.1:${PORT}`));
        const io = SocketIO(server, {
            pingInterval: 1000,
            pingTimeout: 5000,
            serveClient: false,
            transports: ['websocket', 'polling'],
        });
        io.on('connection', (socket) => this._handleConnection(socket));
        this.httpServer = server;
        this.io = io;
    }

    _handleConnection(socket) {
        const query = (socket.handshake && socket.handshake.query) || {};
        if (query.childServer === 'true') {
            // 클라우드 PC 연결(다른 PC 의 연결 프로그램)은 쓰지 않는다
            socket.disconnect(true);
            return;
        }
        console.log('[entryServer] entry workspace connected', query.roomId || '');
        this.clients.push(socket);
        this.emit('connection');
        this.router && this.router.handleServerSocketConnected();

        socket.on('message', (message, ack) => {
            this.router && this.router.handleServerData(message || {});
            if (typeof ack === 'function') {
                const { key = true } = message || {};
                ack(key);
            }
        });
        socket.on('disconnect', () => {
            this.clients = this.clients.filter((c) => c !== socket);
            console.log('[entryServer] entry workspace disconnected');
            this.emit('close');
            this.router && this.router.handleServerSocketClosed();
        });
    }

    get connectedCount() {
        return this.clients.length;
    }

    send(data) {
        const payload = { data };
        this.clients.forEach((client) => client.emit('message', payload));
    }

    disconnectHardware() {
        this.send('disconnectHardware');
    }

    connectHardwareSuccess() {}

    connectHardwareFailed() {}

    addRoomIdsOnSecondInstance() {}

    close() {
        this.io && this.io.close();
        this.httpServer && this.httpServer.listening && this.httpServer.close();
    }
}

module.exports = AndroidEntryServer;
