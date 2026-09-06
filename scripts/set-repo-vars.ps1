<#
  Reads .env.local and pushes every VITE_* value to GitHub Actions repository
  variables, so local dev and the deployed build read the same configuration.

  These are variables, not secrets: the Firebase web config is public by design
  and protected by the Firestore security rules, not by being hidden.

  Usage (PowerShell 5.1):
    cd C:\Users\anthony.compofelice\centric-bracket-pool
    .\scripts\set-repo-vars.ps1
#>

[CmdletBinding()]
param(
    [string] $EnvFile = ".env.local",
    [string] $Repo    = "Compo-CF/centric-bracket-pool"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
    Write-Host "No $EnvFile found." -ForegroundColor Red
    Write-Host "Copy .env.example to .env.local and fill in the values first."
    exit 1
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($null -eq $gh) {
    Write-Host "The GitHub CLI (gh) is not on PATH." -ForegroundColor Red
    exit 1
}

$set     = 0
$skipped = @()

foreach ($line in Get-Content $EnvFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }

    $split = $trimmed.IndexOf("=")
    if ($split -lt 1) { continue }

    $name  = $trimmed.Substring(0, $split).Trim()
    $value = $trimmed.Substring($split + 1).Trim().Trim('"').Trim("'")

    if (-not $name.StartsWith("VITE_")) { continue }

    if ($value -eq "") {
        $skipped += $name
        continue
    }

    Write-Host "Setting $name" -ForegroundColor DarkGray
    gh variable set $name --body $value --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "Failed to set $name" }
    $set++
}

Write-Host ""
Write-Host "$set variable(s) set on $Repo." -ForegroundColor Green

if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Still empty in ${EnvFile}:" -ForegroundColor Yellow
    foreach ($name in $skipped) { Write-Host "  $name" -ForegroundColor Yellow }
    Write-Host "The app will show its setup checklist until these are filled in."
}
