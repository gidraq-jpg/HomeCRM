#Requires -Version 7
<#
.SYNOPSIS
  Тест полного круга: окружение, копия перед миграцией, копия, потеря базы, восстановление, проверка (R0.11).

.DESCRIPTION
  Всё в своём compose-проекте homecrm-test-<ветка>-ops и во временной папке вместо E:\HomeCRM-data.
  Рабочий проект `homecrm`, его тома и порты 8300, 8301, 8309 не затрагиваются. Настоящих ключей нет:
  вторая копия лежит в «облаке» — rclone-подключении типа local. Пароли генерируются на лету.
  Нужен запущенный Docker Desktop. После теста контейнеры, тома, образ и папка удаляются.

  Что проверяется:
    1. выпуск «прошлой версии» (без последней миграции), /health с базой;
    2. выпуск новой версии: перед миграцией делается копия (DATA-4) в оба хранилища;
    3. копия данных: дамп и файлы в оба хранилища (restic, local и rclone);
    4. база и том удалены, восстановление из «облака», данные на месте, /health ок;
    5. проверка восстановления по обоим хранилищам в отдельном проекте.

.EXAMPLE
  pwsh deploy/test/backup-cycle.ps1
#>
param(
  [int]$Port = 18330,
  [switch]$KeepEnvironment
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$scripts = Join-Path $here '..\scripts'
. (Join-Path $scripts 'ops-common.ps1')

$branch = (git -C $script:Repo rev-parse --abbrev-ref HEAD).Trim()
$slug = ($branch.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
$project = "homecrm-test-$slug-ops"
$checkProject = "$project-check"
if ($project -eq 'homecrm' -or $project -notmatch '^homecrm-test-') { throw 'Имя тестового проекта выбрано неверно.' }

$data = Join-Path $env:TEMP "homecrm-test-ops-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
$version = 'test-ops'
$env:HOMECRM_VERSION = $version
$env:HOMECRM_APP_PORT = "$Port"
$cycle = (Resolve-Path (Join-Path $here 'compose.cycle.yaml')).Path
$oldMigrations = (Resolve-Path (Join-Path $here 'compose.old-migrations.yaml')).Path
$failures = New-Object System.Collections.Generic.List[string]

function Assert-That([bool]$Condition, [string]$Message) {
  if ($Condition) { Write-Host "  ок: $Message" } else { Write-Host "  ОШИБКА: $Message" -ForegroundColor Red; $failures.Add($Message) }
}

function Invoke-Psql([string]$Sql) {
  $compose = Get-ComposeArgs -Project $project -ExtraFiles @($cycle)
  $out = & docker @compose --profile app exec -T db psql -U postgres -d homecrm -At -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql: $Sql" }
  return ($out -join "`n").Trim()
}

function Get-Health {
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 15 -SkipHttpErrorCheck
}

function Read-Status([string]$File) {
  Get-Content (Join-Path $data "backups\status\$File") -Raw | ConvertFrom-Json
}

function Get-Snapshots([string]$Repo) {
  $compose = Get-ComposeArgs -Project $project -ExtraFiles @($cycle)
  (& docker @compose --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts snapshots --from $Repo) -join "`n"
}

try {
  Write-Host "Проект $project, данные $data"
  New-Item -ItemType Directory -Force $data, (Join-Path $data 'cloud') | Out-Null
  $env:HOMECRM_DATA = $data -replace '\\', '/'

  # --- Секреты и «облако» -------------------------------------------------------------------------
  & (Join-Path $scripts 'new-app-secrets.ps1') -DataDir $data -BaseUrl "http://127.0.0.1:$Port" | Out-Null
  Write-TextFile (Join-Path $data 'secrets\rclone\rclone.conf') "[cloud-test]`ntype = local`n"
  $backupEnv = Join-Path $data 'secrets\backup.env'
  Write-TextFile $backupEnv ((Get-Content $backupEnv -Raw) + "BACKUP_CLOUD_REPOSITORY=rclone:cloud-test:/cloud/restic`n")

  # Каталог миграций «прошлой версии»: без последней записи журнала.
  $migrations = Join-Path $script:Repo 'packages\db\migrations'
  $old = Join-Path $data 'old-migrations'
  Copy-Item $migrations $old -Recurse
  $journalFile = Join-Path $old 'meta\_journal.json'
  $journal = Get-Content $journalFile -Raw | ConvertFrom-Json
  $lastTag = $journal.entries[-1].tag
  $journal.entries = @($journal.entries | Select-Object -SkipLast 1)
  Remove-Item (Join-Path $old "$lastTag.sql")
  Write-TextFile $journalFile ($journal | ConvertTo-Json -Depth 10)
  $totalMigrations = (Get-Content (Join-Path $migrations 'meta\_journal.json') -Raw | ConvertFrom-Json).entries.Count

  # --- 1. Выпуск «прошлой версии» -----------------------------------------------------------------
  Write-Host '== 1. Выпуск прошлой версии (без последней миграции)'
  & (Join-Path $scripts 'release.ps1') -Version $version -DataDir $data -Project $project -Port $Port -ExtraComposeFiles $cycle, $oldMigrations
  Assert-That ($LASTEXITCODE -eq 0) 'выпуск прошлой версии завершился успешно'
  Assert-That ((Get-Health).database -eq 'ok') '/health: база отвечает'
  $applied = [int](Invoke-Psql 'select count(*) from drizzle.__drizzle_migrations')
  Assert-That ($applied -eq $totalMigrations - 1) "применено миграций: $applied из $($totalMigrations - 1) прошлой версии"
  [void](Invoke-Psql "create table public.ops_cycle_probe (id int primary key, note text); insert into public.ops_cycle_probe select g, 'row ' || g from generate_series(1, 250) g")

  # --- 2. Выпуск новой версии: копия перед миграцией (DATA-4) -------------------------------------
  Write-Host '== 2. Выпуск новой версии: копия перед миграцией'
  & (Join-Path $scripts 'release.ps1') -Version $version -NoBuild -DataDir $data -Project $project -Port $Port -ExtraComposeFiles $cycle
  Assert-That ($LASTEXITCODE -eq 0) 'выпуск новой версии завершился успешно'
  $applied = [int](Invoke-Psql 'select count(*) from drizzle.__drizzle_migrations')
  Assert-That ($applied -eq $totalMigrations) "миграция применена: $applied из $totalMigrations"
  $status = Read-Status 'backup.json'
  Assert-That ($status.lastKind -eq 'pre-migration' -and $status.repos.local.ok -and $status.repos.cloud.ok) 'перед миграцией сделана копия в оба хранилища'
  Assert-That ((Get-Snapshots 'local') -match 'pre-migration') 'в локальном хранилище есть снимок pre-migration'
  Assert-That ((Get-Snapshots 'cloud') -match 'pre-migration') 'в «облаке» (rclone) есть снимок pre-migration'

  # --- 3. Данные и копия --------------------------------------------------------------------------
  Write-Host '== 3. Данные и копия'
  $password = [System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)).ToLowerInvariant()
  $setup = @'
import { runFirstSetup } from '/app/apps/server/src/auth/first-setup.ts';
import { createAuthDatabase, createPool } from '/app/packages/db/src/index.ts';
const pool = createPool(process.env.DATABASE_URL_AUTH, { max: 1 });
await runFirstSetup(createAuthDatabase(pool), { householdName: 'Test family', displayName: 'Test Admin', username: 'test-admin', password: process.env.TEST_PASSWORD });
await pool.end();
'@
  $compose = Get-ComposeArgs -Project $project -ExtraFiles @($cycle)
  & docker @compose --profile app --profile ops run --rm -T -e "TEST_PASSWORD=$password" ops node --input-type=module -e $setup
  Assert-That ($LASTEXITCODE -eq 0) 'первая настройка создала дом и администратора (вымышленные данные)'
  $accountsBefore = Invoke-Psql 'select count(*) from accounts'
  $householdsBefore = Invoke-Psql 'select count(*) from households'
  Assert-That ([int]$accountsBefore -ge 1 -and [int]$householdsBefore -ge 1) "в базе есть данные: домов $householdsBefore, учётных записей $accountsBefore"
  # Файл приложения: проверяет, что в копию входят и файлы.
  & docker @compose --profile app exec -T app node -e "require('node:fs').writeFileSync('/data/files/probe.bin', Buffer.alloc(4096, 7))"
  Assert-That ($LASTEXITCODE -eq 0) 'в том файлов лёг тестовый файл'

  & (Join-Path $scripts 'backup-now.ps1') -DataDir $data -Project $project -ExtraComposeFiles $cycle
  Assert-That ($LASTEXITCODE -eq 0) 'ежедневная копия выполнена'
  $status = Read-Status 'backup.json'
  Assert-That ($status.lastKind -eq 'daily' -and $status.repos.local.ok -and $status.repos.cloud.ok) 'копия лежит в обоих хранилищах'

  # --- 4. Потеря базы и восстановление ------------------------------------------------------------
  Write-Host '== 4. Потеря базы и восстановление из «облака»'
  Invoke-Docker @compose --profile app --profile ops down --volumes --remove-orphans
  & (Join-Path $scripts 'restore.ps1') -DataDir $data -Project $project -From cloud -ExtraComposeFiles $cycle
  Assert-That ($LASTEXITCODE -eq 0) 'восстановление из хранилища rclone завершилось успешно'
  & (Join-Path $scripts 'release.ps1') -Version $version -NoBuild -DataDir $data -Project $project -Port $Port -ExtraComposeFiles $cycle
  Assert-That ($LASTEXITCODE -eq 0) 'окружение поднялось на восстановленной базе'
  Assert-That ((Invoke-Psql 'select count(*) from public.ops_cycle_probe') -eq '250') 'строки таблицы на месте: 250'
  Assert-That ((Invoke-Psql 'select count(*) from accounts') -eq $accountsBefore) 'учётные записи на месте'
  Assert-That ((Invoke-Psql 'select count(*) from households') -eq $householdsBefore) 'дом на месте'
  $files = & docker @compose --profile app exec -T app node -e "console.log(require('node:fs').statSync('/data/files/probe.bin').size)"
  Assert-That (($files -join '').Trim() -eq '4096') 'файл приложения восстановлен'
  Assert-That ((Get-Health).database -eq 'ok') '/health: база отвечает'

  # --- 5. Проверка восстановления в отдельном проекте ---------------------------------------------
  Write-Host '== 5. Проверка восстановления (оба хранилища)'
  & (Join-Path $scripts 'restore-check.ps1') -DataDir $data -Project $checkProject -From local, cloud -ExtraComposeFiles $cycle
  Assert-That ($LASTEXITCODE -eq 0) 'проверка восстановления прошла'
  foreach ($repo in 'local', 'cloud') {
    $check = Read-Status "restore-check-$repo.json"
    Assert-That ($check.ok -and $check.migrated -and $check.files -eq 1) "отметка проверки ($repo): ок, строк $($check.rows), миграции применены"
  }
  & (Join-Path $scripts 'backup-status.ps1') -DataDir $data
  Assert-That ($LASTEXITCODE -eq 0) 'backup-status.ps1: состояние в порядке'

  # --- Секреты не в журналах ---------------------------------------------------------------------
  $logs = (& docker @compose --profile app --profile ops logs --no-color) -join "`n"
  $secretValues = @()
  foreach ($file in 'secrets\app\db.env', 'secrets\app\server.env', 'secrets\restic-password') {
    foreach ($line in Get-Content (Join-Path $data $file)) {
      if ($line -match '^[A-Z_]+_(PASSWORD|SECRET)=(.+)$') { $secretValues += $Matches[2] } elseif ($file -like '*restic-password' -and $line) { $secretValues += $line }
    }
  }
  $leaked = @($secretValues | Where-Object { $logs.Contains($_) })
  Assert-That ($leaked.Count -eq 0) "секреты ($($secretValues.Count) значений) не найдены в журналах контейнеров"
}
finally {
  if (-not $KeepEnvironment) {
    foreach ($name in $project, $checkProject) {
      $compose = Get-ComposeArgs -Project $name -ExtraFiles @($cycle)
      & docker @compose --profile app --profile ops --profile backup down --volumes --remove-orphans 2>&1 | Out-Null
    }
    & docker rmi "homecrm-app:$version" 2>&1 | Out-Null
    Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($failures.Count -gt 0) {
  Write-Host "ПРОВАЛЕНО проверок: $($failures.Count)" -ForegroundColor Red
  exit 1
}
Write-Host 'Все проверки круга пройдены.'
