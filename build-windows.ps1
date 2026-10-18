# 엔트리 로컬(EntryLocal) Windows 빌드 스크립트
# 사용법 (PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\build-windows.ps1
#
# 결과물: .\entry-offline\dist\EntryLocal-win32-x64\
#   EntryLocal-Setup-<버전>.exe     (설치형)
#   EntryLocal-Portable-<버전>.exe  (설치 없이 실행)

$ErrorActionPreference = 'Stop'
$BaseCommit = 'db7928d9'   # 패치를 만든 entry-offline 기준 커밋 (offline v2.1.36)
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Join-Path $Kit 'entry-offline'

function Need($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "$cmd 이(가) 없습니다. $hint"
    }
}

Need git  'https://git-scm.com 에서 설치하세요.'
Need node 'Node.js 18 또는 20 LTS 를 설치하세요 (https://nodejs.org).'
Need python 'Python 3 을 설치하세요 (시리얼포트 네이티브 모듈 빌드용).'
if (-not (Get-Command yarn -ErrorAction SilentlyContinue)) {
    Write-Host 'yarn 설치 중...'
    npm install --global yarn
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 16 -or $nodeMajor -gt 22) {
    Write-Warning "Node $nodeMajor 버전은 확인되지 않았습니다. 18 또는 20 LTS 를 권장합니다."
}

# 1. 원본 받기
if (-not (Test-Path $Repo)) {
    git clone https://github.com/entrylabs/entry-offline.git $Repo
}
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
    git checkout -f $BaseCommit
    git clean -fdq -e node_modules

    # 2. 로컬화 패치 적용
    git apply --whitespace=nowarn (Join-Path $Kit 'entry-local.patch')
    Write-Host '패치 적용 완료'

    # 3. 의존성 설치 (postinstall 에서 electron-rebuild 가 시리얼포트 모듈을 빌드함)
    $env:NODE_OPTIONS = '--openssl-legacy-provider --max-old-space-size=8192'
    yarn install --network-timeout 300000

    # 4. 빌드 + 패키징 (NSIS 설치본 + 포터블)
    yarn dist:local

    $out = Join-Path $Repo 'dist\EntryLocal-win32-x64'
    Write-Host ''
    Write-Host "완료: $out"
    Get-ChildItem $out -Filter *.exe | ForEach-Object { Write-Host "  $($_.Name)" }
}
finally {
    Pop-Location
}
