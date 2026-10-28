#Requires -Version 7
<#
.SYNOPSIS
  Тест полного круга: окружение, копия перед миграцией, копия, потеря базы, восстановление, проверка (R0.11).

.DESCRIPTION
  Всё в своём compose-проекте homecrm-test-<ветка>-ops и во временной папке вместо E:\HomeCRM-data.
  Рабочий проект `homecrm`, его тома и порты 8300, 8301, 8309 не затрагиваются. Настоящих ключей нет,
  настоящего Яндекса тоже. Пароли генерируются на лету.
  Нужен запущенный Docker Desktop. После теста контейнеры, тома, сеть, образ и папка удаляются.

  «Облако» (-Cloud):
    webdav (по умолчанию, ADR-0047) — `rclone serve webdav` в отдельном контейнере вместо webdav.yandex.ru.
      Шаги 1–2 идут через «прежнее» подключение (rclone типа local, как REST API до 11 октября), затем
      connect-yandex-disk.ps1 -WebDav переключает копии на WebDAV по той же папке: прежние снимки видны,
      прежнее подключение удалено, расписание копий пересоздано с новым адресом.
    local — rclone-подключение типа local, без WebDAV.

  Что проверяется:
    1. выпуск «прошлой версии» (без последней миграции), /health с базой;
    2. выпуск новой версии: перед миграцией делается копия (DATA-4) в оба хранилища;
       (webdav) переключение на WebDAV: прежние снимки читаются по WebDAV;
    3. копия данных: дамп и файлы в оба хранилища (restic, local и rclone);
    4. база и том удалены, восстановление из «облака», данные на месте, /health ок;
    5. проверка восстановления по обоим хранилищам в отдельном проекте;
    6. сбой восстановления: текст данных не попадает в журнал;
    7. (webdav) неверный пароль приложения: причина HTTP 401 в журнале, статусе и backup-status.ps1,
       служебная команда прерывается своим тайм-аутом, а не ждёт 15 минут повторов restic.

.EXAMPLE
  pwsh deploy/test/backup-cycle.ps1
  pwsh deploy/test/backup-cycle.ps1 -Cloud local -Project homecrm-test-local-ops
#>
param(
  [int]$Port = 18330,
  [ValidateSet('webdav', 'local')][string]$Cloud = 'webdav',
  # Имя compose-проекта; по умолчанию homecrm-test-<ветка>-ops.
  [string]$Project,
  [switch]$KeepEnvironment
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$scripts = Join-Path $here '..\scripts'
. (Join-Path $scripts 'ops-common.ps1')

if ($Project) { $project = $Project }
else {
  $branch = (git -C $script:RepoRoot rev-parse --abbrev-ref HEAD).Trim()
  $slug = ($branch.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  $project = "homecrm-test-$slug-ops"
}
$checkProject = "$project-check"
if ($project -eq 'homecrm' -or $project -notmatch '^homecrm-test-[a-z0-9-]+$') { throw 'Имя тестового проекта выбрано неверно.' }

$data = Join-Path $env:TEMP "homecrm-test-ops-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
$version = 'test-ops'
$env:HOMECRM_VERSION = $version
$env:HOMECRM_APP_PORT = "$Port"
# Все дополнительные compose-файлы теста: монтирование «облака» и, для WebDAV, внешняя сеть сервера.
$cycleFiles = @((Resolve-Path (Join-Path $here 'compose.cycle.yaml')).Path)
$webDavNetwork = "$project-webdav"
$webDavServer = "$project-webdav"
$webDavUser = 'test-family'
$webDavPassword = [System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)).ToLowerInvariant()
if ($Cloud -eq 'webdav') {
  $cycleFiles += (Resolve-Path (Join-Path $here 'compose.webdav.yaml')).Path
  $env:HOMECRM_TEST_WEBDAV_NETWORK = $webDavNetwork
}
$cycle = $cycleFiles
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
  (& docker @compose --profile app --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts snapshots --from $Repo) -join "`n"
}

