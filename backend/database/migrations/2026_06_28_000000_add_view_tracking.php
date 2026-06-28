<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // All-time popularity counter, powers the "Most popular" section.
        Schema::table('entries', function (Blueprint $table) {
            $table->unsignedInteger('view_count')->default(0)->index();
        });

        // One row per (deduplicated) page view. Timestamped so we can compute
        // a rolling window — the "Trending · last 72h" carousel.
        Schema::create('entry_views', function (Blueprint $table) {
            $table->id();
            $table->foreignId('entry_id')->constrained('entries')->cascadeOnDelete();
            // Hash of IP + user agent — anti-spam dedup key (no PII stored raw).
            $table->string('visitor', 64);
            $table->timestamps();

            // Rolling-window aggregation (count views since N hours ago).
            $table->index('created_at');
            // Dedup lookup: "did this visitor view this entry recently?".
            $table->index(['entry_id', 'visitor', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entry_views');
        Schema::table('entries', function (Blueprint $table) {
            $table->dropColumn('view_count');
        });
    }
};
