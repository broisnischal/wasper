# wasper Windows installer
# Usage (run in PowerShell):
#   irm https://studio.stroke.click/install.ps1 | iex
#
# Installs a standalone wasper.exe — no Node, Bun, or curl required.

$ErrorActionPreference = 'Stop'

$Repo      = "broisnischal/wasper"
$InstallDir = "$env:USERPROFILE\.wasper\bin"

function Write-Info  { param($msg) Write-Host "  $msg" -ForegroundColor DarkGray }
function Write-Ok    { param($msg) Write-Host "  $([char]0x2713)  $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "  $([char]0x2717)  $msg" -ForegroundColor Red }
function Write-Step  { param($msg) Write-Host "  $([char]0x2192)  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  wasper installer" -ForegroundColor White
Write-Host ""

# ── Detect architecture ───────────────────────────────────────────────────────
# Prefer x64; if running on ARM64 Windows the x64 binary runs via emulation.
$Arch = 'x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    # No arm64 asset yet — x64 runs fine under emulation on ARM64 Windows
    $Arch = 'x64'
}

$AssetName = "wasper-windows-$Arch.exe"

# ── Resolve latest release ────────────────────────────────────────────────────
Write-Step "Resolving latest release..."

try {
    $release = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$Repo/releases/latest" `
        -Headers @{ 'User-Agent' = 'wasper-installer/1.0' } `
        -UseBasicParsing
} catch {
    Write-Fail "Could not reach GitHub API: $_"
    Write-Info "Download manually: https://github.com/$Repo/releases"
    exit 1
}

$Version     = $release.tag_name
$DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$AssetName"
$ChecksumUrl = "https://github.com/$Repo/releases/download/$Version/checksums.txt"

Write-Step "Downloading wasper $Version (windows/$Arch)..."

# ── Download binary ───────────────────────────────────────────────────────────
$TmpExe = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "wasper-$Version.exe")

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpExe -UseBasicParsing
} catch {
    Write-Fail "Download failed: $_"
    Write-Info "URL: $DownloadUrl"
    exit 1
}

# Unblock the file so Windows doesn't flag it as unsafe
try { Unblock-File -Path $TmpExe } catch { <# Non-fatal #> }

# ── Verify checksum ───────────────────────────────────────────────────────────
try {
    $checksums = Invoke-RestMethod -Uri $ChecksumUrl -UseBasicParsing
    $line      = $checksums.Split("`n") | Where-Object { $_ -match [regex]::Escape($AssetName) } | Select-Object -First 1
    if ($line) {
        $Expected = $line.Trim().Split()[0].ToLower()
        $Actual   = (Get-FileHash -Path $TmpExe -Algorithm SHA256).Hash.ToLower()
        if ($Expected -and $Expected -ne $Actual) {
            Write-Fail "Checksum mismatch — aborting."
            Write-Info "  expected: $Expected"
            Write-Info "  got:      $Actual"
            Remove-Item $TmpExe -Force
            exit 1
        }
        Write-Info "Checksum verified"
    }
} catch { <# Checksum check is best-effort #> }

# ── Install ───────────────────────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$Dest = Join-Path $InstallDir "wasper.exe"
Copy-Item -Path $TmpExe -Destination $Dest -Force
Remove-Item $TmpExe -Force

# ── Add to PATH (user scope, persists across sessions) ───────────────────────
$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
if ($UserPath -notlike "*$InstallDir*") {
    [System.Environment]::SetEnvironmentVariable(
        'PATH',
        "$InstallDir;$UserPath",
        'User'
    )
    # Also update the current session so wasper is usable immediately
    $env:PATH = "$InstallDir;$env:PATH"
    Write-Info "Added $InstallDir to PATH"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Ok "wasper $Version installed"
Write-Info "Binary:  $Dest"
Write-Host ""
Write-Host "  Get started:" -ForegroundColor DarkGray
Write-Host "  wasper --url https://petstore.swagger.io/v2/swagger.json" -ForegroundColor Cyan
Write-Host ""
Write-Host "  wasper up       start the daemon" -ForegroundColor DarkGray
Write-Host "  wasper status   check status" -ForegroundColor DarkGray
Write-Host "  wasper down     stop the daemon" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Docs: https://studio.stroke.click/docs" -ForegroundColor DarkGray
Write-Host ""

if (-not (Get-Command wasper -ErrorAction SilentlyContinue)) {
    Write-Host "  Note: restart your terminal (or open a new PowerShell window) to use wasper." -ForegroundColor Yellow
    Write-Host ""
}
