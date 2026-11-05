$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $projectRoot 'server.js'
$runtimeDir = Join-Path $projectRoot 'runtime'
$portableNode = Join-Path $runtimeDir 'node.exe'
if (!(Test-Path -LiteralPath $serverPath)) { throw 'server.js was not found beside this launcher.' }

$nodePath = $null
if (Test-Path -LiteralPath $portableNode) {
  $nodePath = $portableNode
} else {
  $installedNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($installedNode) {
    $versionText = (& $installedNode.Source --version 2>$null).Trim()
    if ($versionText -match '^v(\d+)\.(\d+)\.(\d+)$') {
      $version = [version]::Parse("$($Matches[1]).$($Matches[2]).$($Matches[3])")
      if ($version -ge [version]'22.5.0') { $nodePath = $installedNode.Source }
    }
  }
}

if (!$nodePath) {
  if (![Environment]::Is64BitOperatingSystem) {
    throw 'The portable launcher currently supports 64-bit Windows. Ask the project owner for the 32-bit runtime.'
  }
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $nodeUrl = 'https://nodejs.org/dist/v22.23.4/win-x64/node.exe'
  $expectedSha256 = 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host 'Downloading the portable Node.js runtime (one-time, about 87 MB)...'
  try {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $portableNode -UseBasicParsing
  } catch {
    Remove-Item -LiteralPath $portableNode -Force -ErrorAction SilentlyContinue
    throw 'Could not download Node.js from nodejs.org. Check the school internet connection or ask IT whether portable apps are allowed.'
  }
  $actualSha256 = (Get-FileHash -LiteralPath $portableNode -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    Remove-Item -LiteralPath $portableNode -Force -ErrorAction SilentlyContinue
    throw 'The downloaded Node.js file failed its SHA-256 check and was deleted.'
  }
  $nodePath = $portableNode
}

Write-Host 'Starting Fitpath W2. Keep this PowerShell window open.'
Write-Host 'When the server starts, open http://localhost:4173 in your browser.'
Write-Host 'Press Ctrl+C here to stop the server.'
& $nodePath $serverPath