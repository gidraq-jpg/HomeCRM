#Requires -Version 7
# Общее для скриптов эксплуатации (R0.11): аргументы docker compose и проверки. Подключается точкой:
#   . "$PSScriptRoot\ops-common.ps1"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Аргументы docker compose: проект, файл окружения, основной compose-файл и дополнительные.
function Get-ComposeArgs {
  param(
    [string]$Project,
    [string]$EnvFile,
    [string[]]$ExtraFiles = @()
  )
  $result = @('compose')
  if ($Project) { $result += @('-p', $Project) }
  if ($EnvFile) { $result += @('--env-file', $EnvFile) }
  $result += @('-f', (Join-Path $script:RepoRoot 'deploy\compose.yaml'))
  foreach ($file in $ExtraFiles) { $result += @('-f', $file) }
  return $result
}

# Запускает docker и останавливается при ошибке. Вывод передаётся как есть; секретов в нём нет:
# контейнеры их не печатают (ADR-0021).
function Invoke-Docker {
  # Простая функция без param: ключи вроде -e и -T попадают в $args как обычные строки.
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args[0..2] -join ' ') ... завершился с кодом $LASTEXITCODE" }
}

# Только чтение каталога PostgreSQL в уже запущенном контейнере. Каждый вызов ограничен по времени;
# вывод psql (включая ошибки) не печатается. Проверка идёт по локальному сокету, без секретов в аргументах.
function Test-FirstDatabase {
  param([string[]]$Compose, [int]$TimeoutMilliseconds)
  $start = [System.Diagnostics.ProcessStartInfo]::new('docker')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in ($Compose + @('--profile', 'app', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "select 1 from pg_database where datname = 'homecrm'"))) {
    $start.ArgumentList.Add($argument)
  }
  $probe = [System.Diagnostics.Process]::new()
  $probe.StartInfo = $start
  $started = $false
  try {
    [void]$probe.Start()
    $started = $true
    $output = $probe.StandardOutput.ReadToEndAsync()
    $errors = $probe.StandardError.ReadToEndAsync()
    if (-not $probe.WaitForExit($TimeoutMilliseconds)) { return $false }
    return $probe.ExitCode -eq 0 -and $output.GetAwaiter().GetResult().Trim() -eq '1'
  }
  catch [System.ComponentModel.Win32Exception] { return $false }
  finally {
    if ($started -and -not $probe.HasExited) { $probe.Kill($true) }
    $probe.Dispose()
  }
}

# До первой копии не запускаем ops, который ждёт ещё не созданную базу. Успешная копия означает,
# что первое включение уже было: восстановление и просмотр копий доступны и при потере исходной базы.
function Wait-FirstDatabase {
  [CmdletBinding()]
  param(
    [string]$DataDir,
    [string[]]$Compose,
    [ValidateRange(1, 120)][int]$TimeoutSeconds = 90
  )
  $backupFile = Join-Path $DataDir 'backups/status/backup.json'
  if ((Test-Path $backupFile) -and (Get-Content $backupFile -Raw | ConvertFrom-Json).lastSuccessAt) { return }
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $remaining = [int][Math]::Ceiling($TimeoutSeconds * 1000 - $watch.Elapsed.TotalMilliseconds)
    if (Test-FirstDatabase -Compose $Compose -TimeoutMilliseconds ([Math]::Min(5000, $remaining))) { return }
    $remaining = [int][Math]::Ceiling($TimeoutSeconds * 1000 - $watch.Elapsed.TotalMilliseconds)
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(2000, $remaining)) }
  }
  throw 'База ещё не создана — сначала первое включение (runbook, раздел 7)'
}

# Значение настройки из файла окружения (не секретной); пусто, если строки нет или она закомментирована.
function Get-EnvSetting {
  param([string]$File, [string]$Name)
  if (-not (Test-Path $File)) { return $null }
  foreach ($line in Get-Content $File) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") { return $Matches[1].Trim() }
  }
  return $null
}

function Write-TextFile {
  param([string]$Path, [string]$Text)
  New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
  [System.IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
}

# Время из отметки (ISO, UTC) как DateTime в UTC. ConvertFrom-Json сам превращает такие строки в даты,
# и без явного приведения к UTC возраст отметки сдвигается на часовой пояс компьютера.
function ConvertTo-UtcDate {
  param($Value)
  if ($Value -is [datetime]) {
    if ($Value.Kind -eq [System.DateTimeKind]::Unspecified) { return [datetime]::SpecifyKind($Value, [System.DateTimeKind]::Utc) }
    return $Value.ToUniversalTime()
  }
  return [datetime]::Parse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

function Get-AgeSpan {
  param($Value)
  return ([datetime]::UtcNow - (ConvertTo-UtcDate $Value))
}

# Скрывает значения секретов в строке вывода rclone: после слов token, secret, password, key и client_id
# (в JSON — "access_token":"…", и в виде ключ = значение — token = {…}, --client-secret=…) остаётся ***.
# Остальной текст не трогается: по нему видно, что случилось.
function Hide-RcloneSecrets {
  param([string]$Line)
  $words = '(?:token|secret|password|key|client_id)'
  # JSON: "имя с одним из слов": "значение"
  $Line = [regex]::Replace($Line, "(?i)(`"[^`"\\]*$words[^`"\\]*`"\s*:\s*)`"(?:[^`"\\]|\\.)*`"", '$1"***"')
  # ключ = значение до конца строки (значением может быть и целый JSON)
  $Line = [regex]::Replace($Line, "(?i)(\b[\w.-]*$words[\w.-]*\s*=\s*)\S.*`$", '$1***')
  # Одноразовые параметры входа в адресе: ?state=…&code=…
  $Line = [regex]::Replace($Line, '(?i)([?&](?:state|code)=)[^&\s]+', '$1***')
  return $Line
}

# Запуск rclone с очисткой вывода: rclone способен печатать токен и ключи (config create выводит весь
# конфиг, ошибки приводят справку). Строки выводятся целиком, чтобы была видна причина ошибки, но
# значения секретов заменяются на *** (Hide-RcloneSecrets). Код выхода сохраняется в $LASTEXITCODE.
function Invoke-RcloneFiltered {
  & rclone @args 2>&1 | ForEach-Object { Write-Host (Hide-RcloneSecrets "$_") }
}

# Создаёт подключение rclone. --no-output: rclone не печатает получившийся конфиг (в нём токен).
# -AutoConfirm: ответы по умолчанию (для OAuth — вход через браузер этого компьютера).
function New-RcloneRemote {
  param([string]$Name, [string]$Type, [string]$Config, [string[]]$Options = @(), [switch]$AutoConfirm)
  $extra = if ($AutoConfirm) { @('--auto-confirm') } else { @() }
  Invoke-RcloneFiltered config create $Name $Type @Options --config $Config --no-output @extra
  if ($LASTEXITCODE -ne 0) { throw 'rclone не смог создать подключение.' }
}
