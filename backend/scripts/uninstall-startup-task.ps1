$ErrorActionPreference = 'Stop'

$taskName = 'LiveLocationShareBackend'
$runValueName = 'LiveLocationShareBackend'
$runRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupCmdPath = Join-Path $startupFolder 'LiveLocationShareBackend.cmd'
$removedAny = $false

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Scheduled Task '$taskName' removed."
  $removedAny = $true
}

if (Test-Path $runRegistryPath) {
  $entry = Get-ItemProperty -Path $runRegistryPath -Name $runValueName -ErrorAction SilentlyContinue

  if ($entry) {
    Remove-ItemProperty -Path $runRegistryPath -Name $runValueName -ErrorAction Stop
    Write-Host "HKCU Run '$runValueName' removed."
    $removedAny = $true
  }
}

if (Test-Path $startupCmdPath) {
  Remove-Item -LiteralPath $startupCmdPath -Force
  Write-Host "Startup folder script removed: $startupCmdPath"
  $removedAny = $true
}

if (-not $removedAny) {
  Write-Host "No startup entry found for '$taskName'."
}
