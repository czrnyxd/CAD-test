# Wdrożenie na VPS (Hetzner)

Aplikacja i serwer projektów działają w jednym kontenerze Dockera. Kontener słucha tylko na
`127.0.0.1:8090`, więc nie koliduje z innymi usługami na serwerze (np. Friendcord). Na zewnątrz
wystawia go istniejący reverse proxy (Caddy albo nginx) z HTTPS pod osobną subdomeną.

```
tablet ──HTTPS──► reverse proxy (443) ──► 127.0.0.1:8090 ──► kontener busbar-cad
                                                              ├─ aplikacja (pliki z dist/)
                                                              └─ /api – projekty w wolumenie /data
```

## 1. DNS

U dostawcy domeny dodaj rekord **A** dla subdomeny, np. `cad.twojadomena.pl`, wskazujący na IP VPS.

## 2. Kod na serwerze

Repozytorium jest prywatne, więc VPS potrzebuje dostępu tylko do odczytu, najlepiej przez **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/busbar_deploy -N ""
cat ~/.ssh/busbar_deploy.pub   # wklej w GitHub: repo → Settings → Deploy keys → Add (bez "write")
cat >> ~/.ssh/config <<'CFG'
Host github-busbar
  HostName github.com
  IdentityFile ~/.ssh/busbar_deploy
CFG
git clone git@github-busbar:czrnyxd/CAD-test.git ~/busbar-cad
cd ~/busbar-cad
```

## 3. Kod dostępu i start

```bash
cp .env.example .env
sed -i "s/^API_TOKEN=.*/API_TOKEN=$(openssl rand -hex 12)/" .env
cat .env                      # zapisz kod – wpiszesz go na tabletach
docker compose up -d --build
curl -s http://127.0.0.1:8090/api/health   # → {"ok":true,"app":"busbar-cad"}
```

Port 8090 jest zajęty? Zmień `BUSBAR_PORT` w `.env`.

## 4. Reverse proxy

**Caddy** (`/etc/caddy/Caddyfile`, certyfikat HTTPS sam się wystawi):

```
cad.twojadomena.pl {
    encode gzip
    reverse_proxy 127.0.0.1:8090
}
```

Potem `sudo systemctl reload caddy`.

**nginx** (`/etc/nginx/sites-available/busbar-cad`, potem link do `sites-enabled`):

```nginx
server {
    server_name cad.twojadomena.pl;
    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Potem `sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d cad.twojadomena.pl`.

Jeśli Friendcord stoi za Traefikiem albo innym proxy w Dockerze, wystarczy dodać trasę do `127.0.0.1:8090`
(albo dołączyć kontener do sieci proxy) – zasada jest ta sama.

## 5. Tablety

1. Otwórz `https://cad.twojadomena.pl`.
2. **Ustawienia → Serwer – zapis projektów** → wpisz kod dostępu (adres zostaw pusty) → **Połącz**.
3. W przeglądarce wybierz „Dodaj do ekranu głównego”.

Na pasku stanu widać „☁ Zapisano na serwerze 12:03”. Bez internetu aplikacja dalej działa
(„⚠ Offline – zapis lokalny”) i wysyła zmiany, gdy połączenie wróci.

## Aktualizacja

```bash
cd ~/busbar-cad && git pull && docker compose up -d --build
```

Dane są w wolumenie Dockera i przetrwają aktualizację.

## Kopie zapasowe

Projekty to zwykłe pliki JSON. Każda zmiana zostawia poprzednią wersję (`versions/`, 30 ostatnich
na projekt), a usunięte projekty trafiają do `trash/`. Kopia całego katalogu:

```bash
docker cp busbar-cad:/data ~/busbar-backup-$(date +%F)
```

Codziennie o 3:00 (z usuwaniem kopii starszych niż 30 dni), przez `crontab -e`:

```
0 3 * * * docker cp busbar-cad:/data /root/busbar-backups/$(date +\%F) && find /root/busbar-backups -maxdepth 1 -mtime +30 -exec rm -rf {} +
```

(najpierw `mkdir -p /root/busbar-backups`). Przywrócenie projektu: skopiuj plik z `versions/` lub
`trash/` z powrotem do `projects/` w kontenerze (`docker cp`).

## Bez Dockera (opcjonalnie)

Node 20+: `npm ci && npm run build`, potem
`API_TOKEN=... DATA_DIR=/var/lib/busbar PORT=8090 node server/server.mjs` jako usługa systemd.
