$ErrorActionPreference = 'Stop'
if (-not $env:GITHUB_ACTIONS -or -not $env:GITHUB_TOKEN -or $env:GITHUB_REF_TYPE -ne 'tag') {
    throw 'Release publication requires a tagged GitHub Actions run'
}
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+$' -or $env:GITHUB_REF_NAME -ne "v$taskVersion") { throw 'Release tag/version mismatch' }
$taskDownloads = Join-Path $taskRoot 'downloads'
$taskManifest = Get-Content -LiteralPath (Join-Path $taskDownloads 'manifest.json') -Raw | ConvertFrom-Json
$taskArchiveName = "codex-chat-windows-x64-v$taskVersion.zip"
if ($taskManifest.version -ne $taskVersion -or $taskManifest.archive -ne $taskArchiveName) { throw 'Release archive/version mismatch' }
$taskArchive = Join-Path $taskDownloads $taskArchiveName
$taskHash = (Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$taskSums = (Get-Content -LiteralPath (Join-Path $taskDownloads 'SHA256SUMS.txt') -Raw).Trim()
if ($taskHash -ne $taskManifest.sha256 -or $taskSums -ne "$taskHash  $taskArchiveName") { throw 'Release archive hash mismatch' }
if ((Get-Item -LiteralPath $taskArchive).Length -ne $taskManifest.sizeBytes) { throw 'Release archive size mismatch' }
$taskVerify = Join-Path $env:RUNNER_TEMP "codex-chat-release-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path -LiteralPath $taskVerify) { throw 'Release verification directory already exists' }
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskVerify
& node (Join-Path $taskVerify 'source/collaboration/install-package.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'Release package verification failed' }
if ((Get-Content -LiteralPath (Join-Path $taskVerify 'README.txt') -Raw) -cne (Get-Content -LiteralPath (Join-Path $taskRoot 'docs/getting-started.md') -Raw)) {
    throw 'Packaged guide differs from source guide'
}
$taskChangelog = Get-Content -LiteralPath (Join-Path $taskRoot 'CHANGELOG.md') -Raw
$taskNotes = [regex]::Match($taskChangelog, '(?ms)^## ' + [regex]::Escape($taskVersion) + ' — [^\r\n]+\r?\n(?<notes>.*?)(?=^## |\z)').Groups['notes'].Value.Trim()
if (-not $taskNotes) { throw 'Missing version release notes' }
$taskHeaders = @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$taskApi = "$env:GITHUB_API_URL/repos/$env:GITHUB_REPOSITORY/releases"
$taskBody = @{ tag_name = $env:GITHUB_REF_NAME; name = "v$taskVersion"; body = $taskNotes; draft = $true; prerelease = $false } | ConvertTo-Json
$taskRelease = Invoke-RestMethod -Method Post -Uri $taskApi -Headers $taskHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($taskBody))
$taskUpload = $taskRelease.upload_url -replace '\{\?.*\}$', ''
foreach ($taskAsset in @($taskArchiveName, 'SHA256SUMS.txt', 'manifest.json')) {
    $taskAssetPath = Join-Path $taskDownloads $taskAsset
    $taskAssetUrl = $taskUpload + '?name=' + [Uri]::EscapeDataString($taskAsset)
    $taskUploaded = Invoke-RestMethod -Method Post -Uri $taskAssetUrl -Headers $taskHeaders -ContentType 'application/octet-stream' -InFile $taskAssetPath
    if ($taskUploaded.name -ne $taskAsset -or $taskUploaded.size -ne (Get-Item -LiteralPath $taskAssetPath).Length) { throw 'Release asset upload mismatch' }
}
$taskPublish = @{ draft = $false; make_latest = 'true' } | ConvertTo-Json
$taskPublished = Invoke-RestMethod -Method Patch -Uri "$taskApi/$($taskRelease.id)" -Headers $taskHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($taskPublish))
if ($taskPublished.draft -or $taskPublished.tag_name -ne $env:GITHUB_REF_NAME) { throw 'Release publication not confirmed' }
Write-Output $taskPublished.html_url
