<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The daily "Bestiordle" puzzle: one creature per Tibia day (its length rotates
 * 4→5→6→7 daily), locked the first time a given date is requested so it stays
 * identical for every player all day — even if creatures get published/unpublished
 * mid-day. The day boundary is Tibia's server save (10:00 Europe/Berlin), handled
 * in WordleController.
 *
 * `word` is denormalised (the lowercased English creature name at pick time) so
 * the answer never shifts if the underlying translation is later edited.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wordle_puzzles', function (Blueprint $table) {
            $table->id();
            $table->date('date')->unique();               // Tibia game day (server-save aligned)
            $table->foreignId('entry_id')->constrained()->cascadeOnDelete();
            $table->string('word', 7);                     // lowercased answer, locked at pick time
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wordle_puzzles');
    }
};
