<?php

use App\Http\Controllers\Api\BookController;
use App\Http\Controllers\Api\EntryController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\KillStatsController;
use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public API (read-only) — resolves content locale from ?lang= / header.
|--------------------------------------------------------------------------
*/
Route::middleware([SetLocale::class, 'throttle:public'])->group(function () {
    // Cache-Control tiers. `s_maxage` lets Cloudflare serve the bulk of read
    // traffic without hitting PHP; `max_age` is the browser's own window.
    // Stable, rarely-changing data (glossary/facets/spawns/books) gets long CDN
    // TTLs; listings get short ones. `show` is deliberately NOT CDN-cached so
    // its view counter keeps incrementing on real hits.
    Route::middleware('cache.headers:public;max_age=120;s_maxage=600')->group(function () {
        Route::get('/glossary', [EntryController::class, 'glossary']);
        Route::get('/spawns', [EntryController::class, 'spawns']);
        Route::get('/entries/facets', [EntryController::class, 'facets']);
        Route::get('/books', [BookController::class, 'index']);
        Route::get('/books/{book:slug}', [BookController::class, 'show']);
        // Item catalogue: album gallery + loadout configurator.
        Route::get('/items', [ItemController::class, 'index']);
        Route::get('/items/facets', [ItemController::class, 'facets']);
        Route::get('/items/loadout', [ItemController::class, 'loadout']);
        // Detail must come AFTER the literal item routes or it'd bind them as a slug.
        Route::get('/items/{slug}', [ItemController::class, 'show']);
    });

    Route::middleware('cache.headers:public;max_age=30;s_maxage=120')->group(function () {
        Route::get('/entries', [EntryController::class, 'index']);
        Route::get('/entries/popular', [EntryController::class, 'popular']);
        // Global autocomplete search (published lore + the item catalogue).
        Route::get('/search', [EntryController::class, 'search']);
    });

    // Random/trending must stay fresh; show carries the view-count side effect.
    Route::get('/entries/random', [EntryController::class, 'random']);
    Route::get('/entries/trending', [EntryController::class, 'trending']);
    Route::get('/entries/{entry}', [EntryController::class, 'show'])
        ->middleware('cache.headers:public;max_age=15;etag');
});

/*
|--------------------------------------------------------------------------
| Kill statistics (TibiaData ETL warehouse) — read-only, locale-agnostic.
|--------------------------------------------------------------------------
*/
Route::prefix('killstats')->middleware(['throttle:public', 'cache.headers:public;max_age=60;s_maxage=300'])->group(function () {
    Route::get('/meta', [KillStatsController::class, 'meta']);
    Route::get('/overview', [KillStatsController::class, 'overview']);
    Route::get('/worlds', [KillStatsController::class, 'worlds']);
    Route::get('/ranking', [KillStatsController::class, 'ranking']);
    Route::get('/series', [KillStatsController::class, 'series']);
    Route::get('/experience', [KillStatsController::class, 'experience']);
    Route::get('/entry/{slug}', [KillStatsController::class, 'entry']);
    Route::get('/boss/{slug}', [KillStatsController::class, 'boss']);
});
