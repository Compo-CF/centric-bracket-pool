<#
  Sets up Workload Identity Federation so the scheduled sync job can write to
  Firestore from GitHub Actions without a service account key.

  A key would be simpler, but the subtlefoodie.com organisation enforces
  iam.disableServiceAccountKeyCreation -- and WIF is the better answer anyway:
  Actions exchanges its own short-lived OIDC token for Google credentials, so
  there is no long-lived secret to leak or rotate.

  Run once. Needs gcloud and owner rights on the project.

  Usage:
    cd C:\Users\anthony.compofelice\centric-bracket-pool
    .\scripts\setup-wif.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectId = "centricpool-e0256",
    [string] $Repo      = "Compo-CF/centric-bracket-pool",
    [string] $PoolId    = "github-pool",
    [string] $ProviderId= "github-provider",
    [string] $SaName    = "bracket-pool-sync"
)

$ErrorActionPreference = "Stop"

if ($null -eq (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "gcloud is not on PATH. Open a new shell, or install the CLI." -ForegroundColor Red
    exit 1
}

$sa = "$SaName@$ProjectId.iam.gserviceaccount.com"

Write-Host "Enabling the APIs WIF needs..." -ForegroundColor Cyan
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com `
    --project $ProjectId

Write-Host "Creating the service account the job runs as..." -ForegroundColor Cyan
gcloud iam service-accounts create $SaName `
    --project $ProjectId `
    --display-name "Bracket pool results sync" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "  (already exists)" -ForegroundColor DarkGray }

Write-Host "Granting it Firestore access..." -ForegroundColor Cyan
gcloud projects add-iam-policy-binding $ProjectId `
    --member "serviceAccount:$sa" `
    --role "roles/datastore.user" `
    --condition=None | Out-Null

Write-Host "Creating the workload identity pool..." -ForegroundColor Cyan
gcloud iam workload-identity-pools create $PoolId `
    --project $ProjectId --location global `
    --display-name "GitHub Actions" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "  (already exists)" -ForegroundColor DarkGray }

Write-Host "Creating the GitHub OIDC provider..." -ForegroundColor Cyan
# attribute-condition is not optional: without it ANY GitHub repository could
# mint tokens against this pool.
gcloud iam workload-identity-pools providers create-oidc $ProviderId `
    --project $ProjectId --location global `
    --workload-identity-pool $PoolId `
    --display-name "GitHub" `
    --issuer-uri "https://token.actions.githubusercontent.com" `
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" `
    --attribute-condition "assertion.repository == '$Repo'" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "  (already exists)" -ForegroundColor DarkGray }

$projectNumber = (gcloud projects describe $ProjectId --format "value(projectNumber)")
$poolResource = "projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId"

Write-Host "Letting only this repository impersonate the service account..." -ForegroundColor Cyan
gcloud iam service-accounts add-iam-policy-binding $sa `
    --project $ProjectId `
    --role "roles/iam.workloadIdentityUser" `
    --member "principalSet://iam.googleapis.com/$poolResource/attribute.repository/$Repo" | Out-Null

$provider = "$poolResource/providers/$ProviderId"

Write-Host ""
Write-Host "Setting the repository variables..." -ForegroundColor Cyan
gh variable set GCP_WIF_PROVIDER --body $provider --repo $Repo
gh variable set GCP_SYNC_SERVICE_ACCOUNT --body $sa --repo $Repo

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
