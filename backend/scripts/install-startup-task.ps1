$ErrorActionPreference = 'Stop'

$taskName = 'LiveLocationShareBackend'
$runValueName = 'LiveLocationShareBackend'
$runRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupCmdPath = Join-Path $startupFolder 'LiveLocationShareBackend.cmd'
$scriptPath = Join-Path $PSScriptRoot 'run-backend.ps1'
$launchArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$launchCommand = "powershell.exe $launchArgs"

if (-not (Test-Path $scriptPath)) {
  throw "Startup script not found: $scriptPath"
}

function Install-WithScheduledTask {
  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument $launchArgs

  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Auto-start the live location share backend when this Windows user signs in.' `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $taskName
  Write-Host "Startup configured with Scheduled Task '$taskName'."
}

function Install-WithRunRegistry {
  if (-not (Test-Path $runRegistryPath)) {
    New-Item -Path $runRegistryPath | Out-Null
  }

  New-ItemProperty `
    -Path $runRegistryPath `
    -Name $runValueName `
    -Value $launchCommand `
    -PropertyType String `
    -Force | Out-Null

  $currentValue = (Get-ItemProperty -Path $runRegistryPath -ErrorAction Stop).$runValueName

  if ($currentValue -ne $launchCommand) {
    throw 'Failed to verify HKCU Run startup entry.'
  }

  Ensure-StartupFolderScript
  Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList $launchArgs | Out-Null
  Write-Host "Startup configured with HKCU Run '$runValueName' and Startup folder backup."
}

function Ensure-StartupFolderScript {
  if (-not (Test-Path $startupFolder)) {
    New-Item -ItemType Directory -Path $startupFolder -Force | Out-Null
  }

  $cmdContent = @(
    '@echo off',
    $launchCommand
  )

  Set-Content -Path $startupCmdPath -Value $cmdContent -Encoding Ascii
}

function Install-WithStartupFolder {
  Ensure-StartupFolderScript
  Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList $launchArgs | Out-Null
  Write-Host "Startup configured with Startup folder script '$startupCmdPath'."
}

try {
  Install-WithScheduledTask
  exit 0
} catch {
  Write-Warning ("Scheduled Task setup failed: " + $_.Exception.Message)
}

try {
  Install-WithRunRegistry
  exit 0
} catch {
  Write-Warning ("HKCU Run setup failed: " + $_.Exception.Message)
}

Install-WithStartupFolder
