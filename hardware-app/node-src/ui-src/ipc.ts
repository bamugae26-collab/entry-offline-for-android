/**
 * [Entry Android Hardware] 화면 쪽 ipcRenderer (Electron 대신)
 *  - sendSync : 동기 XHR → Node(127.0.0.1:23519) /ipc-sync
 *  - send / invoke / on : socket.io
 */
declare const io: any;

type Listener = (event: any, ...args: any[]) => void;

const listeners = new Map<string, Listener[]>();
const socket = io({ transports: ['websocket'] });
const fakeEvent = { sender: null };

socket.on('ipc', (channel: string, args: any[] = []) => {
    (listeners.get(channel) || []).slice().forEach((fn) => {
        try {
            fn(fakeEvent, ...args);
        } catch (e) {
            console.error('ipc listener error', channel, e);
        }
    });
});

export const ipcRenderer = {
    send(channel: string, ...args: any[]) {
        socket.emit('ipc-send', channel, args);
    },
    sendSync(channel: string, ...args: any[]) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/ipc-sync', false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        try {
            xhr.send(JSON.stringify({ channel, args }));
            return JSON.parse(xhr.responseText || '{}').value;
        } catch (e) {
            console.error('sendSync failed', channel, e);
            return undefined;
        }
    },
    invoke(channel: string, ...args: any[]) {
        return new Promise((resolve, reject) => {
            socket.emit('ipc-invoke', channel, args, (r: { value?: any; error?: string }) => {
                r && r.error !== undefined ? reject(new Error(r.error)) : resolve(r && r.value);
            });
        });
    },
    on(channel: string, fn: Listener) {
        listeners.set(channel, [...(listeners.get(channel) || []), fn]);
        return ipcRenderer;
    },
    once(channel: string, fn: Listener) {
        const wrap: Listener = (e, ...a) => {
            ipcRenderer.removeListener(channel, wrap);
            fn(e, ...a);
        };
        return ipcRenderer.on(channel, wrap);
    },
    removeListener(channel: string, fn: Listener) {
        listeners.set(channel, (listeners.get(channel) || []).filter((x) => x !== fn));
        return ipcRenderer;
    },
    removeAllListeners(channel?: string) {
        channel ? listeners.delete(channel) : listeners.clear();
        return ipcRenderer;
    },
    handle() {
        // BLE(웹 블루투스) 처리용 — 안드로이드판은 쓰지 않음
    },
};

export const socketConnection = socket;
