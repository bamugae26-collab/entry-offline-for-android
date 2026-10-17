# 엔트리 로컬 (EntryLocal) — Windows exe + Android apk

공식 엔트리 오프라인(entry-offline v2.1.36, 커밋 `db7928d9`)을 포크해 **서버와 통신하지 않고**
**작품을 기기 내부 저장소에 보관**하도록 바꾼 엔트리입니다. 같은 패치(`entry-local.patch`)로
Windows 프로그램(exe)과 안드로이드 앱(apk)을 모두 만듭니다.

## 두 판의 공통 동작

| 구분 | 원본 엔트리 오프라인 | 엔트리 로컬 (exe / apk 공통) |
|---|---|---|
| 저장하기 | 매번 파일 저장 창 | 내부 저장소에 바로 저장 (처음엔 새 작품, 이후 덮어쓰기) |
| 다른 이름으로 저장 | 파일 저장 창 | `○○ 복사본` 으로 새 작품 생성 |
| 자동 저장 | 비정상 종료 복구용 임시본만 | 임시본 + 저장된 작품은 바뀐 내용이 있으면 1분마다 저장 (실행 중엔 건너뜀) |
| 불러오기 | 파일 열기 창 | **내 작품** 목록 (썸네일·검색·이름 바꾸기·복사·삭제·내보내기) |
| 파일 주고받기 | — | `파일로 내보내기 (.ent)`, `파일에서 가져오기 (.ent)` |
| 공유·실시간 변수/리스트 | 서버 저장·동기화 | 불러올 때 일반 변수로 변환, 만들기 메뉴에서 선택지 숨김 |
| 신호 | 엔진 내부 | 그대로 (원래 로컬 동작) |
| 업데이트 확인·하드웨어 로그·원격 모듈 | playentry.org 접속 | 하지 않음 |
| 하드웨어 연결 | hw.playentry.org 중계 먼저 시도 | 이 PC(127.0.0.1)만 (apk 는 하드웨어 기능 없음) |

`.ent` 형식은 공식 엔트리와 같습니다. 서로 만든 파일을 주고받아 열 수 있습니다 (아래 검증 참고).

## 저장 위치

- **Windows**: `%APPDATA%\EntryLocal\projects\` — 작품마다 `<id>.ent`, 목록은 `index.json`
- **Android**: 앱 전용 내부 저장소 `/data/data/biz.softline.entrylocal/files/projects/` (다른 앱에서 접근 불가)
  - 내보내기를 누르면 안드로이드 공유 창이 떠서 드라이브·파일 앱·메신저 등으로 보낼 수 있습니다.
  - 앱을 삭제하면 작품도 함께 지워집니다. 중요한 작품은 내보내기로 백업하세요.

---

## A. Windows exe 빌드

필요: Git, Node.js 20 LTS 이상, Python 3, Visual Studio Build Tools(C++ 데스크톱 개발)

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\build-windows.ps1
```

결과: `entry-offline\dist\EntryLocal-win32-x64\EntryLocal-Setup-2.1.36.exe`, `EntryLocal-Portable-2.1.36.exe`

## B-1. Android apk — GitHub 에서 빌드 (PC 설치 없음, 추천)

1. GitHub 에서 새 저장소를 만듭니다 (**Private** 권장).
2. 이 키트 폴더의 파일을 **숨김 폴더 `.github` 까지 포함해** 그대로 올립니다.
   - 웹에서 올릴 때: 저장소 → Add file → Upload files 에 폴더째 끌어다 놓기
3. (권장) 서명 키 등록: Settings → Secrets and variables → Actions → New repository secret
   - `ENTRY_KEYSTORE_PASSWORD`, `ENTRY_KEYSTORE_BASE64` (값은 `서명키_보관용.txt` 참고)
   - 등록하면 매번 같은 키로 서명되어, 새로 빌드한 APK 를 기존 앱 위에 **작품을 유지한 채 업데이트** 설치할 수 있습니다.
   - 등록하지 않으면 빌드마다 임시 키로 서명됩니다 (업데이트 시 기존 앱을 지우고 다시 설치해야 함).
4. Actions 탭 → **APK 빌드** → **Run workflow**
5. 20~40분 뒤 완료되면 실행 기록을 눌러 아래 **Artifacts → EntryLocal-apk** 를 내려받습니다 (zip 안에 apk).

## B-2. Android apk — 내 PC 에서 빌드

