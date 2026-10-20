$ErrorActionPreference = "Stop"

# A fresh development build owns its own process lifecycle. Never terminate
# other desktop/server instances: they may be recording an active meeting.
Push-Location $PSScriptRoot
try {
  pnpm tauri:dev
  if ($LASTEXITCODE -ne 0) {
    throw "Noter.ai development launch failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
