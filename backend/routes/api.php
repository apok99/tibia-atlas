<?php

use App\Http\Controllers\Api\AltarController;
use App\Http\Controllers\Api\BookController;
use App\Http\Controllers\Api\CharacterController;
use App\Http\Controllers\Api\EntryController;
use App\Http\Controllers\Api\EventController;
use App\Http\Controllers\Api\GameScoreController;
use App\Http\Controllers\Api\HouseController;
use App\Http\Controllers\Api\HuntController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\KillStatsController;
use App\Http\Controllers\Api\MapRouteController;
use App\Http\Controllers\Api\NpcController;
use App\Http\Controllers\Api\RouteReportController;
use App\Http\Controllers\Api\WordleController;
use App\Http\Controllers\Api\ZoneController;
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
        // Aggregate stats for a worn set (the map's character gear readout).
        Route::get('/items/set-stats', [ItemController::class, 'setStats']);
        // Where to buy/sell an item: merchants, real prices, map spawns.
        Route::get('/items/{slug}/trade', [ItemController::class, 'trade']);
        // Merchant NPC search for the map ("Cómo llegar" straight to the shop).
        Route::get('/npcs', [NpcController::class, 'index']);
        // Hunt Finder: best hunting zones for a level + vocation + solo/team.
        Route::get('/hunts', [HuntController::class, 'index']);
        // Map zone analysis: combat summary of a drag-selected rectangle.
        Route::get('/zone-summary', [ZoneController::class, 'summary']);
        // "How do I protect myself from <element>?" — clicked incoming-damage bar.
        Route::get('/zone-protection', [ZoneController::class, 'protection']);
        // Detail must come AFTER the literal item routes or it'd bind them as a slug.
        Route::get('/items/{slug}', [ItemController::class, 'show']);
    });

    Route::middleware('cache.headers:public;max_age=30;s_maxage=120')->group(function () {
        Route::get('/entries', [EntryController::class, 'index']);
        Route::get('/entries/popular', [EntryController::class, 'popular']);
        // Global autocomplete search (published lore + the item catalogue).
        Route::get('/search', [EntryController::class, 'search']);
        // Most-searched terms on the site (falls back to most-viewed).
        Route::get('/search/top', [EntryController::class, 'topSearches']);
    });

    // Record that a search result was actually opened (search-popularity log).
    // Tighter throttle than reads: it's an unauthenticated write.
    Route::post('/search/click', [EntryController::class, 'logSearchClick'])
        ->middleware('throttle:interact');

    // Community map routes: published gallery (read) + anonymous submission
    // (write, IP-throttled, lands as pending for review).
    Route::get('/routes', [MapRouteController::class, 'index']);
    Route::post('/routes', [MapRouteController::class, 'store'])
        ->middleware('throttle:interact');
    // Bump a route's load counter (feeds the "popular" ranking).
    Route::post('/routes/{route}/view', [MapRouteController::class, 'view'])
        ->middleware('throttle:interact');
    // Like / unlike a route (anonymous; the client tracks its own likes). Likes
    // are the gallery's primary popularity signal.
    Route::post('/routes/{route}/like', [MapRouteController::class, 'like'])
        ->middleware('throttle:interact');
    Route::post('/routes/{route}/unlike', [MapRouteController::class, 'unlike'])
        ->middleware('throttle:interact');

    // Route-bug reports: a visitor flags a "Cómo llegar" route that looks wrong.
    // Write-only from the public (IP-throttled); read back via artisan to fix.
    Route::post('/route-reports', [RouteReportController::class, 'store'])
        ->middleware('throttle:interact');

    // Random/trending must stay fresh; show carries the view-count side effect.
    Route::get('/entries/random', [EntryController::class, 'random']);
    Route::get('/entries/trending', [EntryController::class, 'trending']);
    Route::get('/entries/{entry}', [EntryController::class, 'show'])
        ->middleware('cache.headers:public;max_age=15;etag');
});

