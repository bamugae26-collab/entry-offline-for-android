/**
 * [Entry Android Hardware] entry-hw 의 preload(index.ts) 대신
 * 화면 코드가 쓰는 전역 값(window.ipcRenderer · translator · rendererRouter · clipboard · os)을 만든다.
 */
import RendererRouter from 'ENTRY_HW/preload/rendererRouter';
import translations from 'ENTRY_HW/preload/translations.json';
import { ipcRenderer, clipboard } from './electron-renderer';

const w = window as any;

/** 안드로이드에서 문구를 바꾸는 것 */
const ANDROID_TEXT: Record<string, { ko: string; en: string }> = {
    'Failed Firmware Upload': {
        ko: '안드로이드에서는 펌웨어를 설치할 수 없습니다. PC의 엔트리 하드웨어 연결 프로그램으로 한 번 설치해 주세요.',
        en: 'Firmware cannot be installed on Android. Install it once with the Entry hardware program on a PC.',
    },
    'Hardware device is disconnected. Please restart this program.': {
        ko: '하드웨어 연결이 끊어졌습니다. 선을 확인한 뒤 다시 연결해 주세요.',
        en: 'The hardware was disconnected. Check the cable and connect again.',
    },
    'Connection failed. please restart application or reconnect manually.': {
        ko: '하드웨어 연결에 실패했습니다. 선(USB OTG)·블루투스를 확인한 뒤 다시 연결해 주세요.',
        en: 'Connection failed. Check the USB (OTG) cable or Bluetooth and try again.',
    },
    'Select the COM PORT to connect': { ko: '연결할 기기를 선택하세요', en: 'Select the device to connect' },
    'Disconnected from the Entry server': { ko: 'Entry for Android 연결 안 됨', en: 'Entry for Android not connected' },
    'Connected to the Entry server': { ko: 'Entry for Android 연결됨', en: 'Connected to Entry for Android' },
};

class Translator {
    lang: 'ko' | 'en';

    constructor(lang?: string) {
        this.lang = lang === 'ko' ? 'ko' : 'en';
    }

    get currentLanguage() {
        return this.lang;
    }

    translate(str: any) {
        if (typeof str === 'string') {
            const android = ANDROID_TEXT[str];
            if (android) {
                return android[this.lang];
            }
            const value = (translations as any)[str] || {};
            return value[this.lang] || str;
        }
        return str ? str[this.lang] || str.ko || str.en : str;
    }
}

class AndroidRendererRouter extends RendererRouter {
    openExternalUrl(url: string) {
        ipcRenderer.send('openExternal', url);
    }

    /** [새로고침]: PC 는 프로그램을 다시 켠다 → 안드로이드는 연결을 닫고 화면만 다시 */
    reloadApplication() {
        ipcRenderer.send('close');
        location.reload();
    }

    requestOpenAboutWindow() {
        w.__showAbout && w.__showAbout();
    }

    async checkProgramUpdate() {
        // 업데이트는 GitHub 릴리스에서 받는다
    }

    executeDriverFile() {
        // 안드로이드에는 드라이버가 필요 없다
    }
}

const rendererRouter = new AndroidRendererRouter();
const lang = (rendererRouter.sharedObject && rendererRouter.sharedObject.language) || 'ko';

Object.assign(w, {
    ipcRenderer,
    clipboard,
    translator: new Translator(lang),
    os: 'android', // 드라이버 버튼(win32-x64 등)이 나오지 않게
    rendererRouter,
});
