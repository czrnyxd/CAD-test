<#
  Powrót do poprzedniej wersji BusBar CAD na VPS (dane projektów zostają):
    powershell -ExecutionPolicy Bypass -File deploy\rollback-vps.ps1 -Ip 2.31.1.120
#>
param([string]$Ip = '2.31.1.120', [string]$User = 'root')
$ErrorActionPreference = 'Stop'
$remote = 'set -e; cd /opt/busbar-cad; [ -d src.old ] || { echo "Brak poprzedniej wersji"; exit 1; }; ' +
  'mv src src.broken; mv src.old src; rm -rf src.broken; cd src; docker compose -p busbar-cad up -d --build'
ssh "$($User)@$($Ip)" $remote
if ($LASTEXITCODE -ne 0) { throw 'Cofniecie nie powiodlo sie' }
Write-Host 'Przywrocono poprzednia wersje.'
