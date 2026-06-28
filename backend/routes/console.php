<?php

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
