$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
foreach ($required in @('bin\cli.js', 'dist\node.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $required) -PathType Leaf)) {
        throw "Missing $required in $repoRoot. Install dependencies and run pnpm run build first."
    }
}

$binDirectory = Join-Path $repoRoot 'node_modules\.bin'
$shimPath = Join-Path $binDirectory 'pxpipe.cmd'
$shim = "@echo off`r`nrem PXPipe repository-local shim (setup-local-bin.ps1)`r`nnode `"%~dp0..\..\bin\cli.js`" %*`r`nexit /b %errorlevel%`r`n"
if (Test-Path -LiteralPath $shimPath) {
    $existing = [System.IO.File]::ReadAllText($shimPath)
    if ($existing -ne $shim) {
        throw "Refusing to overwrite a different shim at $shimPath. Inspect and remove it explicitly if replacement is intended."
    }
} else {
    New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
    [System.IO.File]::WriteAllText($shimPath, $shim, [System.Text.Encoding]::ASCII)
}
Write-Output "Local PXPipe shim ready: $shimPath"
