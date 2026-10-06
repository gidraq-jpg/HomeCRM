#Requires -Version 7
# Сохраняет ключ доступа Cloudflare (API token) для записей DNS в E:\HomeCRM-data\secrets\cloudflare.env.
# Ключ вводится в консоли скрытно, на экран и в журналы не попадает. Агент читает файл только из своих
# скриптов и сам ключ не печатает. Права ключа: Zone → DNS → Edit, только для зоны gidraq.link.
param(
  [string]$DataDir = 'E:\HomeCRM-data'
)
$ErrorActionPreference = 'Stop'

$file = Join-Path $DataDir 'secrets\cloudflare.env'
New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null

$secure = Read-Host -AsSecureString 'Вставьте ключ Cloudflare (символы не отображаются) и нажмите Enter'
$token = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if ($token.Length -lt 20) { throw 'Ключ слишком короткий — похоже, он не вставился.' }

# Проверка ключа у Cloudflare: ответ показывает только «действует» или нет.
$check = Invoke-RestMethod -Uri 'https://api.cloudflare.com/client/v4/user/tokens/verify' `
  -Headers @{ Authorization = "Bearer $token" } -SkipHttpErrorCheck
if (-not $check.success) { throw 'Cloudflare не принял ключ. Проверьте, что он скопирован целиком.' }

Set-Content -Path $file -Value "CLOUDFLARE_API_TOKEN=$token" -NoNewline
Write-Host "Ключ действует и сохранён в $file."
