# Habblaud launcher for Windows (what the desktop shortcut from `npm run desktop:install` runs).
# - Starts the Habblaud server in the background if it is not answering yet (building it first when dist/ is missing),
#   with this folder's .env, and logs to ~/.habblaud/logs/server.log.
# - Then opens the app in its own window: Chrome or Edge with --app, otherwise the default browser.
# - `-NoOpen` only starts the server; `-Stop` stops the server this folder started.
param(
  [switch]$NoOpen,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $root '.env'
$server = Join-Path $root 'dist\server\index.js'

$port = 4747
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*HABBLAUD_PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $port = [int]$Matches[1] }
  }
}
if ($env:HABBLAUD_PORT -match '^\d+$') { $port = [int]$env:HABBLAUD_PORT }
$appUrl = "http://localhost:$port/?app=1"

function Show-Error([string]$text) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show($text, 'Habblaud', 'OK', 'Error')
}

function Test-Habblaud {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$port/api/health"
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ServerProcesses {
  Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($server) }
}

if ($Stop) {
  $procs = @(Get-ServerProcesses)
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Output ("Stopped {0} Habblaud server process(es)." -f $procs.Count)
  exit 0
}

if (-not (Test-Habblaud)) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $node) {
    Show-Error "Node.js was not found. Install Node.js 22.12 or newer (https://nodejs.org) and try again."
    exit 1
  }
  if (-not (Test-Path -LiteralPath $server) -or -not (Test-Path -LiteralPath (Join-Path $root 'dist\client\index.html'))) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $npm) {
      Show-Error "npm was not found, and Habblaud has not been built yet (npm run build)."
      exit 1
    }
    $build = Start-Process -FilePath $npm -ArgumentList 'run', 'build' -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    if ($build.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $server)) {
      Show-Error "Building Habblaud failed. Run 'npm run build' in $root to see why."
      exit 1
    }
  }
  $logDir = Join-Path $env:USERPROFILE '.habblaud\logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $log = Join-Path $logDir 'server.log'
  # cmd /c with the redirection: node inherits cmd's hidden console and keeps running after this script ends.
  $cmdLine = "/d /s /c `"`"$node`" --env-file-if-exists=`"$envFile`" `"$server`" > `"$log`" 2>&1`""
  Start-Process -FilePath $env:ComSpec -ArgumentList $cmdLine -WorkingDirectory $root -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Habblaud)) {
    if ((Get-Date) -gt $deadline) {
      Show-Error "Habblaud did not start within 30 seconds. See the log: $log"
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
}

if ($NoOpen) { exit 0 }

$candidates = @()
foreach ($exe in 'chrome.exe', 'msedge.exe') {
  foreach ($hive in 'HKCU:', 'HKLM:') {
    $value = (Get-ItemProperty -LiteralPath "$hive\Software\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction SilentlyContinue).'(default)'
    if ($value) { $candidates += $value.Trim('"') }
  }
}
$candidates += @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$browser = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$appUrl"
} else {
  Start-Process $appUrl
}
