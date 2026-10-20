param(
  [switch]$Browser,
  [switch]$ResolveOnly
)

$ErrorActionPreference = "Stop"

# Discover the installed app, independently of the source checkout's location.
$locations = @()
foreach ($key in @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Noter.ai",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Noter.ai"
)) {
  $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if ($entry.InstallLocation) { $locations += $entry.InstallLocation.Trim('"') }
}
$locations += Join-Path $env:LOCALAPPDATA "Noter.ai"
$locations += Join-Path $env:LOCALAPPDATA "Programs\Noter.ai"
$application = $null
foreach ($location in $locations | Select-Object -Unique) {
  # Older installers use a compatibility filename even though the product is Noter.ai.
  foreach ($name in @("Noter.ai.exe", "noter-desktop.exe", "memos-desktop.exe")) {
    $candidate = Join-Path $location $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $application = (Resolve-Path -LiteralPath $candidate).Path
      break
    }
  }
  if ($application) { break }
}
if (!$application) {
  throw "Noter.ai is not installed. Download a Windows installer from https://github.com/mrfost07/noter.ai/releases."
}
if ($ResolveOnly -and !$Browser) { return $application }

function Find-NoterBrowserOrigin {
  $processes = @(Get-CimInstance Win32_Process)
  $desktopIds = @($processes | Where-Object { $_.ExecutablePath -eq $application } | ForEach-Object { $_.ProcessId })
  $directory = Split-Path -Parent $application
  foreach ($process in $processes) {
    if ($desktopIds -notcontains $process.ParentProcessId -or !$process.ExecutablePath) { continue }
    if ((Split-Path -Parent $process.ExecutablePath) -ne $directory) { continue }
    if ($process.CommandLine -notmatch '(?:^|\s)--port(?:\s+|=)"?(\d{1,5})(?:"?\s|"?$)') { continue }
    $port = [int]$Matches[1]
    if ($port -lt 1 -or $port -gt 65535) { continue }
    $origin = "http://127.0.0.1:$port"
    try {
      $page = Invoke-WebRequest -Uri $origin -UseBasicParsing -TimeoutSec 2
      if ($page.StatusCode -eq 200 -and $page.Content -match 'Noter\.ai') { return $origin }
    } catch { }
  }
}

if (!$Browser) {
  Start-Process -FilePath $application -WorkingDirectory (Split-Path -Parent $application)
  return
}

$origin = Find-NoterBrowserOrigin
if ($ResolveOnly) {
  if (!$origin) { throw "Open Noter.ai first so its local browser address can be detected." }
  return $origin
}
if (!$origin) {
  Start-Process -FilePath $application -WorkingDirectory (Split-Path -Parent $application)
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $origin = Find-NoterBrowserOrigin
  } while (!$origin -and (Get-Date) -lt $deadline)
}
if (!$origin) { throw "Noter.ai's local server is not ready. Check the desktop window for a startup error." }
Start-Process $origin
