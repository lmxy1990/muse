$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot "app"
$bundleDir = Join-Path $appDir "src-tauri\target\release\bundle\nsis"
$configPath = Join-Path $appDir "src-tauri\tauri.conf.json"
$artifactsDir = Join-Path $repoRoot "artifacts"

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$version = [string]$config.version

Push-Location $appDir
try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $buildOutput = & npm run tauri -- build --bundles nsis 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
            $_.Exception.Message
        } else {
            [string]$_
        }
    }
    $buildExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    $buildOutput | ForEach-Object { Write-Host $_ }
    if ($buildExitCode -ne 0 -or ($buildOutput -match "Found version mismatched Tauri packages")) {
        throw "Tauri Windows build failed"
    }
}
finally {
    Pop-Location
}

$versionPattern = [regex]::Escape($version)
$installer = Get-ChildItem -LiteralPath $bundleDir -Filter "*-setup.exe" -File |
    Where-Object { $_.Name -match "^Muse_${versionPattern}_(?<arch>[^-]+)-setup\.exe$" } |
    Select-Object -First 1

if ($null -eq $installer) {
    throw "Unable to find the Windows installer for Muse $version in $bundleDir"
}

$installerStem = [System.IO.Path]::GetFileNameWithoutExtension($installer.Name)
$architecture = $installerStem -replace "^Muse_${versionPattern}_", "" -replace "-setup$", ""
$outputName = "Muse-$version-windows-$architecture-setup.exe"

New-Item -ItemType Directory -Path $artifactsDir -Force | Out-Null
$outputPath = Join-Path $artifactsDir $outputName
Copy-Item -LiteralPath $installer.FullName -Destination $outputPath -Force

Write-Host "Windows installer: $outputPath"