/*
|--------------------------------------------------------------------------
| Editorial CRUD (authenticated) — create / update / delete lore entries.
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', 'throttle:editorial'])->group(function () {
    Route::post('/entries', [EntryController::class, 'store']);
    Route::match(['put', 'patch'], '/entries/{entry}', [EntryController::class, 'update']);
    Route::delete('/entries/{entry}', [EntryController::class, 'destroy']);
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
    Route::get('/bosses', [KillStatsController::class, 'bosses']);
    Route::get('/entry/{slug}', [KillStatsController::class, 'entry']);
    Route::get('/creature/{slug}', [KillStatsController::class, 'creature']);
    Route::get('/boss/{slug}', [KillStatsController::class, 'boss']);
});

/*
|--------------------------------------------------------------------------
| House rent status (TibiaData ETL) — per-world live status layered onto the
| map's static house pins. Read-only, locale-agnostic.
|--------------------------------------------------------------------------
*/
Route::prefix('houses')->middleware(['throttle:public', 'cache.headers:public;max_age=120;s_maxage=600'])->group(function () {
    Route::get('/', [HouseController::class, 'index']);
    Route::get('/worlds', [HouseController::class, 'worlds']);
    // Auction price history: the index across all houses, and one house's own
    // bid trail. Both are append-only series built by tibia:etl-houses.
    Route::get('/prices', [HouseController::class, 'prices']);
    Route::get('/prices/towns', [HouseController::class, 'priceTowns']);
    Route::get('/{world}/{house}/bids', [HouseController::class, 'bids'])->whereNumber('house');
    // Live single-house detail (TibiaData proxy) — owner name for the map popup.
    Route::get('/{world}/{house}', [HouseController::class, 'show'])->whereNumber('house');
});

/*
|--------------------------------------------------------------------------
| Live world events (TibiaData house-status diff) — feeds the map news ticker.
| Short TTL so a fresh ETL run surfaces quickly, but still CDN-cacheable.
|--------------------------------------------------------------------------
*/
Route::get('/events', [EventController::class, 'index'])
    ->middleware(['throttle:public', 'cache.headers:public;max_age=60;s_maxage=180']);

/*
|--------------------------------------------------------------------------
| Character lookup (TibiaData proxy) — feeds the map's "your character"
| overlay. Cached briefly; the upstream is the slow part. `{name}` allows
| spaces/apostrophes, so it is a catch-all bound param.
|--------------------------------------------------------------------------
*/
Route::get('/character/{name}', [CharacterController::class, 'show'])
    ->where('name', '.*')
    ->middleware(['throttle:public', 'cache.headers:public;max_age=120;s_maxage=300']);

/*
|--------------------------------------------------------------------------
| Bestiordle — the daily creature word game. Locale-agnostic (English names).
| `today` ships the puzzle shape + valid-word list; `guess` scores server-side
| so the answer is only revealed once the player finishes.
|--------------------------------------------------------------------------
*/
Route::prefix('wordle')->middleware('throttle:public')->group(function () {
    Route::get('/today', [WordleController::class, 'today'])
        ->middleware('cache.headers:public;max_age=30;s_maxage=60');
    Route::post('/guess', [WordleController::class, 'guess'])
        ->middleware('throttle:interact');
});

/*
|--------------------------------------------------------------------------
| Altar del Bestiario — the daily creature silhouette game. One creature per
| day shown greyed-out on an altar; a single guess to name it. `today` ships
| the puzzle shape, light stat hints and the guess list; `silhouette` streams
| the sprite through a name-free URL; `guess` scores the one attempt.
|--------------------------------------------------------------------------
*/
Route::prefix('altar')->middleware('throttle:public')->group(function () {
    Route::get('/today', [AltarController::class, 'today'])
        ->middleware('cache.headers:public;max_age=30;s_maxage=60');
    Route::get('/silhouette', [AltarController::class, 'silhouette'])
        ->middleware('cache.headers:public;max_age=1800;s_maxage=3600');
    Route::post('/guess', [AltarController::class, 'guess'])
        ->middleware('throttle:interact');
});

/*
|--------------------------------------------------------------------------
| Daily game boards — top 10 per game (wordle / altar / geo), ranked by
| attempts then time, tied to the Tibia character linked on the map. Wipes
| itself at server save (the query filters on the current game day).
|
| Explicitly uncacheable: the board moves the instant anyone finishes, and the
| player who just posted a run reloads it immediately — even a 15s browser TTL
| serves them a board they aren't on yet. `?char=` also personalises it, so a
| shared cache must not store it either. It stays cheap regardless: one indexed
| query over a table that only holds the current day, plus a 30s client-side
| stale window in the panel itself.
|--------------------------------------------------------------------------
*/
Route::prefix('games/{game}')->middleware('throttle:public')->group(function () {
    Route::get('/board', [GameScoreController::class, 'index'])
        ->middleware('cache.headers:private;no_store');
    Route::post('/board', [GameScoreController::class, 'store'])
        ->middleware('throttle:interact');
});
