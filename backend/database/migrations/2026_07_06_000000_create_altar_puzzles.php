<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The daily "Altar del Bestiario" puzzle: one creature per Tibia day, shown as a
 * grey silhouette on an altar for players to identify in a single guess. Locked
 * the first time a given date is requested so it stays identical for every player
 * all day — even if creatures get published/unpublished mid-day. The day boundary
 * is Tibia's server save (10:00 Europe/Madrid), handled in AltarController.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('altar_puzzles', function (Blueprint $table) {
            $table->id();
            $table->date('date')->unique();               // Tibia game day (server-save aligned)
            $table->foreignId('entry_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('altar_puzzles');
    }
};
