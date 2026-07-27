<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Daily score board for the three puzzle games (wordle / altar / geo). One row
 * per character per game per Tibia day — the run is keyed on the character the
 * player linked to the map overlay, so the board is a ranking of real Tibia
 * characters rather than of anonymous browsers.
 *
 * Only solved runs are stored: the board answers "who got it, in the fewest
 * tries, fastest". It never has to be pruned — `date` is the natural partition
 * and the board query always filters on the current game day, so yesterday's
 * rows simply stop being visible at server save.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_scores', function (Blueprint $table) {
            $table->id();
            $table->string('game', 16);
            // The Tibia day (server-save boundary), from App\Support\GameDay.
            $table->date('date');
            // Display name as TibiaData spells it, plus the lowercased form that
            // carries identity — Tibia names are case-insensitive-ish in practice
            // and we must not let "Bubble" and "bubble" hold two board slots.
            $table->string('char_name', 40);
            $table->string('char_key', 40);
            // Snapshotted at submit time so the board can be rendered without
            // fanning out to TibiaData for every row.
            $table->string('world', 40)->nullable();
            $table->unsignedSmallInteger('level')->nullable();
            $table->string('vocation', 40)->nullable();
            // The score itself: attempts first, elapsed time as the tiebreak.
            $table->unsignedSmallInteger('attempts');
            $table->unsignedInteger('time_ms');
            $table->timestamps();

            $table->unique(['game', 'date', 'char_key'], 'game_scores_unique_daily');
            // Covers the board query: today's rows for one game, already ordered.
            $table->index(['game', 'date', 'attempts', 'time_ms'], 'game_scores_board_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('game_scores');
    }
};
