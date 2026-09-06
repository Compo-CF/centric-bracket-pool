<#
  Sets up Workload Identity Federation so the scheduled sync job can write to
  Firestore from GitHub Actions without a service account key.

  A key would be simpler, but the subtlefoodie.com organisation enforces
  iam.disableServiceAccountKeyCreation -- and WIF is the better answer anyway:
  Actions exchanges its own short-lived OIDC token for Google credentials, so
  there is no long-lived secret to leak or rotate.

  Needs BOTH gcloud logins, which are separate credential stores:
    gcloud auth login                      -- for the gcloud CLI itself
    gcloud auth application-default login  -- for the Node scripts

  Run once. Safe to re-run: every step tolerates already existing.

  Usage:
    cd C:\Users\anthony.compofelice\centric-bracket-pool
    .\scripts\setup-wif.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectId  = "centricpool-e0256",
    [string] $Repo       = "Compo-CF/centric-bracket-pool",
    [string] $PoolId     = "github-pool",
    [string] $ProviderId = "github-provider",
    [string] $SaName     = "bracket-pool-sync"
)

# Continue, not Stop. gcloud on Windows is a PowerShell wrapper around
# python.exe, so anything it writes to stderr -- including harmless warnings --
# becomes a terminating NativeCommandError under Stop, killing the script
# before it can print a useful message. Every step checks $LASTEXITCODE
# explicitly instead.
$ErrorActionPreference = "Continue"

function Assert-Tool {
    param([string] $Name, [string] $Hint)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "$Name is not on PATH. $Hint" -ForegroundColor Red
        exit 1
    }
}

# Native commands do not throw, so every step is checked explicitly. Without
# this the script marches past the first failure and buries the real error.
function Invoke-Step {
    param(
        [string]   $Description,
        [string[]] $GcloudArgs,
        [switch]   $AllowExisting
    )
    Write-Host $Description -ForegroundColor Cyan
    $output = (& gcloud @GcloudArgs 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) { return $output }
    if ($AllowExisting -and $output -match 'already exists|ALREADY_EXISTS') {
        Write-Host "  (already exists)" -ForegroundColor DarkGray
        return $output
    }
    Write-Host ""
    Write-Host $output.Trim() -ForegroundColor Red
    Write-Host ""
    Write-Host "Stopped at: $Description" -ForegroundColor Red
    exit 1
}

Assert-Tool -Name "gcloud" -Hint "Open a new shell, or install the Cloud SDK."
Assert-Tool -Name "gh"     -Hint "Install the GitHub CLI."

# gcloud auth login and gcloud auth application-default login are different
# credential stores. The Node scripts use the second; gcloud itself needs the
# first, and having only ADC produces a confusing 'no active account' error.
Write-Host "Checking gcloud has an active account..." -ForegroundColor Cyan
# No --filter: gcloud warns when the key is absent from an empty list, and the
# warning would both add noise and make the result look non-empty.
$active = (& gcloud auth list --format="value(account)" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($active)) {
    Write-Host ""
    Write-Host "gcloud has no active account." -ForegroundColor Red
    Write-Host ""
    Write-Host "Application-default credentials are not the same thing. Run:" -ForegroundColor Yellow
    Write-Host "  gcloud auth login" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Sign in with the Google account that owns $ProjectId, then re-run this."
    exit 1
}
Write-Host "  $active" -ForegroundColor DarkGray

$sa = "$SaName@$ProjectId.iam.gserviceaccount.com"

Invoke-Step "Enabling the APIs WIF needs..." @(
    "services", "enable", "iamcredentials.googleapis.com", "sts.googleapis.com",
    "--project", $ProjectId) | Out-Null

Invoke-Step "Creating the service account the job runs as..." @(
    "iam", "service-accounts", "create", $SaName,
    "--project", $ProjectId,
    "--display-name", "Bracket pool results sync") -AllowExisting | Out-Null

Invoke-Step "Granting it Firestore access..." @(
    "projects", "add-iam-policy-binding", $ProjectId,
    "--member", "serviceAccount:$sa",
    "--role", "roles/datastore.user",
    "--condition=None") | Out-Null

Invoke-Step "Creating the workload identity pool..." @(
    "iam", "workload-identity-pools", "create", $PoolId,
    "--project", $ProjectId, "--location", "global",
    "--display-name", "GitHub Actions") -AllowExisting | Out-Null

# attribute-condition is not optional: without it ANY GitHub repository could
# mint tokens against this pool.
Invoke-Step "Creating the GitHub OIDC provider..." @(
    "iam", "workload-identity-pools", "providers", "create-oidc", $ProviderId,
    "--project", $ProjectId, "--location", "global",
    "--workload-identity-pool", $PoolId,
    "--display-name", "GitHub",
    "--issuer-uri", "https://token.actions.githubusercontent.com",
    "--attribute-mapping", "google.subject=assertion.sub,attribute.repository=assertion.repository",
    "--attribute-condition", "assertion.repository == '$Repo'") -AllowExisting | Out-Null

$projectNumber = (& gcloud projects describe $ProjectId --format "value(projectNumber)" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($projectNumber)) {
    Write-Host "Could not read the project number for $ProjectId." -ForegroundColor Red
    exit 1
}

$poolResource = "projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId"

Invoke-Step "Letting only this repository impersonate the service account..." @(
    "iam", "service-accounts", "add-iam-policy-binding", $sa,
    "--project", $ProjectId,
    "--role", "roles/iam.workloadIdentityUser",
    "--member", "principalSet://iam.googleapis.com/$poolResource/attribute.repository/$Repo") | Out-Null

$provider = "$poolResource/providers/$ProviderId"

Write-Host ""
Write-Host "Setting the repository variables..." -ForegroundColor Cyan
gh variable set GCP_WIF_PROVIDER --body $provider --repo $Repo
if ($LASTEXITCODE -ne 0) { Write-Host "gh variable set failed." -ForegroundColor Red; exit 1 }
gh variable set GCP_SYNC_SERVICE_ACCOUNT --body $sa --repo $Repo
if ($LASTEXITCODE -ne 0) { Write-Host "gh variable set failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  provider        $provider"
Write-Host "  service account $sa"
Write-Host ""
Write-Host "Test it without waiting for the cron:" -ForegroundColor Yellow
Write-Host "  gh workflow run 'Sync results' --repo $Repo -f dry_run=true"
Write-Host ""
Write-Host "Turn the schedule on when the tournament starts:" -ForegroundColor Yellow
Write-Host "  gh variable set SYNC_ENABLED --body true --repo $Repo"
