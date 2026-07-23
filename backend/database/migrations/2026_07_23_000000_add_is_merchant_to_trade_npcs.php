<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The map's NPC search wants EVERY walkable NPC, not just merchants — quest
 * givers, bankers, ship captains… `tibia:etl-npc-shops` now imports the
 * shopless ones too (when the world XML pins them to the map), flagged so the
 * trade views can keep telling merchants apart.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trade_npcs', function (Blueprint $table) {
            $table->boolean('is_merchant')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('trade_npcs', function (Blueprint $table) {
            $table->dropColumn('is_merchant');
        });
    }
};
