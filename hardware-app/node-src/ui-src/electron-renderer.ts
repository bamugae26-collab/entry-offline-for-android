/** 화면 쪽 'electron' 대신 (entry-hw preload/rendererRouter.ts 가 import) */
import { ipcRenderer } from './ipc';

export { ipcRenderer };
export const remote = {};
export const ipcMain = {};
export const webFrame = { setZoomFactor: () => undefined };
export const shell = {
    openExternal: (url: string) => ipcRenderer.send('openExternal', url),
};
export const clipboard = {
    writeText: (text: string) => {
        try {
            navigator.clipboard.writeText(text);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    },
};
export default { ipcRenderer, remote, ipcMain, webFrame, shell, clipboard };
