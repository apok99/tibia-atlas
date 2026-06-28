<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Storage for the TibiaData kill-statistics ETL.
 *
 * The TibiaData API only exposes rolling windows (last 24h / last 7 days) per
 * world+race. To build monthly/annual charts we snapshot the *daily* window
 * once per day and accumulate:
 *   - kill_daily   : raw daily snapshots, kept ~30 days (rolling, pruned).
 *   - kill_monthly : per-month rollups (sum of the daily windows), kept forever
 *                    — this is what powers the monthly and annual graphs.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Dimension: one row per game world (Antica, Secura, …). Refreshed each run.
        Schema::create('tibia_worlds', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('location')->nullable();
            $table->string('pvp_type')->nullable();
            $table->string('game_world_type')->nullable();
            $table->string('status')->nullable();
            $table->unsignedInteger('players_online')->default(0);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
        });

        // Dimension: one row per killable "race" (creatures, bosses, special
        // forces). Optionally linked to a lore Entry by matching the EN name.
        Schema::create('tibia_races', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->foreignId('entry_id')->nullable()->constrained('entries')->nullOnDelete();
            $table->timestamps();
        });

        // Fact: raw daily snapshot of one race in one world. Pruned to ~30 days.
        Schema::create('kill_daily', function (Blueprint $table) {
            $table->id();
            $table->foreignId('world_id')->constrained('tibia_worlds')->cascadeOnDelete();
            $table->foreignId('race_id')->constrained('tibia_races')->cascadeOnDelete();
            $table->date('snapshot_date');
            // "players_killed" = players this creature killed; "killed" = the
            // creature itself killed by players. Both for the last-day window…
            $table->unsignedInteger('day_players_killed')->default(0);
            $table->unsignedInteger('day_killed')->default(0);
            // …and the last-week window (kept for a sanity cross-check).
            $table->unsignedInteger('week_players_killed')->default(0);
            $table->unsignedInteger('week_killed')->default(0);
            $table->timestamps();

            $table->unique(['world_id', 'race_id', 'snapshot_date']);
            $table->index('snapshot_date');               // pruning
            $table->index(['race_id', 'snapshot_date']);  // per-race time series
        });

        // Fact: per-month rollup (sum of the daily windows). Kept indefinitely.
        Schema::create('kill_monthly', function (Blueprint $table) {
            $table->id();
            $table->foreignId('world_id')->constrained('tibia_worlds')->cascadeOnDelete();
            $table->foreignId('race_id')->constrained('tibia_races')->cascadeOnDelete();
            $table->date('period');   // first day of the month, e.g. 2026-06-01
            $table->unsignedBigInteger('players_killed')->default(0);
            $table->unsignedBigInteger('killed')->default(0);
            $table->unsignedSmallInteger('days_counted')->default(0); // snapshots folded in
            $table->timestamps();

            $table->unique(['world_id', 'race_id', 'period']);
            $table->index('period');
            $table->index(['race_id', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kill_monthly');
        Schema::dropIfExists('kill_daily');
        Schema::dropIfExists('tibia_races');
        Schema::dropIfExists('tibia_worlds');
    }
};
