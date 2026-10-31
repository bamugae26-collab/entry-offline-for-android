/**
 * Entry Android Hardware — Node 쪽(연결 프로그램 본체)과 화면 묶기
 *
 *   ENTRY_HW_DIR=<entry-hw 소스 폴더> node build.js
 *
 * 결과: ../android/app/src/main/assets/nodejs-project/
 *   main.js        : entry-hw 메인 로직 + 안드로이드용 바꿔 끼운 부분 (socket.io 는 node_modules 로 따로)
 *   ui/            : entry-hw 화면(React) + ipcRenderer 대신
 *   node_modules/  : socket.io 2 (서버), lodash · sprintf-js (하드웨어 모듈이 require), electron(같은 객체)
 * 하드웨어 모듈(modules/)·드라이버 등은 빌드 때(CI) entry-hw 에서 복사한다 (copy-modules.js).
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const HW = path.resolve(process.env.ENTRY_HW_DIR || path.join(__dirname, '..', '..', '..', 'entry-hw'));
const SRC = path.join(__dirname, 'src');
const UI_SRC = path.join(__dirname, 'ui-src');
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'nodejs-project'));
const NM = path.join(__dirname, 'node_modules');

if (!fs.existsSync(path.join(HW, 'app', 'src', 'main', 'mainRouter.ts'))) {
    console.error(`entry-hw 소스를 찾지 못했습니다: ${HW}  (ENTRY_HW_DIR 로 지정)`);
    process.exit(1);
}

/** entry-hw 소스를 안드로이드에 맞게 조금 고치는 곳 (찾는 글자가 없으면 빌드 실패 → 원본이 바뀜 것) */
const PATCHES = {
    'main/core/serial/scanner.ts': [
        [
            // 설정(vendor·pnpId)으로 포트를 못 고르면 USB 시리얼 포트 전부를 후보로 (안드로이드는 제조사 이름이 PC 와 다를 수 있음).
            // 어떤 포트가 맞는지는 원래대로 하드웨어와 주고받는 첫 신호(handshake)로 가린다.
            `selectedPorts.push(
                ..._.compact(comPorts.map((port) => this._selectCOMPortUsingProperties(hardware, port))),
            );`,
            `selectedPorts.push(
                ..._.compact(comPorts.map((port) => this._selectCOMPortUsingProperties(hardware, port))),
            );
            if (selectedPorts.length === 0) {
                selectedPorts.push(...comPorts.filter((port) => !(port as any).bluetooth).map((port) => port.path));
            }`,
        ],
    ],
    'main/core/serial/connector.ts': [
        [
            // 펌웨어가 없을 때 자동 설치(PC 프로그램 필요)로 넘어가지 않고 계속 연결을 기다린다
            'if (firmwarecheck) {',
            'if (false && firmwarecheck) {',
        ],
        ["SerialPort.Binding = require('@serialport/bindings');", ''],
    ],
};

