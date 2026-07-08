<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Live rent status of houses, per world, from TibiaData's houses API. The map's
 * static houses.json holds coords/name/rent (world-agnostic); this table layers
 * the changing bit on top — is a given house rented, up for auction, or free on
 * a given world — joined to the pins by the real Tibia `house_id`. Snapshot-only
 * (upserted each ETL run); no history kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('house_status', function (Blueprint $table) {
            $table->id();
            $table->string('world', 40);
            $table->unsignedInteger('house_id');       // real Tibia house id (== houses.json id)
            $table->string('status', 12);              // rented | auctioned | free
            $table->unsignedBigInteger('bid')->default(0); // current auction bid, when auctioned
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['world', 'house_id']);
            $table->index('world');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('house_status');
    }
};
