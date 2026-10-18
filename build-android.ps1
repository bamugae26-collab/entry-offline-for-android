# 엔트리 로컬 안드로이드(APK) 빌드 스크립트 (Windows PowerShell)
#
# 사용법:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\build-android.ps1            # 디버그 서명 APK (바로 설치해서 쓰기)
#   .\build-android.ps1 -Release   # 배포용 서명 APK (처음 한 번 서명 키를 만든다)
#
# 결과물: .\out\EntryLocal-<버전>-debug.apk  또는  -release.apk
#
# 필요: Git, Node.js 22 이상, Android Studio (Android SDK + 내장 JDK 21)

param([switch]$Release)

$ErrorActionPreference = 'Stop'
$BaseCommit = 'db7928d9'   # 패치를 만든 entry-offline 기준 커밋 (offline v2.1.36)
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Join-Path $Kit 'entry-offline'
$Mobile = Join-Path $Repo 'mobile'
$Android = Join-Path $Mobile 'android'
$Out = Join-Path $Kit 'out'

function Need($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd 이(가) 없습니다. $hint" }
}
function Run($what) {
    & $what[0] $what[1..($what.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "실패: $($what -join ' ')" }
}

# ---------- 0. 도구 확인 ----------
Need git  'https://git-scm.com 에서 설치하세요.'
Need node 'Node.js 22 LTS 이상을 설치하세요 (https://nodejs.org).'
$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node $nodeMajor 버전입니다. Capacitor 8 은 Node 22 이상이 필요합니다." }
if (-not (Get-Command yarn -ErrorAction SilentlyContinue)) { npm install --global yarn }

# JDK: JAVA_HOME 이 없으면 Android Studio 내장 JDK 사용
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    $candidates = @(
        "$env:ProgramFiles\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr",
        "$env:ProgramFiles\Android\Android Studio\jre"
    )
    $jbr = $candidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
    if (-not $jbr) { throw 'JDK 를 찾지 못했습니다. Android Studio 를 설치하거나 JAVA_HOME 을 JDK 21 로 지정하세요.' }
    $env:JAVA_HOME = $jbr
}
Write-Host "JDK: $env:JAVA_HOME"

# Android SDK
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = "$env:LOCALAPPDATA\Android\Sdk" }
if (-not (Test-Path (Join-Path $sdk 'platforms'))) {
    throw "Android SDK 를 찾지 못했습니다 ($sdk). Android Studio 를 한 번 실행해 SDK 를 설치하세요 (SDK Platform 36 포함)."
}
Write-Host "Android SDK: $sdk"

# ---------- 1. 원본 받기 + 패치 ----------
if (-not (Test-Path $Repo)) { Run @('git', 'clone', 'https://github.com/entrylabs/entry-offline.git', $Repo) }
# (선택) 구글 드라이브 연동: 키트 폴더의 google-client.json 을 환경변수로
$GoogleFile = Join-Path $Kit 'google-client.json'
if (Test-Path $GoogleFile) {
    $g = Get-Content $GoogleFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($g.desktopClientId)     { $env:GOOGLE_DESKTOP_CLIENT_ID = $g.desktopClientId }
    if ($g.desktopClientSecret) { $env:GOOGLE_DESKTOP_CLIENT_SECRET = $g.desktopClientSecret }
    if ($g.webClientId)         { $env:GOOGLE_WEB_CLIENT_ID = $g.webClientId }
    Write-Host 'google-client.json 읽음 (구글 드라이브 연동 켜짐)'
}

Push-Location $Repo
try {
    git fetch --all --quiet
    Run @('git', 'checkout', '-f', $BaseCommit)
    # node_modules 와 서명 키는 남긴다
    Run @('git', 'clean', '-fdq', '-e', 'node_modules', '-e', 'mobile/node_modules', '-e', 'mobile/android/keystore.properties', '-e', 'mobile/android/*.jks')
    Run @('git', 'apply', '--whitespace=nowarn', (Join-Path $Kit 'entry-local.patch'))
    Write-Host '패치 적용 완료'

    # ---------- 2. 웹 화면 빌드 ----------
    # 안드로이드 전용 라이브러리(Capacitor 등)는 mobile/node_modules 에서 가져온다
    Push-Location $Mobile
    try { Run @('npm', 'ci', '--no-audit', '--no-fund') } finally { Pop-Location }
    # 안드로이드판은 Electron 네이티브 모듈이 필요 없으므로 스크립트 없이 설치
    Run @('yarn', 'install', '--ignore-scripts', '--network-timeout', '300000')
    Run @('yarn', 'build:web')
}
finally { Pop-Location }

# ---------- 3. 앱 자산 조립 + 안드로이드 프로젝트 동기화 ----------
Push-Location $Mobile
try {
    Run @('node', 'scripts/apply-branding.js', (Join-Path $Kit 'branding'))   # 앱 이름·아이콘
    Run @('node', 'scripts/assemble-www.js')
    Run @('npx', 'cap', 'sync', 'android')
}
finally { Pop-Location }

Set-Content -Path (Join-Path $Android 'local.properties') -Value ("sdk.dir=" + ($sdk -replace '\\', '\\')) -Encoding ASCII

# ---------- 4. 서명 키 (릴리스) ----------
if ($Release -and -not (Test-Path (Join-Path $Android 'keystore.properties'))) {
    Write-Host ''
    Write-Host '배포용 서명 키를 만듭니다. 이 키와 비밀번호는 앱 업데이트에 계속 필요하니 안전하게 보관하세요.'
    $pw = Read-Host '서명 키 비밀번호 (6자 이상)' -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
    if ($plain.Length -lt 6) { throw '비밀번호는 6자 이상이어야 합니다.' }
    $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    & $keytool -genkeypair -v -keystore (Join-Path $Android 'entrylocal.jks') -alias entrylocal `
        -keyalg RSA -keysize 2048 -validity 10000 -storepass $plain -keypass $plain `
        -dname 'CN=EntryLocal, O=Softline, C=KR'
    if ($LASTEXITCODE -ne 0) { throw 'keytool 실패' }
    @"
storeFile=entrylocal.jks
storePassword=$plain
keyAlias=entrylocal
keyPassword=$plain
"@ | Set-Content -Path (Join-Path $Android 'keystore.properties') -Encoding ASCII
}

# ---------- 5. APK 빌드 ----------
Push-Location $Android
try {
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    Run @('.\gradlew.bat', $task, '--no-daemon')
}
finally { Pop-Location }

$type = if ($Release) { 'release' } else { 'debug' }
$apk = Get-ChildItem (Join-Path $Android "app\build\outputs\apk\$type") -Filter *.apk | Select-Object -First 1
if (-not $apk) { throw 'APK 를 찾지 못했습니다.' }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$version = (Get-Content (Join-Path $Mobile 'package.json') -Raw | ConvertFrom-Json).version
$dest = Join-Path $Out "EntryLocal-$version-$type.apk"
Copy-Item $apk.FullName $dest -Force
Write-Host ''
Write-Host "완료: $dest  ($([math]::Round($apk.Length / 1MB)) MB)"
