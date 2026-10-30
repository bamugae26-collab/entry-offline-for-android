# Entry Android Hardware — 엔트리 하드웨어 연결 프로그램 (안드로이드)

PC 의 **엔트리 하드웨어 연결 프로그램**(entry-hw, MIT)을 안드로이드에서 쓸 수 있게 만든 앱입니다.
Entry for Android 의 하드웨어 칸 **"프로그램을 설치해 연결할 때"** 가 이 앱을 씁니다.

## 쓰는 법
1. Entry for Android → 블록 → **하드웨어** 칸 → [하드웨어 연결하기] 또는 [연결 프로그램 열기]
   - 이 앱이 없으면 **미설치 안내** 창 → [연결 프로그램 다운로드] = 이 저장소 릴리스의 `EntryAndroidHardware.apk`
2. 이 앱 화면(PC 연결 프로그램과 같은 화면)에서 하드웨어를 고른다 → USB(OTG)·블루투스로 연결
3. 연결되면 **Entry for Android 로 자동으로 돌아간다.** 이 앱은 닫히지 않고 뒤에서 연결을 유지 (알림창 "○○ 연결됨")
   - 연결 화면의 [Entry for Android로 돌아가기] 버튼으로도 돌아갈 수 있음
   - 끝내려면 알림의 [종료]

## 지원 범위
- PC 연결 프로그램 목록의 하드웨어 227종 (USB 시리얼·블루투스 시리얼). HID 방식 1종은 안드로이드에서 쓸 수 없어 뺀
- USB 칩: 아두이노 정품·CH340·CP210x·FTDI·PL2303 (usb-serial-for-android)
- 블루투스 시리얼: 안드로이드 설정에서 먼저 등록(페어링)한 기기. 처음 실행할 때 '근처 기기' 권한을 물음
- **펌웨어 설치는 안 됨** — PC 프로그램(avrdude 등)이 필요. PC 의 엔트리 하드웨어 연결 프로그램으로 한 번 설치해 두면 됨
- 드라이버 설치 버튼은 나오지 않음 (안드로이드는 필요 없음)

## 구조
| 부분 | 하는 일 |
|---|---|
| `node-src/` | entry-hw 메인 로직(MainRouter·스캐너·커넥터·하드웨어 모듈)을 그대로 쓰고 Electron·시리얼포트·서버 부분만 안드로이드용으로 바꿔 끼움 → `main.js`. 화면(React)도 entry-hw 것 그대로 → `ui/` |
| nodejs-mobile | 앱 안에서 Node.js 실행 (`app/libnode`, 빌드 때 내려받음) |
| `android/` | WebView 화면, 알림 서비스(뒤에서 연결 유지), USB·블루투스 시리얼(Java), Entry for Android 로 돌아가기 |

포트 (모두 127.0.0.1 — 기기 밖에서는 접속 불가)
- 23518 : Entry for Android ↔ 연결 프로그램 (PC 와 같은 번호, socket.io 2)
- 23519 : 이 앱의 화면
- 23520 : Node ↔ Java (USB·블루투스). 앱이 Node 를 켤 때 만든 비밀 값으로만 접속

## 빌드
- **GitHub Actions**: 저장소 Actions → "하드웨어 앱 빌드" (또는 `hardware-app/` 을 바꿔 main 에 push)
  - 끝나면 릴리스 **hardware-latest** 에 `EntryAndroidHardware.apk` 가 올라감 (Entry for Android 가 받는 주소)
  - 서명: Entry for Android 와 같은 Secrets(`ENTRY_KEYSTORE_BASE64`, `ENTRY_KEYSTORE_PASSWORD`)
  - **저장소가 공개(public)여야** 앱에서 내려받을 수 있음
- 직접: `bash hardware-app/build-hw.sh` (Node 22, JDK 21, Gradle 8.14+, Android SDK 36 · NDK 27 · CMake 3.22.1)
- entry-hw 는 고정 커밋(`build-hw.sh` 의 ENTRY_HW_COMMIT, 1.9.78)을 받아 씁. 새 버전을 쓰려면 이 값을 바꾸면 됨
  (`node-src/build.js` 의 PATCHES 가 원본에서 찾는 글자가 없으면 빌드가 멈춤 → 그 부분만 맞추면 됨)

## 문제 볼 때
`adb logcat -s EntryHwNode EntryHw EntryHwBridge` — 연결 프로그램 로그 (PC 프로그램의 로그와 같은 내용)

## 라이선스
entry-hw (MIT, Entrylabs) · usb-serial-for-android (MIT) · nodejs-mobile (MIT 외 Node.js 라이선스) — 앱의 [오픈소스 라이선스]에 표시
