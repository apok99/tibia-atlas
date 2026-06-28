<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            // Editorial review tracking: lets the review pass resume across
            // sessions ("which entries have I already checked, and when?").
            $table->boolean('reviewed')->default(false)->index();
            $table->timestamp('reviewed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            $table->dropColumn(['reviewed', 'reviewed_at']);
        });
    }
};
