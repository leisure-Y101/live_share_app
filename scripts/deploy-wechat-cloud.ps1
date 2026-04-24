param(
  [string]$EnvId = "",
  [string]$ServiceName = "live-location-backend"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$cloudbasePath = Join-Path $repoRoot "cloudbaserc.json"

Set-Location $repoRoot


function Read-CurrentEnvId {
  if (-not (Test-Path $cloudbasePath)) {
    return ""
  }

  try {
    $json = Get-Content -Encoding UTF8 -Raw $cloudbasePath | ConvertFrom-Json
    return [string]$json.envId
  } catch {
    return ""
  }
}

if (-not $EnvId) {
  $currentEnvId = Read-CurrentEnvId
  if ($currentEnvId -and $currentEnvId -ne "__CLOUDBASE_ENV_ID__") {
    $EnvId = $currentEnvId
  }
}

if (-not $EnvId) {
  $EnvId = Read-Host "请输入微信云开发环境 ID，例如 cloud1-xxxxxx"
}

if (-not $EnvId) {
  throw "必须提供微信云开发环境 ID。"
}

& powershell.exe -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "configure-wechat-cloud.ps1") -EnvId $EnvId -ServiceName $ServiceName

Write-Host ""
Write-Host "准备登录 CloudBase。浏览器或终端出现二维码时，请用微信扫码确认。" -ForegroundColor Cyan
npm.cmd exec --package=@cloudbase/cli -- tcb login

Write-Host ""
Write-Host "开始部署后端到微信云托管。" -ForegroundColor Cyan
npm.cmd exec --package=@cloudbase/cli -- tcb cloudrun deploy -e $EnvId -s $ServiceName --port 8787 --source ./backend --force

Write-Host ""
Write-Host "部署命令已执行完。请打开微信开发者工具，点击 上传，然后在手机扫码体验。" -ForegroundColor Green
