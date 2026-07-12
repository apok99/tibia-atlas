<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Route-bug reports from the interactive map. When a visitor computes a "Cómo
 * llegar" route that looks wrong (crosses a wall, takes an absurd detour, tells
 * them to "use tp" where there's no teleport, ends as a partial trail…), they
 * hit "Reportar" in the directions bar and everything needed to reproduce the
 * bug lands here for a later fix pass.
 *
 * There are no accounts, so it's anonymous (request IP kept for abuse control).
 * The routing engine is deterministic, so start+end alone reproduce the plan —
 * but we also snapshot the computed itinerary (`plan`) and the map URL `hash`
 * so a report can be triaged and replayed without recomputing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('route_reports', function (Blueprint $table) {
            $table->id();

            // Endpoints the user routed between (game tiles + floor). Labels are
            // the picker names ("Thais", "Grim Reaper") or null for a raw click.
            $table->integer('from_x');
            $table->integer('from_y');
            $table->smallInteger('from_floor');
            $table->string('from_label')->nullable();
            $table->integer('to_x');
            $table->integer('to_y');
            $table->smallInteger('to_floor');
            $table->string('to_label')->nullable();

            // What the user says is wrong (optional free text — the most useful
            // field for a fix, e.g. "atraviesa la pared en Drefia").
            $table->text('note')->nullable();

            // Snapshot of the computed itinerary: totalTiles, partial info and a
            // per-leg summary (kind, floors, endpoints, tool, boat line) — walk
            // paths are trimmed to endpoints so rows stay small.
            $table->jsonb('plan')->nullable();
            $table->integer('total_tiles')->nullable();  // quick sort/scan
            $table->boolean('partial')->default(false);  // trail-lost route

            // Reproduction + context: the map URL hash encodes the exact route,
            // plus the floor the user was viewing and their UI language.
            $table->text('hash')->nullable();
            $table->smallInteger('view_floor')->nullable();
            $table->string('lang', 5)->nullable();

            $table->string('ip', 45)->nullable();
            $table->string('status', 12)->default('open'); // open|resolved|wontfix
            $table->timestamps();

            $table->index('status');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_reports');
    }
};
