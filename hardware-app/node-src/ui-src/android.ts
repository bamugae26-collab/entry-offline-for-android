/**
 * [Entry Android Hardware] 안드로이드에만 있는 화면 요소
 *  - [Entry for Android 로 돌아가기] 버튼 (하드웨어 연결 화면)
 *  - 버전 정보 창
 */
import { ipcRenderer } from './ipc';

const w = window as any;
const t = (ko: string, en: string) => (w.translator && w.translator.currentLanguage === 'ko' ? ko : en);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) {
        e.textContent = text;
    }
    return e;
}

function backButton() {
    const btn = el('button', 'android-back-to-entry', t('Entry for Android로 돌아가기', 'Back to Entry for Android'));
    btn.type = 'button';
    btn.addEventListener('click', () => ipcRenderer.send('openEntry'));
    document.body.appendChild(btn);
    // 하드웨어 목록 화면('하드웨어 선택')에서는 숨기고, 연결 화면에서만 보인다
    const listTitle = t('하드웨어 선택', 'Select hardware');
    const update = () => {
        const header = document.querySelector('#__main');
        const onList = !header || [...header.querySelectorAll('h1, h2, div, span')].some(
            (e) => e.children.length === 0 && (e.textContent || '').trim() === listTitle
        );
        const show = !onList;
        if ((btn.style.display !== 'none') !== show) {
            btn.style.display = show ? '' : 'none';
        }
    };
    new MutationObserver(update).observe(document.body, { childList: true, subtree: true, characterData: true });
    update();
}

function about() {
    const version = ipcRenderer.sendSync('getAppVersion') || {};
    const overlay = el('div', 'android-about');
    const box = el('div', 'android-about-box');
    box.appendChild(el('h2', '', 'Entry Android Hardware'));
    box.appendChild(el('p', '', `${t('버전', 'Version')} ${version.app || ''}`));
    box.appendChild(el('p', 'sub', `${t('엔트리 하드웨어 연결 프로그램', 'Entry Hardware')} ${version.entryHw || ''} ${t('기반', 'based')}`));
    box.appendChild(
        el(
            'p',
            'sub',
            t(
                '엔트리 하드웨어 연결 프로그램(entry-hw, MIT)을 안드로이드에서 쓸 수 있게 만든 비공식 앱입니다.',
                'An unofficial Android port of the Entry hardware program (entry-hw, MIT).'
            )
        )
    );
    const ok = el('button', 'android-about-ok', t('확인', 'OK'));
    ok.type = 'button';
    ok.addEventListener('click', () => overlay.remove());
    box.appendChild(ok);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => e.target === overlay && overlay.remove());
    document.body.appendChild(overlay);
}

w.__showAbout = about;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', backButton);
} else {
    backButton();
}
