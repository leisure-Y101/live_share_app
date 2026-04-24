param(
  [Parameter(Mandatory = $true)]
  [string]$EnvId,

  [string]$ServiceName = "live-location-backend"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $repoRoot "miniprogram\utils\config.js"
$cloudbasePath = Join-Path $repoRoot "cloudbaserc.json"

if (-not (Test-Path $configPath)) {
  throw "找不到小程序配置文件：$configPath"
}

if (-not (Test-Path $cloudbasePath)) {
  throw "找不到云托管配置文件：$cloudbasePath"
}

function Set-JsConstValue {
  param(
    [string]$Content,
    [string]$Name,
    [string]$Value
  )

  $escapedValue = $Value.Replace("\", "\\").Replace("'", "\'")
  $pattern = "const\s+$Name\s*=\s*'[^']*';"
  $replacement = "const $Name = '$escapedValue';"
  return [regex]::Replace($Content, $pattern, $replacement)
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

$configContent = Get-Content -Encoding UTF8 -Raw $configPath
$configEnvId = if ($EnvId -eq "__CLOUDBASE_ENV_ID__") { "" } else { $EnvId }
$configContent = Set-JsConstValue $configContent "CLOUDBASE_ENV_ID" $configEnvId
$configContent = Set-JsConstValue $configContent "CLOUDBASE_SERVICE_NAME" $ServiceName
$configContent = Set-JsConstValue $configContent "PRODUCTION_HTTP_BASE_URL" ""
$configContent = Set-JsConstValue $configContent "PRODUCTION_WS_BASE_URL" ""
Write-Utf8NoBom $configPath $configContent

$cloudbaseConfig = Get-Content -Encoding UTF8 -Raw $cloudbasePath | ConvertFrom-Json
$cloudbaseConfig.envId = $EnvId
$cloudbaseConfig.framework.plugins.client.inputs.serviceName = $ServiceName
$cloudbaseContent = $cloudbaseConfig | ConvertTo-Json -Depth 20
Write-Utf8NoBom $cloudbasePath $cloudbaseContent

Write-Host "已完成微信云开发配置：" -ForegroundColor Green
Write-Host ("- Env ID: " + $EnvId)
Write-Host ("- Service Name: " + $ServiceName)
Write-Host "- 小程序正式/体验版会优先使用 wx.cloud.callContainer/connectContainer"
Write-Host ""
Write-Host "下一步部署后端：" -ForegroundColor Cyan
Write-Host "npm.cmd exec --package=@cloudbase/cli -- tcb login"
Write-Host "npm.cmd exec --package=@cloudbase/cli -- tcb framework:deploy"
