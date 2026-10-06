#Requires -Version 7
# Регрессия трёх команд до первого включения. Только свой проект homecrm-test-* без портов и
# временные вымышленные данные внутри worktree; никакого рабочего окружения и настоящих секретов.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. "$PSScriptRoot/../scripts/ops-common.ps1"
$branch = (git -C $script:RepoRoot rev-parse --abbrev-ref HEAD).Trim().ToLowerInvariant() -replace '[^a-z0-9]+', '-'
$project = "homecrm-test-$branch-first-database-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
$data = Join-Path $script:RepoRoot "test-results/$project"
$composeFile = Join-Path $data 'compose.yaml'
$previousData = $env:HOMECRM_DATA
$previousDefaults = $PSDefaultParameterValues.Clone()
$compose = Get-ComposeArgs -Project $project -ExtraFiles @($composeFile)
$expected = 'База ещё не создана — сначала первое включение (runbook, раздел 7)'

try {
  Write-TextFile (Join-Path $data 'secrets/app/db.env') "POSTGRES_HOST_AUTH_METHOD=trust`n"
  Write-TextFile (Join-Path $data 'secrets/app/server.env') "# Вымышленное тестовое окружение`n"
  Write-TextFile (Join-Path $data 'secrets/backup.env') "# Облако не используется`n"
  Write-TextFile (Join-Path $data 'secrets/restic-password') "fictional-test-only`n"
  Write-TextFile $composeFile "services:`n  db:`n    restart: 'no'`n    volumes: !reset []`n    tmpfs: ['/var/lib/postgresql']`n"
  $env:HOMECRM_DATA = $data -replace '\\', '/'
  Invoke-Docker @compose --profile app up -d --wait --wait-timeout 30 db
  # Тот же код ожидания, но 1 с вместо 90: иначе три отрицательных сценария занимали бы 4,5 минуты.
  $PSDefaultParameterValues['Wait-FirstDatabase:TimeoutSeconds'] = 1
  $cases = @(
    @{ File = 'backup-now.ps1'; Options = @{ Project = $project } },
    @{ File = 'restore-check.ps1'; Options = @{ Project = "$project-check"; SourceProject = $project } },
    @{ File = 'backup-status.ps1'; Options = @{ Project = $project; Snapshots = $true } }
  )
  foreach ($case in $cases) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $options = $case.Options
    try {
      & (Join-Path $PSScriptRoot "../scripts/$($case.File)") -DataDir $data -ExtraComposeFiles $composeFile @options
      throw "Не обнаружена отсутствующая база: $($case.File)"
    }
    catch {
      if ($_.Exception.Message -cne $expected) { throw }
    }
    if ($watch.Elapsed.TotalSeconds -lt 0.9 -or $watch.Elapsed.TotalSeconds -gt 3) { throw "Ожидание вышло за предел: $($case.File)" }
    Write-Host "ок: $($case.File) — ограниченное ожидание и сообщение"
  }
  # База не создаётся самой проверкой; контейнер проверки восстановления тоже не был запущен.
  $database = & docker @compose exec -T db psql -U postgres -d postgres -At -c "select 1 from pg_database where datname = 'homecrm'"
  if ($LASTEXITCODE -ne 0 -or $database) { throw 'Проверка создала базу или остановила исходный контейнер.' }
  Invoke-Docker @compose exec -T db psql -U postgres -d postgres -c 'create database homecrm'
  Wait-FirstDatabase -DataDir $data -Compose $compose -TimeoutSeconds 10
  Write-Host 'ок: созданная база — продолжение без ожидания'

  # После первого включения копии можно проверять даже при утрате исходной базы.
  Write-TextFile (Join-Path $data 'backups/status/backup.json') '{"lastSuccessAt":"2026-10-06T00:00:00Z"}'
  Invoke-Docker @compose exec -T db psql -U postgres -d postgres -c 'drop database homecrm'
  Wait-FirstDatabase -DataDir $data -Compose $compose
  Write-Host 'ок: успешная копия — восстановление не зависит от исходной базы'
}
finally {
  # Профиль нужен и здесь: без него down не видит db и оставляет контейнер и сеть после каждого прогона.
  & docker @compose --profile app down --volumes --remove-orphans 2>&1 | Out-Null
  $env:HOMECRM_DATA = $previousData
  $PSDefaultParameterValues = $previousDefaults
  $resolvedData = [System.IO.Path]::GetFullPath($data)
  $testRoot = [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot 'test-results')) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedData.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Неверный путь тестовой папки.' }
  Remove-Item -LiteralPath $resolvedData -Recurse -Force -ErrorAction Stop
}
