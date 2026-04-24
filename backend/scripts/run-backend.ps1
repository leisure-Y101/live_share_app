$ErrorActionPreference = 'Stop'

$backendDir = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $backendDir 'logs'
$stdoutLog = Join-Path $logsDir 'service.out.log'
$stderrLog = Join-Path $logsDir 'service.err.log'
$envFile = Join-Path $backendDir '.env'
$port = 8787

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$nodePath = (Get-Command node -ErrorAction Stop).Source

if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') {
      $port = [int]$Matches[1]
      break
    }
  }
}

$existingListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($existingListener) {
  $message = "[{0}] Port {1} is already in use by PID {2}. Skip starting a duplicate backend." -f (Get-Date -Format s), $port, $existingListener.OwningProcess
  Add-Content -Path $stdoutLog -Value $message
  exit 0
}

Set-Location $backendDir
& $nodePath server.js 1>> $stdoutLog 2>> $stderrLog
exit $LASTEXITCODE
