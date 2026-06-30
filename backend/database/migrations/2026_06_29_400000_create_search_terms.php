<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Search popularity, keyed by the entry a user actually OPENED from the search
 * box — not by raw typed text. This is deliberate: logging every autocomplete
 * keystroke recorded half-typed fragments ("mord") and let several fragments of
 * the same name resolve to duplicate rows. One row per slug means the dashboard
 * shows real, de-duplicated "most searched" entries.
 *
 * Logged inline by EntryController@logSearchClick (best-effort, never blocks).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('search_terms', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 120)->unique(); // entry opened from search
            $table->string('term', 120);           // canonical entry name at log time
            $table->unsignedInteger('hits')->default(1);
            $table->timestamp('last_searched_at')->nullable();
            $table->timestamps();

            $table->index(['hits', 'last_searched_at'], 'search_terms_rank_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('search_terms');
    }
};
