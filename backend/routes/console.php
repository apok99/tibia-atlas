<?php

use App\Models\EntryView;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Hourly TibiaData kill-stats snapshot. Each run OVERWRITES today's row (upsert
// on world+race+date) with the freshest last-24h window, so the day's numbers
// stay current; the monthly rollup keeps the running max so history isn't lost.
Schedule::command('tibia:etl-killstats')
    ->hourly()
    ->withoutOverlapping();

// Daily sync of the official TibiaData creature catalogue: refresh stats for the
// creatures we already document (filling gaps, never clobbering edited lore) and
// create any missing creature as a published entry. Runs once a day, off-peak.
Schedule::command('tibia:etl-creatures')
    ->dailyAt('05:30')
    ->withoutOverlapping();

// TibiaData has no per-element damage percentages, so creatures the ETL just
// created land without meta.damage_mods and the entry page can only show the
// weak/immune labels. Sweep the gaps from TibiaWiki right after the sync.
Schedule::command('tibia:backfill-damage --missing')
    ->dailyAt('06:00')
    ->withoutOverlapping();

// New entries land with an off-site sprite URL (tibia.fandom.com). Mirror any
// that aren't local yet onto our own public disk so the site never hotlinks
// fandom at render time. Cheap after the initial bulk run — it only touches the
// day's new/refreshed images. Runs after the creature sync + damage backfill.
Schedule::command('tibia:mirror-images')
    ->dailyAt('06:30')
    ->withoutOverlapping();

// Realistic expected gold-per-kill for the map's spawn money badges, derived
// from TibiaWiki loot statistics. Sampled drop data barely moves week to week
// (and it's ~380 wiki hits), so refresh weekly, after the creature sync so any
// newly-created creature picks up its loot value on the same night.
Schedule::command('tibia:etl-loot-stats')
    ->weeklyOn(1, '07:00')
    ->withoutOverlapping();

// House rent status for the map's "Casas" layer. TibiaData houses have no coords
// (pins come from the baked houses.json); this only refreshes the changing bit —
// rented / on-auction / free per world, across ALL regular worlds (~90 worlds ×
// 20 house-towns ≈ a 10-15 min run). Auctions turn over on a ~day cycle, so a
// twice-daily snapshot is plenty.
Schedule::command('tibia:etl-houses')
    ->twiceDaily(7, 19)
    ->withoutOverlapping();

// The raw view log only feeds the trailing-window "trending" calc (72h) and the
// all-time counter is denormalized on the entry, so anything older than 90 days
// is dead weight. Prune daily to keep the table from growing unbounded.
Schedule::call(function () {
    EntryView::where('created_at', '<', now()->subDays(90))->delete();
})->daily()->name('prune-entry-views')->withoutOverlapping();

// Telescope monitoring data: keep only the last 3 days so the telescope_entries
// tables can't grow unbounded on the box.
Schedule::command('telescope:prune --hours=72')->daily();
