<#
  Turns the firebaseConfig snippet from the Firebase console into .env.local,
  so the six values are not retyped by hand. A mistyped appId fails at runtime
  with a message that does not point at the typo.

  Usage (PowerShell 5.1):
    1. Firebase console -> Project settings -> General -> Your apps -> Web app.
    2. Copy the whole firebaseConfig block and save it as firebase-config.txt
       in the repo root.
    3. cd C:\Users\anthony.compofelice\centric-bracket-pool
       .\scripts\import-firebase-config.ps1

  Then add VITE_MICROSOFT_TENANT_ID from the Entra app registration.
#>

[CmdletBinding()]
param(
    [string] $ConfigFile = "firebase-config.txt",
    [string] $OutFile    = ".env.local"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ConfigFile)) {
    Write-Host "No $ConfigFile found." -ForegroundColor Red
    Write-Host "Paste the firebaseConfig block from the console into that file first."
    exit 1
}

$text = Get-Content $ConfigFile -Raw

$map = [ordered]@{
    apiKey            = "VITE_FIREBASE_API_KEY"
    authDomain        = "VITE_FIREBASE_AUTH_DOMAIN"
    projectId         = "VITE_FIREBASE_PROJECT_ID"
    storageBucket     = "VITE_FIREBASE_STORAGE_BUCKET"
    messagingSenderId = "VITE_FIREBASE_MESSAGING_SENDER_ID"
    appId             = "VITE_FIREBASE_APP_ID"
}

# Preserve anything already set, so re-running does not wipe the tenant id.
$existing = [ordered]@{}
if (Test-Path $OutFile) {
    foreach ($line in Get-Content $OutFile) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -gt 0) { $existing[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim() }
    }
}

$missing = @()
foreach ($key in $map.Keys) {
    $pattern = $key + '\s*:\s*[''"]([^''"]+)[''"]'
    $match = [regex]::Match($text, $pattern)
    if ($match.Success) { $existing[$map[$key]] = $match.Groups[1].Value }
    elseif (-not $existing.Contains($map[$key])) { $missing += $key }
}

if (-not $existing.Contains("VITE_ALLOWED_EMAIL_DOMAIN")) {
    $existing["VITE_ALLOWED_EMAIL_DOMAIN"] = "centricfiber.com"
}
if (-not $existing.Contains("VITE_MICROSOFT_TENANT_ID")) {
    $existing["VITE_MICROSOFT_TENANT_ID"] = ""
}

$lines = @("# Written by scripts\import-firebase-config.ps1. Safe to edit by hand.")
foreach ($name in $existing.Keys) { $lines += "$name=$($existing[$name])" }
Set-Content -Path $OutFile -Value $lines -Encoding utf8

Write-Host "Wrote $OutFile" -ForegroundColor Green
foreach ($name in $existing.Keys) {
    $value = $existing[$name]
    if ($value -eq "") { Write-Host ("  {0,-35} (empty)" -f $name) -ForegroundColor Yellow }
    else { Write-Host ("  {0,-35} set" -f $name) -ForegroundColor DarkGray }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "Not found in ${ConfigFile}: $($missing -join ', ')" -ForegroundColor Yellow
}

if ($existing["VITE_MICROSOFT_TENANT_ID"] -eq "") {
    Write-Host ""
    Write-Host "Still needed: VITE_MICROSOFT_TENANT_ID" -ForegroundColor Yellow
    Write-Host "It is the Directory (tenant) ID on the Entra app registration overview."
}
