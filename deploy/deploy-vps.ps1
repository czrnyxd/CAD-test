<#
  Wdrożenie BusBar CAD na VPS (obok Friendcorda). Uruchom na PC z folderu repozytorium:

    powershell -ExecutionPolicy Bypass -File deploy\deploy-vps.ps1 -Ip 2.31.1.120

  Wysyła ostatni commit (nie niezapisane zmiany), buduje kontener na serwerze i wypisuje kod
  dostępu dla tabletów. Dane projektów (wolumen Dockera) i kod dostępu (.env) zostają przy
  kolejnych wdrożeniach. Wymaga git oraz ssh/scp (wbudowane w Windows 10/11) i klucza SSH do VPS.
#>
param(
  [string]$Ip = '2.31.1.120',
  [string]$User = 'root',
  [int]$Port = 8090
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (git status --porcelain) { Write-Warning 'Masz niezapisane zmiany - wysylany jest ostatni commit.' }
$commit = (git rev-parse --short HEAD).Trim()
$archive = Join-Path $env:TEMP "busbar-cad-$commit.tar.gz"
git archive --format=tar.gz -o $archive HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive nie powiodl sie' }

$target = "$($User)@$($Ip)"
Write-Host "Wysylam wersje $commit na $Ip ..."
scp $archive "$($target):/tmp/busbar-cad.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Wyslanie (scp) nie powiodlo sie' }
Remove-Item $archive

$remote = 'set -e; mkdir -p /opt/busbar-cad; rm -rf /opt/busbar-cad/src.new; mkdir /opt/busbar-cad/src.new; ' +
  'tar -xzf /tmp/busbar-cad.tar.gz -C /opt/busbar-cad/src.new; rm /tmp/busbar-cad.tar.gz; ' +
  "bash /opt/busbar-cad/src.new/deploy/remote-install.sh $Port"
ssh $target $remote
if ($LASTEXITCODE -ne 0) { throw 'Instalacja na serwerze nie powiodla sie (komunikat powyzej)' }

Write-Host ''
Write-Host 'Gotowe. Jesli to pierwsze wdrozenie, dodaj adres do Caddy (docs/DEPLOY.md, sekcja "Twoj VPS").'
