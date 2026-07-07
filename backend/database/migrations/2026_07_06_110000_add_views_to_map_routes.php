<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Popularity counter for community map routes: bumped each time a visitor loads
 * a published route onto the map, so the gallery can rank the most-used ones.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_routes', function (Blueprint $table) {
            $table->unsignedInteger('views')->default(0)->after('status');
            $table->index(['status', 'views']);
        });
    }

    public function down(): void
    {
        Schema::table('map_routes', function (Blueprint $table) {
            $table->dropIndex(['status', 'views']);
            $table->dropColumn('views');
        });
    }
};
