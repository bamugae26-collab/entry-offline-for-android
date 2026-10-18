#!/usr/bin/env bash
# 엔트리 로컬 안드로이드(APK) 빌드 스크립트 (Linux / macOS)
#
#   ./build-android.sh            # 디버그 서명 APK
#   ./build-android.sh --release  # 배포용 서명 APK (처음 한 번 서명 키를 만든다)
#
# 필요: git, Node.js 22+, JDK 21, Android SDK (ANDROID_HOME 또는 ~/Android/Sdk, ~/Library/Android/sdk)
set -euo pipefail

BASE_COMMIT=db7928d9
KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$KIT/entry-offline"
MOBILE="$REPO/mobile"
ANDROID="$MOBILE/android"
RELEASE=0
[ "${1:-}" = "--release" ] && RELEASE=1

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 이(가) 없습니다. $2" >&2; exit 1; }; }
need git "git 을 설치하세요."
need node "Node.js 22 이상을 설치하세요."
need java "JDK 21 을 설치하거나 Android Studio 의 jbr 을 JAVA_HOME 으로 지정하세요."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22 이상이 필요합니다." >&2; exit 1; }
command -v yarn >/dev/null 2>&1 || npm install --global yarn

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
for c in "$SDK" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
  if [ -n "$c" ] && [ -d "$c/platforms" ]; then SDK="$c"; break; fi
done
[ -d "$SDK/platforms" ] || { echo "Android SDK 를 찾지 못했습니다. ANDROID_HOME 을 지정하세요." >&2; exit 1; }
echo "Android SDK: $SDK"

# 1. 원본 + 패치
[ -d "$REPO" ] || git clone https://github.com/entrylabs/entry-offline.git "$REPO"
cd "$REPO"
git fetch --all --quiet
git checkout -f "$BASE_COMMIT"
git clean -fdq -e node_modules -e mobile/node_modules -e mobile/android/keystore.properties -e 'mobile/android/*.jks'
git apply --whitespace=nowarn "$KIT/entry-local.patch"
echo "패치 적용 완료"

# 2. 웹 화면 빌드 (Electron 네이티브 모듈 불필요 → 스크립트 없이 설치)
#    안드로이드 전용 라이브러리(Capacitor 등)는 mobile/node_modules 에서 가져온다
(cd "$MOBILE" && npm ci --no-audit --no-fund)
yarn install --ignore-scripts --network-timeout 300000
# (선택) 구글 드라이브 연동: 키트 폴더의 google-client.json (환경변수가 우선)
if [ -f "$KIT/google-client.json" ] && [ -z "${GOOGLE_WEB_CLIENT_ID:-}" ]; then
  export GOOGLE_WEB_CLIENT_ID="$(node -e 'try{process.stdout.write(require(process.argv[1]).webClientId||"")}catch(e){}' "$KIT/google-client.json")"
fi
yarn build:web

# 3. 앱 자산 조립 + 동기화
cd "$MOBILE"
node scripts/apply-branding.js "$KIT/branding"   # 앱 이름·아이콘 (branding 폴더가 있으면)
node scripts/assemble-www.js
npx cap sync android
echo "sdk.dir=$SDK" > "$ANDROID/local.properties"

# 4. 서명 키
# GitHub Actions 등: 환경변수로 받은 고정 키로 서명 (같은 키여야 기존 앱 위에 업데이트 설치됨)
if [ -n "${ENTRY_KEYSTORE_BASE64:-}" ] && [ -n "${ENTRY_KEYSTORE_PASSWORD:-}" ]; then
  echo "$ENTRY_KEYSTORE_BASE64" | base64 -d > "$ANDROID/entrylocal.jks"
  printf 'storeFile=entrylocal.jks\nstorePassword=%s\nkeyAlias=entrylocal\nkeyPassword=%s\n' \
    "$ENTRY_KEYSTORE_PASSWORD" "$ENTRY_KEYSTORE_PASSWORD" > "$ANDROID/keystore.properties"
  RELEASE=1
  echo "고정 서명 키 사용 (release)"
fi
if [ "$RELEASE" = 1 ] && [ ! -f "$ANDROID/keystore.properties" ]; then
  echo "배포용 서명 키를 만듭니다. 키와 비밀번호는 앱 업데이트에 계속 필요하니 안전하게 보관하세요."
  read -r -s -p "서명 키 비밀번호 (6자 이상): " PW; echo
  [ "${#PW}" -ge 6 ] || { echo "6자 이상이어야 합니다." >&2; exit 1; }
  keytool -genkeypair -v -keystore "$ANDROID/entrylocal.jks" -alias entrylocal -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=EntryLocal, O=Softline, C=KR"
  printf 'storeFile=entrylocal.jks\nstorePassword=%s\nkeyAlias=entrylocal\nkeyPassword=%s\n' "$PW" "$PW" > "$ANDROID/keystore.properties"
fi

# 5. APK
cd "$ANDROID"
chmod +x gradlew
if [ "$RELEASE" = 1 ]; then TASK=assembleRelease; TYPE=release; else TASK=assembleDebug; TYPE=debug; fi
./gradlew "$TASK" --no-daemon

VERSION="$(node -p "require('$MOBILE/package.json').version")"
mkdir -p "$KIT/out"
APK="$(ls "$ANDROID/app/build/outputs/apk/$TYPE/"*.apk | head -1)"
cp "$APK" "$KIT/out/EntryLocal-$VERSION-$TYPE.apk"
echo "완료: $KIT/out/EntryLocal-$VERSION-$TYPE.apk ($(du -m "$APK" | cut -f1) MB)"
