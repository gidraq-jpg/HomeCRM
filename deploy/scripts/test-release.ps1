#Requires -Version 7
# D23b: настоящий выпуск в отдельном проекте; только вымышленные секреты и своя база.
param([string]$ImageVersion = 'v0.5.7-pilot.1', [int]$Port = 8377)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. "$PSScriptRoot/ops-common.ps1"
$project = 'homecrm-test-release'
$data = Join-Path $script:RepoRoot "test-results/d23b-release-$PID"
$override = Join-Path $data 'failure.yaml'
$failedVersion = "d23b-release-failed-$PID"
$saved = @{}
foreach ($name in @('HOMECRM_DATA', 'HOMECRM_VERSION', 'HOMECRM_APP_PORT', 'BACKUP_ENABLED', 'HOMECRM_APP_SECRETS', 'HOMECRM_BACKUP_DIR')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name)
}
try {
  $env:HOMECRM_DATA = $data -replace '\\', '/'
  $env:HOMECRM_APP_PORT = "$Port"
  $env:HOMECRM_APP_SECRETS = "$($env:HOMECRM_DATA)/secrets/app"
  $env:HOMECRM_BACKUP_DIR = "$($env:HOMECRM_DATA)/backups"
  $env:BACKUP_ENABLED = '0'
  & "$PSScriptRoot/new-app-secrets.ps1" -DataDir $data -BaseUrl "http://127.0.0.1:$Port"
  $compose = Get-ComposeArgs -Project $project
  # Нельзя присоединяться к чужому прогону даже того же тестового проекта.
  $existing = & docker @compose --profile app ps -aq
  if ($LASTEXITCODE -ne 0 -or $existing) { throw 'Тестовый проект уже занят или Docker недоступен' }
  $ownsProject = $true
  & "$PSScriptRoot/release.ps1" -Version $ImageVersion -DataDir $data -Project $project -Port $Port -NoBuild
  $oldApp = & docker @compose --profile app ps -q app
  if ($LASTEXITCODE -ne 0 -or -not $oldApp) { throw 'Старое приложение не запущено' }
  Invoke-Docker image tag "homecrm-app:$ImageVersion" "homecrm-app:$failedVersion"
  $ownsImage = $true
  # Имитируем ошибку мигратора после ожидания; база и все тома принадлежат тестовому проекту.
  Write-TextFile $override @'
services:
  migrate:
    command: [node, -e, 'setTimeout(() => { console.log(JSON.stringify({level: "error", msg: "command failed", error: "fictional migration failure"})); process.exit(17); }, 1500)']
'@
  $stopped = $false
  $output = & {
    try {
      & "$PSScriptRoot/release.ps1" -Version $failedVersion -DataDir $data -Project $project -Port $Port -NoBuild -ExtraComposeFiles $override
    } catch {
      if ($_.Exception.Message -ne 'Выпуск остановлен: migrate завершился с ошибкой') { throw }
      $script:stopped = $true
    }
  } 6>&1 | Out-String
  if (-not $stopped -or $output.Contains('Готово:')) { throw 'Ошибка миграции не остановила выпуск' }
  if (-not $output.Contains('fictional migration failure') -or -not $output.Contains('Откат:')) { throw 'Нет журнала миграции или подсказки отката' }
  $currentApp = & docker @compose --profile app ps -q app
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/health"
  if ($currentApp -ne $oldApp -or $health.version -ne $ImageVersion -or $health.database -ne 'ok') { throw 'Старое приложение изменилось или недоступно' }
  Write-Host 'ок: migrate exit 17 — выпуск остановлен, прежний app и его база работают, Готово не выведено'
} finally {
  if ($ownsProject) { & docker @compose --profile app down --volumes --remove-orphans 2>&1 | Out-Null }
  if ($ownsImage) { & docker image rm "homecrm-app:$failedVersion" 2>&1 | Out-Null }
  $resolvedData = [System.IO.Path]::GetFullPath($data)
  $testRoot = [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot 'test-results')) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedData.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Неверный путь тестовой папки' }
  if (Test-Path $resolvedData) { Remove-Item -LiteralPath $resolvedData -Recurse -Force }
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
