# Kill Statistics ETL (TibiaData)

Pipeline that pulls kill statistics from the [TibiaData API](https://api.tibiadata.com)
for **every** game world and accumulates them so we can chart how many players
each creature kills (and how many of each creature players kill) over time.

## Why we snapshot daily

The TibiaData API only exposes **rolling windows**:

| Field | Meaning |
|-------|---------|
| `last_day_players_killed`  | players this creature killed in the last 24h |
| `last_day_killed`          | this creature killed by players in the last 24h |
| `last_week_players_killed` | …last 7 days |
| `last_week_killed`         | …last 7 days |

There is **no historic / monthly / annual endpoint**. To build monthly and
annual charts we snapshot the *daily* window once per day and accumulate. The
history only grows from the day we start — the past cannot be back-filled.

## Data model (`2026_06_28_100000_create_killstats_tables`)

- `tibia_worlds` — dimension, one row per world (refreshed each run from `/v4/worlds`).
- `tibia_races` — dimension, one row per killable race; optionally linked to a
  lore `entries` row by matching the English name (`entry_id`).
- `kill_daily` — raw daily snapshot per world+race. **Pruned to the last 30 days.**
- `kill_monthly` — per-month rollup (sum of the daily windows). **Kept forever** —
  this powers the monthly/annual graphs.

The monthly rollup uses `GREATEST(...)` on upsert: within a month the running
total only grows as more days fold in, so taking the max across runs means
pruning the raw daily rows can never corrupt an already-accumulated month.

## Running it

```bash
php artisan tibia:etl-killstats                  # all online worlds, today
php artisan tibia:etl-killstats --worlds=Antica,Secura
php artisan tibia:etl-killstats --date=2026-06-27 --sleep=400
php artisan tibia:etl-killstats --no-prune       # keep all daily rows
```

Options: `--worlds=`, `--date=`, `--sleep=` (ms between world requests, be polite),
`--keep-days=30`, `--no-prune`.

Override the API base with `TIBIADATA_BASE_URL` in `.env` if needed.

## Scheduling (runs hourly, overwrites today's row)

The Laravel scheduler entry is registered in `routes/console.php` as `hourly()`
(`0 * * * *`). Each run **overwrites** today's snapshot (upsert on
world+race+date) with the freshest last-24h window, so the day's numbers stay
current; the monthly rollup keeps the running max so accumulated history isn't
lost when the daily row is overwritten or pruned.

A Windows Task Scheduler job named **"TibiaAtlas Scheduler"** is already
registered (current user). It runs `php artisan schedule:run` every minute,
which fires the ETL at the top of each hour. To inspect/remove it:

```powershell
Get-ScheduledTask -TaskName "TibiaAtlas Scheduler"
Unregister-ScheduledTask -TaskName "TibiaAtlas Scheduler" -Confirm:$false   # to remove
```

To (re)create the job manually, register a Task Scheduler job that runs every minute:

```powershell
# Run once, from an elevated PowerShell. Adjust the php path if it changes.
$php  = (Get-Command php).Source
$proj = "C:\Users\David\Documents\web tibia\backend"
$action  = New-ScheduledTaskAction -Execute $php -Argument "artisan schedule:run" -WorkingDirectory $proj
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "TibiaAtlas Scheduler" -Action $action -Trigger $trigger -Description "Drives Laravel scheduler (runs tibia:etl-killstats daily)"
```

Alternatively, skip the Laravel scheduler and register a Task Scheduler job that
runs `php artisan tibia:etl-killstats` directly once a day.

## Public API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/killstats/meta`    | worlds/races counts, latest snapshot, players online |
| `GET /api/killstats/worlds`  | world list for the selector |
| `GET /api/killstats/ranking` | top races; `?world=&metric=players_killed\|killed&window=day\|week\|month\|year&limit=` |
| `GET /api/killstats/series`  | one race's time series; `?race=&world=&granularity=month\|day` |

Frontend dashboard: **/killstats** ("Stats" nav tab), built with Recharts.
