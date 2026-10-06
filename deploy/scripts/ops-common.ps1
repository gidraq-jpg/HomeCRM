#Requires -Version 7
# Общее для скриптов эксплуатации (R0.11): аргументы docker compose и проверки. Подключается точкой:
#   . "$PSScriptRoot\ops-common.ps1"

$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

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
  $result += @('-f', (Join-Path $script:Repo 'deploy\compose.yaml'))
  foreach ($file in $ExtraFiles) { $result += @('-f', $file) }
  return $result
}

# Запускает docker и останавливается при ошибке. Вывод передаётся как есть; секретов в нём нет:
# контейнеры их не печатают (ADR-0020).
function Invoke-Docker {
  # Простая функция без param: ключи вроде -e и -T попадают в $args как обычные строки.
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args[0..2] -join ' ') ... завершился с кодом $LASTEXITCODE" }
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