try {
  Write-Host "Проект $project, данные $data"
  New-Item -ItemType Directory -Force $data, (Join-Path $data 'cloud') | Out-Null
  $env:HOMECRM_DATA = $data -replace '\\', '/'

  # --- Секреты и «облако» -------------------------------------------------------------------------
  & (Join-Path $scripts 'new-app-secrets.ps1') -DataDir $data -BaseUrl "http://127.0.0.1:$Port" | Out-Null
  $backupEnv = Join-Path $data 'secrets\backup.env'
  if ($Cloud -eq 'webdav') {
    # «Прежнее» подключение — как yadisk до 11 октября; та же папка потом открывается по WebDAV.
    Write-TextFile (Join-Path $data 'secrets\rclone\rclone.conf') "[yadisk]`ntype = local`n"
    Write-TextFile $backupEnv ((Get-Content $backupEnv -Raw) + "BACKUP_CLOUD_REPOSITORY=rclone:yadisk:/cloud/HomeCRM-backups`n")
    & docker network create $webDavNetwork | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать сеть для WebDAV-сервера.' }
    # Корень WebDAV — та же папка, что /cloud в контейнерах: yadisk-webdav:HomeCRM-backups = /cloud/HomeCRM-backups.
    & docker run -d --name $webDavServer --network $webDavNetwork -v "$(Join-Path $data 'cloud'):/data" `
      -e "RCLONE_USER=$webDavUser" -e "RCLONE_PASS=$webDavPassword" `
      rclone/rclone:1.70.3 serve webdav /data --addr :8080 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить WebDAV-сервер.' }
  }
  else {
    Write-TextFile (Join-Path $data 'secrets\rclone\rclone.conf') "[cloud-test]`ntype = local`n"
    Write-TextFile $backupEnv ((Get-Content $backupEnv -Raw) + "BACKUP_CLOUD_REPOSITORY=rclone:cloud-test:/cloud/restic`n")
  }

  # Каталог миграций «прошлой версии»: без последней записи журнала.
  $migrations = Join-Path $script:RepoRoot 'packages\db\migrations'
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
  & (Join-Path $scripts 'release.ps1') -Version $version -DataDir $data -Project $project -Port $Port -ExtraComposeFiles (@($cycle) + $oldMigrations)
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

  if ($Cloud -eq 'webdav') {
    Write-Host '== 2b. Переключение на WebDAV: connect-yandex-disk.ps1 -WebDav'
    # Расписание копий запущено, как в рабочем окружении; отметка проверки свежая, чтобы оно не начало restic check.
    $statusFile = Join-Path $data 'backups\status\backup.json'
    $status = Get-Content $statusFile -Raw | ConvertFrom-Json
    $status | Add-Member -NotePropertyName lastCheckAt -NotePropertyValue ([datetime]::UtcNow.ToString('o')) -Force
    $status | Add-Member -NotePropertyName lastCheckOk -NotePropertyValue $true -Force
    Write-TextFile $statusFile ($status | ConvertTo-Json -Depth 10)
    $compose = Get-ComposeArgs -Project $project -ExtraFiles @($cycle)
    Invoke-Docker @compose --profile app --profile backup up -d --no-deps backup

    # rclone «на компьютере владельца» — из образа rclone/rclone в сети WebDAV-сервера; путь к rclone.conf
    # подменяется на путь внутри контейнера. Функция с именем rclone имеет приоритет над программой.
    $hostConfig = Join-Path $data 'secrets\rclone\rclone.conf'
    $rcloneDir = Join-Path $data 'secrets\rclone'
    # Без GetNewClosure: в замыкании код выхода docker не доходит до вызывающего скрипта.
    $global:HomecrmTestRclone = @{ Config = $hostConfig; Dir = $rcloneDir; Network = $webDavNetwork }
    function global:rclone {
      $shim = $global:HomecrmTestRclone
      $mapped = @($args | ForEach-Object { if ("$_" -eq $shim.Config) { '/cfg/rclone.conf' } else { $_ } })
      $input | & docker run --rm -i --network $shim.Network -v "$($shim.Dir):/cfg" rclone/rclone:1.70.3 @mapped
    }
    $credential = [pscredential]::new($webDavUser, (ConvertTo-SecureString $webDavPassword -AsPlainText -Force))
    $connectOutput = & {
      try {
        & (Join-Path $scripts 'connect-yandex-disk.ps1') -WebDav -Credential $credential -WebDavUrl "http://${webDavServer}:8080" `
          -DataDir $data -Project $project -ExtraComposeFiles $cycle
        'CONNECT-OK'
      }
      catch { "CONNECT-FAILED: $($_.Exception.Message)" }
    } *>&1 | Out-String
    Write-Host $connectOutput
    Assert-That ($connectOutput -match 'CONNECT-OK') 'connect-yandex-disk.ps1 -WebDav завершился успешно'
    Assert-That (-not $connectOutput.Contains($webDavPassword)) 'пароль приложения не напечатан'
    $rcloneConf = Get-Content $hostConfig -Raw
    Assert-That (-not $rcloneConf.Contains($webDavPassword)) 'в rclone.conf пароль только в виде rclone obscure'
    Assert-That ($rcloneConf -match '(?m)^\[yadisk-webdav\]$' -and $rcloneConf -match '(?m)^type = webdav$' -and $rcloneConf -match '(?m)^vendor = other$') 'в rclone.conf есть подключение yadisk-webdav (webdav, vendor other)'
    Assert-That ($rcloneConf -notmatch '(?m)^\[yadisk\]$') 'прежнее подключение yadisk удалено после удачной проверки'
    Assert-That ((Get-EnvSetting $backupEnv 'BACKUP_CLOUD_REPOSITORY') -eq 'rclone:yadisk-webdav:HomeCRM-backups') 'адрес хранилища — rclone:yadisk-webdav:HomeCRM-backups'
    Assert-That ((Get-Snapshots 'cloud') -match 'pre-migration') 'прежний снимок pre-migration виден по WebDAV'
    $schedulerId = "$(& docker @compose --profile app --profile backup ps -q backup)".Trim()
    $schedulerEnv = if ($schedulerId) { (& docker inspect -f '{{json .Config.Env}}' $schedulerId) -join '' } else { '' }
    Assert-That ($schedulerEnv.Contains('BACKUP_CLOUD_REPOSITORY=rclone:yadisk-webdav:HomeCRM-backups')) 'расписание копий пересоздано с адресом WebDAV'
    Invoke-Docker @compose --profile app --profile backup stop backup

    # Неверный пароль: подключение не меняется, причина — понятным текстом.
    $wrong = [pscredential]::new($webDavUser, (ConvertTo-SecureString 'wrong-app-password' -AsPlainText -Force))
    $badOutput = & {
      try {
        & (Join-Path $scripts 'connect-yandex-disk.ps1') -WebDav -Remote 'yadisk-bad' -Credential $wrong -WebDavUrl "http://${webDavServer}:8080" `
          -DataDir $data -Project $project -ExtraComposeFiles $cycle
        'CONNECT-OK'
      }
      catch { "CONNECT-FAILED: $($_.Exception.Message)" }
    } *>&1 | Out-String
    Assert-That ($badOutput -match 'CONNECT-FAILED: Яндекс не принял логин или пароль приложения') 'неверный пароль приложения: понятная причина'
    Assert-That ((Get-Content $hostConfig -Raw) -eq $rcloneConf) 'неверный пароль: rclone.conf не изменился'
    Assert-That ((Get-EnvSetting $backupEnv 'BACKUP_CLOUD_REPOSITORY') -eq 'rclone:yadisk-webdav:HomeCRM-backups') 'неверный пароль: адрес хранилища прежний'
    Remove-Item function:global:rclone
  }

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
  $householdsBefore = Invoke-Psql 'select count(*) from spaces'
  Assert-That ([int]$accountsBefore -ge 1 -and [int]$householdsBefore -ge 1) "в базе есть данные: пространств $householdsBefore, учётных записей $accountsBefore"
  # Строка с «чувствительным» маркером и ограничение, которое проваливает восстановление, когда задан
  # параметр ops.inject_failure: так проверяется, что текст строки из ошибки COPY не попадает в журнал и статус.
  $marker = 'SECRET-MARKER-' + [guid]::NewGuid().ToString('n')
  [void](Invoke-Psql "create table public.ops_marker_probe (id int primary key, note text, constraint ops_inject check (current_setting('ops.inject_failure', true) is distinct from '1')); insert into public.ops_marker_probe values (1, '$marker')")
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
  Assert-That ((Invoke-Psql 'select count(*) from spaces') -eq $householdsBefore) 'пространства на месте'
  $files = & docker @compose --profile app exec -T app node -e "console.log(require('node:fs').statSync('/data/files/probe.bin').size)"
  Assert-That (($files -join '').Trim() -eq '4096') 'файл приложения восстановлен'
  Assert-That ((Get-Health).database -eq 'ok') '/health: база отвечает'

  # Копии есть, а восстановление ещё не проверено: состояние не должно считаться исправным (DATA-3).
  & (Join-Path $scripts 'backup-status.ps1') -DataDir $data | Out-Null
  Assert-That ($LASTEXITCODE -eq 1) 'backup-status.ps1: без проверки восстановления состояние не «в порядке» (код 1)'

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

  # --- 6. Сбой восстановления: текст строки данных не попадает в журнал и статус ------------------
  Write-Host '== 6. Сбой восстановления с маркером в данных'
  $checkCompose = Get-ComposeArgs -Project $checkProject -ExtraFiles @($cycle)
  & docker @checkCompose --profile app --profile ops down --volumes --remove-orphans 2>&1 | Out-Null
  $failOutput = & docker @checkCompose --profile app --profile ops run --rm -T -e BACKUP_ENABLED=0 -e 'PGOPTIONS=-c ops.inject_failure=1' ops node apps/server/src/ops/cli.ts restore --check --from local 2>&1 | Out-String
  $failCode = $LASTEXITCODE
  & docker @checkCompose --profile app --profile ops down --volumes --remove-orphans 2>&1 | Out-Null
  Assert-That ($failCode -ne 0) 'восстановление с внедрённым сбоем завершилось ошибкой'
  if ($failOutput -notmatch 'pg_restore failed at restore') { Write-Host $failOutput.Substring(0, [Math]::Min(1500, $failOutput.Length)) }
  Assert-That ($failOutput -match 'pg_restore failed at restore \(exit code') 'в журнале — этап и код выхода pg_restore'
  Assert-That (-not $failOutput.Contains($marker)) 'маркера из данных нет в журнале (stdout и stderr)'
  $failStatus = Get-Content (Join-Path $data 'backups\status\restore-check-local.json') -Raw
  Assert-That (-not $failStatus.Contains($marker)) 'маркера из данных нет в отметке restore-check-local.json'
  Assert-That (($failStatus | ConvertFrom-Json).ok -eq $false) 'отметка проверки показывает неудачу'
  & (Join-Path $scripts 'backup-status.ps1') -DataDir $data | Out-Null
  Assert-That ($LASTEXITCODE -eq 1) 'backup-status.ps1: после неудачной проверки восстановления — код 1'

  # --- 7. WebDAV: неверный пароль — причина и тайм-аут -------------------------------------------
  if ($Cloud -eq 'webdav') {
    Write-Host '== 7. Неверный пароль приложения: причина в журнале и статусе, свой тайм-аут'
    $obscuredWrong = ('wrong-app-password' | & docker run --rm -i rclone/rclone:1.70.3 obscure -) -join ''
    $conf = Join-Path $data 'secrets\rclone\rclone.conf'
    Write-TextFile $conf ((Get-Content $conf -Raw).TrimEnd() + "`n`n[yadisk-wrong]`ntype = webdav`nurl = http://${webDavServer}:8080`nvendor = other`nuser = $webDavUser`npass = $obscuredWrong`n")
    $wrongRepo = @('-e', 'BACKUP_CLOUD_REPOSITORY=rclone:yadisk-wrong:HomeCRM-backups', '-e', 'BACKUP_CLOUD_COMMAND_TIMEOUT_SECONDS=20', '-e', 'BACKUP_CLOUD_BACKUP_TIMEOUT_SECONDS=20')
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $wrongOutput = & docker @compose --profile app --profile ops run --rm -T --no-deps @wrongRepo ops node apps/server/src/ops/cli.ts snapshots --from cloud 2>&1 | Out-String
    $wrongCode = $LASTEXITCODE
    $watch.Stop()
    Write-Host ($wrongOutput.Trim() -split "`n" | Select-Object -Last 3 | Out-String)
    Assert-That ($wrongCode -ne 0) 'snapshots с неверным паролем завершился ошибкой'
    Assert-That ($wrongOutput -match 'HTTP 401: login or app password rejected') 'в журнале — причина HTTP 401'
    Assert-That ($watch.Elapsed.TotalSeconds -lt 90) "служебная команда завершилась за $([int]$watch.Elapsed.TotalSeconds) с (не дольше своего тайм-аута 20 с, без 15 минут повторов restic)"
    Assert-That (-not $wrongOutput.Contains('wrong-app-password') -and -not $wrongOutput.Contains($obscuredWrong)) 'пароль не попал в журнал'

    & docker @compose --profile app --profile ops run --rm -T @wrongRepo ops node apps/server/src/ops/cli.ts backup 2>&1 | Out-Null
    Assert-That ($LASTEXITCODE -ne 0) 'копия с неверным паролем облака — неудача'
    $status = Read-Status 'backup.json'
    Assert-That ($status.repos.local.ok -and $status.repos.cloud.error -match 'HTTP 401') "в статусе облака причина: $($status.repos.cloud.error)"
    $statusOutput = & (Join-Path $scripts 'backup-status.ps1') -DataDir $data -Project $project -ExtraComposeFiles $cycle *>&1 | Out-String
    Assert-That ($statusOutput -match 'Причина: Яндекс не принял логин или пароль приложения') 'backup-status.ps1 показывает причину по-русски'
  }

  # --- Секреты не в журналах ---------------------------------------------------------------------
  $logs = (& docker @compose --profile app --profile ops logs --no-color) -join "`n"
  $secretValues = @()
  foreach ($file in 'secrets\app\db.env', 'secrets\app\server.env', 'secrets\restic-password') {
    foreach ($line in Get-Content (Join-Path $data $file)) {
      if ($line -match '^[A-Z_]+_(PASSWORD|SECRET)=(.+)$') { $secretValues += $Matches[2] } elseif ($file -like '*restic-password' -and $line) { $secretValues += $line }
    }
  }
  $secretValues += $marker
  if ($Cloud -eq 'webdav') { $secretValues += $webDavPassword }
  $leaked = @($secretValues | Where-Object { $logs.Contains($_) })
  Assert-That ($leaked.Count -eq 0) "секреты ($($secretValues.Count) значений) не найдены в журналах контейнеров"
}
finally {
  if (-not $KeepEnvironment) {
    # Только свои проекты, по имени: файлы окружения для этого не нужны.
    foreach ($name in $project, $checkProject) {
      & docker compose -p $name down --volumes --remove-orphans 2>&1 | Out-Null
    }
    if ($Cloud -eq 'webdav') {
      & docker rm -f $webDavServer 2>&1 | Out-Null
      & docker network rm $webDavNetwork 2>&1 | Out-Null
    }
    & docker rmi "homecrm-app:$version" 2>&1 | Out-Null
    Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item function:global:rclone -ErrorAction SilentlyContinue
  Remove-Variable HomecrmTestRclone -Scope Global -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
  Write-Host "ПРОВАЛЕНО проверок: $($failures.Count)" -ForegroundColor Red
  exit 1
}
Write-Host 'Все проверки круга пройдены.'