필요: Git, **Node.js 22 이상**, **Android Studio** (설치 후 한 번 실행해서 SDK 설치 — SDK Platform 36 포함).
JDK 는 Android Studio 에 들어 있는 것을 자동으로 찾습니다.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\build-android.ps1            # 바로 설치해서 쓸 APK (디버그 서명)
.\build-android.ps1 -Release   # 배포용 APK (처음 한 번 서명 키 비밀번호를 물어봄)
```

Linux/macOS: `./build-android.sh` / `./build-android.sh --release`

결과: `out\EntryLocal-2.1.36-debug.apk` (약 600MB — 라이브러리 그림·소리 포함)

처음 빌드는 Gradle·안드로이드 라이브러리를 내려받느라 시간이 꽤 걸릴 수 있습니다.

### 태블릿에 설치

1. APK 를 태블릿으로 옮깁니다 (USB, 드라이브, 메신저 등).
2. 파일을 누르면 "출처를 알 수 없는 앱 설치" 허용을 묻습니다 → 허용 후 설치.
3. 또는 PC 에서 `adb install out\EntryLocal-2.1.36-debug.apk`

- 가로 화면 고정입니다. **10인치 이상 태블릿**을 권장합니다 (휴대폰은 화면이 축소되어 표시됨).
- 블록은 손가락으로 끌어서 놓을 수 있습니다.
- 뒤로가기 버튼: 열린 '내 작품' 창을 닫고, 없으면 종료 확인을 묻습니다.
- 배포용 서명 키(`entry-offline\mobile\android\entrylocal.jks`)와 비밀번호는 잃어버리면 같은 앱으로 업데이트할 수 없으니 따로 보관하세요.

### 안드로이드판 구조

Electron 대신 Capacitor(안드로이드 WebView)로 같은 엔트리 화면을 띄웁니다.
화면·저장·내 작품 코드는 exe 와 같은 소스를 쓰고, Electron 이 하던 일만 브라우저용으로 다시 만들었습니다.

| Electron 판 | 안드로이드판 (`src/web/`) |
|---|---|
| preload (window.ipcInvoke 등) | `shim.ts` |
| main 프로세스 (저장·가져오기·내 작품 등 IPC 29개) | `webMain.ts` |
| userData 폴더 | `vfs.ts` — Capacitor Filesystem(앱 내부) / PC 확인용 개발 서버 |
| node-tar (.ent/.eo) | `tar.ts` — 같은 tar.gz 형식 직접 읽고 쓰기 |
| nativeImage·ffmpeg | `media.ts` — 캔버스 리사이즈, mp3 인코딩(lamejs) |
| 파일 대화상자 | `platform.ts` — 파일 선택기 / 공유 창 |

PC 브라우저로 안드로이드판 화면을 미리 보려면:
```bash
cd entry-offline && yarn build:web
cd mobile && npm ci && node scripts/assemble-www.js && node scripts/dev-server.js
# http://localhost:8100/
```

---

## 알아둘 점

- **인터넷이 필요한 블록은 남아 있습니다.** 인공지능(번역·읽어주기·음성인식 등)·확장 블록(날씨 등)은 서버를 호출하므로
  오프라인에서는 동작하지 않습니다.
- 오브젝트·모양·소리 기본 리소스는 앱에 모두 내장되어 있어 인터넷 없이 추가할 수 있습니다 (APK 가 큰 이유).
- 안드로이드판에서 안 되는 것: 하드웨어 연결, 아주 오래된 XML 형식 작품 열기(PC판에서 한 번 저장하면 열림).
- 공식 엔트리 오프라인은 MIT 라이선스입니다. 외부 배포 시 '엔트리' 명칭·로고는 네이버 커넥트재단 소유이므로
  이름과 아이콘을 바꾸는 것을 권합니다. (안드로이드판 아이콘은 자체 제작한 블록 모양입니다.)

## 검증한 내용

이 작업 환경에서는 Android SDK·Gradle 저장소가 막혀 있어 **APK 파일 자체는 빌드하지 못했습니다.**
대신 아래를 실제로 실행해 확인했습니다.

**Windows(Electron)판** — Linux + Xvfb 에서 실행
- 저장 / 덮어쓰기 / 다른 이름으로 저장 / 내 작품 목록 / 다시 열기, 변수 로컬화
- 하드웨어 소켓은 127.0.0.1 에만 접속, 외부 요청 0건

**안드로이드판 화면** — 새로 받은 원본에 패치를 적용하고 빌드 스크립트를 Gradle 직전까지 실행해서 만든 앱 자산을
Chromium 141 에 띄워 확인 (Gradle 이후는 표준 Capacitor 빌드)
- 저장 → 내부 저장소, 덮어쓰기, 복사본, 내 작품 목록(2개), 다시 열기 후 그림 5개 모두 표시·소리 재생
- 라이브러리 그림(png·svg)·직접 올린 jpg(→png 변환)·라이브러리 소리 추가, 소리 라이브러리 1,420개 경로 전부 확인
- 그림판 저장, 소리 편집기 저장(mp3 인코딩)
- `.ent` 내보내기 → Python tarfile 로 열림 → **Windows판에서 열기 성공**(그림 5개 표시)
- **Windows판에서 만든 `.ent` → 안드로이드판에서 열기 성공**
- 터치 에뮬레이션으로 블록 끌어 놓기 성공
- 하드웨어 카테고리 숨김, 외부 요청·웹소켓 0건

설치 후 실제 태블릿에서 한 번 확인할 것: 저장 → 앱 종료 → 다시 실행 → 내 작품에서 열기, 내보내기(공유 창), 소리 재생.
