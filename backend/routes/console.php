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

// The raw view log only feeds the trailing-window "trending" calc (72h) and the
// all-time counter is denormalized on the entry, so anything older than 90 days
// is dead weight. Prune daily to keep the table from growing unbounded.
Schedule::call(function () {
    EntryView::where('created_at', '<', now()->subDays(90))->delete();
})->daily()->name('prune-entry-views')->withoutOverlapping();

// Telescope monitoring data: keep only the last 3 days so the telescope_entries
// tables can't grow unbounded on the box.
Schedule::command('telescope:prune --hours=72')->daily();
