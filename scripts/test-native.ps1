param([Parameter(Mandatory=$true)][string]$OutputRoot)
$ErrorActionPreference = 'Stop'
$nativeProject = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeOutput = [System.IO.Path]::GetFullPath($OutputRoot)
if (-not $nativeOutput.StartsWith('E:\Codex工作盘\artifacts\test-builds\video-skill-workbench\', [StringComparison]::OrdinalIgnoreCase)) { throw '请指定本项目 E 盘测试产物子目录' }
Push-Location -LiteralPath $nativeProject
try {
    & 'E:\Codex工作盘\runtimes\video-skill-workbench\node-v24.21.0\node.exe' --import tsx scripts/build-native.ts --output-root $nativeOutput --test
    if ($LASTEXITCODE -ne 0) { throw '原生窗口编译或测试未通过' }
} finally { Pop-Location }
