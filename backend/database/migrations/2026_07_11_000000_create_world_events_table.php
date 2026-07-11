<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Live "what's happening on your world" feed that powers the map's news ticker.
 * Each row is a discrete event on one world at a point in time — today only
 * house status changes (a house got rented / freed / went to auction), derived
 * by tibia:etl-houses diffing each fresh TibiaData snapshot against the last one
 * (house_status is snapshot-only, so the diff is the only place the change is
 * visible). The schema is intentionally generic (type + ref_id + meta) so other
 * producers — boss sightings, kill spikes — can drop rows in later without a
 * schema change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('world_events', function (Blueprint $table) {
            $table->id();
            $table->string('world', 40);
            $table->string('type', 32);                 // house_rented | house_freed | house_auctioned | …
            $table->unsignedBigInteger('ref_id')->nullable(); // house_id for house events
            $table->string('title', 120)->nullable();   // display label (e.g. the house name)
            $table->string('town', 60)->nullable();
            $table->json('meta')->nullable();           // {from, to, bid, …}
            $table->timestamp('occurred_at');
            $table->timestamps();

            // The ticker query is "latest N events for a world".
            $table->index(['world', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('world_events');
    }
};