const patchPlugin = {
    name: 'entry-hw-android',
    setup(build) {
        // Electron · 시리얼포트 · 로그 · 펌웨어 · HID 는 안드로이드용으로
        build.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(SRC, 'electron.js') }));
        build.onResolve({ filter: /^serialport$/ }, () => ({ path: path.join(SRC, 'serialport.js') }));
        build.onResolve({ filter: /^node-hid$/ }, () => ({ path: path.join(SRC, 'node-hid.js') }));
        build.onResolve({ filter: /electron\/functions\/createLogger$/ }, () => ({ path: path.join(SRC, 'logger.js') }));
        build.onResolve({ filter: /electron\/modifyValidator$/ }, () => ({ path: path.join(SRC, 'stubs-validator.js') }));
        build.onResolve({ filter: /\/flasher$/ }, (args) =>
            args.importer.includes(`${path.sep}core${path.sep}`) || args.importer.endsWith('mainRouter.ts')
                ? { path: path.join(SRC, 'flasher.js') }
                : undefined
        );
        build.onResolve({ filter: /^ENTRY_HW\// }, (args) => ({
            path: path.join(HW, 'app', 'src', `${args.path.slice('ENTRY_HW/'.length)}.ts`),
        }));
        // PC 전용 기능(드라이버 설치·모듈 내려받기 압축 풀기 등)이 쓰는 패키지
        for (const name of ['cross-spawn', 'fs-extra', 'tar', 'rimraf', 'winston', 'winston-daily-rotate-file', '@serialport/bindings']) {
            build.onResolve({ filter: new RegExp(`^${name.replace('/', '\\/')}$`) }, () => ({ path: path.join(SRC, 'empty.js') }));
        }
        build.onLoad({ filter: /\.ts$/ }, (args) => {
            const rel = path.relative(path.join(HW, 'app', 'src'), args.path).split(path.sep).join('/');
            let text = fs.readFileSync(args.path, 'utf8');
            (PATCHES[rel] || []).forEach(([from, to]) => {
                if (!text.includes(from)) {
                    throw new Error(`patch target not found in ${rel}: ${from.slice(0, 60)}`);
                }
                text = text.replace(from, to);
            });
            return { contents: text, loader: 'ts' };
        });
    },
};

async function buildMain() {
    await esbuild.build({
        entryPoints: [path.join(SRC, 'main.js')],
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        outfile: path.join(OUT, 'main.js'),
        external: ['socket.io', './nativeNodeRequire.js'],
        // 하드웨어 설정(json)의 'win32' 값(포트 선택·제조사 이름 등)을 쓰게 한다 — entry-hw 코드 안에서만
        define: { 'process.platform': '"win32"' },
        plugins: [patchPlugin],
        nodePaths: [NM],
        logLevel: 'warning',
        legalComments: 'inline',
    });
    // mainRouter 가 모듈을 불러오는 함수 (그대로 require)
    fs.writeFileSync(path.join(OUT, 'nativeNodeRequire.js'), 'module.exports = (modulePath) => require(modulePath);\n');
}

/** 화면(React) 쪽 entry-hw 소스 고치기 (찾는 글자가 없으면 빌드 실패) */
const UI_PATCHES = {
    'renderer/react/main/components/hardwareList/ErrorAlert.tsx': [
        [
            // '하드웨어 연결과 작동 시 예기치 못한 문제가…' 안내에 [×] 닫기 — 한 번 닫으면 다음에도 닫힌 채로
            `const ErrorAlert = () => {
    const { translator } = usePreload();
    return (
        <ErrorAlertContainer>`,
            `const ErrorAlert = () => {
    const { translator } = usePreload();
    const [closed, setClosed] = React.useState(() => {
        try {
            return localStorage.getItem('android.hideErrorAlert') === '1';
        } catch (e) {
            return false;
        }
    });
    if (closed) {
        return null;
    }
    const close = () => {
        try {
            localStorage.setItem('android.hideErrorAlert', '1');
        } catch (e) {
            // 저장 못 함 — 이번에만 닫힘
        }
        setClosed(true);
    };
    return (
        <ErrorAlertContainer style={{ position: 'relative' }}>
            <button type="button" className="android-alert-close" aria-label="close" onClick={close}>×</button>`,
        ],
    ],
};

