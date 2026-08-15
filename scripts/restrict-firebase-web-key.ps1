# Requires: gcloud auth login with access to finsight-ai-jd
param(
  [string]$ProjectId = "finsight-ai-jd",
  [string]$ApiKeyName = ""
)

$ErrorActionPreference = "Stop"

Write-Host "Listing API keys for project $ProjectId..."
$keysJson = gcloud services api-keys list --project=$ProjectId --format=json
if (-not $keysJson) { throw "No API keys returned. Run: gcloud auth login" }

$keys = $keysJson | ConvertFrom-Json
if (-not $keys -or $keys.Count -eq 0) { throw "No API keys found in project." }

# Prefer the key matching firebaseConfig apiKey display name / browser key
$target = $null
if ($ApiKeyName) {
  $target = $keys | Where-Object { $_.displayName -eq $ApiKeyName } | Select-Object -First 1
}
if (-not $target) {
  $target = $keys | Where-Object { $_.displayName -match 'Browser key|Web API Key|Firebase' } | Select-Object -First 1
}
if (-not $target) {
  $target = $keys | Select-Object -First 1
  Write-Host "Falling back to first key: $($target.displayName) ($($target.uid))"
}

$keyName = $target.name
Write-Host "Updating key: $($target.displayName) ($keyName)"

$restrictions = @{
  browserKeyRestrictions = @{
    allowedReferrers = @(
      "https://finsight-ai-jd.web.app/*",
      "https://finsight-ai-jd.firebaseapp.com/*",
      "http://localhost:*",
      "http://127.0.0.1:*"
    )
  }
  apiTargets = @(
    @{ service = "identitytoolkit.googleapis.com" },
    @{ service = "securetoken.googleapis.com" },
    @{ service = "firestore.googleapis.com" },
    @{ service = "firebaseinstallations.googleapis.com" }
  )
} | ConvertTo-Json -Depth 6 -Compress

$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value $restrictions -Encoding utf8

gcloud services api-keys update $keyName `
  --project=$ProjectId `
  --restrictions-from-file=$tmp

Remove-Item $tmp -Force
Write-Host "Done. Verify in Console: https://console.cloud.google.com/apis/credentials?project=$ProjectId"
