$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot 'backend'
$HealthUrl = 'http://127.0.0.1:8787/health'

Write-Host '== Live Location Backend Diagnostic ==' -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ''

Write-Host '[1] Node.js' -ForegroundColor Yellow
try {
  $node = Get-Command node -ErrorAction Stop
  Write-Host "OK node: $($node.Source)"
  & node -v
} catch {
  Write-Host 'FAIL: node is not installed or not in PATH.' -ForegroundColor Red
}
Write-Host ''

Write-Host '[2] Backend files' -ForegroundColor Yellow
if (Test-Path (Join-Path $BackendDir 'server.js')) {
  Write-Host 'OK backend/server.js exists'
} else {
  Write-Host 'FAIL: backend/server.js not found.' -ForegroundColor Red
}
if (Test-Path (Join-Path $BackendDir 'node_modules')) {
  Write-Host 'OK backend/node_modules exists'
} else {
  Write-Host 'WARN: backend/node_modules not found. Run npm install inside backend.' -ForegroundColor Yellow
}
Write-Host ''

Write-Host '[3] Port 8787 listener' -ForegroundColor Yellow
$listeners = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "OK listening: $($listener.LocalAddress):8787 PID=$($listener.OwningProcess) $($process.ProcessName)"
  }
} else {
  Write-Host 'FAIL: Nothing is listening on port 8787.' -ForegroundColor Red
  Write-Host 'Start it with: .\start-backend.cmd'
}
Write-Host ''

Write-Host '[4] Health check 127.0.0.1' -ForegroundColor Yellow
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5
  Write-Host "OK HTTP $($response.StatusCode): $($response.Content)"
} catch {
  Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''

Write-Host '[5] LAN IP candidates' -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress
if ($ips) {
  foreach ($ip in $ips) {
    $url = "http://${ip}:8787/health"
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
      Write-Host "OK $url => HTTP $($response.StatusCode)"
    } catch {
      Write-Host "WARN $url => $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
} else {
  Write-Host 'WARN: No LAN IPv4 found.' -ForegroundColor Yellow
}
Write-Host ''

Write-Host '[6] Mini program dev config' -ForegroundColor Yellow
$configPath = Join-Path $ProjectRoot 'miniprogram\utils\config.js'
if (Test-Path $configPath) {
  Get-Content $configPath | Select-String -Pattern 'DEVELOPMENT_.*BASE_URL'
} else {
  Write-Host 'FAIL: miniprogram/utils/config.js not found.' -ForegroundColor Red
}
Write-Host ''

Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '1. In WeChat DevTools: Details -> Local Settings -> enable domain/TLS validation bypass.'
Write-Host '2. Clear all cache and compile.'
Write-Host '3. On the home page, expand backend config, tap Restore Default, then Detect Connection.'
Write-Host '4. If using phone preview, enter the LAN URL shown above, not 127.0.0.1.'