async function buildUi() {
    const uiOut = path.join(OUT, 'ui');
    fs.mkdirSync(uiOut, { recursive: true });
    await esbuild.build({
        entryPoints: [path.join(UI_SRC, 'index.tsx')],
        bundle: true,
        platform: 'browser',
        target: ['chrome80'],
        format: 'iife',
        outfile: path.join(uiOut, 'main.build.js'),
        loader: { '.png': 'file', '.svg': 'file', '.woff': 'file', '.jpg': 'file', '.gif': 'file' },
        assetNames: 'resources/[name]-[hash]',
        publicPath: '/',
        define: { 'process.env.NODE_ENV': '"production"', 'process.platform': '"android"' },
        plugins: [
            {
                name: 'ui-alias',
                setup(build) {
                    build.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(UI_SRC, 'electron-renderer.ts') }));
                    build.onResolve({ filter: /^ENTRY_HW\// }, (args) => {
                        const rel = args.path.slice('ENTRY_HW/'.length);
                        const base = path.join(HW, 'app', 'src', rel);
                        for (const ext of ['.tsx', '.ts', '.js', '']) {
                            if (fs.existsSync(base + ext)) {
                                return { path: base + ext };
                            }
                        }
                        return undefined;
                    });
                    build.onLoad({ filter: /\.tsx?$/ }, (args) => {
                        const rel = path.relative(path.join(HW, 'app', 'src'), args.path).split(path.sep).join('/');
                        if (!UI_PATCHES[rel]) {
                            return undefined;
                        }
                        let text = fs.readFileSync(args.path, 'utf8');
                        UI_PATCHES[rel].forEach(([from, to]) => {
                            if (!text.includes(from)) {
                                throw new Error(`patch target not found in ${rel}: ${from.slice(0, 60)}`);
                            }
                            text = text.replace(from, to);
                        });
                        return { contents: text, loader: rel.endsWith('.tsx') ? 'tsx' : 'ts' };
                    });
                },
            },
        ],
        nodePaths: [NM],
        minify: true,
        logLevel: 'warning',
    });
    // 팝업(Modal) 스크립트·스타일, 글꼴은 entry-hw 의 것을 그대로
    const rendererDir = path.join(HW, 'app', 'src', 'renderer');
    fs.copyFileSync(path.join(rendererDir, 'modal', 'app.js'), path.join(uiOut, 'modal.js'));
    fs.copyFileSync(path.join(rendererDir, 'modal', 'app.css'), path.join(uiOut, 'modal.css'));
    fs.copyFileSync(path.join(UI_SRC, 'index.html'), path.join(uiOut, 'index.html'));
    fs.copyFileSync(path.join(UI_SRC, 'android.css'), path.join(uiOut, 'android.css'));
    const sio = path.join(NM, 'socket.io-client', 'dist', 'socket.io.js');
    fs.copyFileSync(sio, path.join(uiOut, 'socket.io.js'));
}

function copyNodeModules() {
    // 런타임 패키지 (socket.io 2 서버와 그 의존성, 하드웨어 모듈이 쓰는 lodash·sprintf-js)
    const want = new Set();
    const visit = (name) => {
        if (want.has(name)) {
            return;
        }
        const pj = path.join(NM, name, 'package.json');
        if (!fs.existsSync(pj)) {
            return;
        }
        want.add(name);
        const deps = Object.keys(JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies || {});
        deps.forEach(visit);
    };
    ['socket.io', 'lodash', 'sprintf-js'].forEach(visit);
    const dest = path.join(OUT, 'node_modules');
    fs.rmSync(dest, { recursive: true, force: true });
    want.forEach((name) => {
        fs.cpSync(path.join(NM, name), path.join(dest, name), {
            recursive: true,
            filter: (src) => !/\.(md|map)$/i.test(src),
        });
    });
    // 모듈 파일의 require('electron') → 메인과 같은 객체
    fs.mkdirSync(path.join(dest, 'electron'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'electron', 'index.js'), 'module.exports = global.__entryHwElectron || {};\n');
    fs.writeFileSync(path.join(dest, 'electron', 'package.json'), '{ "name": "electron", "main": "index.js" }\n');
    return [...want];
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await buildMain();
    await buildUi();
    const pkgs = copyNodeModules();
    fs.copyFileSync(path.join(SRC, 'version.json'), path.join(OUT, 'version.json'));
    console.log(`built → ${OUT}\n  node_modules: ${pkgs.join(', ')}`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
