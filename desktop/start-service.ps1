param([string]$DataRoot, [int]$Port = 4178)
$ErrorActionPreference = 'Stop'
$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$serverRoot = Join-Path $packageRoot 'server'
$nodePath = Join-Path $packageRoot 'runtime\node.exe'
$logsRoot = Join-Path $DataRoot 'logs'
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
$env:VSW_DATA_ROOT = $DataRoot
$env:VSW_PORT = [string]$Port
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$launchArgs = @('--import', 'tsx', 'scripts/desktop-service.ts')
$process = Start-Process -FilePath $nodePath -ArgumentList $launchArgs -WorkingDirectory $serverRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsRoot ($stamp + '-desktop-out.log')) -RedirectStandardError (Join-Path $logsRoot ($stamp + '-desktop-err.log'))
[System.IO.File]::WriteAllText((Join-Path $DataRoot 'desktop-service.pid'), [string]$process.Id)
