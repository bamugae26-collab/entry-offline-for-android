/**
 * entry-hw 의 하드웨어 모듈(설정 json · 통신 js · 그림 png)과 라이선스를 앱 자산 폴더로 복사한다.
 *   ENTRY_HW_DIR=<entry-hw 소스> node copy-modules.js
 * HID 하드웨어(안드로이드에서 못 씀)는 빼고, 펌웨어·드라이버(PC 전용)는 복사하지 않는다.
 */
const fs = require('fs');
const path = require('path');

const HW = path.resolve(process.env.ENTRY_HW_DIR || path.join(__dirname, '..', '..', '..', 'entry-hw'));
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'nodejs-project'));
const src = path.join(HW, 'app', 'modules');
const dest = path.join(OUT, 'modules');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let count = 0;
let skipped = 0;
const hid = new Set();
for (const file of fs.readdirSync(src)) {
    if (!file.endsWith('.json')) {
        continue;
    }
    try {
        const config = JSON.parse(fs.readFileSync(path.join(src, file), 'utf8'));
        if (config.hardware && config.hardware.type === 'hid') {
            hid.add(file.replace(/\.json$/, ''));
            skipped++;
        }
    } catch (e) {
        // 깨진 설정은 그대로 둔다 (원본도 읽지 못함)
    }
}
for (const file of fs.readdirSync(src)) {
    const full = path.join(src, file);
    if (fs.statSync(full).isDirectory()) {
        fs.cpSync(full, path.join(dest, file), { recursive: true });
        continue;
    }
    if (file.endsWith('.json') && hid.has(file.replace(/\.json$/, ''))) {
        continue;
    }
    fs.copyFileSync(full, path.join(dest, file));
    file.endsWith('.json') && count++;
}
const notice = [
    'Entry Android Hardware — 오픈소스 라이선스\n',
    '이 앱은 엔트리 하드웨어 연결 프로그램(entry-hw)을 안드로이드에서 쓸 수 있게 만든 것입니다.',
    'entry-hw: https://github.com/entrylabs/entry-hw (MIT License, Copyright (c) 2017 Entrylabs)',
    'usb-serial-for-android: https://github.com/mik3y/usb-serial-for-android (MIT License)',
    'nodejs-mobile: https://github.com/nodejs-mobile/nodejs-mobile (MIT License 외 Node.js 라이선스)\n',
    fs.readFileSync(path.join(HW, 'LICENSE'), 'utf8'),
    '\n----\n',
    fs.existsSync(path.join(HW, 'app', 'OPENSOURCE.md')) ? fs.readFileSync(path.join(HW, 'app', 'OPENSOURCE.md'), 'utf8') : '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'OPENSOURCE.md'), notice);
console.log(`modules copied: ${count} hardware (${skipped} HID skipped) → ${dest}`);
