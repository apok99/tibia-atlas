<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hourly history of how many players are online across all worlds.
 *
 * TibiaData only exposes the CURRENT online count (/v4/worlds), with no history,
 * so — like the kill stats — we snapshot it ourselves. The ETL records one row
 * per hour bucket (upsert, so a re-run within the hour overwrites). This powers
 * the "players online over time" chart on the dashboard; it builds up forward.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('online_snapshots', function (Blueprint $table) {
            $table->id();
            $table->timestamp('captured_at')->unique();   // hour bucket
            $table->unsignedInteger('players_online')->default(0);
            $table->unsignedSmallInteger('worlds_online')->default(0);
            $table->timestamps();

            $table->index('captured_at', 'online_snapshots_captured_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('online_snapshots');
    }
};
