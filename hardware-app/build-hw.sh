#!/usr/bin/env bash
# Entry Android Hardware (하드웨어 연결 프로그램 앱) 빌드 — Linux / macOS / GitHub Actions
#
#   bash hardware-app/build-hw.sh
#
# 필요: git, Node.js 22+, JDK 21, Gradle 8.14+, Android SDK (platform 36, NDK 27, CMake 3.22.1)
# 결과: out/EntryAndroidHardware.apk
# 서명: 환경변수 ENTRY_KEYSTORE_BASE64 / ENTRY_KEYSTORE_PASSWORD (Entry for Android 와 같은 키) — 없으면 디버그 서명
set -euo pipefail

ENTRY_HW_REPO=https://github.com/entrylabs/entry-hw.git
ENTRY_HW_COMMIT=fefdc290ed550733c99b0627dcbf42f160a55df0   # entry-hw 1.9.78 (2026-09-16)
NODEJS_MOBILE_URL=https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip

HW_APP="$(cd "$(dirname "$0")" && pwd)"
KIT="$(cd "$HW_APP/.." && pwd)"
WORK="$KIT/.hw-build"
ANDROID="$HW_APP/android"
ASSETS="$ANDROID/app/src/main/assets/nodejs-project"
mkdir -p "$WORK" "$KIT/out"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
for c in "$SDK" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
  if [ -n "$c" ] && [ -d "$c/platforms" ]; then SDK="$c"; break; fi
done
[ -d "$SDK/platforms" ] || { echo "Android SDK 를 찾지 못했습니다. ANDROID_HOME 을 지정하세요." >&2; exit 1; }
echo "Android SDK: $SDK"
# 설치된 NDK 27 중 하나를 쓴다
if [ -z "${ENTRY_HW_NDK_VERSION:-}" ] && [ -d "$SDK/ndk" ]; then
  ENTRY_HW_NDK_VERSION="$(ls "$SDK/ndk" | grep '^27\.' | sort -V | tail -1 || true)"
  [ -n "$ENTRY_HW_NDK_VERSION" ] && export ENTRY_HW_NDK_VERSION && echo "NDK: $ENTRY_HW_NDK_VERSION"
fi

# 1. 엔트리 하드웨어 연결 프로그램 원본 (MIT)
if [ ! -d "$WORK/entry-hw/.git" ]; then
  git clone --filter=blob:none https://github.com/entrylabs/entry-hw.git "$WORK/entry-hw"
fi
git -C "$WORK/entry-hw" fetch --quiet origin "$ENTRY_HW_COMMIT" || true
git -C "$WORK/entry-hw" checkout -f --quiet "$ENTRY_HW_COMMIT"
echo "entry-hw: $ENTRY_HW_COMMIT"

# 2. 연결 프로그램 본체(Node)와 화면 묶기 + 하드웨어 모듈 복사
rm -rf "$ASSETS"
(cd "$HW_APP/node-src" && npm install --no-audit --no-fund)
(cd "$HW_APP/node-src" && ENTRY_HW_DIR="$WORK/entry-hw" OUT_DIR="$ASSETS" node build.js)
(cd "$HW_APP/node-src" && ENTRY_HW_DIR="$WORK/entry-hw" OUT_DIR="$ASSETS" node copy-modules.js)

# 3. nodejs-mobile (안드로이드용 Node.js 라이브러리)
LIBNODE="$ANDROID/app/libnode"
if [ ! -f "$LIBNODE/bin/arm64-v8a/libnode.so" ]; then
  curl -fL --retry 3 -o "$WORK/nodejs-mobile.zip" "$NODEJS_MOBILE_URL"
  rm -rf "$LIBNODE" && mkdir -p "$LIBNODE"
  unzip -q "$WORK/nodejs-mobile.zip" -d "$LIBNODE"
  rm -rf "$LIBNODE/bin/x86_64"   # ARM 기기만 (용량)
fi

# 4. 서명 키 (Entry for Android 와 같은 키)
echo "sdk.dir=$SDK" > "$ANDROID/local.properties"
TASK=assembleDebug; TYPE=debug
if [ -n "${ENTRY_KEYSTORE_BASE64:-}" ] && [ -n "${ENTRY_KEYSTORE_PASSWORD:-}" ]; then
  echo "$ENTRY_KEYSTORE_BASE64" | base64 -d > "$ANDROID/entrylocal.jks"
  printf 'storeFile=entrylocal.jks\nstorePassword=%s\nkeyAlias=entrylocal\nkeyPassword=%s\n' \
    "$ENTRY_KEYSTORE_PASSWORD" "$ENTRY_KEYSTORE_PASSWORD" > "$ANDROID/keystore.properties"
  TASK=assembleRelease; TYPE=release
  echo "고정 서명 키 사용 (release)"
elif [ -f "$ANDROID/keystore.properties" ]; then
  TASK=assembleRelease; TYPE=release
fi

# 5. APK
cd "$ANDROID"
# Gradle 8.14.3 (GitHub Actions 는 setup-gradle 로 설치, 직접 빌드는 설치된 gradle 사용)
GRADLE="${GRADLE_BIN:-gradle}"
command -v "$GRADLE" >/dev/null 2>&1 || { echo "gradle 이 없습니다 (8.14 이상 설치)." >&2; exit 1; }
"$GRADLE" "$TASK" --no-daemon
APK="$(ls app/build/outputs/apk/$TYPE/*.apk | head -1)"
cp "$APK" "$KIT/out/EntryAndroidHardware.apk"
echo "완료: out/EntryAndroidHardware.apk"
