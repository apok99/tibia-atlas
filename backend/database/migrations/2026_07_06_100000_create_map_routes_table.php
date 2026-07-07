<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Community-submitted map routes: a named ordered list of waypoints a visitor
 * builds on the interactive map and sends in to be published. There are no user
 * accounts, so a submission is anonymous — an optional free-text author name and
 * the request IP (for moderation / abuse control) are all we keep. Every route
 * lands as `pending` and only a reviewer flips it to `published`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('map_routes', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            // Ordered waypoints as [[x, y, z], ...] — the same shape creature
            // spawns use, so the frontend plots them with the existing plumbing.
            $table->jsonb('waypoints');
            // How the points connect on the map: 'auto' (A* between them) or
            // 'straight' (plain lines).
            $table->string('connect', 12)->default('straight');
            $table->string('author')->nullable();      // optional nickname, no account
            $table->string('ip', 45)->nullable();       // submitter IP (moderation)
            $table->string('status', 12)->default('pending'); // pending|published|rejected
            $table->timestamps();

            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_routes');
    }
};
