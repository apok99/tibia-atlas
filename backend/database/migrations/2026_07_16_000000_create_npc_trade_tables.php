<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The NPC trade directory behind "¿dónde compro / vendo este objeto?": every
 * shop offer parsed out of the OT server's npc luas by tibia:etl-npc-shops.
 *
 * Two levels: `trade_npcs` is one row per merchant (map spawn tiles from the
 * world spawn XML, plus the lore-entry link and city when we have them), and
 * `npc_offers` is one row per item that merchant trades, with the real gold
 * prices. Both tables are fully derived data — the ETL wipes and rebuilds them
 * on every run, so no row is ever edited by hand.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trade_npcs', function (Blueprint $table) {
            $table->id();
            $table->string('name', 80)->unique();       // OT npc name ("Rashid")
            // Lore entry (type=npc) when one exists, for sprite/city/link-through.
            $table->foreignId('entry_id')->nullable()->constrained('entries')->nullOnDelete();
            $table->string('city', 60)->nullable();     // from the lore entry's wiki infobox
            $table->json('spawns')->nullable();         // [[x,y,z], …] inside the mapped region
            // Non-gold trade currency (e.g. "gold token"), null = plain gold.
            $table->string('currency', 60)->nullable();
            $table->timestamps();
        });

        Schema::create('npc_offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trade_npc_id')->constrained('trade_npcs')->cascadeOnDelete();
            $table->foreignId('item_entry_id')->constrained('entries')->cascadeOnDelete();
            // Wiki/UI semantics: `buy` = what the player PAYS to buy from the
            // NPC; `sell` = what the NPC pays when the player sells to them.
            $table->unsignedInteger('buy')->nullable();
            $table->unsignedInteger('sell')->nullable();
            $table->timestamps();

            $table->unique(['trade_npc_id', 'item_entry_id']);
            // The item page asks "who trades THIS item".
            $table->index('item_entry_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('npc_offers');
        Schema::dropIfExists('trade_npcs');
    }
};
