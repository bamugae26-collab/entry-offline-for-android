/**
 * [Entry Android Hardware] 'electron' 대신
 *
 * entry-hw(PC 연결 프로그램)의 메인 로직은 Electron 의 ipcMain / BrowserWindow / shell 등을 쓴다.
 * 안드로이드에서는 Electron 이 없으므로, 같은 모양을 만들고
 *  - ipcMain    : 앱 화면(WebView)과 주고받는 메시지 (uiServer.js 가 전달)
 *  - BrowserWindow.webContents.send : 화면으로 보내는 이벤트
 *  - shell.openExternal : 안드로이드 쪽(bridge.js)에 주소 열기 요청
 * 으로 바꿔 둔다.
 */
const EventEmitter = require('events');
const os = require('os');
const path = require('path');

class IpcMain extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100);
        this.handlers = new Map();
    }

    handle(channel, fn) {
        this.handlers.set(channel, fn);
    }

    handleOnce(channel, fn) {
        this.handlers.set(channel, (...args) => {
            this.handlers.delete(channel);
            return fn(...args);
        });
    }

    removeHandler(channel) {
        this.handlers.delete(channel);
    }

    /** 화면의 ipcRenderer.send */
    receiveSend(channel, args) {
        this.emit(channel, { sender: webContents, returnValue: undefined }, ...args);
    }

    /** 화면의 ipcRenderer.sendSync → returnValue */
    receiveSendSync(channel, args) {
        const event = { sender: webContents, returnValue: undefined };
        this.emit(channel, event, ...args);
        return event.returnValue;
    }

    /** 화면의 ipcRenderer.invoke → Promise */
    async receiveInvoke(channel, args) {
        const fn = this.handlers.get(channel);
        if (!fn) {
            throw new Error(`No handler registered for '${channel}'`);
        }
        return fn({ sender: webContents }, ...args);
    }
}

const ipcMain = new IpcMain();

/** 화면으로 보내는 통로 — uiServer 가 setSender 로 연결 */
const sendListeners = [];
const webContents = {
    send(channel, ...args) {
        sendListeners.forEach((fn) => {
            try {
                fn(channel, args);
            } catch (e) {
                console.error('webContents.send listener error', e);
            }
        });
    },
    isDestroyed: () => false,
    executeJavaScript: async () => undefined,
};

class BrowserWindow {
    constructor() {
        this.webContents = webContents;
    }

    isDestroyed() {
        return false;
    }

    static getAllWindows() {
        return [mainWindow];
    }
}

const mainWindow = new BrowserWindow();

let openExternalImpl = (url) => console.log('openExternal', url);

const shell = {
    openExternal: (url) => {
        openExternalImpl(url);
        return Promise.resolve();
    },
    openPath: async () => '',
    showItemInFolder: () => undefined,
};

/** electron.net: 엔트리 서버의 온라인 모듈 목록 — 안드로이드판은 앱에 든 모듈만 쓴다 */
const net = {
    request() {
        const req = new EventEmitter();
        req.end = () => setImmediate(() => req.emit('error', new Error('offline')));
        req.setHeader = () => undefined;
        req.write = () => undefined;
        req.abort = () => undefined;
        return req;
    },
};

const dialog = {
    showMessageBoxSync: () => 0,
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

let dataPath = os.tmpdir();
const app = {
    getPath: () => dataPath,
    getAppPath: () => path.join(__dirname),
    getVersion: () => '1.0.0',
    getLocale: () => 'ko',
    on: () => undefined,
    quit: () => undefined,
};

const electron = {
    ipcMain,
    BrowserWindow,
    shell,
    net,
    dialog,
    app,
    // 우리 쪽에서만 쓰는 것
    __mainWindow: mainWindow,
    __onSend: (fn) => sendListeners.push(fn),
    __setOpenExternal: (fn) => {
        openExternalImpl = fn;
    },
    __setDataPath: (p) => {
        dataPath = p;
    },
};

// 모듈 폴더의 하드웨어 파일이 require('electron') 할 때도 같은 객체를 쓰게 한다 (node_modules/electron)
global.__entryHwElectron = electron;

module.exports = electron;
