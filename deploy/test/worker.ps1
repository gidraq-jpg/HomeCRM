#Requires -Version 7
# Проверка worker на временных данных worktree. Docker подменён: контейнеры не запускаются.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. "$PSScriptRoot/../scripts/ops-common.ps1"
$data = Join-Path $script:RepoRoot "test-results/worker-$([guid]::NewGuid().ToString('n'))"
$previousData = $env:HOMECRM_DATA
$previousVersion = $env:HOMECRM_VERSION

function Assert-That {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

# Функция доступна вызываемому restore.ps1: ни одна команда не доходит до Docker.
$dockerCalls = [System.Collections.Generic.List[string]]::new()
$failStep = ''
function docker {
  [void]$dockerCalls.Add(($args -join ' '))
  $global:LASTEXITCODE = if ($failStep -and ($args -join ' ').Contains($failStep)) { 1 } else { 0 }
}

function Invoke-RestMethod {
  return @{ status = 'ok'; database = 'ok'; version = 'worker-test' }
}

try {
  foreach ($environment in 'production', 'preview') {
    $folder = if ($environment -eq 'preview') { 'preview' } else { 'app' }
    $dir = Join-Path $data "secrets/$folder"
    $options = @{ DataDir = $data; Environment = $environment; TimeZone = 'Europe/Moscow' }
    & "$PSScriptRoot/../scripts/new-app-secrets.ps1" @options | Out-Null
    $workerFile = Join-Path $dir 'worker.env'
    $serverFile = Join-Path $dir 'server.env'
    $workerText = Get-Content $workerFile -Raw
    $keys = @(Get-Content $workerFile | ForEach-Object { if ($_ -match '^([^#=]+)=') { $Matches[1] } })
    Assert-That (($keys -join ',') -ceq 'DATABASE_URL_WORKER,HOME_TIME_ZONE') 'Лишние или отсутствующие переменные worker.'
    Assert-That ($workerText -notmatch 'BETTER_AUTH_SECRET|DATABASE_URL_APP|DATABASE_URL_AUTH|homecrm_app:|homecrm_auth:') 'Worker получил секреты app/auth.'
    Assert-That ((Get-EnvSetting $workerFile 'DATABASE_URL_WORKER') -ceq (Get-EnvSetting $serverFile 'DATABASE_URL_WORKER')) 'Подключение worker не совпало.'
    Assert-That ((Get-EnvSetting $workerFile 'HOME_TIME_ZONE') -ceq 'Europe/Moscow') 'Пояс worker не совпал.'
    $before = @{}
    foreach ($file in Get-ChildItem (Join-Path $data 'secrets') -File -Recurse) { $before[$file.FullName] = (Get-FileHash $file.FullName).Hash }
    & "$PSScriptRoot/../scripts/new-app-secrets.ps1" @options -BaseUrl 'https://changed.invalid' | Out-Null
    foreach ($path in $before.Keys) { Assert-That ((Get-FileHash $path).Hash -ceq $before[$path]) 'Повторный запуск изменил существующий секрет.' }

    # Обновление уже включённого окружения: отсутствует только worker.env.
    Remove-Item -LiteralPath $workerFile
    $oldServer = (Get-Content $serverFile -Raw) -replace '(?m)^DATABASE_URL_WORKER=.*$', 'DATABASE_URL_WORKER=postgres://homecrm_worker:fictional-existing@db:5432/homecrm'
    $oldServer = $oldServer -replace '(?m)^HOME_TIME_ZONE=.*$', 'HOME_TIME_ZONE=Pacific/Auckland'
    Write-TextFile $serverFile $oldServer
    $before = @{}
    foreach ($file in Get-ChildItem (Join-Path $data 'secrets') -File -Recurse) { $before[$file.FullName] = (Get-FileHash $file.FullName).Hash }
    & "$PSScriptRoot/../scripts/new-app-secrets.ps1" @options | Out-Null
    Assert-That ((Get-EnvSetting $workerFile 'DATABASE_URL_WORKER') -ceq 'postgres://homecrm_worker:fictional-existing@db:5432/homecrm') 'Скрипт использовал новый пароль вместо действующего.'
    Assert-That ((Get-EnvSetting $workerFile 'HOME_TIME_ZONE') -ceq 'Pacific/Auckland') 'Скрипт использовал новый пояс вместо действующего.'
    foreach ($path in $before.Keys) { Assert-That ((Get-FileHash $path).Hash -ceq $before[$path]) 'Добавление worker.env изменило существующий секрет.' }
    Write-Host "ок: $environment — узкое окружение, повторный запуск и обновление"
  }

  $compose = Get-Content (Join-Path $script:RepoRoot 'deploy/compose.yaml') -Raw
  $workerService = [regex]::Match($compose, '(?ms)^  worker:.*?(?=^  [a-z][a-z-]*:|\z)').Value
  Assert-That ($workerService.Contains('/worker.env') -and -not $workerService.Contains('/server.env')) 'Compose передаёт worker окружение сервера.'

  & "$PSScriptRoot/../scripts/restore.ps1" -DataDir $data -Project homecrm-test-worker
  Assert-That ($dockerCalls[0].EndsWith('stop app worker backup')) 'До восстановления не остановлены все писатели.'
  Assert-That ($dockerCalls[1].EndsWith('up -d --wait db')) 'Пустая база не запущена после остановки.'
  Assert-That ($dockerCalls[2].Contains('restore --from local --snapshot latest')) 'Восстановление не выполнено после остановки.'
  Write-Host 'ок: восстановление — worker остановлен до работы с базой'

  $dockerCalls.Clear()
  $failStep = 'stop app worker backup'
  $failed = $false
  try { & "$PSScriptRoot/../scripts/restore.ps1" -DataDir $data -Project homecrm-test-worker }
  catch { $failed = $true }
  Assert-That ($failed -and $dockerCalls.Count -eq 1) 'Восстановление продолжилось после неудачной остановки worker.'
  Write-Host 'ок: ошибка остановки запрещает восстановление'

  $dockerCalls.Clear()
  $failStep = 'restore --from'
  $failed = $false
  try { & "$PSScriptRoot/../scripts/restore.ps1" -DataDir $data -Project homecrm-test-worker }
  catch { $failed = $true }
  Assert-That ($failed -and $dockerCalls.Count -eq 3) 'Ошибка восстановления не остановила скрипт.'
  Write-Host 'ок: ошибка восстановления — сервисы не запускаются'

  $dockerCalls.Clear()
  $failStep = ''
  & "$PSScriptRoot/../scripts/release.ps1" -DataDir $data -Project homecrm-test-worker -Version worker-test -NoBuild -Port 18320
  Assert-That ($dockerCalls.Count -eq 1 -and $dockerCalls[0].Contains('--profile app up -d')) 'После восстановления не запускается весь профиль app вместе с worker.'
  Write-Host 'ок: выбранная версия — app и worker запускаются через release.ps1'
}
finally {
  $env:HOMECRM_DATA = $previousData
  $env:HOMECRM_VERSION = $previousVersion
  $resolvedData = [System.IO.Path]::GetFullPath($data)
  $testRoot = [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot 'test-results')) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedData.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Неверный путь тестовой папки.' }
  if (Test-Path $resolvedData) { Remove-Item -LiteralPath $resolvedData -Recurse -Force }
}
