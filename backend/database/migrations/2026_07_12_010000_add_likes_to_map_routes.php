<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Community-route likes. There are no accounts, so a like is anonymous: the
 * frontend remembers which routes a visitor liked (localStorage) and this counter
 * is bumped/decremented accordingly. It's the primary popularity signal for the
 * gallery ranking, above the raw load counter (`views`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_routes', function (Blueprint $table) {
            $table->unsignedInteger('likes')->default(0)->after('views');
            $table->index('likes');
        });
    }

    public function down(): void
    {
        Schema::table('map_routes', function (Blueprint $table) {
            $table->dropIndex(['likes']);
            $table->dropColumn('likes');
        });
    }
};
