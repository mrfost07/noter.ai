param()

$ErrorActionPreference = "Stop"
$buildScript = Join-Path $PSScriptRoot "build-desktop.mjs"
& node $buildScript prepare
if ($LASTEXITCODE -ne 0) { throw "Noter.ai sidecar preparation failed (exit $LASTEXITCODE)." }
