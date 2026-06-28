<?php

use App\Http\Controllers\Api\Admin\AuthController;
use App\Http\Controllers\Api\Admin\EntryController as AdminEntryController;
use App\Http\Controllers\Api\Admin\ImportController;
use App\Http\Controllers\Api\BookController;
use App\Http\Controllers\Api\EntryController;
use App\Http\Controllers\Api\KillStatsController;
use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public API (read-only) — resolves content locale from ?lang= / header.
|--------------------------------------------------------------------------
*/
Route::middleware(SetLocale::class)->group(function () {
    Route::get('/entries', [EntryController::class, 'index']);
    Route::get('/glossary', [EntryController::class, 'glossary']);
    Route::get('/spawns', [EntryController::class, 'spawns']);
    Route::get('/entries/random', [EntryController::class, 'random']);
    Route::get('/entries/trending', [EntryController::class, 'trending']);
    Route::get('/entries/popular', [EntryController::class, 'popular']);
    Route::get('/entries/facets', [EntryController::class, 'facets']);
    Route::get('/entries/{entry}', [EntryController::class, 'show']);

    // The in-game library — readable Tibia books.
    Route::get('/books', [BookController::class, 'index']);
    Route::get('/books/{book:slug}', [BookController::class, 'show']);
});

/*
|--------------------------------------------------------------------------
| Kill statistics (TibiaData ETL warehouse) — read-only, locale-agnostic.
|--------------------------------------------------------------------------
*/
Route::prefix('killstats')->group(function () {
    Route::get('/meta', [KillStatsController::class, 'meta']);
    Route::get('/worlds', [KillStatsController::class, 'worlds']);
    Route::get('/ranking', [KillStatsController::class, 'ranking']);
    Route::get('/series', [KillStatsController::class, 'series']);
    Route::get('/experience', [KillStatsController::class, 'experience']);
    Route::get('/entry/{slug}', [KillStatsController::class, 'entry']);
    Route::get('/boss/{slug}', [KillStatsController::class, 'boss']);
});

/*
|--------------------------------------------------------------------------
| Auth
|--------------------------------------------------------------------------
*/
Route::post('/auth/login', [AuthController::class, 'login']);

/*
|--------------------------------------------------------------------------
| Admin API (Sanctum-protected editorial panel)
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', SetLocale::class])->prefix('admin')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::post('/publish-drafts', [AdminEntryController::class, 'publishDrafts']);

    // Admin resolves entries by numeric id (the public API binds Entry by slug).
    Route::get('/entries', [AdminEntryController::class, 'index']);
    Route::post('/entries', [AdminEntryController::class, 'store']);
    Route::get('/entries/{entry:id}', [AdminEntryController::class, 'show']);
    Route::match(['put', 'patch'], '/entries/{entry:id}', [AdminEntryController::class, 'update']);
    Route::delete('/entries/{entry:id}', [AdminEntryController::class, 'destroy']);

    Route::post('/import/tibiawiki', [ImportController::class, 'tibiawiki']);
    Route::post('/scrape/creatures', [ImportController::class, 'scrapeCreatures']);
});
