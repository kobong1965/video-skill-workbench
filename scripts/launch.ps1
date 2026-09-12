param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$releaseRoot = Join-Path $workRoot 'artifacts\latest\video-skill-workbench'
if (-not $NoBrowser) {
    $nativeRoot = Join-Path $releaseRoot 'windows'
    if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
        $nativeApps = @(Get-ChildItem -LiteralPath $nativeRoot -Filter '*.exe' -File)
        if ($nativeApps.Count -eq 1) {
            Start-Process -FilePath $nativeApps[0].FullName -WindowStyle Normal
            return
        }
    }
}
$appRoot = Join-Path $releaseRoot 'app'
$dataRoot = Join-Path (Split-Path $projectRoot -Parent) 'video-skill-workbench-data'
$logsRoot = Join-Path $dataRoot 'logs'
$pageUrl = 'http://127.0.0.1:4178'
function Test-Workbench {
    try { $health = Invoke-RestMethod -Uri ($pageUrl + '/api/health') -TimeoutSec 2; return ($health.application -eq 'video-skill-workbench' -and $health.ok) } catch { return $false }
}
if (-not (Test-Workbench)) {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'index.html'))) { throw 'The local app build is missing. Please rebuild the project first.' }
    New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
    $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $taskArgs = @('scripts/run.mjs', 'start', '--output-root', ('"{0}"' -f $appRoot), '--data-root', ('"{0}"' -f $dataRoot))
    $process = Start-Process -FilePath $nodePath -ArgumentList $taskArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsRoot ($taskStamp + '-stdout.log')) -RedirectStandardError (Join-Path $logsRoot ($taskStamp + '-stderr.log'))
    [System.IO.File]::WriteAllText((Join-Path $dataRoot 'launcher.pid'), [string]$process.Id)
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-Workbench) { break }
        if ($process.HasExited) { throw ('The app could not start. Logs: ' + $logsRoot) }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Workbench)) { throw ('Startup timed out. Your data has not been reset. Logs: ' + $logsRoot) }
}
if (-not $NoBrowser) { Start-Process $pageUrl }
Write-Output ('Workbench is ready: ' + $pageUrl)
