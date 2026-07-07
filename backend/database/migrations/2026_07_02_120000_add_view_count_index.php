<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "Most viewed first" index. Popular listings, the crawler home/browse pages
 * and the sitemap all sort published entries by view_count desc — without this
 * each of those is a full scan + sort.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        DB::statement('CREATE INDEX IF NOT EXISTS entries_status_view_count_idx ON entries (status, view_count DESC)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS entries_status_view_count_idx');
    }
};
