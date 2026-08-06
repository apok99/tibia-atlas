<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One ROW PER SEARCH, not per entry. The older `search_terms` table keeps a
 * single lifetime counter per slug, which made "most searched" unrankable over
 * a window: a term searched five times last month outranked one searched four
 * times today, so the panel froze on whatever was popular when the log started
 * and new searches (the map's search box, which is where the traffic actually
 * is) could never surface.
 *
 * Events make the window real: rank = COUNT(*) inside the window, so the panel
 * answers "what are people searching NOW". `search_terms` stays as the all-time
 * counter.
 *
 * `slug` is nullable on purpose: merchant NPCs searched on the map often have no
 * lore page, and they're still a real search — those rank by `term` alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('search_clicks', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 120)->nullable(); // entry opened, when there is one
            $table->string('term', 120);             // canonical name at log time
            $table->timestamp('searched_at');

            // The ranking read: window filter first, then group.
            $table->index(['searched_at', 'slug'], 'search_clicks_window_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('search_clicks');
    }
};
