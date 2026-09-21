$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$pxpipe = Join-Path $repoRoot 'node_modules\.bin\pxpipe.cmd'
if (-not (Test-Path -LiteralPath $pxpipe -PathType Leaf)) {
    Write-Error "Missing local PXPipe shim: $pxpipe. Run scripts\windows\setup-local-bin.ps1 after installing dependencies and building."
    exit 1
}

& $pxpipe warp -- claude @args
exit $LASTEXITCODE
