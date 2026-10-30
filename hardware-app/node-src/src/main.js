/**
 * [Entry Android Hardware] Node 시작점 (nodejs-mobile 이 실행)
 *
 * PC 엔트리 하드웨어 연결 프로그램(entry-hw, MIT)의 메인 로직(MainRouter)을 그대로 돌리고,
 * Electron·시리얼포트·서버 프로그램 부분만 안드로이드용으로 바꿔 끼운다.
 *
 * 포트 (모두 127.0.0.1, 기기 밖에서는 접속 불가)
 *  - 23518 : 엔트리 작업 화면 (Entry for Android) ↔ 연결 프로그램   — PC 판과 같은 번호
 *  - 23519 : 이 앱의 화면(WebView)
 *  - 23520 : 이 앱의 Java 부분 (USB·블루투스 시리얼)
 *
 * 환경 변수: ENTRY_HW_ROOT(모듈·화면 폴더), ENTRY_HW_DATA(쓰기 가능 폴더), ENTRY_HW_TOKEN, ENTRY_HW_LANG
 */
const path = require('path');
const fs = require('fs');
const electron = require('./electron');
const bridge = require('./bridge');
const AndroidEntryServer = require('./entryServer');
const startUiServer = require('./uiServer');
const mainRouterModule = require('ENTRY_HW/main/mainRouter');
const MainRouter = mainRouterModule.default || mainRouterModule;

const VERSION = require('./version.json');
const ROOT = process.env.ENTRY_HW_ROOT || __dirname;
const DATA = process.env.ENTRY_HW_DATA || ROOT;
const LANG = (process.env.ENTRY_HW_LANG || 'ko').slice(0, 2) === 'ko' ? 'ko' : 'en';
const PORTS = { entry: 23518, ui: 23519, bridge: Number(process.env.ENTRY_HW_BRIDGE_PORT || 23520) };

process.on('uncaughtException', (e) => console.error('[main] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection', e));

electron.__setDataPath(DATA);
electron.__setOpenExternal((url) => bridge.notify('openUrl', { url }));

global.sharedObject = {
    appName: 'hardware',
    hardwareVersion: VERSION.entryHw,
    roomIds: [],
    language: LANG,
    updateCheckUrl: '',
    moduleResourceUrl: '',
};

bridge.listen(PORTS.bridge, process.env.ENTRY_HW_TOKEN || '');

const entryServer = new AndroidEntryServer();
const router = new MainRouter(electron.__mainWindow, entryServer, { rootAppPath: ROOT });

// 연결 상태를 앱(Java)에도 알린다 — 연결되면 Entry for Android 로 돌아가기, 알림 문구 바꾸기
let lastState;
electron.__onSend((channel, args) => {
    if (channel === 'state') {
        lastState = args[0];
        bridge.notify('state', { state: lastState, name: currentName() });
    } else if (channel === 'socketConnected') {
        bridge.notify('entry', { connected: !!args[0] });
    }
});

let currentHardware;
function currentName() {
    const name = currentHardware && currentHardware.name;
    return (name && (name[LANG] || name.ko || name.en)) || '';
}

const { ipcMain } = electron;
ipcMain.on('startScan', (e, config) => {
    currentHardware = config;
});
ipcMain.on('close', () => {
    currentHardware = undefined;
});
// PC 판의 Electron 창 쪽(electron/index.ts)에서 처리하던 것들
ipcMain.handle('checkUpdate', async () => ({ hasNewVersion: false, recentVersion: VERSION.app }));
ipcMain.handle('getOpenSourceText', async () => {
    try {
        return fs.readFileSync(path.join(ROOT, 'OPENSOURCE.md'), 'utf8');
    } catch (e) {
        return '';
    }
});
ipcMain.on('reload', () => undefined);
ipcMain.on('hardwareForceClose', () => undefined);
ipcMain.on('showMessageBox', () => undefined);
ipcMain.on('openAboutWindow', () => undefined);
ipcMain.on('closeAboutWindow', () => undefined);
ipcMain.on('openExternal', (e, url) => bridge.notify('openUrl', { url }));
ipcMain.on('openEntry', () => bridge.notify('openEntry'));
ipcMain.on('getAppVersion', (e) => {
    e.returnValue = VERSION;
});

// 화면(ipcRenderer) 요청 중 안드로이드에서 다르게 처리할 것
function intercept(kind, channel) {
    if (channel === 'getBaseModulePath') {
        return { handled: true, value: '/modules' };
    }
    if (channel === 'requestFlash') {
        // 펌웨어 설치는 PC 프로그램(avrdude 등)이 필요 → 연결을 끊지 않고 바로 안내
        return { handled: true, error: new Error('android') };
    }
    if (channel === 'requestHardwareListSync') {
        // HID(USB 키보드형) 하드웨어는 안드로이드에서 쓸 수 없다
        const list = router.hardwareListManager ? router.hardwareListManager.allHardwareList : [];
        return { handled: true, value: list.filter((c) => !c.hardware || c.hardware.type !== 'hid') };
    }
    return undefined;
}

startUiServer({
    port: PORTS.ui,
    uiDir: path.join(ROOT, 'ui'),
    modulesDir: path.join(ROOT, 'modules'),
    intercept,
});

// 엔트리에서 [연결 프로그램 열기]로 앱이 열림 → roomId, (있으면) 하드웨어 바로 선택
bridge.on('launch', ({ roomId, openHardwareId }) => {
    if (roomId) {
        global.sharedObject.roomIds.push(roomId);
        router.addRoomId(roomId);
    }
    if (openHardwareId) {
        router.selectHardware(openHardwareId);
    }
});
bridge.on('attached', () => {
    lastState && bridge.notify('state', { state: lastState, name: currentName() });
    bridge.notify('entry', { connected: entryServer.connectedCount > 0 });
});
bridge.on('stop', () => {
    router.close();
});

console.log(`[main] Entry Android Hardware ${VERSION.app} (entry-hw ${VERSION.entryHw}) started, root=${ROOT}`);
