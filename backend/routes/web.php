<?php

use App\Http\Controllers\LlmsController;
use App\Http\Controllers\PrerenderController;
use App\Http\Controllers\SitemapController;
use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\Route;

// XML sitemaps (index + per-section), generated from the database.
Route::get('/sitemap.xml', [SitemapController::class, 'index']);
Route::get('/sitemap-{section}.xml', [SitemapController::class, 'section'])
    ->where('section', 'pages|lore|items');

// Full Markdown index for AI assistants (curated /llms.txt is a static file),
// plus one clean Markdown document per article for direct AI ingestion.
Route::get('/llms-full.txt', [LlmsController::class, 'full']);
Route::get('/entry/{slug}.md', [LlmsController::class, 'entry'])
    ->where('slug', '[a-z0-9-]+');

// Atom feed of the latest published/updated articles (freshness signal).
Route::get('/feed.xml', [SitemapController::class, 'feed']);

/*
|--------------------------------------------------------------------------
| Dynamic rendering for crawlers (catch-all — MUST stay last).
|--------------------------------------------------------------------------
| In production Nginx serves the SPA bundle to humans and only forwards
| crawler user-agents (Googlebot, GPTBot, ClaudeBot, …) here, where Laravel
| renders a server-side HTML mirror of the requested SPA route from the DB.
| The regex keeps the API, Telescope, sitemaps, assets and health check out.
*/
Route::get('/{path?}', [PrerenderController::class, 'render'])
    ->where('path', '^(?!api|telescope|vendor|storage|sitemap|llms|feed|robots|favicon|logo|apple-touch|up|assets|build).*$')
    ->middleware(SetLocale::class);
