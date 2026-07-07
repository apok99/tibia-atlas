# Deploying the Tibia Atlas API at scale (VPS + Cloudflare)

The application code is written to be production-ready and **driver-agnostic**:
caching, sessions and the queue all go through Laravel's facades, so moving from
the local `database` drivers to Redis in production is **configuration only** —
no code changes. This guide covers turning a fresh VPS into a setup that can
absorb heavy read traffic.

The single biggest lever is **Cloudflare**: every public read endpoint already
emits `Cache-Control` with `s-maxage`, so once a cache rule is in place the CDN
serves the vast majority of requests without ever touching PHP.

---

## 0. Sizing for a 2 GB / 1 vCPU droplet (DigitalOcean s-1vcpu-2gb)

The whole stack (Nginx + PHP-FPM + PostgreSQL + Redis + worker) shares 2 GB, so
**every service must be capped** or a traffic spike OOM-kills the box. With
Cloudflare absorbing cached reads this droplet comfortably serves tens of
thousands of visits/day — but only with these limits in place.

**First, add swap** (a safety net for spikes and the hourly ETL):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10        # prefer RAM, use swap only under pressure
```

Memory budget (leaves headroom + swap):

| Service | Cap | Where |
|---|---|---|
| PostgreSQL | `shared_buffers=256MB` | `postgresql.conf` |
| Redis | `maxmemory 256mb` + `allkeys-lru` | `redis.conf` |
| PHP-FPM | `pm.max_children = 8` (~50 MB each) | FPM pool |
| Worker | `numprocs=1` (1 vCPU — one is enough) | Supervisor |

**PostgreSQL** (`/etc/postgresql/*/main/postgresql.conf`) — modest because it
shares the box; PgBouncer (§9) handles concurrency, not a big connection pool:

```ini
shared_buffers = 256MB
effective_cache_size = 768MB
work_mem = 8MB
maintenance_work_mem = 64MB
max_connections = 50
```

**PHP-FPM pool** (`/etc/php/8.4/fpm/pool.d/www.conf`):

```ini
pm = dynamic
pm.max_children = 8        ; hard ceiling: 8 × ~50MB ≈ 400MB
pm.start_servers = 2
pm.min_spare_servers = 2
pm.max_spare_servers = 4
pm.max_requests = 500      ; recycle workers to bound memory leaks
```

> Upgrading later to 2 vCPU / 4 GB ($24) is a no-downtime resize in the DO panel
> — then raise `pm.max_children` to ~16, `shared_buffers` to 512MB, worker
> `numprocs` to 2.

## 1. System packages

```bash
# PHP 8.4 + the extensions the app uses
sudo apt install php8.4-fpm php8.4-cli php8.4-pgsql php8.4-mbstring \
  php8.4-curl php8.4-intl php8.4-zip php8.4-gd php8.4-redis \
  postgresql redis-server nginx supervisor

php -m | grep -E 'redis|pdo_pgsql'   # confirm ext-redis + pgsql are loaded
```

## 2. App setup

```bash
cp .env.production.example .env       # then edit secrets
php artisan key:generate
composer install --no-dev --optimize-autoloader
php artisan migrate --force

# Cache compiled config/routes/events/views (re-run on every deploy):
php artisan config:cache
php artisan route:cache
php artisan event:cache
php artisan view:cache
```

> Re-run the four `*:cache` commands after **every** deploy. `config:cache`
> means `.env` is only read once — never call `env()` outside config files.

## 3. OPcache (config/php.ini for FPM)

```ini
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0        ; never re-stat files in prod; reload FPM on deploy
opcache.jit=1255
opcache.jit_buffer_size=128M
realpath_cache_size=4096K
```

Reload PHP-FPM after each deploy so `validate_timestamps=0` picks up new code:
`sudo systemctl reload php8.4-fpm`.

## 4. Redis

Already wired via `.env` (`CACHE_STORE`/`SESSION_DRIVER`/`QUEUE_CONNECTION=redis`).
Harden it: `bind 127.0.0.1`, set `requirepass`, and `maxmemory-policy allkeys-lru`
so the cache can't OOM the box.

## 5. Queue worker (Supervisor)

View counting and the imports/ETL run on the queue. Keep a worker alive:

```ini
# /etc/supervisor/conf.d/tibia-worker.conf
[program:tibia-worker]
command=php /var/www/tibia/backend/artisan queue:work redis --sleep=1 --tries=3 --max-time=3600
autostart=true
autorestart=true
numprocs=1            ; 1 vCPU → one worker; raise to 2 after a 4 GB upgrade
user=www-data
stopwaitsecs=3600
```

```bash
sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl start tibia-worker:*
```

After each deploy run `php artisan queue:restart` so workers reload new code.

## 6. Scheduler (cron)

The hourly killstats ETL and the daily `entry_views` prune live in
`routes/console.php`. One cron line drives them all:

```cron
* * * * * cd /var/www/tibia/backend && php artisan schedule:run >> /dev/null 2>&1
```

(The Windows Task Scheduler job described in the project notes is the dev-only
equivalent.)

## 7. Trusted proxies (so rate limiting sees the real IP)

Behind Cloudflare, `$request->ip()` is the edge IP unless proxies are trusted.
In `bootstrap/app.php`, inside `->withMiddleware(...)`:

```php
$middleware->trustProxies(at: '*', headers:
    Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO);
```

Ideally restrict `at:` to Cloudflare's published IP ranges instead of `*`.
Without this, the per-IP `public` throttle and the `login` limiter key
everyone behind one IP.

## 8. Cloudflare cache rule (the big win)

By default Cloudflare does **not** cache `/api/*` JSON. Add a Cache Rule:

- **Match:** `Hostname eq "api.tibiaatlas.example"` and URI path starts with `/api/`
- **Then:** *Eligible for cache* + *Respect origin TTL* (honours our `s-maxage`).

The app sends `no-store`-style freshness on `/entries/random`, `/entries/trending`
and `/entries/{slug}` (the latter to keep view counts accurate), so those stay
dynamic while glossary/facets/spawns/books/killstats/listings get edge-cached.
A content edit bumps the in-app content version (instant origin refresh); the
CDN copies expire on their short `s-maxage`. For immediate global purge, call
the Cloudflare purge API from a deploy hook if needed.

## 9. PgBouncer (connection pooling)

PHP-FPM opens a Postgres connection per worker; under load that exhausts
`max_connections`. Run PgBouncer in `transaction` mode on `:6432` and point
`DB_PORT` at it (already set in the template).

## 10. Post-deploy smoke check

```bash
curl -sI https://api.tibiaatlas.example/api/glossary | grep -i cache-control
# expect: cache-control: public, max-age=120, s-maxage=600
php artisan about        # confirm env=production, debug=off, cache=redis, queue=redis
php artisan queue:work --once   # confirm a job processes
```

## 11. Frontend static assets (avoid stale-chunk 404s)

Vite emits content-hashed files (`assets/ItemsPage-XXXX.js`). Two things go
wrong after a deploy if the server isn't configured for that:

1. A cached/stale `index.html` references old hashes that were just deleted →
   `Failed to fetch dynamically imported module` (404). The app now reloads
   itself once on `vite:preloadError` as a safety net, but the server must
   still serve the right headers.
2. Hashed assets get re-downloaded needlessly if they aren't marked immutable.

**Nginx** for the frontend site:

```nginx
# index.html must never be cached — it's the pointer to the current hashes.
location = /index.html {
    add_header Cache-Control "no-cache";
}

# Hashed assets never change content under the same name: cache forever.
location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# SPA fallback
location / {
    try_files $uri $uri/ /index.html;
}
```

**Cloudflare:** make sure no cache rule / "Cache Everything" applies to
`index.html` (or purge it on deploy). The `/assets/` rule can be cached freely.

**Deploy order:** copy the new `dist/assets/*` onto the server *before*
replacing `index.html`, and don't delete the previous deploy's assets right
away (keep one or two old releases) — tabs opened before the deploy still
request old chunk names until they reload.

---

### One-time vs every-deploy

| Every deploy | One-time setup |
|---|---|
| `composer install --no-dev` | install packages, ext-redis, PgBouncer |
| `migrate --force` | Supervisor worker config |
| `config/route/event/view:cache` | cron `schedule:run` line |
| `queue:restart` | Cloudflare cache rule |
| reload php-fpm | trusted proxies in `bootstrap/app.php` |
| | `php artisan storage:link` (once — exposes `storage/app/public` at `/storage`; the mirrored entry sprites live under `storage/app/public/sprites`) |
| | `php artisan tibia:backfill-item-stats` (once — fills `meta.item_subcategory`, `bonuses`, `resists`, `atk_mod`/`hit_mod` and `charges` for all equippable items; the loadout configurator scores gear with these. New imports capture them automatically) |
| | `php artisan tibia:mirror-images` (once — downloads every off-site entry sprite from tibia.fandom.com onto the public disk and repoints `primary_image` at the local copy so the site never hotlinks fandom. ~11k images; needs the `curl` binary. Requires `APP_URL` to be the final public API URL so the stored URLs are correct. The daily scheduled run then mirrors only new/refreshed images. Behind Cloudflare, `/storage/*` is cached at the edge) |
